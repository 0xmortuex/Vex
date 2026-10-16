// === Redaction tool for screenshots and images (T2-078) ========================
//
// Black out or pixelate parts of a picture before you share it. The on-device OCR that
// "Copy text" already uses (Tesseract, no network after its files are installed with Vex)
// SUGGESTS what to cover: email addresses, phone numbers, card-like numbers (the digits
// must pass the Luhn check), IBANs, long hex strings and long token-like strings. They are
// only suggestions: OCR misses things, so look at the picture, tick what you want covered
// and draw boxes over anything else by dragging.
//
// Everything happens in this window, on a canvas. The saved or copied picture is a fresh
// encode of the canvas pixels, so it carries no EXIF, location or camera data, and a
// covered area is replaced by flat pixels (a pixelate with blocks too large to read, or
// solid black), not by a filter that could be undone. An optional watermark line ("For
// the bank only, 2026-10-16") is drawn across the picture.
//
// Not done here: redacting inside PDFs and documents (it is pictures only for now).

const VexRedact = {
  PREF_KEY: 'vex.redact.enabled',
  MAX_SIDE: 6000,
  BLOCK: 14,           // pixelate block, in picture pixels, never less than this

  enabled() { try { return localStorage.getItem(this.PREF_KEY) !== 'false'; } catch { return true; } },
  setEnabled(on) { localStorage.setItem(this.PREF_KEY, on ? 'true' : 'false'); },

  // ---- pure: what looks sensitive --------------------------------------------------
  luhn(digits) {
    const d = String(digits).replace(/\D/g, '');
    if (d.length < 13 || d.length > 19) return false;
    let sum = 0, alt = false;
    for (let i = d.length - 1; i >= 0; i--) {
      let n = d.charCodeAt(i) - 48;
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    return sum % 10 === 0;
  },
  PATTERNS: [
    ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
    ['card', /\b(?:\d[ -]?){13,19}\b/g, (m) => /(?:\d[ -]?){13,19}/.test(m) && VexRedact.luhn(m)],
    ['iban', /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g],
    ['phone', /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,5}\d{2,4}/g, (m) => { const n = m.replace(/\D/g, '').length; return n >= 9 && n <= 15 && !VexRedact.luhn(m); }],
    ['hex', /\b[0-9a-fA-F]{32,}\b/g],
    ['token', /\b(?:ghp_|gho_|github_pat_|sk-|xox[bp]-|AKIA)[A-Za-z0-9_-]{10,}\b|\b(?=[A-Za-z0-9+/_=-]*[A-Z])(?=[A-Za-z0-9+/_=-]*[a-z])(?=[A-Za-z0-9+/_=-]*\d)[A-Za-z0-9+/_=-]{32,}\b/g],
  ],
  // lines: [{ words: [{ text, bbox: { x0, y0, x1, y1 } }] }] -> [{ kind, text, x, y, w, h }]
  findSensitive(lines) {
    const out = [];
    for (const line of lines || []) {
      const words = (line.words || []).filter(w => w && w.text && w.bbox);
      if (!words.length) continue;
      let text = '';
      const spans = words.map(w => { text += (text ? ' ' : '') + w.text; return { start: text.length - w.text.length, end: text.length, w }; });
      const taken = [];
      for (const [kind, re, ok] of this.PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text))) {
          if (m[0].length === 0) { re.lastIndex++; continue; }
          const a = m.index, b = m.index + m[0].length;
          if (ok && !ok(m[0])) continue;
          if (taken.some(([x, y]) => a < y && b > x)) continue;      // the stronger kind came first
          const hit = spans.filter(s => s.start < b && s.end > a);
          if (!hit.length) continue;
          taken.push([a, b]);
          const x0 = Math.min(...hit.map(s => s.w.bbox.x0)), y0 = Math.min(...hit.map(s => s.w.bbox.y0));
          const x1 = Math.max(...hit.map(s => s.w.bbox.x1)), y1 = Math.max(...hit.map(s => s.w.bbox.y1));
          out.push({ kind, text: m[0].slice(0, 12) + (m[0].length > 12 ? '…' : ''), x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        }
      }
    }
    return out;
  },
  pad(r, n, W, H) {
    const x = Math.max(0, Math.floor(r.x - n)), y = Math.max(0, Math.floor(r.y - n));
    return { ...r, x, y, w: Math.min(W, Math.ceil(r.x + r.w + n)) - x, h: Math.min(H, Math.ceil(r.y + r.h + n)) - y };
  },
  watermarkText(purpose, date = new Date()) {
    const p = String(purpose || '').trim().slice(0, 80);
    if (!p) return '';
    return 'For ' + p + ' only, ' + date.toISOString().slice(0, 10);
  },

  // ---- OCR with boxes -----------------------------------------------------------------
  async ocrLines(dataUrl) {
    const base = new URL('vendor/runtime/', window.location.href);
    const mod = await import(new URL('tesseract.mjs', base).href);
    const api = mod.default || mod;
    const worker = await api.createWorker('eng', 1, { workerPath: new URL('worker.min.js', base).href, corePath: base.href, workerBlobURL: false });
    try {
      const { data } = await worker.recognize(dataUrl, {}, { blocks: true });
      const lines = [];
      for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) lines.push({ words: l.words || [] });
      return lines;
    } finally { await worker.terminate(); }
  },

  // ---- drawing ---------------------------------------------------------------------------
  // Covers every `on` region of `regions` in canvas `c` (already holding the picture).
  cover(c, regions, mode) {
    const ctx = c.getContext('2d');
    for (const r of regions) {
      if (!r.on || r.w <= 0 || r.h <= 0) continue;
      if (mode === 'black') { ctx.fillStyle = '#000'; ctx.fillRect(r.x, r.y, r.w, r.h); continue; }
      const block = Math.max(this.BLOCK, Math.round(Math.min(r.w, r.h) / 3));
      const tw = Math.max(1, Math.round(r.w / block)), th = Math.max(1, Math.round(r.h / block));
      const tmp = document.createElement('canvas');
      tmp.width = tw; tmp.height = th;
      const tctx = tmp.getContext('2d');
      tctx.imageSmoothingEnabled = true;
      tctx.drawImage(c, r.x, r.y, r.w, r.h, 0, 0, tw, th);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, 0, 0, tw, th, r.x, r.y, r.w, r.h);
    }
  },
  watermark(c, text) {
    if (!text) return;
    const ctx = c.getContext('2d');
    const size = Math.max(14, Math.round(Math.min(c.width, c.height) / 28));
    ctx.save();
    ctx.font = '600 ' + size + 'px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(200,0,0,0.38)';
    ctx.textBaseline = 'middle';
    ctx.rotate(-Math.PI / 8);
    const step = size * 5, w = ctx.measureText(text).width + size * 2;
    for (let y = -c.width; y < c.height + c.width; y += step) for (let x = -c.height; x < c.width + c.height; x += w) ctx.fillText(text, x, y);
    ctx.restore();
  },
  // A fresh canvas of the picture with the covers and watermark. This is what leaves the tool.
  render(img, regions, mode, watermarkText) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    this.cover(c, regions, mode);
    this.watermark(c, watermarkText);
    return c;
  },
  toBlob(c, type = 'image/png') {
    return new Promise((resolve, reject) => c.toBlob(b => (b ? resolve(b) : reject(new Error('The picture could not be encoded'))), type, 0.92));
  },
  loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth > this.MAX_SIDE || img.naturalHeight > this.MAX_SIDE) reject(new Error('That picture is too large (over ' + this.MAX_SIDE + ' pixels on a side)'));
        else resolve(img);
      };
      img.onerror = () => reject(new Error('That is not a picture this tool can read'));
      img.src = src;
    });
  },

  // ---- the window -----------------------------------------------------------------------
  async open(dataUrl) {
    const img = await this.loadImage(dataUrl);
    const regions = [];
    let mode = 'pixelate', nextId = 1, drag = null;
    const { body, close } = window.PageExport._sheet('Redact a picture', 'vex-redact-overlay');
    const btn = 'font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer';
    const mk = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.style.cssText = btn; b.textContent = label; b.addEventListener('click', async () => { try { await fn(); } catch (err) { say(err.message || String(err)); } }); return b; };
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    status.style.cssText = 'padding:6px 14px;font-size:11.5px;color:var(--text-muted)';
    const say = (m) => { status.textContent = m; };

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'The picture. Drag to draw a box to cover.');
    canvas.style.cssText = 'display:block;max-width:100%;max-height:44vh;margin:0 auto;cursor:crosshair;touch-action:none';
    const list = document.createElement('div');
    list.style.cssText = 'padding:4px 14px;max-height:16vh;overflow:auto';

    const draw = () => {
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      this.cover(canvas, regions, mode);
      ctx.lineWidth = Math.max(2, canvas.width / 400);
      for (const r of regions) {
        ctx.strokeStyle = r.on ? '#1e90ff' : '#999';
        ctx.setLineDash(r.on ? [] : [6, 4]);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
      }
      if (drag) { ctx.setLineDash([]); ctx.strokeStyle = '#1e90ff'; ctx.strokeRect(drag.x, drag.y, drag.w, drag.h); }
      list.textContent = '';
      for (const r of regions) {
        const row = document.createElement('label');
        row.style.cssText = 'display:flex;gap:8px;align-items:center;font-size:12px;color:var(--text);margin:2px 0';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = r.on;
        cb.addEventListener('change', () => { r.on = cb.checked; draw(); });
        const t = document.createElement('span'); t.textContent = (r.manual ? 'Box you drew' : 'Suggested ' + r.kind + ' (' + r.text + ')');
        const rm = mk('Remove', () => { regions.splice(regions.indexOf(r), 1); draw(); });
        row.append(cb, t, rm);
        list.append(row);
      }
    };
    const toPicture = (e) => { const b = canvas.getBoundingClientRect(); return { x: (e.clientX - b.left) * canvas.width / b.width, y: (e.clientY - b.top) * canvas.height / b.height }; };
    canvas.addEventListener('pointerdown', (e) => { const p = toPicture(e); drag = { x0: p.x, y0: p.y, x: p.x, y: p.y, w: 0, h: 0 }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (!drag) return; const p = toPicture(e); drag = { ...drag, x: Math.min(drag.x0, p.x), y: Math.min(drag.y0, p.y), w: Math.abs(p.x - drag.x0), h: Math.abs(p.y - drag.y0) }; draw(); });
    canvas.addEventListener('pointerup', () => {
      if (drag && drag.w > 4 && drag.h > 4) regions.push({ id: nextId++, kind: 'box', text: '', manual: true, on: true, x: Math.round(drag.x), y: Math.round(drag.y), w: Math.round(drag.w), h: Math.round(drag.h) });
      drag = null; draw();
    });

    const wmInput = document.createElement('input');
    wmInput.type = 'text'; wmInput.placeholder = 'Watermark: what it is for (optional)'; wmInput.setAttribute('aria-label', 'Watermark purpose');
    wmInput.style.cssText = 'flex:1;min-width:140px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:12px';
    const modeBtn = mk('Style: pixelate', () => { mode = mode === 'pixelate' ? 'black' : 'pixelate'; modeBtn.textContent = 'Style: ' + (mode === 'pixelate' ? 'pixelate' : 'black box'); draw(); });

    const find = mk('Suggest what to cover (OCR)', async () => {
      say('Reading the picture on this computer…');
      const res = await window.VexJobs.heavy('Redaction OCR', () => this.ocrLines(dataUrl), { kind: 'ocr', feature: 'redact-tool' });
      if (!res.ran) throw new Error('Not now: ' + res.reason + '. Try again in a moment, or draw the boxes yourself.');
      const found = this.findSensitive(res.value).map(r => ({ ...this.pad(r, 3, canvas.width, canvas.height), id: nextId++, on: true, manual: false }));
      for (const f of found) regions.push(f);
      draw();
      say(found.length ? found.length + ' suggested. OCR can miss things: check the picture and draw a box over anything else.' : 'Nothing sensitive was recognised. OCR can miss things: look at the picture yourself.');
    });

    const output = async () => this.toBlob(this.render(img, regions, mode, this.watermarkText(wmInput.value)));
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:8px 14px';
    bar.append(find, modeBtn, wmInput,
      mk('Copy redacted picture', async () => { await navigator.clipboard.write([new ClipboardItem({ 'image/png': await output() })]); say('Copied. It carries no metadata.'); }),
      mk('Save redacted picture', async () => {
        const url = URL.createObjectURL(await output());
        const a = document.createElement('a');
        a.href = url; a.download = 'redacted-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.png';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        say('Saved to your downloads. It carries no metadata.');
      }));
    body.append(bar, canvas, list, status);
    draw();
    if (typeof VexUsage !== 'undefined') VexUsage.touch('redact-tool');
    return close;
  },

  // A picture file from disk with its metadata removed (EXIF, location, camera): re-encoded, never edited.
  async stripFile(file) {
    if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choose a PNG, JPEG or WebP picture');
    const url = URL.createObjectURL(file);
    try {
      const img = await this.loadImage(url);
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
      return { blob: await this.toBlob(c, type), type, name: file.name.replace(/\.[^.]+$/, '') + '-clean.' + (type === 'image/jpeg' ? 'jpg' : 'png') };
    } finally { URL.revokeObjectURL(url); }
  },
  async pickAndStrip() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp';
    const file = await new Promise((resolve) => { input.addEventListener('change', () => resolve(input.files && input.files[0]), { once: true }); input.click(); });
    if (!file) return null;
    const out = await this.stripFile(file);
    const url = URL.createObjectURL(out.blob);
    const a = document.createElement('a');
    a.href = url; a.download = out.name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    window.showToast?.('Saved ' + out.name + ' without metadata');
    return out;
  },
};

if (typeof window !== 'undefined') window.VexRedact = VexRedact;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexRedact };
