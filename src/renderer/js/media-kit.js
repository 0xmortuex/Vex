// === Small shared helpers for the Wave 3 games-and-media features =============
//
// The ten features in this group (patch digest, status check, panel guard,
// network courtesy, video watch-later, reset timers, content board, drops desk,
// writing desk, site push bundling) all keep a little JSON in localStorage, draw
// a small dialog, and ask the same two questions: "is a game running?" and
// "which tab is in front?". This is the one place for those, so each module is
// only its own idea.
//
// Rules the helpers keep:
//   - a saved value that cannot be read throws with the key's name; it is never
//     replaced by an empty one without a word (read() has a fallback only for a
//     key that was never written);
//   - nothing here touches a game: gaming() looks at Vex's own Game mode state
//     (which comes from process names, js/game-session.js), nothing else.
const VexMediaKit = {
  _now() { return Date.now(); },

  // ---- storage ---------------------------------------------------------------
  read(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    try { const v = JSON.parse(raw); return v == null ? fallback : v; }
    catch (err) { throw new Error('The saved "' + key + '" is not readable', { cause: err }); }
  },
  write(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
  flag(key, def) {
    const v = localStorage.getItem(key);
    return v === null ? !!def : v === '1';
  },
  setFlag(key, on) { localStorage.setItem(key, on ? '1' : '0'); },
  uid(prefix) { return String(prefix || 'x') + this._now().toString(36) + Math.random().toString(36).slice(2, 6); },

  // ---- state of the moment ---------------------------------------------------------
  gaming() {
    return (typeof GameMode !== 'undefined' && !!GameMode.gaming) || (typeof GameSession !== 'undefined' && !!GameSession.active);
  },
  // Is this a bad moment to speak up unasked? (a game, a meeting, Focus, quiet hours...)
  quiet() {
    if (this.gaming()) return true;
    return typeof AttentionState !== 'undefined' && !!AttentionState.get().quiet;
  },
  problem(area, what, err) {
    console.error('[' + area + '] ' + what + ':', err);
    if (typeof VexProblems !== 'undefined') VexProblems.note(area, what, err);
  },
  toast(text, kind = 'info', ms = 4000, opts) { if (window.showToast) window.showToast(text, kind, ms, opts); },
  fail(err) { this.toast((err && err.message) || String(err), 'error', 6000); },

  // The page in front: { url, title, wv }. Throws when there is none to read.
  activePage() {
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not available in this window');
    const tab = TabManager.getActiveTab ? TabManager.getActiveTab() : null;
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(TabManager.activeTabId) : null;
    let url = '';
    try { url = (wv && wv.getURL && wv.getURL()) || (tab && tab.url) || ''; } catch { url = (tab && tab.url) || ''; }
    if (!/^https?:/i.test(url)) throw new Error('Open a web page first');
    return { url, title: (tab && tab.title) || '', wv };
  },
  // Only http(s); returns the normalised address or throws.
  webUrl(text) {
    let u;
    try { u = new URL(String(text == null ? '' : text).trim()); } catch (err) { throw new Error('That is not a web address', { cause: err }); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only a web address (https://...) is accepted');
    if (u.username || u.password) throw new Error('Do not put a user name or password in the address');
    return u.href;
  },

  // ---- time -------------------------------------------------------------------
  // "3 d 4 h", "2 h 10 min", "40 min", "now" for a span in ms.
  span(ms) {
    const m = Math.floor(Math.abs(ms) / 60000);
    if (m < 1) return 'under a minute';
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), r = m % 60;
    if (d) return d + ' d' + (h ? ' ' + h + ' h' : '');
    if (h) return h + ' h' + (r ? ' ' + r + ' min' : '');
    return r + ' min';
  },
  // 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM' (on the local clock, or UTC when utc is true) -> ms, or throws.
  parseLocal(text, utc = false) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(String(text == null ? '' : text).trim());
    if (!m) throw new Error('Write the day as YYYY-MM-DD, with an optional time like 2026-11-02 18:00');
    const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] || 0), Number(m[5] || 0)];
    const date = utc ? new Date(Date.UTC(y, mo - 1, d, h, mi, 0, 0)) : new Date(y, mo - 1, d, h, mi, 0, 0);
    const [gy, gm, gd] = utc ? [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()] : [date.getFullYear(), date.getMonth(), date.getDate()];
    if (gy !== y || gm !== mo - 1 || gd !== d || h > 23 || mi > 59) throw new Error('"' + text + '" is not a real date');
    return date.getTime();
  },
  fmtLocal(ms) {
    const d = new Date(ms), p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  },

  // ---- drawing -----------------------------------------------------------------
  el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  },
  button(text, onClick, { primary = false, danger = false, label } = {}) {
    const b = this.el('button', primary ? 'btn-primary' : (danger ? 'btn-danger' : 'btn-secondary'), text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', (e) => {
      try {
        const r = onClick(e);
        if (r && typeof r.catch === 'function') r.catch((err) => this.fail(err));
      } catch (err) { this.fail(err); }
    });
    return b;
  },
  input(label, { value = '', type = 'text', placeholder = '', max = 200 } = {}) {
    const i = this.el('input', 'set-input');
    i.type = type; i.value = value; i.maxLength = max;
    i.setAttribute('aria-label', label);
    if (placeholder) i.placeholder = placeholder;
    return i;
  },
  // A labelled row: the text, then the controls.
  row(text, ...controls) {
    const r = this.el('div', 'setting-row');
    r.appendChild(this.el('span', '', text));
    r.append(...controls);
    return r;
  },
  // The on/off switch row Settings uses.
  switchRow(text, checked, onChange) {
    const row = this.el('div', 'setting-toggle-row');
    const lab = this.el('label', 'toggle');
    const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = !!checked; input.setAttribute('aria-label', text);
    input.addEventListener('change', () => {
      try { onChange(input.checked); }
      catch (err) { input.checked = !input.checked; this.fail(err); }
    });
    lab.append(input, this.el('span', 'toggle-slider'));
    row.append(this.el('span', 'setting-label-text', text), lab);
    return row;
  },
  info(text) { return this.el('p', 'setting-info', text); },

  // The platform dialog, or a thrown error when it is not loaded.
  dialog(spec) {
    if (typeof VexSettingsGroups === 'undefined') throw new Error('The dialog helpers are not loaded (js/vex-settings-groups.js)');
    return VexSettingsGroups.dialog(spec);
  },
  // Settings group + Ctrl+K commands, the way the other modules do it.
  register({ id, title, keywords, render, commands }) {
    if (typeof VexSettingsGroups !== 'undefined') VexSettingsGroups.register({ id, title, keywords, render });
    if (typeof CommandBar !== 'undefined' && Array.isArray(CommandBar.commands) && commands) {
      for (const c of commands) CommandBar.commands.push(c);
    }
  },
};

if (typeof window !== 'undefined') window.VexMediaKit = VexMediaKit;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexMediaKit };
