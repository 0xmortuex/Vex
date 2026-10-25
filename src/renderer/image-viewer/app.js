// === Vex's own image viewer: the page ================================================================
//
// One picture, drawn by an <img> from a blob this page read through the tab's own session (see main/image-viewer.js). Everything
// the person can do to it is done here on this computer: fit, actual size, fill, zoom, pan, turn, flip, the details, copy, a copy of
// it with a turn, a crop or a resize (canvas) saved as a NEW file, the pictures beside it (a file: picture only), a slideshow and full screen.
// The picture itself is never changed. Nothing about it, its EXIF or its place is sent anywhere.

import { t, applyStatic } from './strings.js';
import { $, el, decorateIcons, setIcon, openMenu, closeMenu, menuIsOpen, toast, formatBytes } from './ui.js';
import * as G from './geometry.js';
import { readMeta, sniff, formatPlace } from './meta.js';
import { applyThemePayload, onThemeChange, refreshScheme } from './theme.js';

const host = window.vexImageHost || null;
const PREFS_KEY = 'iv.prefs';
const MIME_OF = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon' };
const NAME_OF = { 'image/png': 'PNG', 'image/apng': 'APNG', 'image/jpeg': 'JPEG', 'image/gif': 'GIF', 'image/webp': 'WebP', 'image/avif': 'AVIF', 'image/bmp': 'BMP', 'image/x-icon': 'ICO', 'image/vnd.microsoft.icon': 'ICO', 'image/svg+xml': 'SVG' };
const SLIDE_CHOICES = [3, 5, 10];
const META_BYTES = 64 * 1024 * 1024;

const S = {
  original: '', name: '', type: '', size: 0, nw: 0, nh: 0, meta: null, objectUrl: '', ready: false,
  turn: 0, flipX: false, flipY: false, zoom: 1, pan: { x: 0, y: 0 }, mode: 'fit',
  checker: false, info: false, edit: false, crop: null,
  urls: [], index: -1, slide: 0, slideTimer: 0, slideSeconds: 5,
  token: 0, abort: null, shown: false, loadingTimer: 0,
};

const stage = $('#iv-stage'), frame = $('#iv-frame'), img = $('#iv-img'), cropBox = $('#iv-crop');
const stateBox = $('#iv-state');

function savedPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; }
  catch (err) { console.error('[Image viewer] saved view settings are unreadable:', err.message); return {}; }
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ checker: S.checker, info: S.info, slideSeconds: S.slideSeconds })); }
  catch (err) { console.error('[Image viewer] view settings could not be kept:', err.message); }
}

const say = (text) => { $('#iv-live').textContent = ''; setTimeout(() => { $('#iv-live').textContent = text; }, 30); };
const eff = () => G.effective(S.nw, S.nh, S.turn);
const stageSize = () => ({ w: stage.clientWidth, h: stage.clientHeight });
const bad = (r) => !r || r.ok === false;
const needHost = () => { if (!host) throw new Error(t('This page has no connection to Vex')); return host; };

// ---- addresses ------------------------------------------------------------------------------------
function nameOf(original) {
  try {
    const u = new URL(original);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    return last || u.hostname || original;
  } catch { return original; }
}
function pageUrl(original) { return '/?u=' + encodeURIComponent(original); }
function originalFromLocation() {
  const u = new URL(location.href);
  return u.searchParams.get('u') || '';
}

// ---- loading --------------------------------------------------------------------------------------
function showState(kind, title, detail, actions) {
  stateBox.hidden = false;
  stateBox.dataset.kind = kind;
  stateBox.replaceChildren();
  stateBox.append(el('div', { class: 'iv-state-card', role: kind === 'error' ? 'alert' : null }));
  const card = stateBox.firstChild;
  const ico = el('span', { class: 'iv-state-ico', 'aria-hidden': 'true' });
  setIcon(ico, kind === 'error' ? 'warning' : 'image', 30);
  card.append(ico, el('h2', { text: title }));
  if (detail) card.append(el('p', { class: 'iv-state-detail', id: 'iv-state-detail', text: detail }));
  if (actions && actions.length) {
    const row = el('div', { class: 'iv-state-actions' });
    for (const a of actions) row.append(el('button', { class: 'iv-action' + (a.primary ? ' primary' : ''), type: 'button', text: a.label, onclick: a.run }));
    card.append(row);
    (row.querySelector('.primary') || row.firstChild).focus();
  }
}
const hideState = () => { stateBox.hidden = true; stateBox.replaceChildren(); };

const NEEDS_PICTURE = ['#iv-zoom-out', '#iv-zoom-in', '#iv-zoom-input', '#iv-fit', '#iv-actual', '#iv-fill', '#iv-rot-left', '#iv-rot-right', '#iv-flip-h', '#iv-flip-v',
  '#iv-checker', '#iv-copy', '#iv-edit-btn', '#iv-info-btn'];
// keepStage: the picture on screen stays while the next one is read (a slideshow does not flash), unless it is being replaced by an error.
function setReady(on, keepStage) {
  S.ready = on;
  for (const id of NEEDS_PICTURE) { const n = $(id); if (n) n.disabled = !on; }
  document.body.dataset.state = on ? 'ready' : 'idle';
  stage.hidden = !on && !(keepStage && S.shown);
  if (on) S.shown = true;
}

