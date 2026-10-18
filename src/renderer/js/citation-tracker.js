// === Citations tracker — a quote pasted into Notes brings its source ========
//
// You copy a sentence off a page, paste it into a note, and a week later have
// no idea where it came from. With this on, the note gets the link as you
// paste: "the quote ([Page title](https://…))".
//
// Off by default. It works from two things Vex already sees and nothing else:
//   - text copied off a web page, reported by the guest preload ('vex-copy',
//     the same event the clipboard history uses), kept in memory only; and
//   - the paste event fired inside Vex's own note editor, whose clipboard data
//     is the text being pasted right now.
// The operating-system clipboard is never read in the background, and a copy
// from another program is never matched because it was never recorded here.
// A private, Tor or routed tab's copies are not recorded in the first place.

const CitationTracker = {
  SETTING: 'vex.citations.enabled',
  EDITOR_ID: 'notes-content-area',
  MAX: 20,
  MAX_AGE_MS: 60 * 60 * 1000,
  recent: [],                 // memory only, newest first
  _wired: false,

  enabled() { try { return localStorage.getItem(this.SETTING) === 'on'; } catch { return false; } },
  setEnabled(on) {
    try { localStorage.setItem(this.SETTING, on ? 'on' : 'off'); } catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    if (!on) this.recent = [];       // turning it off forgets what it held
    return !!on;
  },

  _norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); },

  // Called with a copy a page reported. Does nothing while the feature is off.
  record({ text, url, title }) {
    if (!this.enabled()) return false;
    const t = this._norm(text);
    const u = String(url || '');
    if (t.length < 8 || !/^https?:/i.test(u)) return false;
    this.recent = this.recent.filter(r => r.text !== t);
    this.recent.unshift({ text: t, url: u, title: String(title || u).slice(0, 160), at: Date.now() });
    this.recent = this.recent.slice(0, this.MAX);
    return true;
  },

  // The source of text that was pasted, or null.
  find(pasted, now = Date.now()) {
    const t = this._norm(pasted);
    if (!t) return null;
    return this.recent.find(r => r.text === t && now - r.at <= this.MAX_AGE_MS) || null;
  },

  // The markup appended after a pasted quote.
  citation(src) {
    const label = String(src.title || src.url).replace(/[\[\]\n]/g, ' ').replace(/\s+/g, ' ').trim();
    return ' ([' + label + '](' + src.url + '))';
  },

  // Webview wiring — the same lifecycle-registered listener as the clipboard history.
  attach(webview) {
    const on = (webview && webview._lifecycle)
      ? (ev, fn) => webview._lifecycle.listen(webview, ev, fn)
      : (ev, fn) => webview.addEventListener(ev, fn);
    on('ipc-message', (e) => {
      if (e.channel !== 'vex-copy') return;
      if (!this.enabled()) return;
      if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(webview)) return;
      const data = (e.args && e.args[0]) || {};
      let url = '';
      try { url = webview.getURL(); } catch { url = ''; }
      this.record({ text: data.text, url, title: data.title });
    });
  },

  // Appends the citation after the paste has landed in the editor.
  _afterPaste(ta, pasted, src) {
    const cite = this.citation(src);
    const end = ta.selectionEnd;
    const before = ta.value.slice(0, end);
    // Only if the text really is what ended up before the caret.
    if (!before.endsWith(String(pasted).replace(/\r\n?/g, '\n'))) return false;
    if (ta.value.slice(end, end + cite.length) === cite) return false;
    ta.setRangeText(cite, end, end, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));   // so the note saves
    return true;
  },

  onPaste(e) {
    if (!this.enabled()) return;
    const ta = e.target;
    if (!ta || ta.id !== this.EDITOR_ID) return;
    let pasted = '';
    try { pasted = (e.clipboardData && e.clipboardData.getData('text/plain')) || ''; } catch { pasted = ''; }
    const src = this.find(pasted);
    if (!src) return;
    setTimeout(() => {
      try { this._afterPaste(ta, pasted, src); } catch (err) { console.error('[CitationTracker]', err); }
    }, 0);
  },

  wire() {
    if (this._wired || typeof document === 'undefined') return;
    this._wired = true;
    document.addEventListener('paste', (e) => this.onPaste(e), true);
  },

  injectSettings() {
    if (typeof document === 'undefined') return null;
    const root = document.querySelector('.settings-content');
    if (!root || root.querySelector('[data-vex-mod="citation-tracker"]')) return null;
    const g = document.createElement('div');
    g.className = 'setting-group';
    g.setAttribute('data-vex-mod', 'citation-tracker');
    g.id = 'settings-citations';
    g.innerHTML = `
      <label class="setting-label">Citations in Notes</label>
      <p class="setting-info muted" style="margin-bottom:8px">When you paste text you copied from a web page into a note, add a link to the page after it. Vex only matches copies it saw on a page and the paste you make in the note editor; it never reads the system clipboard in the background, and copies from private or Tor tabs are not remembered.</p>
      <div class="setting-toggle-row">
        <span>Add the source link when I paste a quote into Notes</span>
        <label class="toggle"><input type="checkbox" data-cite-on aria-label="Add the source link when I paste a quote into Notes"><span class="toggle-slider"></span></label>
      </div>`;
    const cb = g.querySelector('[data-cite-on]');
    cb.checked = this.enabled();
    cb.addEventListener('change', () => {
      try { this.setEnabled(cb.checked); } catch (err) { cb.checked = !cb.checked; window.showToast?.(err.message, 'error'); }
    });
    root.appendChild(g);
    return g;
  },

  registerCommands() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return;
    if (CommandBar.commands.some(c => c.id === 'citations-toggle')) return;
    CommandBar.commands.push({
      id: 'citations-toggle',
      label: 'Toggle Citations in Notes',
      hint: 'Add the source link when a copied quote is pasted into Notes',
      icon: 'link',
      action: () => {
        const on = this.setEnabled(!this.enabled());
        window.showToast?.(on ? 'Pasted quotes in Notes will carry their source' : 'Citations in Notes are off');
        const cb = document.querySelector('[data-vex-mod="citation-tracker"] [data-cite-on]');
        if (cb) cb.checked = on;
      },
    });
  },

  init() {
    this.wire();
    this.registerCommands();
    this.injectSettings();
  },
};

if (typeof window !== 'undefined') {
  window.CitationTracker = CitationTracker;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => CitationTracker.init());
    else CitationTracker.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { CitationTracker };
