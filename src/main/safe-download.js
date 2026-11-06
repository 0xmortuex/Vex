// === Safe Download Assistant: the service (settings, the check, Quarantine) ===========
//
// When a download finishes, main/downloads.js asks assess() for a verdict before the window is told the file is done, so the
// green / amber / red mark is already on the row and in the toast when the person first sees the file.
//
//   assess({ path, fileName, url, chain, noClick }) -> verdict (download-verdict.js) | null when the assistant is switched off
//   quarantine(path) -> { path, name }       moves a file Vex downloaded into Vex's own Quarantine folder under a harmless name
//   get() / set(patch)                       the Settings choices, kept in safe-download.json in the profile
//
// Nothing here ever deletes a file, runs one, opens one, or sends anything anywhere. All the lookups are local. A file Vex cannot
// read is reported as "could not be checked" (gray), never as clean.
const path = require('path');
const { judge, cleanSettings, DEFAULT_SETTINGS } = require('./download-verdict');
const { gatherFacts } = require('./download-facts');

function createSafeDownload({ fs, file, quarantineDir, signatureOf, threatCheck = null, lookalikeOf = null, registrable = null, listArchive = null, motw = null, isDownloadedFile, noteFile = () => {}, log = () => {} }) {
  if (!fs || !file || !quarantineDir) throw new Error('createSafeDownload needs fs, file and quarantineDir');
  let settings = cleanSettings(DEFAULT_SETTINGS);
  // A file that cannot be read is said in the log and leaves the defaults: Vex must still start.
  try {
    if (fs.existsSync(file)) settings = cleanSettings(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (err) { console.error('[SafeDownload] could not read the saved choices, using the defaults:', err.message); }

  const write = () => fs.writeFileSync(file, JSON.stringify(settings));
  const get = () => ({ on: settings.on, strictness: settings.strictness, checks: { ...settings.checks }, quarantineDir });
  function set(patch) {
    if (!patch || typeof patch !== 'object') throw new Error('Nothing to change');
    const next = { on: settings.on, strictness: settings.strictness, checks: { ...settings.checks } };
    if ('on' in patch) { if (typeof patch.on !== 'boolean') throw new Error('The assistant is on or off'); next.on = patch.on; }
    if ('strictness' in patch) {
      if (!['relaxed', 'normal', 'strict'].includes(patch.strictness)) throw new Error('Strictness is relaxed, normal or strict');
      next.strictness = patch.strictness;
    }
    if ('checks' in patch) {
      if (!patch.checks || typeof patch.checks !== 'object') throw new Error('Checks must be an object');
      for (const [k, v] of Object.entries(patch.checks)) {
        if (!(k in next.checks)) throw new Error('Unknown check: ' + String(k).slice(0, 30));
        if (typeof v !== 'boolean') throw new Error('Each check is on or off');
        next.checks[k] = v;
      }
    }
    settings = next;
    write();
    return get();
  }

  async function assess({ path: filePath, fileName, url = '', chain = [], noClick = false }) {
    if (!settings.on) return null;
    const facts = await gatherFacts({
      fs, file: filePath, name: fileName,
      source: { url, chain, noClick, threatCheck, lookalikeOf, registrable },
      signatureOf: settings.checks.signature ? signatureOf : null,
      listArchive,
    });
    const verdict = judge(facts, settings);
    log('[SafeDownload] ' + fileName + ': ' + verdict.level + (verdict.reasons.length ? ' (' + verdict.reasons.map(r => r.id).join(', ') + ')' : ''));
    return verdict;
  }

  const root = () => path.resolve(quarantineDir);
  function isQuarantined(p) {
    if (typeof p !== 'string' || !p) return false;
    const rel = path.relative(root(), path.resolve(p));
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  // The new name ends in ".quarantined" so a double-click can never run it, and carries nothing the original name did
  // (control and direction characters are dropped). The "downloaded from the internet" mark moves with the file.
  function quarantine(filePath) {
    if (typeof filePath !== 'string' || !filePath) throw new Error('Quarantine needs a file');
    if (!isDownloadedFile(filePath)) throw new Error('Vex only does this to files it downloaded itself.');
    if (isQuarantined(filePath)) throw new Error('That file is already in quarantine');
    if (!fs.existsSync(filePath)) throw new Error('That file is not there any more');
    fs.mkdirSync(quarantineDir, { recursive: true });
    const base = path.basename(filePath).replace(/[\u0000-\u001f\u202a-\u202e\u2066-\u2069\u200e\u200f<>:"/\\|?*]/g, '_').slice(0, 120) || 'file';
    let dest = path.join(quarantineDir, Date.now().toString(36) + '-' + base + '.quarantined');
    for (let n = 2; fs.existsSync(dest); n++) dest = path.join(quarantineDir, Date.now().toString(36) + '-' + n + '-' + base + '.quarantined');
    const move = () => {
      try { fs.renameSync(filePath, dest); }
      catch (err) {
        if (err.code !== 'EXDEV') throw err;
        fs.copyFileSync(filePath, dest);
        fs.unlinkSync(filePath);
      }
    };
    if (motw) {
      const kept = motw.move(filePath, dest, move);
      if (kept.carried && !kept.kept && !kept.restored) console.error('[SafeDownload] ' + kept.error + ': ' + dest);
    } else move();
    noteFile(dest);
    log('[SafeDownload] quarantined ' + path.basename(filePath));
    return { path: dest, name: path.basename(dest) };
  }

  return { assess, quarantine, isQuarantined, get, set };
}

module.exports = { createSafeDownload };