function failure(message) {
  clearTimeout(S.loadingTimer);
  S.shown = false;
  setReady(false);
  document.title = S.name || t('Picture');
  $('#iv-title').textContent = S.name || t('Picture');
  $('#iv-sub').textContent = '';
  showState('error', t('This picture could not be opened'), message, [
    { label: t('Try again'), primary: true, run: () => load(S.original) },
    { label: t("Open in the browser's own view"), run: openNative },
  ]);
}

async function load(original) {
  const token = ++S.token;
  if (S.abort) S.abort.abort();
  const abort = S.abort = new AbortController();
  S.original = original;
  S.name = nameOf(original);
  closeMenu(false);
  document.title = S.name;
  $('#iv-title').textContent = S.name;
  $('#iv-sub').textContent = '';
  const keep = S.shown;
  setReady(false, keep);
  clearTimeout(S.loadingTimer);
  // Only a read that takes a moment is announced: a picture next door opens without a flash.
  S.loadingTimer = setTimeout(() => { if (token === S.token && !S.ready) showState('loading', t('Opening the picture'), ''); }, keep ? 300 : 0);
  try {
    const res = await fetch('/doc?u=' + encodeURIComponent(original), { signal: abort.signal, cache: 'no-store' });
    if (token !== S.token) return;
    const upstream = Number(res.headers.get('x-vex-status')) || res.status;
    if (!res.ok || upstream >= 400) {
      const why = res.headers.get('x-vex-error');
      if (why === 'missing') throw new Error(t('That file is not there any more'));
      if (why === 'fetch') throw new Error(t('Vex could not reach the server. Check the connection and try again'));
      throw new Error(upstream >= 400 && upstream !== res.status ? t('The server answered {code}', { code: upstream }) : t('The server answered {code}', { code: res.status }));
    }
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0, last = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (token !== S.token) { reader.cancel().catch((err) => console.warn("[Image viewer] the old download could not be stopped:", err.message)); return; }
      const now = performance.now();
      if (now - last > 120 && got > 262144 && !stateBox.hidden) { last = now; showState('loading', t('Opening the picture'), total ? t('{got} of {total}', { got: formatBytes(got), total: formatBytes(total) }) : formatBytes(got)); }
    }
    if (!got) throw new Error(t('The file is empty'));
    let type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const head = chunks[0];
    const kind = sniff(head);
    if (!/^image\//.test(type) || (kind && MIME_OF[kind] && type !== MIME_OF[kind] && type !== 'image/svg+xml')) type = (kind && MIME_OF[kind]) || type;
    if (!/^image\//.test(type)) throw new Error(t('This is not a picture Vex can show'));
    const blob = new Blob(chunks, { type });
    if (S.objectUrl) URL.revokeObjectURL(S.objectUrl);
    S.objectUrl = URL.createObjectURL(blob);
    S.type = type;
    S.size = blob.size;
    S.meta = null;
    try {
      const buf = await (blob.size <= META_BYTES ? blob.arrayBuffer() : blob.slice(0, 1024 * 1024).arrayBuffer());
      S.meta = readMeta(buf);
    } catch (err) { console.warn('[Image viewer] the details could not be read:', err.message); }
    S.blob = blob;
    img.onload = img.onerror = null;
    const decoded = new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error(t('This picture is damaged or in a form Vex cannot draw'))); });
    img.src = S.objectUrl;
    await decoded;
    if (token !== S.token) return;
    await naturalSize();
    S.turn = 0; S.flipX = S.flipY = false; S.crop = null;
    clearTimeout(S.loadingTimer);
    setReady(true);
    hideState();
    $('#iv-title').textContent = S.name;
    refreshHeader();
    layoutMode(S.mode === 'free' ? 'fit' : S.mode);
    buildInfo();
    syncEdit();
    stage.focus({ preventScroll: true });
  } catch (err) {
    if (token !== S.token || (err && err.name === 'AbortError')) return;
    console.error('[Image viewer] could not open', original, err);
    failure(err.message);
  }
}

// An SVG with only a viewBox has no size of its own: give it one so it can be fitted and saved.
async function naturalSize() {
  let w = img.naturalWidth, h = img.naturalHeight;
  if (S.type === 'image/svg+xml' && (!w || !h || (w === 300 && h === 150))) {
    try {
      const doc = new DOMParser().parseFromString(await S.blob.text(), 'image/svg+xml');
      const svg = doc.documentElement;
      const box = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
      const hasSize = svg.hasAttribute('width') && svg.hasAttribute('height') && !/%/.test(svg.getAttribute('width') + svg.getAttribute('height'));
      if (!hasSize && box.length === 4 && box[2] > 0 && box[3] > 0) {
        const k = 1024 / Math.max(box[2], box[3]);
        w = Math.round(box[2] * k); h = Math.round(box[3] * k);
      }
    } catch (err) { console.warn('[Image viewer] the SVG size could not be read:', err.message); }
  }
  if (!w || !h) { w = w || 512; h = h || 512; }
  S.nw = w; S.nh = h;
  img.style.width = w + 'px';
  img.style.height = h + 'px';
}

