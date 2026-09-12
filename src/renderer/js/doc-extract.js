// === Doc Text Extractor — pull REAL text out of Google Docs & copy-locked pages ===
// Copy Unlock only re-enables selection of *DOM* text. Google Docs renders its
// text on a <canvas>, so there's nothing to unlock. Like the dedicated "unlock
// copy" extensions, this gets the document's ACTUAL text (no OCR, no mistakes).
//
// Primary method (the reliable one): load Google's plain-HTML render of the doc
// — /mobilebasic for Docs, /htmlview for Sheets — in a HIDDEN off-screen
// <webview> on the persist:main session (your logged-in Google session). Because
// it's a real top-level navigation, Google's service worker serves the real
// text page (not the canvas app shell), and we read its rendered innerText. This
// is exactly the manual "change the URL to mobilebasic" trick, automated, and it
// bypasses most "disable copy/paste" locks because that render path is gated
// differently from the download.
//
// Secondary: fetch /export?format=txt|html from inside the page.
// Last resort: OCR of the rendered pixels (Tesseract.js, on-device) — imperfect,
// but works on anything visible.
//
// Result is copied to the clipboard and shown in a panel you can select/edit.

// --- Google Sheets ------------------------------------------------------------
// /htmlview is only a SHELL: title bar, sheet-tab bar and two scroll arrows. The
// grid is loaded afterwards by script, one page per sheet, from
// /htmlview/sheet?gid=N. Reading the shell's innerText therefore returned the
// title, the tab name and "> <" - 52 characters and no cells at all - and since
// that cleared the "more than 20 characters" bar it was accepted as the answer,
// so the CSV fallback never even ran. Measured on Google's public sample sheet:
// the shell holds 0 occurrences of any cell value; the sheet page holds them all.
//
// Both helpers are self-contained on purpose: they are injected into the hidden
// webview with Function#toString(), and unit-tested directly.

// Every sheet listed in the /htmlview shell, as { name, url }. The shell embeds
// them as JS object literals, so the strings are JS-escaped (\/ and \x3d).
function parseSheetList(html) {
  const unescape = (s) => s
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\(.)/g, '$1');
  const re = /\{name:\s*"((?:[^"\\]|\\.)*)",\s*pageUrl:\s*"((?:[^"\\]|\\.)*)"/g;
  const out = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(html || ''))) {
    const url = unescape(m[2]);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ name: unescape(m[1]), url });
  }
  return out;
}

