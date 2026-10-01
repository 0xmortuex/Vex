// Vex's own updater, behind the full-screen update cover (js/update-notifier.js).
//
// It does NOT use electron-updater. That path could crash machines missing
// the MSVC runtime (its native helpers), and with publisherName set in
// package.json it refused every update of the unsigned installer. This one
// is three plain steps:
//   1. check:    fetch latest.yml from the newest GitHub release and compare
//                versions (an HTTPS GET and a string compare);
//   2. download: stream that release's Vex-Setup.exe into userData/updates,
//                hashing it on the way, and keep it only when its size and
//                sha512 are exactly the ones latest.yml gives (electron-
//                builder's format: files[].sha512 in base64, files[].size);
//   3. install:  hash the file once more, then start it detached with
//                INSTALLER_ARGS once Vex has closed its windows (main.js).
//
// A partial download is written as "<name>.part" and renamed only after it
// has been verified; only a verified file is ever handed to spawn.
//
// TEST-ONLY: VEX_UPDATE_FEED=http://127.0.0.1:<port>/ replaces the GitHub
// release with a local folder (latest.yml, the installer, CHANGELOG.md). It is
// honoured only when set, and only for a loopback http address. Under it the
// installer may be a .cmd stand-in, started through cmd.exe, so the install
// step can be tested without running a real installer.
const crypto = require('crypto');
const nodePath = require('path');

const REPO = 'https://github.com/0xmortuex/Vex';
// electron-builder's NSIS installer (app-builder-lib/templates/nsis):
//   --updated    the same flag electron-updater passes: the installer waits
//                for the running Vex to exit instead of asking, keeps the
//                user's shortcuts, runs the old uninstaller with --updated
//                (app data kept) and starts Vex with --updated;
//   /S           silent: no wizard pages (the per-user install is found from
//                HKCU\Software\<guid>\InstallLocation and upgraded in place);
//   --force-run  start Vex after a silent install (installSection.nsh: an
//                assisted installer runs the app only if isForceRun && Silent).
const INSTALLER_ARGS = Object.freeze(['--updated', '/S', '--force-run']);
const MAX_INSTALLER_BYTES = 600 * 1024 * 1024;
const STALL_MS = 60 * 1000;
const PROGRESS_EVERY_MS = 150;

// The updater's last word, for the Memory panel's Health section.
const state = { lastCheckAt: null, result: null, version: null, error: null };

function cmpVersion(a, b) {
  const pa = String(a).split(/[.\-+]/).map(n => parseInt(n, 10) || 0);
  const pb = String(b).split(/[.\-+]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// The part of YAML electron-builder writes into latest.yml: top-level
// "key: value" lines, a "files:" list of flat maps, and block scalars
// ("releaseNotes: |"). Anything else is ignored.
function parseLatestYml(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = { files: [] };
  const unquote = v => {
    const s = String(v).trim();
    if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
    if (/^".*"$/.test(s)) return s.slice(1, -1);
    return s;
  };
  let section = null, current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (section === 'block') {
      if (!line.trim() || /^\s+/.test(line)) { current.push(line.replace(/^ {2}/, '')); continue; }
      section = null;
    }
    if (!line.trim() || /^\s*#/.test(line)) continue;
    let m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (m) {
      const [, key, value] = m;
      if (key === 'files' && !value) { section = 'files'; current = null; continue; }
      if (value === '|' || value === '>' || value === '|-' || value === '>-') {
        section = 'block'; current = []; out[key] = current; continue;
      }
      section = null; out[key] = unquote(value); continue;
    }
    if (section !== 'files') continue;
    if ((m = line.match(/^\s*-\s+([A-Za-z0-9_]+):\s*(.*)$/))) { current = { [m[1]]: unquote(m[2]) }; out.files.push(current); continue; }
    if (current && (m = line.match(/^\s+([A-Za-z0-9_]+):\s*(.*)$/))) current[m[1]] = unquote(m[2]);
  }
  for (const key of Object.keys(out)) if (Array.isArray(out[key]) && key !== 'files') out[key] = out[key].join('\n').trim();
  return out;
}

// Where updates come from. The real feed is the GitHub release; the installer
// is fetched from the release of that exact version (not "latest", which can
// move on between the check and the download).
function resolveFeed(env = process.env) {
  const raw = env && env.VEX_UPDATE_FEED;
  if (!raw) {
    return {
      test: false,
      latestYml: REPO + '/releases/latest/download/latest.yml',
      installer: (version, name) => `${REPO}/releases/download/v${version}/${encodeURIComponent(name)}`,
      changelog: version => `https://raw.githubusercontent.com/0xmortuex/Vex/v${version}/CHANGELOG.md`,
      page: version => `${REPO}/releases/tag/v${version}`,
    };
  }
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d{1,5})?\/(?:[\w.-]+\/)*$/.test(raw)) {
    throw new Error('VEX_UPDATE_FEED must be a local address ending in "/", such as http://127.0.0.1:17100/');
  }
  return {
    test: true,
    latestYml: raw + 'latest.yml',
    installer: (_version, name) => raw + encodeURIComponent(name),
    changelog: () => raw + 'CHANGELOG.md',
    page: version => `${REPO}/releases/tag/v${version}`,
  };
}