function refreshHeader() {
  const typeName = NAME_OF[S.type] || (S.type.split('/')[1] || '').toUpperCase();
  const parts = [S.nw + ' × ' + S.nh, formatBytes(S.size), typeName];
  if (S.urls.length > 1) parts.push(t('{n} of {total}', { n: S.index + 1, total: S.urls.length }));
  $('#iv-sub').textContent = parts.join(' · ');
  $('#iv-prev').hidden = $('#iv-next').hidden = S.urls.length < 2;
  $('#iv-slide').hidden = S.urls.length < 2;
  stage.setAttribute('aria-label', t('{name}, {w} by {h} pixels', { name: S.name, w: S.nw, h: S.nh }));
}

// ---- the view -------------------------------------------------------------------------------------
function modeZoom(mode) {
  const e = eff(), s = stageSize();
  if (mode === 'fill') return G.fillZoom(e.w, e.h, s.w, s.h);
  if (mode === 'actual') return 1;
  return G.fitZoom(e.w, e.h, s.w, s.h);
}
function layoutMode(mode) {
  S.mode = mode;
  S.zoom = modeZoom(mode);
  S.pan = { x: 0, y: 0 };
  render();
}
function setZoom(zoom, cx = 0, cy = 0, announce = true) {
  const next = G.clampZoom(zoom);
  S.pan = G.panForZoomAt(S.pan, S.zoom, next, cx, cy);
  S.zoom = next;
  S.mode = 'free';
  render();
  if (announce) say(t('Zoom {percent}', { percent: G.formatPercent(S.zoom) }));
}
function render() {
  if (!S.ready) return;
  const e = eff(), s = stageSize();
  S.pan = G.clampPan(S.pan, e.w, e.h, S.zoom, s.w, s.h);
  frame.style.transform = `translate(${S.pan.x}px, ${S.pan.y}px) scale(${S.zoom}) scale(${S.flipX ? -1 : 1}, ${S.flipY ? -1 : 1}) rotate(${S.turn}deg)`;
  frame.style.setProperty('--iv-square', (14 / S.zoom) + 'px');
  img.style.imageRendering = S.zoom >= 3 ? 'pixelated' : 'auto';
  const input = $('#iv-zoom-input');
  if (document.activeElement !== input) input.value = G.formatPercent(S.zoom);
  for (const [id, mode] of [['#iv-fit', 'fit'], ['#iv-actual', 'actual'], ['#iv-fill', 'fill']]) $(id).setAttribute('aria-pressed', String(S.mode === mode));
  $('#iv-flip-h').setAttribute('aria-pressed', String(S.flipX));
  $('#iv-flip-v').setAttribute('aria-pressed', String(S.flipY));
  $('#iv-checker').setAttribute('aria-pressed', String(S.checker));
  stage.dataset.checker = String(S.checker);
  stage.dataset.pan = String(e.w * S.zoom > s.w + 0.5 || e.h * S.zoom > s.h + 0.5);
  img.draggable = !S.edit && stage.dataset.pan === 'false';
  drawCrop();
}
const turnBy = (deg) => {
  S.turn = (((S.turn + deg) % 360) + 360) % 360;
  S.crop = null;
  if (S.mode === 'free') render(); else layoutMode(S.mode);
  syncEdit();
  say(t('Turned to {deg} degrees', { deg: S.turn }));
};
const flip = (axis) => {
  if (axis === 'x') S.flipX = !S.flipX; else S.flipY = !S.flipY;
  render();
  say(axis === 'x' ? t('Flipped left to right') : t('Flipped top to bottom'));
};
function panBy(dx, dy) { S.pan = { x: S.pan.x + dx, y: S.pan.y + dy }; S.mode = 'free'; render(); }

// ---- pictures beside this one ----------------------------------------------------------------------
async function loadSiblings() {
  S.urls = []; S.index = -1;
  if (!host || !/^file:/i.test(S.original)) { refreshHeader(); return; }
  try {
    const r = await host.siblings();
    if (bad(r)) throw new Error(r && r.error ? t(r.error) : 'no answer');
    S.urls = r.urls; S.index = r.index;
  } catch (err) { console.warn('[Image viewer] the pictures beside this one could not be listed:', err.message); }
  if (S.ready) refreshHeader();
}
function go(delta) {
  if (S.urls.length < 2) return;
  S.index = (S.index + delta + S.urls.length) % S.urls.length;
  const next = S.urls[S.index];
  history.replaceState(null, '', pageUrl(next));
  S.crop = null;
  load(next).then(() => { say(t('{n} of {total}', { n: S.index + 1, total: S.urls.length })); });
}
function goTo(index) { go(index - S.index); }

function slideshow(on) {
  clearInterval(S.slideTimer);
  S.slide = on ? 1 : 0;
  if (on) {
    S.slideTimer = setInterval(() => { if (S.ready && !S.edit) go(1); }, S.slideSeconds * 1000);
    say(t('Slideshow started'));
  } else say(t('Slideshow stopped'));
  const b = $('#iv-slide');
  setIcon(b, on ? 'pause' : 'play');
  b.setAttribute('aria-pressed', String(!!on));
}