// A rendered sheet grid (<table class="waffle">) as tab-separated text. Skips
// the column-letter header, the row-number <th> that starts every row, and the
// all-empty spacer rows Google interleaves; trims trailing empty cells.
//
// Linked cells keep their link, written "text (url)". Reading textContent alone
// dropped every link, so a registry whose whole point is its links to other
// sheets came out as a list of titles you could no longer open. `baseUrl` is the
// sheet page the table came from, used to turn in-file tab links (#gid=N) into
// something that opens outside the page.
function tableToText(table, baseUrl) {
  if (!table) return '';

  // Where a link really goes. Google wraps outside links in its redirect
  // (google.com/url?q=<target>&sa=D...), which is noise in a copy; unwrap it.
  const linkTarget = (href) => {
    const raw = (href || '').trim();
    if (!raw) return '';
    const gid = /^#gid=(\d+)/.exec(raw);
    if (gid) {
      const id = /\/spreadsheets\/d\/([^/?#]+)/.exec(baseUrl || '');
      return id ? 'https://docs.google.com/spreadsheets/d/' + id[1] + '/edit#gid=' + gid[1] : raw;
    }
    try {
      const u = new URL(raw);
      if (/(^|\.)google\.[a-z.]+$/i.test(u.hostname) && u.pathname === '/url') {
        const q = u.searchParams.get('q') || u.searchParams.get('url');
        if (q) return q;
      }
    } catch (e) { /* relative or malformed - keep it as written */ }
    return raw;
  };

  const cellText = (node) => {
    let out = '';
    for (const child of Array.from(node.childNodes || [])) {
      if (child.nodeType === 3) { out += child.nodeValue; continue; }
      if (child.nodeType !== 1) continue;
      if (child.tagName === 'BR') { out += ' '; continue; }
      if (child.tagName === 'A' && child.getAttribute('href')) {
        const text = (child.textContent || '').replace(/\s+/g, ' ').trim();
        const url = linkTarget(child.getAttribute('href'));
        out += (!url || url === text) ? text : (text ? text + ' (' + url + ')' : url);
        continue;
      }
      out += cellText(child);
    }
    return out;
  };

  const lines = [];
  const bodies = table.tBodies && table.tBodies.length ? Array.from(table.tBodies) : [table];
  for (const body of bodies) {
    for (const row of Array.from(body.rows || [])) {
      const cells = Array.from(row.cells || [])
        .filter((c) => c.tagName === 'TD')
        .map((c) => cellText(c).replace(/\s+/g, ' ').trim());
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (cells.length) lines.push(cells.join('\t'));
    }
  }
  return lines.join('\n');
}

const DocExtract = {
  _ocrLib: null,

  async run() {
    const wv = (typeof WebviewManager !== 'undefined') ? WebviewManager.getActiveWebview() : null;
    if (!wv || typeof wv.capturePage !== 'function') { window.showToast?.('Open a page first'); return; }
    const t = (typeof TabManager !== 'undefined') ? TabManager.getActiveTab() : null;
    const url = wv.getURL?.() || (t && t.url) || '';
    const generation = wv._navigationGeneration;
    const current = () => wv.isConnected !== false && wv.getURL?.() === url && wv._navigationGeneration === generation;
    const partition = window.VexTabPolicy?.partitionFor(wv.getAttribute?.('partition')) || wv.getAttribute?.('partition') || 'persist:main';

    const g = this._google(url);
    if (g) {
      // 1) Real-text render in a hidden webview (the reliable, Dex-style path).
      const viewUrl = this._viewUrl(g);
      if (viewUrl) {
        window.showToast?.(`Getting the real text from this ${g.label}…`);
        try {
          const text = g.type === 'spreadsheets'
            ? await this._viaHiddenWebview(viewUrl, partition, { reader: this._sheetReader(viewUrl), timeoutMs: 30000 })
            : await this._viaHiddenWebview(viewUrl, partition);
          if (!current()) return;
          if (text) { this._showResult(text, `Google ${g.label} (real text)`); return; }
        } catch (_) { /* fall through */ }
      }
      // 2) Secondary: in-page export fetch.
      try {
        const text = await this._tryGoogleText(wv, g);
        if (!current()) return;
        if (text) { this._showResult(text, `Google ${g.label} export`); return; }
      } catch (_) { /* fall through */ }
      window.showToast?.('This doc is fully locked — reading the pixels with OCR instead…');
    }

    // 3) OCR fallback.
    try {
      if (!current()) return;
      await this._ocr(wv, current);
    } catch (e) {
      window.showToast?.('Could not extract text: ' + (e && e.message ? e.message : e));
    }
  },

  // Parse a Google Docs/Sheets/Slides URL → { type, id, label } or null.
  _google(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com') return null;
      const m = u.pathname.match(/^\/(document|spreadsheets|presentation)\/d\/([^/]+)/);
      if (!m) return null;
      const type = m[1], id = m[2];
      const label = type === 'document' ? 'Doc' : type === 'spreadsheets' ? 'Sheet' : 'Slides';
      return { type, id, label };
    } catch { return null; }
  },

  // Google's plain-HTML render URL for this doc type (real selectable text).
  _viewUrl(g) {
    if (g.type === 'document') return `https://docs.google.com/document/d/${g.id}/mobilebasic`;
    if (g.type === 'spreadsheets') return `https://docs.google.com/spreadsheets/d/${g.id}/htmlview`;
    return null; // presentations → export/OCR
  },

  // Load the plain-HTML render in a hidden off-screen webview on the user's
  // logged-in session, then read its rendered text. Resolves '' if blocked.
  _viaHiddenWebview(viewUrl, partition = 'persist:main', { reader = null, timeoutMs = 15000 } = {}) {
    return new Promise((resolve) => {
      let wv;
      try {
        wv = document.createElement('webview');
        wv.setAttribute('partition', partition); // use the source document's account
        wv.setAttribute('webpreferences', 'contextIsolation=yes');
        wv.setAttribute('src', viewUrl);
        wv.style.cssText = 'position:fixed;left:-10000px;top:0;width:1000px;height:800px;opacity:0;pointer-events:none';
        document.body.appendChild(wv);
      } catch { resolve(''); return; }

      let done = false;
      const cleanup = () => { try { clearTimeout(timer); } catch {} try { wv.remove(); } catch {} };
      const finish = (text) => { if (done) return; done = true; cleanup(); resolve(text || ''); };

      const read = async () => {
        try {
          // Small settle for any client-side hydration on the plain page.
          await new Promise(r => setTimeout(r, 300));
          if (done || wv.getURL?.() !== viewUrl) { finish(''); return; }
          const text = await wv.executeJavaScript(reader ||
            `(function(){try{if(location.href!==${JSON.stringify(viewUrl)})return '';var b=document.body;return b?(b.innerText||b.textContent||'').slice(0,2000000):'';}catch(e){return '';}})()`
          );
          const clean = (text || '').replace(/\n{3,}/g, '\n\n').trim();
          const head = clean.slice(0, 600);
          // A custom reader returns '' when it finds nothing real, so any text it
          // gives back is genuine; the page-text reader needs the length bar.
          const enough = reader ? clean.length > 0 : clean.length > 20;
          // Reject sign-in / permission interstitials.
          if (enough &&!/\b(you need (permission|access)|request access|sign in to continue|couldn'?t preview)\b/i.test(head)) {
            finish(clean);
          } else {
            finish('');
          }
        } catch { finish(''); }
      };

      wv.addEventListener('did-finish-load', read);
      wv.addEventListener('did-fail-load', (e) => { if (e && e.isMainFrame === false) return; finish(''); });
      const timer = setTimeout(() => finish(''), timeoutMs);
    });
  },

  // In-page script for a Sheets /htmlview shell: fetch every sheet's grid page
  // and turn each into tab-separated text. Returns '' if no grid was found (a
  // private sheet's sign-in page, say), which lets the caller fall back.
  _sheetReader(viewUrl) {
    const bounded = window.VexNet?.createBoundedFetch
      ? `(${window.VexNet.createBoundedFetch.toString()})(fetch.bind(window))`
      : `((u, o) => fetch(u, o))`;
    return `(async function () {
      try {
        if (location.href !== ${JSON.stringify(viewUrl)}) return '';
        const parseSheetList = ${parseSheetList.toString()};
        const tableToText = ${tableToText.toString()};
        const request = ${bounded};
        // Google pages enforce Trusted Types, so DOMParser.parseFromString() with
        // a plain string THROWS ("This document requires 'TrustedHTML'
        // assignment") - which silently emptied this whole reader in the real
        // app while it passed in a test DOM that has no Trusted Types. Parse
        // through our own policy. A pass-through is safe here: a DOMParser
        // document is inert, so nothing in the fetched HTML ever runs.
        let policy = null;
        try {
          if (typeof trustedTypes !== 'undefined' && trustedTypes.createPolicy) {
            policy = trustedTypes.createPolicy('vex-doc-extract', { createHTML: (s) => s });
          }
        } catch (e) { policy = null; }
        const parse = (html) => new DOMParser().parseFromString(policy ? policy.createHTML(html) : html, 'text/html');
        let sheets = parseSheetList(document.documentElement.innerHTML);
        if (!sheets.length) {
          sheets = [{ name: '', url: location.href.replace(/\\/htmlview.*$/, '/htmlview/sheet?headers=false&gid=0') }];
        }
        const parts = [];
        for (const sheet of sheets) {
          const url = sheet.url.replace('headers=true', 'headers=false');
          const r = await request(url, { credentials: 'include', maxBytes: 8000000, timeoutMs: 12000 });
          if (!r.ok) continue;
          const doc = parse(await r.text());
          const text = tableToText(doc.querySelector('table.waffle'), url);
          if (text) parts.push(sheets.length > 1 ? '## ' + sheet.name + '\\n' + text : text);
        }
        return parts.join('\\n\\n');
      } catch (e) { return ''; }
    })()`;
  },

  // Ordered in-page export endpoints (secondary).
  _candidates(g) {
    const base = 'https://docs.google.com';
    if (g.type === 'document') return [
      { url: `${base}/document/d/${g.id}/export?format=txt`, mode: 'text' },
      { url: `${base}/document/d/${g.id}/export?format=html`, mode: 'html' },
    ];
    if (g.type === 'spreadsheets') return [
      { url: `${base}/spreadsheets/d/${g.id}/export?format=csv`, mode: 'text' },
    ];
    return [
      { url: `${base}/presentation/d/${g.id}/export/txt`, mode: 'text' },
    ];
  },

  async _tryGoogleText(wv, g) {
    for (const c of this._candidates(g)) {
      try {
        const text = await this._fetchInPage(wv, c.url, c.mode);
        if (text && text.trim().length > 4) return text;
      } catch (_) { /* next */ }
    }
    return null;
  },

  _fetchInPage(wv, url, mode) {
    const sourceUrl = wv.getURL?.();
    const generation = wv._navigationGeneration;
    if (!window.VexNet?.createBoundedFetch) return Promise.reject(new Error('Network helper unavailable'));
    const js = `(async()=>{try{
      if(location.href!==${JSON.stringify(sourceUrl)})return {ok:false};
      const request = (${window.VexNet.createBoundedFetch.toString()})(fetch.bind(window));
      const r = await request(${JSON.stringify(url)}, { credentials:'include', maxBytes:2000000, timeoutMs:10000 });
      if (!r.ok) return { ok:false, status:r.status };
      let t = await r.text();
      const mode = ${JSON.stringify(mode)};
      if (/(\\bYou need (permission|access)\\b|request access|accounts\\.google\\.com\\/ServiceLogin)/i.test(t) && t.length < 4000) {
        return { ok:false, status:'no-access' };
      }
      if (mode === 'html') {
        const doc = new DOMParser().parseFromString(t, 'text/html');
        doc.querySelectorAll('script,style,noscript,head').forEach(e => e.remove());
        const body = doc.body || doc.documentElement;
        t = (body.textContent || '').replace(/[\\t ]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
      } else {
        if (/^\\s*<(!doctype|html)\\b/i.test(t)) return { ok:false, status:'restricted' };
        t = t.trim();
      }
      if (!t || t.length < 5) return { ok:false, status:'empty' };
      return { ok:true, text:t };
    }catch(e){ return { ok:false, error:String(e) }; }})()`;
    return wv.executeJavaScript(js).then(res => {
      if (wv.getURL?.() !== sourceUrl || wv._navigationGeneration !== generation) throw new Error('Document changed');
      if (res && res.ok && res.text) return res.text;
      throw new Error('blocked');
    });
  },

  async _ocr(wv, current = () => true) {
    window.showToast?.('Reading the visible page with OCR — first run downloads the engine…');
    const img = await wv.capturePage();
    if (!current()) return;
    if (!img) throw new Error('capture failed');
    const dataUrl = img.toDataURL();
    if (!dataUrl || dataUrl.length < 100) throw new Error('capture was empty');

    const Tesseract = await this._loadOcr();
    if (!current()) return;
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
    if (!current()) return;
    if (!text) { window.showToast?.('No readable text on the visible page'); return; }
    this._showResult(text, 'OCR (visible page)');
  },

  async _loadOcr() {
    if (this._ocrLib) return this._ocrLib;
    const base = new URL('vendor/runtime/', window.location.href);
    const mod = await import(new URL('tesseract.mjs', base).href);
    const api = mod.default || mod;
    this._ocrLib = { recognize: (image, language, options = {}) => api.recognize(image, language, {
      ...options, workerPath: new URL('worker.min.js', base).href, corePath: base.href, workerBlobURL: false
    }) };
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
          <strong style="font-size:15px;color:var(--text)">Extracted text</strong>
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
    m.querySelector('#de-copy').addEventListener('click', () => { ta.select(); try { navigator.clipboard.writeText(text); } catch {} window.showToast?.('Copied'); });
    window.showToast?.(`Copied ${text.length.toLocaleString()} chars (${source})`);
  },
};

if (typeof window !== 'undefined') window.DocExtract = DocExtract;
if (typeof module !== 'undefined' && module.exports) module.exports = { DocExtract, parseSheetList, tableToText };