class UpdateError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const mb = n => (n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0) + ' MB');
// Two sizes that must read as different even when they round alike.
const sizes = (a, b) => (mb(a) === mb(b) ? [`${a.toLocaleString('en-US')} bytes`, `${b.toLocaleString('en-US')} bytes`] : [mb(a), mb(b)]);

// A network failure, in words a person can act on.
function plainNetworkError(err) {
  const message = String((err && err.message) || err || '');
  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_NETWORK|ERR_ADDRESS_UNREACHABLE|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|Failed to fetch/i.test(message)) {
    return new UpdateError('offline', 'Vex could not reach the update server. Check your internet connection and try again.');
  }
  if (/ERR_TIMED_OUT|timed out/i.test(message)) return new UpdateError('offline', 'The update server did not answer in time. Try again in a moment.');
  const line = message.split(/\r?\n/)[0].replace(/[A-Za-z]:\\[^\s"',]+/g, '(file)').trim();
  return new UpdateError('network', 'The update could not be downloaded: ' + (line.slice(0, 200) || 'unknown error') + '.');
}

// The installer latest.yml describes: files[] entry named by `path`, else
// the first .exe. Refused unless its sha512 and size are well-formed.
function pickInstaller(yml, { allowScript = false } = {}) {
  const files = Array.isArray(yml.files) ? yml.files : [];
  const extOk = url => /\.exe$/i.test(url) || (allowScript && /\.cmd$/i.test(url));
  const file = files.find(f => f.url && f.url === yml.path && extOk(f.url)) || files.find(f => f.url && extOk(f.url));
  if (!file) throw new UpdateError('feed', 'This release has no Windows installer listed, so Vex cannot update itself. Get it from the Vex releases page.');
  if (/[\\/]|\.\./.test(file.url)) throw new UpdateError('feed', 'The release lists its installer under a name Vex will not use (' + String(file.url).slice(0, 80) + ').');
  const size = Number(file.size);
  if (!/^[A-Za-z0-9+/]{86}==$/.test(String(file.sha512 || ''))) throw new UpdateError('feed', 'The release does not give a valid checksum for its installer, so Vex will not download it.');
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_INSTALLER_BYTES) throw new UpdateError('feed', 'The release gives an impossible size for its installer, so Vex will not download it.');
  return { url: file.url, sha512: file.sha512, size };
}

