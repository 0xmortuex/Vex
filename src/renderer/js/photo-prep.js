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
    return base + '-prepared.' + (format === 'png' ? 'png' : 'jpg');
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
        const fit = await this.fitQuality(async (q) => this._toBlob(canvas, type, q), (opts.maxKB || 0) * 1024);
        return { blob: fit.result, width: canvas.width, height: canvas.height, quality: fit.quality };
      } catch (err) {
        if (!(err && err.message === 'smaller-needed')) throw err;
        // Even the lowest quality is too big: draw it smaller and try again.
        scale *= 0.85;
      }
    }
    throw new Error('Could not get the picture under ' + opts.maxKB + ' KB. Choose a smaller size.');
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
    body.appendChild(this._el('p', 'setting-info', 'Sizes are typical, not official: check what the form asks for. Documents (PDF) are not handled here.'));
    return true;
  },

  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return false;
    VexModuleCommands.set('photoprep:', this.enabled() ? [
      { id: 'photoprep:open', label: 'Prepare a picture for a form', icon: 'image', hint: 'Resize, crop and shrink a photo locally into a new file', action: () => { this.open().catch((err) => window.showToast?.((err && err.message) || String(err), 'error')); } },
    ] : []);
    return true;
  },

  settingsRows(body) {
    const S = VexSettingsGroup;
    body.appendChild(S.note('Pick a picture, choose a form\'s size (passport photo, "under 500 KB"...), and get a new file: resized, cropped, shrunk, with location and camera details dropped. Done on this computer; nothing is uploaded and the original is not changed.'));
    body.appendChild(S.toggle('Photo preparer', this.enabled(), (on) => { this.setEnabled(on); if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE); }, 'Ctrl+K > Prepare a picture'));
    if (this.enabled()) body.appendChild(S.button('Choose a picture...', () => { this.open().catch((err) => window.showToast?.((err && err.message) || String(err), 'error')); }));
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
