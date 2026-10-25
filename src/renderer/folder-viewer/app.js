// Vex's folder browser: the page. It shows the folder its own address names (vex-files://browse/?u=<file: address>) and asks main, through the
// small bridge the preload gives it (window.vexFolderHost), to read it and to act on it. It never names a path to main: a file is always a
// NAME inside the folder the address names, and going to another folder is a navigation to another address.

import { t, setLang, getLang, applyStatic } from './strings.js';
import { el, icon, iconSpan, decorateIcons, openMenu, menuIsOpen, openDialog, dialogIsOpen, confirmDialog, announce, toast } from './ui.js';
import { kindOf, canThumb, extOf } from './kinds.js';
import { formatSize, formatDate, formatNumber, fold, splitName, typedToFileUrl, crumbsOf } from './format.js';
import { VirtualList } from './vlist.js';
import { createPane } from './pane.js';
import { applyThemePayload, onThemeChange, refreshScheme } from './theme.js';
import { createData, loadEntries, buildView, foldedName, loadPrefs, savePrefs, noteRecent, loadRecent } from './state.js';

const host = window.vexFolderHost;
const STAT_BATCH = 1000;
const THUMB_PARALLEL = 3;
const TILE = { w: 132, h: 144 };

// ---------- the page's state ----------
const prefs = loadPrefs();
const data = createData();
let folder = null;            // the folder main listed: { path, name, fileUrl, parentUrl, root, mtimeMs, ... }
let mode = 'loading';         // loading | folder | thispc | file | error
let generation = 0;
let filterText = '';
let statProgress = 1;
let renaming = null;          // { name }
let typeBuffer = '', typeTimer = 0;
let list = null;
let pane = null;
let places = [];
let hiddenCount = 0;
let loadedMtime = 0;
let lastPing = 0;
const thumbCache = new Map(), thumbFailed = new Set(), thumbPending = new Set(), thumbQueue = [];
let thumbRunning = 0;
const sizeTasks = new Map();   // folder name -> { id, timer }
const PAGE_URL_PARAM = new URLSearchParams(location.search).get('u') || 'file:///';

const $id = (id) => document.getElementById(id);
const refs = {};
const pageUrl = (fileUrl) => '/?u=' + encodeURIComponent(fileUrl);
function go(fileUrl) { location.assign(pageUrl(fileUrl)); }

// ---------- words for the codes main answers with ----------
function explain(r) {
  switch (r && r.code) {
    case 'denied': return t('Windows does not let Vex open this. You may not have permission.');
    case 'missing': return t('This is not there (any more).');
    case 'notdir': return t('This is not a folder.');
    case 'exists': return t('Something with that name is already here.');
    case 'busy': return t('Another program is using it right now.');
    case 'toolong': return t('The path is too long for Windows.');
    case 'timeout': return t('The drive or network location did not answer in time.');
    case 'notempty': return t('The folder is not empty.');
    case 'readonly': return t('This location is read-only.');
    case 'gone': return t('The drive or network location is not available. It may have been disconnected.');
    case 'toomany': return t('Windows has too many files open right now. Try again in a moment.');
    case 'notname': return t('That is not a file name.');
    case 'name-empty': return t('Type a name.');
    case 'name-long': return t('That name is too long.');
    case 'name-chars': return t('A name cannot contain any of these: \\ / : * ? " < > |');
    case 'name-dot': return t('A name cannot end with a dot.');
    case 'name-reserved': return t('Windows keeps that name for itself.');
    // What Windows itself says (it speaks the system's language) goes after our own words.
    default: return r && r.error ? t('That did not work.') + ' (' + r.error + ')' : t('That did not work.');
  }
}

// ---------- boot ----------
function fatal(text) {
  document.body.dataset.kind = 'error';
  const box = $id('fv-state');
  box.hidden = false;
  box.replaceChildren(el('div', { class: 'fv-card bad' }, iconSpan('warning', 40), el('h1', { text: t('The folder browser could not start') }), el('p', { text })));
}

function boot() {
  if (typeof VexIcons === 'undefined') { fatal(t('The icon set did not load')); return; }
  if (!host) { fatal(t('Vex could not reach the folder browser from this tab.')); return; }
  for (const id of ['fv-back', 'fv-fwd', 'fv-up', 'fv-refresh', 'fv-crumb-list', 'fv-crumbs', 'fv-edit-path', 'fv-path', 'fv-filter', 'fv-new', 'fv-rename', 'fv-delete', 'fv-copy', 'fv-reveal', 'fv-sort',
    'fv-viewmode', 'fv-hidden', 'fv-pane-toggle', 'fv-more', 'fv-places', 'fv-banner', 'fv-wrap', 'fv-head', 'fv-scroll', 'fv-content', 'fv-empty', 'fv-state', 'fv-pane', 'fv-count', 'fv-progress', 'fv-changed', 'fv-center']) refs[id] = $id(id);
  applyStatic(document);
  decorateIcons(document);
  pane = createPane({ root: refs['fv-pane'], host, data, actions: { open: (n) => openEntry(n, 'here'), openInTab: (n) => openEntry(n, 'tab'), external: (n) => openExternal(n), reveal: (n) => reveal(n), copy: (names, as) => copyNames(names, as), calcSize: (n) => calcSize(n), explain } });
  list = new VirtualList({ scroller: refs['fv-scroll'], content: refs['fv-content'], createNode, bindNode: bindItem, onRange: onRange });
  wire();
  syncPrefsToUi();
  host.onTheme((payload) => applyThemePayload(payload));
  onThemeChange((langChanged) => { if (langChanged) relocalize(); });
  refreshScheme();
  load();
}

// ---------- loading ----------
async function load({ keep } = {}) {
  const mine = ++generation;
  cancelSizes();
  statProgress = 0;
  if (!(keep && mode === 'folder')) setMode('loading');   // a refresh leaves the list where it is until the new one is there
  let r;
  try { r = await host.list(); } catch (err) { if (mine === generation) showError({ code: 'other', error: err.message }); return; }
  if (mine !== generation) return;
  if (!r.ok) { showError(r); return; }
  if (r.kind === 'thisPc') { showThisPc(r); return; }
  if (r.kind === 'file') { showFileCard(r); return; }
  folder = r;
  loadedMtime = r.mtimeMs;
  document.title = r.name;
  loadEntries(data, r.entries);
  hiddenCount = 0;
  for (const e of r.entries) if (e.h) hiddenCount++;
  thumbCache.clear(); thumbFailed.clear(); thumbPending.clear(); thumbQueue.length = 0;
  const keepSelected = keep ? [...data.selected].filter((n) => data.byName.has(n)) : [];
  data.selected = new Set(keepSelected);
  data.anchor = -1;
  data.active = -1;
  data.folderSizes = keep ? new Map([...data.folderSizes]) : new Map();
  noteRecent(r.fileUrl, r.name);
  setMode('folder');
  rebuild({ resetScroll: !keep });
  const wanted = takeFocusHint();
  if (wanted && data.byName.has(wanted)) {
    const vi = positionOf(wanted);
    if (vi >= 0) { data.selected = new Set([wanted]); data.anchor = vi; setActive(vi, { focus: false }); }
  } else if (data.view.length && data.active < 0) data.active = 0;
  list.setPinned(data.active);
  list.refresh();
  if (data.active >= 0) list.scrollToIndex(data.active);
  focusActive();
  updateAll();
  statLoop(mine, Array.from(data.view)).catch((err) => { if (mine === generation) toast(err.message, 'error'); });
  buildPlaces();
  updateHistoryButtons();
}

function takeFocusHint() {
  try { const n = sessionStorage.getItem('fv.focus'); sessionStorage.removeItem('fv.focus'); return n || ''; } catch { return ''; }
}

// ---------- details of the entries (size, date), read in batches ----------
async function statLoop(gen, order) {
  const total = order.length;
  let done = 0;
  for (let at = 0; at < total && gen === generation; at += STAT_BATCH) {
    const names = [], idx = [];
    for (let k = at; k < Math.min(total, at + STAT_BATCH); k++) { const i = order[k]; if (data.statState[i] === 0) { data.statState[i] = 1; names.push(data.entries[i].n); idx.push(i); } }
    if (names.length) {
      const r = await host.stat({ names });
      if (gen !== generation) return;
      if (!r.ok) { toast(explain(r), 'error'); return; }
      applyStats(idx, r.stats);
    }
    done = Math.min(total, at + STAT_BATCH);
    statProgress = total ? done / total : 1;
    afterStats();
  }
  statProgress = 1;
  afterStats(true);
}
function applyStats(idx, stats) {
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k], s = stats[k];
    data.size[i] = s[0]; data.mtime[i] = s[1]; data.flags[i] = s[2]; data.statState[i] = 2;
  }
}
let resortTimer = 0;
function afterStats(final) {
  if (list) list.refresh();
  updateStatus();
  if (prefs.sort === 'size' || prefs.sort === 'date') {
    clearTimeout(resortTimer);
    resortTimer = setTimeout(() => { rebuild({ keepScroll: true }); list.refresh(); }, final ? 0 : 700);
  }
  if (final && pane && data.selected.size === 1) pane.soon();
}
let visibleStatBusy = false;
async function statVisible(first, last) {
  if (visibleStatBusy || !data.view.length) return;
  const names = [], idx = [];
  for (let vi = first; vi <= last && names.length < 300; vi++) { const i = data.view[vi]; if (i !== undefined && data.statState[i] === 0) { data.statState[i] = 1; names.push(data.entries[i].n); idx.push(i); } }
  if (!names.length) return;
  visibleStatBusy = true;
  const gen = generation;
  try {
    const r = await host.stat({ names });
    if (gen !== generation) return;
    if (r.ok) { applyStats(idx, r.stats); list.refresh(); }
  } catch (err) { console.error('[Folder browser] details of the rows in view could not be read:', err); }
  finally { visibleStatBusy = false; }
}

// ---------- the order and what is shown ----------
function typeLabelOf(kind) { return t(kind.label, kind.args); }
function rebuild({ resetScroll, keepScroll } = {}) {
  const activeName = data.active >= 0 && data.view[data.active] !== undefined ? data.entries[data.view[data.active]].n : null;
  buildView(data, { filter: filterText, hidden: prefs.hidden, sort: prefs.sort, dir: prefs.dir }, typeLabelOf);
  const keepTop = refs['fv-scroll'].scrollTop;
  list.configure({ count: data.view.length, grid: prefs.mode === 'large', rowHeight: 32, tileW: TILE.w, tileH: TILE.h });
  if (activeName !== null) { const vi = positionOf(activeName); data.active = vi; }
  if (data.active >= data.view.length) data.active = data.view.length - 1;
  if (data.active < 0 && data.view.length) data.active = 0;
  list.setPinned(data.active);
  if (resetScroll) refs['fv-scroll'].scrollTop = 0; else if (keepScroll) refs['fv-scroll'].scrollTop = keepTop;
  list.update();
  const empty = refs['fv-empty'];
  if (!data.view.length) {
    empty.hidden = false;
    empty.textContent = filterText ? t('Nothing here matches "{text}".', { text: filterText }) : (data.entries.length ? t('Everything in this folder is hidden. Use "Hidden files" to see it.') : t('This folder is empty.'));
  } else empty.hidden = true;
  const sb = refs['fv-scroll'].offsetWidth - refs['fv-scroll'].clientWidth;
  document.documentElement.style.setProperty('--fv-sb', sb + 'px');
  updateHeaders();
  updateStatus();
}
function positionOf(name) {
  const i = data.byName.get(name);
  if (i === undefined) return -1;
  // The view is small enough to scan; a map would cost as much to build as the scans it saves.
  for (let vi = 0; vi < data.view.length; vi++) if (data.view[vi] === i) return vi;
  return -1;
}
function onRange(first, last) {
  statVisible(first, last);
  if (prefs.mode === 'large') scheduleThumbs(first, last);
}

// ---------- the rows ----------
function setIcon(span, name, size, isFolder) {
  const key = name + size;
  if (span._key !== key) { span._key = key; span.innerHTML = icon(name, size); }
  if (isFolder) span.setAttribute('data-folder', '1'); else span.removeAttribute('data-folder');
}
function createNode() {
  const node = document.createElement('div');
  const m = prefs.mode;
  node.className = m === 'large' ? 'fv-tile' : 'fv-row';
  node.setAttribute('role', m === 'details' ? 'row' : 'option');
  node.draggable = true;
  if (m === 'large') {
    node._thumb = el('div', { class: 'fv-thumb', 'aria-hidden': 'true' });
    node._ico = el('span', { class: 'fv-ico', 'aria-hidden': 'true' });
    node._thumb.append(node._ico);
    node._name = el('div', { class: 'fv-tname' });
    node.append(node._thumb, node._name);
    return node;
  }
  node._ico = el('span', { class: 'fv-ico', 'aria-hidden': 'true' });
  node._name = el('span', { class: 'fv-name' });
  const nameCell = el('div', { class: 'fv-cell fv-c-name', role: m === 'details' ? 'gridcell' : null }, node._ico, node._name);
  node.append(nameCell);
  if (m === 'details') {
    node._date = el('div', { class: 'fv-cell fv-c-date', role: 'gridcell' });
    node._type = el('div', { class: 'fv-cell fv-c-type', role: 'gridcell' });
    node._size = el('div', { class: 'fv-cell fv-c-size', role: 'gridcell' });
    node.append(node._date, node._type, node._size);
  }
  return node;
}
function bindItem(node, vi) {
  const i = data.view[vi];
  if (i === undefined) return;
  const e = data.entries[i], k = data.kinds[i], name = e.n;
  const sel = data.selected.has(name);
  node.dataset.vi = String(vi);
  node.dataset.name = name;
  node.id = 'fv-r' + vi;
  node.setAttribute('aria-selected', sel ? 'true' : 'false');
  node.classList.toggle('selected', sel);
  node.classList.toggle('is-hidden', !!e.h);
  node.tabIndex = vi === data.active ? 0 : -1;
  if (prefs.mode === 'details') node.setAttribute('aria-rowindex', String(vi + 2));
  else { node.setAttribute('aria-posinset', String(vi + 1)); node.setAttribute('aria-setsize', String(data.view.length)); }
  node.title = name;
  const big = prefs.mode === 'large';
  if (renaming && renaming.name === name) { if (!node._name.querySelector('input')) mountRename(node, name); }
  else { if (node._name.firstElementChild) node._name.replaceChildren(); node._name.textContent = name; }
  if (!big) setIcon(node._ico, k.icon, 18, !!e.d);
  if (prefs.mode === 'details') {
    node._date.textContent = data.mtime[i] ? formatDate(data.mtime[i]) : '';
    node._type.textContent = typeLabelOf(k);
    node._size.textContent = e.d ? folderSizeText(name) : (data.size[i] >= 0 ? formatSize(data.size[i]) : '');
  }
  if (big) {
    const url = thumbCache.get(name);
    const img = node._thumb.querySelector('img');
    if (url) {
      if (!img) { const im = el('img', { alt: '', src: url, draggable: 'false' }); node._thumb.replaceChildren(im); }
      else if (img.getAttribute('src') !== url) img.src = url;
    } else {
      if (img) node._thumb.replaceChildren(node._ico);
      setIcon(node._ico, k.icon, 44, !!e.d);
    }
  }
}
function folderSizeText(name) {
  const f = data.folderSizes.get(name);
  if (!f) return '';
  return f.done ? formatSize(f.bytes) : '…';
}

