// === Vex Phase 14: Ollama API wrapper ===
// Talks to a local Ollama server at http://localhost:11434.

const Ollama = (() => {
  const DEFAULT_URL = 'http://localhost:11434';
  let baseUrl = DEFAULT_URL;

  function setBaseUrl(url) {
    baseUrl = String(url || DEFAULT_URL).replace(/\/$/, '');
  }

  function getBaseUrl() { return baseUrl; }

  async function ping() {
    let t;
    try {
      const ctl = new AbortController();
      t = setTimeout(() => ctl.abort(), 2000);
      const r = await (window.VexNet?.fetch || fetch)(`${baseUrl}/api/tags`, { method: 'GET', signal: ctl.signal });
      clearTimeout(t);
      return r.ok;
    } catch { return false; } finally { clearTimeout(t); }
  }

  async function listModels() {
    try {
      const r = await (window.VexNet?.fetch || fetch)(`${baseUrl}/api/tags`);
      if (!r.ok) return [];
      const data = await r.json();
      return (data.models || []).map(m => ({
        name: m.name,
        size: m.size,
        modifiedAt: m.modified_at,
        sizeFormatted: formatBytes(m.size)
      }));
    } catch { return []; }
  }

  const GEN_TIMEOUT_MS = 120000;
  // A model that is not in memory yet is loaded by the request itself, and
  // nothing comes back until it is. On a busy machine that took longer than
  // the two-minute limit, and the user got "did not answer within 120s (may
  // still be loading)" instead of the answer (found 2026-10-09). A request
  // that starts a load waits this long for its first answer instead.
  const LOAD_TIMEOUT_MS = 10 * 60 * 1000;

  // Before a long request: is Ollama there, is the model installed, is it in
  // memory? Two quick reads of Ollama's own API (/api/tags, /api/ps), so a dead
  // Ollama or a missing model is said at once rather than after a two-minute
  // wait. A model found in memory is remembered for a short while, so a chat
  // does not pay for two extra calls on every message.
  const HEALTH_TIMEOUT_MS = 3000;
  const HEALTH_TTL_MS = 20000;
  let _readyCache = null; // { key, at }
  const _sameModel = (name, model) => name === model || name === model + ':latest';
  const shortName = (model) => String(model || '').replace(/:latest$/, '');

  async function _quickGet(path) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(new Error('timeout')), HEALTH_TIMEOUT_MS);
    try {
      return await (window.VexNet?.fetch || fetch)(`${baseUrl}${path}`, { method: 'GET', signal: ctl.signal, timeoutMs: HEALTH_TIMEOUT_MS });
    } finally { clearTimeout(t); }
  }

  // → { loaded: true|false|null } (null: this Ollama cannot say), or throws the
  // sentence to show.
  async function ready(model) {
    const key = baseUrl + '|' + model;
    if (_readyCache && _readyCache.key === key && Date.now() - _readyCache.at < HEALTH_TTL_MS) return { loaded: true };
    let tags;
    try {
      const r = await _quickGet('/api/tags');
      if (!r.ok) throw new Error('Ollama returned ' + r.status);
      tags = await r.json();
    } catch (err) {
      console.warn('[Ollama] health check failed:', err && err.message);
      throw new Error('Ollama is not running. Start Ollama, or switch to cloud AI.');
    }
    const installed = (tags && Array.isArray(tags.models) ? tags.models : []).map(m => m.name || m.model);
    if (!installed.some(n => _sameModel(n, model))) {
      throw new Error(`The model "${model}" is not installed in Ollama. Pick another one in Settings › AI, or run: ollama pull ${model}`);
    }
    let loaded = null;
    try {
      const r = await _quickGet('/api/ps');
      if (!r.ok) throw new Error('Ollama returned ' + r.status);
      const ps = await r.json();
      loaded = (ps && Array.isArray(ps.models) ? ps.models : []).some(m => _sameModel(m.name || m.model, model));
    } catch (err) {
      // An older Ollama has no /api/ps: it cannot say, and the request runs
      // with the normal limit.
      console.warn('[Ollama] could not read which models are loaded:', err && err.message);
    }
    _readyCache = loaded ? { key, at: Date.now() } : null;
    return { loaded };
  }

  // The check, when the caller asked for it (the AI router does for every
  // request), and the deadline that follows from it.
  async function _prepare(model, options) {
    if (!options.checkFirst) return GEN_TIMEOUT_MS;
    const { loaded } = await ready(model);
    if (loaded !== false) return GEN_TIMEOUT_MS;
    if (typeof options.onLoading === 'function') { try { options.onLoading(model); } catch (err) { console.error('[Ollama] onLoading failed:', err); } }
    return LOAD_TIMEOUT_MS;
  }

  function _timeoutText(model, timeoutMs) {
    if (timeoutMs >= LOAD_TIMEOUT_MS) return `${shortName(model)} did not finish loading within ${Math.round(timeoutMs / 60000)} minutes. Restart Ollama, or pick a smaller model in Settings › AI.`;
    return `Ollama did not answer within ${Math.round(timeoutMs / 1000)}s (model "${model}" may still be loading).`;
  }

  // `timeoutMs` is honoured only by VexNet's bounded fetch. When that shim is
  // absent the option is silently ignored by plain fetch, and a model that
  // stalls mid-generation hangs the caller forever. Carry a real AbortController
  // deadline as well so the bound holds either way.
  async function _post(path, body, signal, timeoutMs = GEN_TIMEOUT_MS) {
    const ctl = new AbortController();
    const onOuterAbort = () => ctl.abort(signal.reason || new Error('Cancelled'));
    if (signal) {
      if (signal.aborted) ctl.abort(signal.reason || new Error('Cancelled'));
      else signal.addEventListener('abort', onOuterAbort, { once: true });
    }
    const timer = setTimeout(() => ctl.abort(new Error('timeout')), timeoutMs);
    try {
      return await (window.VexNet?.fetch || fetch)(`${baseUrl}${path}`, {
        timeoutMs, signal: ctl.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (err) {
      if (ctl.signal.aborted && !(signal && signal.aborted)) {
        throw new Error(_timeoutText(body.model, timeoutMs));
      }
      throw err;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onOuterAbort);
    }
  }

  // Stream a generation, token by token.
  //
  // Ollama streams NDJSON when `stream: true`: one JSON object per line, each
  // carrying the next fragment. Without this the whole answer lands at once,
  // which on a local model means a long stare at a spinner — and there is no way
  // to show a reasoning model's thinking as it happens.
  //
  // `onToken(fragment, full)` is called per fragment. The accumulated text is
  // returned, so a caller that ignores onToken gets exactly what the
  // non-streaming call would have produced.
  async function _stream(path, body, options, pick, firstTimeoutMs = GEN_TIMEOUT_MS) {
    const { onToken, signal } = options;
    const ctl = new AbortController();
    const onOuterAbort = () => ctl.abort((signal && signal.reason) || new Error('Cancelled'));
    if (signal) {
      if (signal.aborted) ctl.abort(signal.reason || new Error('Cancelled'));
      else signal.addEventListener('abort', onOuterAbort, { once: true });
    }
    // A stalled stream must still end. The deadline is refreshed by traffic, so
    // a slow-but-alive model is not cut off mid-answer.
    // The first answer of a request that loads the model gets the loading
    // allowance; after that, traffic refreshes the normal limit.
    let timer = null;
    const arm = (ms = GEN_TIMEOUT_MS) => {
      clearTimeout(timer);
      timer = setTimeout(() => ctl.abort(new Error('timeout')), ms);
    };
    arm(firstTimeoutMs);

    let r;
    try {
      r = await (window.VexNet?.fetch || fetch)(`${baseUrl}${path}`, {
        stream: true, timeoutMs: firstTimeoutMs === GEN_TIMEOUT_MS ? GEN_TIMEOUT_MS : firstTimeoutMs + GEN_TIMEOUT_MS, maxBytes: 16 * 1024 * 1024, signal: ctl.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, stream: true }),
      });
    } catch (err) {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onOuterAbort);
      if (ctl.signal.aborted && !(signal && signal.aborted)) {
        throw new Error(_timeoutText(body.model, firstTimeoutMs));
      }
      throw err;
    }
    if (!r.ok) { clearTimeout(timer); throw new Error(await _errorText(r, body.model)); }
    // No readable body (a shim that buffers, or a proxy that does): fall back to
    // reading it whole rather than failing.
    if (!r.body || typeof r.body.getReader !== 'function') {
      clearTimeout(timer);
      const text = await r.text();
      let full = '';
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try { full += pick(JSON.parse(line)) || ''; } catch {}
      }
      if (full && onToken) onToken(full, full);
      return full;
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    let thinking = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        arm();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let event;
          try { event = JSON.parse(line); } catch { continue; }
          if (event.error) throw new Error(_crashText(String(event.error), body.model) || event.error);
          // The last line of a stream carries the counts and timings; without
          // this a streamed call reported none of them.
          if (event.done && typeof options.onMeta === 'function') {
            try { options.onMeta({ promptTokens: event.prompt_eval_count || 0, replyTokens: event.eval_count || 0, totalMs: Math.round((event.total_duration || 0) / 1e6), loadMs: Math.round((event.load_duration || 0) / 1e6) }); } catch {}
          }
          // A reasoning model asked to think sends its thoughts in their own
          // field, ahead of the answer — /api/chat in message.thinking,
          // /api/generate at the top level. They used to be dropped here.
          const thought = (event.message && event.message.thinking) || event.thinking;
          if (thought) {
            thinking += thought;
            if (typeof options.onThinking === 'function') { try { options.onThinking(thought, thinking); } catch {} }
          }
          const piece = pick(event);
          if (piece) {
            full += piece;
            if (onToken) { try { onToken(piece, full); } catch {} }
          }
        }
      }
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onOuterAbort);
      await reader.cancel().catch(() => {});
      try { reader.releaseLock(); } catch {}
    }
    // Only thoughts and no answer is still a failure — say it as one.
    if (!full.trim() && thinking) {
      throw new Error(`${body.model} only produced reasoning and no answer — try again, or turn off Show thinking`);
    }
    return full;
  }

  // How long a model stays in video memory after its last reply. Ollama's own
  // default is five minutes, during which ~5.5 GB of an 8 GB card is held —
  // start a game in that window and it fights the model for VRAM. Vex's
  // default is one minute: a question after a pause reloads the model (a few
  // seconds), a game started after a chat gets the card back quickly.
  // Settings › Privacy Hardening › Gaming and streaming changes it; 0 unloads after every reply.
  const KEEP_ALIVE_KEY = 'vex.ai.keepAlive';
  const KEEP_ALIVE_CHOICES = ['0', '1m', '5m', '15m'];
  function keepAlive() {
    let v = '1m';
    try { v = localStorage.getItem(KEEP_ALIVE_KEY) || '1m'; } catch {}
    if (!KEEP_ALIVE_CHOICES.includes(v)) v = '1m';
    // A question asked DURING a game still loads the model; with "free the
    // graphics card" on, it goes again the moment it has answered.
    try {
      const gm = (typeof window !== 'undefined') ? window.GameMode : null;
      if (gm && gm.gaming && typeof gm.gamingSetting === 'function' && gm.gamingSetting('freeGpu')) return 0;
    } catch { /* no game mode: the setting stands */ }
    return v === '0' ? 0 : v;
  }
  function setKeepAlive(v) {
    const s = String(v);
    if (!KEEP_ALIVE_CHOICES.includes(s)) throw new Error('Keep-loaded time must be one of ' + KEEP_ALIVE_CHOICES.join(', '));
    try { localStorage.setItem(KEEP_ALIVE_KEY, s); } catch {}
    return keepAlive();
  }

  async function generate(model, prompt, options = {}) {
    const { systemPrompt, temperature = 0.5, maxTokens = 2000, format = null } = options;
    const body = {
      model, prompt, stream: false, keep_alive: keepAlive(),
      options: { temperature, num_predict: maxTokens }
    };
    if (systemPrompt) body.system = systemPrompt;
    if (format === 'json') _asJson(body, options.think);
    else if (options.think) body.think = true;

    const timeoutMs = await _prepare(model, options);
    if (options.onToken || options.onThinking) return _notEmpty(await _stream('/api/generate', body, options, (e) => e.response, timeoutMs), model, null);
    const r = await _post('/api/generate', body, options.signal, timeoutMs);
    if (!r.ok) throw new Error(await _errorText(r, model));
    const data = await r.json();
    return _notEmpty(data.response || '', model, data);
  }

  // A JSON reply from a reasoning model (qwen3, deepseek-r1…): Ollama puts the
  // model's thoughts in a separate `thinking` field, and with format:'json' the
  // model spent its whole turn there and returned an EMPTY response — measured
  // on qwen3.5: 1,700 chars of thinking, 0 of answer. Every structured feature
  // then failed as "malformed response". think:false makes it answer directly;
  // a model without thinking accepts the flag and ignores it.
  //
  // Unless the user has asked to watch it think (Show thinking): measured on
  // Ollama 0.34 with qwen3.5, think:true + format:'json' returned a valid JSON
  // answer 6 times out of 6, the thoughts arriving separately in `thinking` —
  // the empty-answer failure above did not recur. It costs time, not answers:
  // ~3 s a reply without thinking, 16–39 s with it. Hence a switch, off.
  function _asJson(body, think) {
    body.format = 'json';
    body.think = !!think;
  }

  // An empty reply is a failure to say so here, not an empty string for a
  // caller to mis-parse three layers up.
  function _notEmpty(text, model, data) {
    if (String(text || '').trim()) return text;
    const thought = data && (data.thinking || (data.message && data.message.thinking));
    throw new Error(thought
      ? `${model} only produced reasoning and no answer — try again, or pick another local model in Settings › AI`
      : `${model} returned an empty reply`);
  }

  async function chat(model, messages, options = {}) {
    const { temperature = 0.5, maxTokens = 2000, format = null, numCtx = null } = options;
    const body = {
      model, messages, stream: false, keep_alive: keepAlive(),
      options: { temperature, num_predict: maxTokens }
    };
    // Ollama's default context window (4,096 tokens) silently drops the START
    // of a longer prompt — the system prompt. The agent asks for room.
    if (Number.isFinite(numCtx) && numCtx > 0) body.options.num_ctx = numCtx;
    if (format === 'json') _asJson(body, options.think);
    else if (options.think) body.think = true;
    const timeoutMs = await _prepare(model, options);
    if (options.onToken || options.onThinking) return _notEmpty(await _stream('/api/chat', body, options, (e) => e.message && e.message.content, timeoutMs), model, null);
    const r = await _post('/api/chat', body, options.signal, timeoutMs);
    if (!r.ok) throw new Error(await _errorText(r, model));
    const data = await r.json();
    // What the call cost: prompt and reply sizes in tokens, and how long each
    // took. Settings › AI "Test as agent" reports these.
    if (typeof options.onMeta === 'function') {
      options.onMeta({ promptTokens: data.prompt_eval_count || 0, replyTokens: data.eval_count || 0, totalMs: Math.round((data.total_duration || 0) / 1e6), loadMs: Math.round((data.load_duration || 0) / 1e6) });
    }
    return _notEmpty(data.message?.content || '', model, data);
  }

  // What Ollama knows about one model: capabilities (['completion','vision',
  // 'tools','thinking']), the context length it was trained for, its family.
  async function show(model) {
    const r = await _post('/api/show', { model }, null, 8000);
    if (!r.ok) throw new Error(await _errorText(r, model));
    const data = await r.json();
    const info = data.model_info || {};
    const ctxKey = Object.keys(info).find(k => k.endsWith('.context_length'));
    return { capabilities: Array.isArray(data.capabilities) ? data.capabilities : [], contextLength: ctxKey ? Number(info[ctxKey]) : null, family: (data.details && data.details.family) || '', parameterSize: (data.details && data.details.parameter_size) || '' };
  }

  // Which models are loaded in memory right now, and where they are running.
  // A model that is not loaded costs seconds to load; one that has been pushed
  // out of video memory by a game runs on the processor at a crawl, and that
  // is indistinguishable from "the AI is broken" without asking.
  async function running() {
    const r = await (window.VexNet?.fetch || fetch)(`${baseUrl}/api/ps`);
    if (!r.ok) throw new Error(await _errorText(r, ''));
    const data = await r.json();
    return (data.models || []).map(m => ({
      name: m.name || m.model,
      sizeMB: Math.round((m.size || 0) / (1024 * 1024)),
      vramMB: Math.round((m.size_vram || 0) / (1024 * 1024)),
      // The share on the graphics card, as Ollama's own "84% GPU". onGpu used
      // to need 90%, so a model 84% on the card — answering in 5-20 s — was
      // reported as "running on the processor, expect minutes" (found
      // 2026-09-29). Now it means what it says: most of it is on the card.
      gpuPercent: m.size ? Math.round(Math.min(1, (m.size_vram || 0) / m.size) * 100) : 0,
      onGpu: (m.size_vram || 0) >= (m.size || 0) * 0.5,
      expiresAt: m.expires_at || null,
      contextLength: m.context_length || null,
    }));
  }

  // Hand the video memory back now, without stopping Ollama: a zero keep-alive
  // unloads the model. About 5.5 GB here, which is the difference between a
  // game running well and not.
  async function unload(model) {
    const r = await _post('/api/generate', { model, prompt: '', keep_alive: 0 }, null, 15000);
    if (!r.ok) throw new Error(await _errorText(r, model));
    return true;
  }

  // Remove a model from disk entirely (Settings › AI › the model manager).
  async function deleteModel(model) {
    const r = await (window.VexNet?.fetch || fetch)(`${baseUrl}/api/delete`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }), timeoutMs: 15000,
    });
    if (!r.ok) throw new Error(await _errorText(r, model));
    return true;
  }

  // Ollama answers 404 with {"error":"model \"x\" not found, try pulling it"}.
  // "Ollama returned 404" told the user nothing actionable.
  async function _errorText(r, model) {
    let detail = '';
    try { const j = await r.json(); detail = (j && j.error) ? String(j.error) : ''; } catch {}
    if (r.status === 404 && !detail) detail = `model "${model}" is not installed — run: ollama pull ${model}`;
    const crash = _crashText(detail, model);
    if (crash) return crash;
    return detail ? `Ollama: ${detail}` : `Ollama returned ${r.status}`;
  }

  // "llama-server process has terminated: exit status 1" is Ollama's word for
  // the model's own process dying, usually while loading because the graphics
  // card or the memory is full (a game running). It was shown as is (found
  // 2026-10-09). Older Ollama says "llama runner process has terminated".
  function _crashText(detail, model) {
    if (!/(llama-server|llama runner) process has terminated|llama-server process no longer running/i.test(detail || '')) return null;
    _readyCache = null;
    return `${model ? shortName(model) : 'The model'} crashed in Ollama (its process stopped). This usually means the graphics card or the computer ran out of memory, for example because a game is running. Close what is using the memory, or pick a smaller model in Settings › AI, then try again.`;
  }

  async function pullModel(modelName, onProgress, signal) {
    const r = await (window.VexNet?.fetch || fetch)(`${baseUrl}/api/pull`, {
      stream: true, timeoutMs: 30 * 60 * 1000, maxBytes: 32 * 1024 * 1024, signal,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName, stream: true })
    });
    if (!r.ok) throw new Error(`Failed to pull model: ${r.status}`);
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try { while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (onProgress) onProgress(event);
          if (event.error) throw new Error(event.error);
        } catch (err) {
          if (err.message && !/JSON/i.test(err.message)) throw err;
        }
      }
    } } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }

  function formatBytes(bytes) {
    if (!bytes) return '—';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  return { setBaseUrl, getBaseUrl, ping, ready, listModels, generate, chat, show, running, unload, deleteModel, pullModel, keepAlive, setKeepAlive, KEEP_ALIVE_CHOICES };
})();

if (typeof window !== 'undefined') window.Ollama = Ollama;
if (typeof module !== 'undefined' && module.exports) module.exports = { Ollama };
