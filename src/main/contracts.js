// @ts-check
/** @typedef {{url: string, title?: string, time?: number}} HistoryEntry */
/** @typedef {{partition?: string, url: string, id?: string, title?: string, pinned?: boolean}} TabRecord */
/** @param {unknown} value @returns {asserts value is HistoryEntry} */
function assertHistoryEntry(value) {
  if (!value || typeof value !== 'object' || !('url' in value) || typeof value.url !== 'string' || value.url.length > 8192) throw new Error('Invalid history record');
  if (!['https:','http:'].includes(new URL(value.url).protocol)) throw new Error('Invalid history URL');
  if ('title' in value && (typeof value.title !== 'string' || value.title.length > 4096)) throw new Error('Invalid history title');
}
/** @param {unknown} value @returns {asserts value is string} */
function assertPartition(value) {
  if (typeof value !== 'string' || value.length > 160 || /[\x00-\x1f]/.test(value)) throw new Error('Invalid partition');
}
/** @param {unknown} value @returns {asserts value is TabRecord[]} */
function assertTabs(value) {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('Invalid tabs collection');
  for (const tab of value) {
    if (!tab || typeof tab !== 'object' || typeof tab.url !== 'string' || tab.url.length > 8192) throw new Error('Invalid tab');
    const protocol = new URL(tab.url).protocol;
    if (!['http:','https:','about:','file:','vex:'].includes(protocol)) throw new Error('Invalid tab URL');
    if (tab.partition != null) assertPartition(tab.partition);
    if (tab.id != null && (typeof tab.id !== 'string' || !/^[\w-]{1,128}$/.test(tab.id))) throw new Error('Invalid tab identifier');
  }
}
module.exports = { assertHistoryEntry, assertPartition, assertTabs };
