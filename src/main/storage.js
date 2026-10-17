const fs = require('fs');
const { createHash, randomUUID } = require('crypto');
const { atomicWrite } = require('./file-store');

// One main-process writer for the preferences shared by all renderer windows.
//
// The settings file is checked on every load: it carries a SHA-256 of its own
// content (`__vexChecksum`), so a file that parses but was cut or altered is
// caught as well as one that does not parse. A file that fails is never
// overwritten: a copy of it is kept next to it (`.corrupt-<stamp>`, three
// kept) and the newest good copy takes its place, from the .bak (the file as
// it was before the last save) or from a rolling generation (`.gen1`..`.gen3`,
// the file as it was at the start of a session and at most every six hours).
//
// Optionally (see `volatile` below) the history-like keys live in a second
// file, so the settings file stays small and is not rewritten for them.
const MARK = '__vexPreferenceStore';
// The data schema version of the preference files: the value of MARK. A file stamped with a higher one was written
// by a newer Vex; it is refused as it is (never "recovered" from an older copy, never rewritten) so a downgrade
// cannot lose the newer data. Raise this when the shape of the files changes, and migrate in decodeText.
const SCHEMA = 1;
const SUM = '__vexChecksum';
const SPLIT = '__vexSplit';
const GENERATIONS = 3;
const GENERATION_EVERY_MS = 6 * 3600 * 1000;
const KEEP_CORRUPT = 3;

// Keys that are rewritten constantly and are history, caches, counters or
// logs: losing a few seconds of them is not losing a setting. Settings,
// credentials, lists the person curates and anything main reads at start do
// NOT belong here.
const VOLATILE_KEYS = Object.freeze([
  'vex.history', 'vex.aiNews.state', 'vex.workspaceSnapshots', 'vex.recentlyClosed', 'vex.downloads',
  'vex.clipboardHistory', 'vex.autofillLog', 'vex.scheduleHistory', 'vex.priceHistory', 'vex.gameLog',
  'vex.checkHistory', 'vex.captureLog', 'vex.weatherCache', 'vex.readingDigestCache',
]);
// The preference that turns the split layout on (and back off: switching it
// off merges the two files again). Off unless set.
const SPLIT_PREFERENCE = 'vex.volatileSplit';

function sha(text) { return createHash('sha256').update(text).digest('hex'); }

// The file's text for `data` (an object), with its checksum as the last key.
function encode(data) {
  const body = JSON.stringify(data);
  if (body === '{}') return `{"${SUM}":"${sha(body)}"}`;
  return body.slice(0, -1) + `,"${SUM}":"${sha(body)}"}`;
}

// The object in `text`; throws when it is not a set of preferences or its
// checksum does not match. A file with no checksum (written before they
// existed) is accepted and gets one on its next save.
function decodeText(text) {
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid preference store');
  if (Object.hasOwn(value, SUM)) {
    const sum = value[SUM];
    delete value[SUM];
    if (typeof sum !== 'string' || sha(JSON.stringify(value)) !== sum) throw new Error('Preference store checksum mismatch');
  }
  if (typeof value[MARK] === 'number' && value[MARK] > SCHEMA) {
    const e = new Error(`The preference file was written by a newer Vex (data version ${value[MARK]}, this Vex knows ${SCHEMA}); it was left as it is`);
    e.code = 'EVEXNEWER';
    throw e;
  }
  require('../renderer/js/data-contracts').json(value);
  return value;
}

function decodeFile(target) { return decodeText(fs.readFileSync(target, 'utf8')); }

// Synchronous atomic write for the one-time layout changes at start: the new
// content is written beside the file, flushed, then renamed over it.
function writeSync(target, text) {
  const temp = target + '.' + randomUUID() + '.tmp';
  try {
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, target);
  } finally { fs.rmSync(temp, { force: true }); }
}

function stamp(ms) { return new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14); }

/**
 * @param {string} file
 * @param {{ volatileFile?: string|null, volatileKeys?: readonly string[], splitEnabled?: (data: object) => boolean,
 *           volatileDelayMs?: number, now?: () => number, log?: { error: Function, warn: Function } }} [options]
 *   volatileFile: where the history-like keys go when the split layout is on.
 *   splitEnabled(data): whether the split layout is wanted, from the loaded
 *   preferences; the default is the `vex.volatileSplit` preference being "1".
 */