// ---- full screen ------------------------------------------------------------------------------------
async function toggleFull() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (err) { toast(t('Full screen did not start: {why}', { why: err.message }), { kind: 'error' }); }
}
let hideTimer = 0;
function wake() {
  document.body.classList.remove('iv-idle');
  clearTimeout(hideTimer);
  if (document.fullscreenElement) hideTimer = setTimeout(() => { if (!document.activeElement || !$('#iv-bar').contains(document.activeElement)) document.body.classList.add('iv-idle'); }, 2600);
}
document.addEventListener('fullscreenchange', () => {
  const on = !!document.fullscreenElement;
  document.body.classList.toggle('iv-fs', on);
  $('#iv-full').setAttribute('aria-pressed', String(on));
  setIcon($('#iv-full'), on ? 'minimize' : 'maximize');
  wake();
  if (S.ready && S.mode !== 'free') layoutMode(S.mode);
});
document.addEventListener('pointermove', wake, { passive: true });

// ---- details -----------------------------------------------------------------------------------------
function row(label, value, extra) {
  if (value == null || value === '') return null;
  return [el('dt', { text: label }), el('dd', { text: value, dir: 'auto' }, extra)];
}
function buildInfo() {
  const body = $('#iv-info-body');
  body.replaceChildren();
  if (!S.ready) return;
  const m = S.meta || {}, x = m.exif || {};
  const section = (title, rows) => {
    const list = rows.filter(Boolean).flat();
    if (!list.length) return null;
    return el('section', { class: 'iv-info-sec' }, el('h3', { text: title }), el('dl', {}, ...list));
  };
  const megapixels = S.nw * S.nh >= 100000 ? (S.nw * S.nh / 1e6).toFixed(1) + ' MP' : '';
  const profile = m.icc ? [m.icc.name, m.icc.space && m.icc.space !== 'RGB' ? m.icc.space : ''].filter(Boolean).join(' · ') : '';
  body.append(section(t('Picture'), [
    row(t('Name'), S.name),
    row(t('Type'), (NAME_OF[S.type] || S.type) + ' (' + S.type + ')'),
    row(t('Size'), formatBytes(S.size) + ' (' + S.size.toLocaleString() + ' ' + t('bytes') + ')'),
    row(t('Dimensions'), S.nw + ' × ' + S.nh + (megapixels ? ' · ' + megapixels : '')),
    row(t('Colour profile'), profile),
    row(t('Address'), /^file:/i.test(S.original) ? decodeURI(S.original) : S.original),
  ]));
  const camera = section(t('Camera'), [
    row(t('Camera'), [x.make, x.model].filter(Boolean).join(' ')),
    row(t('Lens'), x.lens),
    row(t('Exposure'), [x.exposure, x.aperture, x.iso, x.focal].filter(Boolean).join(' · ')),
    row(t('Taken'), x.taken),
    row(t('Software'), x.software),
  ]);
  if (camera) body.append(camera);
  if (x.gps) {
    const note = el('div', { class: 'iv-note' },
      el('p', { text: t('This picture says where it was taken. Vex only shows it here and never sends it anywhere. If you share the file, the place goes with it.') }),
      el('button', { class: 'iv-action', type: 'button', text: t('Save a copy without location'), onclick: () => saveStripped() }));
    body.append(el('section', { class: 'iv-info-sec' }, el('h3', { text: t('Location') }),
      el('dl', {}, ...row(t('Place'), formatPlace(x.gps)), ...(x.gps.alt != null ? row(t('Height'), Math.round(x.gps.alt) + ' m') : [])), note));
  }
  if (!camera && !x.gps) body.append(el('p', { class: 'iv-info-none', text: t('This picture carries no camera details.') }));
}
function setInfo(on) {
  S.info = on;
  $('#iv-info').hidden = !on;
  $('#iv-info-btn').setAttribute('aria-pressed', String(on));
  savePrefs();
  if (S.ready && S.mode !== 'free') requestAnimationFrame(() => layoutMode(S.mode)); else requestAnimationFrame(render);
  if (on) { buildInfo(); $('#iv-info-close').focus({ preventScroll: true }); } else if ($('#iv-info').contains(document.activeElement)) stage.focus({ preventScroll: true });
}

// ---- making a picture of what is on screen ----------------------------------------------------------
const identity = () => !S.turn && !S.flipX && !S.flipY;
function drawView(canvas, background) {
  const e = eff();
  canvas.width = e.w; canvas.height = e.h;
  const g = canvas.getContext('2d');
  if (background) { g.fillStyle = background; g.fillRect(0, 0, e.w, e.h); }
  g.translate(e.w / 2, e.h / 2);
  g.scale(S.flipX ? -1 : 1, S.flipY ? -1 : 1);
  g.rotate(S.turn * Math.PI / 180);
  g.drawImage(img, -S.nw / 2, -S.nh / 2, S.nw, S.nh);
  return canvas;
}
async function renderBytes({ type, crop, size }) {
  const e = eff();
  if (e.w * e.h > 250e6) throw new Error(t('This picture is too large to make a copy of'));
  const full = drawView(document.createElement('canvas'), type === 'jpeg' ? '#ffffff' : null);
  let out = full;
  const c = crop || { x: 0, y: 0, w: e.w, h: e.h };
  const w = size ? size.w : c.w, h = size ? size.h : c.h;
  if (c.x || c.y || c.w !== e.w || c.h !== e.h || w !== e.w || h !== e.h) {
    out = document.createElement('canvas');
    out.width = w; out.height = h;
    const g = out.getContext('2d');
    if (type === 'jpeg') { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); }
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(full, c.x, c.y, c.w, c.h, 0, 0, w, h);
  }
  const blob = await new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error(t('The picture could not be made')))), 'image/' + type, type === 'png' ? undefined : 0.92));
  return blob.arrayBuffer();
}

