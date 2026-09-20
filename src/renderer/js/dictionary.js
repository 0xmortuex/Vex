// === Double-click a word, get its meaning ==================================
//
// Reading something above your own vocabulary — a paper, a contract, a page in
// a language you are learning — means leaving the page for a dictionary and
// coming back. Double-clicking a word already selects it, so that is the
// gesture: the word's meaning appears beside it, and the page does not move.
//
// It is off until you switch it on, because a definition popping up every time
// you double-click would be in the way for everyone who does not want it. The
// word goes to the dictionary from the main process (main.js 'dict:lookup'),
// never from the page, so the site is not told which words you did not know.
const Dictionary = {
  SETTING: 'vex.dictOnDblClick',
  MAX_CACHE: 80,
  _cache: new Map(),

  enabled() { try { return localStorage.getItem(this.SETTING) === 'on'; } catch { return false; } },
  setEnabled(on) {
    try { localStorage.setItem(this.SETTING, on ? 'on' : 'off'); } catch {}
    if (!on) this.close();
    return !!on;
  },
  toggle() {
    const on = this.setEnabled(!this.enabled());
    window.showToast?.(on ? 'Double-click a word for its meaning' : 'Double-click definitions are off');
    return on;
  },

  async lookup(word) {
    const key = String(word || '').toLowerCase();
    if (this._cache.has(key)) return this._cache.get(key);
    const res = await window.vex.dictLookup(word);
    // The same word is looked up again and again while reading; a miss is
    // worth remembering too, so a word the dictionary does not have is not
    // asked for twice.
    this._cache.set(key, res);
    if (this._cache.size > this.MAX_CACHE) this._cache.delete(this._cache.keys().next().value);
    return res;
  },

  // Where the card goes: beside the word, but never off the edge of the
  // window. x/y are page coordinates inside the webview.
  place(x, y, rect, card = { w: 320, h: 200 }, view = { w: window.innerWidth, h: window.innerHeight }) {
    let left = (rect.left || 0) + x + 12;
    let top = (rect.top || 0) + y + 16;
    if (left + card.w > view.w - 8) left = Math.max(8, view.w - card.w - 8);
    if (top + card.h > view.h - 8) top = Math.max(8, (rect.top || 0) + y - card.h - 12);
    return { left: Math.round(left), top: Math.round(top) };
  },

  close() { document.querySelector('.vex-dict-card')?.remove(); },

  // One card at a time, and Esc or a click anywhere takes it away.
  _card(at) {
    this.close();
    const card = document.createElement('div');
    card.className = 'vex-dict-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Word meaning');
    card.style.cssText = `position:fixed;left:${at.left}px;top:${at.top}px;z-index:10001;width:320px;max-height:260px;overflow-y:auto;` +
      'background:var(--bg);border:1px solid var(--border);border-radius:10px;box-shadow:0 14px 36px var(--vex-shadow-color,rgba(0,0,0,0.42));padding:11px 13px';
    const close = () => { card.remove(); document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onAway, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    const onAway = (e) => { if (!card.contains(e.target)) close(); };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onAway, true);
    document.body.appendChild(card);
    return card;
  },

  render(card, res, word) {
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    if (!res || !res.ok) {
      card.innerHTML = `<div style="font-size:12.5px;color:var(--text);font-weight:600">${esc(word)}</div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:5px">${esc((res && res.error) || 'The dictionary did not answer')}</div>`;
      return card;
    }
    const rows = res.meanings.map(m => `
      <div style="margin-top:7px">
        <div style="font-size:10.5px;color:var(--text-muted);text-transform:lowercase">${esc(m.part)}</div>
        <div style="font-size:12px;color:var(--text)">${esc(m.def)}</div>
        ${m.example ? `<div style="font-size:11px;color:var(--text-muted);font-style:italic;margin-top:2px">“${esc(m.example)}”</div>` : ''}
      </div>`).join('');
    card.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:7px">
        <div style="font-size:13.5px;font-weight:650;color:var(--text)">${esc(res.word)}</div>
        <div style="font-size:11px;color:var(--text-muted)">${esc(res.phonetic || '')}</div>
      </div>
      ${rows || '<div style="font-size:11.5px;color:var(--text-muted);margin-top:6px">No definition came back.</div>'}`;
    return card;
  },

  async show(word, x, y, webview) {
    const rect = webview && webview.getBoundingClientRect ? webview.getBoundingClientRect() : { left: 0, top: 0 };
    const card = this._card(this.place(x, y, rect));
    card.innerHTML = `<div style="font-size:12px;color:var(--text-muted)">Looking up “${window.escapeHtml(word)}”…</div>`;
    let res;
    try { res = await this.lookup(word); }
    catch (err) { res = { ok: false, error: err.message }; }
    if (!card.isConnected) return null;              // the reader moved on
    return this.render(card, res, word);
  },

  // The guest preload reports a double-clicked word on the webview's own
  // channel; a tab that closes takes its listener with it.
  attach(webview) {
    const on = (webview && webview._lifecycle)
      ? (ev, fn) => webview._lifecycle.listen(webview, ev, fn)
      : (ev, fn) => webview.addEventListener(ev, fn);
    on('ipc-message', (e) => {
      if (e.channel !== 'vex-word' || !this.enabled()) return;
      const data = (e.args && e.args[0]) || {};
      if (!data.word) return;
      this.show(data.word, Number(data.x) || 0, Number(data.y) || 0, webview)
        .catch(err => window.VexProblems?.note('Dictionary', 'Could not look that word up', err));
    });
  },
};

if (typeof window !== 'undefined') window.Dictionary = Dictionary;
if (typeof module !== 'undefined' && module.exports) module.exports = { Dictionary };
