// Shared contracts at disk, sync and import boundaries. No DOM dependency.
(function () {
  const unsafe = new Set(['__proto__', 'constructor', 'prototype']);
  const text = (value, max = 4096) => typeof value === 'string' && value.length <= max;
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const id = value => text(value, 160) && /^[\w.:-]+$/.test(value) && !unsafe.has(value);
  const color = value => text(value, 80) && /^(?:#[a-f0-9]{3,8}|[a-z]{1,24}|var\(--[\w-]+\))$/i.test(value);
  function url(value, webOnly = false) {
    if (!text(value, 8192) || /[\x00-\x1f]/.test(value)) return false;
    try { return (webOnly ? ['https:', 'http:'] : ['https:', 'http:', 'about:', 'file:', 'vex:']).includes(new URL(value).protocol); } catch { return false; }
  }
  function json(value, depth = 0) {
    if (depth > 40) throw new Error('Data nesting limit exceeded');
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Invalid number');
    if (typeof value === 'string' && value.length > 12 * 1024 * 1024) throw new Error('Text limit exceeded');
    if (!value || typeof value !== 'object') return;
    if (Object.keys(value).length > 30000) throw new Error('Collection limit exceeded');
    for (const [key, child] of Object.entries(value)) {
      if (unsafe.has(key)) throw new Error('Unsafe data property');
      json(child, depth + 1);
    }
  }
  function array(value, maximum = 10000) { if (!Array.isArray(value) || value.length > maximum) throw new Error('Invalid collection'); }
  function record(value) {
    if (!object(value)) throw new Error('Invalid record');
    for (const field of ['id', 'groupId', 'stackId']) if (value[field] != null && !id(value[field])) throw new Error('Invalid identifier');
    for (const field of ['title', 'name', 'label']) if (value[field] != null && !text(value[field])) throw new Error('Invalid record text');
    if (value.color != null && !color(value.color)) throw new Error('Invalid color');
  }
  function tabs(value) {
    array(value);
    for (const tab of value) {
      record(tab); if (!url(tab.url)) throw new Error('Invalid tab URL');
      if (tab.partition != null && (!text(tab.partition, 160) || /[\x00-\x1f]/.test(tab.partition))) throw new Error('Invalid partition');
      if (tab.pinned != null && typeof tab.pinned !== 'boolean') throw new Error('Invalid pinned flag');
      if (tab.favicon != null && (!text(tab.favicon, 1048576) || !/^(https?:|data:image\/|file:|vex:)/i.test(tab.favicon))) throw new Error('Invalid favicon');
    }
  }
  function groups(value) { array(value, 1000); value.forEach(record); }
  function sessions(value) { array(value, 1000); for (const item of value) { record(item); tabs(item.tabs); if (item.groups != null) groups(item.groups); } }
  function storage(key, value) {
    json(value); if (value == null) return value;
    if (key === 'tabs') tabs(value);
    if (['groups', 'stacks'].includes(key)) groups(value);
    if (['history', 'bookmarks', 'shortcuts'].includes(key)) {
      array(value); for (const item of value) { record(item); if (!url(item.url, key !== 'shortcuts')) throw new Error('Invalid saved URL'); }
    }
    if (key === 'sessions') sessions(value);
    if (key === 'workspaces') {
      if (!object(value)) throw new Error('Invalid workspace collection');
      array(value.workspaces, 1000);
      for (const item of value.workspaces) { record(item); if (item.tabs != null) tabs(item.tabs); if (item.groups != null) groups(item.groups); }
    }
    if (key === 'theme' && typeof value === 'string' && !/^[\w-]{1,80}$/.test(value)) throw new Error('Invalid theme');
    return value;
  }
  function sources(values) {
    for (const [source, value] of Object.entries(values)) {
      if (source.startsWith('storage:')) storage(source.slice(8), value);
      else if (source.startsWith('preference:vex.')) {
        const key = source.slice(15);
        if (['bookmarks','sessions','history','workspaces','shortcuts','groups','stacks'].includes(key)) storage(key, typeof value === 'string' ? JSON.parse(value) : value);
      }
    }
  }
  const api = { json, url, id, color, tabs, sessions, storage, sources };
  if (typeof window !== 'undefined') window.VexDataContracts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
