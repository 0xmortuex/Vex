// What the toolbar and the menus do that is more than a click on the document: save a copy, print, present, the properties,
// the shortcut sheet, the signature, and handing the PDF to the browser's own viewer.

import { t, getLang } from './strings.js';
import { el, openDialog, toast, formatBytes } from './ui.js';
import { toSavePayload, formValuesFrom } from './marks.js';

// ---- save a copy ---------------------------------------------------------------------------------------------
// The marks, the answers typed into the form and the turn of the pages are sent to Vex (main/pdf-viewer.js), which reads the PDF
// again through this page's own session and writes a copy where the person chooses. The PDF being read is never changed.
export async function saveCopy(ctx, { toDownloads = false } = {}) {
  const { store, pdf, viewer, host } = ctx;
  const marks = store.list();
  let values = {};
  try { values = formValuesFrom(await pdf.getFieldObjects(), pdf.annotationStorage.getAll() || {}); }
  catch (err) { toast(t('The form answers could not be read: {why}', { why: err.message }), { kind: 'error' }); return false; }
  const rotate = viewer.pagesRotation % 360;
  if (!marks.length && !Object.keys(values).length && !rotate) { toast(t('There is nothing to save yet: add a mark, fill a field or turn the pages first.')); return false; }
  let payload;
  try { payload = toSavePayload(marks); } catch (err) { toast(err.message, { kind: 'error' }); return false; }
  const request = { name: ctx.source.name, toDownloads, rotate };
  if (payload.length) request.marks = payload;
  if (Object.keys(values).length) request.values = values;
  if (payload.some((m) => m.kind === 'signature')) request.signature = ctx.state.signatureB64;
  const busy = toast(t('Making the copy...'), { ms: 60000 });
  let result;
  try { result = await host.saveCopy(request); } catch (err) { busy.remove(); toast(t('The copy could not be saved: {why}', { why: err.message }), { kind: 'error' }); return false; }
  busy.remove();
  if (!result || !result.ok) {
    const why = (result && result.error) || t('Vex gave no reason');
    toast(t('The copy could not be saved: {why}', { why }), { kind: 'error', action: { label: t('Try again'), run: () => saveCopy(ctx, { toDownloads }) } });
    return false;
  }
  if (result.cancelled) return false;
  store.markSaved();
  ctx.emitState();
  toast(t('Saved {name}', { name: result.name }), { action: { label: t('Show in folder'), run: () => host.reveal().catch((err) => toast(err.message, { kind: 'error' })) }, ms: 9000 });
  return true;
}

export async function downloadOriginal(ctx) {
  try {
    const r = await ctx.host.download();
    if (!r.ok) throw new Error(r.error);
    if (!r.cancelled) toast(r.viaDownloads ? t('The download has started. See the Downloads list.') : t('Saved {name}', { name: r.name }), r.name ? { action: { label: t('Show in folder'), run: () => ctx.host.reveal() } } : undefined);
  } catch (err) { toast(t('The PDF could not be downloaded: {why}', { why: err.message }), { kind: 'error' }); }
}

export async function openInBrowserViewer(ctx) {
  try {
    const r = await ctx.host.openNative();
    if (!r.ok) throw new Error(r.error);
  } catch (err) { toast(t('The browser\'s viewer could not be opened: {why}', { why: err.message }), { kind: 'error' }); }
}