async function copyPicture() {
  try {
    const h = needHost();
    let bytes;
    if (identity() && (S.type === 'image/png' || S.type === 'image/jpeg')) bytes = await S.blob.arrayBuffer();
    else bytes = await renderBytes({ type: 'png' });
    const r = await h.copyImage({ bytes });
    if (bad(r)) throw new Error(r && r.error ? t(r.error) : t('It did not work'));
    toast(S.type === 'image/gif' || S.type === 'image/webp' ? t('Picture copied (the first frame of an animation)') : t('Picture copied'));
    say(t('Picture copied'));
  } catch (err) { toast(err.message, { kind: 'error' }); }
}
async function copyAddress() {
  try {
    const r = await needHost().copyAddress();
    if (bad(r)) throw new Error(r && r.error ? t(r.error) : t('It did not work'));
    toast(t('Address copied'));
  } catch (err) { toast(err.message, { kind: 'error' }); }
}
async function saveAs() {
  try {
    const r = await needHost().download();
    if (bad(r)) throw new Error(r && r.error ? t(r.error) : t('It did not work'));
    if (r.cancelled) return;
    toast(r.viaDownloads ? t('Saving: see the downloads list') : t('Saved as {name}', { name: r.name }));
  } catch (err) { toast(err.message, { kind: 'error' }); }
}
async function openNative() {
  try {
    const r = await needHost().openNative();
    if (bad(r)) throw new Error(r && r.error ? t(r.error) : t('It did not work'));
  } catch (err) { toast(err.message, { kind: 'error' }); }
}
async function reveal() {
  try {
    const r = await needHost().reveal();
    if (bad(r)) throw new Error(r && r.error ? t(r.error) : t('It did not work'));
  } catch (err) { toast(err.message, { kind: 'error' }); }
}
async function saveCopy(opts, suffix) {
  const r = await needHost().saveCopy({ bytes: await renderBytes(opts), type: opts.type, name: S.name, suffix });
  if (bad(r)) throw new Error(r && r.error ? t(r.error) : t('It did not work'));
  if (r.cancelled) return;
  toast(t('Saved as {name}', { name: r.name }), { action: /^file:/i.test(S.original) ? { label: t('Show in folder'), run: reveal } : null });
}
const copyType = () => (S.type === 'image/jpeg' ? 'jpeg' : 'png');
async function saveTurned() { try { await saveCopy({ type: copyType() }, 'turned'); } catch (err) { toast(err.message, { kind: 'error' }); } }
async function saveStripped() { try { await saveCopy({ type: copyType() }, 'no-location'); } catch (err) { toast(err.message, { kind: 'error' }); } }

// ---- crop and resize (a copy, never the picture) ------------------------------------------------------
const num = (id) => $(id);
function syncEdit() {
  if (!S.ready) return;
  const e = eff();
  const c = S.crop || { x: 0, y: 0, w: e.w, h: e.h };
  num('#iv-crop-x').value = c.x; num('#iv-crop-y').value = c.y; num('#iv-crop-w').value = c.w; num('#iv-crop-h').value = c.h;
  num('#iv-size-w').value = c.w; num('#iv-size-h').value = c.h;
  drawCrop();
}
function drawCrop() {
  if (!S.edit || !S.ready || !S.crop) { cropBox.hidden = true; return; }
  const e = eff(), s = stageSize();
  const left = s.w / 2 + S.pan.x - e.w * S.zoom / 2 + S.crop.x * S.zoom;
  const top = s.h / 2 + S.pan.y - e.h * S.zoom / 2 + S.crop.y * S.zoom;
  Object.assign(cropBox.style, { left: left + 'px', top: top + 'px', width: S.crop.w * S.zoom + 'px', height: S.crop.h * S.zoom + 'px' });
  cropBox.hidden = false;
}
function setEdit(on) {
  S.edit = on;
  $('#iv-edit').hidden = !on;
  $('#iv-edit-btn').setAttribute('aria-pressed', String(on));
  stage.dataset.edit = String(on);
  if (!on) S.crop = null;
  requestAnimationFrame(() => { if (S.ready && S.mode !== 'free') layoutMode(S.mode); else render(); });
  syncEdit();
  if (on) $('#iv-crop-x').focus({ preventScroll: true }); else stage.focus({ preventScroll: true });
}
function readRect() {
  const e = eff();
  const v = (id) => Number(String(num(id).value).replace(/\s/g, ''));
  const r = { x: v('#iv-crop-x'), y: v('#iv-crop-y'), w: v('#iv-crop-w'), h: v('#iv-crop-h') };
  if (![r.x, r.y, r.w, r.h].every(Number.isFinite)) return null;
  return G.clampRect(r, e.w, e.h);
}
function onCropField() {
  const r = readRect();
  if (!r) return;
  const e = eff();
  S.crop = r.x === 0 && r.y === 0 && r.w === e.w && r.h === e.h ? null : r;
  num('#iv-size-w').value = r.w; num('#iv-size-h').value = r.h;
  drawCrop();
}
function onSizeField(changed) {
  if (!$('#iv-size-lock').checked) return;
  const r = readRect() || { w: eff().w, h: eff().h };
  const w = Number(num('#iv-size-w').value), h = Number(num('#iv-size-h').value);
  if (changed === 'w' && w > 0) num('#iv-size-h').value = G.scaledSide(w, r.w, r.h);
  if (changed === 'h' && h > 0) num('#iv-size-w').value = G.scaledSide(h, r.h, r.w);
}
async function saveEdited() {
  const button = $('#iv-edit-save');
  try {
    const crop = readRect();
    const w = Math.round(Number(num('#iv-size-w').value)), h = Math.round(Number(num('#iv-size-h').value));
    if (!(w >= 1 && h >= 1 && w <= 16384 && h <= 16384)) throw new Error(t('The size must be between 1 and 16384 pixels'));
    if (!crop) throw new Error(t('Type the crop as whole numbers'));
    button.disabled = true;
    await saveCopy({ type: $('#iv-edit-type').value, crop, size: { w, h } }, 'edited');
  } catch (err) { toast(err.message, { kind: 'error' }); } finally { button.disabled = false; }
}

