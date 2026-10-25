// What the page knows about the folder it shows, and what it remembers between visits. No DOM here.

import { kindOf, extOf } from './kinds.js';
import { fold, nameCollator, orderEntries } from './format.js';

export const PREFS_KEY = 'fv.prefs.v1';
export const RECENT_KEY = 'fv.recent.v1';
export const DEFAULT_PREFS = Object.freeze({ mode: 'details', sort: 'name', dir: 1, pane: true, hidden: false });

export function loadPrefs() {
  let raw = null;
  try { raw = localStorage.getItem(PREFS_KEY); } catch (err) { console.error('[Folder browser] the saved settings could not be read:', err.message); }
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    const p = JSON.parse(raw);
    return {
      mode: ['details', 'list', 'large'].includes(p.mode) ? p.mode : DEFAULT_PREFS.mode,
      sort: ['name', 'date', 'type', 'size'].includes(p.sort) ? p.sort : DEFAULT_PREFS.sort,
      dir: p.dir === -1 ? -1 : 1, pane: p.pane !== false, hidden: p.hidden === true,
    };
  } catch (err) { console.error('[Folder browser] the saved settings are not readable:', err.message); return { ...DEFAULT_PREFS }; }
}
export function savePrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }
  catch (err) { console.error('[Folder browser] the settings could not be saved:', err.message); }
}

export function loadRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(list) ? list.filter((r) => r && typeof r.url === 'string' && typeof r.name === 'string').slice(0, 12) : [];
  } catch (err) { console.error('[Folder browser] the recent folders could not be read:', err.message); return []; }
}
export function noteRecent(url, name) {
  const list = loadRecent().filter((r) => r.url !== url);
  list.unshift({ url, name, at: Date.now() });
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 12))); }
  catch (err) { console.error('[Folder browser] the recent folders could not be saved:', err.message); }
}
export function forgetRecent() {
  try { localStorage.removeItem(RECENT_KEY); } catch (err) { console.error('[Folder browser] the recent folders could not be cleared:', err.message); }
}

// The folder: entries from main ({ n: name, d: folder, h: hidden, l: link, b: broken link }) and, per entry, the details that come later.
export function createData() {
  return {
    entries: [], size: [], mtime: [], flags: [], statState: [],   // statState: 0 unknown, 1 asked, 2 known
    byName: new Map(), folded: [], kinds: [],
    view: new Int32Array(0),
    selected: new Set(), anchor: -1, active: -1,
    folderSizes: new Map(),
  };
}

export function loadEntries(data, entries) {
  data.entries = entries;
  const n = entries.length;
  data.size = new Array(n).fill(-2);
  data.mtime = new Array(n).fill(0);
  data.flags = new Array(n).fill(0);
  data.statState = new Array(n).fill(0);
  data.folded = new Array(n);
  data.kinds = new Array(n);
  data.byName = new Map();
  const cache = new Map();
  for (let i = 0; i < n; i++) {
    const e = entries[i];
    data.byName.set(e.n, i);
    const key = e.d ? '/' : extOf(e.n);
    let k = cache.get(key);
    if (!k) { k = kindOf(e.n, !!e.d); cache.set(key, k); }
    data.kinds[i] = k;
  }
}
export function foldedName(data, i) { return data.folded[i] !== undefined && data.folded[i] !== null ? data.folded[i] : (data.folded[i] = fold(data.entries[i].n)); }

// The indexes shown, in order: the filter and the hidden switch applied, then the sort (folders first).
export function buildView(data, { filter, hidden, sort, dir }, typeLabel) {
  const q = filter ? fold(filter) : '';
  const out = [];
  for (let i = 0; i < data.entries.length; i++) {
    const e = data.entries[i];
    if (!hidden && e.h) continue;
    if (q && !foldedName(data, i).includes(q)) continue;
    out.push(i);
  }
  const col = nameCollator();
  const byName = (a, b) => col.compare(data.entries[a].n, data.entries[b].n);
  const isDir = (i) => data.entries[i].d === 1;
  let compareFiles = byName;
  if (sort === 'date') compareFiles = (a, b) => (data.mtime[a] - data.mtime[b]) || byName(a, b);
  else if (sort === 'size') compareFiles = (a, b) => (data.size[a] - data.size[b]) || byName(a, b);
  else if (sort === 'type') {
    const label = (i) => typeLabel(data.kinds[i]);
    compareFiles = (a, b) => (label(a).localeCompare(label(b)) || byName(a, b));
  }
  // Folders have no size to sort by: they stay in name order, and a date sort orders them by date.
  const compareDirs = sort === 'date' ? ((a, b) => (data.mtime[a] - data.mtime[b]) || byName(a, b)) : byName;
  data.view = orderEntries(out, isDir, compareDirs, compareFiles, dir === -1);
  return data.view;
}