// ---- print -------------------------------------------------------------------------------------------------------
// The pages are drawn one at a time at about 150 dots per inch (with the marks on them and the form answers), set in the page
// for the printer, and Vex's own print box is asked for. Drawing them one by one keeps a long document from filling the memory.
function drawMarksOnCanvas(g, marks, viewport) {
  const k = viewport.scale;
  const P = (x, y) => viewport.convertToViewportPoint(x, y);
  for (const m of marks) {
    g.save();
    g.strokeStyle = m.color; g.fillStyle = m.color; g.lineCap = 'round'; g.lineJoin = 'round';
    if (m.kind === 'highlight') {
      g.globalAlpha = 0.42;
      for (const r of m.rects) { const a = P(r.x, r.y), b = P(r.x + r.w, r.y + r.h); g.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); }
    } else if (m.kind === 'underline' || m.kind === 'strike') {
      g.lineWidth = Math.max(1, (m.width || 1) * k);
      for (const l of m.lines) { const a = P(l.x1, l.y1), b = P(l.x2, l.y2); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
    } else if (m.kind === 'ink') {
      g.lineWidth = (m.width || 1.5) * k; g.beginPath();
      m.points.forEach((p, i) => { const a = P(p[0], p[1]); if (i) g.lineTo(a[0], a[1]); else g.moveTo(a[0], a[1]); });
      g.stroke();
    } else if (m.kind === 'rect' || m.kind === 'ellipse') {
      g.lineWidth = (m.width || 1.5) * k;
      const a = P(m.x, m.y), b = P(m.x + m.w, m.y + m.h);
      const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
      g.beginPath();
      if (m.kind === 'rect') g.rect(x, y, w, h); else g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      g.stroke();
    } else if (m.kind === 'line') {
      g.lineWidth = (m.width || 1.5) * k;
      const a = P(m.x1, m.y1), b = P(m.x2, m.y2);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]);
      if (m.arrow) { const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), len = Math.max(8, g.lineWidth * 4.2); for (const side of [-1, 1]) { g.moveTo(b[0], b[1]); g.lineTo(b[0] + Math.cos(ang + Math.PI + side * 0.45) * len, b[1] + Math.sin(ang + Math.PI + side * 0.45) * len); } }
      g.stroke();
    } else if (m.kind === 'text') {
      const a = P(m.x, m.y);
      g.translate(a[0], a[1]);
      g.rotate(((viewport.rotation - (m.angle || 0)) * Math.PI) / 180);
      g.font = `${m.size * k}px Helvetica, Arial, sans-serif`;
      g.textBaseline = 'alphabetic';
      const lines = String(m.text).split('\n');
      lines.forEach((line, i) => g.fillText(line, 0, i * m.size * k * 1.25));
    }
    g.restore();
  }
}

export async function printDocument(ctx) {
  const { pdf, viewer, store } = ctx;
  const total = pdf.numPages;
  const current = viewer.currentPageNumber;
  const choice = await new Promise((resolve) => {
    const group = 'pv-print-range';
    const mk = (value, label, checked) => el('label', { class: 'pv-field' }, el('input', { type: 'radio', name: group, value, checked: checked ? true : null }), ' ', label);
    const range = el('input', { type: 'text', 'aria-label': t('Pages to print'), placeholder: '1-3, 5, 8-', style: { marginTop: '4px' } });
    const body = el('div', {}, mk('all', t('All {n} pages', { n: total }), true), mk('current', t('This page ({n})', { n: current })), mk('range', t('Pages:')), range);
    if (store.count()) body.append(el('p', { text: t('Your marks are printed too.') }));
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    openDialog({
      title: t('Print'), body, onCancel: () => done(null),
      actions: [
        { label: t('Cancel'), run: (close) => { close(); done(null); } },
        { label: t('Print'), primary: true, run: (close) => {
          const picked = body.querySelector('input[name="' + group + '"]:checked').value;
          let pages;
          try { pages = picked === 'all' ? Array.from({ length: total }, (_, i) => i + 1) : picked === 'current' ? [current] : parseRange(range.value, total); }
          catch (err) { toast(err.message, { kind: 'error' }); range.focus(); return; }
          close(); done(pages);
        } },
      ],
    });
  });
  if (!choice) return;
  const area = document.getElementById('pv-print-area');
  area.textContent = '';
  const state = ctx.showState({ kind: 'busy', title: t('Getting the pages ready'), text: t('Page {n} of {total}', { n: 0, total: choice.length }), progress: 0, actions: [{ label: t('Cancel'), run: () => { cancelled = true; } }] });
  let cancelled = false;
  try {
    const marks = store.list();
    const storage = pdf.annotationStorage;
    for (let i = 0; i < choice.length && !cancelled; i++) {
      state.update({ text: t('Page {n} of {total}', { n: i + 1, total: choice.length }), progress: i / choice.length });
      const page = await pdf.getPage(choice[i]);
      const vp = page.getViewport({ scale: 2, rotation: (page.rotate + viewer.pagesRotation) % 360 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
      const g = canvas.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: g, viewport: vp, annotationMode: 3, annotationStorage: storage }).promise;
      drawMarksOnCanvas(g, marks.filter((m) => m.page === choice[i]), vp);
      const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t('A page could not be drawn for printing')))), 'image/jpeg', 0.92));
      const img = el('img', { alt: '', src: URL.createObjectURL(blob) });
      await img.decode();
      area.append(el('div', { class: 'pv-print-page' }, img));
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
    if (cancelled) return;
    state.close();
    const r = await ctx.host.print();
    if (!r.ok && r.error !== 'cancelled') throw new Error(r.error);
  } catch (err) {
    state.close();
    toast(t('Printing did not start: {why}', { why: err.message }), { kind: 'error' });
  } finally {
    state.close();
    for (const img of area.querySelectorAll('img')) URL.revokeObjectURL(img.src);
    area.textContent = '';
  }
}