// ---------- pictures for the large view ----------
let thumbTimer = 0;
function scheduleThumbs(first, last) {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => {
    // Only what is in view now: pictures for rows scrolled past are not worth making. The top of the view is made first.
    thumbQueue.length = 0;
    thumbPending.clear();
    for (const n of thumbRunningNames) thumbPending.add(n);
    for (let vi = last; vi >= first; vi--) {
      const i = data.view[vi];
      if (i === undefined) continue;
      const e = data.entries[i];
      if (e.d || !canThumb(e.n) || thumbCache.has(e.n) || thumbFailed.has(e.n) || thumbPending.has(e.n)) continue;
      thumbPending.add(e.n);
      thumbQueue.push(e.n);
    }
    pumpThumbs();
  }, 90);
}
const thumbRunningNames = new Set();
function pumpThumbs() {
  while (thumbRunning < THUMB_PARALLEL && thumbQueue.length) {
    const name = thumbQueue.pop();
    const gen = generation;
    thumbRunning++;
    thumbRunningNames.add(name);
    host.thumb({ name, size: 256 }).then((r) => {
      if (gen !== generation) return;
      if (r.ok) { thumbCache.set(name, r.url); if (thumbCache.size > 700) thumbCache.delete(thumbCache.keys().next().value); }
      else thumbFailed.add(name);
      if (prefs.mode === 'large') for (const [vi, node] of list.nodes) if (node.dataset.name === name) bindItem(node, vi);
    }).catch((err) => { thumbFailed.add(name); console.error('[Folder browser] a picture could not be made:', err); })
      .finally(() => { thumbRunning--; thumbRunningNames.delete(name); thumbPending.delete(name); if (gen === generation) pumpThumbs(); });
  }
}

// ---------- selection ----------
const nameAt = (vi) => (data.view[vi] === undefined ? null : data.entries[data.view[vi]].n);
function selectedNames() { return [...data.selected].filter((n) => data.byName.has(n)); }
function selectOnly(vi) { const n = nameAt(vi); if (n === null) return; data.selected = new Set([n]); data.anchor = vi; }
function selectRange(a, b) {
  const lo = Math.max(0, Math.min(a, b)), hi = Math.min(data.view.length - 1, Math.max(a, b));
  const next = new Set();
  for (let vi = lo; vi <= hi; vi++) next.add(nameAt(vi));
  data.selected = next;
}
function setActive(vi, { focus = true, scroll = true } = {}) {
  if (vi < 0 || vi >= data.view.length) return;
  data.active = vi;
  list.setPinned(vi);
  if (scroll) list.scrollToIndex(vi);
  list.refresh();
  if (focus) focusActive();
}
function focusActive() {
  if (data.active < 0) return;
  const node = list.nodeAt(data.active);
  if (node && mode === 'folder' && !renaming) node.focus({ preventScroll: true });
}
function selectionChanged() {
  list.refresh();
  updateTools();
  updateStatus();
  pane.soon();
  const n = data.selected.size;
  if (n) announce(n === 1 ? [...data.selected][0] : t('{n} items selected', { n }));
}
function moveTo(vi, ev) {
  vi = Math.max(0, Math.min(data.view.length - 1, vi));
  if (!data.view.length) return;
  if (ev.shiftKey) { selectRange(data.anchor < 0 ? Math.max(data.active, 0) : data.anchor, vi); if (data.anchor < 0) data.anchor = Math.max(data.active, 0); }
  else if (!ev.ctrlKey && !ev.metaKey) selectOnly(vi);
  setActive(vi);
  selectionChanged();
}

// ---------- mouse ----------
function nodeOf(ev) { return ev.target.closest ? ev.target.closest('.fv-row, .fv-tile') : null; }
function onClick(ev) {
  if (ev.target.closest('.fv-rename') || ev.target.closest('#fv-head')) return;
  const node = nodeOf(ev);
  if (!node) { if (!ev.ctrlKey && !ev.shiftKey && data.selected.size) { data.selected = new Set(); selectionChanged(); } return; }
  const vi = Number(node.dataset.vi);
  if (ev.shiftKey) selectRange(data.anchor < 0 ? Math.max(data.active, 0) : data.anchor, vi);
  else if (ev.ctrlKey || ev.metaKey) { const n = nameAt(vi); const s = new Set(data.selected); if (s.has(n)) s.delete(n); else s.add(n); data.selected = s; data.anchor = vi; }
  else selectOnly(vi);
  setActive(vi, { scroll: false });
  selectionChanged();
}
function onDblClick(ev) {
  if (ev.target.closest('.fv-rename')) return;
  const node = nodeOf(ev);
  if (node) activate(node.dataset.name);
}
function onContext(ev) {
  if (mode !== 'folder') return;
  ev.preventDefault();
  const node = nodeOf(ev);
  if (node) {
    const vi = Number(node.dataset.vi), n = node.dataset.name;
    if (!data.selected.has(n)) { selectOnly(vi); }
    setActive(vi, { scroll: false });
    selectionChanged();
    openMenu({ at: { x: ev.clientX, y: ev.clientY }, items: itemMenu(selectedNames()), label: t('Actions') });
  } else {
    openMenu({ at: { x: ev.clientX, y: ev.clientY }, items: blankMenu(), label: t('Actions') });
  }
}
function onDragStart(ev) {
  const node = nodeOf(ev);
  if (!node) return;
  ev.preventDefault();
  const n = node.dataset.name;
  const names = data.selected.has(n) ? selectedNames().slice(0, 50) : [n];
  host.drag({ names }).then((r) => { if (!r.ok) toast(explain(r), 'error'); }).catch((err) => toast(err.message, 'error'));
}

// ---------- keys ----------
function inList(ev) { return refs['fv-wrap'].contains(ev.target); }
function onKey(ev) {
  if (dialogIsOpen() || menuIsOpen()) return;
  const k = ev.key, ctrl = ev.ctrlKey || ev.metaKey, alt = ev.altKey;
  const inField = ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement;
  if (alt && k === 'ArrowLeft') { ev.preventDefault(); history.back(); return; }
  if (alt && k === 'ArrowRight') { ev.preventDefault(); history.forward(); return; }
  if (alt && k === 'ArrowUp') { ev.preventDefault(); goUp(); return; }
  if (ctrl && !alt && (k === 'f' || k === 'F') && !ev.shiftKey) { ev.preventDefault(); refs['fv-filter'].focus(); refs['fv-filter'].select(); return; }
  if (k === 'F4' || (alt && (k === 'd' || k === 'D'))) { ev.preventDefault(); editPath(); return; }
  if (inField) return;
  if (ctrl && ev.shiftKey && (k === 'n' || k === 'N')) { ev.preventDefault(); newFolder(); return; }
  if (k === 'F5') { ev.preventDefault(); refreshNow(); return; }
  if (k === 'Backspace' && !ctrl && !alt) { ev.preventDefault(); goUp(); return; }
  if (mode !== 'folder' || !inList(ev) || renaming) return;
  const per = prefs.mode === 'large' ? list.perRow : 1;
  const last = data.view.length - 1;
  const cur = Math.max(0, data.active);
  switch (k) {
    case 'ArrowDown': ev.preventDefault(); moveTo(cur + per, ev); return;
    case 'ArrowUp': ev.preventDefault(); moveTo(cur - per, ev); return;
    case 'ArrowRight': if (prefs.mode === 'large') { ev.preventDefault(); moveTo(cur + 1, ev); } return;
    case 'ArrowLeft': if (prefs.mode === 'large') { ev.preventDefault(); moveTo(cur - 1, ev); } return;
    case 'PageDown': ev.preventDefault(); moveTo(cur + list.rowsPerPage * per, ev); return;
    case 'PageUp': ev.preventDefault(); moveTo(cur - list.rowsPerPage * per, ev); return;
    case 'Home': ev.preventDefault(); moveTo(0, ev); return;
    case 'End': ev.preventDefault(); moveTo(last, ev); return;
    case 'Enter': { ev.preventDefault(); const n = nameAt(cur); if (n !== null) activate(n); return; }
    case ' ': {
      ev.preventDefault();
      if (ctrl) { const n = nameAt(cur); const s = new Set(data.selected); if (s.has(n)) s.delete(n); else s.add(n); data.selected = s; data.anchor = cur; selectionChanged(); }
      else if (!data.selected.size) { selectOnly(cur); selectionChanged(); }
      return;
    }
    case 'F2': ev.preventDefault(); startRename(); return;
    case 'Delete': ev.preventDefault(); deleteSelected(); return;
    case 'ContextMenu': { ev.preventDefault(); const node = list.nodeAt(cur); const r = node ? node.getBoundingClientRect() : { left: 80, bottom: 120 }; openMenu({ at: { x: r.left + 40, y: r.bottom }, items: data.selected.size ? itemMenu(selectedNames()) : blankMenu(), label: t('Actions') }); return; }
    case 'Escape': if (data.selected.size) { data.selected = new Set(); selectionChanged(); } return;
    default:
  }
  if (ctrl && !alt && (k === 'a' || k === 'A')) { ev.preventDefault(); data.selected = new Set(Array.from(data.view, (i) => data.entries[i].n)); data.anchor = 0; selectionChanged(); return; }
  if (ctrl && !alt && (k === 'c' || k === 'C')) { ev.preventDefault(); copyNames(selectedNames(), ev.shiftKey ? 'url' : 'path'); return; }
  if (k === 'F10' && ev.shiftKey) { ev.preventDefault(); const node = list.nodeAt(cur); const r = node ? node.getBoundingClientRect() : { left: 80, bottom: 120 }; openMenu({ at: { x: r.left + 40, y: r.bottom }, items: data.selected.size ? itemMenu(selectedNames()) : blankMenu(), label: t('Actions') }); return; }
  if (k.length === 1 && !ctrl && !alt) typeAhead(k);
}
function typeAhead(ch) {
  clearTimeout(typeTimer);
  typeBuffer += ch;
  typeTimer = setTimeout(() => { typeBuffer = ''; }, 900);
  const q = fold(typeBuffer);
  const n = data.view.length;
  if (!n) return;
  const start = typeBuffer.length === 1 ? Math.max(0, data.active) + 1 : Math.max(0, data.active);
  for (let step = 0; step < n; step++) {
    const vi = (start + step) % n;
    if (foldedName(data, data.view[vi]).startsWith(q)) { selectOnly(vi); setActive(vi); selectionChanged(); return; }
  }
}

// ---------- opening ----------
function entryOf(name) { const i = data.byName.get(name); return i === undefined ? null : { i, e: data.entries[i], k: data.kinds[i] }; }
function activate(name) { openEntry(name, 'here'); }
function openEntry(name, how) {
  const x = entryOf(name);
  if (!x) return;
  if (x.e.d) {
    if (how === 'here') { try { sessionStorage.removeItem('fv.focus'); } catch { /* vex-allow-empty-catch: the "select where you came from" hint is a nicety */ } go(folder.fileUrl + encodeURIComponent(name) + '/'); }
    else host.tell('open', { name, mode: how, folder: true });
    return;
  }
  if (x.k.open === 'tab') { host.tell('open', { name, mode: how === 'here' ? 'here' : how }); return; }
  if (x.k.open === 'runnable') { openExternal(name); return; }
  openExternal(name);
}
async function openExternal(name, confirmed) {
  let r;
  try { r = await host.external({ name, confirmed: confirmed === true }); } catch (err) { toast(err.message, 'error'); return; }
  if (r.ok && r.needsConfirm) { warnRunnable(name); return; }
  if (!r.ok) toast(explain(r), 'error');
}
function warnRunnable(name) {
  const k = kindOf(name, false);
  openDialog({
    title: t('Open with Windows?'), role: 'alertdialog', focus: t('Cancel'),
    lead: t('This kind of file can run programs.'),
    body: el('div', {},
      el('p', { class: 'fv-dlg-name', dir: 'auto', text: name + '  (' + typeLabelOf(k) + ')' }),
      el('p', { text: t('Vex will not run it for you. If you open it, Windows decides what happens next, and a program can change this computer.') })),
    actions: [
      { label: t('Cancel') },
      { label: t('Show in File Explorer'), run: (close) => { close(); reveal(name); } },
      { label: t('Open with Windows anyway'), danger: true, run: (close) => { close(); openExternal(name, true); } },
    ],
  });
}
async function reveal(name) {
  const r = await host.reveal(name ? { name } : undefined);
  if (!r.ok) toast(explain(r), 'error');
}
async function copyNames(names, as) {
  const r = await host.copy({ names: names.length ? names : undefined, as });
  if (!r.ok) { toast(explain(r), 'error'); return; }
  toast(as === 'url' ? t('Copied the address') : as === 'name' ? t('Copied the name') : t('Copied the path'));
}

// ---------- folder size ----------
async function calcSize(name) {
  if (sizeTasks.has(name)) return;
  const r = await host.sizeStart({ name });
  if (!r.ok) { toast(explain(r), 'error'); return; }
  const f = { bytes: 0, files: 0, dirs: 0, done: false, partial: false, errors: 0 };
  data.folderSizes.set(name, f);
  const task = { id: r.id, timer: 0 };
  sizeTasks.set(name, task);
  const gen = generation;
  const poll = async () => {
    if (gen !== generation) return;
    const p = await host.sizePoll({ id: task.id }).catch((err) => ({ ok: false, error: err.message }));
    if (gen !== generation) return;
    if (!p.ok) { sizeTasks.delete(name); data.folderSizes.delete(name); toast(explain(p), 'error'); refreshName(name); return; }
    Object.assign(f, p.progress);
    refreshName(name);
    if (p.progress.done) { sizeTasks.delete(name); announce(t('{name}: {size}', { name, size: formatSize(f.bytes) })); return; }
    task.timer = setTimeout(poll, 350);
  };
  poll();
}
function refreshName(name) {
  for (const [vi, node] of list.nodes) if (node.dataset.name === name) bindItem(node, vi);
  if (data.selected.size === 1 && data.selected.has(name)) pane.show();
}
function cancelSizes() {
  for (const [, task] of sizeTasks) { clearTimeout(task.timer); host.sizeCancel({ id: task.id }).catch((err) => console.error('[Folder browser] a count could not be stopped:', err)); }
  sizeTasks.clear();
}

