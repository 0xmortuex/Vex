// === Bring your own AI key: the window's side ====================================
//
// The key lives in the main process only (src/main/ai-byok.js, sealed by Windows).
// This file never holds one: Settings sends it in one IPC call and what comes back
// is "saved, ends in ...abcd", the chosen models, and the list of models the
// provider itself offers. Every provider request is made by main and streamed here.
//
//   AIKeys.refresh()               read the status again (the router needs it before its first request)
//   AIKeys.saved()                 the providers that have a key
//   AIKeys.hasAny() / active()     is there one / the one features use ('vex.aiByok.active', else the first saved)
//   AIKeys.source()                'auto' | 'key' | 'worker': what "cloud" means (vex.aiCloudSource)
//   AIKeys.tierFor(feature)        'best' | 'default' | 'fast': which of the chosen models a feature needs
//   AIKeys.chat({...})             one streamed request -> { text, model, usage, provider }
//   AIKeys.explain(error)          the plain sentence for a failure, and the fix to offer
//   AIKeys.session()               this session's tokens and estimated cost
//
// A provider cannot serve some things; the router says so plainly (callByok in ai-router.js).
const AIKeys = (() => {
  const ACTIVE_KEY = 'vex.aiByok.active';
  const SOURCE_KEY = 'vex.aiCloudSource';
  // Which of the chosen models a feature needs: the agent and a question over many tabs get the best one, the
  // jobs nobody watches the fast one, everything else the balanced default.
  const TIER = { agent: 'best', multiTab: 'best', groupTabs: 'fast', historyIndex: 'fast', historySearch: 'fast', digest: 'fast' };

  let _status = null;
  const _models = new Map();              // provider id -> the last list main returned (this session)
  const _session = { calls: 0, tokensIn: 0, tokensOut: 0, money: 0, unknown: 0 };

  const tr = (text) => (typeof window !== 'undefined' && typeof window.vexTr === 'function' ? window.vexTr(text) : text);
  // A sentence with {1} {2} holes, in the person's language: the English text is the key in i18n-ui.js.
  const T = (text, ...args) => tr(text).replace(/\{(\d)\}/g, (_m, i) => (args[Number(i) - 1] == null ? '' : String(args[Number(i) - 1])));

  function bridge() {
    const v = typeof window !== 'undefined' ? window.vex : null;
    if (!v || typeof v.aiKeyStatus !== 'function' || typeof v.aiKeyChat !== 'function') throw new Error('Your own AI key is not available in this build');
    return v;
  }
  function available() { const v = typeof window !== 'undefined' ? window.vex : null; return !!(v && typeof v.aiKeyStatus === 'function'); }
  function changed() { try { document.dispatchEvent(new CustomEvent('vex:ai-keys')); } catch (err) { console.error('[AIKeys] could not announce a change:', err); } }

  async function refresh() {
    _status = await bridge().aiKeyStatus();
    changed();
    return _status;
  }
  function status() { return _status; }
  function providers() { return _status ? _status.providers : []; }
  function provider(id) { return providers().find(p => p.id === id) || null; }
  function saved() { return providers().filter(p => p.saved); }
  function hasAny() { return saved().length > 0; }
  function testMode() { return !!(_status && _status.testHost); }

  function _get(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : v; } catch (err) { throw new Error('Could not read ' + key + ': ' + err.message, { cause: err }); } }
  function active() {
    const list = saved();
    if (!list.length) return '';
    const want = _get(ACTIVE_KEY, '');
    return (list.find(p => p.id === want) || list[0]).id;
  }
  function setActive(id) {
    if (id && !provider(id)) throw new Error('Unknown AI provider');
    localStorage.setItem(ACTIVE_KEY, id || '');
    changed();
  }
  const SOURCES = ['auto', 'key', 'worker'];
  function source() {
    const v = _get(SOURCE_KEY, 'auto');
    if (!SOURCES.includes(v)) throw new Error('Saved cloud source "' + v + '" is not auto, key or worker');
    return v;
  }
  function setSource(v) {
    if (!SOURCES.includes(v)) throw new Error('The cloud source is auto, key or worker');
    localStorage.setItem(SOURCE_KEY, v);
    changed();
  }
  function tierFor(feature) { return TIER[feature] || 'default'; }

  // ---- models ----------------------------------------------------------------------------------------
  // The provider's model list (live, else the known ones with a note), cached by main for the session.
  async function models(id, refreshList) {
    const r = await bridge().aiKeyModels(id, refreshList === true);
    _models.set(id, r);
    return r;
  }
  function cachedModels(id) { return _models.get(id) || null; }
  function prettyModel(id, modelId) {
    if (!modelId) return '';
    const list = (cachedModels(id) || {}).models || [];
    const hit = list.find(m => m.id === modelId);
    return hit && hit.name && hit.name !== modelId ? hit.name : modelId;
  }
  // The model a feature gets from a provider: the one chosen for its tier, else the recommended one once the list is known.
  function modelFor(id, feature) {
    const p = provider(id);
    if (!p) return '';
    const tier = tierFor(feature);
    const rec = cachedModels(id);
    return p.models[tier] || (rec && rec.recommended && rec.recommended[tier]) || '';
  }

  // ---- what a model costs: the built-in ESTIMATE table main sends with the status (src/main/ai-prices.js) ----
  function builtinRate(model) {
    let id = String(model == null ? '' : model).trim().toLowerCase();
    if (!id || !_status || !_status.prices) return null;
    if (id.startsWith('anthropic/')) id = id.slice('anthropic/'.length);
    const rows = _status.prices.rows;
    const exact = rows.find(r => r.model === id);
    if (exact) return exact;
    return rows.filter(r => id.startsWith(r.model + '-') && /^\d{6,}$/.test(id.slice(r.model.length + 1))).sort((a, b) => b.model.length - a.model.length)[0] || null;
  }
  function pricesNote() { return _status && _status.prices ? _status.prices.note : ''; }

  function session() { return { ..._session }; }
  function _record(model, usage) {
    _session.calls++;
    _session.tokensIn += (usage && usage.input) || 0;
    _session.tokensOut += (usage && usage.output) || 0;
    // A price the person wrote in the spend table wins over the built-in estimate (js/ai-spend-money.js).
    const rate = typeof VexAIMoney !== 'undefined' ? VexAIMoney.rateFor(model) : builtinRate(model);
    if (rate && usage && (usage.input || usage.output)) _session.money += ((usage.input || 0) * rate.inPerM + (usage.output || 0) * rate.outPerM) / 1e6;
    else _session.unknown++;
    try { document.dispatchEvent(new CustomEvent('vex:ai-keys-usage')); } catch (err) { console.error('[AIKeys] could not announce usage:', err); }
  }

  // ---- errors in the person's language ----------------------------------------------------------------
  // fix: 'settings' (open Connect an AI), 'retry', 'local' (use the local model), or '' (nothing to do but wait).
  function explain(info) {
    const e = info || {};
    const p = provider(e.provider);
    const who = p ? p.short : T('The provider');
    let text, fix = '';
    switch (e.code) {
      case 'invalid-key': text = T('{1} did not accept your API key. It may be wrong, revoked or from another account. Paste a new one in Settings.', who); fix = 'settings'; break;
      case 'rate-limit': text = e.retryAfter ? T('{1} says you are sending too many requests. Try again in {2} seconds.', who, Math.ceil(e.retryAfter)) : T('{1} says you are sending too many requests. Wait a moment and try again.', who); fix = 'retry'; break;
      case 'quota': text = T('{1} says your credit or quota is used up. Add credit at the provider, then try again.', who); fix = 'settings'; break;
      case 'model': text = T('{1} does not offer the chosen model to your key. Pick another model in Settings.', who); fix = 'settings'; break;
      case 'overloaded': text = T('{1} is busy or down right now (error {2}). Try again in a moment.', who, e.status || ''); fix = 'retry'; break;
      case 'network': text = T('Vex could not reach {1}. Check your internet connection.', who); fix = 'retry'; break;
      case 'no-key': text = T('No key is saved for {1}. Add one in Settings.', who); fix = 'settings'; break;
      case 'no-model': text = T('No model is chosen for {1}. Pick one in Settings.', who); fix = 'settings'; break;
      default: text = T('{1} refused the request.', who); fix = 'retry';
    }
    if (e.detail) text += ' ' + T('It said: {1}', String(e.detail).slice(0, 300));
    return { text, fix, code: e.code || '', provider: e.provider || '', retryAfter: e.retryAfter || 0 };
  }
  function makeError(info) {
    const x = explain(info);
    const err = new Error(x.text);
    err.byok = x;
    err.code = 'vex-byok';
    return err;
  }

  // ---- chat ---------------------------------------------------------------------------------------------
  const _handlers = new Map();
  let _listening = false;
  let _seq = 0;
  function listen(v) {
    if (_listening) return;
    if (typeof v.onAiKeyEvent !== 'function') throw new Error('Your own AI key is not available in this build');
    v.onAiKeyEvent((ev) => { const h = _handlers.get(ev && ev.id); if (h) h(ev); });
    _listening = true;
  }

  // -> { text, model, usage, provider }. Throws an Error carrying .byok for a provider failure, 'Stopped' when aborted.
  async function chat({ provider: id, feature, messages, maxTokens, signal, onToken, model }) {
    const v = bridge();
    listen(v);
    if (signal && signal.aborted) throw new Error('Stopped');
    const reqId = 'k' + (++_seq) + '-' + Math.random().toString(36).slice(2, 8);
    let full = '';
    _handlers.set(reqId, (ev) => {
      if (ev.type !== 'delta') return;
      full += ev.text;
      if (typeof onToken === 'function') { try { onToken(ev.text, full); } catch (err) { console.error('[AIKeys] a streaming listener failed:', err); } }
    });
    const onAbort = () => { v.aiKeyCancel(reqId).catch(err => console.error('[AIKeys] could not stop the request:', err)); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await v.aiKeyChat({ id: reqId, provider: id, tier: tierFor(feature), model: model || undefined, messages, maxTokens });
      if (res && res.stopped) throw new Error('Stopped');
      if (!res || !res.ok) throw makeError(res && res.error ? res.error : { code: 'bad-request', provider: id, detail: 'No answer came back' });
      _record(res.model, res.usage);
      return { text: res.text, model: res.model, usage: res.usage, provider: id };
    } finally {
      _handlers.delete(reqId);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  return { refresh, status, providers, provider, saved, hasAny, active, setActive, source, setSource, tierFor, available, testMode, models, cachedModels, prettyModel, modelFor, builtinRate, pricesNote, session, explain, makeError, chat, T, SOURCES };
})();

if (typeof window !== 'undefined') window.AIKeys = AIKeys;
if (typeof module !== 'undefined' && module.exports) module.exports = { AIKeys };
