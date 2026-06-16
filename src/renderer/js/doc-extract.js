// === Doc Text Extractor — pull text out of Google Docs & copy-locked pages ===
// Copy Unlock only re-enables selection of *DOM* text. Google Docs renders its
// text on a <canvas>, so there's no selectable text to unlock — it needs a
// different approach entirely. This module:
//   1. Google Docs/Sheets fast path — fetches the document's own export endpoint
//      from INSIDE the page (so it carries your Google login cookies). Returns
//      perfect text when you have view access and export isn't hard-blocked.
//   2. OCR fallback — captures the rendered page and reads the pixels with
//      Tesseract.js (loaded on demand from a CDN, like the on-device AI engine).
//      This works on fully locked, canvas-rendered docs: if you can see it, OCR
//      can read it. Runs entirely on your machine — the image never leaves it.
// Result is copied to the clipboard and shown in a panel you can select/edit.
const DocExtract = {
  _ocrLib: null,

  async run() {
    const wv = (typeof WebviewManager !== 'undefined') ? WebviewManager.getActiveWebview() : null;
    if (!wv || typeof wv.capturePage !== 'function') { window.showToast?.('Open a page first'); return; }
    const t = (typeof TabManager !== 'undefined') ? TabManager.getActiveTab() : null;
    const url = (t && t.url) || '';

    // 1) Google Docs/Sheets export fast path (authenticated, perfect text).
    const g = this._googleExport(url);
    if (g) {
      window.showToast?.(`Fetching text from this ${g.kind}…`);
      try {
        const text = await this._fetchInPage(wv, g.exportUrl);
        if (text && text.trim().length > 4) { this._showResult(text, `Google ${g.kind} export`); return; }
      } catch (_) { /* locked/blocked — fall through to OCR */ }
      window.showToast?.('Export blocked — reading the page with OCR instead…');
    }

    // 2) OCR fallback — works on canvas-rendered/locked docs and images.
    try {
      await this._ocr(wv);
    } catch (e) {
      window.showToast?.('Could not extract text: ' + (e && e.message ? e.message : e));
    }
  },

  // Recognize a Google Docs/Sheets URL and build its plain-text export URL.
  _googleExport(url) {
    try {
      const u = new URL(url);
      if (u.hostname !== 'docs.google.com') return null;
      const m = u.pathname.match(/^\/(document|spreadsheets)\/d\/([^/]+)/);
      if (!m) return null; // presentations / drawings → OCR
      const id = m[2];
      if (m[1] === 'document') return { kind: 'Doc', exportUrl: `https://docs.google.com/document/d/${id}/export?format=txt` };
      return { kind: 'Sheet', exportUrl: `https://docs.google.com/spreadsheets/d/${id}/export?format=csv` };
    } catch { return null; }
  },

  // Fetch from inside the page so the request carries the user's Google cookies
  // (same-origin + credentials). Returns text, or throws if blocked.
  _fetchInPage(wv, exportUrl) {
    const js = `(async()=>{try{
      const r = await fetch(${JSON.stringify(exportUrl)}, { credentials:'include' });
      if (!r.ok) return { ok:false, status:r.status };
      const t = await r.text();
      // A 403/redirect can return an HTML login/permission page; treat as blocked.
      if (/^\\s*<(!doctype|html)/i.test(t)) return { ok:false, status:'restricted' };
      return { ok:true, text:t };
    }catch(e){ return { ok:false, error:String(e) }; }})()`;
    return wv.executeJavaScript(js).then(res => {
      if (res && res.ok && res.text) return res.text;
      throw new Error('export blocked (' + ((res && (res.status || res.error)) || '?') + ')');
    });
  },

  async _ocr(wv) {
    window.showToast?.('Reading the visible page with OCR — first run downloads the engine…');
    const img = await wv.capturePage();
    if (!img) throw new Error('capture failed');
    // Keep native resolution (don't downscale — OCR needs the detail).
    const dataUrl = img.toDataURL();
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
