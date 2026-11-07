'use strict';
// === Text versions of kept pages: what is written to disk (see evodata-entity-store.js) ===
const fs = require('fs');
const core = require('../renderer/js/evodata-versions-core');
const { createEntityStore, refuseSensitive, VexPageSensitivity } = require('./evodata-entity-store');

const pageMeta = (p) => {
  const last = p.versions[p.versions.length - 1];
  return {
    id: p.id, url: p.url, title: p.title, keptAt: p.keptAt, count: p.versions.length,
    bytes: p.versions.reduce((s, v) => s + v.text.length, 0), updatedAt: last ? last.at : p.keptAt, lastAt: last ? last.at : 0,
    lastChange: last && last.change ? { added: last.change.added, removed: last.change.removed } : null,
  };
};

function createVersionStore({ dir, fsImpl = fs, now = Date.now, log = console } = {}) {
  const store = createEntityStore({ dir, metaOf: pageMeta, fsImpl, log });
  const page = (id) => { const p = store.read(id); if (!p) throw new Error('That page is not being kept'); return p; };
  return {
    LIMITS: core.LIMITS,
    list: () => store.list(),
    totalBytes: () => store.totalBytes(),
    isKept(url) { return store.has(core.pageId(url)); },
    // Mark a page: from now on its text is kept when asked (or when a page watch sees it change). The 101st page is
    // refused, never swapped for an older one: the person chose these pages.
    keep(url, title) {
      refuseSensitive(url);
      const id = core.pageId(url);
      if (store.has(id)) return store.meta(id);
      if (store.count() >= core.LIMITS.pages) throw new Error('You already keep versions of ' + core.LIMITS.pages + ' pages (the limit). Stop keeping one first.');
      const p = core.newPage(url, title, now());
      store.write(p.id, p);
      return store.meta(p.id);
    },
    // -> { saved, change, truncated, count, id }. A page that was not marked is refused.
    save(url, title, text, via = 'page') {
      refuseSensitive(url);
      const id = core.pageId(url);
      if (!store.has(id)) throw new Error('Keep versions of this page first');
      const p = page(id);
      if (p.url !== core.pageKey(url)) throw new Error('Two addresses share a file name; that page was not saved');
      const r = core.addVersion(p, text, { now: now(), via });
      if (r.saved) store.write(id, { ...r.page, title: String(title || r.page.title).slice(0, 200) });
      return { id, saved: r.saved, change: r.change, truncated: r.truncated, count: r.page.versions.length };
    },
    // For a page watch: the same, but a page that was not marked is simply not kept (null), and so is a sensitive one.
    saveIfKept(url, title, text) {
      let id;
      try { id = core.pageId(url); } catch { return null; /* vex-allow-empty-catch: a watch on something that is not a web address keeps nothing */ }
      if (!store.has(id) || VexPageSensitivity.reason(url)) return null;
      return this.save(url, title, text, 'watch');
    },
    versions(id) { return page(id).versions.map(v => ({ at: v.at, chars: v.text.length, truncated: !!v.truncated, change: v.change || null, via: v.via || 'page' })); },
    text(id, at) {
      const v = page(id).versions.find(x => x.at === at);
      if (!v) throw new Error('That version is gone');
      return v.text;
    },
    diff(id, atA, atB) {
      const p = page(id);
      const a = p.versions.find(x => x.at === atA), b = p.versions.find(x => x.at === atB);
      if (!a || !b) throw new Error('One of those versions is gone');
      return core.wordDiff(a.text, b.text);
    },
    forget: (id) => store.remove(id),
    clearAll: () => store.clearAll(),
  };
}


module.exports = { createVersionStore };
