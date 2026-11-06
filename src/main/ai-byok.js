// === Bring your own AI key: the vault and the requests (main process only) ======
//
// The key is typed once in Settings > AI > Connect an AI, goes through ONE IPC call
// to here and is sealed by the operating system (Electron safeStorage, Windows
// DPAPI, through main's SecretStore, the same mechanism as the AI Worker token and
// the GitHub token) in ai-keys.enc. After that:
//
//   * the window is only ever told "saved, ends in ...abcd" (status());
//   * every provider request is made HERE with net.fetch, and the answer is streamed
//     back to the window as events (the window's CSP stays strict: no page and no
//     renderer script talks to a provider);
//   * the key is never logged, never put in an error (scrub()), never in
//     localStorage, a backup, Vex Sync or a diagnostics bundle;
//   * "Remove key" and the secure-data erase (secure-stores.js) delete the file.
//
// createByok({ secretStore, file, fetch, now, testHost }) is pure over its parts, so
// tests/main/aiByok.test.js drives it with a fake store and a fake fetch.
//
// TEST-ONLY HOST: testHost (src/main.js passes it ONLY when VEX_TEST_PROVIDER_HOST is
// set AND the app is not packaged) sends every provider's requests to a local stand-in
// server at that http://127.0.0.1:<port> address instead, as <host>/<provider id>/...
// It is how the real-window checks run without a real key. A packaged Vex never reads
// the variable, and status() reports testHost so the Settings page shows a banner.
const providers = require('./ai-providers');
const prices = require('./ai-prices');

const MAX_BODY = 8 * 1024 * 1024;

