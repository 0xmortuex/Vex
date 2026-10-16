// === Vex Packs: what is installed, who is trusted, and the install log ========
//
// Disk side of src/main/packs.js. Everything lives under <userData>/packs:
//
//   installed/<pack id>.json   { v, pack, meta: { installedAt, enabled, source } }
//   trusted-keys.json          [{ fingerprint, key, label, addedAt }]
//   author.json                the person's own signing key, the private half
//                              sealed with the OS (safeStorage). If sealing is
//                              unavailable the key is refused, never stored bare.
//   state.json                 { globalEnabled }  (the master kill switch)
//   log.json                   the install log, newest last, capped
//
// What makes it safe:
//   - A pack is judged by packs.parsePack in this process. The window can only
//     install a pack main itself previewed (a one-use token), never hand over
//     content to install.
//   - Pack items are an overlay. Nothing is ever merged into the person's own
//     themes, chains or aliases, so disabling or uninstalling a pack removes
//     exactly what it added and nothing else.
//   - Every write is atomic (temp file, then rename). An install or an
//     uninstall whose log entry cannot be written is rolled back to the exact
//     previous bytes and the error is thrown.
//   - A pack signed by one key can only be replaced by a pack signed by the same
//     key; a signed pack is never replaced by an unsigned one.
//   - On load every file is validated again. A damaged or tampered file is
//     listed as damaged and applies nothing; it is not deleted or ignored.
'use strict';

const nodePath = require('node:path');
const crypto = require('node:crypto');
const packs = require('./packs');

const MAX_PACKS = 50;
const MAX_LOG = 300;
const STAGE_TTL_MS = 10 * 60 * 1000;
const MAX_STAGED = 8;

