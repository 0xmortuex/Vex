// @ts-check
/** @typedef {{partition?: string, url: string, id?: string, title?: string, pinned?: boolean}} TabRecord */
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
module.exports = { assertPartition, assertTabs };
