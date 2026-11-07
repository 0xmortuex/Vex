// === Copy Text from Image, in English and Turkish =========================================================
//
// Right-click a picture, "Copy Text from Image": the words in it go to the clipboard, and a toast shows how they begin.
//
// The reading is Tesseract, which is bundled (vendor/runtime). It used to be given English only, so ç ğ ı İ ö ş ü came out wrong
// (a real run on "İstanbul'da çok güzel bir şehir. Öğrenci ışığı söndürdü, şu üzüm bağı ğ." in 9 renders: 30.3% of the characters
// wrong with English alone, 1.4% with English + Turkish; docs/ocr-languages.md).
//
// The language data is NOT in the installer. It is one pack of about 5.1 MB (English + Turkish, from cdn.jsdelivr.net) that the
// person agrees to ONCE, with its size on the button; main downloads it through the egress ledger, checks a pinned SHA-256 and keeps it
// in <profile>/ocr-lang (main/ocr-lang-pack.js). Before a reading, the window puts it into the worker's own cache (IndexedDB, under
// the path "vex-pack") and starts the worker with cacheMethod 'readOnly' and a language path no request can follow, so the engine can
// never go to the network by itself. Without the pack, the only offer is English alone, from an English cache an older OCR already
// left; if there is none, nothing is read and nothing is downloaded.
//
// The picture is only ever read in this window: it is fetched through its own tab's session (never from a private or Tor tab without
// asking), shrunk to at most 3500 pixels on a side, and never uploaded anywhere.
const VexImageText = {
  CACHE_PATH: 'vex-pack',
  LANGS: 'eng+tur',
  MAX_SIDE: 3500,
  MAX_BYTES: 16 * 1024 * 1024,
  SIZE: '5.1 MB',
  OFFLINE: 'vex-offline://none',   // a scheme no fetch can follow: if the cache misses, the reading fails instead of going online

  // ---- pure parts ---------------------------------------------------------------------------
  // A line with a changing part in it ("Text copied: {}"), in the language of the window. The part is the person's own text (what a
  // picture said), in any words, so it is not left to the translation table's rules for a hole.
  say(template, value) {
    const line = (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(template)) || template;
    return line.replace('{}', () => value);
  },

  // The size a picture is read at: as it is, or its longest side brought down to `max`.
  fitSize(w, h, max = this.MAX_SIDE) {
    if (!(w > 0) || !(h > 0)) throw new Error('The picture has no size');
    const scale = Math.min(1, max / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)), scale };
  },
  // How the text begins: the first few words, on one line, short.
  firstWords(text, count = 6, limit = 60) {
    const words = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
    if (!words.length) return '';
    let out = words.slice(0, count).join(' ');
    let cut = words.length > count;
    if (out.length > limit) { out = out.slice(0, limit).replace(/\s+\S*$/, ''); cut = true; }
    return out + (cut ? '…' : '');
  },
  megabytes(bytes) { return (Math.round(bytes / 100000) / 10).toFixed(1) + ' MB'; },
  // The text as it will be copied: one space inside a line, lines kept, no blank run, nothing at the ends.
  tidy(text) {
    return String(text == null ? '' : text).replace(/\r/g, '').split('\n').map(l => l.replace(/[ \t ]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  },

  // ---- the worker's own cache (the same IndexedDB idb-keyval keeps for Tesseract) ---------------------
  _idb(mode, fn) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('keyval-store');
      open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('keyval')) open.result.createObjectStore('keyval'); };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        let out;
        const tx = db.transaction('keyval', mode);
        try { out = fn(tx.objectStore('keyval')); } catch (err) { db.close(); reject(err); return; }
        tx.oncomplete = () => { db.close(); resolve(out && 'result' in out ? out.result : undefined); };
        tx.onerror = () => { db.close(); reject(tx.error); };
        tx.onabort = () => { db.close(); reject(tx.error || new Error('The cache was closed')); };
      };
    });
  },
  _has(key) { return this._idb('readonly', s => s.count(key)).then(n => n > 0); },
  _put(key, value) { return this._idb('readwrite', s => s.put(value, key)); },
  _del(key) { return this._idb('readwrite', s => s.delete(key)); },
  async _gunzip(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  },

  // Makes sure the worker's cache holds the pack on disk. A marker says which download it was made from.
  async seedCache(status) {
    for (const f of status.files) {
      const data = this.CACHE_PATH + '/' + f.code + '.traineddata', mark = this.CACHE_PATH + '/' + f.code + '.from';
      const stamp = f.bytes + ':v1';
      const [hasData, hasMark] = await Promise.all([this._has(data), this._has(mark)]);
      const current = hasMark ? await this._idb('readonly', s => s.get(mark)) : null;
      if (hasData && hasMark && current === stamp) continue;
      const raw = await this._gunzip(await window.vex.ocrLangRead(f.code));
      await this._put(data, raw);
      await this._put(mark, stamp);
    }
  },
  // After the pack is removed from the disk, the copy in the cache goes too.
  async forgetCache() {
    for (const code of ['eng', 'tur']) { await this._del(this.CACHE_PATH + '/' + code + '.traineddata'); await this._del(this.CACHE_PATH + '/' + code + '.from'); }
  },
  async removePack() {
    const r = await window.vex.ocrLangRemove();
    await this.forgetCache();
    return r;
  },

  // ---- the pack ---------------------------------------------------------------------------------
  // → 'ready' (the pack is on disk), 'declined' (the person said no or cancelled), or throws.
  async ensurePack(onProgress) {
    if (!window.vex || typeof window.vex.ocrLangStatus !== 'function') throw new Error('Reading text from a picture is not available in this window');
    let st = await window.vex.ocrLangStatus();
    if (st.installed) return 'ready';
    // The size is written out in the texts (so they can be translated); the test pins it to the real download.
    if (this.megabytes(st.totalBytes) !== this.SIZE) throw new Error('The size of the language data changed; update the question first');
    const yes = await window.vexConfirm({
      title: 'Download the text recognition data?',
      message: 'To read Turkish letters (ç ğ ı İ ö ş ü) as well as English, Vex needs language data of about 5.1 MB from cdn.jsdelivr.net. It is downloaded once, checked against a fixed checksum and kept on this PC, and it appears in "what left this computer". The picture itself never leaves this window. You can remove the data later from Ctrl+K, Remove text recognition data.',
      okLabel: 'Download 5.1 MB',
      cancelLabel: 'Not now',
    });
    if (!yes) return 'declined';
    const off = window.vex.onOcrLangProgress ? window.vex.onOcrLangProgress((p) => { if (onProgress) onProgress(p); }) : null;
    try { st = await window.vex.ocrLangDownload(); }
    finally { if (typeof off === 'function') off(); }
    if (!st.installed) throw new Error('The language data did not finish downloading');
    return 'ready';
  },
  async legacyEnglishCached() { return this._has('./eng.traineddata'); },

  // ---- reading --------------------------------------------------------------------------------------
  // The worker, reading only from the cache. `english`: use the English cache an older reading left (cachePath '.').
  async _worker(english, logger) {
    const base = new URL('vendor/runtime/', window.location.href);
    const mod = await import(new URL('tesseract.mjs', base).href);
    const api = mod.default || mod;
    return api.createWorker(english ? 'eng' : this.LANGS, 1, {
      workerPath: new URL('worker.min.js', base).href, corePath: base.href, workerBlobURL: false,
      cachePath: english ? '.' : this.CACHE_PATH, cacheMethod: 'readOnly', langPath: this.OFFLINE, logger,
    });
  },
  // A worker for the OTHER OCR callers (page OCR, redaction, slide and screenshot reading). They used to start Tesseract with its
  // defaults, which fetch English data from a CDN with no ledger line; now they use the same pack as above: the person agrees once,
  // main downloads it through the egress ledger, and the worker only ever reads the cache. Throws when the person says no.
  async packWorker(logger) {
    const mode = await this.ensurePack();
    if (mode === 'declined') throw new Error('The picture was not read: it needs the language data, and nothing was downloaded');
    await this.seedCache(await window.vex.ocrLangStatus());
    return this._worker(false, logger);
  },
  // One reading with the pack worker; `output` is Tesseract's third argument (for example { blocks: true }). → { data }
  async recognizeWithPack(image, { logger, output } = {}) {
    const worker = await this.packWorker(logger);
    try { return await worker.recognize(image, {}, output || {}); }
    finally { await worker.terminate().catch(err => window.VexProblems?.note('Copy text from image', 'the worker did not stop', err)); }
  },
  // The picture, no larger than MAX_SIDE, as a PNG data address.
  async shrink(dataUrl) {
    const blob = await (await fetch(dataUrl)).blob();
    const bmp = await createImageBitmap(blob);
    try {
      const { w, h, scale } = this.fitSize(bmp.width, bmp.height);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);          // a transparent picture reads as black on black otherwise
      g.imageSmoothingQuality = 'high';
      g.drawImage(bmp, 0, 0, w, h);
      return { dataUrl: c.toDataURL('image/png'), w, h, shrunk: scale < 1 };
    } finally { bmp.close(); }
  },
  // → the text. `signal`: an AbortSignal that stops the reading. `onProgress(0..1)`.
  async recognize(dataUrl, { english = false, signal, onProgress } = {}) {
    if (signal && signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const worker = await this._worker(english, (m) => { if (m && m.status === 'recognizing text' && typeof m.progress === 'number' && onProgress) onProgress(m.progress); });
    let stop;
    const aborted = new Promise((_, reject) => {
      stop = () => { worker.terminate().catch(err => window.VexProblems?.note('Copy text from image', 'the worker did not stop', err)); reject(new DOMException('Cancelled', 'AbortError')); };
      if (signal) signal.addEventListener('abort', stop, { once: true });
    });
    try {
      const { data } = await Promise.race([worker.recognize(dataUrl), aborted]);
      return this.tidy(data && data.text);
    } finally {
      if (signal) signal.removeEventListener('abort', stop);
      await worker.terminate().catch(() => { /* vex-allow-empty-catch: already stopped by Cancel */ });
    }
  },

  // ---- the picture ------------------------------------------------------------------------------------
  // The picture's bytes as a data address, through the tab it is in. Null when the person declines for a private or Tor tab.
  async imageData(src, webview) {
    if (/^data:image\//i.test(src)) return src;
    if (/^blob:/i.test(src)) {
      if (!webview || typeof webview.executeJavaScript !== 'function') throw new Error('This picture lives only inside its page, which Vex cannot reach from here');
      const code = '(async () => { const b = await (await fetch(' + JSON.stringify(src) + ')).blob(); if (b.size > ' + this.MAX_BYTES + ') throw new Error("too large"); if (!/^image\\//.test(b.type)) throw new Error("not a picture"); return await new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = () => rej(f.error); f.readAsDataURL(b); }); })()';
      const out = await webview.executeJavaScript(code, true);
      if (typeof out !== 'string' || !out.startsWith('data:image/')) throw new Error('The page did not give the picture');
      return out;
    }
    if (!/^https?:\/\//i.test(src)) throw new Error('This kind of picture cannot be read');
    if (!window.vex || typeof window.vex.imageForAi !== 'function') throw new Error('Vex cannot fetch pictures in this build');
    const pageId = webview && typeof webview.getWebContentsId === 'function' ? webview.getWebContentsId() : 0;
    if (!(pageId > 0)) throw new Error('The tab the picture is in is not open');
    let r = await window.vex.imageForAi(pageId, src, false);
    if (r && r.needsConsent) {
      const tor = r.kind === 'tor';
      const yes = await window.vexConfirm({
        title: tor ? 'Read a picture from a Tor tab?' : 'Read a picture from a private tab?',
        message: tor
          ? 'This picture is in a Tor tab. Vex fetches it once more through that tab’s own connection to read the words in it. The picture stays in this window and is not uploaded.'
          : 'This picture is in a private tab. Vex fetches it once more through that tab’s own connection to read the words in it. The picture stays in this window and is not uploaded.',
        okLabel: 'Read it',
      });
      if (!yes) return null;
      r = await window.vex.imageForAi(pageId, src, true);
    }
    if (!r || !r.ok) throw new Error((r && r.error) || 'The picture could not be fetched');
    if (!r.base64) throw new Error('Nothing came back for that picture');
    return 'data:' + r.type + ';base64,' + r.base64;
  },

  // ---- the card -----------------------------------------------------------------------------------------
  _card(onCancel) {
    document.getElementById('vex-imgtext')?.remove();
    const el = document.createElement('div');
    el.id = 'vex-imgtext';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:100070;min-width:240px;max-width:340px;padding:12px 14px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,0.4);font-size:12.5px;display:flex;flex-direction:column;gap:8px';
    const line = document.createElement('div');
    const bar = document.createElement('div');
    bar.style.cssText = 'height:4px;border-radius:2px;background:var(--border);overflow:hidden';
    const fill = document.createElement('div');
    fill.style.cssText = 'height:100%;width:0;background:var(--primary,var(--accent,#d4a574));transition:width .15s';
    bar.appendChild(fill);
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.style.cssText = 'align-self:flex-end;padding:4px 10px;background:none;color:var(--text);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px';
    cancel.addEventListener('click', onCancel);
    el.append(line, bar, cancel);
    document.body.appendChild(el);
    if (typeof VexLayer !== 'undefined') VexLayer.track(el, { tier: 'toast', id: 'image-text-progress' });
    const T = (s) => (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(s)) || s;
    return {
      say(text, fraction) { line.textContent = T(text); if (typeof fraction === 'number') fill.style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%'; },
      close() { el.remove(); },
    };
  },

  // To the clipboard, with a toast that shows how the text begins. A window that is not in front may not write to the clipboard (a
  // long reading, and the person went to another window): then the text waits in a small card with a Copy button.
  async copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      window.showToast?.(this.say('Text copied: {}', '“' + this.firstWords(text) + '”'));
    } catch (err) {
      window.VexProblems?.note('Copy text from image', 'the clipboard refused the text', err);
      this._offerCopy(text);
    }
  },
  _offerCopy(text) {
    document.getElementById('vex-imgtext-copy')?.remove();
    const el = document.createElement('div');
    el.id = 'vex-imgtext-copy';
    el.setAttribute('role', 'alert');
    el.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:100070;width:320px;padding:12px 14px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,0.4);font-size:12.5px;display:flex;flex-direction:column;gap:8px';
    const T = (v) => (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(v)) || v;
    const msg = document.createElement('div');
    msg.textContent = T('The text is read, but the clipboard did not take it. Press Copy.');
    const preview = document.createElement('div');
    preview.textContent = this.firstWords(text, 12, 120);
    preview.style.cssText = 'color:var(--text-muted);font-style:italic';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
    const mk = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = T(label); b.style.cssText = 'padding:4px 10px;background:none;color:var(--text);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px'; b.addEventListener('click', fn); return b; };
    row.append(mk('Close', () => el.remove()), mk('Copy', async () => {
      try { await navigator.clipboard.writeText(text); el.remove(); window.showToast?.(this.say('Text copied: {}', '“' + this.firstWords(text) + '”')); }
      catch (err) { window.VexProblems?.note('Copy text from image', 'the clipboard refused the text again', err); window.showToast?.(this.say('The clipboard did not take it: {}', err.message), 'error'); }
    }));
    el.append(msg, preview, row);
    document.body.appendChild(el);
    if (typeof VexLayer !== 'undefined') VexLayer.track(el, { tier: 'toast', id: 'image-text-copy' });
  },

  // The whole thing, from the menu row. One reading at a time.
  async copyFromImage(src, webview) {
    if (this._busy) { window.showToast?.('A picture is already being read'); return false; }
    this._busy = true;
    const controller = new AbortController();
    let card = null;
    const showCard = () => card || (card = this._card(() => {
      controller.abort();
      if (window.vex && window.vex.ocrLangCancel) window.vex.ocrLangCancel().catch(err => window.VexProblems?.note('Copy text from image', 'the download could not be cancelled', err));
      if (card) card.close();
    }));
    try {
      const dataUrl = await this.imageData(src, webview);
      if (dataUrl == null) return false;
      let english = false;
      const mode = await this.ensurePack((p) => showCard().say('Downloading the text recognition data…', p.total ? p.received / p.total : 0));
      if (mode === 'declined') {
        if (!(await this.legacyEnglishCached())) { window.showToast?.('The picture was not read: it needs the language data, and nothing was downloaded'); return false; }
        english = true;
        window.showToast?.('Reading English only: Turkish letters may come out wrong', 'info', 6000);
      } else {
        showCard().say('Preparing…', 0);
        await this.seedCache(await window.vex.ocrLangStatus());
      }
      showCard().say('Reading the text in the picture…', 0);
      const img = await this.shrink(dataUrl);
      const text = await this.recognize(img.dataUrl, { english, signal: controller.signal, onProgress: (f) => showCard().say('Reading the text in the picture…', f) });
      if (!text) { window.showToast?.('No readable text in that picture'); return false; }
      await this.copy(text);
      return true;
    } catch (err) {
      if ((err && err.name === 'AbortError') || controller.signal.aborted) { window.showToast?.('Cancelled'); return false; }
      window.VexProblems?.note('Copy text from image', 'the picture could not be read', err);
      window.showToast?.(this.say('The text could not be read: {}', (err && err.message) || String(err)), 'error');
      return false;
    } finally {
      this._busy = false;
      if (card) card.close();
    }
  },

  init() {
    if (this._started) return this;
    this._started = true;
    if (typeof VexExtras !== 'undefined') {
      VexExtras.registerCommand({
        id: 'remove-ocr-data', label: 'Remove text recognition data', icon: 'trash',
        hint: 'Deletes the English and Turkish data Copy Text from Image downloaded (about 5.1 MB); it asks again next time',
        keywords: 'remove delete ocr text recognition language data turkish tesseract copy text from image',
        action: () => { this.removePack().then(() => window.showToast?.('The text recognition data was removed'), err => window.showToast?.(err.message, 'error')); },
      });
    }
    return this;
  },
};

if (typeof window !== 'undefined') {
  window.VexImageText = VexImageText;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => VexImageText.init(), { once: true });
    else VexImageText.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexImageText };
