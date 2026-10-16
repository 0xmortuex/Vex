// === The download desk: real media names, release assets, and mod files ======
//
// Three small helpers for the Downloads folder, all of them local, none of them running anything:
//
//   mediaName()      T3-119  An image or video saved from a site arrives named like a CDN counter
//                    ("358216048_1234567890123456_n.jpg"). With the switch on it is named
//                    "<site> - <page title> - <date>.<ext>" instead. A sorting rule that renames the
//                    file wins; nothing else changes.
//   releaseOf()      T3-032  Is this a GitHub release asset (github.com/<owner>/<repo>/releases/download/...)?
//                    createReleaseDesk keeps which downloaded files were such assets, and can say, for one
//                    of them: the repository, the size, the SHA-256 and a VirusTotal link that carries only
//                    the hash (nothing is uploaded), and the OLDER installers of the same repository that
//                    are still in the folder (the caller removes them to the Recycle Bin after a confirm).
//   createModDesk()  T3-073  Minecraft mods (.jar) loose in the downloads folder are read for their loader
//                    and game version WITHOUT running anything: only the small metadata files inside the
//                    zip are read (fabric.mod.json, quilt.mod.json, META-INF/mods.toml,
//                    META-INF/neoforge.mods.toml), and a proposal is made to move each into
//                    "Minecraft mods/<Loader> <version>/". A second copy of the same mod for the same
//                    loader and version, older than another, is proposed for "Older versions". Nothing moves
//                    until the person confirms the preview; every batch is logged first and can be undone.
//
// Hard rules for the mod desk, enforced here: only regular files directly inside the folder are looked at;
// moves are renames inside the folder (same volume); nothing is copied and nothing is deleted; a destination
// that exists is never overwritten; the plan lives in memory and apply takes a plan id, never paths.
const path = require('path');
const crypto = require('crypto');

// ---- T3-119: media names ---------------------------------------------------------------------
const MEDIA_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'heic', 'mp4', 'webm', 'mov', 'm4v', 'mkv']);
const GENERIC = /^(download|image|images|video|file|unnamed|untitled|img|media|photo|picture|blob|attachment|original|large|medium|small|orig|default|index)$/i;

