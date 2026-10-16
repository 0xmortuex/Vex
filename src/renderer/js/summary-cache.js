// === Summary cache by content hash (T3-087) ===================================
//
// Summarising the same page twice costs the same twice: the same minutes of a local model, or the
// same cloud call. This keeps a finished summary under a key made of the page address, a hash of
// the page TEXT, the persona and the model, so opening the summary again is instant, and a page that
// has changed since is summarised again (and says so).
//
//   VexSummaryCache.wrap()              put the cache in front of AIRouter.callAI (once)
//   VexSummaryCache.key(request)        -> Promise<{ url, hash, key }> for a summarize request
//   VexSummaryCache.lookup(request)     -> { hit, stale, entry }
//   VexSummaryCache.store(request, out) keep an answer
//   VexSummaryCache.clear()
//
// What is NOT cached, ever: a request the sensitivity gate (js/ai-sensitivity.js) has an opinion
// about (history, mail, bank and health pages, vault, private tabs, secrets), any private window or
// tab, a selection summary, and an answer that is empty. The cache holds summaries of ordinary pages
// on this computer only (vex.summaryCache); it never leaves the device and is not synced.
// A hit is shown as "from the cache" and a changed page as "the page changed since the last summary".

const VexSummaryCache = {
  KEY: 'vex.summaryCache',
  ENABLED_KEY: 'vex.summaryCache.enabled',
  MAX_ENTRIES: 40,
  MAX_BYTES: 600 * 1024,           // all entries together
  MAX_AGE_MS: 30 * 24 * 3600 * 1000,
  MAX_TEXT: 400000,                // characters of page text hashed

  enabled() { try { return localStorage.getItem(this.ENABLED_KEY) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.ENABLED_KEY, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    return !!on;
  },

  _now() { return Date.now(); },

  _read() {
    const raw = localStorage.getItem(this.KEY);
    if (raw == null) return [];
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The summary cache is not readable: ' + err.message); }
    return Array.isArray(v) ? v.filter(e => e && typeof e.key === 'string' && typeof e.url === 'string' && e.answer && typeof e.answer.result === 'string') : [];
  },
  _write(list) {
    // Oldest out first until both limits hold.
    let kept = list.slice(0, this.MAX_ENTRIES);
    while (kept.length > 1 && JSON.stringify(kept).length > this.MAX_BYTES) kept = kept.slice(0, kept.length - 1);
    try { localStorage.setItem(this.KEY, JSON.stringify(kept)); }
    catch (err) { throw new Error('The summary could not be kept in the cache: ' + err.message); }
    return kept;
  },

  async _sha256(text) {
    const subtle = (typeof crypto !== 'undefined' && crypto.subtle) || null;
    if (!subtle) throw new Error('This window cannot compute a content hash (no Web Crypto)');
    const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  // Only a plain page summary is cacheable. -> the reason it is not, or ''.
  refusal(feature, request) {
    if (feature !== 'summarize') return 'not a summary';
    const req = request && typeof request === 'object' ? request : null;
    const page = req && req.pageContext;
    if (!page || typeof page.url !== 'string' || !/^https?:\/\//i.test(page.url)) return 'no web page';
    if (req.selectedText || req.image || req.dataClass) return 'a selection, an image or a classified request';
    if (req.private === true || page.private === true || page.incognito === true) return 'a private tab';
    if (typeof window !== 'undefined' && window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return 'a private window';
    if (typeof VexSensitivity === 'undefined') return 'the sensitivity gate is not loaded';
    if (VexSensitivity.classify(feature, req).classes.length) return 'the sensitivity gate has an opinion about it';
    if (this._text(page).length < 40) return 'too little text';
    return '';
  },

  _text(page) {
    const t = page.text != null ? page.text : (page.content != null ? page.content : page.body);
    return String(t == null ? '' : t).slice(0, this.MAX_TEXT);
  },

  _model() {
    try {
      if (typeof AIRouter === 'undefined') return '';
      const s = AIRouter.getOllamaStatus();
      return (s.forceCloud ? 'cloud' : s.preferLocal ? 'local:' + s.model : 'auto:' + s.model);
    } catch (err) { throw new Error('Could not tell which AI is set up: ' + err.message, { cause: err }); }
  },

  async key(request) {
    const page = request.pageContext;
    const hash = await this._sha256(this._text(page));
    const persona = request.persona && request.persona.id ? String(request.persona.id) : '';
    const url = String(page.url).replace(/#.*$/, '');
    const key = await this._sha256([url, hash, 'summarize', persona, String(request.targetLanguage || ''), this._model()].join('\u0001'));
    return { url, hash, key };
  },

  // -> { hit, stale, entry }. stale: the page was summarised before but its text is not the same now.
  async lookup(request) {
    const k = await this.key(request);
    const list = this._read();
    const now = this._now();
    const hit = list.find(e => e.key === k.key && now - e.at <= this.MAX_AGE_MS);
    if (hit) return { hit: true, stale: false, entry: hit, k };
    const older = list.find(e => e.url === k.url && e.hash !== k.hash);
    return { hit: false, stale: !!older, entry: older || null, k };
  },

  async store(request, answer) {
    if (!answer || typeof answer.result !== 'string' || !answer.result.trim()) return false;
    const k = await this.key(request);
    const list = this._read().filter(e => e.key !== k.key && !(e.url === k.url && e.hash !== k.hash));
    list.unshift({ key: k.key, url: k.url, hash: k.hash, at: this._now(), answer: { result: answer.result, backend: answer.backend || '', model: answer.model || '' } });
    this._write(list);
    return true;
  },

  clear() {
    try { localStorage.removeItem(this.KEY); }
    catch (err) { throw new Error('Could not clear the summary cache: ' + err.message); }
  },
  count() { return this._read().length; },

  _say(text) {
    if (typeof VexAttention !== 'undefined') VexAttention.notify({ feature: 'summary-cache', urgency: 'asked', id: 'note' }, () => window.showToast?.(text, 'info', 5000));
    else if (typeof window !== 'undefined') window.showToast?.(text, 'info', 5000);
  },

  // callAI is wrapped, not edited: every caller goes through the exported object.
  wrap() {
    if (typeof AIRouter === 'undefined') throw new Error('The AI router is not loaded');
    if (AIRouter.__summaryCacheWrapped) return false;
    const original = AIRouter.callAI.bind(AIRouter);
    const self = this;
    AIRouter.callAI = async (feature, request) => {
      if (!self.enabled() || self.refusal(feature, request)) return original(feature, request);
      const look = await self.lookup(request);
      if (look.hit) {
        self._say('Summary from the cache: this page has not changed since ' + new Date(look.entry.at).toLocaleString());
        return { ...look.entry.answer, cached: true, cachedAt: look.entry.at };
      }
      const out = await original(feature, request);
      try { await self.store(request, out); }
      catch (err) { if (typeof VexProblems !== 'undefined') VexProblems.note('Summary cache', 'Could not keep a summary', err); else throw err; }
      if (look.stale && out && typeof out === 'object') {
        self._say('This page changed since you last summarised it, so it was summarised again.');
        return { ...out, pageChanged: true };
      }
      return out;
    };
    AIRouter.__summaryCacheWrapped = true;
    return true;
  },

  init() {
    if (this._wired) return false;
    this._wired = true;
    if (typeof AIRouter !== 'undefined') this.wrap();
    return true;
  },

  group(host) {
    const el = document.createElement('div');
    host.appendChild(el);
    el.appendChild(VexSettingsGroups.note('Keeps a finished page summary on this computer, keyed by the page text, so asking again is instant and costs nothing. A page that changed is summarised again. Pages the privacy gate cares about (mail, banks, vaults, private tabs) are never kept.'));
    const row = document.createElement('div');
    row.className = 'setting-toggle-row';
    const lab = document.createElement('label');
    lab.textContent = 'Remember page summaries';
    const box = document.createElement('input');
    box.type = 'checkbox'; box.id = 'summary-cache-on'; box.checked = this.enabled();
    lab.htmlFor = box.id;
    box.addEventListener('change', () => { try { this.setEnabled(box.checked); } catch (err) { window.showToast?.(err.message, 'error'); box.checked = this.enabled(); } });
    row.append(lab, box);
    el.appendChild(row);
    let n = 0;
    try { n = this.count(); } catch (err) { el.appendChild(VexSettingsGroups.note(err.message)); }
    el.appendChild(VexSettingsGroups.note(n + ' summar' + (n === 1 ? 'y' : 'ies') + ' kept.'));
    el.appendChild(VexSettingsGroups.button('Clear the summary cache', () => {
      try { this.clear(); window.showToast?.('Summary cache cleared'); } catch (err) { window.showToast?.(err.message, 'error'); }
    }));
  },
};

if (typeof window !== 'undefined') {
  window.VexSummaryCache = VexSummaryCache;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'summary-cache', title: 'Summary cache', keywords: 'summary summarize cache hash ai cost instant page changed', before: 'about', build: (el) => VexSummaryCache.group(el) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSummaryCache };
