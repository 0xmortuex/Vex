// === The typeface Vex itself wears =========================================
//
// Vex's own interface was one font — Outfit, hardcoded in about three hundred
// places across the stylesheets — with a second for headings and a third for
// code. Someone who reads better in a serif, or who simply wants Times New
// Roman, had no way to say so; the accessibility pack could change the font of
// a PAGE, never of the browser around it.
//
// This is that choice. It is deliberately NOT three hundred edits: the picked
// font goes into --vex-font-base / --vex-font-display / --vex-font-mono, and
// one rule in css/fonts.css makes everything in the window follow those
// variables, inline styles included (a stylesheet's !important beats an
// inline style that has none). Nothing is rewritten, and with the default
// chosen the rule does not apply at all — Vex looks exactly as it did.
//
// Every face here ships with Windows or with Vex. Nothing is fetched: a font
// picker that needs the network would leave the interface unreadable offline.
const VexFonts = {
  KEY: 'vex.font',
  MONO_KEY: 'vex.fontMono',

  // kind is what the list groups by; `stack` is what actually gets applied,
  // with fallbacks so a machine without the face still reads sensibly.
  FONTS: [
    { id: 'default', kind: 'sans', name: 'Outfit', note: 'What Vex ships with', stack: "'Outfit', system-ui, -apple-system, sans-serif" },
    { id: 'system', kind: 'sans', name: 'Your system font', note: 'Whatever Windows is set to', stack: "system-ui, 'Segoe UI', sans-serif" },
    { id: 'segoe', kind: 'sans', name: 'Segoe UI', note: 'Windows’ own', stack: "'Segoe UI', system-ui, sans-serif" },
    { id: 'calibri', kind: 'sans', name: 'Calibri', note: 'Softer, narrower', stack: "Calibri, 'Segoe UI', sans-serif" },
    { id: 'candara', kind: 'sans', name: 'Candara', note: 'Humanist, a little warmer', stack: "Candara, 'Segoe UI', sans-serif" },
    { id: 'corbel', kind: 'sans', name: 'Corbel', note: 'Clean, small numerals', stack: "Corbel, 'Segoe UI', sans-serif" },
    { id: 'verdana', kind: 'sans', name: 'Verdana', note: 'Wide and very legible', stack: "Verdana, Geneva, sans-serif" },
    { id: 'tahoma', kind: 'sans', name: 'Tahoma', note: 'Verdana, tighter', stack: "Tahoma, Geneva, sans-serif" },
    { id: 'trebuchet', kind: 'sans', name: 'Trebuchet MS', note: 'Rounder', stack: "'Trebuchet MS', Tahoma, sans-serif" },
    { id: 'arial', kind: 'sans', name: 'Arial', note: 'The plain one', stack: "Arial, Helvetica, sans-serif" },
    { id: 'grotesk', kind: 'sans', name: 'Space Grotesk', note: 'Vex’s heading face, everywhere', stack: "'Space Grotesk', 'Outfit', sans-serif" },

    { id: 'times', kind: 'serif', name: 'Times New Roman', note: 'The classic', stack: "'Times New Roman', Times, serif" },
    { id: 'georgia', kind: 'serif', name: 'Georgia', note: 'Made for screens', stack: "Georgia, 'Times New Roman', serif" },
    { id: 'cambria', kind: 'serif', name: 'Cambria', note: 'Sturdy at small sizes', stack: "Cambria, Georgia, serif" },
    { id: 'constantia', kind: 'serif', name: 'Constantia', note: 'Bookish', stack: "Constantia, Georgia, serif" },
    { id: 'garamond', kind: 'serif', name: 'Garamond', note: 'Old-style, light', stack: "Garamond, 'Palatino Linotype', serif" },
    { id: 'palatino', kind: 'serif', name: 'Palatino', note: 'Calligraphic', stack: "'Palatino Linotype', 'Book Antiqua', serif" },
    { id: 'bookman', kind: 'serif', name: 'Book Antiqua', note: 'Heavier old-style', stack: "'Book Antiqua', Palatino, serif" },

    { id: 'consolas', kind: 'mono', name: 'Consolas', note: 'Windows’ code face', stack: "Consolas, 'Courier New', monospace" },
    { id: 'cascadia', kind: 'mono', name: 'Cascadia Mono', note: 'Newer, from Windows Terminal', stack: "'Cascadia Mono', Consolas, monospace" },
    { id: 'courier', kind: 'mono', name: 'Courier New', note: 'Typewriter', stack: "'Courier New', Courier, monospace" },
    { id: 'lucida', kind: 'mono', name: 'Lucida Console', note: 'Wide', stack: "'Lucida Console', Consolas, monospace" },
    { id: 'jetbrains', kind: 'mono', name: 'JetBrains Mono', note: 'What Vex ships with', stack: "'JetBrains Mono', Consolas, monospace" },
  ],

  KINDS: [
    { id: 'sans', name: 'Without serifs', blurb: 'What most interfaces use.' },
    { id: 'serif', name: 'With serifs', blurb: 'The little feet. Easier for long reading, to most eyes.' },
    { id: 'mono', name: 'Every letter the same width', blurb: 'For code — and for the whole interface, if that is what you want.' },
  ],

  get(id) { return this.FONTS.find(f => f.id === id) || null; },

  // The interface font, and the one used for code. 'jetbrains' is the code
  // default; 'default' (Outfit) is the interface one.
  current() { try { return this.get(localStorage.getItem(this.KEY)) || this.get('default'); } catch { return this.get('default'); } },
  currentMono() { try { return this.get(localStorage.getItem(this.MONO_KEY)) || this.get('jetbrains'); } catch { return this.get('jetbrains'); } },

  // Nothing to override while both are the shipped ones, so the rule in
  // css/fonts.css stays switched off and Vex is byte-for-byte as before.
  isDefault() { return this.current().id === 'default' && this.currentMono().id === 'jetbrains'; },

  set(id) {
    const font = this.get(id);
    if (!font) throw new Error('There is no font called "' + id + '" in Vex');
    if (font.kind === 'mono' && this.current().id === id) { /* re-picking the same one is fine */ }
    try { localStorage.setItem(this.KEY, id); } catch (err) { console.warn('[fonts] could not remember the font:', err && err.message); }
    this.apply();
    return font;
  },

  setMono(id) {
    const font = this.get(id);
    if (!font || font.kind !== 'mono') throw new Error('Code needs a font where every letter is the same width');
    try { localStorage.setItem(this.MONO_KEY, id); } catch (err) { console.warn('[fonts] could not remember the code font:', err && err.message); }
    this.apply();
    return font;
  },

  reset() {
    try { localStorage.removeItem(this.KEY); localStorage.removeItem(this.MONO_KEY); } catch { /* applied anyway */ }
    this.apply();
  },

  // Put the choice on the document. The variables always carry it; the
  // attribute is what turns the sweeping rule on.
  apply() {
    if (typeof document === 'undefined') return null;
    const font = this.current();
    const mono = this.currentMono();
    const root = document.documentElement;
    root.style.setProperty('--vex-font-base', font.stack);
    // Headings follow the interface font unless it is the shipped one, where
    // Vex's own heading face stays.
    root.style.setProperty('--vex-font-display', font.id === 'default' ? "'Space Grotesk', 'Outfit', sans-serif" : font.stack);
    root.style.setProperty('--vex-font-mono', mono.stack);
    if (this.isDefault()) root.removeAttribute('data-vex-font');
    else root.setAttribute('data-vex-font', font.id);
    document.dispatchEvent(new CustomEvent('vex:font-changed', { detail: { font: font.id, mono: mono.id } }));
    this.paintStartPages();
    return font;
  },

  // The start page is a separate document in a <webview>, so the chrome's
  // stylesheets and variables do not reach it: the choice is pushed in, and a
  // copy kept in that page's own storage so the next New Tab has it before
  // first paint instead of flashing the old face. Same shape as the browser
  // look's palette (js/gui-style.js).
  startPageCss() {
    if (this.isDefault()) return '';
    const font = this.current();
    const mono = this.currentMono();
    // The doubled attribute is not a typo. Under a browser look the start page
    // carries `html[data-look] body { font-family: var(--look-font) !important }`,
    // which outranks a plain `body { ... !important }` — so the look's font won
    // and picking one here appeared to do nothing on the new tab page. Naming
    // the attribute twice raises this above it without an inline style on
    // every element. --look-font is redefined for the same reason: it is what
    // the look's own rule reads.
    const on = 'html[data-vex-font][data-vex-font]';
    return `${on} { --vex-font-base: ${font.stack}; --vex-font-display: ${font.id === 'default' ? "'Space Grotesk', sans-serif" : font.stack}; --vex-font-mono: ${mono.stack}; --look-font: ${font.stack}; }
      ${on} body, ${on} body :is(div, span, p, a, h1, h2, h3, h4, h5, h6, button, input, textarea, select, label, li, td, th, summary, small, strong, em) { font-family: ${font.stack} !important; }
      ${on} body :is(code, pre, kbd, samp) { font-family: ${mono.stack} !important; }`;
  },

  paintStartPages() {
    if (typeof WebviewManager === 'undefined' || !WebviewManager.webviews) return 0;
    const css = this.startPageCss();
    let painted = 0;
    for (const wv of WebviewManager.webviews.values()) {
      let url = '';
      try { url = wv.getURL(); } catch { continue; }        // not attached yet; dom-ready paints it
      if (!/start\.html/.test(url)) continue;
      try { wv.executeJavaScript(this.pageScript(css)); painted++; }
      catch (err) { console.warn('[fonts] could not paint a start page:', err && err.message); }
    }
    return painted;
  },

  pageScript(css) {
    return `(() => {
      const css = ${JSON.stringify(css)};
      if (css) {
        let s = document.getElementById('vex-font');
        if (!s) { s = document.createElement('style'); s.id = 'vex-font'; document.head.appendChild(s); }
        s.textContent = css;
        document.documentElement.setAttribute('data-vex-font', '');
        localStorage.setItem('vex.fontCss', css);
      } else {
        document.getElementById('vex-font')?.remove();
        document.documentElement.removeAttribute('data-vex-font');
        localStorage.removeItem('vex.fontCss');
      }
    })()`;
  },


  // ---- Picking one --------------------------------------------------------
  //
  // Every row is drawn IN the font it offers, because the name of a typeface
  // tells you nothing about whether you want to read in it.

  // Each row is drawn in the face it offers, and that needs an inline
  // !important: css/fonts.css sweeps the whole interface into the CHOSEN font
  // with !important of its own, which would otherwise draw all twenty-three
  // previews in the one already picked — a font picker that shows you nothing.
  SAMPLE: 'The quick brown fox \u2014 0123456789',

  open() {
    if (typeof document === 'undefined') return null;
    this.close();
    const el = document.createElement('div');
    el.className = 'vexfont-backdrop';
    el.innerHTML = `
      <div class="vexfont" role="dialog" aria-modal="true" aria-label="The font Vex uses">
        <div class="vexfont-head">
          <div style="flex:1">
            <h2>Font</h2>
            <p>The typeface Vex itself wears \u2014 every panel, menu and button. Pages keep their own. Every face here is already on this machine, so nothing is downloaded.</p>
          </div>
          <button class="vexfont-close" aria-label="Close">&times;</button>
        </div>
        <div class="vexfont-body" id="vexfont-body"></div>
        <div class="vexfont-foot">
          <button data-reset type="button">Back to how Vex ships</button>
          <span id="vexfont-now"></span>
        </div>
      </div>`;
    document.body.appendChild(el);
    this._el = el;
    el.querySelector('.vexfont-close').addEventListener('click', () => this.close());
    el.querySelector('[data-reset]').addEventListener('click', () => { this.reset(); this._draw(); });
    el.addEventListener('mousedown', (e) => { if (e.target === el) this.close(); });
    this._onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); this.close(); } };
    window.addEventListener('keydown', this._onKey, true);
    this._draw();
    return el;
  },

  close() {
    if (this._onKey) { window.removeEventListener('keydown', this._onKey, true); this._onKey = null; }
    if (this._el) { this._el.remove(); this._el = null; }
  },

  _draw() {
    const el = this._el;
    if (!el) return;
    const body = el.querySelector('#vexfont-body');
    const now = this.current();
    const mono = this.currentMono();
    const esc = (v) => (window.escapeHtml ? window.escapeHtml(String(v)) : String(v));
    body.innerHTML = this.KINDS.map(kind => `
      <div class="vexfont-kind">${esc(kind.name)}<span>${esc(kind.blurb)}</span></div>
      <div class="vexfont-grid">
        ${this.FONTS.filter(f => f.kind === kind.id).map(f => `
          <button class="vexfont-one${f.id === now.id ? ' on' : ''}" data-font="${esc(f.id)}">
            <span class="vexfont-name" style="font-family:${f.stack} !important">${esc(f.name)}</span>
            <span class="vexfont-note">${esc(f.note)}${f.id === now.id ? ' \u00b7 in use' : ''}</span>
            <span class="vexfont-sample" style="font-family:${f.stack} !important">${esc(this.SAMPLE)}</span>
          </button>`).join('')}
      </div>`).join('')
      + `<div class="vexfont-kind">The font for code<span>Used for code, shortcuts and anything that has to line up, whatever the interface is wearing.</span></div>
         <div class="vexfont-grid">
           ${this.FONTS.filter(f => f.kind === 'mono').map(f => `
             <button class="vexfont-one${f.id === mono.id ? ' on' : ''}" data-mono="${esc(f.id)}">
               <span class="vexfont-name" style="font-family:${f.stack} !important">${esc(f.name)}</span>
               <span class="vexfont-note">${esc(f.note)}${f.id === mono.id ? ' \u00b7 in use' : ''}</span>
               <span class="vexfont-sample" style="font-family:${f.stack} !important">if (x &lt;= 10) { return 0; }</span>
             </button>`).join('')}
         </div>`;
    el.querySelector('#vexfont-now').textContent = 'Now: ' + now.name + ', with ' + mono.name + ' for code.';
    body.querySelectorAll('[data-font]').forEach(b => b.addEventListener('click', () => {
      try { const f = this.set(b.dataset.font); window.showToast?.('Vex is in ' + f.name + ' now', 'success'); }
      catch (err) { window.showToast?.((err && err.message) || 'That font is not available', 'error'); }
      this._draw();
    }));
    body.querySelectorAll('[data-mono]').forEach(b => b.addEventListener('click', () => {
      try { const f = this.setMono(b.dataset.mono); window.showToast?.('Code is in ' + f.name + ' now', 'success'); }
      catch (err) { window.showToast?.((err && err.message) || 'That font is not available', 'error'); }
      this._draw();
    }));
  },

  init() {
    this.apply();
    return true;
  },
};

if (typeof window !== 'undefined') window.VexFonts = VexFonts;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexFonts };
