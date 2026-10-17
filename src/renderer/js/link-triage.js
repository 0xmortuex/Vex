// === Link triage at paste time ==============================================
//
// Paste a link into a note or into the AI panel's box and a small bar offers to
// add what the link is: "— Page title · site.com · 6 min read". It is only an
// offer:
//
//   * nothing is fetched until you press Add details
//   * https links only, and never an address on this PC or your network
//   * the fetch is a plain GET from Vex's window with no cookies and no
//     referrer (AgentTools.readUrl, the call Read Later and page watches use),
//     so the site learns of the request, not of who you are or where you were
//   * the pasted text is never changed unless you say yes, and a paste that is
//     more than one bare link (a sentence, several links) is left alone
//
// The rules are pure and tested in tests/renderer/linkTriage.test.js.
const LinkTriage = {
  PREF_KEY: 'vex.linkTriage.enabled',
  FIELDS: ['ai-input', 'notes-content-area'],
  WORDS_PER_MINUTE: 220,
  OFFER_MS: 14000,

  enabled() { try { return localStorage.getItem(this.PREF_KEY) !== 'false'; } catch { return true; } },
  setEnabled(on) { localStorage.setItem(this.PREF_KEY, on ? 'true' : 'false'); },

  // The one https address a paste consists of, or null.
  extractUrl(clip) {
    const s = String(clip == null ? '' : clip).trim();
    if (!s || s.length > 2000 || /\s/.test(s)) return null;
    let u;
    try { u = new URL(s); } catch { return null; }
    if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return null;
    return s;
  },

  _private(host) {
    const pa = typeof VexPrivateAddress !== 'undefined' ? VexPrivateAddress
      : (typeof AgentTools !== 'undefined' && AgentTools.isPrivateHost ? { isPrivateHost: (h) => AgentTools.isPrivateHost(h) } : null);
    if (pa) return !!pa.isPrivateHost(host);
    if (typeof require === 'function') { try { return !!require('./private-address.js').isPrivateHost(host); } catch { /* fall through */ } }
    return /^(?:localhost|127\.|10\.|192\.168\.|169\.254\.)/i.test(host) || !host.includes('.');
  },

  // Is this link one that may be asked about?
  mayFetch(url) {
    let u;
    try { u = new URL(url); } catch { return { ok: false, why: 'Not a valid address' }; }
    if (u.protocol !== 'https:') return { ok: false, why: 'Only https links are looked up' };
    if (this._private(u.hostname)) return { ok: false, why: 'Links on this PC or your network are not looked up' };
    if (/\.onion$/i.test(u.hostname)) return { ok: false, why: 'Onion links are not looked up from here' };
    return { ok: true };
  },

  minutesFor(text) {
    const words = String(text == null ? '' : text).split(/\s+/).filter(Boolean).length;
    return words >= 150 ? Math.max(1, Math.round(words / this.WORDS_PER_MINUTE)) : 0;
  },

  // The tag: "Title · site.com · 6 min read". Parts that are unknown are left out.
  tag({ title = '', url = '', minutes = 0 } = {}) {
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* no host */ }
    let t = String(title || '').replace(/\s+/g, ' ').replace(/[\r\n]/g, ' ').trim();
    if (t.length > 110) t = t.slice(0, 109) + '…';
    // A title that already ends in the site name says it twice.
    if (host && t) {
      const bare = host.split('.').slice(0, -1).join('.') || host;
      const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('\\s*[|\\-–—·:]\\s*(?:' + esc(host) + '|' + esc(bare) + ')\\s*$', 'i');
      t = t.replace(re, '').trim() || t;
    }
    const parts = [t, host, minutes > 0 ? minutes + ' min read' : ''].filter(Boolean);
    return parts.join(' · ');
  },

  // `text` with " — <tag>" put straight after the last copy of `url`. null when
  // the link is no longer in the text (it was edited away).
  appendTo(text, url, tag) {
    const s = String(text == null ? '' : text);
    if (!url || !tag) return null;
    const at = s.lastIndexOf(url);
    if (at < 0) return null;
    const end = at + url.length;
    // Not twice.
    if (s.slice(end).startsWith(' — ' + tag)) return null;
    return s.slice(0, end) + ' — ' + tag + s.slice(end);
  },

  // One look at the link. → { title, minutes, tag }
  async lookup(url) {
    const ok = this.mayFetch(url);
    if (!ok.ok) throw new Error(ok.why);
    if (typeof AgentTools === 'undefined') throw new Error('Looking up links is not available in this window');
    const page = await AgentTools.readUrl(url);
    const minutes = this.minutesFor(page.text);
    return { title: page.title || '', minutes, tag: this.tag({ title: page.title, url, minutes }) };
  },

  // ---- the offer --------------------------------------------------------------
  _isField(el) {
    if (!el || el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT') return false;
    if (this.FIELDS.includes(el.id)) return true;
    return !!(el.closest && el.closest('#panel-notes, #notes-container'));
  },

  _dismiss() {
    if (this._bar) { this._bar.remove(); this._bar = null; }
    clearTimeout(this._timer);
  },

  offer(field, url) {
    this._dismiss();
    const bar = document.createElement('div');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Link details');
    bar.className = 'vex-link-triage';
    const r = field.getBoundingClientRect();
    bar.style.cssText = 'position:fixed;z-index:9000;display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:8px;box-shadow:0 6px 20px var(--vex-shadow-color,rgba(0,0,0,0.35));font-size:12px;color:var(--text);max-width:min(420px,92vw)'
      + ';left:' + Math.max(8, Math.round(r.left)) + 'px;top:' + Math.max(8, Math.round(r.top) - 40) + 'px';
    let host = url; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* keep */ }
    const label = document.createElement('span');
    label.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    label.textContent = 'Add title, site and reading time for ' + host + '?';
    const btn = (text, fn, strong) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = text;
      b.style.cssText = 'font-size:11.5px;border:1px solid var(--border);border-radius:6px;padding:2px 8px;cursor:pointer;background:' + (strong ? 'var(--vex-hover-fill,var(--surface))' : 'none') + ';color:var(--text)';
      b.addEventListener('mousedown', (e) => e.preventDefault());   // keep the caret in the field
      b.addEventListener('click', fn);
      return b;
    };
    const add = btn('Add details', async (e) => {
      e.preventDefault();
      add.disabled = true; add.textContent = 'Looking…';
      try {
        const info = await this.lookup(url);
        const next = this.appendTo(field.value, url, info.tag);
        if (next == null) { window.showToast?.('The link is no longer in the text', 'info'); }
        else {
          field.value = next;
          field.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } catch (err) { window.showToast?.('Could not look that link up: ' + ((err && err.message) || err), 'error'); }
      this._dismiss();
    }, true);
    const no = btn('No thanks', () => this._dismiss());
    bar.append(label, add, no);
    document.body.appendChild(bar);
    if (typeof VexLayer !== 'undefined') VexLayer.track(bar, { tier: 'panel', id: 'link-triage', keep: true });
    this._bar = bar;
    this._timer = setTimeout(() => this._dismiss(), this.OFFER_MS);
    return bar;
  },

  onPaste(e) {
    try {
      if (!this.enabled()) return;
      const field = e.target;
      if (!this._isField(field)) return;
      const clip = e.clipboardData && e.clipboardData.getData ? e.clipboardData.getData('text') : '';
      const url = this.extractUrl(clip);
      if (!url || !this.mayFetch(url).ok) return;
      // The paste has to land before the bar is placed and the text is searched.
      setTimeout(() => { try { this.offer(field, url); } catch (err) { window.VexProblems?.note('Link triage', 'Could not show the offer', err); } }, 0);
    } catch (err) { window.VexProblems?.note('Link triage', 'Could not read a paste', err); }
  },

  start() {
    if (this._started || typeof document === 'undefined') return;
    this._started = true;
    document.addEventListener('paste', (e) => this.onPaste(e), true);
    // Typing on goes with the offer's life: it is for the link just pasted.
    document.addEventListener('keydown', (e) => { if (this._bar && e.key === 'Escape') this._dismiss(); }, true);
  },
};

if (typeof window !== 'undefined') window.LinkTriage = LinkTriage;
if (typeof module !== 'undefined' && module.exports) module.exports = { LinkTriage };
