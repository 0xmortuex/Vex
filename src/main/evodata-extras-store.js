'use strict';
// === Extra things remembered in Recall: what is written to disk (see evodata-entity-store.js) ===
const fs = require('fs');
const core = require('../renderer/js/evodata-extras-core');
const { refuseSensitive, randomId } = require('./evodata-entity-store');
const { atomicWriteSync, readJsonRecoverSync } = require('./file-store');

function createExtrasStore({ file, fsImpl = fs, now = Date.now } = {}) {
  if (!file) throw new Error('createExtrasStore: no file');
  let items = null;
  function load() {
    if (items) return items;
    const r = readJsonRecoverSync(file, { fsImpl });
    if (r.source === 'lost') throw new Error('The remembered items could not be read; a copy of the file was kept aside (' + r.corruptCopy + ')');
    items = r.data && Array.isArray(r.data.items) ? r.data.items.filter(i => i && typeof i.id === 'string' && core.KINDS.includes(i.kind) && typeof i.text === 'string').map(i => ({ ...i, title: String(i.title || ''), url: String(i.url || '') })) : [];
    return items;
  }
  function save(next) {
    atomicWriteSync(file, JSON.stringify({ v: 1, items: next }), { backup: false, fsImpl });
    items = next;
  }
  return {
    LIMITS: core.LIMITS,
    list: () => load().slice(),
    bytes: () => load().reduce((s, i) => s + i.text.length + i.title.length, 0),
    add(input) {
      if (input && input.url) refuseSensitive(input.url);
      const item = core.cleanExtra(input, { id: 'x' + now().toString(36) + randomId(), now: now() });
      const r = core.addExtra(load(), item);
      save(r.items);
      return { item: r.items[0], evicted: r.evicted };
    },
    remove(id) {
      const cur = load();
      if (!cur.some(i => i.id === id)) return false;
      save(cur.filter(i => i.id !== id));
      return true;
    },
    clearAll() {
      const n = load().length;
      fsImpl.rmSync(file, { force: true });
      fsImpl.rmSync(file + '.bak', { force: true });
      items = [];
      return n;
    },
  };
}


module.exports = { createExtrasStore };
