// === chrome.history, chrome.bookmarks and chrome.topSites, read-only (2026-11-01) ===
//
// Vex keeps the history (vex.history: { id, url, title, visitedAt } per visit) and the bookmarks (vex.bookmarks: { id, url, title, folder, at }) in
// its own saved settings, not in Chromium, so Electron's extension support has neither API. Vimium's address-bar search, SingleFile, Raindrop
// and the "most visited" pages of tab managers read them. This answers the READING half from Vex's saved lists, and nothing else:
//   - only for an extension that names the permission in its manifest (the caller checks), and only normal browsing: a visit or a bookmark made
//     in a session of its own (a container, a Tor or proxy route: `ownSession`) is never shown;
//   - nothing here writes: addUrl, deleteUrl, deleteAll, bookmarks.create/update/remove/move are refused by the stand-ins with a sentence.
// The functions are pure (they are given the saved text), so they are tested without Electron.
const DAY = 86400000;
const MAX_ROWS = 5000;

// The saved list as an array, or an Error that says what is wrong: never an empty list in place of an unreadable one.
function parseList(raw, what) {
  if (raw === undefined || raw === null || raw === '') return [];
  let parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch (err) { throw new Error(`Vex could not read your ${what}: ${err.message}`, { cause: err }); }
  const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.entries) ? parsed.entries : null);
  if (!list) throw new Error(`Vex could not read your ${what}: it is not a list`);
  return list;
}

const web = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);

// [{ id, url, title, time }] newest first, ordinary sessions only.
function historyEntries(raw) {
  const out = [];
  for (const e of parseList(raw, 'history').slice(0, MAX_ROWS)) {
    if (!e || e.ownSession === true || !web(e.url)) continue;
    const time = Date.parse(e.visitedAt || e.at || e.time || '');
    if (!Number.isFinite(time)) continue;
    out.push({ id: String(e.id || time), url: e.url, title: typeof e.title === 'string' ? e.title : '', time });
  }
  return out.sort((a, b) => b.time - a.time);
}

// chrome.history.search({ text, startTime, endTime, maxResults }) → HistoryItem[]. One row per address (Chrome's), newest first.
function historySearch(entries, query, now) {
  const q = query && typeof query === 'object' ? query : {};
  const text = String(q.text || '').toLowerCase().split(/\s+/).filter(Boolean);
  const start = Number.isFinite(q.startTime) ? q.startTime : now - DAY;   // Chrome: the last 24 hours unless told
  const end = Number.isFinite(q.endTime) ? q.endTime : now;
  const max = Number.isInteger(q.maxResults) && q.maxResults >= 0 ? q.maxResults : 100;
  const byUrl = new Map();
  for (const e of entries) {
    if (e.time < start || e.time > end) continue;
    if (text.length) {
      const hay = (e.title + ' ' + e.url).toLowerCase();
      if (!text.every(w => hay.includes(w))) continue;
    }
    const row = byUrl.get(e.url);
    if (row) { row.visitCount++; if (e.time > row.lastVisitTime) { row.lastVisitTime = e.time; if (e.title) row.title = e.title; } }
    else byUrl.set(e.url, { id: e.id, url: e.url, title: e.title, lastVisitTime: e.time, visitCount: 1, typedCount: 0 });
  }
  return [...byUrl.values()].sort((a, b) => b.lastVisitTime - a.lastVisitTime).slice(0, max);
}

// chrome.history.getVisits({ url }) → VisitItem[].
function historyVisits(entries, url) {
  if (!web(url)) throw new Error('history.getVisits needs a web address');
  return entries.filter(e => e.url === url).map(e => ({ id: e.id, visitId: e.id, visitTime: e.time, referringVisitId: '0', transition: 'link', isLocal: true }));
}

// chrome.topSites.get() → [{ url, title }]: the addresses visited most, one per site, at most 20.
function topSites(entries) {
  const sites = new Map();   // host -> Map(url -> { n, title, last })
  for (const e of entries) {
    let host;
    try { host = new URL(e.url).hostname; } catch { continue; }
    if (!sites.has(host)) sites.set(host, new Map());
    const urls = sites.get(host);
    const row = urls.get(e.url) || { n: 0, title: e.title, last: 0 };
    row.n++; if (e.time > row.last) { row.last = e.time; if (e.title) row.title = e.title; }
    urls.set(e.url, row);
  }
  const rows = [];
  for (const urls of sites.values()) {
    let total = 0; let best = null;
    for (const [url, r] of urls) { total += r.n; if (!best || r.n > best.r.n) best = { url, r }; }
    rows.push({ total, url: best.url, title: best.r.title });
  }
  return rows.sort((a, b) => b.total - a.total).slice(0, 20).map(r => ({ url: r.url, title: r.title }));
}

// === bookmarks ===
// Chrome's tree: root '0' → 'Bookmarks bar' ('1', empty here) and 'Other bookmarks' ('2'), which holds Vex's folders (one level, by name)
// and the unsorted bookmarks. A Vex folder's id is 'f:' + its name.
function bookmarkNodes(raw) {
  const items = [];
  for (const b of parseList(raw, 'bookmarks').slice(0, MAX_ROWS)) {
    if (!b || b.ownSession === true || !web(b.url) || b.id === undefined) continue;
    items.push({ id: String(b.id), url: b.url, title: typeof b.title === 'string' ? b.title : '', folder: typeof b.folder === 'string' ? b.folder.trim() : '', at: Number.isFinite(b.at) ? b.at : 0 });
  }
  const folders = [...new Set(items.map(i => i.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const nodes = new Map();
  const add = (n) => nodes.set(n.id, n);
  add({ id: '0', title: '', dateAdded: 0, children: [] });
  add({ id: '1', parentId: '0', index: 0, title: 'Bookmarks bar', dateAdded: 0, children: [] });
  add({ id: '2', parentId: '0', index: 1, title: 'Other bookmarks', dateAdded: 0, children: [] });
  nodes.get('0').children.push('1', '2');
  let index = 0;
  for (const f of folders) {
    const id = 'f:' + f;
    add({ id, parentId: '2', index: index++, title: f, dateAdded: 0, children: [] });
    nodes.get('2').children.push(id);
  }
  const place = {};
  for (const i of items) {
    const parent = i.folder ? 'f:' + i.folder : '2';
    place[parent] = (place[parent] || (parent === '2' ? index : 0));
    add({ id: i.id, parentId: parent, index: place[parent]++, title: i.title, url: i.url, dateAdded: i.at });
    nodes.get(parent).children.push(i.id);
  }
  return nodes;
}

// A node as Chrome describes it; `deep` adds its children.
function bookmarkTreeNode(nodes, id, deep) {
  const n = nodes.get(id);
  if (!n) return null;
  const out = { id: n.id, title: n.title, dateAdded: n.dateAdded, syncing: false };
  if (n.parentId !== undefined) { out.parentId = n.parentId; out.index = n.index; }
  if (n.url !== undefined) out.url = n.url;
  else if (deep) out.children = n.children.map(c => bookmarkTreeNode(nodes, c, true));
  return out;
}
function bookmarksGet(nodes, ids) {
  const list = Array.isArray(ids) ? ids : [ids];
  return list.map(id => {
    const n = bookmarkTreeNode(nodes, String(id), false);
    if (!n) throw new Error("Can't find bookmark for id.");
    return n;
  });
}
function bookmarksChildren(nodes, id) {
  const n = nodes.get(String(id));
  if (!n) throw new Error("Can't find parent bookmark for id.");
  return n.url !== undefined ? [] : n.children.map(c => bookmarkTreeNode(nodes, c, false));
}
function bookmarksSubTree(nodes, id) {
  const n = bookmarkTreeNode(nodes, String(id), true);
  if (!n) throw new Error("Can't find bookmark for id.");
  return [n];
}
function bookmarksRecent(nodes, count) {
  if (!Number.isInteger(count) || count < 1) throw new Error('bookmarks.getRecent needs a count of 1 or more');
  return [...nodes.values()].filter(n => n.url !== undefined).sort((a, b) => b.dateAdded - a.dateAdded).slice(0, count).map(n => bookmarkTreeNode(nodes, n.id, false));
}
// query: a string (all words in the title or address) or { query, url, title }.
function bookmarksSearch(nodes, query) {
  const q = typeof query === 'string' ? { query } : (query && typeof query === 'object' ? query : null);
  if (!q) throw new Error('bookmarks.search needs a query');
  const words = String(q.query || '').toLowerCase().split(/\s+/).filter(Boolean);
  return [...nodes.values()].filter(n => {
    if (n.url === undefined) return false;
    if (q.url !== undefined && n.url !== q.url) return false;
    if (q.title !== undefined && n.title !== q.title) return false;
    const hay = (n.title + ' ' + n.url).toLowerCase();
    return words.every(w => hay.includes(w));
  }).map(n => bookmarkTreeNode(nodes, n.id, false));
}

module.exports = { historyEntries, historySearch, historyVisits, topSites, bookmarkNodes, bookmarkTreeNode, bookmarksGet, bookmarksChildren,
  bookmarksSubTree, bookmarksRecent, bookmarksSearch };