// ---------- rename, new folder, delete ----------
function startRename() {
  const names = selectedNames();
  if (names.length !== 1 || mode !== 'folder') return;
  renaming = { name: names[0] };
  const vi = positionOf(names[0]);
  if (vi < 0) { renaming = null; return; }
  setActive(vi, { focus: false });
  list.refreshOne(vi);
  const input = list.nodeAt(vi)?.querySelector('input.fv-rename');
  if (input) { input.focus(); const [base] = splitName(names[0]); input.setSelectionRange(0, base.length); }
}
function mountRename(node, name) {
  const input = el('input', { class: 'fv-rename', type: 'text', value: name, spellcheck: 'false', autocomplete: 'off', 'aria-label': t('New name') });
  let busy = false;
  const stop = (ev) => ev.stopPropagation();
  input.addEventListener('click', stop);
  input.addEventListener('dblclick', stop);
  input.addEventListener('keydown', async (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Escape') { ev.preventDefault(); endRename(); }
    else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (busy) return;
      const to = input.value.trim();
      if (!to || to === name) { endRename(); return; }
      busy = true;
      const r = await host.rename({ name, to }).catch((err) => ({ ok: false, error: err.message }));
      busy = false;
      if (!r.ok) { showRenameError(node, explain(r)); input.focus(); return; }
      applyRename(name, r.name);
    }
  });
  input.addEventListener('blur', () => { setTimeout(() => { if (renaming && renaming.name === name && !busy && document.activeElement !== input) endRename(); }, 120); });
  node._name.replaceChildren(input);
}
function showRenameError(node, text) {
  node.querySelector('.fv-rename-error')?.remove();
  const bubble = el('div', { class: 'fv-rename-error', role: 'alert', text });
  node.append(bubble);
  setTimeout(() => bubble.remove(), 5000);
}
function endRename() {
  if (!renaming) return;
  const name = renaming.name;
  renaming = null;
  const vi = positionOf(name);
  if (vi >= 0) list.refreshOne(vi);
  focusActive();
}
function applyRename(oldName, newName) {
  const i = data.byName.get(oldName);
  renaming = null;
  if (i === undefined) return;
  data.entries[i] = { ...data.entries[i], n: newName };
  data.byName.delete(oldName); data.byName.set(newName, i);
  data.folded[i] = undefined;
  data.kinds[i] = kindOf(newName, !!data.entries[i].d);
  data.selected = new Set([newName]);
  const f = data.folderSizes.get(oldName); if (f) { data.folderSizes.delete(oldName); data.folderSizes.set(newName, f); }
  thumbCache.delete(oldName);
  rebuild({ keepScroll: true });
  const vi = positionOf(newName);
  if (vi >= 0) { data.anchor = vi; setActive(vi); }
  list.refresh();
  selectionChanged();
  announce(t('Renamed to {name}', { name: newName }));
}
async function newFolder() {
  if (mode !== 'folder') return;
  const base = t('New folder');
  let name = base;
  for (let n = 2; n < 60; n++) {
    const r = await host.mkdir({ name });
    if (r.ok) { addEntry({ n: r.name, d: 1, h: 0 }); return; }
    if (r.code !== 'exists') { toast(explain(r), 'error'); return; }
    name = base + ' (' + n + ')';
  }
  toast(t('Something with that name is already here.'), 'error');
}
function addEntry(entry) {
  const i = data.entries.length;
  data.entries.push(entry);
  data.size.push(-1); data.mtime.push(Date.now()); data.flags.push(0); data.statState.push(2);
  data.folded.push(undefined);
  data.kinds.push(kindOf(entry.n, !!entry.d));
  data.byName.set(entry.n, i);
  rebuild({ keepScroll: true });
  const vi = positionOf(entry.n);
  data.selected = new Set([entry.n]); data.anchor = vi;
  setActive(vi);
  selectionChanged();
  announce(t('Created the folder {name}', { name: entry.n }));
  startRename();
}
async function deleteSelected() {
  const names = selectedNames();
  if (!names.length || mode !== 'folder') return;
  const shown = names.slice(0, 6);
  const body = el('div', {}, el('ul', {}, shown.map((n) => el('li', { dir: 'auto', text: n })), names.length > shown.length ? el('li', { text: t('and {n} more', { n: names.length - shown.length }) }) : null));
  const yes = await confirmDialog({
    title: names.length === 1 ? t('Move this item to the Recycle Bin?') : t('Move {n} items to the Recycle Bin?', { n: names.length }),
    lead: t('You can get them back from the Recycle Bin. Nothing is deleted for good.'),
    body, ok: t('Move to the Recycle Bin'), danger: true,
  });
  if (!yes) { focusActive(); return; }
  const r = await host.trash({ names, confirmed: true });
  if (!r.ok) { toast(explain(r), 'error'); return; }
  const gone = r.results.filter((x) => x.ok).map((x) => x.name);
  const failed = r.results.filter((x) => !x.ok);
  if (gone.length) removeEntries(gone);
  if (failed.length) toast(t('{n} could not be moved to the Recycle Bin: {why}', { n: failed.length, why: explain(failed[0]) }) + (gone.length === 0 ? ' ' + t('Nothing was deleted.') : ''), 'error');
  else toast(gone.length === 1 ? t('Moved to the Recycle Bin') : t('Moved {n} items to the Recycle Bin', { n: gone.length }));
}
function removeEntries(names) {
  const drop = new Set(names);
  const keepActive = Math.max(0, data.active);
  const remaining = data.entries.filter((e) => !drop.has(e.n));
  const old = { size: data.size, mtime: data.mtime, flags: data.flags, state: data.statState, byName: data.byName };
  const carry = remaining.map((e) => old.byName.get(e.n));
  loadEntries(data, remaining);
  data.size = carry.map((i) => old.size[i]); data.mtime = carry.map((i) => old.mtime[i]); data.flags = carry.map((i) => old.flags[i]); data.statState = carry.map((i) => old.state[i]);
  hiddenCount = remaining.filter((e) => e.h).length;
  data.selected = new Set();
  data.active = -1;
  rebuild({ keepScroll: true });
  if (data.view.length) { const vi = Math.min(keepActive, data.view.length - 1); selectOnly(vi); setActive(vi); }
  selectionChanged();
}

