// === Photo preparer (T3-105) ======================================================
//
// For the picture a form asks for ("a 35 x 45 mm photo, JPEG, under 500 KB"): you choose
// one picture file, pick a size, and Vex makes a NEW file at that size, cropped to fit,
// as small as the limit needs, with everything but the pixels dropped (location, camera
// and date details do not survive being redrawn). The original is never changed, and the
// picture never leaves this computer: the work is done in this window with a canvas, the
// only thing main does is show the two file dialogs (src/main/photo-prep.js). There is no
// network code anywhere in this path.
//
// Not covered: documents (shrinking a PDF, or making one from pictures), recognising a face
// or checking the photo against an authority's rules. The sizes below are typical, not
// official: check the form's own rules and edit the numbers.
const VexPhotoPrep = {
  ENABLED_KEY: 'vex.photoPrep.enabled',
  FEATURE: 'photo-prep',
  MAX_SIDE: 6000,

  // width/height are pixels. 35 x 45 mm at 300 dpi is 413 x 531; 50 x 60 mm is 591 x 709.
  PRESETS: [
    { id: 'id-35x45', label: 'Passport / ID photo, 35 x 45 mm (413 x 531)', width: 413, height: 531, fit: 'cover', format: 'jpeg', maxKB: 500 },
    { id: 'id-50x60', label: 'Biometric photo, 50 x 60 mm (591 x 709)', width: 591, height: 709, fit: 'cover', format: 'jpeg', maxKB: 500 },
    { id: 'jpg-500', label: 'Form upload, JPEG under 500 KB (longest side 1600)', maxSide: 1600, fit: 'contain', format: 'jpeg', maxKB: 500 },
    { id: 'jpg-100', label: 'Form upload, JPEG under 100 KB (longest side 1000)', maxSide: 1000, fit: 'contain', format: 'jpeg', maxKB: 100 },
    { id: 'pdf-300', label: 'Document scan as a PDF under 300 KB (one page, longest side 1600)', maxSide: 1600, fit: 'contain', format: 'pdf', maxKB: 300 },
    { id: 'png-keep', label: 'PNG, longest side 1600', maxSide: 1600, fit: 'contain', format: 'png', maxKB: 0 },
  ],

  enabled() {
    try { return localStorage.getItem(this.ENABLED_KEY) === 'true'; }
    catch (err) { console.error('[PhotoPrep] the switch could not be read:', err); return false; }
  },
  setEnabled(on) { localStorage.setItem(this.ENABLED_KEY, on ? 'true' : 'false'); this.registerCommands(); },

  // ---- pure ----------------------------------------------------------------------------------
  // Where to cut from the source and how big to draw it. cover: fill width x height, cutting the overflow
  // evenly from both sides. contain: fit inside (width x height, or maxSide on the longest side), no cutting.
  // -> { sx, sy, sw, sh, dw, dh }
  plan(srcW, srcH, { width = 0, height = 0, maxSide = 0, fit = 'contain' } = {}) {
    const W = Math.floor(srcW), H = Math.floor(srcH);
    if (!(W > 0 && H > 0)) throw new Error('The picture has no size');
    if (fit === 'cover') {
      if (!(width > 0 && height > 0)) throw new Error('Choose a width and a height');
      if (width > this.MAX_SIDE || height > this.MAX_SIDE) throw new Error('The size is larger than ' + this.MAX_SIDE + ' pixels');
      const want = width / height;
      let sw = W, sh = H;
      if (W / H > want) sw = Math.round(H * want); else sh = Math.round(W / want);
      return { sx: Math.round((W - sw) / 2), sy: Math.round((H - sh) / 2), sw, sh, dw: Math.floor(width), dh: Math.floor(height) };
    }
    let boxW = width > 0 ? width : 0, boxH = height > 0 ? height : 0;
    if (maxSide > 0) { boxW = boxW || maxSide; boxH = boxH || maxSide; boxW = Math.min(boxW, maxSide); boxH = Math.min(boxH, maxSide); }
    if (!boxW || !boxH) throw new Error('Choose a size');
    if (boxW > this.MAX_SIDE || boxH > this.MAX_SIDE) throw new Error('The size is larger than ' + this.MAX_SIDE + ' pixels');
    // Never enlarge: a small picture stays as it is.
    const k = Math.min(1, boxW / W, boxH / H);
    return { sx: 0, sy: 0, sw: W, sh: H, dw: Math.max(1, Math.round(W * k)), dh: Math.max(1, Math.round(H * k)) };
  },
  // The best JPEG quality (0.3 .. 0.95) whose encoding is within maxBytes, by bisection. encode(q) -> Promise<{ size }>
  // (any object with a byte length). Returns { quality, result } or throws when even the lowest quality is too big.
  async fitQuality(encode, maxBytes) {
    if (!(maxBytes > 0)) { const r = await encode(0.92); return { quality: 0.92, result: r }; }
    let lo = 0.3, hi = 0.95, best = null;
    const top = await encode(hi);
    if (top.size <= maxBytes) return { quality: hi, result: top };
    const bottom = await encode(lo);
    if (bottom.size > maxBytes) throw new Error('smaller-needed');
    best = { quality: lo, result: bottom };
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2;
      const r = await encode(mid);
      if (r.size <= maxBytes) { best = { quality: mid, result: r }; lo = mid; } else hi = mid;
    }
    return best;
  },
  // photo.heic is not offered, photo.jpeg -> photo-prepared.jpg
  outName(name, format) {
    const base = String(name || 'photo').replace(/\.[^.]*$/, '').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'photo';
    return base + '-prepared.' + (format === 'png' ? 'png' : (format === 'pdf' ? 'pdf' : 'jpg'));
  },

  // ---- a one-page PDF around a JPEG (pure; no library) -----------------------------------------------
  // The JPEG is embedded as it is (DCTDecode), so the PDF is the picture plus about 600 bytes. The page is the
  // picture's size at 150 dpi. Used by the "PDF under 300 KB" preset; merging, splitting and so on stay in the PDF toolkit.
  PDF_OVERHEAD: 700,
  pdfFromJpeg(jpeg, width, height) {
    if (!(jpeg instanceof Uint8Array) || jpeg.length < 4 || jpeg[0] !== 0xFF || jpeg[1] !== 0xD8) throw new Error('That is not a JPEG picture');
    const w = Math.round(width), h = Math.round(height);
    if (!(w > 0 && h > 0)) throw new Error('The picture has no size');
    const pw = (w * 72 / 150).toFixed(2), ph = (h * 72 / 150).toFixed(2);
    const enc = (str) => { const b = new Uint8Array(str.length); for (let i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 0xFF; return b; };
    const content = 'q ' + pw + ' 0 0 ' + ph + ' 0 0 cm /Im0 Do Q';
    const chunks = [];
    const offsets = [];
    let pos = 0;
    const push = (b) => { chunks.push(b); pos += b.length; };
    push(enc('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'));
    const obj = (n, body) => { offsets[n] = pos; push(enc(n + ' 0 obj\n' + body + '\nendobj\n')); };
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw + ' ' + ph + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
    offsets[4] = pos;
    push(enc('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n'));
    push(jpeg);
    push(enc('\nendstream\nendobj\n'));
    obj(5, '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
    const xref = pos;
    let table = 'xref\n0 6\n0000000000 65535 f \n';
    for (let n = 1; n <= 5; n++) table += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
    push(enc(table + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n'));
    const out = new Uint8Array(pos);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  },

  // ---- the work (canvas) ------------------------------------------------------------------------
  async _bitmap(bytes, mime) {
    // 'from-image' applies the camera's rotation; drawing the bitmap drops every other detail.
    return createImageBitmap(new Blob([bytes], { type: mime }), { imageOrientation: 'from-image' });
  },
  _toBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => { canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be encoded'))), type, quality); });
  },
  // opts: a preset's fields (width, height, maxSide, fit, format, maxKB). -> { blob, width, height, quality }
  async render(bitmap, opts) {
    const p = this.plan(bitmap.width, bitmap.height, opts);
    const type = opts.format === 'png' ? 'image/png' : 'image/jpeg';
    let scale = 1;
    for (let attempt = 0; attempt < 8; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(p.dw * scale));
      canvas.height = Math.max(1, Math.round(p.dh * scale));
      const g = canvas.getContext('2d');
      if (!g) throw new Error('A drawing surface could not be made');
      if (type === 'image/jpeg') { g.fillStyle = '#ffffff'; g.fillRect(0, 0, canvas.width, canvas.height); }
      g.imageSmoothingQuality = 'high';
      g.drawImage(bitmap, p.sx, p.sy, p.sw, p.sh, 0, 0, canvas.width, canvas.height);
      if (type === 'image/png') {
        const blob = await this._toBlob(canvas, type);
        return { blob, width: canvas.width, height: canvas.height, quality: null };
      }
      try {
        const wrap = opts.format === 'pdf';
        const fit = await this.fitQuality(async (q) => this._toBlob(canvas, type, q), (opts.maxKB || 0) * 1024 - (wrap ? this.PDF_OVERHEAD : 0));
        if (wrap) {
          const pdf = this.pdfFromJpeg(new Uint8Array(await fit.result.arrayBuffer()), canvas.width, canvas.height);
          return { blob: new Blob([pdf], { type: 'application/pdf' }), width: canvas.width, height: canvas.height, quality: fit.quality, pdf: true };
        }
        return { blob: fit.result, width: canvas.width, height: canvas.height, quality: fit.quality };
      } catch (err) {
        if (!(err && err.message === 'smaller-needed')) throw err;
        // Even the lowest quality is too big: draw it smaller and try again.
        scale *= 0.85;
      }
    }
    throw new Error('Could not get the picture under ' + opts.maxKB + ' KB. Choose a smaller size.');
  },

  // ---- document expiry reminders ----------------------------------------------------------------------
  // Passport, ID card, student card, residence permit: you type what it is and when it expires, and Vex sets
  // reminders 90, 30 and 7 days before (09:00 local time; a date that is already past is skipped). Only the label
  // and the date are kept, never the document number. Reminders are the ordinary Vex reminders (Ctrl+K, Reminders).
  EXPIRY_KEY: 'vex.photoPrep.expiries',
  LEADS: [90, 30, 7],
  MAX_DOCS: 20,
  docs() {
    const raw = localStorage.getItem(this.EXPIRY_KEY);
    if (raw == null) return [];
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('Your document dates could not be read: ' + err.message); }
    return Array.isArray(v) ? v.filter(d => d && typeof d.id === 'string' && typeof d.label === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.expires)) : [];
  },
  _saveDocs(list) {
    try { localStorage.setItem(this.EXPIRY_KEY, JSON.stringify(list)); }
    catch (err) { throw new Error('Could not save your document dates: ' + err.message); }
  },
  // Pure: [{ daysBefore, at }] still in the future. `expires` is YYYY-MM-DD.
  reminderTimes(expires, now = Date.now(), leads = this.LEADS) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(expires));
    if (!m) throw new Error('Use a date like 2027-03-31');
    const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 9, 0, 0);
    if (Number.isNaN(end.getTime()) || end.getMonth() !== Number(m[2]) - 1) throw new Error('That is not a real date');
    return leads.map(d => ({ daysBefore: d, at: new Date(end.getFullYear(), end.getMonth(), end.getDate() - d, 9, 0, 0).getTime() })).filter(r => r.at > now);
  },
  addDoc(label, expires, now = Date.now()) {
    const name = String(label || '').trim().slice(0, 60);
    if (!name) throw new Error('Say which document it is, like Passport');
    const times = this.reminderTimes(expires, now);
    if (new Date(expires + 'T23:59:59').getTime() <= now) throw new Error('That date has already passed');
    const list = this.docs();
    if (list.length >= this.MAX_DOCS) throw new Error('Keep at most ' + this.MAX_DOCS + ' documents here');
    const doc = { id: 'd' + now.toString(36) + Math.random().toString(36).slice(2, 6), label: name, expires, reminders: [] };
    list.push(doc);
    this._saveDocs(list);
    return { doc, times };
  },
  async scheduleDoc(id, now = Date.now()) {
    const bridge = window.vex && window.vex.reminders;
    if (!bridge || typeof bridge.create !== 'function') throw new Error('Reminders are not available in this window');
    const list = this.docs();
    const doc = list.find(d => d.id === id);
    if (!doc) throw new Error('That document is not in the list');
    const made = [];
    for (const t of this.reminderTimes(doc.expires, now)) {
      const r = await bridge.create(doc.label + ' expires on ' + doc.expires + ' (' + t.daysBefore + ' days from now)', t.at);
      if (r && r.id) made.push(r.id);
    }
    doc.reminders = (doc.reminders || []).concat(made);
    this._saveDocs(list);
    return made.length;
  },
  async removeDoc(id) {
    const list = this.docs();
    const doc = list.find(d => d.id === id);
    if (!doc) return false;
    const bridge = window.vex && window.vex.reminders;
    if (bridge && typeof bridge.delete === 'function') for (const rid of doc.reminders || []) await bridge.delete(rid);
    this._saveDocs(list.filter(d => d.id !== id));
    return true;
  },

  // ---- requirements page -> checklist --------------------------------------------------------------------
  // Paste what the form's page asks for (or read the page in front); Vex lists each requirement as a tick-box,
  // pulls out the size / format / weight limits it can recognise and says which preset above fits. A word match:
  // read the original too. Nothing is sent anywhere.
  CUE: /\b(must|should|required|requirement|need(?:s|ed)?\s+to|please\s+(?:bring|attach|provide|submit|upload|include)|do\s+not|don't|no\s+more\s+than|at\s+least|at\s+most|not\s+exceed|within|valid\s+for|original|photocopy|copy\s+of|certified|gerekli|zorunlu|getirin|yüklen\w*|fotokopi|onaylı)\b/i,
  checklistFrom(text) {
    const lines = String(text == null ? '' : text).replace(/\r/g, '').split(/\n+/);
    const seen = new Set();
    const out = [];
    const add = (s) => {
      const t = s.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, '').replace(/\s+/g, ' ').trim().replace(/[;,]$/, '');
      if (t.length < 6 || t.length > 200) return;
      const k = t.toLowerCase();
      if (seen.has(k) || out.length >= 40) return;
      seen.add(k); out.push(t);
    };
    for (const line of lines) {
      if (/^\s*(?:[-*•·]|\d+[.)])\s+\S/.test(line)) { add(line); continue; }
      for (const sent of line.split(/(?<=[.!?])\s+/)) if (this.CUE.test(sent)) add(sent);
    }
    return out;
  },
  // Pure: what the text says about the file. -> { sizeMm, maxKB, formats, hints, preset }
  limitsFrom(text) {
    const t = String(text == null ? '' : text);
    const res = { sizeMm: null, maxKB: null, formats: [], hints: [], preset: null };
    const mm = /(\d{2,3})\s*(?:x|×|by)\s*(\d{2,3})\s*mm/i.exec(t);
    if (mm) res.sizeMm = [Number(mm[1]), Number(mm[2])];
    const kb = [...t.matchAll(/(?:under|below|less\s+than|no\s+more\s+than|max(?:imum)?(?:\s+size)?(?:\s+of)?|not\s+(?:exceed|more\s+than)|up\s+to|en\s+fazla)\s*:?\s*(\d+(?:[.,]\d+)?)\s*(kb|mb)/gi)];
    for (const m of kb) {
      const n = Number(m[1].replace(',', '.')) * (m[2].toLowerCase() === 'mb' ? 1024 : 1);
      if (res.maxKB == null || n < res.maxKB) res.maxKB = Math.round(n);
    }
    for (const f of ['PDF', 'JPG', 'JPEG', 'PNG']) if (new RegExp('\\b' + f + '\\b', 'i').test(t)) res.formats.push(f);
    if (/white\s+(?:background|backdrop)|beyaz\s+fon/i.test(t)) res.hints.push('White background');
    const rec = /(?:taken\s+)?(?:within|in)\s+the\s+(?:last|past)\s+(\d+)\s+(months?|weeks?|days?)|son\s+(\d+)\s+ay/i.exec(t);
    if (rec) res.hints.push('Recent photo: ' + rec[0]);
    if (/colou?r\s+photo|renkli/i.test(t)) res.hints.push('Colour photo');
    if (res.sizeMm) {
      const k = res.sizeMm.join('x');
      if (k === '35x45') res.preset = 'id-35x45'; else if (k === '50x60') res.preset = 'id-50x60';
    }
    if (!res.preset) {
      if (res.formats.includes('PDF') && (res.maxKB == null || res.maxKB >= 300)) res.preset = 'pdf-300';
      else if (res.maxKB != null && res.maxKB <= 100) res.preset = 'jpg-100';
      else if (res.maxKB != null && res.maxKB <= 500) res.preset = 'jpg-500';
    }
    return res;
  },
  checklistText(items, limits) {
    const lines = items.map(i => '- [ ] ' + i);
    if (limits && limits.sizeMm) lines.push('- [ ] Photo size ' + limits.sizeMm.join(' x ') + ' mm');
    if (limits && limits.maxKB) lines.push('- [ ] File under ' + limits.maxKB + ' KB');
    return lines.join('\n');
  },
  async _pageText() {
    if (typeof WebviewManager === 'undefined' || typeof TabManager === 'undefined') throw new Error('Tabs are not loaded');
    const wv = WebviewManager.getActiveWebview?.();
    if (!wv || typeof wv.executeJavaScript !== 'function') throw new Error('There is no page in front to read');
    const tab = TabManager.getActiveTab?.();
    if (window.VexTabPolicy && tab && !window.VexTabPolicy.canRestore(tab)) throw new Error('This is a private tab: it is not read here');
    const text = await Promise.race([
      wv.executeJavaScript('document.body ? document.body.innerText : ""'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('The page did not answer in time')), 4000)),
    ]);
    return String(text || '').slice(0, 60000);
  },
  openChecklist() {
    if (!this.enabled()) throw new Error('The photo preparer is switched off in Settings');
    const { body } = VexSettingsGroups.dialog({ id: 'photo-checklist', title: 'Requirements to checklist', sub: 'Paste what the form or office asks for, or read the page in front. Nothing leaves this computer.' });
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    const ta = document.createElement('textarea'); ta.rows = 6; ta.style.width = '100%'; ta.setAttribute('aria-label', 'Requirements text');
    const out = this._el('div', '');
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const make = () => {
      const items = this.checklistFrom(ta.value);
      const limits = this.limitsFrom(ta.value);
      out.textContent = '';
      if (!items.length) { out.appendChild(this._el('p', 'setting-info', 'No requirements were recognised. Paste the list as lines, or sentences with "must", "required" or "please bring".')); return; }
      for (const i of items) {
        const lab = document.createElement('label'); lab.style.display = 'block';
        const cb = document.createElement('input'); cb.type = 'checkbox';
        lab.append(cb, document.createTextNode(' ' + i));
        out.appendChild(lab);
      }
      const facts = [];
      if (limits.sizeMm) facts.push('size ' + limits.sizeMm.join(' x ') + ' mm');
      if (limits.maxKB) facts.push('file under ' + limits.maxKB + ' KB');
      if (limits.formats.length) facts.push('format ' + limits.formats.join('/'));
      facts.push(...limits.hints);
      if (facts.length) out.appendChild(this._el('p', 'setting-info', 'Limits noticed: ' + facts.join('; ') + '.' + (limits.preset ? ' The "' + (this.PRESETS.find(p => p.id === limits.preset) || {}).label + '" size fits.' : '')));
      const copy = this._el('button', 'btn-secondary', 'Copy as a list'); copy.type = 'button';
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(this.checklistText(items, limits)); window.showToast?.('Copied', 'success'); } catch (err) { fail(err); } });
      out.appendChild(copy);
      if (typeof AgentTools !== 'undefined' && typeof AgentTools.saveNote === 'function') {
        const note = this._el('button', 'btn-secondary', 'Save as a note'); note.type = 'button';
        note.addEventListener('click', () => { try { AgentTools.saveNote('Checklist', this.checklistText(items, limits)); window.showToast?.('Saved as a note', 'success'); } catch (err) { fail(err); } });
        out.appendChild(note);
      }
    };
    const row = this._el('div', 'ad-actions');
    const read = this._el('button', 'btn-secondary', 'Read the page in front'); read.type = 'button';
    read.addEventListener('click', async () => { try { ta.value = await this._pageText(); make(); } catch (err) { fail(err); } });
    const go = this._el('button', 'btn-primary', 'Make the checklist'); go.type = 'button';
    go.addEventListener('click', make);
    row.append(read, go);
    body.append(ta, row, out);
  },
  openDocs() {
    if (!this.enabled()) throw new Error('The photo preparer is switched off in Settings');
    const { body } = VexSettingsGroups.dialog({ id: 'photo-expiry', title: 'Document expiry reminders', sub: 'Reminders 90, 30 and 7 days before a passport, ID or student card expires. Only the name and the date are kept.' });
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const list = this._el('div', '');
    const draw = () => {
      list.textContent = '';
      let docs = [];
      try { docs = this.docs(); } catch (err) { list.appendChild(this._el('p', 'setting-info', err.message)); return; }
      if (!docs.length) list.appendChild(this._el('p', 'setting-info', 'No documents yet.'));
      for (const d of docs) {
        const row = this._el('div', 'ad-actions');
        row.appendChild(this._el('span', '', d.label + ' - expires ' + d.expires + ' (' + (d.reminders || []).length + ' reminders set)'));
        const rm = this._el('button', 'btn-secondary', 'Remove'); rm.type = 'button'; rm.setAttribute('aria-label', 'Remove ' + d.label + ' and its reminders');
        rm.addEventListener('click', async () => { try { await this.removeDoc(d.id); draw(); } catch (err) { fail(err); } });
        row.appendChild(rm);
        list.appendChild(row);
      }
    };
    const label = document.createElement('input'); label.type = 'text'; label.maxLength = 60; label.placeholder = 'Passport'; label.setAttribute('aria-label', 'Document');
    const date = document.createElement('input'); date.type = 'date'; date.setAttribute('aria-label', 'Expiry date');
    const add = this._el('button', 'btn-primary', 'Add and set reminders'); add.type = 'button';
    add.addEventListener('click', async () => {
      add.disabled = true;
      try {
        const { doc } = this.addDoc(label.value, date.value);
        const n = await this.scheduleDoc(doc.id);
        window.showToast?.(n + ' reminder' + VexPlural.s(n) + ' set', 'success');
        label.value = ''; date.value = '';
      } catch (err) { fail(err); }
      add.disabled = false;
      draw();
    });
    const form = this._el('div', 'ad-actions');
    form.append(label, date, add);
    body.append(form, list);
    draw();
  },

  // ---- the window --------------------------------------------------------------------------------
  _el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; },
  async open() {
    if (!this.enabled()) throw new Error('The photo preparer is switched off in Settings');
    if (!window.vex || typeof window.vex.photoprepOpen !== 'function') throw new Error('The photo preparer is not available in this window');
    const picked = await window.vex.photoprepOpen();
    if (!picked || picked.canceled) return false;
    const bitmap = await this._bitmap(picked.bytes, picked.mime);
    const { body } = VexSettingsGroups.dialog({ id: 'photo-prep', title: 'Prepare a picture', sub: picked.name + ' (' + bitmap.width + ' x ' + bitmap.height + ', ' + Math.round(picked.bytes.length / 1024) + ' KB). A new file is made; the original is not touched and nothing is uploaded.' });
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const sel = document.createElement('select'); sel.className = 'set-input'; sel.setAttribute('aria-label', 'Size');
    for (const p of this.PRESETS) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.label; sel.appendChild(o); }
    body.appendChild(sel);
    const out = this._el('p', 'setting-info', 'Pick a size, then press Prepare.');
    out.setAttribute('aria-live', 'polite');
    const prev = this._el('div', '');
    const go = this._el('button', 'btn-primary', 'Prepare'); go.type = 'button';
    const save = this._el('button', 'btn-secondary', 'Save as a new file...'); save.type = 'button'; save.disabled = true;
    let made = null;
    go.addEventListener('click', async () => {
      go.disabled = true; save.disabled = true; made = null;
      try {
        const preset = this.PRESETS.find(p => p.id === sel.value);
        const r = await this.render(bitmap, preset);
        made = { ...r, bytes: new Uint8Array(await r.blob.arrayBuffer()), format: preset.format };
        out.textContent = r.width + ' x ' + r.height + ', ' + Math.max(1, Math.round(r.blob.size / 1024)) + ' KB' + (r.quality ? ' (JPEG quality ' + Math.round(r.quality * 100) + ')' : '') + '. Location, camera and date details are not in the new file.';
        prev.textContent = '';
        if (r.pdf) { prev.appendChild(this._el('p', 'setting-info', 'A one-page PDF with your picture in it, ' + Math.max(1, Math.round(r.blob.size / 1024)) + ' KB.')); save.disabled = false; go.disabled = false; return; }
        const img = document.createElement('img');
        img.alt = 'Preview of the prepared picture';
        img.style.cssText = 'max-width:100%;max-height:260px;border:1px solid var(--border);border-radius:8px';
        img.src = URL.createObjectURL(r.blob);
        img.addEventListener('load', () => URL.revokeObjectURL(img.src), { once: true });
        prev.appendChild(img);
        save.disabled = false;
      } catch (err) { fail(err); }
      go.disabled = false;
    });
    save.addEventListener('click', async () => {
      try {
        if (!made) throw new Error('Press Prepare first');
        const r = await window.vex.photoprepSave(made.bytes, this.outName(picked.name, made.format));
        if (r && !r.canceled) window.showToast?.('Saved ' + Math.round(r.bytes / 1024) + ' KB to ' + r.path);
      } catch (err) { fail(err); }
    });
    const row = this._el('div', 'ad-actions');
    row.append(go, save);
    body.append(row, out, prev);
    body.appendChild(this._el('p', 'setting-info', 'Sizes are typical, not official: check what the form asks for. The PDF size makes a one-page PDF from a picture; merging and splitting PDFs is in the PDF toolkit.'));
    return true;
  },

  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return false;
    VexModuleCommands.set('photoprep:', this.enabled() ? [
      { id: 'photoprep:open', label: 'Prepare a picture for a form', icon: 'image', hint: 'Resize, crop and shrink a photo locally into a new file', action: () => { this.open().catch((err) => window.showToast?.((err && err.message) || String(err), 'error')); } },
      { id: 'photoprep:checklist', label: 'Turn a requirements page into a checklist', icon: 'list', hint: 'Tick-boxes from what a form or office asks for, with its size and weight limits', action: () => { try { this.openChecklist(); } catch (err) { window.showToast?.((err && err.message) || String(err), 'error'); } } },
      { id: 'photoprep:expiry', label: 'Document expiry reminders', icon: 'calendar', hint: 'Remind me before a passport, ID or student card expires', action: () => { try { this.openDocs(); } catch (err) { window.showToast?.((err && err.message) || String(err), 'error'); } } },
    ] : []);
    return true;
  },

  settingsRows(body) {
    const S = VexSettingsGroup;
    body.appendChild(S.note('Pick a picture, choose a form\'s size (passport photo, "under 500 KB"...), and get a new file: resized, cropped, shrunk, with location and camera details dropped. Done on this computer; nothing is uploaded and the original is not changed.'));
    body.appendChild(S.toggle('Photo preparer', this.enabled(), (on) => { this.setEnabled(on); if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE); }, 'Ctrl+K > Prepare a picture'));
    if (this.enabled()) {
      body.appendChild(S.button('Choose a picture...', () => { this.open().catch((err) => window.showToast?.((err && err.message) || String(err), 'error')); }));
      body.appendChild(S.button('Requirements to checklist...', () => { try { this.openChecklist(); } catch (err) { window.showToast?.(err.message, 'error'); } }));
      body.appendChild(S.button('Document expiry reminders...', () => { try { this.openDocs(); } catch (err) { window.showToast?.(err.message, 'error'); } }));
    }
  },
};

if (typeof window !== 'undefined') {
  window.VexPhotoPrep = VexPhotoPrep;
  VexPhotoPrep.registerCommands();
  document.addEventListener('DOMContentLoaded', () => VexPhotoPrep.registerCommands());
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'photo-prep', title: 'Photo preparer', keywords: 'photo picture resize crop passport exif strip jpeg form biometric', before: 'about', render: (body) => VexPhotoPrep.settingsRows(body) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPhotoPrep };
