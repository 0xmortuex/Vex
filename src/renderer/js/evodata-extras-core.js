// === Extra things remembered in Recall: the pure part ===========================
//
// Recall (js/recall.js, src/main/recall-index.js) indexes the pages that were read, in recall.json: one bare array of
// about 4 MB that is rewritten whole. What the person ADDS by hand (a selected text, a downloaded file's name, a
// reminder, a note) goes in a separate small file and is merged into the results when Recall is searched, so
// recall.json is not touched and does not get bigger. Nothing is added automatically.
//
//   500 things at most, 2,000 characters each, 400 KB in all. Over a cap, the OLDEST goes first.
(function (root) {
  'use strict';

  const LIMITS = { extras: 500, extraChars: 2000, extrasChars: 400 * 1024 };
  const KINDS = ['clip', 'file', 'reminder', 'note'];
  const KIND_LABEL = { clip: 'Clip', file: 'Downloaded file', reminder: 'Reminder', note: 'Note' };

  const str = (v) => String(v == null ? '' : v);
  const clipTo = (v, n) => str(v).slice(0, n);
  const MARKS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
  const DOTLESS = new RegExp(String.fromCharCode(0x131), 'g');
  // For search when VexTr is not around (tests, main): the folding VexTr.fold does, in short.
  function fold(v) {
    return str(v).normalize('NFD').replace(MARKS, '').toLocaleLowerCase('tr-TR').replace(DOTLESS, 'i');
  }

  // One thing to remember, made safe. id and now are given by the caller. A page address is optional and must be a
  // web address (no sign-in part, no #fragment).
  function cleanExtra(item, { id, now = Date.now() } = {}) {
    if (!item || typeof item !== 'object') throw new Error('There is nothing to remember');
    if (!KINDS.includes(item.kind)) throw new Error('Recall remembers a clip, a downloaded file name, a reminder or a note');
    const text = clipTo(str(item.text).replace(/\r\n?/g, '\n').trim(), LIMITS.extraChars);
    if (!text) throw new Error('There is nothing to remember');
    let url = '';
    if (item.url) {
      let u;
      try { u = new URL(str(item.url)); } catch { throw new Error('The page address is not valid'); }
      if (u.protocol === 'https:' || u.protocol === 'http:') { u.username = ''; u.password = ''; u.hash = ''; url = u.href.slice(0, 500); }
    }
    return { id: str(id), kind: item.kind, text, title: clipTo(str(item.title).replace(/\s+/g, ' ').trim(), 200), url, at: now };
  }

  // Newest first; the same kind and text again only refreshes the time. Over 500 items or 400 KB: the oldest go.
  // -> { items, evicted }
  function addExtra(items, item) {
    const same = items.findIndex(x => x.kind === item.kind && x.text === item.text);
    const rest = same >= 0 ? items.filter((_, i) => i !== same) : items.slice();
    const head = same >= 0 ? { ...items[same], at: item.at, title: item.title || items[same].title, url: item.url || items[same].url } : item;
    const next = [head].concat(rest);
    let evicted = 0, chars = next.reduce((s, x) => s + x.text.length + x.title.length, 0);
    while (next.length > LIMITS.extras || (chars > LIMITS.extrasChars && next.length > 1)) {
      const gone = next.pop(); chars -= gone.text.length + gone.title.length; evicted++;
    }
    return { items: next, evicted };
  }

  // The words of a query against the remembered things, as Recall hits (the shape the Recall panel draws: snippet is
  // a list of [text, isMatch] pairs). Every word must be found, in any order. foldFn is VexTr.fold in the window.
  // -> hits, newest first.
  function searchExtras(items, query, { foldFn = fold, since = 0, limit = 50 } = {}) {
    const terms = foldFn(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const out = [];
    for (const it of items) {
      if (since && it.at < since) continue;
      const hay = foldFn(it.text + ' ' + it.title);
      if (!terms.every(t => hay.includes(t))) continue;
      const flat = it.text.replace(/\s+/g, ' ');
      const first = foldFn(flat).indexOf(terms[0]);
      const from = Math.max(0, first - 40);
      out.push({
        extraId: it.id, kind: it.kind, label: KIND_LABEL[it.kind], url: it.url || '', title: it.title || flat.slice(0, 80),
        at: it.at, host: '', visits: 0,
        snippet: [[(from ? '…' : '') + flat.slice(from, from + 160), false]],
        text: it.text,
      });
      if (out.length >= limit) break;
    }
    return out.sort((a, b) => b.at - a.at);
  }

  const api = { LIMITS, KINDS, KIND_LABEL, fold, cleanExtra, addExtra, searchExtras };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.VexExtrasCore = api;
})(typeof window !== 'undefined' ? window : null);