function stamp(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}
function hostOf(url) { try { return new URL(String(url)).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } }
// "instagram.com" -> "instagram"; "old.reddit.com" -> "reddit"; "bbc.co.uk" -> "bbc"
function siteWord(host) {
  const parts = host.split('.').filter(Boolean);
  if (!parts.length) return 'web';
  if (parts.length === 1) return parts[0];
  const sld = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac']);
  let i = parts.length - 2;
  if (sld.has(parts[i]) && parts.length >= 3 && parts[parts.length - 1].length === 2) i--;
  return parts[i];
}
// A name that tells a person nothing: a counter, a hash, or a word like "download".
function looksMachineMade(base) {
  if (GENERIC.test(base)) return true;
  const digits = (base.match(/\d/g) || []).length;
  if (/^[0-9a-f_-]{16,}$/i.test(base) && digits >= 6) return true;       // hashes and long counters
  if (/^\d+(?:[_-]\d+)+(?:[_-][a-z])?$/i.test(base) && digits >= 10) return true;   // 358216048_1234567890_n
  if (/^\d{8,}$/.test(base)) return true;
  return false;
}
function cleanTitle(title, site) {
  let t = String(title || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  // "Photo by X on Instagram" keeps its words; a trailing " - Site" / " | Site" / " • Site" is dropped.
  t = t.replace(new RegExp('\\s*[-|\\u2022\\u2013\\u2014:]\\s*' + site.replace(/[^a-z0-9]/gi, '.') + '[^-|\\u2022]*$', 'i'), '');
  return t.slice(0, 70).trim();
}
function safeName(s) {
  return String(s).replace(/[\\/<>:"|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').replace(/^\.+/, '').replace(/[. ]+$/, '').trim();
}
// -> the new file name, or null when the file should keep its own.
function mediaName({ filename, url, pageUrl, pageTitle, date = new Date() }) {
  const name = String(filename || '');
  const ext = path.extname(name).replace(/^\./, '').toLowerCase();
  if (!MEDIA_EXT.has(ext)) return null;
  const base = path.basename(name, path.extname(name));
  if (!looksMachineMade(base)) return null;
  const site = siteWord(hostOf(pageUrl) || hostOf(url));
  const title = cleanTitle(pageTitle, site);
  const tail = base.replace(/[^a-z0-9]/gi, '').slice(-6).toLowerCase();
  // With no page title the date and the end of the old name keep two files from one site apart.
  const stem = title ? [site, title, stamp(date)].join(' - ') : [site, stamp(date), tail].join(' - ');
  const out = safeName(stem).slice(0, 120).trim();
  return out ? out + '.' + ext : null;
}

// ---- T3-032: release assets -------------------------------------------------------------------
const RELEASE_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/releases\/download\/([^/?#]+)\/([^/?#]+)/i;
// The first address in the chain that is a GitHub release asset, or null.
function releaseOf(chain) {
  for (const u of Array.isArray(chain) ? chain : [chain]) {
    const m = RELEASE_RE.exec(String(u || ''));
    if (m) return { owner: m[1], repo: m[2], tag: decodeURIComponent(m[3]), asset: decodeURIComponent(m[4]) };
  }
  return null;
}
const INSTALLER_EXT = new Set(['exe', 'msi', 'msix', 'appx', 'dmg', 'pkg', 'deb', 'rpm', 'appimage']);

// SHA-256, streamed, so a 4 GB installer does not become 4 GB of memory.
function streamHash(fs, filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => h.update(chunk));
    stream.on('end', () => resolve(h.digest('hex')));
  });
}

function createReleaseDesk({ fs, file, hashFile = (p) => streamHash(fs, p), now = () => Date.now(), write }) {
  let list = null;
  const key = (p) => path.resolve(p).toLowerCase();
  function load() {
    if (list) return list;
    try {
      if (fs.existsSync(file)) {
        const v = JSON.parse(fs.readFileSync(file, 'utf8'));
        list = Array.isArray(v) ? v.filter(r => r && typeof r.path === 'string' && r.owner && r.repo) : [];
      } else list = [];
    } catch (err) { throw new Error('The list of release downloads could not be read: ' + err.message, { cause: err }); }
    return list;
  }
  function save() {
    const bytes = JSON.stringify(list);
    // `write` is file-store's atomicWrite when given (a promise); a plain write otherwise.
    if (typeof write === 'function') return write(file, bytes);
    fs.writeFileSync(file, bytes);
    return Promise.resolve();
  }
  // Remember that this finished file was a release asset. A private tab's download is never passed in.
  function note(p, rel) {
    load();
    list = [{ path: p, key: key(p), ...rel, at: now() }, ...list.filter(r => r.key !== key(p))].slice(0, 300);
    return save();
  }
  function recordOf(p) { return load().find(r => r.key === key(p)) || null; }

  // -> { release, name, sizeBytes, sha256, virusTotal, older: [{ path, name, sizeBytes, modified, tag }] }
  async function assist(p) {
    const rec = recordOf(p);
    if (!rec) throw new Error('That file was not a GitHub release download');
    let st;
    try { st = fs.statSync(p); } catch (err) { throw new Error('That file is not there any more', { cause: err }); }
    const sha256 = await hashFile(p);
    const older = load()
      .filter(r => r.key !== rec.key && r.owner.toLowerCase() === rec.owner.toLowerCase() && r.repo.toLowerCase() === rec.repo.toLowerCase()
        && INSTALLER_EXT.has(path.extname(r.path).replace(/^\./, '').toLowerCase()) && r.at <= rec.at)
      .map(r => { try { const s = fs.statSync(r.path); return s.isFile() ? { path: r.path, name: path.basename(r.path), sizeBytes: s.size, modified: s.mtimeMs, tag: r.tag } : null; } catch { return null; } })
      .filter(Boolean)
      .slice(0, 10);
    return {
      release: { owner: rec.owner, repo: rec.repo, tag: rec.tag, asset: rec.asset },
      name: path.basename(p), sizeBytes: st.size, sha256,
      // The hash only: VirusTotal's page for a file somebody has already scanned. Nothing is uploaded.
      virusTotal: 'https://www.virustotal.com/gui/file/' + sha256,
      older: INSTALLER_EXT.has(path.extname(p).replace(/^\./, '').toLowerCase()) ? older : [],
    };
  }
  return { note, assist, recordOf };
}

// ---- T3-073: the mod desk -----------------------------------------------------------------------
const MAX_JAR_BYTES = 200 * 1024 * 1024;
const MAX_META_BYTES = 512 * 1024;
const LOADER_NAME = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };

function versionParts(v) { return String(v == null ? '' : v).replace(/^v/i, '').split(/[^0-9]+/).filter(Boolean).map(n => parseInt(n, 10)); }
function compareVersions(a, b) {
  const x = versionParts(a), y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
// The first game version in a text like ">=1.20.1 <1.21", "1.20.x", ["~1.20"] or "[1.20.1,1.21)".
function gameVersionIn(text) {
  const m = /(?<![0-9.])1\.(?:[7-9]|1\d|2[0-6])(?:\.\d{1,2})?(?!\d)/.exec(Array.isArray(text) ? text.join(' ') : String(text == null ? '' : text));
  return m ? m[0] : '';
}
// Modrinth names files like "sodium-fabric-0.5.8+mc1.20.4.jar" or "Lithium-1.20.1-forge-0.11.jar".
function hintsFromName(name) {
  const base = name.replace(/\.jar$/i, '');
  const lower = base.toLowerCase();
  const loader = ['neoforge', 'fabric', 'quilt', 'forge'].find(l => new RegExp('(^|[^a-z])' + l + '([^a-z]|$)').test(lower)) || '';
  return { loader, mc: gameVersionIn(base) };
}
function tomlFirst(text, field) {
  const m = new RegExp('^\\s*' + field + '\\s*=\\s*["\\\']([^"\\\']*)["\\\']', 'm').exec(text);
  return m ? m[1] : '';
}
// -> { loader, mc, modId, version, from } from the entries of an opened zip, or null when it is no mod.
function readModMeta(zip, name) {
  const read = (entryName) => {
    const e = zip.getEntry(entryName);
    if (!e || e.isDirectory) return null;
    if (e.header.size > MAX_META_BYTES) throw new Error(entryName + ' is unexpectedly large');
    return e.getData().toString('utf8');
  };
  const hint = hintsFromName(name);
  let text;
  if ((text = read('fabric.mod.json')) != null) {
    let j; try { j = JSON.parse(text); } catch (err) { throw new Error('fabric.mod.json is not valid JSON', { cause: err }); }
    return { loader: 'fabric', mc: gameVersionIn(j.depends && j.depends.minecraft) || hint.mc, modId: String(j.id || ''), version: String(j.version || ''), from: 'fabric.mod.json' };
  }
  if ((text = read('quilt.mod.json')) != null) {
    let j; try { j = JSON.parse(text); } catch (err) { throw new Error('quilt.mod.json is not valid JSON', { cause: err }); }
    const q = j.quilt_loader || {};
    const dep = Array.isArray(q.depends) ? q.depends.find(d => d && (d.id === 'minecraft')) : null;
    return { loader: 'quilt', mc: gameVersionIn(dep && dep.versions) || hint.mc, modId: String(q.id || ''), version: String(q.version || ''), from: 'quilt.mod.json' };
  }
  for (const [entry, loader] of [['META-INF/neoforge.mods.toml', 'neoforge'], ['META-INF/mods.toml', hint.loader === 'neoforge' ? 'neoforge' : 'forge']]) {
    if ((text = read(entry)) == null) continue;
    const modId = tomlFirst(text, 'modId');
    let mc = '';
    // The blocks are cut at each "[[" header, because a version range itself holds a "[".
    const dep = text.split(/^\s*\[\[/m).find(b => /^dependencies\./.test(b) && /modId\s*=\s*["']minecraft["']/i.test(b));
    if (dep) mc = gameVersionIn(tomlFirst(dep, 'versionRange'));
    // A placeholder like jarVersion in braces is filled in by the build tool; left as it is it says nothing.
    const rawVersion = tomlFirst(text, 'version');
    return { loader, mc: mc || hint.mc, modId, version: /\$\{/.test(rawVersion) ? '' : rawVersion, from: entry };
  }
  return null;
}

// motw (mark-of-the-web.js, T3-111): when given, each move is wrapped like the downloads tidy-up does, so a jar's
// "downloaded from the internet" mark is checked across the move; one that could not be kept is counted in `markLost`.
function createModDesk({ fs, logFile, openZip, validateZip, motw, now = () => Date.now() }) {
  const plans = new Map();
  const ROOT = 'Minecraft mods';
  const rename = (from, to, lost) => {
    if (!motw) { fs.renameSync(from, to); return; }
    const r = motw.move(from, to, () => fs.renameSync(from, to));
    if (r.carried && !r.kept && !r.restored) lost.push(path.basename(to));
  };

  function readLog() {
    try {
      if (!fs.existsSync(logFile)) return [];
      const v = JSON.parse(fs.readFileSync(logFile, 'utf8'));
      return Array.isArray(v) ? v : [];
    } catch (err) { throw new Error('The mod desk log could not be read: ' + err.message, { cause: err }); }
  }
  function writeLog(entries) {
    const tmp = logFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(entries.slice(-50), null, 1));
    fs.renameSync(tmp, logFile);
  }
  const unique = (target) => {
    if (!fs.existsSync(target)) return target;
    const ext = path.extname(target), base = target.slice(0, target.length - ext.length);
    for (let i = 1; i < 1000; i++) { const c = `${base} (${i})${ext}`; if (!fs.existsSync(c)) return c; }
    throw new Error('Too many files share the name ' + path.basename(target));
  };
  const folderName = (m) => (LOADER_NAME[m.loader] || m.loader) + ' ' + (m.mc || 'unknown version');

  // What would move. Nothing is changed.
  function plan(dir) {
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('The downloads folder is not a full path');
    if (!fs.statSync(dir).isDirectory()) throw new Error('The downloads folder is not a folder');
    const found = [];
    const skipped = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isFile() || !/\.jar$/i.test(ent.name) || ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      const st = fs.statSync(full);
      if (st.size > MAX_JAR_BYTES) { skipped.push({ name: ent.name, why: 'larger than ' + Math.round(MAX_JAR_BYTES / 1048576) + ' MB: not read' }); continue; }
      let meta;
      try {
        const zip = openZip(full);
        validateZip(zip);
        meta = readModMeta(zip, ent.name);
      } catch (err) { skipped.push({ name: ent.name, why: 'could not be read: ' + err.message }); continue; }
      if (!meta || !meta.loader) { skipped.push({ name: ent.name, why: 'no Minecraft mod information inside' }); continue; }
      // The metadata's own `from` is the file inside the jar it was read from; the file's path must win.
      found.push({ ...meta, name: ent.name, from: full, size: st.size, modified: st.mtimeMs });
    }
    // The same mod (id + loader + game version) more than once: the highest version stays, the rest are older.
    const groups = new Map();
    for (const m of found) {
      if (!m.modId) continue;
      const k = [m.modId, m.loader, m.mc].join('|');
      (groups.get(k) || groups.set(k, []).get(k)).push(m);
    }
    for (const g of groups.values()) {
      g.sort((a, b) => compareVersions(b.version, a.version) || b.modified - a.modified);
      g.slice(1).forEach(m => { m.older = true; m.newer = g[0].name; });
    }
    const moves = found.map(m => {
      const folder = path.join(ROOT, folderName(m), m.older ? 'Older versions' : '');
      return { name: m.name, from: m.from, folder, to: path.join(dir, folder, m.name), loader: m.loader, mc: m.mc, modId: m.modId, version: m.version, size: m.size, older: !!m.older, newer: m.newer || '' };
    });
    const id = crypto.randomBytes(8).toString('hex');
    plans.set(id, { dir: path.resolve(dir), moves });
    if (plans.size > 5) plans.delete(plans.keys().next().value);
    return {
      id, dir,
      moves: moves.map(m => ({ name: m.name, folder: m.folder.split(path.sep).join('/'), loader: m.loader, mc: m.mc, modId: m.modId, version: m.version, size: m.size, older: m.older, newer: m.newer, unknownVersion: !m.mc })),
      skipped,
    };
  }

  function apply(planId) {
    const p = plans.get(planId);
    if (!p) throw new Error('That preview has expired. Preview again.');
    plans.delete(planId);
    const batch = { id: crypto.randomBytes(8).toString('hex'), at: now(), dir: p.dir, moves: [], undoneAt: null, pending: true };
    const failed = [];
    const markLost = [];
    const log = readLog();
    log.push(batch);
    writeLog(log);
    const created = new Set();
    const mk = (d) => { if (!fs.existsSync(d)) { fs.mkdirSync(d); created.add(d); } };
    for (const m of p.moves) {
      try {
        if (path.dirname(m.from) !== p.dir) throw new Error('not directly in the folder');
        const st = fs.lstatSync(m.from);
        if (!st.isFile()) throw new Error('no longer a plain file');
        const destDir = path.dirname(m.to);
        if (!destDir.startsWith(p.dir + path.sep)) throw new Error('destination outside the folder');
        // The folders below the downloads folder, one level at a time.
        let cur = p.dir;
        for (const part of path.relative(p.dir, destDir).split(path.sep)) { cur = path.join(cur, part); mk(cur); }
        const to = unique(m.to);
        rename(m.from, to, markLost);
        batch.moves.push({ from: m.from, to });
      } catch (err) { failed.push({ name: m.name, error: err.message }); }
    }
    batch.pending = false;
    batch.created = [...created];
    writeLog(log);
    return { id: batch.id, moved: batch.moves.length, failed, markLost };
  }

  function history() {
    return readLog().map(b => ({ id: b.id, at: b.at, dir: b.dir, count: Array.isArray(b.moves) ? b.moves.length : 0, undone: !!b.undoneAt }));
  }

  function undo(batchId) {
    const log = readLog();
    const batch = batchId ? log.find(b => b.id === batchId) : [...log].reverse().find(b => !b.undoneAt && b.moves && b.moves.length);
    if (!batch) throw new Error('There is nothing to undo');
    if (batch.undoneAt) throw new Error('That mod desk batch was already undone');
    const restored = [], left = [], markLost = [];
    for (const m of [...batch.moves].reverse()) {
      try {
        if (path.dirname(m.from) !== batch.dir || !String(m.to).startsWith(batch.dir + path.sep)) throw new Error('not a place this batch used');
        if (!fs.existsSync(m.to)) throw new Error('the file is no longer there');
        if (fs.existsSync(m.from)) throw new Error('a file with the old name is there now');
        rename(m.to, m.from, markLost);
        restored.push(m.from);
      } catch (err) { left.push({ name: path.basename(m.to), error: err.message }); }
    }
    for (const d of [...(batch.created || [])].sort((x, y) => y.length - x.length)) {
      if (!d.startsWith(batch.dir + path.sep)) continue;
      try { fs.rmdirSync(d); } catch { /* vex-allow-empty-catch: rmdir refuses a folder that is not empty, which is the point */ }
    }
    if (!left.length) batch.undoneAt = now();
    else batch.moves = batch.moves.filter(m => left.some(l => l.name === path.basename(m.to)));
    writeLog(log);
    return { id: batch.id, restored: restored.length, left, markLost };
  }

  return { plan, apply, undo, history };
}

module.exports = { mediaName, looksMachineMade, releaseOf, createReleaseDesk, createModDesk, readModMeta, hintsFromName, compareVersions, gameVersionIn, INSTALLER_EXT, MEDIA_EXT };
