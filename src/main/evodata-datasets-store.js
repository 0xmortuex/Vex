'use strict';
// === Datasets kept from page tables: what is written to disk (see evodata-entity-store.js) ===
const fs = require('fs');
const core = require('../renderer/js/evodata-core');
const { createEntityStore, refuseSensitive, randomId } = require('./evodata-entity-store');

// ---- datasets -------------------------------------------------------------------------------------
const datasetMeta = (d) => ({
  id: d.id, name: d.name, columns: d.columns.map(c => c.name), rowCount: d.rows.length, bytes: core.datasetBytes(d),
  keyColumn: d.keyColumn, watchId: d.watchId || null, source: d.source || null, createdAt: d.createdAt, updatedAt: d.updatedAt,
});

function createDatasetStore({ dir, fsImpl = fs, now = Date.now, log = console } = {}) {
  const store = createEntityStore({ dir, metaOf: datasetMeta, fsImpl, log });
  const newId = () => 'd' + now().toString(36) + randomId();
  return {
    LIMITS: core.LIMITS,
    list: () => store.list(),
    totalBytes: () => store.totalBytes(),
    get(id) {
      const d = store.read(id);
      if (!d) throw new Error('That dataset is gone');
      return d;
    },
    // { name, rows, header?, keyColumn?, source?, watchId?, allowEmpty? } -> { dataset, duplicates, capped }
    create(args) {
      if (store.count() >= core.LIMITS.datasets) throw new Error('You already keep ' + core.LIMITS.datasets + ' datasets (the limit). Delete one first.');
      const a = args && typeof args === 'object' ? args : {};
      if (a.source && a.source.url) refuseSensitive(a.source.url);
      // Only the fields named here are taken: the id and the time are never the window's to choose.
      const r = core.createDataset({
        name: a.name, rows: a.rows, header: a.header == null ? 'auto' : a.header, keyColumn: a.keyColumn || null, source: a.source || null,
        watchId: a.watchId || null, allowEmpty: a.allowEmpty === true, id: newId(), now: now(),
      });
      store.write(r.dataset.id, r.dataset);
      return r;
    },
    // -> { dataset, added, skipped, capped }. Nothing is written when nothing was added and the key did not change.
    append(id, rows, opts = {}) {
      const d = this.get(id);
      const r = core.appendRows(d, rows, { keyColumn: opts.keyColumn, now: now() });
      if (r.added > 0 || r.dataset.keyColumn !== d.keyColumn) store.write(id, r.dataset);
      return r;
    },
    // A page watch saw a change: one row for every dataset linked to that watch. -> number of datasets written.
    appendForWatch(watchId, row) {
      let n = 0;
      for (const m of store.list()) {
        if (m.watchId !== watchId) continue;
        const r = this.append(m.id, [row]);
        if (r.added) n++;
      }
      return n;
    },
    setWatch(id, watchId) {
      const d = this.get(id);
      d.watchId = watchId ? String(watchId).slice(0, 80) : null;
      d.updatedAt = now();
      store.write(id, d);
      return datasetMeta(d);
    },
    remove: (id) => store.remove(id),
    clearAll: () => store.clearAll(),
    // The text of a file to save: { name, ext, text }. CSV has a byte-order mark and neutralised formulas; JSON is plain.
    exportAs(id, format) {
      const d = this.get(id);
      const base = d.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').slice(0, 80) || 'dataset';
      if (format === 'csv') return { name: base + '.csv', ext: 'csv', text: core.toCsvFile(d.columns, d.rows, { delimiter: ',' }) };
      if (format === 'csv-semicolon') return { name: base + '.csv', ext: 'csv', text: core.toCsvFile(d.columns, d.rows, { delimiter: ';' }) };
      if (format === 'json') return { name: base + '.json', ext: 'json', text: core.toJson(d, now()) };
      throw new Error('Unknown format ' + format);
    },
  };
}


module.exports = { createDatasetStore };