function createPreferenceStore(file, options = {}) {
  const {
    volatileFile = null,
    volatileKeys = VOLATILE_KEYS,
    splitEnabled = (data) => data[SPLIT_PREFERENCE] === '1',
    volatileDelayMs = 2000,
    now = Date.now,
    log = console,
  } = options;
  const volatileSet = new Set(volatileKeys);
  const preSplit = file + '.pre-split';
  let cache;
  let pending = Promise.resolve();
  let split = false;            // the layout on disk is the split one
  const lastGeneration = new Map(); // file -> when a generation was last rotated (absent: not this session)
  let mainClean = false;
  let cleanLoad = false;        // the split layout's files read without recovery
  let volatileDirty = false;
  let volatileTimer = null;

  const generations = (target) => Array.from({ length: GENERATIONS }, (_, i) => `${target}.gen${i + 1}`);

  // A copy of a file that failed its checks, kept beside it.
  function keepCorrupt(target) {
    if (!fs.existsSync(target)) return null;
    const copy = `${target}.corrupt-${stamp(now())}`;
    fs.copyFileSync(target, copy);
    const dir = require('path').dirname(target), base = require('path').basename(target) + '.corrupt-';
    const old = fs.readdirSync(dir).filter(n => n.startsWith(base)).sort().reverse().slice(KEEP_CORRUPT);
    for (const n of old) fs.rmSync(require('path').join(dir, n), { force: true });
    return copy;
  }

  // Reads `target`, or the newest good copy of it. -> { data, from } where
  // `from` is the file read; throws the first error when none reads. A bad
  // primary is kept aside, then put back from the copy that read.
  // `missingIsEmpty`: a primary that does not exist is a profile that has none
  // yet (thrown as ENOENT at once); otherwise its copies are tried as well.
  function readWithRecovery(target, missingIsEmpty) {
    let first;
    for (const candidate of [target, target + '.bak', ...generations(target)]) {
      try {
        const data = decodeFile(candidate);
        if (candidate === target) return { data, from: candidate };
        log.error(`[Storage] ${target} could not be read (${first.message}); recovered from ${candidate}. The damaged file was kept as ${target}.corrupt-*.`);
        keepCorrupt(target);
        writeSync(target, encode(data));
        return { data, from: candidate };
      } catch (error) {
        if (error.code === 'EVEXNEWER') throw error;
        if (error.code === 'ENOENT' && candidate !== target) continue;
        if (!first) first = error;
        if (candidate === target && error.code === 'ENOENT' && missingIsEmpty) throw error;
      }
    }
    throw first;
  }

  // The keys a file holds that are volatile / not volatile.
  const pick = (data, wantVolatile) => {
    const out = {};
    for (const [k, v] of Object.entries(data)) if (volatileSet.has(k) === wantVolatile && k !== SPLIT && k !== MARK) out[k] = v;
    return out;
  };

  function load() {
    if (cache !== undefined) return cache;
    let main;
    try { const r = readWithRecovery(file, true); main = r.data; mainClean = r.from === file; }
    catch (error) {
      if (error.code === 'ENOENT') { cache = {}; return cache; }
      throw error;
    }
    rotateGeneration(file);
    split = main[SPLIT] === 1;
    delete main[SPLIT];
    if (!volatileFile) {
      // No second file wanted by the caller: a split layout cannot be read.
      if (split) throw new Error('The settings are in the split layout, but no volatile file was configured');
      cache = main;
    } else if (split) cache = loadSplit(main);
    else cache = main;
    try { layoutAfterLoad(); }
    catch (error) { log.error('[Storage] the settings layout was left as it is:', error.message); }
    return cache;
  }

  // The settings file said "split": merge in the volatile file. A volatile file
  // that cannot be read (and has no good copy) comes back from the copy taken
  // before the split, else starts empty with the damaged file kept; settings
  // are never touched by it.
  function loadSplit(main) {
    let volatile;
    try { volatile = readWithRecovery(volatileFile, false).data; cleanLoad = true; rotateGeneration(volatileFile); }
    catch (error) {
      log.error(`[Storage] ${volatileFile} could not be read (${error.message}).`);
      try { keepCorrupt(volatileFile); } catch (e) { log.error('[Storage] could not keep a copy of it:', e.message); }
      volatile = {};
      if (fs.existsSync(preSplit)) {
        try { volatile = pick(decodeFile(preSplit), true); log.error('[Storage] its keys were restored from the copy made before the split.'); }
        catch (e) { log.error('[Storage] the copy made before the split could not be read either:', e.message); }
      }
      cleanLoad = false;
      volatileDirty = true;
    }
    return { ...main, ...pick(volatile, true) };
  }

  // After reading: bring the layout in line with the wish (migrate, or roll
  // back), then drop the pre-split copy once the split layout read cleanly.
  function layoutAfterLoad() {
    if (!volatileFile) return;
    const wanted = splitEnabled(cache);
    if (wanted && !split) migrate();
    else if (!wanted && split) rollback();
    else if (split && cleanLoad && mainClean && fs.existsSync(preSplit)) {
      // Both files read without recovery on a start after the migration.
      fs.rmSync(preSplit, { force: true });
    }
  }

  // Single file -> two files. Nothing is removed until the new layout reads
  // back identical; the old file stays as .pre-split until a later start loads
  // the new layout cleanly. Any failure puts the old file back.
  function migrate() {
    const original = fs.readFileSync(file);
    fs.writeFileSync(preSplit, original);
    if (!fs.readFileSync(preSplit).equals(original)) throw new Error('The copy of the settings made before the split differs from the original');
    const mainPart = { ...pick(cache, false), [MARK]: SCHEMA, [SPLIT]: 1 };
    const volatilePart = { ...pick(cache, true), [MARK]: SCHEMA };
    try {
      writeSync(volatileFile, encode(volatilePart));
      const back = decodeFile(volatileFile);
      if (JSON.stringify(back) !== JSON.stringify(volatilePart)) throw new Error('The volatile file did not read back the same');
      writeSync(file, encode(mainPart));
      const mainBack = decodeFile(file);
      if (JSON.stringify(mainBack) !== JSON.stringify(mainPart)) throw new Error('The settings file did not read back the same');
    } catch (error) {
      // Put the old layout back exactly as it was.
      writeSync(file, original.toString('utf8'));
      fs.rmSync(volatileFile, { force: true });
      throw new Error('could not split the settings file (' + error.message + '); the old file was put back', { cause: error });
    }
    split = true;
    log.warn('[Storage] the history-like keys now live in ' + volatileFile + '; the old settings file is kept as ' + preSplit + ' until the next clean start.');
  }

  // Two files -> one, the way it was.
  function rollback() {
    const merged = { ...cache, [MARK]: SCHEMA };
    delete merged[SPLIT];
    writeSync(file, encode(merged));
    const back = decodeFile(file);
    if (Object.keys(back).length !== Object.keys(merged).length) throw new Error('The merged settings file did not read back the same');
    split = false;
    volatileDirty = false;
    // The volatile file stays, renamed, until the next rollback replaces it.
    fs.renameSync(volatileFile, volatileFile + '.rolled-back');
    log.warn('[Storage] the split layout was switched off; the settings are in one file again.');
  }

  // The current content of a file as a rolling generation: when the store
  // loads (a file that has just read cleanly) and then at most every six
  // hours, so a bad state that was saved cannot push out every older copy.
  function rotateGeneration(target) {
    const t = now();
    if (lastGeneration.has(target) && t - lastGeneration.get(target) < GENERATION_EVERY_MS) return;
    lastGeneration.set(target, t);
    const gens = generations(target);
    try {
      for (let i = gens.length - 1; i > 0; i--) {
        try { fs.copyFileSync(gens[i - 1], gens[i]); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
      try { fs.copyFileSync(target, gens[0]); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    } catch (error) {
      // A generation is a convenience: failing to make one never blocks a save.
      log.error('[Storage] could not rotate the copies of ' + target + ':', error.message);
    }
  }

  async function writeMain(data, eraseBackup) {
    const out = split ? { ...pick(data, false), [MARK]: SCHEMA, [SPLIT]: 1 } : data;
    if (!eraseBackup) rotateGeneration(file);
    await atomicWrite(file, encode(out), { backup: !eraseBackup });
  }

  async function writeVolatile(eraseBackup) {
    if (!split) { volatileDirty = false; return; }
    volatileDirty = false;
    try {
      if (!eraseBackup) rotateGeneration(volatileFile);
      await atomicWrite(volatileFile, encode({ ...pick(cache, true), [MARK]: SCHEMA }), { backup: !eraseBackup });
    } catch (error) { volatileDirty = true; throw error; }
  }

  function scheduleVolatile() {
    volatileDirty = true;
    if (volatileTimer) return;
    volatileTimer = setTimeout(() => {
      volatileTimer = null;
      enqueueVolatile();
    }, volatileDelayMs);
    if (volatileTimer.unref) volatileTimer.unref();
  }
  function enqueueVolatile() {
    if (!volatileDirty) return pending;
    const next = pending.catch(() => {}).then(() => volatileDirty ? writeVolatile(false) : undefined);
    pending = next;
    next.catch((error) => log.error('[Storage] the volatile preferences could not be saved:', error.message));
    return next;
  }

  function eraseCopies(target, extra = []) {
    const dir = require('path').dirname(target), base = require('path').basename(target);
    const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.startsWith(base + '.corrupt-')) : [];
    for (const p of [target + '.bak', ...generations(target), ...extra, ...names.map(n => require('path').join(dir, n))]) fs.rmSync(p, { force: true });
  }

  function mutate(change, eraseBackup = false) {
    load();
    const next = pending.catch(() => {}).then(async () => {
      const updated = { ...cache };
      // Nothing changed: the file is not written. Every setItem in the
      // interface comes here, most with the value already saved, and each one
      // rewrote the whole file (1.3 MB) and its .bak, about once a minute
      // (found 2026-10-09). Decided here, in the queue, so a write still
      // waiting ahead of this one is what it is compared with.
      if (change(updated) === false) return true;
      updated[MARK] = SCHEMA;
      if (!split) {
        await writeMain(updated, eraseBackup);
        if (eraseBackup) eraseCopies(file);
        cache = updated;
        return true;
      }
      let volatileChanged = false, mainChanged = false;
      for (const k of new Set([...Object.keys(cache), ...Object.keys(updated)])) {
        if (k === MARK || cache[k] === updated[k]) continue;
        if (volatileSet.has(k)) volatileChanged = true; else mainChanged = true;
      }
      if (mainChanged) await writeMain(updated, eraseBackup);
      cache = updated;
      if (volatileChanged) {
        // clearKeys wipes now; ordinary changes are written a moment later,
        // in one write.
        if (eraseBackup) await writeVolatile(true);
        else scheduleVolatile();
      }
      // The cleared keys may sit in any copy of either file.
      if (eraseBackup) { eraseCopies(file, [preSplit]); eraseCopies(volatileFile, [volatileFile + '.rolled-back']); }
      return true;
    });
    pending = next;
    return next;
  }
  return {
    load,
    set(key, value) { return mutate(data => { if (Object.hasOwn(data, key) && data[key] === value) return false; data[key] = value; }); },
    delete(key) { return mutate(data => { if (!Object.hasOwn(data, key)) return false; delete data[key]; }); },
    // Many keys in one write: [[key, value], ...], a null value deleting the
    // key. The renderer saves what changed in the last 300 ms this way; one
    // persist-set per key rewrote the whole file (and its .bak) once per key.
    apply(entries) {
      return mutate(data => {
        let changed = false;
        for (const [key, value] of entries) {
          if (value === null) { if (Object.hasOwn(data, key)) { delete data[key]; changed = true; } }
          else if (!(Object.hasOwn(data, key) && data[key] === value)) { data[key] = value; changed = true; }
        }
        if (!changed) return false;
      });
    },
    clearKeys(keys) { return mutate(data => { for (const key of keys) delete data[key]; }, true); },
    // Everything waiting is written: the volatile file's delayed write too.
    flush() {
      if (volatileTimer) { clearTimeout(volatileTimer); volatileTimer = null; }
      enqueueVolatile();
      return pending;
    },
    isSplit() { load(); return split; },
  };
}
module.exports = { createPreferenceStore, VOLATILE_KEYS, SPLIT_PREFERENCE, SCHEMA, readPreferenceFile: decodeFile };
