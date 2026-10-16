// === Plugin dev loop: an unpacked extension that reloads when you save =======
//
// You pick the folder of an extension you are writing (the folder dialog; the
// path comes from main, never from a page). Vex loads it straight from that
// folder, watches it, and when a file changes it unloads and loads it again, so
// the loop is: save, switch to the tab, see the change. It also lists every
// chrome.* namespace the source uses that Vex does not provide, so a missing
// API is a line in a list and not an extension that silently does nothing.
//
//   - ONE dev extension at a time. Nothing is copied into the profile, and
//     nothing is written anywhere: the folder is only read.
//   - Not remembered across restarts: the loop is on while you work.
//   - Reading is bounded: at most 400 files, 2 MB each, 6 MB in all, not into
//     node_modules or .git, and nothing is followed out of the folder.
//   - vencordStatus() is READ-ONLY guidance for the Vencord builds Vex has
//     installed: name, version, time and a hash. It changes nothing.
//
// createDevExtension({ fs, path, load, unload, watch, absent, cautions, setTimer, clearTimer, now })

const MAX_FILES = 400;
const MAX_FILE = 2 * 1024 * 1024;
const MAX_TOTAL = 6 * 1024 * 1024;
const SKIP = new Set(['node_modules', '.git']);
const SOURCE = /\.(?:js|mjs|cjs|html|htm)$/i;
const MAX_FINDINGS = 200;

