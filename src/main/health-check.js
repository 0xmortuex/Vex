// Vex's health check and self-repair (Settings › Health check, js/vex-health.js).
//
// scan() looks and changes nothing. It returns findings, each with the repair
// it would make (`fix`) or none. fix(ids) makes only the repairs asked for, and
// only those this module itself finds again at that moment (a caller names ids,
// never paths). Every change keeps what it replaced in
// <userData>/health-undo/<run>/ so undo(run) puts it back.
//
// Two kinds of repair:
//   safe        - restores a copy Vex itself made (a .bak of a damaged file) or
//                 removes a leftover temporary file of an interrupted write.
//                 Nothing of the person's is lost; made when asked.
//   needs a yes - anything that takes a setting or a data file out of play
//                 (a damaged value, an oversized key, a store with no good
//                 copy). `fix.confirm` is true; fix() refuses it unless the
//                 caller says the person agreed (the interface asks with
//                 vexConfirm). Even then the original is kept for undo.
//
// Preference KEYS are not removed here: the interface holds them in memory
// (the localStorage shim), so removing one behind its back would be written
// straight back. fix() hands the keys to remove back to the interface, with
// the values kept in the undo record; undo() hands the values back.
const nodePath = require('path');

const TMP_AGE_MS = 10 * 60 * 1000;
const BIG_KEY_CHARS = 2 * 1024 * 1024;
const KEEP_RUNS = 3;
const RUN = /^\d{8}-\d{6}(?:-\d{1,3})?$/;
const STORE_FILE = /^[a-zA-Z0-9_-]{1,64}\.json$/;
const TMP_FILE = /\.tmp$/;