function createUpdater({ fetch, fs, dir, currentVersion, env = process.env, spawn, log = console, now = () => Date.now(), parseChangelogList, platform = process.platform }) {
  if (typeof fetch !== 'function') throw new Error('createUpdater needs fetch');
  let release = null;       // { version, releasedAt, file, notes } from the last good check
  let active = null;        // { version, controller } while downloading
  let verified = null;      // { version, file, sha512, size } after a verified download

  const feed = () => resolveFeed(env);

  async function readText(url, { maxBytes, timeoutMs }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: 'follow', cache: 'no-store', headers: { 'User-Agent': 'Vex/' + currentVersion } });
      if (!res.ok) return { status: res.status, text: null };
      const length = Number(res.headers.get('content-length'));
      if (length > maxBytes) throw new UpdateError('feed', 'The update server sent far more than expected.');
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > maxBytes) throw new UpdateError('feed', 'The update server sent far more than expected.');
      return { status: res.status, text: buf.toString('utf8') };
    } finally { clearTimeout(timer); }
  }

  async function check() {
    const current = currentVersion;
    let f;
    try { f = feed(); } catch (err) { return { ok: false, current, error: err.message, url: REPO + '/releases' }; }
    const base = { current, url: REPO + '/releases', downloadUrl: REPO + '/releases/latest/download/Vex-Setup.exe' };
    state.lastCheckAt = now();
    try {
      const { status, text } = await readText(f.latestYml, { maxBytes: 256 * 1024, timeoutMs: 20000 });
      if (text == null) throw new UpdateError('http', status === 404 ? 'The update server has no release information yet (404).' : `The update server answered with an error (HTTP ${status}).`);
      const yml = parseLatestYml(text);
      const latest = /^\d+\.\d+\.\d+[0-9A-Za-z.\-+]*$/.test(String(yml.version || '')) ? yml.version : null;
      if (!latest) throw new UpdateError('feed', 'The update server did not say which version is the newest.');
      const releasedAt = Date.parse(String(yml.releaseDate || '')) || null;
      const hasUpdate = cmpVersion(latest, current) > 0;
      let file = null, fileError = null;
      try { file = pickInstaller(yml, { allowScript: f.test }); } catch (err) { fileError = err.message; }
      release = { version: latest, releasedAt, file, fileError, notes: typeof yml.releaseNotes === 'string' ? yml.releaseNotes : '' };
      state.result = hasUpdate ? 'update-available' : 'up-to-date'; state.version = latest; state.error = null;
      return { ...base, ok: true, latest, releasedAt, hasUpdate, size: file ? file.size : null, releaseUrl: f.page(latest),
        downloadUrl: file && !f.test ? f.installer(latest, file.url) : base.downloadUrl };
    } catch (err) {
      const e = err instanceof UpdateError ? err : plainNetworkError(err);
      state.result = 'error'; state.error = e.message;
      return { ...base, ok: false, error: e.message };
    }
  }

  // "What's new" for the cover: every CHANGELOG section after the running
  // version up to the new one (read from the new version's own CHANGELOG),
  // else the release notes latest.yml carries (the GitHub release body).
  async function notes(version) {
    if (!release || release.version !== version) throw new UpdateError('stale', 'Check for updates again: this is not the version Vex last found.');
    const f = feed();
    let changelogError = null;
    try {
      const { text } = await readText(f.changelog(version), { maxBytes: 4 * 1024 * 1024, timeoutMs: 10000 });
      if (text && parseChangelogList) {
        const entries = parseChangelogList(text)
          .filter(e => cmpVersion(e.version.replace(/^v/, ''), currentVersion) > 0 && cmpVersion(e.version.replace(/^v/, ''), version) <= 0)
          .slice(0, 25)
          .map(e => ({ version: e.version, name: e.name, body: String(e.body || '').slice(0, 20000) }));
        if (entries.length) return { source: 'changelog', entries, url: f.page(version) };
      }
    } catch (err) { changelogError = err; }
    if (changelogError) log.warn('[Updates] the new CHANGELOG could not be read:', changelogError.message);
    if (release.notes) return { source: 'release', entries: [{ version: 'v' + version, name: 'v' + version, body: release.notes.slice(0, 20000) }], url: f.page(version) };
    return { source: null, entries: [], url: f.page(version) };
  }

  function paths(version, name) {
    const ext = nodePath.extname(name).toLowerCase();
    const final = nodePath.join(dir, `Vex-Setup-${version}${ext}`);
    return { final, part: final + '.part' };
  }

  // Old installers and interrupted downloads. A file that cannot go (an
  // installer that is still running holds its .exe open) is said, not hidden.
  function cleanup({ keep } = {}) {
    let names;
    try { names = fs.readdirSync(dir); } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
    const removed = [];
    for (const name of names) {
      const file = nodePath.join(dir, name);
      if (keep && file === keep) continue;
      try { fs.rmSync(file, { force: true, recursive: true }); removed.push(name); }
      catch (err) { log.warn('[Updates] could not delete', name + ':', err.message); }
    }
    return removed;
  }

  function hashFile(file) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha512');
      let size = 0;
      fs.createReadStream(file)
        .on('data', chunk => { size += chunk.length; hash.update(chunk); })
        .on('error', reject)
        .on('end', () => resolve({ sha512: hash.digest('base64'), size }));
    });
  }

  async function download(version, onProgress = () => {}) {
    if (active) throw new UpdateError('busy', 'The update is already downloading.');
    if (!release || release.version !== version) throw new UpdateError('stale', 'Check for updates again: this is not the version Vex last found.');
    if (cmpVersion(version, currentVersion) <= 0) throw new UpdateError('stale', 'Vex ' + currentVersion + ' is already this version or newer.');
    if (!release.file) throw new UpdateError('feed', release.fileError || 'This release has no installer Vex can use.');
    const f = feed();
    const file = release.file;
    const url = f.installer(version, file.url);
    const { final, part } = paths(version, file.url);
    const controller = new AbortController();
    active = { version, controller };
    verified = null;
    let out = null, reader = null;
    let stallTimer = null;
    const stall = () => { clearTimeout(stallTimer); stallTimer = setTimeout(() => controller.abort(new UpdateError('stalled', 'The download stopped: nothing arrived for a minute. Try again.')), STALL_MS); };
    try {
      fs.mkdirSync(dir, { recursive: true });
      cleanup();
      stall();
      let res;
      try { res = await fetch(url, { signal: controller.signal, redirect: 'follow', cache: 'no-store', headers: { 'User-Agent': 'Vex/' + currentVersion } }); }
      catch (err) { throw controller.signal.aborted ? controller.signal.reason : plainNetworkError(err); }
      if (!res.ok) {
        throw new UpdateError('http', res.status === 404
          ? `The installer for Vex ${version} is not on its release page (404). Try again later, or get it from the Vex releases page.`
          : `The update server answered with an error (HTTP ${res.status}). Try again later.`);
      }
      // GitHub answers with a redirect to its file storage; net.fetch follows
      // it. Wherever it ends, it must still be HTTPS (the checksum is what
      // proves the bytes, but a plain-HTTP hop has no business in it).
      if (!f.test && res.url && !/^https:\/\//i.test(res.url)) throw new UpdateError('network', 'The download was redirected to an insecure address, so Vex stopped it.');
      const declared = Number(res.headers.get('content-length'));
      if (declared && declared !== file.size) {
        throw new UpdateError('size', `The download is not the size the release says (${sizes(declared, file.size).join(' instead of ')}), so Vex did not download it. Try again later.`);
      }
      if (!res.body) throw new UpdateError('network', 'The update server sent nothing.');
      out = fs.createWriteStream(part, { flags: 'w' });
      const outError = new Promise((_, reject) => out.on('error', err => reject(new UpdateError('disk', 'Vex could not save the download: ' + err.message))));
      outError.catch(() => {});
      const hash = crypto.createHash('sha512');
      reader = res.body.getReader();
      const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }));
      aborted.catch(() => {});
      let received = 0, lastSent = 0;
      onProgress({ received: 0, total: file.size, percent: 0 });
      for (;;) {
        let part_;
        try { part_ = await Promise.race([reader.read(), aborted, outError]); }
        catch (err) { throw err instanceof UpdateError ? err : (controller.signal.aborted ? controller.signal.reason : plainNetworkError(err)); }
        if (part_.done) break;
        stall();
        received += part_.value.byteLength;
        if (received > file.size) throw new UpdateError('size', `The download is bigger than the release says (${mb(file.size)}), so Vex stopped it and deleted it. Try again later.`);
        hash.update(part_.value);
        if (!out.write(part_.value)) await Promise.race([new Promise(r => out.once('drain', r)), aborted, outError]);
        if (now() - lastSent >= PROGRESS_EVERY_MS) { lastSent = now(); onProgress({ received, total: file.size, percent: Math.floor(received / file.size * 100) }); }
      }
      clearTimeout(stallTimer);
      await Promise.race([new Promise((resolve, reject) => out.end(err => (err ? reject(err) : resolve()))), outError]);
      out = null;
      onProgress({ received, total: file.size, percent: 100, verifying: true });
      if (received !== file.size) throw new UpdateError('size', `The download is smaller than the release says (${sizes(received, file.size).join(' of ')}), so Vex deleted it and did not install it. Try again.`);
      if (hash.digest('base64') !== file.sha512) throw new UpdateError('checksum', 'The download did not match the checksum its release gives, so Vex deleted it and did not install it. It may have been damaged on the way. Try again.');
      fs.renameSync(part, final);
      verified = { version, file: final, sha512: file.sha512, size: file.size };
      state.result = 'downloaded'; state.version = version; state.error = null;
      return { ok: true, version, size: file.size };
    } catch (err) {
      clearTimeout(stallTimer);
      if (reader) reader.cancel().catch(cancelErr => log.warn('[Updates] the download stream did not close:', cancelErr.message));
      if (out && !out.closed) { const closed = new Promise(r => out.once('close', r)); out.destroy(); await closed; }
      for (const leftover of [part, final]) {
        try { fs.rmSync(leftover, { force: true }); }
        catch (rmErr) { log.warn('[Updates] could not delete', leftover + ':', rmErr.message); }
      }
      const e = err instanceof UpdateError ? err
        : (err && err.name === 'AbortError') ? new UpdateError('cancelled', 'Download cancelled.')
        : plainNetworkError(err);
      if (e.code !== 'cancelled') { state.result = 'error'; state.error = e.message; }
      return { ok: false, code: e.code, error: e.message };
    } finally {
      active = null;
    }
  }

  function cancel() {
    if (!active) return false;
    active.controller.abort(new UpdateError('cancelled', 'Download cancelled.'));
    return true;
  }

  // Hash the verified file once more right before it runs: nothing that is
  // not exactly the release's installer is ever started.
  async function prepareInstall(version) {
    if (!verified || verified.version !== version) throw new UpdateError('stale', 'Download the update first.');
    if (/\.part$/i.test(verified.file)) throw new UpdateError('stale', 'Download the update first.');
    let got;
    try { got = await hashFile(verified.file); }
    catch (err) { verified = null; throw new UpdateError('disk', 'The downloaded update is gone (' + err.code + '). Download it again.'); }
    if (got.size !== verified.size || got.sha512 !== verified.sha512) {
      const file = verified.file;
      verified = null;
      try { fs.rmSync(file, { force: true }); } catch (err) { log.warn('[Updates] could not delete', file + ':', err.message); }
      throw new UpdateError('checksum', 'The downloaded update changed on disk after it was checked, so Vex deleted it. Download it again.');
    }
    const script = /\.cmd$/i.test(verified.file);
    if (script && !feed().test) throw new UpdateError('feed', 'Vex only runs a real installer.');
    if (!script && platform !== 'win32') throw new UpdateError('feed', 'Updating from inside Vex works on Windows only.');
    return { file: verified.file, args: [...INSTALLER_ARGS], script };
  }

  // Start the installer on its own, so it outlives Vex. Called while Vex is
  // quitting (main.js). A .cmd stand-in (VEX_UPDATE_FEED tests only) is not
  // an executable, so it goes through cmd.exe.
  function launch(plan) {
    const options = { detached: true, stdio: 'ignore', cwd: dir, windowsHide: !!plan.script };
    const child = plan.script
      ? spawn(env.ComSpec || 'cmd.exe', ['/d', '/c', plan.file, ...plan.args], options)
      : spawn(plan.file, plan.args, options);
    child.on('error', err => log.error('[Updates] the installer did not start:', err.message));
    child.unref();
    return child;
  }

  return { check, notes, download, cancel, prepareInstall, launch, cleanup,
    get downloading() { return active ? active.version : null; } };
}

module.exports = { createUpdater, parseLatestYml, pickInstaller, resolveFeed, cmpVersion, state, INSTALLER_ARGS, MAX_INSTALLER_BYTES, UpdateError };