function createDevExtension({ fs, path, load, unload, watch, absent = [], cautions = () => [], setTimer = setTimeout, clearTimer = clearTimeout, now = () => Date.now(), debounceMs = 400 } = {}) {
  if (!fs || !path) throw new Error('createDevExtension needs fs and path');
  if (typeof load !== 'function' || typeof unload !== 'function') throw new Error('createDevExtension needs load and unload');
  if (typeof watch !== 'function') throw new Error('createDevExtension needs watch');

  const absentMap = new Map(absent.map(([name, what]) => [name, what]));
  let cur = null; // { folder, manifest, watcher, timer, reloads, loadedAt, lastError, report }

  function readManifest(folder) {
    const file = path.join(folder, 'manifest.json');
    let stat;
    try { stat = fs.statSync(file); } catch { throw new Error('There is no manifest.json in that folder'); }
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('manifest.json is not a normal file under 1 MB');
    let m;
    try { m = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
    catch (err) { throw new Error('manifest.json is not valid JSON: ' + err.message, { cause: err }); }
    if (!m || typeof m !== 'object' || ![2, 3].includes(m.manifest_version)) throw new Error('manifest.json needs "manifest_version": 2 or 3');
    return m;
  }

  // Every chrome.<namespace> the source mentions that Vex does not provide.
  function scan(folder, manifest) {
    const found = new Map(); // namespace -> { what, hits: [{file,line}] }
    let files = 0, total = 0, truncated = false;
    const note = (ns, file, line) => {
      if (!absentMap.has(ns)) return;
      if (!found.has(ns)) found.set(ns, { api: ns, what: absentMap.get(ns), hits: [] });
      const e = found.get(ns);
      if (e.hits.length < 5) e.hits.push({ file, line });
    };
    const walk = (dir, rel) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) { throw new Error('A folder could not be read: ' + err.message, { cause: err }); }
      for (const e of entries) {
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(path.join(dir, e.name), rel + e.name + '/'); continue; }
        if (!e.isFile() || !SOURCE.test(e.name)) continue;
        if (files >= MAX_FILES || total >= MAX_TOTAL) { truncated = true; return; }
        const full = path.join(dir, e.name);
        const size = fs.statSync(full).size;
        if (size > MAX_FILE) { truncated = true; continue; }
        files++; total += size;
        const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
        lines.forEach((text, i) => {
          for (const m of text.matchAll(/\b(?:chrome|browser)\.([A-Za-z]+)\b/g)) note(m[1], rel + e.name, i + 1);
        });
      }
    };
    walk(folder, '');
    // Declared in the manifest too (a permission with nothing in the source yet).
    const perms = new Set([...(manifest.permissions || []), ...(manifest.optional_permissions || [])].filter(p => typeof p === 'string'));
    if (manifest.side_panel) perms.add('sidePanel');
    for (const ns of perms) if (absentMap.has(ns) && !found.has(ns)) found.set(ns, { api: ns, what: absentMap.get(ns), hits: [], manifestOnly: true });
    return { unsupported: [...found.values()].slice(0, MAX_FINDINGS), cautions: cautions(manifest), filesRead: files, truncated };
  }

  async function loadNow() {
    const manifest = readManifest(cur.folder);
    cur.manifest = manifest;
    cur.report = scan(cur.folder, manifest);
    const r = await load(cur.folder, manifest);
    if (!r || !r.extension) {
      cur.lastError = (r && r.errors && r.errors[0]) || 'the extension did not load';
      return false;
    }
    cur.lastError = '';
    cur.loadedAt = now();
    return true;
  }

  async function reload() {
    if (!cur) throw new Error('No extension is being developed');
    unload(cur.folder);
    cur.reloads++;
    try { return await loadNow(); }
    catch (err) { cur.lastError = err.message; throw err; }
  }

  async function start(folder) {
    if (cur) await stop();
    const real = fs.realpathSync(folder);
    if (!fs.statSync(real).isDirectory()) throw new Error('That is not a folder');
    cur = { folder: real, manifest: null, watcher: null, timer: null, reloads: 0, loadedAt: 0, lastError: '', report: null };
    try {
      await loadNow();
      cur.watcher = watch(real, { recursive: true }, () => {
        if (!cur) return;
        if (cur.timer) clearTimer(cur.timer);
        cur.timer = setTimer(() => {
          cur.timer = null;
          // A failed reload is kept in the status (and shown), never dropped.
          reload().catch((err) => { if (cur) cur.lastError = err.message; console.error('[DevExtension] reload failed:', err.message); });
        }, debounceMs);
      });
      if (cur.watcher && typeof cur.watcher.on === 'function') {
        cur.watcher.on('error', (err) => { if (cur) cur.lastError = 'The folder could not be watched: ' + err.message; });
      }
    } catch (err) {
      const failed = cur;
      cur = null;
      if (failed.watcher && typeof failed.watcher.close === 'function') failed.watcher.close();
      unload(real);
      throw err;
    }
    return status();
  }

  async function stop() {
    if (!cur) return status();
    if (cur.timer) clearTimer(cur.timer);
    if (cur.watcher && typeof cur.watcher.close === 'function') cur.watcher.close();
    unload(cur.folder);
    cur = null;
    return status();
  }

  function status() {
    if (!cur) return { active: false };
    const m = cur.manifest || {};
    return { active: true, folder: cur.folder, name: String(m.name || ''), version: String(m.version || ''), manifestVersion: m.manifest_version || 0,
      reloads: cur.reloads, loadedAt: cur.loadedAt, lastError: cur.lastError, report: cur.report };
  }

  // READ-ONLY: the Vencord builds Vex has installed (folders named vencord-*).
  function vencordStatus(extensionsDir) {
    const crypto = require('crypto');
    let names;
    try { names = fs.readdirSync(extensionsDir, { withFileTypes: true }).filter(e => e.isDirectory() && e.name.startsWith('vencord-')).map(e => e.name); }
    catch (err) { throw new Error('The extensions folder could not be read: ' + err.message, { cause: err }); }
    return names.map((name) => {
      const dir = path.join(extensionsDir, name);
      let manifest;
      try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8').replace(/^\uFEFF/, '')); } catch { manifest = null; /* vex-allow-empty-catch: an unreadable manifest is reported as loadable: false */ }
      // The biggest top-level script is the bundle; hash it, nothing else.
      let bundle = null;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!e.isFile() || !/\.js$/i.test(e.name)) continue;
        const size = fs.statSync(path.join(dir, e.name)).size;
        if (!bundle || size > bundle.size) bundle = { name: e.name, size };
      }
      let sha256 = '';
      if (bundle && bundle.size <= 40 * 1024 * 1024) sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, bundle.name))).digest('hex');
      return { folder: name, loadable: !!manifest, version: manifest ? String(manifest.version || '') : '', modified: fs.statSync(dir).mtimeMs, bundle: bundle ? bundle.name : '', bytes: bundle ? bundle.size : 0, sha256 };
    }).sort((a, b) => b.modified - a.modified);
  }

  return { start, stop, reload, status, scan, vencordStatus };
}

module.exports = { createDevExtension, MAX_FILES, MAX_FILE, MAX_TOTAL };
