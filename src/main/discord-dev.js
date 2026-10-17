// === Vencord dev reload and the console tray of the Discord panel =============
//
// For the owner's own Vencord work (T2-018). Two things, both off until the person uses them:
//
//  1. RELOAD YOUR BUILD. Pick the dist/browser.js of your own local Vencord checkout (file dialog opened by
//     the main process: the path never comes from a window). Vex puts that bundle in place of the bundle of the
//     Vencord extension that is installed for the Discord panel, loads the extension again and reloads the Discord
//     panel, so the loop is: build, press Reload, see it in Discord. The first time, the bundle that was there is
//     kept next to it (name.vex-original) and "Put the original back" restores it.
//
//     Read-only for anything that is not your own local build: the picked file must be named browser.js, sit in a
//     folder called dist whose parent holds a package.json named "vencord" or "equicord" (a source checkout),
//     be a normal file of at most 30 MB that is not inside Vex's own profile folder, and is checked again (and its
//     SHA-256 read) at the moment of every reload. A file that fails is refused with the reason, never loaded.
//     Nothing is downloaded, built or sent.
//
//  2. CONSOLE TRAY. While it is on, the console lines of the Discord panel (message, level, file:line) are kept in
//     memory (at most 300 lines, Vex's own window only, never written to disk) so a plugin's logs and errors can be
//     read next to the editor. Every line is redacted (tokens, e-mail addresses, user names in paths, addresses)
//     BEFORE it is kept. It stops by itself after 30 minutes.
//
// createDiscordDev({ fs, path, crypto, installed, protectedDir, reloadExtension, reloadPanel, panelContents, redact, now })

const MAX_BUNDLE = 30 * 1024 * 1024;
const MAX_LINES = 300;
const TRAY_MS = 30 * 60 * 1000;
const BUNDLES = ['dist/Vencord.js', 'Vencord.js', 'dist/browser.js', 'browser.js'];
const STYLES = { 'dist/Vencord.js': 'dist/Vencord.css', 'Vencord.js': 'Vencord.css', 'dist/browser.js': 'dist/browser.css', 'browser.js': 'browser.css' };
const LEVELS = ['verbose', 'info', 'warning', 'error'];

