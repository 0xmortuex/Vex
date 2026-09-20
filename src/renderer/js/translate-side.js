// === The page in both languages at once ====================================
//
// "Translate page" sends you to Google's copy of the site: the original is
// gone, and with it the thing you were reading it for — the wording, a name,
// a number, the code in a snippet. For learning a language, or for checking a
// translation you do not quite trust, you want both.
//
// This leaves the page exactly where it is and puts the translation underneath
// each paragraph, in a quieter colour. Nothing is replaced, so turning it off
// is taking the additions away again.
//
// The translation comes back a paragraph at a time (main.js 'translate:text'),
// and a page can have hundreds — so a run is capped, and a paragraph that came
// back the same as it went in is left out rather than printed twice.
const TranslateSide = {
  MAX_BLOCKS: 80,           // a run's worth; a long page says so and stops there
  MAX_CHARS: 400,           // what one call to the translator takes
  AT_ONCE: 4,               // requests in flight, to not hammer the endpoint
  MIN_TEXT: 15,

  lang() { try { return localStorage.getItem('vex.translateLang') || 'en'; } catch { return 'en'; } },

  // Tags each paragraph so the translation can be put back beside the right
  // one, and hands back the text to translate.
  readScript() {
    return `(() => {
      const SEL = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, figcaption';
      document.querySelectorAll('[data-vex-tr]').forEach(el => el.removeAttribute('data-vex-tr'));
      const out = [];
      for (const el of document.querySelectorAll(SEL)) {
        if (el.querySelector(SEL)) continue;
        if (el.closest('[data-vex-tr-out]')) continue;          // never translate a translation
        const text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
        if (text.length < ${this.MIN_TEXT}) continue;
        el.setAttribute('data-vex-tr', String(out.length));
        out.push(text.slice(0, ${this.MAX_CHARS}));
        if (out.length >= ${this.MAX_BLOCKS}) break;
      }
      return out;
    })()`;
  },

  // pairs: [[index, translated], …]
  applyScript(pairs) {
    return `(() => {
      let style = document.getElementById('vex-tr-style');
      if (!style) {
        style = document.createElement('style');
        style.id = 'vex-tr-style';
        style.textContent = '[data-vex-tr-out]{display:block;margin:2px 0 10px;padding-left:10px;border-left:2px solid #3b82f6;opacity:0.78;font-style:italic}';
        (document.head || document.documentElement).appendChild(style);
      }
      let n = 0;
      for (const [i, text] of ${JSON.stringify(pairs || [])}) {
        const el = document.querySelector('[data-vex-tr="' + i + '"]');
        if (!el) continue;
        let out = el.nextElementSibling;
        if (!out || !out.hasAttribute('data-vex-tr-out')) {
          out = document.createElement('div');
          out.setAttribute('data-vex-tr-out', '1');
          el.after(out);
        }
        out.textContent = text;
        n++;
      }
      return n;
    })()`;
  },

  clearScript() {
    return `(() => {
      document.querySelectorAll('[data-vex-tr-out]').forEach(el => el.remove());
      document.querySelectorAll('[data-vex-tr]').forEach(el => el.removeAttribute('data-vex-tr'));
      document.getElementById('vex-tr-style')?.remove();
      return true;
    })()`;
  },

  _tab() {
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.getActiveWebview() : null;
    let url = '';
    try { url = (wv && wv.getURL && wv.getURL()) || ''; } catch { url = ''; }
    if (!wv || !/^https?:/i.test(url)) throw new Error('Open a web page first');
    return { wv, url };
  },

  // Translates in small batches so the first paragraphs appear while the rest
  // are still coming. A paragraph the translator could not do is left alone
  // rather than blanked.
  async translateAll(texts, tl, onBatch) {
    const done = [];
    for (let i = 0; i < texts.length; i += this.AT_ONCE) {
      const slice = texts.slice(i, i + this.AT_ONCE);
      const results = await Promise.all(slice.map(t => window.vex.translateText(t, tl).catch(() => null)));
      const pairs = [];
      results.forEach((out, j) => {
        const index = i + j;
        if (!out || out.trim() === slice[j].trim()) return;   // nothing to add
        pairs.push([index, out]);
      });
      done.push(...pairs);
      if (pairs.length && onBatch) await onBatch(pairs);
    }
    return done;
  },

  async run(tl) {
    const t = this._tab();
    const target = tl || this.lang();
    const texts = await window.vexGuestEval(t.wv, this.readScript(), false, 8000);
    if (!Array.isArray(texts) || !texts.length) throw new Error('There is no text on this page to translate');
    window.showToast?.('Translating ' + texts.length + (texts.length === this.MAX_BLOCKS ? ' paragraphs (as far down as Vex goes in one run)' : ' paragraphs') + '…');
    let shown = 0;
    await this.translateAll(texts, target, async (pairs) => {
      shown += await window.vexGuestEval(t.wv, this.applyScript(pairs), false, 8000);
    });
    if (!shown) throw new Error('The translator did not answer — check your connection and try again');
    window.showToast?.('Both languages, side by side — run it again to take the translation off', 'success');
    return shown;
  },

  async clear() {
    const t = this._tab();
    return window.vexGuestEval(t.wv, this.clearScript(), false, 6000);
  },

  // Whether this page is showing a translation right now.
  async isOn() {
    const t = this._tab();
    return !!(await window.vexGuestEval(t.wv, '!!document.querySelector("[data-vex-tr-out]")', false, 6000));
  },

  async toggle(tl) {
    if (await this.isOn()) {
      await this.clear();
      window.showToast?.('Translation removed');
      return 0;
    }
    return this.run(tl);
  },
};

if (typeof window !== 'undefined') window.TranslateSide = TranslateSide;
if (typeof module !== 'undefined' && module.exports) module.exports = { TranslateSide };