// builtins: the packs that ship inside Vex, already judged by main/packs-builtin.js
// (parsePack with builtin: true and a hash that matches the pinned one). They are never
// written to the installed folder, cannot be removed or replaced, and start switched OFF.
function createPackStore({ dir, fs, now = () => Date.now(), log = console, seal = null, unseal = null, builtins = [] }) {
  if (!dir) throw new Error('A pack store needs a folder');
  if (!fs || !fs.promises) throw new Error('A pack store needs the fs module');
  const fsp = fs.promises;
  const installedDir = nodePath.join(dir, 'installed');
  const files = {
    trusted: nodePath.join(dir, 'trusted-keys.json'),
    author: nodePath.join(dir, 'author.json'),
    state: nodePath.join(dir, 'state.json'),
    log: nodePath.join(dir, 'log.json'),
  };

  const installed = new Map();        // id -> { pack, meta, trust, fingerprint }
  const damaged = [];                 // { file, error }
  const trusted = new Map();          // fingerprint -> { fingerprint, key, label, addedAt }
  const staged = new Map();           // token -> { parsed, source, expires }
  let author = null;                  // { publicKey, fingerprint, sealed }
  let globalEnabled = true;
  const builtinById = new Map();      // id -> { pack, trust: 'builtin' }
  for (const b of builtins) {
    if (!b || !b.pack || typeof b.pack.id !== 'string' || !b.pack.id.startsWith(packs.BUILTIN_PREFIX)) throw new Error('A built-in pack must come from the built-in loader');
    if (builtinById.has(b.pack.id)) throw new Error('Two built-in packs share the id ' + b.pack.id);
    builtinById.set(b.pack.id, { pack: b.pack, trust: 'builtin' });
  }
  let builtinOn = new Set();           // ids of the built-in packs the person switched on
  let entries = [];
  let loaded = false;
  let chain = Promise.resolve();
  const locked = (fn) => { const run = chain.then(fn); chain = run.catch(() => {}); return run; };

  const fileFor = (id) => {
    packs.packId(id, 'The pack id');
    const file = nodePath.join(installedDir, id + '.json');
    if (!file.startsWith(installedDir + nodePath.sep)) throw new packs.PackError('bad-id', 'The pack id points outside the pack folder');
    return file;
  };
  async function writeAtomic(file, textData) {
    const tmp = file + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    await fsp.writeFile(tmp, textData, 'utf8');
    try { await fsp.rename(tmp, file); }
    catch (err) { await fsp.rm(tmp, { force: true }).catch(() => {}); throw err; }
  }
  async function readJsonIfExists(file) {
    let raw;
    try { raw = await fsp.readFile(file, 'utf8'); }
    catch (err) { if (err && err.code === 'ENOENT') return undefined; throw err; }
    try { return JSON.parse(raw); }
    catch (err) { throw new Error('The pack file ' + nodePath.basename(file) + ' is not valid JSON: ' + err.message, { cause: err }); }
  }
  const trustedSet = () => new Set([...trusted.keys(), ...(author ? [author.fingerprint] : [])]);

  async function persistLog() { await writeAtomic(files.log, JSON.stringify(entries)); }
  // Adds a log line and writes the log. Throws when the log cannot be written,
  // so a caller that must be exact can roll back.
  async function record(event, packId, detail) {
    entries.push({ at: now(), event, packId: packId || '', detail: String(detail || '').slice(0, 300) });
    if (entries.length > MAX_LOG) entries = entries.slice(-MAX_LOG);
    await persistLog();
  }
  // For refusals: the refusal is the news, so a log failure is reported, not thrown over it.
  async function recordBestEffort(event, packId, detail) {
    try { await record(event, packId, detail); }
    catch (err) { log.error('[Packs] could not write the install log:', err && err.message); }
  }

  async function load() {
    await fsp.mkdir(installedDir, { recursive: true });
    const trustedRaw = await readJsonIfExists(files.trusted);
    trusted.clear();
    if (Array.isArray(trustedRaw)) {
      for (const t of trustedRaw) {
        if (!t || typeof t.key !== 'string') continue;
        const raw = Buffer.from(t.key, 'base64');
        if (raw.length !== 32) continue;
        const fp = packs.fingerprintOf(raw);
        trusted.set(fp, { fingerprint: fp, key: t.key, label: String(t.label || '').slice(0, 60), addedAt: Number(t.addedAt) || 0 });
      }
    }
    const authorRaw = await readJsonIfExists(files.author);
    author = null;
    if (authorRaw && typeof authorRaw.publicKey === 'string' && typeof authorRaw.sealed === 'string') {
      const raw = Buffer.from(authorRaw.publicKey, 'base64');
      if (raw.length === 32) author = { publicKey: authorRaw.publicKey, fingerprint: packs.fingerprintOf(raw), sealed: authorRaw.sealed };
    }
    const state = await readJsonIfExists(files.state);
    globalEnabled = !state || state.globalEnabled !== false;
    builtinOn = new Set(state && Array.isArray(state.builtinOn) ? state.builtinOn.filter(x => builtinById.has(x)) : []);
    const logRaw = await readJsonIfExists(files.log);
    entries = Array.isArray(logRaw) ? logRaw.filter(e => e && typeof e.event === 'string').slice(-MAX_LOG) : [];
    installed.clear();
    damaged.length = 0;
    const names = await fsp.readdir(installedDir);
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const rec = await readJsonIfExists(nodePath.join(installedDir, name));
        if (!rec || typeof rec !== 'object' || !rec.pack) throw new packs.PackError('bad-file', 'The saved pack has no content');
        const parsed = packs.parsePack(JSON.stringify(rec.pack), { trustedKeys: trustedSet() });
        if (parsed.pack.id + '.json' !== name) throw new packs.PackError('bad-id', 'The saved pack\'s id does not match its file name');
        const meta = rec.meta && typeof rec.meta === 'object' ? rec.meta : {};
        installed.set(parsed.pack.id, {
          pack: parsed.pack, trust: parsed.trust, fingerprint: parsed.fingerprint,
          meta: { installedAt: Number(meta.installedAt) || 0, enabled: meta.enabled === true, source: String(meta.source || '').slice(0, 120) },
        });
      } catch (err) {
        damaged.push({ file: name, error: (err && err.message) || String(err) });
        log.error('[Packs] ' + name + ' is damaged and was not applied:', err && err.message);
      }
    }
    loaded = true;
  }
  const need = () => { if (!loaded) throw new Error('Packs have not been read yet'); };

  const itemSummary = (p) => p.items.map(it => ({ type: it.type, id: it.id, name: it.name || it.title || it.id }));
  function row(id, r) {
    return {
      id, name: r.pack.name, author: r.pack.author, description: r.pack.description,
      enabled: r.meta.enabled, trust: r.trust, fingerprint: r.fingerprint, installedAt: r.meta.installedAt, source: r.meta.source,
      hash: r.pack.hash, items: itemSummary(r.pack),
      permissions: r.pack.permissions.map(p => ({ id: p, text: packs.PERMISSIONS[p] })),
    };
  }
  function builtinRows() {
    return [...builtinById.entries()].map(([id, r]) => ({
      id, name: r.pack.name, author: r.pack.author, description: r.pack.description, builtin: true,
      enabled: builtinOn.has(id), trust: 'builtin', fingerprint: '', installedAt: 0, source: 'ships with Vex',
      hash: r.pack.hash, items: itemSummary(r.pack),
      permissions: r.pack.permissions.map(p => ({ id: p, text: packs.PERMISSIONS[p] })),
    }));
  }
  function list() {
    need();
    return {
      globalEnabled,
      packs: [...builtinRows(), ...[...installed.entries()].map(([id, r]) => row(id, r))].sort((a, b) => a.name.localeCompare(b.name)),
      damaged: damaged.slice(),
      trusted: [...trusted.values()].map(t => ({ fingerprint: t.fingerprint, label: t.label, addedAt: t.addedAt })),
      authorKey: author ? { fingerprint: author.fingerprint } : null,
      log: entries.slice(-100),
    };
  }

  // The items consumers may use right now, flattened. Only enabled packs, only
  // while the master switch is on. The sticker / medal art comes back rebuilt
  // from the allow-list (sanitizeSvg), never as the file's own text.
  function enabledItems() {
    need();
    if (!globalEnabled) return [];
    const out = [];
    for (const [id, r] of builtinById) {
      if (!builtinOn.has(id)) continue;
      for (const item of r.pack.items) out.push({ packId: id, packName: r.pack.name, trust: 'builtin', item: JSON.parse(JSON.stringify(item)) });
    }
    for (const [id, r] of installed) {
      if (!r.meta.enabled) continue;
      for (const item of r.pack.items) {
        const copy = JSON.parse(JSON.stringify(item));
        if (item.type === 'sticker' || item.type === 'medal-frame') { copy.svg = packs.sanitizeSvg(item.svg); }
        out.push({ packId: id, packName: r.pack.name, trust: r.trust, item: copy });
      }
    }
    return out;
  }

  // --- install --------------------------------------------------------------
  function sweep() {
    const t = now();
    for (const [k, v] of staged) if (v.expires <= t) staged.delete(k);
    while (staged.size > MAX_STAGED) staged.delete(staged.keys().next().value);
  }
  async function preview(textData, source = '') {
    need();
    let parsed;
    try { parsed = packs.parsePack(textData, { trustedKeys: trustedSet() }); }
    catch (err) {
      await recordBestEffort('refused', '', ((err && err.code) || 'error') + ': ' + ((err && err.message) || err));
      throw err;
    }
    sweep();
    const token = crypto.randomBytes(16).toString('hex');
    staged.set(token, { parsed, source: String(source || '').slice(0, 120), expires: now() + STAGE_TTL_MS });
    const existing = installed.get(parsed.pack.id);
    return {
      token, ...parsed.summary,
      replaces: existing ? { name: existing.pack.name, trust: existing.trust, fingerprint: existing.fingerprint } : null,
    };
  }
  function install(token, { trustKey = false } = {}) {
    return locked(async () => {
      need();
      sweep();
      const st = staged.get(token);
      if (!st) throw new Error('That pack is no longer waiting to be installed. Open the file again.');
      staged.delete(token);
      const { parsed } = st;
      const id = parsed.pack.id;
      const before = installed.get(id);
      if (!before && installed.size >= MAX_PACKS) throw new packs.PackError('too-many-packs', 'Vex keeps at most ' + MAX_PACKS + ' packs. Remove one first.');
      if (before && before.fingerprint && before.fingerprint !== parsed.fingerprint) {
        throw new packs.PackError('key-mismatch', 'An installed pack with this id was signed by a different key (or this one is unsigned). Remove the installed pack first if you really want to replace it.');
      }
      if (trustKey && parsed.trust !== 'unknown-key') throw new Error('Only a pack signed by a key you have not trusted yet can add its key to your trusted keys');
      const file = fileFor(id);
      const previousBytes = before ? await fsp.readFile(file, 'utf8') : null;
      const rec = { v: 1, pack: parsed.pack, meta: { installedAt: now(), enabled: before ? before.meta.enabled : true, source: st.source } };
      const trustedBefore = new Map(trusted);
      await fsp.mkdir(installedDir, { recursive: true });
      await writeAtomic(file, JSON.stringify(rec, null, 2));
      try {
        if (trustKey) {
          trusted.set(parsed.fingerprint, { fingerprint: parsed.fingerprint, key: parsed.pack.signature.key, label: parsed.pack.author, addedAt: now() });
          await writeAtomic(files.trusted, JSON.stringify([...trusted.values()]));
        }
        await record(before ? 'replace' : 'install', id, parsed.pack.name + ' (' + parsed.trust + (parsed.fingerprint ? ', key ' + parsed.fingerprint : '') + ')');
      } catch (err) {
        // Exact rollback: the previous bytes come back, or the file goes away.
        trusted.clear(); for (const [k, v] of trustedBefore) trusted.set(k, v);
        try {
          if (previousBytes !== null) await writeAtomic(file, previousBytes); else await fsp.rm(file, { force: true });
          await writeAtomic(files.trusted, JSON.stringify([...trusted.values()]));
        } catch (undoErr) { log.error('[Packs] could not undo a failed install:', undoErr && undoErr.message); }
        throw new Error('The pack was not installed: ' + ((err && err.message) || err), { cause: err });
      }
      const trustNow = !parsed.fingerprint ? 'unsigned' : trustedSet().has(parsed.fingerprint) ? 'trusted' : 'unknown-key';
      installed.set(id, { pack: parsed.pack, trust: trustNow, fingerprint: parsed.fingerprint, meta: rec.meta });
      return row(id, installed.get(id));
    });
  }
  function discard(token) { staged.delete(token); }

  // --- per pack and global switches ------------------------------------------
  async function writeRecord(id, r) {
    await writeAtomic(fileFor(id), JSON.stringify({ v: 1, pack: r.pack, meta: r.meta }, null, 2));
  }
  const stateText = () => JSON.stringify({ globalEnabled, builtinOn: [...builtinOn] });
  function setEnabled(id, on) {
    return locked(async () => {
      need();
      if (builtinById.has(id)) {
        const prev = new Set(builtinOn);
        if (on) builtinOn.add(id); else builtinOn.delete(id);
        try { await writeAtomic(files.state, stateText()); await record(on ? 'enable' : 'disable', id, builtinById.get(id).pack.name + ' (built in)'); }
        catch (err) { builtinOn = prev; try { await writeAtomic(files.state, stateText()); } catch (undoErr) { log.error('[Packs] could not undo a switch:', undoErr && undoErr.message); } throw err; }
        return builtinRows().find(x => x.id === id);
      }
      const r = installed.get(id);
      if (!r) throw new Error('That pack is not installed');
      const prev = r.meta.enabled;
      r.meta.enabled = !!on;
      try { await writeRecord(id, r); await record(on ? 'enable' : 'disable', id, r.pack.name); }
      catch (err) {
        r.meta.enabled = prev;
        try { await writeRecord(id, r); } catch (undoErr) { log.error('[Packs] could not undo a switch:', undoErr && undoErr.message); }
        throw err;
      }
      return row(id, r);
    });
  }
  function setGlobalEnabled(on) {
    return locked(async () => {
      need();
      const prev = globalEnabled;
      globalEnabled = !!on;
      try { await writeAtomic(files.state, stateText()); await record('kill-switch', '', on ? 'all packs on' : 'all packs off'); }
      catch (err) { globalEnabled = prev; throw err; }
      return globalEnabled;
    });
  }
  function uninstall(id) {
    return locked(async () => {
      need();
      if (builtinById.has(id)) throw new packs.PackError('builtin', 'A pack that ships with Vex cannot be removed. Switch it off instead.');
      const r = installed.get(id);
      if (!r) throw new Error('That pack is not installed');
      const file = fileFor(id);
      const bytes = await fsp.readFile(file, 'utf8');
      await fsp.rm(file, { force: false });
      try { await record('uninstall', id, r.pack.name); }
      catch (err) {
        try { await writeAtomic(file, bytes); } catch (undoErr) { log.error('[Packs] could not restore a pack after a failed uninstall:', undoErr && undoErr.message); }
        throw new Error('The pack was not removed: ' + ((err && err.message) || err), { cause: err });
      }
      installed.delete(id);
      return true;
    });
  }

  // --- keys -------------------------------------------------------------------
  function trustKey(packId, label) {
    return locked(async () => {
      need();
      const r = installed.get(packId);
      if (!r || !r.pack.signature) throw new Error('That pack is not signed, so there is no key to trust');
      if (r.fingerprint && trusted.has(r.fingerprint)) return true;
      const before = new Map(trusted);
      trusted.set(r.fingerprint, { fingerprint: r.fingerprint, key: r.pack.signature.key, label: String(label || r.pack.author).slice(0, 60), addedAt: now() });
      try { await writeAtomic(files.trusted, JSON.stringify([...trusted.values()])); await record('trust-key', packId, r.fingerprint); }
      catch (err) { trusted.clear(); for (const [k, v] of before) trusted.set(k, v); throw err; }
      for (const x of installed.values()) if (x.fingerprint === r.fingerprint) x.trust = 'trusted';
      return true;
    });
  }
  function untrustKey(fingerprint) {
    return locked(async () => {
      need();
      if (!trusted.has(fingerprint)) throw new Error('That key is not in your trusted keys');
      const before = new Map(trusted);
      trusted.delete(fingerprint);
      try { await writeAtomic(files.trusted, JSON.stringify([...trusted.values()])); await record('untrust-key', '', fingerprint); }
      catch (err) { trusted.clear(); for (const [k, v] of before) trusted.set(k, v); throw err; }
      for (const x of installed.values()) if (x.fingerprint === fingerprint && !(author && author.fingerprint === fingerprint)) x.trust = 'unknown-key';
      return true;
    });
  }
  function generateAuthorKey({ replace = false } = {}) {
    return locked(async () => {
      need();
      if (author && !replace) throw new Error('You already have a signing key. Replacing it makes packs you signed before show up as from an unknown key.');
      if (typeof seal !== 'function') throw new Error('This computer cannot protect a signing key (no OS encryption), so Vex will not create one');
      const kp = packs.generateKeyPair();
      const sealed = seal(kp.privateKeyDer);
      if (!Buffer.isBuffer(sealed)) throw new Error('The signing key could not be sealed');
      const rec = { publicKey: kp.publicKey, sealed: sealed.toString('base64') };
      const before = author;
      await writeAtomic(files.author, JSON.stringify(rec));
      author = { publicKey: kp.publicKey, fingerprint: kp.fingerprint, sealed: rec.sealed };
      try { await record('key-generated', '', kp.fingerprint); }
      catch (err) { author = before; throw err; }
      return { fingerprint: kp.fingerprint };
    });
  }

  // --- authoring ---------------------------------------------------------------
  // items come from the window (the person's own themes, chains, aliases) and are
  // validated like any pack. Signed with the author key when there is one.
  function exportPack({ id, name, authorName, description = '', items, sign = true }) {
    return locked(async () => {
      need();
      const pack = packs.buildPack({ id, name, author: authorName, description, items });
      let out = packs.withHash(pack);
      if (sign) {
        if (!author) throw new Error('Create your signing key first, or export without signing');
        if (typeof unseal !== 'function') throw new Error('The signing key cannot be opened on this computer');
        const der = unseal(Buffer.from(author.sealed, 'base64'));
        out = packs.signPack(pack, der);
      }
      const parsed = packs.parsePack(JSON.stringify(out), { trustedKeys: trustedSet() });
      await recordBestEffort('export', parsed.pack.id, parsed.pack.name + (sign ? ' (signed)' : ' (unsigned)'));
      return { text: packs.serializePack(parsed.pack), id: parsed.pack.id, trust: parsed.trust };
    });
  }

  return {
    load, list, enabledItems, preview, install, discard, setEnabled, setGlobalEnabled, uninstall,
    trustKey, untrustKey, generateAuthorKey, exportPack,
    LIMITS: { maxPacks: MAX_PACKS, maxLog: MAX_LOG },
  };
}

module.exports = { createPackStore, MAX_PACKS };