// ---- pointer, wheel, keys --------------------------------------------------------------------------------
const pointers = new Map();
let drag = null, pinch = null;
const fromCenter = (event) => { const r = stage.getBoundingClientRect(); return { x: event.clientX - r.left - r.width / 2, y: event.clientY - r.top - r.height / 2 }; };

stage.addEventListener('pointerdown', (event) => {
  if (!S.ready || event.button > 0) return;
  if (event.pointerType === 'mouse' && event.target === img && img.draggable && !S.edit) return;   // a picture that fits is dragged OUT, not around
  stage.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: S.zoom };
    drag = null;
    return;
  }
  if (S.edit) {
    const e = eff(), s = stageSize(), p = fromCenter(event);
    const ix = (p.x - S.pan.x) / S.zoom + e.w / 2, iy = (p.y - S.pan.y) / S.zoom + e.h / 2;
    drag = { kind: 'crop', x0: G.clamp(ix, 0, e.w), y0: G.clamp(iy, 0, e.h) };
  } else drag = { kind: 'pan', x: event.clientX, y: event.clientY, px: S.pan.x, py: S.pan.y };
  stage.classList.add('iv-dragging');
});
stage.addEventListener('pointermove', (event) => {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const r = stage.getBoundingClientRect();
    const mid = { x: (a.x + b.x) / 2 - r.left - r.width / 2, y: (a.y + b.y) / 2 - r.top - r.height / 2 };
    setZoom(pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist), mid.x, mid.y, false);
    return;
  }
  if (!drag) return;
  if (drag.kind === 'pan') { S.pan = { x: drag.px + event.clientX - drag.x, y: drag.py + event.clientY - drag.y }; S.mode = 'free'; render(); }
  else {
    const e = eff(), p = fromCenter(event);
    const ix = G.clamp((p.x - S.pan.x) / S.zoom + e.w / 2, 0, e.w), iy = G.clamp((p.y - S.pan.y) / S.zoom + e.h / 2, 0, e.h);
    S.crop = G.clampRect({ x: Math.min(drag.x0, ix), y: Math.min(drag.y0, iy), w: Math.abs(ix - drag.x0), h: Math.abs(iy - drag.y0) }, e.w, e.h);
    syncEdit();
  }
});
const endPointer = (event) => {
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinch = null;
  if (!pointers.size) { drag = null; stage.classList.remove('iv-dragging'); }
};
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);

stage.addEventListener('wheel', (event) => {
  if (!S.ready) return;
  event.preventDefault();
  const p = fromCenter(event);
  setZoom(S.zoom * G.wheelFactor(event), p.x, p.y, false);
}, { passive: false });

stage.addEventListener('dblclick', (event) => {
  if (!S.ready || S.edit) return;
  const p = fromCenter(event);
  if (Math.abs(S.zoom - 1) < 0.01) layoutMode('fit');
  else { setZoom(1, p.x, p.y, false); S.mode = 'actual'; render(); }
  say(t('Zoom {percent}', { percent: G.formatPercent(S.zoom) }));
});

// The picture can be dragged out to another program or a page that takes pictures.
img.addEventListener('dragstart', (event) => {
  const dt = event.dataTransfer;
  if (!dt || !S.ready || S.edit) { event.preventDefault(); return; }
  const web = /^https?:/i.test(S.original);
  const name = S.name.includes('.') ? S.name : S.name + '.' + ((NAME_OF[S.type] || 'png').toLowerCase());
  dt.effectAllowed = 'copy';
  dt.setData('text/uri-list', S.original);
  dt.setData('text/plain', S.original);
  if (web) dt.setData('DownloadURL', S.type + ':' + name + ':' + S.original);
});
// Alt makes a zoomed picture draggable out instead of around.
stage.addEventListener('pointerdown', (event) => { if (event.altKey && event.target === img && !S.edit) img.draggable = true; }, true);

