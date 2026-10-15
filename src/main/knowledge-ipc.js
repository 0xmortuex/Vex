'use strict';
// === Knowledge base: files and IPC =========================================
//
// The rules and the index are in knowledge-base.js. This file only owns:
//   knowledge.json          the kept items' text (capped, see LIMITS there)
//   knowledge-vectors.json  their embeddings (VectorStore, one model)
// and the kb:* channels. Every channel is UI-only and unavailable in a private
// window (ipc-policy.js). Nothing here makes a network request of its own: the
// only outbound call is the embedder, which refuses any address but this PC.
//
// Handlers never throw to the panel for a runtime failure: they return
// { ok: false, message } so the panel can say it.

const nodePath = require('path');
const { KnowledgeBase, createKnowledgeService, KINDS } = require('./knowledge-base');
const { VectorStore, createOllamaEmbedder, fnv, VERSION: VECTORS_VERSION } = require('./recall-vectors');
const { createRecallWriter } = require('./recall-writer');

const ITEM_FILE = 'knowledge.json';
const VECTOR_FILE = 'knowledge-vectors.json';
const ARCHIVE_STEP = 40;
const ENRICH_CHARS = 4000;

function register({ ipcMain, userData, atomicWrite, fs, recallGet = () => null, archive = null, archiveDir = '', isHeld = () => '', embedder = null, log = console }) {
  if (!ipcMain || !userData || typeof atomicWrite !== 'function' || !fs) throw new Error('knowledge-ipc.register needs ipcMain, userData, atomicWrite and fs');
  const itemFile = nodePath.join(userData, ITEM_FILE);
  const vectorFile = nodePath.join(userData, VECTOR_FILE);

  let kb = null;
  let store = null;
  let service = null;

  function load() {
    if (kb) return;
    kb = new KnowledgeBase();
    store = new VectorStore({ maxVectors: 8000, maxBytes: 16 * 1024 * 1024 });
    try {
      if (fs.existsSync(itemFile)) kb = KnowledgeBase.fromJSON(JSON.parse(fs.readFileSync(itemFile, 'utf8')));
    } catch (err) {
      // Everything in it is rebuilt from what the person keeps: only the time is lost.
      log.error('[Knowledge] the index file could not be read and will be rebuilt:', err && err.message);
      kb = new KnowledgeBase();
    }
    try {
      if (fs.existsSync(vectorFile)) store = VectorStore.fromJSON(JSON.parse(fs.readFileSync(vectorFile, 'utf8')), { maxVectors: 8000, maxBytes: 16 * 1024 * 1024 });
    } catch (err) {
      log.error('[Knowledge] the meaning file could not be read and will be rebuilt:', err && err.message);
    }
    service = createKnowledgeService({
      kb, store, embedder: embedder || createOllamaEmbedder(),
      onChange: () => vectorWriter.touch(), isHeld,
    });
  }

  const itemWriter = createRecallWriter({
    serialize: () => JSON.stringify(kb ? kb.toJSON() : { version: 1, privateIds: [], items: [] }),
    write: async (bytes, { erase }) => { await atomicWrite(itemFile, bytes, { backup: false }); if (erase) await fs.promises.rm(itemFile + '.bak', { force: true }); },
    onError: (err) => log.error('[Knowledge] could not save the index (tried again on the next save):', err && err.message),
  });
  const vectorWriter = createRecallWriter({
    serialize: () => JSON.stringify(store ? store.toJSON() : { version: VECTORS_VERSION, model: '', dim: 0, entries: [] }),
    write: async (bytes) => { await atomicWrite(vectorFile, bytes, { backup: false }); },
    onError: (err) => log.error('[Knowledge] could not save the meaning index (tried again on the next save):', err && err.message),
  });

  const flush = (erase = false) => Promise.all([itemWriter.flush(erase), vectorWriter.flush(erase)]).then(() => undefined);
  const fail = (err) => ({ ok: false, message: err && err.message ? err.message : String(err) });
  const guard = (fn) => async (_e, ...args) => { try { load(); return await fn(...args); } catch (err) { return fail(err); } };
  const opts = (a) => (a && typeof a === 'object' ? a : {});

  // The renderer's list of kept things, as {id, kind, h}, and what main needs of it.
  ipcMain.handle('kb:plan', guard((entries, covers) => {
    const plan = kb.plan(entries, covers);
    // What no longer exists in its source goes now, so a deleted note is not an answer.
    let removed = 0;
    for (const id of plan.gone) if (kb.remove(id)) { removed++; if (store.remove(id)) vectorWriter.touch(); }
    if (removed) itemWriter.touch();
    return { ok: true, need: plan.need, removed };
  }));

  ipcMain.handle('kb:put', guard((items, args) => {
    const o = opts(args);
    const refused = [];
    let accepted = 0;
    for (const raw of Array.isArray(items) ? items : []) {
      let text = raw.text;
      // A bookmark or a read-later link has no text of its own: what Recall
      // already read of that page stands in for it, so it is findable by what
      // it says. Nothing is fetched.
      if ((!text || String(text).length < 80) && raw.url && (raw.kind === 'bookmark' || raw.kind === 'readlater')) {
        const rec = recallGet(raw.url);
        if (rec && rec.text) text = String(rec.text).slice(0, ENRICH_CHARS);
      }
      const r = kb.put({ ...raw, text }, { excludedHosts: o.excluded });
      if (r.ok) accepted++; else { refused.push({ id: raw.id, reason: r.reason }); if (store.remove(raw.id)) vectorWriter.touch(); }
    }
    if (accepted) itemWriter.touch();
    return { ok: true, accepted, refused };
  }));

  // Archived pages live in main, so main reads their text itself, a few per call.
  ipcMain.handle('kb:sync-archive', guard(async (args) => {
    if (!archive || !archiveDir) return { ok: true, accepted: 0, pending: 0 };
    const o = opts(args);
    const entries = await archive.list();
    const ids = new Set(entries.map(e => 'archive:' + e.id));
    let removed = 0;
    for (const it of kb.items()) if (it.kind === 'archive' && !ids.has(it.id)) { kb.remove(it.id); store.remove(it.id); removed++; }
    let accepted = 0, pending = 0;
    for (const e of entries) {
      const id = 'archive:' + e.id;
      const h = fnv(e.url + '|' + e.at + '|' + e.title);
      if (kb.has(id, h) || kb.isPrivate(id)) continue;
      if (accepted >= ARCHIVE_STEP) { pending++; continue; }
      let text = '';
      try { text = await fs.promises.readFile(nodePath.join(archiveDir, e.id + '.txt'), 'utf8'); }
      catch (err) { if (err.code !== 'ENOENT') throw err; }
      const r = kb.put({ id, kind: 'archive', title: e.title, url: e.url, text, at: e.at, h }, { excludedHosts: o.excluded });
      if (r.ok) accepted++;
    }
    if (accepted || removed) itemWriter.touch();
    return { ok: true, accepted, removed, pending };
  }));

  ipcMain.handle('kb:status', guard(async (args) => ({ ok: true, ...(await service.status(opts(args))) })));
  ipcMain.handle('kb:step', guard(async (args) => {
    const o = opts(args);
    // Dropped hosts go from the index too: the exclusion list can grow after an item went in.
    if (Array.isArray(o.excluded) && kb.dropHosts(o.excluded)) { itemWriter.touch(); service.dropStaleVectors(); }
    return service.step(o);
  }));
  ipcMain.handle('kb:search', guard(async (question, args) => ({ ok: true, ...(await service.search(String(question || ''), opts(args))) })));
  ipcMain.handle('kb:context', guard(async (question, args) => ({ ok: true, ...(await service.context(String(question || ''), opts(args))) })));
  ipcMain.handle('kb:related', guard((id, args) => ({ ok: true, ...service.related(String(id || ''), opts(args)) })));
  ipcMain.handle('kb:related-page', guard((page, args) => ({ ok: true, ...service.relatedToPage(page || {}, opts(args)) })));

  ipcMain.handle('kb:keep-out', guard((id, on) => {
    const had = kb.markPrivate(String(id || ''), on !== false);
    if (store.remove(id)) vectorWriter.touch();
    itemWriter.touch();
    return { ok: true, changed: !!had };
  }));
  ipcMain.handle('kb:keep-out-clear', guard(() => {
    const ids = [...kb._private];
    for (const id of ids) kb.markPrivate(id, false);
    itemWriter.touch();
    return { ok: true, released: ids.length };
  }));

  // Forget and Rebuild both empty the index and the numbers made from it; the
  // panel then either stays off (Forget) or fills it again (Rebuild). What is
  // kept out stays kept out.
  ipcMain.handle('kb:forget', guard(async () => {
    const n = kb.size;
    kb.clear();
    service.forgetVectors();
    itemWriter.touch();
    await flush(true);
    return { ok: true, removed: n };
  }));

  return { flush, get dirty() { return itemWriter.dirty || vectorWriter.dirty; }, _load: load, _kinds: KINDS };
}

module.exports = { register, ITEM_FILE, VECTOR_FILE };
