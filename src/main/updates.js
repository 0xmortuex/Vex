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
// Smaller updates (src/main/differential.js): the installer that installed
// the running version is kept in userData/updates as Vex-Setup-<version>.exe.
// When it is there, the download first fetches the blockmaps of both versions,
// copies every block the new installer shares with it, and downloads only the
// rest with HTTP Range requests. The assembled file must pass the same sha512
// and size check; if anything about that path fails (no blockmap, a server
// that ignores Range, a mismatch) it is logged and the whole installer is
// downloaded instead, once.
//
// TEST-ONLY: VEX_UPDATE_FEED=http://127.0.0.1:<port>/ replaces the GitHub
// release with a local folder (latest.yml, the installer, CHANGELOG.md). It is
// honoured only when set, and only for a loopback http address. Under it the
// installer may be a .cmd stand-in, started through cmd.exe, so the install
// step can be tested without running a real installer.
const crypto = require('crypto');
const nodePath = require('path');
const { parseBlockMap, planDownload } = require('./differential');

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
      blockmap: (version, name) => `${REPO}/releases/download/v${version}/${encodeURIComponent(name)}.blockmap`,
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
    // Blockmaps of two versions sit side by side: v<version>/<name>.blockmap.
    blockmap: (version, name) => raw + 'v' + encodeURIComponent(version) + '/' + encodeURIComponent(name) + '.blockmap',
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

  async function readBytes(url, { maxBytes, timeoutMs, signal }) {
    if (signal && signal.aborted) throw signal.reason;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);
    const stop = () => controller.abort(signal.reason);
    if (signal) signal.addEventListener('abort', stop, { once: true });
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: 'follow', cache: 'no-store', headers: { 'User-Agent': 'Vex/' + currentVersion } });
      if (!res.ok) return { status: res.status, buf: null };
      const length = Number(res.headers.get('content-length'));
      if (length > maxBytes) throw new UpdateError('feed', 'The update server sent far more than expected.');
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > maxBytes) throw new UpdateError('feed', 'The update server sent far more than expected.');
      return { status: res.status, buf };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', stop);
    }
  }
  async function readText(url, options) {
    const { status, buf } = await readBytes(url, options);
    return { status, text: buf ? buf.toString('utf8') : null };
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
  // The installer of the running version stays: it is what the next update's
  // smaller download copies from (about the size of one installer on disk).
  // So does a verified download waiting to be installed (the cover may be
  // asking what to do about a backup that failed).
  function cleanup({ keep } = {}) {
    let names;
    try { names = fs.readdirSync(dir); } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
    const base = new Set([`Vex-Setup-${currentVersion}.exe`, `Vex-Setup-${currentVersion}.cmd`]);
    const removed = [];
    for (const name of names) {
      const file = nodePath.join(dir, name);
      if ((keep && file === keep) || base.has(name) || (verified && file === verified.file)) continue;
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

  // The installer that installed the running version, if it was kept (see
  // cleanup): what a smaller download copies unchanged blocks from.
  function baseInstaller(name) {
    const file = paths(currentVersion, name).final;
    try {
      const st = fs.statSync(file);
      return st.isFile() && st.size > 0 ? { file, size: st.size } : null;
    } catch (err) {
      if (err.code !== 'ENOENT') log.warn('[Updates] the kept installer could not be read, so the whole update is downloaded:', err.message);
      return null;
    }
  }

  const request = (url, signal, headers = {}) =>
    fetch(url, { signal, redirect: 'follow', cache: 'no-store', headers: { 'User-Agent': 'Vex/' + currentVersion, ...headers } });

  // GitHub answers with a redirect to its file storage; net.fetch follows
  // it. Wherever it ends, it must still be HTTPS (the checksum is what
  // proves the bytes, but a plain-HTTP hop has no business in it).
  function checkRedirect(f, res) {
    if (!f.test && res.url && !/^https:\/\//i.test(res.url)) throw new UpdateError('network', 'The download was redirected to an insecure address, so Vex stopped it.');
  }

  // A version's blockmap, or null when that release has none (said in the log).
  async function blockmapOf(f, version, name, signal) {
    const url = f.blockmap(version, name);
    const { status, buf } = await readBytes(url, { maxBytes: 16 * 1024 * 1024, timeoutMs: 30000, signal });
    if (!buf) { log.warn(`[Updates] no blockmap for ${version} (HTTP ${status}), so the whole installer is downloaded`); return null; }
    return parseBlockMap(buf);
  }

  // The smaller download. Returns true with a verified file at `part`, false
  // when this update cannot be made smaller (said in the log); any other
  // failure throws, and download() falls back to the whole installer.
  async function differential({ f, version, file, url, base, part, job, onProgress }) {
    const [newMap, oldMap] = await Promise.all([
      blockmapOf(f, version, file.url, job.signal),
      blockmapOf(f, currentVersion, file.url, job.signal),
    ]);
    if (!newMap || !oldMap) return false;
    if (newMap.offset + newMap.total !== file.size) throw new Error('the new blockmap does not describe an installer of the size the release gives');
    if (oldMap.offset + oldMap.total !== base.size) throw new Error(`the kept ${nodePath.basename(base.file)} is not the installer its release's blockmap describes`);
    const plan = planDownload(oldMap, newMap);
    const ranges = plan.steps.filter(s => s.kind === 'download').length;
    if (plan.downloadBytes > file.size * 0.9 || ranges > 2000) {
      log.log(`[Updates] ${mb(plan.downloadBytes)} of ${mb(file.size)} changed in ${ranges} places, so the whole installer is downloaded`);
      return false;
    }
    log.log(`[Updates] smaller download: ${mb(plan.downloadBytes)} of ${mb(file.size)} in ${ranges} range request(s); ${mb(plan.copyBytes)} reused from ${nodePath.basename(base.file)}`);
    const total = plan.downloadBytes;
    let received = 0, lastSent = 0;
    const progress = (force) => {
      if (!force && now() - lastSent < PROGRESS_EVERY_MS) return;
      lastSent = now();
      onProgress({ received, total, percent: total ? Math.floor(received / total * 100) : 100, full: file.size, reused: plan.copyBytes });
    };
    progress(true);
    const out = await fs.promises.open(part, 'w');
    const old = await fs.promises.open(base.file, 'r');
    try {
      // Reused blocks first: local, quick, and a broken base shows at once.
      const piece = Buffer.allocUnsafe(1024 * 1024);
      for (const step of plan.steps) {
        if (step.kind !== 'copy') continue;
        for (let at = 0; at < step.end - step.start;) {
          if (job.signal.aborted) throw job.signal.reason;
          const want = Math.min(piece.length, step.end - step.start - at);
          const { bytesRead } = await old.read(piece, 0, want, step.from + at);
          if (bytesRead !== want) throw new Error(`the kept installer ended early at byte ${step.from + at + bytesRead}`);
          await out.write(piece, 0, want, step.start + at);
          at += want;
        }
        job.stall();
      }
      for (const step of plan.steps) {
        if (step.kind !== 'download') continue;
        const length = step.end - step.start;
        let res;
        try { res = await request(url, job.signal, { Range: `bytes=${step.start}-${step.end - 1}` }); }
        catch (err) { throw job.signal.aborted ? job.signal.reason : plainNetworkError(err); }
        if (!res.ok) throw new Error(`the update server answered a range request with HTTP ${res.status}`);
        checkRedirect(f, res);
        if (res.status !== 206) {
          if (res.body) await res.body.cancel().catch(err => log.warn('[Updates] the ignored range response did not close:', err.message));
          throw new Error(`the update server ignored the Range request (HTTP ${res.status} instead of 206)`);
        }
        const m = String(res.headers.get('content-range') || '').match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/);
        if (!m || Number(m[1]) !== step.start || Number(m[2]) !== step.end - 1 || (m[3] !== '*' && Number(m[3]) !== file.size)) {
          if (res.body) await res.body.cancel().catch(err => log.warn('[Updates] the wrong range response did not close:', err.message));
          throw new Error(`the update server sent a different range (${res.headers.get('content-range') || 'none'}) than asked for (bytes ${step.start}-${step.end - 1})`);
        }
        if (!res.body) throw new Error('the update server sent an empty range');
        const reader = res.body.getReader();
        let got = 0;
        try {
          for (;;) {
            let chunk;
            try { chunk = await Promise.race([reader.read(), job.aborted]); }
            catch (err) { throw err instanceof UpdateError ? err : (job.signal.aborted ? job.signal.reason : plainNetworkError(err)); }
            if (chunk.done) break;
            job.stall();
            if (got + chunk.value.byteLength > length) throw new Error('the update server sent more than the range asked for');
            await out.write(chunk.value, 0, chunk.value.byteLength, step.start + got);
            got += chunk.value.byteLength;
            received += chunk.value.byteLength;
            progress(false);
          }
        } catch (err) {
          reader.cancel().catch(cancelErr => log.warn('[Updates] a range stream did not close:', cancelErr.message));
          throw err;
        }
        if (got !== length) throw new Error(`a range came back short (${got} of ${length} bytes)`);
      }
    } finally {
      await old.close();
      await out.close();
    }
    progress(true);
    onProgress({ received, total, percent: 100, full: file.size, reused: plan.copyBytes, verifying: true });
    const got = await hashFile(part);
    if (got.size !== file.size || got.sha512 !== file.sha512) throw new Error('the assembled installer did not match the checksum its release gives');
    log.log(`[Updates] smaller download verified: ${mb(received)} downloaded, ${mb(plan.copyBytes)} reused`);
    return true;
  }

  // The whole installer, streamed and hashed on the way.
  async function fullDownload({ f, version, file, url, part, job, onProgress }) {
    let res;
    try { res = await request(url, job.signal); }
    catch (err) { throw job.signal.aborted ? job.signal.reason : plainNetworkError(err); }
    if (!res.ok) {
      throw new UpdateError('http', res.status === 404
        ? `The installer for Vex ${version} is not on its release page (404). Try again later, or get it from the Vex releases page.`
        : `The update server answered with an error (HTTP ${res.status}). Try again later.`);
    }
    checkRedirect(f, res);
    const declared = Number(res.headers.get('content-length'));
    if (declared && declared !== file.size) {
      throw new UpdateError('size', `The download is not the size the release says (${sizes(declared, file.size).join(' instead of ')}), so Vex did not download it. Try again later.`);
    }
    if (!res.body) throw new UpdateError('network', 'The update server sent nothing.');
    const out = fs.createWriteStream(part, { flags: 'w' });
    job.out = out;
    const outError = new Promise((_, reject) => out.on('error', err => reject(new UpdateError('disk', 'Vex could not save the download: ' + err.message))));
    outError.catch(() => {});
    const hash = crypto.createHash('sha512');
    const reader = res.body.getReader();
    job.reader = reader;
    let received = 0, lastSent = 0;
    onProgress({ received: 0, total: file.size, percent: 0 });
    for (;;) {
      let chunk;
      try { chunk = await Promise.race([reader.read(), job.aborted, outError]); }
      catch (err) { throw err instanceof UpdateError ? err : (job.signal.aborted ? job.signal.reason : plainNetworkError(err)); }
      if (chunk.done) break;
      job.stall();
      received += chunk.value.byteLength;
      if (received > file.size) throw new UpdateError('size', `The download is bigger than the release says (${mb(file.size)}), so Vex stopped it and deleted it. Try again later.`);
      hash.update(chunk.value);
      if (!out.write(chunk.value)) await Promise.race([new Promise(r => out.once('drain', r)), job.aborted, outError]);
      if (now() - lastSent >= PROGRESS_EVERY_MS) { lastSent = now(); onProgress({ received, total: file.size, percent: Math.floor(received / file.size * 100) }); }
    }
    job.reader = null;
    await Promise.race([new Promise((resolve, reject) => out.end(err => (err ? reject(err) : resolve()))), outError]);
    job.out = null;
    onProgress({ received, total: file.size, percent: 100, verifying: true });
    if (received !== file.size) throw new UpdateError('size', `The download is smaller than the release says (${sizes(received, file.size).join(' of ')}), so Vex deleted it and did not install it. Try again.`);
    if (hash.digest('base64') !== file.sha512) throw new UpdateError('checksum', 'The download did not match the checksum its release gives, so Vex deleted it and did not install it. It may have been damaged on the way. Try again.');
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
    let stallTimer = null;
    const job = {
      signal: controller.signal,
      aborted: new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })),
      stall() { clearTimeout(stallTimer); stallTimer = setTimeout(() => controller.abort(new UpdateError('stalled', 'The download stopped: nothing arrived for a minute. Try again.')), STALL_MS); },
      reader: null, out: null,
    };
    job.aborted.catch(() => {});
    const removePart = () => {
      try { fs.rmSync(part, { force: true }); }
      catch (rmErr) { log.warn('[Updates] could not delete', part + ':', rmErr.message); }
    };
    try {
      fs.mkdirSync(dir, { recursive: true });
      cleanup();
      job.stall();
      const base = baseInstaller(file.url);
      let done = false;
      if (base) {
        try { done = await differential({ f, version, file, url, base, part, job, onProgress }); }
        catch (err) {
          if (controller.signal.aborted) throw controller.signal.reason;
          log.warn('[Updates] the smaller download did not work, so the whole installer is downloaded:', err.message);
          removePart();
        }
      } else {
        log.log(`[Updates] no installer of ${currentVersion} kept, so the whole installer is downloaded`);
      }
      if (!done) await fullDownload({ f, version, file, url, part, job, onProgress });
      clearTimeout(stallTimer);
      fs.renameSync(part, final);
      verified = { version, file: final, sha512: file.sha512, size: file.size };
      state.result = 'downloaded'; state.version = version; state.error = null;
      return { ok: true, version, size: file.size };
    } catch (err) {
      clearTimeout(stallTimer);
      if (job.reader) job.reader.cancel().catch(cancelErr => log.warn('[Updates] the download stream did not close:', cancelErr.message));
      const out = job.out;
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