// ---------- menus ----------
function itemMenu(names) {
  const one = names.length === 1 ? entryOf(names[0]) : null;
  const items = [];
  if (one) {
    items.push({ label: t('Open'), icon: 'folder-open', keys: 'Enter', run: () => activate(names[0]) });
    if (one.e.d || one.k.open === 'tab') items.push({ label: t('Open in a new tab'), icon: 'tabs', run: () => openEntry(names[0], 'tab') });
    if (!one.e.d) items.push({ label: t('Open with Windows'), icon: 'external', run: () => openExternal(names[0]) });
    if (one.e.d) items.push({ label: t('Calculate the folder size'), icon: 'ruler', run: () => calcSize(names[0]) });
    items.push({ type: 'sep' });
  }
  items.push({ label: t('Copy path'), icon: 'copy', keys: 'Ctrl+C', run: () => copyNames(names, 'path') });
  items.push({ label: t('Copy as an address'), icon: 'link', keys: 'Ctrl+Shift+C', run: () => copyNames(names, 'url') });
  if (one) items.push({ label: t('Copy the name'), icon: 'clipboard', run: () => copyNames(names, 'name') });
  items.push({ type: 'sep' });
  if (one) items.push({ label: t('Show in File Explorer'), icon: 'external', run: () => reveal(names[0]) });
  if (one) items.push({ label: t('Rename'), icon: 'edit', keys: 'F2', run: () => startRename() });
  items.push({ label: t('Move to the Recycle Bin'), icon: 'trash', keys: 'Del', danger: true, run: () => deleteSelected() });
  return items;
}
function blankMenu() {
  return [
    { label: t('New folder'), icon: 'folder-plus', keys: 'Ctrl+Shift+N', run: () => newFolder() },
    { type: 'sep' },
    { label: t('Refresh'), icon: 'refresh', keys: 'F5', run: () => refreshNow() },
    { label: t('Copy folder path'), icon: 'copy', run: () => copyNames([], 'path') },
    { label: t('Open this folder in File Explorer'), icon: 'external', run: () => reveal() },
    { label: t('Hidden files'), role: 'menuitemcheckbox', checked: prefs.hidden, run: () => toggleHidden() },
  ];
}
function sortMenu() {
  const set = (key) => () => setSort(key);
  return [
    { type: 'label', text: t('Sort by') },
    { label: t('Name'), role: 'menuitemradio', checked: prefs.sort === 'name', run: set('name') },
    { label: t('Modified'), role: 'menuitemradio', checked: prefs.sort === 'date', run: set('date') },
    { label: t('Type'), role: 'menuitemradio', checked: prefs.sort === 'type', run: set('type') },
    { label: t('Size'), role: 'menuitemradio', checked: prefs.sort === 'size', run: set('size') },
    { type: 'sep' },
    { label: t('Ascending'), role: 'menuitemradio', checked: prefs.dir === 1, run: () => setSort(prefs.sort, 1) },
    { label: t('Descending'), role: 'menuitemradio', checked: prefs.dir === -1, run: () => setSort(prefs.sort, -1) },
  ];
}
function viewMenu() {
  return [
    { type: 'label', text: t('View') },
    { label: t('Details'), role: 'menuitemradio', checked: prefs.mode === 'details', run: () => setViewMode('details') },
    { label: t('List'), role: 'menuitemradio', checked: prefs.mode === 'list', run: () => setViewMode('list') },
    { label: t('Large thumbnails'), role: 'menuitemradio', checked: prefs.mode === 'large', run: () => setViewMode('large') },
    { type: 'sep' },
    { label: t('Preview pane'), role: 'menuitemcheckbox', checked: prefs.pane, run: () => togglePane() },
    { label: t('Hidden files'), role: 'menuitemcheckbox', checked: prefs.hidden, run: () => toggleHidden() },
  ];
}
function moreMenu() {
  return [
    { label: t('Open this folder in File Explorer'), icon: 'external', run: () => reveal() },
    { label: t('Copy folder path'), icon: 'copy', run: () => copyNames([], 'path') },
    { label: t('Copy folder address'), icon: 'link', run: () => copyNames([], 'url') },
    { type: 'sep' },
    { label: t('Open in the plain list'), icon: 'list', run: () => plainList() },
  ];
}
async function plainList() {
  const r = await host.plainList();
  if (!r.ok) toast(explain(r), 'error');
}

// ---------- settings of the view ----------
function setSort(key, dir) {
  if (dir === undefined) dir = prefs.sort === key ? -prefs.dir : 1;
  prefs.sort = key; prefs.dir = dir; savePrefs(prefs);
  rebuild({ keepScroll: true });
  list.refresh();
  announce(t('Sorted by {key}, {dir}', { key: sortName(key), dir: dir === 1 ? t('ascending') : t('descending') }));
}
function sortName(key) { return key === 'name' ? t('Name') : key === 'date' ? t('Modified') : key === 'type' ? t('Type') : t('Size'); }
function setViewMode(next) {
  if (prefs.mode === next) return;
  prefs.mode = next; savePrefs(prefs);
  syncPrefsToUi();
  if (mode === 'folder') { rebuild({ keepScroll: false }); list.refresh(); if (next === 'large') scheduleThumbs(list.range[0], list.range[1]); focusActive(); }
}
function toggleHidden() { prefs.hidden = !prefs.hidden; savePrefs(prefs); syncPrefsToUi(); if (mode === 'folder') { rebuild({ keepScroll: true }); list.refresh(); } announce(prefs.hidden ? t('Hidden files are shown') : t('Hidden files are not shown')); }
function togglePane() { prefs.pane = !prefs.pane; savePrefs(prefs); syncPrefsToUi(); if (prefs.pane) pane.show(); else pane.clear(); }
function syncPrefsToUi() {
  document.body.dataset.view = prefs.mode;
  document.body.dataset.pane = prefs.pane ? 'on' : 'off';
  const wrap = refs['fv-wrap'];
  wrap.setAttribute('role', prefs.mode === 'details' ? 'grid' : 'listbox');
  refs['fv-scroll'].setAttribute('role', prefs.mode === 'details' ? 'rowgroup' : 'presentation');
  refs['fv-content'].setAttribute('role', 'presentation');
  refs['fv-hidden'].setAttribute('aria-pressed', String(prefs.hidden));
  refs['fv-pane-toggle'].setAttribute('aria-pressed', String(prefs.pane));
  const hiddenIcon = refs['fv-hidden'].querySelector('svg');
  if (hiddenIcon) hiddenIcon.outerHTML = icon(prefs.hidden ? 'eye' : 'eye-off', 18);
  const modeIcon = prefs.mode === 'details' ? 'table' : prefs.mode === 'list' ? 'list' : 'grid';
  const vm = refs['fv-viewmode'].querySelector('svg');
  if (vm) vm.outerHTML = icon(modeIcon, 18);
  updateHeaders();
}
function updateHeaders() {
  for (const cell of refs['fv-head'].querySelectorAll('.fv-hcell')) {
    if (cell.dataset.sort === prefs.sort) cell.setAttribute('aria-sort', prefs.dir === 1 ? 'ascending' : 'descending'); else cell.removeAttribute('aria-sort');
  }
}

// ---------- the bars ----------
function updateTools() {
  const folderMode = mode === 'folder';
  const n = folderMode ? selectedNames().length : 0;
  refs['fv-new'].disabled = !folderMode;
  refs['fv-rename'].disabled = n !== 1;
  refs['fv-delete'].disabled = n < 1;
  refs['fv-copy'].disabled = !folderMode && mode !== 'thispc';
  refs['fv-reveal'].disabled = !folderMode;
  refs['fv-sort'].disabled = !folderMode;
  refs['fv-viewmode'].disabled = !folderMode;
  refs['fv-hidden'].disabled = !folderMode;
  refs['fv-more'].disabled = !folderMode;
  refs['fv-filter'].disabled = !folderMode;
  refs['fv-up'].disabled = !upTarget();
}
function updateStatus() {
  if (mode !== 'folder') { refs['fv-count'].textContent = ''; refs['fv-progress'].textContent = ''; return; }
  const shown = data.view.length, total = data.entries.length;
  const parts = [];
  parts.push(filterText && shown !== total ? t('{shown} of {n} items', { shown: formatNumber(shown), n: formatNumber(total) }) : (shown === 1 ? t('1 item') : t('{n} items', { n: formatNumber(shown) })));
  const sel = selectedNames();
  if (sel.length) {
    let bytes = 0, known = true;
    for (const nme of sel) { const i = data.byName.get(nme); if (i === undefined || data.entries[i].d) continue; if (data.size[i] >= 0) bytes += data.size[i]; else known = false; }
    parts.push(t('{n} selected', { n: formatNumber(sel.length) }) + (known && bytes ? ' · ' + formatSize(bytes) : ''));
  }
  if (!prefs.hidden && hiddenCount) parts.push(t('{n} hidden', { n: formatNumber(hiddenCount) }));
  refs['fv-count'].textContent = parts.join('  ·  ');
  refs['fv-progress'].textContent = statProgress < 1 ? t('Reading details… {pct}%', { pct: Math.floor(statProgress * 100) }) : '';
  const banner = refs['fv-banner'];
  const notes = [];
  if (folder && folder.truncated) notes.push(t('This folder has {n} items. Only the first {shown} are shown.', { n: formatNumber(folder.total), shown: formatNumber(folder.entries.length) }));
  if (folder && folder.hiddenKnown === false) notes.push(t('Vex could not tell which files are hidden in this folder.'));
  banner.hidden = !notes.length;
  banner.textContent = notes.join(' ');
}
function updateAll() { updateTools(); updateStatus(); updateHeaders(); renderCrumbs(); pane.show().catch((err) => console.error('[Folder browser] the preview failed:', err)); updateHistoryButtons(); }
function updateHistoryButtons() {
  const nav = window.navigation;
  refs['fv-back'].disabled = nav ? !nav.canGoBack : false;
  refs['fv-fwd'].disabled = nav ? !nav.canGoForward : false;
}