stage.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  if (!S.ready) return;
  openMenu({ anchor: $('#iv-more'), items: moreItems(), label: t('More') });
});

function typing(target) { return target && target.nodeType === 1 && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)); }

document.addEventListener('keydown', (event) => {
  if (menuIsOpen()) return;
  const key = event.key;
  if (typing(event.target)) {
    if (key === 'Escape') { event.target.blur(); stage.focus({ preventScroll: true }); event.preventDefault(); }
    return;
  }
  if (event.target && event.target.tagName === 'BUTTON' && (key === 'Enter' || key === ' ')) return;     // a button keeps its own keys
  const mod = event.ctrlKey || event.metaKey;
  if (event.altKey) return;
  if (mod) {
    if ((key === '=' || key === '+') && S.ready) { event.preventDefault(); setZoom(S.zoom * 1.25); }
    else if ((key === '-' || key === '_') && S.ready) { event.preventDefault(); setZoom(S.zoom / 1.25); }
    else if (key === '0' && S.ready) { event.preventDefault(); layoutMode('fit'); }
    else if ((key === 'c' || key === 'C') && !event.shiftKey && S.ready && !String(getSelection())) { event.preventDefault(); copyPicture(); }
    return;
  }
  const step = event.shiftKey ? 240 : 70;
  const e = S.ready ? eff() : { w: 0, h: 0 }, s = stageSize();
  const overX = e.w * S.zoom > s.w + 0.5, overY = e.h * S.zoom > s.h + 0.5;
  switch (key) {
    case 'ArrowLeft': if (overX) panBy(step, 0); else go(-1); break;
    case 'ArrowRight': if (overX) panBy(-step, 0); else go(1); break;
    case 'ArrowUp': if (overY) panBy(0, step); else return; break;
    case 'ArrowDown': if (overY) panBy(0, -step); else return; break;
    case 'PageUp': go(-1); break;
    case 'PageDown': go(1); break;
    case 'Home': if (S.urls.length > 1) goTo(0); else return; break;
    case 'End': if (S.urls.length > 1) goTo(S.urls.length - 1); else return; break;
    case '+': case '=': if (S.ready) setZoom(S.zoom * 1.25); else return; break;
    case '-': case '_': if (S.ready) setZoom(S.zoom / 1.25); else return; break;
    case '0': if (S.ready) layoutMode('fit'); else return; break;
    case '1': if (S.ready) layoutMode('actual'); else return; break;
    case '2': if (S.ready) layoutMode('fill'); else return; break;
    case 'r': case 'R': if (S.ready) turnBy(event.shiftKey ? -90 : 90); else return; break;
    case 'h': case 'H': if (S.ready) flip('x'); else return; break;
    case 'v': case 'V': if (S.ready) flip('y'); else return; break;
    case 'b': case 'B': if (S.ready) { S.checker = !S.checker; savePrefs(); render(); } else return; break;
    case 'f': case 'F': toggleFull(); break;
    case 'i': case 'I': if (S.ready) setInfo(!S.info); else return; break;
    case 'e': case 'E': if (S.ready) setEdit(!S.edit); else return; break;
    case 's': case 'S': if (S.urls.length > 1) slideshow(!S.slide); else return; break;
    case 'Escape':
      if (S.edit) setEdit(false);
      else if (S.slide) slideshow(false);
      else if (S.info) setInfo(false);
      else return;
      break;
    default: return;
  }
  event.preventDefault();
});

window.addEventListener('resize', () => { if (S.ready) { if (S.mode !== 'free') layoutMode(S.mode); else render(); } });
new ResizeObserver(() => { if (S.ready) { if (S.mode !== 'free') layoutMode(S.mode); else render(); } }).observe(stage);

// ---- the toolbar ---------------------------------------------------------------------------------------
function moreItems() {
  const file = /^file:/i.test(S.original);
  return [
    { label: t('Copy the picture'), icon: 'copy', keys: 'Ctrl+C', disabled: !S.ready, run: copyPicture },
    { label: t('Copy the picture address'), icon: 'link', run: copyAddress },
    { label: t('Save the picture as'), icon: 'download', run: saveAs },
    { label: t('Save a copy with the turn applied'), icon: 'rotate-cw', disabled: !S.ready || identity(), run: saveTurned },
    { type: 'sep' },
    { label: t('Rotate right'), icon: 'rotate-cw', keys: 'R', disabled: !S.ready, run: () => turnBy(90) },
    { label: t('Rotate left'), icon: 'rotate-ccw', keys: 'Shift+R', disabled: !S.ready, run: () => turnBy(-90) },
    { label: t('Flip left to right'), icon: 'flip-h', keys: 'H', disabled: !S.ready, run: () => flip('x') },
    { label: t('Flip top to bottom'), icon: 'flip-v', keys: 'V', disabled: !S.ready, run: () => flip('y') },
    { type: 'sep' },
    { label: t('Crop and resize'), icon: 'crop', keys: 'E', disabled: !S.ready, run: () => setEdit(!S.edit) },
    { label: t('Slideshow'), icon: 'play', keys: 'S', disabled: S.urls.length < 2, run: () => slideshow(!S.slide) },
    ...SLIDE_CHOICES.map((n) => ({ label: t('Slideshow: {n} seconds each', { n }), role: 'menuitemradio', checked: S.slideSeconds === n, disabled: S.urls.length < 2, run: () => { S.slideSeconds = n; savePrefs(); if (S.slide) slideshow(true); } })),
    { type: 'sep' },
    { label: t('Checkerboard behind transparent areas'), role: 'menuitemcheckbox', checked: S.checker, keys: 'B', run: () => { S.checker = !S.checker; savePrefs(); render(); } },
    { label: t('Details'), role: 'menuitemcheckbox', checked: S.info, keys: 'I', run: () => setInfo(!S.info) },
    { type: 'sep' },
    file ? { label: t('Show in folder'), icon: 'folder-open', run: reveal } : null,
    { label: t("Open in the browser's own view"), icon: 'external', run: openNative },
  ].filter(Boolean);
}