function createByok({ secretStore, file, fetch, now = () => Date.now(), testHost = '', log = (m) => console.log(m) } = {}) {
  if (!secretStore || typeof secretStore.read !== 'function' || typeof secretStore.write !== 'function' || typeof secretStore.clear !== 'function') throw new Error('createByok needs a secret store');
  if (!file) throw new Error('createByok needs a file');
  if (typeof fetch !== 'function') throw new Error('createByok needs a fetch');
  if (testHost && !/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(testHost)) throw new Error('VEX_TEST_PROVIDER_HOST must be http://127.0.0.1:<port>');
  if (testHost) log('[AI keys] TEST MODE: provider requests go to ' + testHost + ', not to the providers');

  const modelCache = new Map();           // provider id -> { models, recommended, source, note, at }  (this session only)
  const running = new Map();              // request id -> AbortController
  let queue = Promise.resolve();          // writes one at a time

  async function load() {
    const rec = await secretStore.read(file, () => null);
    const list = rec && typeof rec === 'object' && rec.providers && typeof rec.providers === 'object' ? rec.providers : {};
    return { v: 1, providers: { ...list } };
  }
  function save(rec) { return secretStore.write(file, rec); }
  // A failed write rejects to its own caller only; the next one still runs.
  function serial(fn) { const run = queue.then(fn); queue = run.then(() => undefined, () => undefined); return run; }

  // The key and anything that looks like one never reaches a message, a log or the window.
  const scrub = (text, key) => {
    let s = String(text == null ? '' : text);
    if (key && key.length >= 8) s = s.split(key).join('[key]');
    return s.replace(/\b(sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}|Bearer\s+[A-Za-z0-9._~+/=-]{16,})/g, '[key]');
  };

  function baseOf(id, entry) {
    if (testHost) return testHost + '/' + id;
    const p = providers.provider(id);
    return p.needsBaseUrl ? (entry && entry.baseUrl) || '' : p.baseUrl;
  }

  const last4 = (key) => (key && key.length >= 12 ? key.slice(-4) : '');

  function publicEntry(id, entry) {
    const saved = !!entry;
    return {
      ...providers.describe(id),
      saved,
      last4: saved ? last4(entry.key) : '',
      hasKey: saved && !!entry.key,
      savedAt: saved ? entry.savedAt || 0 : 0,
      baseUrl: saved && entry.baseUrl ? entry.baseUrl : '',
      models: { default: (entry && entry.models && entry.models.default) || '', fast: (entry && entry.models && entry.models.fast) || '', best: (entry && entry.models && entry.models.best) || '' },
    };
  }

  // { providers: [...], prices, testHost } : never a key.
  async function status() {
    const rec = await load();
    return {
      providers: providers.PROVIDER_IDS.map(id => publicEntry(id, rec.providers[id])),
      prices: { asOf: prices.PRICES_AS_OF, note: prices.PRICES_NOTE, rows: prices.PRICES.map(r => ({ ...r })) },
      testHost: !!testHost,
    };
  }

  async function setKey(id, key, { baseUrl } = {}) {
    providers.provider(id);
    const k = providers.checkKey(id, key);
    const p = providers.provider(id);
    const base = p.needsBaseUrl ? providers.checkBaseUrl(baseUrl) : '';
    return serial(async () => {
      const rec = await load();
      const prev = rec.providers[id];
      rec.providers[id] = { key: k, savedAt: now(), ...(base ? { baseUrl: base } : {}), models: (prev && prev.models) || {} };
      await save(rec);
      modelCache.delete(id);
      return { ok: true, provider: publicEntry(id, rec.providers[id]) };
    });
  }

  async function clearKey(id) {
    providers.provider(id);
    return serial(async () => {
      const rec = await load();
      delete rec.providers[id];
      if (Object.keys(rec.providers).length) await save(rec); else await secretStore.clear(file);
      modelCache.delete(id);
      return { ok: true };
    });
  }

  async function setModels(id, models) {
    providers.provider(id);
    const clean = {};
    for (const slot of ['default', 'fast', 'best']) {
      const v = models && models[slot] != null ? String(models[slot]).trim() : '';
      if (v.length > 200 || /[\s\x00-\x1f]/.test(v)) throw new Error('"' + slot + '" is not a model id');
      clean[slot] = v;
    }
    return serial(async () => {
      const rec = await load();
      if (!rec.providers[id]) throw new Error('Save a key for ' + providers.provider(id).short + ' first');
      rec.providers[id] = { ...rec.providers[id], models: clean };
      await save(rec);
      return { ok: true, provider: publicEntry(id, rec.providers[id]) };
    });
  }

  // An HTTP or network failure -> the result object the window shows ({ ok: false, error }). Never throws.
  function failure(err, key, id) {
    const e = err && typeof err === 'object' && typeof err.code === 'string' && 'detail' in err ? err : { code: 'network', status: 0, detail: scrub((err && err.message) || String(err), key), retryAfter: 0 };
    return { ok: false, error: { ...e, detail: scrub(e.detail, key), provider: id } };
  }

  async function send(url, init, key, feature) {
    let res;
    try {
      res = await fetch(url, { redirect: 'error', credentials: 'omit', maxBytes: MAX_BODY, egress: { feature, kind: 'ai' }, ...init });
    } catch (err) {
      if (init.signal && init.signal.aborted) throw Object.assign(new Error('Stopped'), { code: 'stopped' });
      throw { code: 'network', status: 0, detail: scrub((err && err.message) || String(err), key), retryAfter: 0 };
    }
    if (!res.ok) {
      // An error body that cannot be read leaves the status code to speak for itself.
      const body = await res.text().then((t) => t, () => '');
      const mapped = providers.mapHttpError(res.status, body, res.headers);
      throw { ...mapped, detail: scrub(mapped.detail, key) };
    }
    return res;
  }

  // The provider's own model list, chat models only, newest first, cached for this session. When listing fails the
  // known models (Claude only) are shown, and the note says so. -> { ok, source, note, models, recommended, ms, error? }
  async function listModels(id, { refresh = false } = {}) {
    const p = providers.provider(id);
    const rec = await load();
    const entry = rec.providers[id];
    if (!entry) return { ok: false, source: 'none', models: [], recommended: { best: null, default: null, fast: null }, error: { code: 'no-key', status: 0, detail: 'No key is saved for ' + p.short, provider: id } };
    if (!refresh && modelCache.has(id)) return { ok: true, ...modelCache.get(id) };
    const t0 = now();
    try {
      const base = baseOf(id, entry);
      if (!base) throw { code: 'bad-request', status: 0, detail: 'No server address is saved for ' + p.short, retryAfter: 0 };
      const req = providers.listRequest(id, base, entry.key);
      const res = await send(req.url, { method: 'GET', headers: req.headers, timeoutMs: 20000 }, entry.key, 'Your AI key: model list (' + p.short + ')');
      let json;
      try { json = JSON.parse(await res.text()); } catch { throw { code: 'bad-request', status: res.status, detail: 'The model list was not JSON', retryAfter: 0 }; }
      const models = providers.parseModelList(id, json);
      if (!models.length) throw { code: 'bad-request', status: res.status, detail: 'The list held no chat models', retryAfter: 0 };
      const out = { source: 'live', note: '', models, recommended: providers.recommend(id, models), ms: now() - t0, at: now() };
      modelCache.set(id, out);
      return { ok: true, ...out };
    } catch (err) {
      const f = failure(err, entry.key, id);
      const known = providers.fallbackModels(id);
      return { ok: false, source: 'fallback', note: providers.FALLBACK_NOTE, models: known, recommended: providers.recommend(id, known), ms: now() - t0, error: f.error };
    }
  }

  // "Test key": the model list is a tiny real request. -> { ok, count, ms } or { ok: false, error }
  async function test(id) {
    const r = await listModels(id, { refresh: true });
    if (r.ok) return { ok: true, count: r.models.length, ms: r.ms, recommended: r.recommended };
    return { ok: false, error: r.error, count: 0, ms: r.ms };
  }

  // Which model answers: the request's own, else the one chosen for its tier, else the recommended one. null = none.
  async function modelFor(id, entry, { model, tier }) {
    if (model) return model;
    const slot = tier === 'best' || tier === 'fast' ? tier : 'default';
    const chosen = entry.models && entry.models[slot];
    if (chosen) return chosen;
    const listed = await listModels(id);
    const rec = listed.recommended && listed.recommended[slot];
    return rec || null;
  }

  // One chat request, streamed. onEvent({ type: 'delta', text }) for every piece. -> { ok, text, usage, model, provider } or
  // { ok: false, error }. `id` names it for cancel().
  async function chat(requestId, providerId, req, onEvent) {
    const p = providers.provider(providerId);
    const rec = await load();
    const entry = rec.providers[providerId];
    if (!entry) return failure({ code: 'no-key', status: 0, detail: 'No key is saved for ' + p.short, retryAfter: 0 }, '', providerId);
    const key = entry.key;
    const ctl = new AbortController();
    running.set(requestId, ctl);
    try {
      const model = await modelFor(providerId, entry, req || {});
      if (!model) return failure({ code: 'no-model', status: 0, detail: 'Choose a model for ' + p.short + ' in Settings > AI > Connect an AI', retryAfter: 0 }, key, providerId);
      const base = baseOf(providerId, entry);
      if (!base) return failure({ code: 'bad-request', status: 0, detail: 'No server address is saved for ' + p.short, retryAfter: 0 }, key, providerId);
      const built = providers.chatRequest(providerId, { baseUrl: base, key, model, messages: req.messages, maxTokens: req.maxTokens });
      const res = await send(built.url, { method: 'POST', headers: built.headers, body: JSON.stringify(built.body), signal: ctl.signal, stream: true, timeoutMs: 90000, idleTimeoutMs: 60000 }, key, 'Your AI key: ' + p.short + ' answer');
      if (!res.body) throw { code: 'network', status: res.status, detail: 'The provider sent no answer', retryAfter: 0 };
      const parser = providers.createStreamParser(providerId);
      const decoder = new TextDecoder();
      const usage = { input: 0, output: 0 };
      let text = '';
      const take = (events) => {
        for (const ev of events) {
          if (ev.type === 'delta') { text += ev.text; onEvent({ type: 'delta', text: ev.text }); }
          else if (ev.type === 'usage') { if (Number.isFinite(ev.input) && ev.input > 0) usage.input = ev.input; if (Number.isFinite(ev.output) && ev.output > 0) usage.output = ev.output; }
          else if (ev.type === 'error') throw { code: ev.errorType && /overload|unavailable/i.test(ev.errorType) ? 'overloaded' : 'bad-request', status: 0, detail: scrub(ev.message, key), retryAfter: 0 };
        }
      };
      const reader = res.body.getReader();
      for (;;) {
        let part;
        try { part = await reader.read(); }
        catch (err) {
          if (ctl.signal.aborted) throw Object.assign(new Error('Stopped'), { code: 'stopped' });
          throw { code: 'network', status: 0, detail: scrub((err && err.message) || String(err), key), retryAfter: 0 };
        }
        if (part.done) break;
        take(parser.push(decoder.decode(part.value, { stream: true })));
      }
      take(parser.push(decoder.decode()));
      take(parser.end());
      if (!text) throw { code: 'bad-request', status: res.status, detail: 'The provider answered with no text', retryAfter: 0 };
      return { ok: true, text, usage, model, provider: providerId };
    } catch (err) {
      if (err && err.code === 'stopped') return { ok: false, stopped: true };
      return failure(err, key, providerId);
    } finally {
      running.delete(requestId);
    }
  }

  function cancel(requestId) {
    const ctl = running.get(requestId);
    if (!ctl) return false;
    ctl.abort(new Error('Stopped'));
    return true;
  }

  return { status, setKey, clearKey, setModels, listModels, test, chat, cancel, _scrub: scrub };
}

// The IPC side (policy and schemas live in ipc-policy.js / ipc-schemas.js): Vex's own window only.
//   aikey:status                         the providers, what is saved (never a key), the price estimates
//   aikey:set-key {provider,key,baseUrl} seal a key
//   aikey:clear-key provider             remove it
//   aikey:set-models {provider,models}   default / fast / best model ids
//   aikey:models provider refresh?       the provider's model list
//   aikey:test provider                  a tiny real request: count and time, or the exact error
//   aikey:chat {id,provider,tier,model,messages,maxTokens}   streams 'aikey:event' {id,type,text} to the asking window
//   aikey:cancel id                      Stop
function registerByokIpc({ ipcMain, byok }) {
  ipcMain.handle('aikey:status', () => byok.status());
  ipcMain.handle('aikey:set-key', (_e, req) => byok.setKey(req.provider, req.key, { baseUrl: req.baseUrl }));
  ipcMain.handle('aikey:clear-key', (_e, id) => byok.clearKey(id));
  ipcMain.handle('aikey:set-models', (_e, req) => byok.setModels(req.provider, req.models));
  ipcMain.handle('aikey:models', (_e, id, refresh) => byok.listModels(id, { refresh: refresh === true }));
  ipcMain.handle('aikey:test', (_e, id) => byok.test(id));
  ipcMain.handle('aikey:chat', (event, req) => {
    const sender = event.sender;
    return byok.chat(req.id, req.provider, req, (ev) => { if (!sender.isDestroyed()) sender.send('aikey:event', { id: req.id, ...ev }); });
  });
  ipcMain.handle('aikey:cancel', (_e, id) => byok.cancel(id));
}

module.exports = { createByok, registerByokIpc };