function renderCrumbs() {
  const ol = refs['fv-crumb-list'];
  ol.replaceChildren();
  const crumbs = crumbsOf(mode === 'thispc' ? 'file:///' : (folder ? folder.fileUrl : PAGE_URL_PARAM), t('This PC'));
  crumbs.forEach((c, idx) => {
    const last = idx === crumbs.length - 1;
    const b = el('button', { class: 'fv-crumb', type: 'button', 'aria-current': last ? 'page' : null, text: c.label, title: c.label });
    b.addEventListener('click', () => { if (!last) go(c.url); else refreshNow(); });
    ol.append(el('li', {}, b));
  });
  // The last part stays in view when the path is longer than the bar.
  refs['fv-crumbs'].scrollLeft = 0;
}
function editPath() {
  const input = refs['fv-path'];
  if (!input.hidden) { input.focus(); input.select(); return; }
  input.value = folder && mode === 'folder' ? folder.path : '';
  input.hidden = false;
  input.focus();
  input.select();
}
function closePathEditor() { refs['fv-path'].hidden = true; }

function buildPlaces() {
  const box = refs['fv-places'];
  box.replaceChildren();
  const current = folder ? folder.fileUrl : (mode === 'thispc' ? 'file:///' : '');
  const add = (parent, label, url, ico) => {
    const b = el('button', { class: 'fv-place', type: 'button', 'aria-current': current === url ? 'page' : null }, iconSpan(ico, 16), el('span', { class: 'fv-label', text: label }));
    b.addEventListener('click', () => go(url));
    parent.append(b);
  };
  const names = { home: t('Home'), desktop: t('Desktop'), documents: t('Documents'), downloads: t('Downloads'), pictures: t('Pictures'), music: t('Music'), videos: t('Videos') };
  const icons = { home: 'home', desktop: 'monitor', documents: 'file-text', downloads: 'download', pictures: 'image', music: 'music', videos: 'video' };
  box.append(el('h2', { text: t('Places') }));
  add(box, t('This PC'), 'file:///', 'monitor');
  for (const p of places) add(box, names[p.id] || p.id, p.url, icons[p.id] || 'folder');
  const recent = loadRecent().filter((r) => r.url !== 'file:///').slice(0, 8);
  if (recent.length) {
    box.append(el('h2', { text: t('Recent folders') }));
    for (const r of recent) add(box, r.name, r.url, 'history');
  }
}