function createHealthCheck({ fs, userDataPath, getPersisted, now = () => new Date(), log = console }) {
  if (!userDataPath) throw new Error('The health check needs the profile folder');
  const persistFile = nodePath.join(userDataPath, 'vex-persist.json');
  const storageDir = nodePath.join(userDataPath, 'vex-storage');
  const undoRoot = nodePath.join(userDataPath, 'health-undo');
  const legacyDir = nodePath.join(userDataPath, 'settings-backups');
  const backupsDir = nodePath.join(userDataPath, 'backups');
  const tmpDirs = [userDataPath, storageDir, nodePath.join(userDataPath, 'updates'), backupsDir];

  const mb = (n) => (n / (1024 * 1024)).toFixed(1) + ' MB';
  const kb = (n) => Math.max(1, Math.round(n / 1024)) + ' KB';
  const stat = (p) => { try { return fs.statSync(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
  const readdir = (p) => { try { return fs.readdirSync(p); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return []; throw e; } };
  const rel = (p) => nodePath.relative(userDataPath, p).split(nodePath.sep).join('/');

  // Is this file a JSON object a Vex store would read?
  function jsonProblem(file) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (e) { return { missing: e.code === 'ENOENT', error: e.code || e.message }; }
    try {
      const v = JSON.parse(text);
      if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'it is not a set of values' };
      return null;
    } catch (e) { return { error: e.message }; }
  }

  // --- scan ----------------------------------------------------------------
  function scan() {
    const findings = [];
    const checked = [];
    const add = f => findings.push(f);

    // 1. Settings JSON validity: the settings file and every data store.
    checked.push('settings file', 'data stores');
    const files = [persistFile];
    const volatileFile = nodePath.join(userDataPath, 'vex-persist-volatile.json');
    if (stat(volatileFile)) files.push(volatileFile);
    for (const n of readdir(storageDir)) if (STORE_FILE.test(n)) files.push(nodePath.join(storageDir, n));
    for (const file of files) {
      const bad = jsonProblem(file);
      if (!bad || bad.missing) continue;
      const bak = file + '.bak';
      const good = stat(bak) && !jsonProblem(bak);
      const name = rel(file);
      add(good ? {
        id: 'file-corrupt:' + name, severity: 'error',
        title: name + ' is damaged, and its backup copy is fine',
        detail: 'It cannot be read (' + bad.error + '). Vex keeps a copy of the file before each save; that copy reads correctly.',
        fix: { action: 'restore-bak', confirm: false, summary: 'Put the backup copy back in place of ' + name + '. The damaged file is kept for undo.' },
      } : {
        id: 'file-corrupt:' + name, severity: 'error',
        title: name + ' is damaged and has no good backup copy',
        detail: 'It cannot be read (' + bad.error + '), so Vex reads it as empty. The file itself is left on disk.',
        fix: { action: 'quarantine', confirm: true, summary: 'Move ' + name + ' aside so Vex starts it fresh. Nothing is deleted: undo moves it back.' },
      });
    }

    // 2. Broken / oversized storage keys in the settings Vex holds in memory.
    checked.push('stored values');
    let persisted = null;
    try { persisted = getPersisted ? getPersisted() : null; }
    catch (err) { add({ id: 'persist-unreadable', severity: 'error', title: 'The settings could not be read', detail: err.message, fix: null }); }
    if (persisted && typeof persisted === 'object') {
      let total = 0;
      for (const [key, value] of Object.entries(persisted)) {
        if (key === '__vexPreferenceStore') continue;
        if (!key || key.length > 200) {
          add({ id: 'key-name:' + key.slice(0, 60), severity: 'warn', title: 'A stored value has an unusable name', detail: 'Name of ' + key.length + ' characters.',
            fix: { action: 'remove-key', key, confirm: true, summary: 'Remove that value. It is kept for undo.' } });
          continue;
        }
        if (typeof value !== 'string') {
          add({ id: 'key-type:' + key, severity: 'warn', title: key + ' holds a value of the wrong kind', detail: 'Vex stores text; this is ' + (value === null ? 'empty' : typeof value) + '.',
            fix: { action: 'remove-key', key, confirm: true, summary: 'Remove ' + key + '. It is kept for undo.' } });
          continue;
        }
        total += value.length;
        if (value.length > BIG_KEY_CHARS) {
          add({ id: 'key-big:' + key, severity: 'warn', title: key + ' is very large (' + mb(value.length) + ')',
            detail: 'Large values slow every save of the settings file. It may be a real, long list (history, notes); only you can say.',
            fix: { action: 'remove-key', key, confirm: true, summary: 'Remove ' + key + ' (' + mb(value.length) + '). It is kept for undo until you close the Health check.' } });
        }
        const head = value.trimStart()[0];
        if ((head === '{' || head === '[') && value.length <= BIG_KEY_CHARS * 8) {
          try { JSON.parse(value); }
          catch (err) {
            add({ id: 'key-json:' + key, severity: 'warn', title: key + ' looks like a list or object, but cannot be read',
              detail: 'Starts with "' + value.trimStart().slice(0, 40).replace(/\s+/g, ' ') + '…" and is not valid JSON (' + err.message + ').',
              fix: { action: 'remove-key', key, confirm: true, summary: 'Remove ' + key + ' so its feature starts clean. It is kept for undo.' } });
          }
        }
      }
      checked.push('settings keys: ' + Object.keys(persisted).length + ' values, ' + mb(total));
    }

    // 3. Caches: leftovers of interrupted writes.
    checked.push('leftover temporary files');
    const cutoff = now().getTime() - TMP_AGE_MS;
    for (const dir of tmpDirs) {
      for (const n of readdir(dir)) {
        if (!TMP_FILE.test(n)) continue;
        const full = nodePath.join(dir, n);
        const st = stat(full);
        if (!st || !st.isFile() || st.mtimeMs > cutoff) continue;
        add({ id: 'tmp:' + rel(full), severity: 'info', title: 'Leftover temporary file ' + rel(full) + ' (' + kb(st.size) + ')',
          detail: 'Left by a save that was interrupted. Vex never reads it.',
          fix: { action: 'remove-file', path: full, confirm: false, summary: 'Remove it (kept for undo).' } });
      }
    }

    // 4. Stale migrations: what an older version left behind.
    checked.push('stale migrations');
    const legacy = readdir(legacyDir);
    if (stat(legacyDir)) {
      if (!legacy.length) {
        add({ id: 'legacy-empty', severity: 'info', title: 'The old settings-backups folder is empty',
          detail: 'Its copies were converted into backups by an earlier version.',
          fix: { action: 'remove-dir', path: legacyDir, confirm: false, summary: 'Remove the empty folder.' } });
      } else {
        add({ id: 'legacy-waiting', severity: 'info', title: 'The old settings-backups folder still holds ' + legacy.length + ' file(s)',
          detail: 'An earlier version could not convert them into backups; Vex tries again on every start. They are left alone.', fix: null });
      }
    }
    if (stat(nodePath.join(storageDir, 'history.json'))) {
      add({ id: 'history-json', severity: 'info', title: 'An old history.json is still in the data folder',
        detail: 'Vex folds it into the browsing history at start and then removes it; if it stays, that step failed (see the log).', fix: null });
    }

    // 5. Orphan data: pieces with no owner. Reported, never removed here.
    checked.push('orphaned data');
    const names = new Set(readdir(storageDir));
    for (const n of names) {
      if (!n.endsWith('.json.bak')) continue;
      if (names.has(n.slice(0, -4))) continue;
      add({ id: 'orphan-bak:' + n, severity: 'info', title: n + ' has no data file next to it',
        detail: 'It may be the only copy of that store, so it is left alone.', fix: null });
    }
    const BACKUP_NAME = /^(?:before-|settings-)[^/\\]+\.json$/;
    for (const n of readdir(backupsDir)) {
      if (BACKUP_NAME.test(n) || TMP_FILE.test(n)) continue;
      add({ id: 'orphan-backup:' + n, severity: 'info', title: 'backups/' + n + ' is not a backup Vex made',
        detail: 'Vex does not list or restore it. It is left alone.', fix: null });
    }

    return { at: now().toISOString(), checked, findings: findings.map(({ fix, ...f }) => ({ ...f, fix: fix ? { action: fix.action, confirm: !!fix.confirm, summary: fix.summary } : null, _fix: fix })) };
  }

  // The renderer is given findings without internal paths.
  function publicScan() {
    const r = scan();
    return { ...r, findings: r.findings.map(({ _fix, ...f }) => f) };
  }

  // --- fix / undo ----------------------------------------------------------
  function newRun() {
    const d = now();
    const p = (n, w = 2) => String(n).padStart(w, '0');
    const base = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    let id = base;
    for (let i = 1; stat(nodePath.join(undoRoot, id)); i++) id = base + '-' + i;
    fs.mkdirSync(nodePath.join(undoRoot, id), { recursive: true });
    return id;
  }

  function pruneRuns() {
    const runs = readdir(undoRoot).filter(n => RUN.test(n)).sort();
    for (const old of runs.slice(0, Math.max(0, runs.length - KEEP_RUNS))) {
      try { fs.rmSync(nodePath.join(undoRoot, old), { recursive: true, force: true }); }
      catch (err) { log.warn('[Health] could not remove the old undo record', old + ':', err.message); }
    }
  }

  // ids -> { run, applied: [{id, summary}], skipped: [{id, reason}], removeKeys: [key] }
  function fix(ids, { confirmed = false } = {}) {
    if (!Array.isArray(ids)) throw new Error('Name the repairs to make');
    const current = new Map(scan().findings.map(f => [f.id, f]));
    const out = { run: null, applied: [], skipped: [], removeKeys: [] };
    const entries = [];
    let run = null;
    let n = 0;
    const keep = (file) => {
      // A copy of what is about to change, inside the undo record.
      if (!run) run = newRun();
      const saved = 'f' + (n++);
      fs.copyFileSync(file, nodePath.join(undoRoot, run, saved));
      return saved;
    };
    for (const id of ids) {
      const f = current.get(id);
      if (!f) { out.skipped.push({ id, reason: 'It is not found any more' }); continue; }
      if (!f._fix) { out.skipped.push({ id, reason: 'There is no repair for it' }); continue; }
      const { action, confirm } = f._fix;
      if (confirm && !confirmed) { out.skipped.push({ id, reason: 'It needs your confirmation' }); continue; }
      try {
        if (action === 'restore-bak') {
          const file = nodePath.join(userDataPath, id.slice('file-corrupt:'.length));
          const saved = keep(file);
          const tmp = file + '.health.tmp';
          fs.copyFileSync(file + '.bak', tmp);
          fs.renameSync(tmp, file);
          entries.push({ kind: 'file', path: rel(file), saved });
        } else if (action === 'quarantine') {
          const file = nodePath.join(userDataPath, id.slice('file-corrupt:'.length));
          const saved = keep(file);
          fs.rmSync(file);
          entries.push({ kind: 'file', path: rel(file), saved });
        } else if (action === 'remove-file') {
          const saved = keep(f._fix.path);
          fs.rmSync(f._fix.path);
          entries.push({ kind: 'file', path: rel(f._fix.path), saved, deleted: true });
        } else if (action === 'remove-dir') {
          if (readdir(f._fix.path).length) throw new Error('The folder is not empty');
          fs.rmdirSync(f._fix.path);
          if (!run) run = newRun();
          entries.push({ kind: 'dir', path: rel(f._fix.path) });
        } else if (action === 'remove-key') {
          const value = getPersisted()[f._fix.key];
          if (!run) run = newRun();
          entries.push({ kind: 'key', key: f._fix.key, value: value === undefined ? null : value, valueType: typeof value });
          out.removeKeys.push(f._fix.key);
        } else throw new Error('Unknown repair ' + action);
        out.applied.push({ id, summary: f._fix.summary });
      } catch (err) {
        out.skipped.push({ id, reason: err.message });
        log.error('[Health] repair', id, 'failed:', err.message);
      }
    }
    if (run) {
      fs.writeFileSync(nodePath.join(undoRoot, run, 'manifest.json'), JSON.stringify({ v: 1, at: now().toISOString(), entries }, null, 2));
      out.run = run;
      pruneRuns();
    }
    return out;
  }

  // run -> { restored: [paths], restoreKeys: { key: value } }
  function undo(run) {
    if (typeof run !== 'string' || !RUN.test(run)) throw new Error('That is not a repair Vex made');
    const dir = nodePath.join(undoRoot, run);
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(nodePath.join(dir, 'manifest.json'), 'utf8')); }
    catch (err) { throw new Error('That repair cannot be undone any more (' + (err.code || err.message) + ')', { cause: err }); }
    if (!manifest || manifest.v !== 1 || !Array.isArray(manifest.entries)) throw new Error('The undo record is not readable');
    const out = { restored: [], restoreKeys: {} };
    for (const e of manifest.entries.slice().reverse()) {
      if (e.kind === 'key') { if (typeof e.value === 'string') out.restoreKeys[e.key] = e.value; continue; }
      // A path in the record is only ever inside the profile folder.
      const target = nodePath.resolve(userDataPath, e.path);
      if (!target.startsWith(nodePath.resolve(userDataPath) + nodePath.sep)) throw new Error('The undo record names a path outside the profile');
      if (e.kind === 'dir') { fs.mkdirSync(target, { recursive: true }); out.restored.push(e.path); continue; }
      const tmp = target + '.health.tmp';
      fs.copyFileSync(nodePath.join(dir, e.saved), tmp);
      fs.renameSync(tmp, target);
      out.restored.push(e.path);
    }
    fs.rmSync(dir, { recursive: true, force: true });
    return out;
  }

  function runs() { return readdir(undoRoot).filter(n => RUN.test(n)).sort().reverse(); }

  return { scan: publicScan, fix, undo, runs, undoRoot };
}

module.exports = { createHealthCheck, KEEP_RUNS, BIG_KEY_CHARS };