function wire() {
  $('#iv-prev').addEventListener('click', () => go(-1));
  $('#iv-next').addEventListener('click', () => go(1));
  $('#iv-zoom-in').addEventListener('click', () => setZoom(S.zoom * 1.25));
  $('#iv-zoom-out').addEventListener('click', () => setZoom(S.zoom / 1.25));
  $('#iv-fit').addEventListener('click', () => { layoutMode('fit'); say(t('Fit to window')); });
  $('#iv-actual').addEventListener('click', () => { layoutMode('actual'); say(t('Actual size')); });
  $('#iv-fill').addEventListener('click', () => { layoutMode('fill'); say(t('Fill the window')); });
  $('#iv-rot-left').addEventListener('click', () => turnBy(-90));
  $('#iv-rot-right').addEventListener('click', () => turnBy(90));
  $('#iv-flip-h').addEventListener('click', () => flip('x'));
  $('#iv-flip-v').addEventListener('click', () => flip('y'));
  $('#iv-checker').addEventListener('click', () => { S.checker = !S.checker; savePrefs(); render(); });
  $('#iv-copy').addEventListener('click', copyPicture);
  $('#iv-save').addEventListener('click', saveAs);
  $('#iv-slide').addEventListener('click', () => slideshow(!S.slide));
  $('#iv-full').addEventListener('click', toggleFull);
  $('#iv-info-btn').addEventListener('click', () => setInfo(!S.info));
  $('#iv-info-close').addEventListener('click', () => setInfo(false));
  $('#iv-edit-btn').addEventListener('click', () => setEdit(!S.edit));
  $('#iv-more').addEventListener('click', () => openMenu({ anchor: $('#iv-more'), items: moreItems(), label: t('More') }));
  const zin = $('#iv-zoom-input');
  const applyZoomText = () => {
    const z = G.parsePercent(zin.value);
    if (z == null) { zin.value = G.formatPercent(S.zoom); toast(t('Type a zoom such as 150%'), { kind: 'error' }); return; }
    setZoom(z);
    zin.value = G.formatPercent(S.zoom);
  };
  zin.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); applyZoomText(); stage.focus({ preventScroll: true }); } });
  zin.addEventListener('focus', () => zin.select());
  zin.addEventListener('blur', () => { zin.value = G.formatPercent(S.zoom); });
  for (const id of ['#iv-crop-x', '#iv-crop-y', '#iv-crop-w', '#iv-crop-h']) num(id).addEventListener('input', onCropField);
  num('#iv-size-w').addEventListener('input', () => onSizeField('w'));
  num('#iv-size-h').addEventListener('input', () => onSizeField('h'));
  $('#iv-crop-reset').addEventListener('click', () => { S.crop = null; syncEdit(); });
  $('#iv-edit-save').addEventListener('click', saveEdited);
}

// ---- start -------------------------------------------------------------------------------------------
function translateAll() {
  applyStatic();
  if (S.ready) { refreshHeader(); buildInfo(); } else if (!stateBox.hidden && stateBox.dataset.kind === 'loading') { /* the next state draws in the new language */ }
  const b = $('#iv-slide');
  if (b) b.title = t('Slideshow (S)');
}

function start() {
  decorateIcons(document);
  applyStatic();
  const prefs = savedPrefs();
  S.checker = !!prefs.checker;
  S.info = !!prefs.info;
  if (SLIDE_CHOICES.includes(prefs.slideSeconds)) S.slideSeconds = prefs.slideSeconds;
  $('#iv-info').hidden = !S.info;
  $('#iv-info-btn').setAttribute('aria-pressed', String(S.info));
  setReady(false);
  wire();
  window.addEventListener('iv:lang', translateAll);
  onThemeChange(() => { if (S.ready) render(); });
  refreshScheme();
  if (host) host.onTheme((payload) => applyThemePayload(payload));
  const original = originalFromLocation();
  if (!original) { failure(t('No picture was named')); return; }
  S.name = nameOf(original);
  load(original);
  loadSiblings();
}

window.addEventListener('beforeunload', () => { if (S.objectUrl) URL.revokeObjectURL(S.objectUrl); });
start();