// ---------- the other states ----------
function setMode(next) {
  mode = next;
  document.body.dataset.kind = next;
  const folderMode = next === 'folder';
  refs['fv-wrap'].hidden = !folderMode;
  refs['fv-state'].hidden = folderMode;
  if (!folderMode) cancelStateOnly();
  if (next === 'loading') {
    refs['fv-state'].replaceChildren(el('div', { class: 'fv-card' }, el('div', { class: 'fv-spinner', role: 'img', 'aria-label': t('Reading the folder…') }), el('p', { text: t('Reading the folder…') })));
    if (pane) pane.clear();
  }
  updateTools();
  if (next !== 'folder') { updateStatus(); renderCrumbs(); }
}
function cancelStateOnly() { /* nothing to cancel: the stat loop checks `generation` */ }
function showError(r) {
  setMode('error');
  const code = r.code;
  const title = code === 'denied' ? t('Vex cannot open this folder') : code === 'missing' ? t('This folder is not there') : code === 'gone' || code === 'timeout' ? t('This location is not answering') : t('This folder could not be opened');
  const box = el('div', { class: 'fv-card bad' }, iconSpan('warning', 40), el('h1', { text: title }), el('p', { text: explain(r) }), el('p', { class: 'fv-path-note', dir: 'ltr', text: decodeUrlPath(PAGE_URL_PARAM) }));
  const actions = el('div', { class: 'fv-actions' });
  actions.append(el('button', { class: 'fv-btn-text primary', type: 'button', text: t('Try again'), onclick: () => load() }));
  const parentUrl = parentOf(PAGE_URL_PARAM);
  if (parentUrl) actions.append(el('button', { class: 'fv-btn-text', type: 'button', text: t('Go up one folder'), onclick: () => go(parentUrl) }));
  actions.append(el('button', { class: 'fv-btn-text', type: 'button', text: t('This PC'), onclick: () => go('file:///') }));
  actions.append(el('button', { class: 'fv-btn-text', type: 'button', text: t('Open in the plain list'), onclick: () => plainList() }));
  box.append(actions);
  refs['fv-state'].replaceChildren(box);
  refs['fv-up'].disabled = !parentUrl;
  document.title = t('Folder');
  buildPlaces();
  updateHistoryButtons();
  box.querySelector('button').focus();
}
function decodeUrlPath(url) { try { const u = new URL(url); const p = decodeURIComponent(u.pathname).replace(/^\//, '').replace(/\//g, '\\'); return u.hostname ? '\\\\' + u.hostname + '\\' + p : p; } catch { return url; } }
function parentOf(url) {
  const crumbs = crumbsOf(url, 'x');
  return crumbs.length > 1 ? crumbs[crumbs.length - 2].url : null;
}
function showFileCard(r) {
  setMode('file');
  folder = { ...r, parentUrl: parentOf(PAGE_URL_PARAM) };
  const box = el('div', { class: 'fv-card' }, iconSpan('file', 40), el('h1', { dir: 'auto', text: r.name }), el('p', { text: t('This is a file, not a folder.') }), el('p', { class: 'fv-path-note', dir: 'ltr', text: r.path }));
  const actions = el('div', { class: 'fv-actions' });
  actions.append(el('button', { class: 'fv-btn-text primary', type: 'button', text: t('Open it as a file'), onclick: () => host.openAsFile().then((x) => { if (!x.ok) toast(explain(x), 'error'); }) }));
  if (folder.parentUrl) actions.append(el('button', { class: 'fv-btn-text', type: 'button', text: t('Go up one folder'), onclick: () => go(folder.parentUrl) }));
  box.append(actions);
  refs['fv-state'].replaceChildren(box);
  document.title = r.name;
  refs['fv-up'].disabled = !folder.parentUrl;
  buildPlaces();
  updateHistoryButtons();
  box.querySelector('button').focus();
}
function showThisPc(r) {
  setMode('thispc');
  folder = null;
  document.title = t('This PC');
  const wrap = el('div', { class: 'fv-pc' }, el('h1', { text: t('This PC') }));
  const drives = el('div', { class: 'fv-drives', role: 'list', 'aria-label': t('Drives') });
  for (const d of r.drives) {
    const used = d.total ? 1 - d.free / d.total : 0;
    const label = t('Drive {letter}:', { letter: d.letter });
    const card = el('button', { class: 'fv-drive', type: 'button', role: 'listitem' },
      iconSpan('drive', 30),
      el('div', { class: 'fv-drive-body' },
        el('div', { class: 'fv-drive-name', text: label }),
        d.total ? el('div', { class: 'fv-bar' + (used > 0.9 ? ' full' : ''), role: 'img', 'aria-label': t('{pct}% used', { pct: Math.round(used * 100) }) }, el('i', { style: 'width:' + Math.round(used * 100) + '%' })) : null,
        d.total ? el('div', { class: 'fv-drive-sub', text: t('{free} free of {total}', { free: formatSize(d.free), total: formatSize(d.total) }) }) : el('div', { class: 'fv-drive-sub', text: t('Ready') })));
    card.addEventListener('click', () => go(d.url));
    drives.append(card);
  }
  wrap.append(drives);
  if (!r.drives.length) wrap.append(el('p', { text: t('No drives answered.') }));
  refs['fv-state'].replaceChildren(wrap);
  refs['fv-up'].disabled = true;
  host.places().then((p) => { if (p.ok) { places = p.places; } buildPlaces(); addQuick(wrap); }).catch((err) => console.error('[Folder browser] the places could not be read:', err));
  updateHistoryButtons();
  drives.querySelector('button')?.focus();
}
function addQuick(wrap) {
  if (!places.length || wrap.querySelector('.fv-quick')) return;
  const names = { home: t('Home'), desktop: t('Desktop'), documents: t('Documents'), downloads: t('Downloads'), pictures: t('Pictures'), music: t('Music'), videos: t('Videos') };
  const icons = { home: 'home', desktop: 'monitor', documents: 'file-text', downloads: 'download', pictures: 'image', music: 'music', videos: 'video' };
  const box = el('div', { class: 'fv-quick' });
  for (const p of places) {
    const b = el('button', { class: 'fv-btn-text', type: 'button' }, iconSpan(icons[p.id] || 'folder', 16), ' ', names[p.id] || p.id);
    b.addEventListener('click', () => go(p.url));
    box.append(b);
  }
  wrap.append(el('h2', { text: t('Places') }), box);
}

// ---------- going places ----------
function upTarget() {
  if (mode === 'thispc' || mode === 'loading') return null;
  return folder && folder.parentUrl ? folder.parentUrl : parentOf(PAGE_URL_PARAM);
}
function goUp() {
  const url = upTarget();
  if (!url) return;
  if (folder) { try { sessionStorage.setItem('fv.focus', folder.name); } catch { /* vex-allow-empty-catch: the "select where you came from" hint is a nicety */ } }
  go(url);
}
function refreshNow() { if (mode === 'thispc') { load(); return; } load({ keep: true }); }
async function ping() {
  if (mode !== 'folder' || Date.now() - lastPing < 2500) return;
  lastPing = Date.now();
  let r;
  try { r = await host.ping(); } catch { return; }
  if (!r.ok) return;
  if (!r.exists) { showError({ code: r.code || 'gone' }); return; }
  refs['fv-changed'].hidden = !(loadedMtime && r.mtimeMs && r.mtimeMs !== loadedMtime);
}

// ---------- wiring ----------
function wire() {
  refs['fv-back'].addEventListener('click', () => history.back());
  refs['fv-fwd'].addEventListener('click', () => history.forward());
  refs['fv-up'].addEventListener('click', goUp);
  refs['fv-refresh'].addEventListener('click', refreshNow);
  refs['fv-changed'].addEventListener('click', () => { refs['fv-changed'].hidden = true; refreshNow(); });
  refs['fv-edit-path'].addEventListener('click', editPath);
  refs['fv-crumbs'].addEventListener('dblclick', (ev) => { if (ev.target === refs['fv-crumbs'] || ev.target.tagName === 'OL') editPath(); });
  refs['fv-crumbs'].addEventListener('click', (ev) => { if (ev.target === refs['fv-crumbs'] || ev.target.tagName === 'OL') editPath(); });
  refs['fv-path'].addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Escape') { ev.preventDefault(); closePathEditor(); focusActive(); }
    else if (ev.key === 'Enter') {
      ev.preventDefault();
      const url = typedToFileUrl(refs['fv-path'].value);
      if (!url) { toast(t('Type a full path, such as C:\\Users or \\\\server\\share'), 'error'); return; }
      closePathEditor();
      go(url);
    }
  });
  refs['fv-path'].addEventListener('blur', () => setTimeout(closePathEditor, 100));
  refs['fv-filter'].addEventListener('input', () => {
    filterText = refs['fv-filter'].value;
    clearTimeout(wire._t);
    wire._t = setTimeout(() => { if (mode === 'folder') { rebuild({ resetScroll: true }); list.refresh(); } }, 80);
  });
  refs['fv-filter'].addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); if (refs['fv-filter'].value) { refs['fv-filter'].value = ''; filterText = ''; rebuild({ resetScroll: true }); list.refresh(); } else focusActive(); }
    else if (ev.key === 'ArrowDown' || ev.key === 'Enter') { ev.preventDefault(); focusActive(); }
  });
  refs['fv-new'].addEventListener('click', newFolder);
  refs['fv-rename'].addEventListener('click', startRename);
  refs['fv-delete'].addEventListener('click', deleteSelected);
  refs['fv-copy'].addEventListener('click', () => copyNames(selectedNames(), 'path'));
  refs['fv-reveal'].addEventListener('click', () => { const n = selectedNames(); reveal(n.length === 1 ? n[0] : undefined); });
  refs['fv-sort'].addEventListener('click', () => openMenu({ anchor: refs['fv-sort'], items: sortMenu(), label: t('Sort') }));
  refs['fv-viewmode'].addEventListener('click', () => openMenu({ anchor: refs['fv-viewmode'], items: viewMenu(), label: t('View') }));
  refs['fv-more'].addEventListener('click', () => openMenu({ anchor: refs['fv-more'], items: moreMenu(), label: t('More') }));
  refs['fv-hidden'].addEventListener('click', toggleHidden);
  refs['fv-pane-toggle'].addEventListener('click', togglePane);
  for (const cell of refs['fv-head'].querySelectorAll('.fv-hcell')) cell.querySelector('button').addEventListener('click', () => setSort(cell.dataset.sort));
  const content = refs['fv-wrap'];
  content.addEventListener('click', onClick);
  content.addEventListener('dblclick', onDblClick);
  content.addEventListener('contextmenu', onContext);
  content.addEventListener('dragstart', onDragStart);
  document.addEventListener('keydown', onKey);
  window.addEventListener('focus', ping);
  window.addEventListener('pageshow', () => updateHistoryButtons());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(); });
  new ResizeObserver(() => { const sb = refs['fv-scroll'].offsetWidth - refs['fv-scroll'].clientWidth; document.documentElement.style.setProperty('--fv-sb', sb + 'px'); }).observe(refs['fv-scroll']);
}

function relocalize() {
  applyStatic(document);
  buildPlaces();
  renderCrumbs();
  if (mode === 'folder') { rebuild({ keepScroll: true }); list.refresh(); pane.show(); }
  else if (mode === 'thispc') load();
}

boot();

// What tests and the real-Chromium checks read.
window.__vexFolderBrowser = { get mode() { return mode; }, data, prefs, get folder() { return folder; }, setViewMode, setSort, toggleHidden, setLang, getLang, rebuild, extOf };
