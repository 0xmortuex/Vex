// === Doc Text Extractor — pull REAL text out of Google Docs & copy-locked pages ===
// Copy Unlock only re-enables selection of *DOM* text. Google Docs renders its
// text on a <canvas>, so there's nothing to unlock — it needs a different
// approach. Like the "unlock copy" extensions, this gets the document's ACTUAL
// text (no OCR, no mistakes) by fetching one of Google's own text/HTML render
// endpoints from INSIDE the page, so the request carries your Google login
// cookies. We try several because the owner's "disable copy/download" applies
// to them differently:
//   1. /mobilebasic        — server-rendered plain-HTML version (usually still
//                            served even when the txt download is disabled)
//   2. /export?format=txt  — clean plain text (perfect, but the first thing an
//                            owner's "disable download" blocks)
//   3. /export?format=html — HTML export
// First one that returns real content wins → exact text, zero mistakes.
// Only if ALL of those are hard-blocked do we fall back to OCR of the rendered
// pixels (Tesseract.js, on-device) — imperfect, but works on anything visible.
const DocExtract = {
  _ocrLib: null,

  async run() {
    const wv = (typeof WebviewManager !== 'undefined') ? WebviewManager.getActiveWebview() : null;
    if (!wv || typeof wv.capturePage !== 'function') { window.showToast?.('Open a page first'); return; }
    const t = (typeof TabManager !== 'undefined') ? TabManager.getActiveTab() : null;
    const url = (t && t.url) || '';

    // 1) Google Docs/Sheets/Slides — try the real-text render paths (Dex-style).
    const g = this._google(url);
    if (g) {
      window.showToast?.(`Getting the real text from this ${g.label}…`);
      try {
        const text = await this._tryGoogleText(wv, g);
        if (text) { this._showResult(text, `Google ${g.label}`); return; }
      } catch (_) { /* fall through */ }
      window.showToast?.('This doc is fully locked — reading the pixels with OCR instead…');
    }

    // 2) OCR fallback — works on anything visible, but may contain mistakes.
    try {
      await this._ocr(wv);
    } catch (e) {
      window.showToast?.('Could not extract text: ' + (e && e.message ? e.message : e));
    }
  },

  // Parse a Google Docs/Sheets/Slides URL → { type, id, label } or null.
  _google(url) {
    try {
      const u = new URL(url);
      if (u.hostname !== 'docs.google.com') return null;
      const m = u.pathname.match(/^\/(document|spreadsheets|presentation)\/d\/([^/]+)/);
      if (!m) return null;
      const type = m[1], id = m[2];
      const label = type === 'document' ? 'Doc' : type === 'spreadsheets' ? 'Sheet' : 'Slides';
      return { type, id, label };
    } catch { return null; }
  },

  // Ordered list of real-text endpoints to try for this doc type.
  _candidates(g) {
    const base = `https://docs.google.com`;
    if (g.type === 'document') return [
      { url: `${base}/document/d/${g.id}/mobilebasic`, mode: 'html' },
      { url: `${base}/document/d/${g.id}/export?format=txt`, mode: 'text' },
      { url: `${base}/document/d/${g.id}/export?format=html`, mode: 'html' },
    ];
    if (g.type === 'spreadsheets') return [
      { url: `${base}/spreadsheets/d/${g.id}/export?format=csv`, mode: 'text' },
      { url: `${base}/spreadsheets/d/${g.id}/htmlview`, mode: 'html' },
    ];
    // presentation
    return [
      { url: `${base}/presentation/d/${g.id}/export/txt`, mode: 'text' },
    ];
  },

  async _tryGoogleText(wv, g) {
    for (const c of this._candidates(g)) {
      try {
        const text = await this._fetchInPage(wv, c.url, c.mode);
        if (text && text.trim().length > 4) return text;
      } catch (_) { /* try next */ }
    }
    return null;
  },

  // Fetch from inside the page (same-origin + cookies). For HTML endpoints,
  // parse to clean text. Detects sign-in / "request access" pages as blocked.
  _fetchInPage(wv, url, mode) {
    const js = `(async()=>{try{
      const r = await fetch(${JSON.stringify(url)}, { credentials:'include' });
      if (!r.ok) return { ok:false, status:r.status };
      let t = await r.text();
      const mode = ${JSON.stringify(mode)};
      // A permission/sign-in interstitial means we don't really have access.
      if (/(\\bYou need (permission|access)\\b|request access|accounts\\.google\\.com\\/ServiceLogin|id=["']?gaia)/i.test(t) && t.length < 4000) {
        return { ok:false, status:'no-access' };
      }
      if (mode === 'html') {
        const doc = new DOMParser().parseFromString(t, 'text/html');
        doc.querySelectorAll('script,style,noscript,head').forEach(e => e.remove());
        const body = doc.body || doc.documentElement;
        t = (body.innerText || body.textContent || '').replace(/[\\t ]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
      } else {
        // Plain-text endpoint that actually returned an HTML error/login page.
        if (/^\\s*<(!doctype|html)\\b/i.test(t)) return { ok:false, status:'restricted' };
        t = t.trim();
      }
      if (!t || t.length < 5) return { ok:false, status:'empty' };
      return { ok:true, text:t };
    }catch(e){ return { ok:false, error:String(e) }; }})()`;
    return wv.executeJavaScript(js).then(res => {
      if (res && res.ok && res.text) return res.text;
      throw new Error('blocked (' + ((res && (res.status || res.error)) || '?') + ')');
    });
  },

  async _ocr(wv) {
    window.showToast?.('Reading the visible page with OCR — first run downloads the engine…');
    const img = await wv.capturePage();
    if (!img) throw new Error('capture failed');
    const dataUrl = img.toDataURL(); // native resolution — OCR needs the detail
    if (!dataUrl || dataUrl.length < 100) throw new Error('capture was empty');

    const Tesseract = await this._loadOcr();
    const recognize = Tesseract.recognize || (Tesseract.default && Tesseract.default.recognize);
    if (typeof recognize !== 'function') throw new Error('OCR engine unavailable');

    const { data } = await recognize(dataUrl, 'eng', {
      logger: (msg) => {
        if (msg && msg.status === 'recognizing text' && typeof msg.progress === 'number') {
          window.showToast?.('OCR… ' + Math.round(msg.progress * 100) + '%');
        }
      }
    });
    const text = ((data && data.text) || '').trim();
    if (!text) { window.showToast?.('No readable text on the visible page'); return; }
    this._showResult(text, 'OCR (visible page)');
  },

  async _loadOcr() {
    if (this._ocrLib) return this._ocrLib;
    const mod = await import(/* @vite-ignore */ 'https://esm.run/tesseract.js');
    this._ocrLib = mod.default || mod;
    return this._ocrLib;
  },

  _showResult(text, source) {
    try { navigator.clipboard.writeText(text); } catch {}
    document.getElementById('vex-docextract')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-docextract';
    m.style.cssText = 'position:fixed;inset:0;z-index:100060;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    m.innerHTML = `<div style="width:720px;max-width:94vw;height:78vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5);overflow:hidden">
        <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border)">
          <strong style="font-size:15px;color:var(--text)">📄 Extracted text</strong>
          <span style="font-size:11.5px;color:var(--text-muted)">${source} · ${text.length.toLocaleString()} chars · copied to clipboard</span>
          <span style="flex:1"></span>
          <button id="de-copy" style="padding:8px 14px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-weight:600">Copy again</button>
          <button id="de-close" style="padding:8px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer">✕</button>
        </div>
        <textarea id="de-text" readonly spellcheck="false" style="flex:1;min-height:0;resize:none;border:none;outline:none;padding:16px;background:var(--bg);color:var(--text);font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.55"></textarea>
      </div>`;
    document.body.appendChild(m);
    const ta = m.querySelector('#de-text');
    ta.value = text;
    const close = () => m.remove();
    m.querySelector('#de-close').addEventListener('click', close);
    m.addEventListener('mousedown', (e) => { if (e.target === m) close(); });
    m.querySelector('#de-copy').addEventListener('click', () => { ta.select(); try { navigator.clipboard.writeText(text); } catch {} window.showToast?.('📋 Copied'); });
    window.showToast?.(`📋 Copied ${text.length.toLocaleString()} chars (${source})`);
  },
};

if (typeof window !== 'undefined') window.DocExtract = DocExtract;
if (typeof module !== 'undefined' && module.exports) module.exports = { DocExtract };