function createDiscordDev({ fs, path, crypto, installed, protectedDir, reloadExtension, reloadPanel, panelContents, redact, now = () => Date.now() } = {}) {
  if (!fs || !path || !crypto) throw new Error('createDiscordDev needs fs, path and crypto');
  for (const [name, fn] of Object.entries({ installed, reloadExtension, reloadPanel, panelContents, redact })) if (typeof fn !== 'function') throw new Error('createDiscordDev needs ' + name);

  let granted = null;     // { file, bytes, sha256, repo, name, version, at }
  let tray = null;        // { until, lines: [], handlers: Map(contents -> fn), seq }

  const inside = (child, parent) => {
    const rel = path.relative(path.resolve(parent), path.resolve(child));
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  };

  // Judges a picked file. Returns what is known about it, or throws why it is not the owner's own local build.
  function inspect(file) {
    if (typeof file !== 'string' || !file) throw new Error('There is no file');
    let real;
    try { real = fs.realpathSync(file); } catch (err) { throw new Error('That file could not be found: ' + err.message, { cause: err }); }
    if (path.basename(real) !== 'browser.js') throw new Error('Pick the browser.js that "pnpm buildWeb" makes in the dist folder of your Vencord checkout');
    const st = fs.statSync(real);
    if (!st.isFile()) throw new Error('That is not a file');
    if (st.size < 1024 || st.size > MAX_BUNDLE) throw new Error('A Vencord bundle is between 1 KB and ' + (MAX_BUNDLE / 1024 / 1024) + ' MB (this one is ' + st.size + ' bytes)');
    if (protectedDir && (inside(real, protectedDir) || path.resolve(real) === path.resolve(protectedDir))) throw new Error('A file inside Vex\'s own profile folder is not a build of yours');
    const dist = path.dirname(real);
    if (path.basename(dist).toLowerCase() !== 'dist') throw new Error('browser.js must sit in a folder called dist (your own checkout\'s build output)');
    const repo = path.dirname(dist);
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8').replace(/^﻿/, '')); }
    catch (err) { throw new Error('The folder above dist has no readable package.json, so this does not look like a Vencord source checkout', { cause: err }); }
    const pname = String(pkg && pkg.name || '').toLowerCase();
    if (pname !== 'vencord' && pname !== 'equicord') throw new Error('The package.json above dist is named "' + String(pkg && pkg.name).slice(0, 40) + '", not vencord or equicord: that is not your Vencord checkout');
    const bytes = fs.readFileSync(real);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    return { file: real, bytes: bytes.length, sha256, repo, name: pname, version: String(pkg.version || ''), data: bytes, css: path.join(dist, 'browser.css') };
  }

  const strip = (i) => ({ file: i.file, bytes: i.bytes, sha256: i.sha256, repo: i.repo, name: i.name, version: i.version });

  // `file` comes from the main process's file dialog.
  function grant(file) {
    const i = inspect(file);
    granted = { ...strip(i), at: now() };
    return { ...granted };
  }

  // The bundle of the installed Vencord extension: the first of the known places that exists.
  function target() {
    const entry = installed();
    if (!entry || !entry.path) throw new Error('No Vencord build is installed for the Discord panel. Install one first (Settings > Discord)');
    for (const rel of BUNDLES) {
      const f = path.join(entry.path, ...rel.split('/'));
      if (fs.existsSync(f) && fs.statSync(f).isFile()) return { dir: entry.path, folder: entry.folder || path.basename(entry.path), rel, file: f, css: path.join(entry.path, ...STYLES[rel].split('/')) };
    }
    throw new Error('The installed Vencord (' + (entry.folder || entry.path) + ') has none of ' + BUNDLES.join(', ') + ', so Vex does not know which file to replace');
  }

  const original = (t) => t.file + '.vex-original';

  async function reload() {
    if (!granted) throw new Error('Pick your browser.js first');
    // Checked again now: the file may have changed or been swapped since it was picked.
    const i = inspect(granted.file);
    const t = target();
    if (!fs.existsSync(original(t))) fs.copyFileSync(t.file, original(t));
    fs.writeFileSync(t.file, i.data);
    let withStyle = false;
    if (fs.existsSync(i.css) && fs.statSync(i.css).isFile() && fs.statSync(i.css).size <= MAX_BUNDLE) {
      if (fs.existsSync(t.css) && !fs.existsSync(t.css + '.vex-original')) fs.copyFileSync(t.css, t.css + '.vex-original');
      fs.writeFileSync(t.css, fs.readFileSync(i.css));
      withStyle = true;
    }
    granted = { ...strip(i), at: now() };
    await reloadExtension(t.dir);
    const panels = reloadPanel();
    return { ok: true, folder: t.folder, replaced: t.rel, bytes: i.bytes, sha256: i.sha256, styleReplaced: withStyle, panelsReloaded: panels };
  }

  async function restore() {
    const t = target();
    if (!fs.existsSync(original(t))) throw new Error('Vex has not replaced the bundle of ' + t.folder + ', so there is no original to put back');
    fs.copyFileSync(original(t), t.file);
    if (fs.existsSync(t.css + '.vex-original')) fs.copyFileSync(t.css + '.vex-original', t.css);
    await reloadExtension(t.dir);
    return { ok: true, folder: t.folder, panelsReloaded: reloadPanel() };
  }

  function status() {
    let t = null, replaced = false, error = '';
    try { t = target(); replaced = fs.existsSync(original(t)); } catch (err) { error = err.message; }
    return { granted: granted ? { ...granted } : null, installed: t ? { folder: t.folder, bundle: t.rel } : null, replaced, error };
  }

  // ---- console tray ---------------------------------------------------------------------------------
  function levelName(n) { return typeof n === 'string' ? (LEVELS.includes(n) ? n : 'info') : LEVELS[Math.max(0, Math.min(3, Number(n) | 0))]; }

  function record(level, message, line, source) {
    if (!tray) return;
    if (now() >= tray.until) { trayStop(); return; }
    tray.seq += 1;
    tray.lines.push({ n: tray.seq, t: now(), level: levelName(level), text: redact(String(message == null ? '' : message), 600), source: redact(String(source || ''), 160), line: Number(line) || 0 });
    if (tray.lines.length > MAX_LINES) tray.lines.shift();
  }

  function attach() {
    for (const c of panelContents()) {
      if (!c || (typeof c.isDestroyed === 'function' && c.isDestroyed()) || tray.handlers.has(c)) continue;
      // Electron passes an event object with the details in newer versions and positional arguments in older ones.
      const fn = (e, level, message, line, source) => {
        if (e && typeof e.message === 'string') record(e.level, e.message, e.lineNumber, e.sourceId);
        else record(level, message, line, source);
      };
      c.on('console-message', fn);
      tray.handlers.set(c, fn);
    }
  }

  function trayStart() {
    if (tray) trayStop();
    tray = { until: now() + TRAY_MS, lines: [], handlers: new Map(), seq: 0 };
    attach();
    return trayState();
  }
  function trayStop() {
    if (!tray) return { on: false, lines: 0, until: 0, panels: 0 };
    for (const [c, fn] of tray.handlers) { if (!(typeof c.isDestroyed === 'function' && c.isDestroyed())) c.removeListener('console-message', fn); }
    tray = null;
    return trayState();
  }
  function trayState() {
    if (tray && now() >= tray.until) trayStop();
    return tray ? { on: true, lines: tray.lines.length, until: tray.until, panels: tray.handlers.size } : { on: false, lines: 0, until: 0, panels: 0 };
  }
  // A page that opened after the tray was switched on is picked up here, when the tray is read.
  function trayList({ level = 'verbose', since = 0 } = {}) {
    if (!tray) return { state: trayState(), lines: [] };
    if (now() >= tray.until) { trayStop(); return { state: trayState(), lines: [] }; }
    attach();
    const min = Math.max(0, LEVELS.indexOf(levelName(level)));
    return { state: trayState(), lines: tray.lines.filter(l => l.n > since && LEVELS.indexOf(l.level) >= min).map(l => ({ ...l })) };
  }
  function trayClear() { if (tray) tray.lines = []; return trayState(); }

  return { grant, inspect: (f) => strip(inspect(f)), reload, restore, status, trayStart, trayStop, trayList, trayClear, trayState };
}

module.exports = { createDiscordDev, MAX_BUNDLE, MAX_LINES, TRAY_MS, BUNDLES };