export function parseRange(text, total) {
  const spec = String(text || '').trim();
  if (!spec) throw new Error(t('Say which pages: for example 1-3, 5, 8-'));
  const out = [];
  for (const raw of spec.split(',')) {
    const part = raw.trim();
    const m = /^(\d*)\s*(-?)\s*(\d*)$/.exec(part);
    if (!part || !m || (!m[1] && !m[3])) throw new Error(t('"{part}" is not a page or a range of pages', { part }));
    let from, to;
    if (!m[2]) from = to = Number(m[1]); else { from = m[1] ? Number(m[1]) : 1; to = m[3] ? Number(m[3]) : total; }
    if (from < 1 || to < 1 || from > total || to > total) throw new Error(t('Page "{part}" is outside this PDF, which has {total} pages', { part, total }));
    if (from <= to) for (let p = from; p <= to; p++) out.push(p); else for (let p = from; p >= to; p--) out.push(p);
  }
  return out;
}

// ---- properties and shortcuts -------------------------------------------------------------------------------------
function pdfDate(value) {
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(String(value || ''));
  if (!m) return String(value || '');
  const d = new Date(Number(m[1]), Number(m[2] || 1) - 1, Number(m[3] || 1), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  return d.toLocaleString(getLang() === 'tr' ? 'tr-TR' : undefined);
}

export async function showProperties(ctx) {
  const { pdf, viewer } = ctx;
  let info = {}, size = null;
  try { const meta = await pdf.getMetadata(); info = meta.info || {}; } catch (err) { toast(t('The properties could not be read: {why}', { why: err.message }), { kind: 'error' }); return; }
  try { const d = await pdf.getDownloadInfo(); size = d && d.length; } catch (err) { console.warn('[PDF viewer] the size is not known:', err && err.message); }
  const first = await pdf.getPage(1);
  const vp = first.getViewport({ scale: 1 });
  const inch = (n) => n / 72;
  const dims = getLang() === 'tr' ? `${Math.round(inch(vp.width) * 25.4)} x ${Math.round(inch(vp.height) * 25.4)} mm` : `${inch(vp.width).toFixed(1)} x ${inch(vp.height).toFixed(1)} in (${Math.round(inch(vp.width) * 25.4)} x ${Math.round(inch(vp.height) * 25.4)} mm)`;
  const rows = [
    [t('File name'), ctx.source.name], [t('Title'), info.Title], [t('Author'), info.Author], [t('Subject'), info.Subject], [t('Keywords'), info.Keywords],
    [t('Created'), pdfDate(info.CreationDate)], [t('Modified'), pdfDate(info.ModDate)], [t('Created with'), info.Creator], [t('PDF producer'), info.Producer],
    [t('PDF version'), info.PDFFormatVersion], [t('Pages'), String(pdf.numPages)], [t('Page size'), dims], [t('File size'), size ? formatBytes(size) : ''],
    [t('Address'), ctx.source.original.replace(/^file:\/\/\//, '')],
  ].filter((r) => r[1]);
  const list = el('dl', { class: 'pv-props' });
  for (const [k, v] of rows) list.append(el('dt', { text: k }), el('dd', { text: String(v), dir: 'auto' }));
  void viewer;
  openDialog({ title: t('Document properties'), body: list, actions: [{ label: t('Close'), primary: true }] });
}

export const SHORTCUTS = [
  ['Find in the document', 'Ctrl+F'], ['Next / previous match', 'Enter / Shift+Enter'], ['Go to a page', 'Ctrl+G'], ['Next / previous page', 'N / P'],
  ['First / last page', 'Home / End'], ['Zoom in / out', 'Ctrl+= / Ctrl+-'], ['Actual size', 'Ctrl+0'], ['Fit width', 'Ctrl+1'], ['Fit page', 'Ctrl+2'],
  ['Rotate right / left', 'R / Shift+R'], ['Presentation', 'F'], ['Select text', 'V'], ['Hand', 'H'], ['Highlight', '1'], ['Underline', '2'], ['Strikethrough', '3'],
  ['Draw', 'D'], ['Text note', 'T'], ['Shapes', 'S'], ['Place a signature', 'G'], ['Undo / redo', 'Ctrl+Z / Ctrl+Y'], ['Delete the selected mark', 'Delete'],
  ['Save a copy', 'Ctrl+S'], ['Print', 'Ctrl+P'], ['Side panel', 'B'], ['This list', '?'],
];
export function showShortcuts() {
  const list = el('ul', { class: 'pv-keys' });
  for (const [what, keys] of SHORTCUTS) list.append(el('li', {}, el('span', { text: t(what) }), el('kbd', { text: keys })));
  openDialog({ title: t('Keyboard shortcuts'), body: list, actions: [{ label: t('Close'), primary: true }] });
}

// ---- signature ----------------------------------------------------------------------------------------------------------
// A drawn or typed picture of a name, placed on a page like a stamp. It is not a digital signature and proves nothing about who placed it.
function trimmed(canvas) {
  const g = canvas.getContext('2d');
  const { width, height } = canvas;
  const data = g.getImageData(0, 0, width, height).data;
  let x1 = width, y1 = height, x2 = -1, y2 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 8) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
  if (x2 < 0) return null;
  const pad = 6;
  x1 = Math.max(0, x1 - pad); y1 = Math.max(0, y1 - pad); x2 = Math.min(width - 1, x2 + pad); y2 = Math.min(height - 1, y2 + pad);
  const out = document.createElement('canvas');
  out.width = x2 - x1 + 1; out.height = y2 - y1 + 1;
  out.getContext('2d').drawImage(canvas, x1, y1, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}
async function canvasToPng(canvas) {
  const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t('The signature could not be made into a picture')))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function askSignature(ctx, then) {
  const s = ctx.state;
  const INK = '#10204a';
  const typed = el('input', { type: 'text', maxlength: '60', 'aria-label': t('Your name as a signature'), placeholder: t('Type your name'), 'data-autofocus': '' });
  const pad = el('canvas', { width: '560', height: '170', role: 'img', 'aria-label': t('Draw your signature here'), style: { width: '100%', border: '1px dashed var(--pv-line)', borderRadius: 'var(--pv-r)', background: '#fff', touchAction: 'none', cursor: 'crosshair', display: 'block' } });
  const g = pad.getContext('2d');
  g.lineWidth = 3.2; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = INK;
  let down = false, any = false;
  const pt = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; };
  pad.addEventListener('pointerdown', (e) => { down = true; any = true; const [x, y] = pt(e); g.beginPath(); g.moveTo(x, y); g.lineTo(x + 0.01, y); g.stroke(); pad.setPointerCapture(e.pointerId); });
  pad.addEventListener('pointermove', (e) => { if (!down) return; const [x, y] = pt(e); g.lineTo(x, y); g.stroke(); });
  for (const ev of ['pointerup', 'pointercancel']) pad.addEventListener(ev, () => { down = false; });
  const clear = el('button', { class: 'pv-action', type: 'button', text: t('Clear') });
  clear.addEventListener('click', () => { g.clearRect(0, 0, pad.width, pad.height); any = false; });
  const body = el('div', {},
    el('label', { class: 'pv-field' }, el('span', { text: t('Type your name') }), typed),
    el('div', { class: 'pv-field' }, el('span', { text: t('Or draw it') }), pad, el('div', { style: { marginTop: '6px' } }, clear)),
    el('p', { text: t('This is a picture of your name placed on the page, like a stamp. It is not a digital signature and proves nothing about who placed it.') }));
  const use = async (canvas, close) => {
    const cut = trimmed(canvas);
    if (!cut) { toast(t('Type or draw your signature first'), { kind: 'error' }); return; }
    // About 600 pixels wide is plenty, and keeps the picture small.
    const maxW = 700;
    let out = cut;
    if (cut.width > maxW) { out = document.createElement('canvas'); out.width = maxW; out.height = Math.round(cut.height * maxW / cut.width); out.getContext('2d').drawImage(cut, 0, 0, out.width, out.height); }
    const bytes = await canvasToPng(out);
    if (s.signatureUrl) URL.revokeObjectURL(s.signatureUrl);
    s.signaturePng = bytes;
    s.signatureB64 = toBase64(bytes);
    s.signatureUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    s.signatureRatio = out.height / out.width;
    close();
    if (then) then();
  };
  openDialog({
    title: t('Place a signature'), body,
    actions: [
      { label: t('Cancel') },
      { label: t('Use the typed name'), run: (close) => {
        const text = typed.value.trim();
        if (!text) { toast(t('Type your name first'), { kind: 'error' }); typed.focus(); return; }
        const c = document.createElement('canvas');
        c.width = 900; c.height = 220;
        const cg = c.getContext('2d');
        cg.fillStyle = INK; cg.textBaseline = 'middle';
        cg.font = 'italic 96px "Segoe Script", "Brush Script MT", cursive';
        cg.fillText(text, 24, 110, 850);
        use(c, close).catch((err) => toast(err.message, { kind: 'error' }));
      } },
      { label: t('Use the drawing'), primary: true, run: (close) => {
        if (!any) { toast(t('Draw your signature first'), { kind: 'error' }); return; }
        use(pad, close).catch((err) => toast(err.message, { kind: 'error' }));
      } },
    ],
  });
}
