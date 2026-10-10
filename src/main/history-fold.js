// @ts-check
// === One copy of browsing history ===========================================
//
// History was kept twice. The History panel's list (vex.history in
// vex-persist.json, up to 5000 entries) is the one every surface reads; a
// second list of the last 500 visits (vex-storage/history.json, written by
// storage:history-add) was rewritten on every page visit, 166 KB and its .bak
// each time on the owner's profile (found 2026-10-10). Nothing read it but a
// fallback in the command bar, the delete paths that kept it in step, and sync,
// which sent it as storage:history (a desktop-only source, SYNC_PROTOCOL.md
// §8.3). It is no longer written. Once, at start, any visit it holds that the
// History panel's list lacks is added to that list, and the file goes.
const fs = require('fs');
const contracts = require('../renderer/js/data-contracts');

const DAY_MS = 86400000;

/** @param {any} e */
function timeOf(e) {
  const parsed = Date.parse(e && e.visitedAt);
  if (Number.isFinite(parsed)) return parsed;
  const t = Number(e && e.time);
  return Number.isFinite(t) ? t : 0;
}

// The History panel's list with the file's visits it does not have. A visit
// to an address the list already has within a day of it is the same row there
// (HistoryPanel.addEntry moves a repeat visit up instead of adding one), so it
// is not added again. Returns the list newest first, and how many were added.
/** @param {unknown} panelRaw @param {unknown} fileList */
function mergeHistory(panelRaw, fileList) {
  let list = [];
  if (panelRaw != null) {
    const parsed = typeof panelRaw === 'string' ? JSON.parse(panelRaw) : panelRaw;
    if (!Array.isArray(parsed)) throw new Error('The saved history list is not a list');
    list = parsed;
  }
  if (!Array.isArray(fileList)) return { list, added: 0 };
  /** @type {Map<string, number[]>} */
  const seen = new Map();
  for (const e of list) {
    if (!e || typeof e.url !== 'string') continue;
    if (!seen.has(e.url)) seen.set(e.url, []);
    /** @type {number[]} */ (seen.get(e.url)).push(timeOf(e));
  }
  const extra = [];
  for (const f of fileList) {
    // Only what the list may hold (an http(s) address, as the list's contract
    // takes it); history.json only ever took those (storage:history-add).
    if (!f || !contracts.url(f.url, true)) continue;
    const at = timeOf(f);
    const times = seen.get(f.url) || [];
    if (times.some(t => Math.abs(t - at) < DAY_MS)) continue;
    times.push(at);
    seen.set(f.url, times);
    extra.push({
      id: 'h_' + at + '_' + Math.random().toString(36).slice(2, 7),
      url: f.url,
      title: String(typeof f.title === 'string' && f.title ? f.title : f.url).slice(0, 4096),
      favicon: '',
      visitedAt: new Date(at).toISOString(),
      indexed: false,
    });
  }
  if (!extra.length) return { list, added: 0 };
  const merged = list.concat(extra).sort((a, b) => timeOf(b) - timeOf(a));
  return { list: merged, added: extra.length };
}

// Run once at start, before the interface reads vex-persist.json. The file is
// removed only after the list holding its visits has been written.
/**
 * @param {{ dataStore: { read(key: string): Promise<any>, remove(key: string): Promise<any>, file(key: string): string }, preferences: { load(): Record<string, any>, set(key: string, value: string): Promise<any> } }} stores
 */
async function foldHistoryFile({ dataStore, preferences }) {
  const file = dataStore.file('history');
  if (!fs.existsSync(file) && !fs.existsSync(file + '.bak')) return { added: 0, removed: false };
  const fileList = await dataStore.read('history');
  const { list, added } = mergeHistory(preferences.load()['vex.history'], fileList);
  if (added) {
    contracts.storage('history', list);
    await preferences.set('vex.history', JSON.stringify(list));
  }
  await dataStore.remove('history');
  return { added, removed: true };
}

module.exports = { foldHistoryFile, mergeHistory };
