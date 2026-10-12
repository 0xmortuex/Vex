// Vex's own Start menu and desktop shortcuts, pointed back at Vex when the
// file they open is gone.
//
// Found 2026-10-09: the owner's Start menu Vex.lnk opened
// C:\Claude code free\vex\dist-final\win-unpacked\Vex.exe, a build folder long
// deleted, and Windows answered "Problem with Shortcut". electron-builder's
// NSIS installer keeps the shortcuts that are there when it updates, so an
// update never mends one. Worse, after a silent update the installer starts
// Vex THROUGH the Start menu shortcut when one exists (installSection.nsh:
// $launchLink), so a broken one also stops Vex coming back by itself. That is
// why this runs at every start of the installed Vex, not only on the
// --updated run: the --updated run may be exactly the one that never happens.
//
// What it touches, and nothing else:
//   - only a file named exactly Vex.lnk (not "Vex (dev).lnk", not a profile's
//     own shortcut), in the user's Start menu Programs folder or on the Desktop;
//   - only when that shortcut opens a Vex.exe, the file is gone AND so is the
//     folder it was in: a dev or build folder that is still there (being
//     rebuilt, say) is left alone;
//   - it repoints, it never creates and never deletes.
// Packaged Windows builds only.
const nodePath = require('path');

const win = nodePath.win32;
const SHORTCUT_NAME = 'Vex.lnk';

const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

// Which shortcuts need repair. Pure: `found` is what was read from each
// candidate file ({ file, link } with link as shell.readShortcutLink returns
// it), and `exists(path)` says whether a path is there.
function planShortcutRepairs({ found, execPath, exists }) {
  if (typeof exists !== 'function') throw new Error('planShortcutRepairs needs exists()');
  if (!execPath || !same(win.basename(execPath), 'Vex.exe')) return [];
  const plans = [];
  for (const { file, link } of found || []) {
    if (!same(win.basename(file || ''), SHORTCUT_NAME)) continue;
    const target = String((link && link.target) || '');
    // An empty target is a shortcut Windows resolves some other way (an
    // installer-advertised one): not ours to judge.
    if (!target || !win.isAbsolute(target)) continue;
    if (!same(win.basename(target), 'Vex.exe')) continue;
    if (same(target, execPath) || exists(target)) continue;
    if (exists(win.dirname(target))) continue;
    const options = { target: execPath };
    // The icon and working folder usually lived beside the old exe; they go
    // with it when they are gone too.
    const icon = String(link.icon || '');
    if (!icon || !exists(icon)) { options.icon = execPath; options.iconIndex = 0; }
    const cwd = String(link.cwd || '');
    if (cwd && !exists(cwd)) options.cwd = win.dirname(execPath);
    plans.push({ file, from: target, to: execPath, options });
  }
  return plans;
}

// Reads Vex.lnk from each folder, repairs what planShortcutRepairs names, and
// says what it did. Windows calls are injected: shell (Electron's
// readShortcutLink / writeShortcutLink) and fs (existsSync).
function repairShortcuts({ platform = process.platform, packaged, dirs, execPath, shell, fs, log = () => {} }) {
  if (platform !== 'win32') return { skipped: 'not windows', repaired: [] };
  if (!packaged) return { skipped: 'not the installed Vex', repaired: [] };
  if (!shell || typeof shell.readShortcutLink !== 'function' || typeof shell.writeShortcutLink !== 'function') throw new Error('Electron shell shortcut functions are not available');
  if (!fs || typeof fs.existsSync !== 'function') throw new Error('repairShortcuts needs fs.existsSync');
  const found = [];
  const failed = [];
  for (const dir of dirs || []) {
    if (!dir) continue;
    const file = win.join(dir, SHORTCUT_NAME);
    if (!fs.existsSync(file)) continue;
    try { found.push({ file, link: shell.readShortcutLink(file) }); }
    catch (err) { failed.push(file); log(`[Shortcuts] could not read ${file}: ${err.message}`); }
  }
  const plans = planShortcutRepairs({ found, execPath, exists: p => fs.existsSync(p) });
  const repaired = [];
  for (const plan of plans) {
    if (shell.writeShortcutLink(plan.file, 'update', plan.options)) {
      repaired.push(plan);
      log(`[Shortcuts] repaired ${plan.file}: it opened ${plan.from}, which is gone; it now opens ${plan.to}`);
    } else {
      failed.push(plan.file);
      log(`[Shortcuts] could not repair ${plan.file} (it opens ${plan.from}, which is gone): Windows refused the change`);
    }
  }
  return { repaired, failed };
}

module.exports = { planShortcutRepairs, repairShortcuts, SHORTCUT_NAME };
