// === Voice control: the speech engine and the model, downloaded on request ================
//
// Nothing here ships in the installer. When the person turns voice control on and agrees, Vex downloads TWO files:
//
//   1. the engine   whisper.cpp's command-line program for Windows (a 9 MB zip from the project's GitHub release), and
//   2. a model      a quantised multilingual ggml model (base 60 MB, or small 190 MB) from Hugging Face.
//
// Both come from a URL written in THIS file, and both are checked against a SHA-256 written in this file BEFORE they are
// used. A file with the wrong size or the wrong hash is deleted and the download fails out loud; there is no fallback to
// another host, another file, or "use it anyway". Hugging Face's URL names a commit, not a branch, so the same bytes
// are served for ever. The hashes were measured on 2026-11-06 by downloading each file and hashing it (docs/voice-control.md).
//
// Where they live: <profile>/voice/engine/ and <profile>/voice/models/. "Delete voice model" removes them again.
// What this module never touches: audio. It only moves model files; the speech itself never reaches the disk (voice-engine.js).
//
// `fetchImpl` is the app's own fetch (Electron's net.fetch, which follows redirects and goes through the egress ledger),
// so a test can serve the files from a local server. `catalogue` can be replaced for a test; main.js only does that in a
// source run (never in a packaged build).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/';

const ENGINE = Object.freeze({
  id: 'engine',
  label: 'Speech engine (whisper.cpp b5454, Windows 64-bit)',
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip',
  bytes: 8928640,
  sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb',
  hosts: Object.freeze(['github.com', 'githubusercontent.com']),
});

const MODELS = Object.freeze({
  base: Object.freeze({
    id: 'base',
    label: 'Base',
    note: 'Fast. Good English; Turkish is understood but with slips that command matching forgives.',
    file: 'ggml-base-q5_1.bin',
    url: HF + 'ggml-base-q5_1.bin',
    bytes: 59707625,
    sha256: '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898',
    hosts: Object.freeze(['huggingface.co', 'hf.co']),
  }),
  small: Object.freeze({
    id: 'small',
    label: 'Small',
    note: 'About three times slower and clearly better for Turkish.',
    file: 'ggml-small-q5_1.bin',
    url: HF + 'ggml-small-q5_1.bin',
    bytes: 190085487,
    sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
    hosts: Object.freeze(['huggingface.co', 'hf.co']),
  }),
});

// What is taken out of the engine zip: the program and the libraries it loads. Everything else in the zip (test programs,
// other tools, a server) is left in the zip and never written.
const ENGINE_FILES = /^(?:whisper-cli\.exe|whisper\.dll|ggml\.dll|ggml-base\.dll|ggml-cpu-[a-z0-9]+\.dll)$/;
const PROGRESS_EVERY_MS = 150;

function hostAllowed(url, hosts) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  return hosts.some(h => host === h || host.endsWith('.' + h));
}

function createVoiceStore({ dir, fetchImpl, catalogue, fsImpl = fs, now = Date.now } = {}) {
  if (!dir || typeof dir !== 'string') throw new Error('The voice folder is missing');
  if (typeof fetchImpl !== 'function') throw new Error('A fetch function is needed to download the voice files');
  const engineEntry = (catalogue && catalogue.engine) || ENGINE;
  const models = (catalogue && catalogue.models) || MODELS;
  const engineDir = path.join(dir, 'engine');
  const modelDir = path.join(dir, 'models');
  const verified = new Map();            // path -> `${size}:${mtimeMs}` that was hashed OK
  let active = null;                     // { id, controller }

  const modelPath = (id) => {
    if (!Object.prototype.hasOwnProperty.call(models, id)) throw new Error('Unknown voice model: ' + String(id).slice(0, 40));
    return path.join(modelDir, models[id].file);
  };
  const enginePath = () => path.join(engineDir, 'whisper-cli.exe');
  const sizeOf = (p) => { try { return fsImpl.statSync(p).size; } catch (err) { if (err && err.code === 'ENOENT') return -1; throw err; } };

  function status() {
    const out = {
      dir,
      busy: active ? active.id : null,
      engine: { id: engineEntry.id, label: engineEntry.label, bytes: engineEntry.bytes, source: new URL(engineEntry.url).hostname, installed: sizeOf(enginePath()) > 0 && fsImpl.existsSync(path.join(engineDir, 'engine.json')) },
      models: {},
    };
    for (const id of Object.keys(models)) {
      const m = models[id];
      out.models[id] = { id, label: m.label, note: m.note, bytes: m.bytes, source: new URL(m.url).hostname, installed: sizeOf(modelPath(id)) === m.bytes };
    }
    return out;
  }

  // Streams one URL to a ".part" file while hashing it. Returns the path of the finished part file once size and hash match;
  // otherwise deletes it and throws.
  async function fetchPinned(entry, target, onProgress, signal) {
    fsImpl.mkdirSync(path.dirname(target), { recursive: true });
    const part = target + '.part';
    fsImpl.rmSync(part, { force: true });
    const res = await fetchImpl(entry.url, { signal, redirect: 'follow' });
    if (!res || !res.ok) throw new Error('The download server answered ' + (res ? res.status : 'nothing') + '. Nothing was saved.');
    if (res.url && !hostAllowed(res.url, entry.hosts)) throw new Error('The download was sent to an unexpected host (' + new URL(res.url).hostname + '). Nothing was saved.');
    const announced = Number(res.headers && res.headers.get && res.headers.get('content-length'));
    if (Number.isFinite(announced) && announced > 0 && announced !== entry.bytes) throw new Error('The file on the server is ' + announced + ' bytes, not the ' + entry.bytes + ' that were expected. Nothing was saved.');
    if (!res.body || typeof res.body.getReader !== 'function') throw new Error('The download had no body. Nothing was saved.');
    const hash = crypto.createHash('sha256');
    const handle = await fsImpl.promises.open(part, 'w', 0o600);
    let received = 0, lastTick = 0;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (received > entry.bytes) throw new Error('The download is larger than the ' + entry.bytes + ' bytes that were expected. It was stopped and deleted.');
        hash.update(value);
        await handle.write(value);
        const t = now();
        if (onProgress && t - lastTick >= PROGRESS_EVERY_MS) { lastTick = t; onProgress({ id: entry.id, received, total: entry.bytes }); }
      }
    } catch (err) {
      await handle.close();
      fsImpl.rmSync(part, { force: true });
      throw err;
    }
    await handle.close();
    const digest = hash.digest('hex');
    if (received !== entry.bytes) { fsImpl.rmSync(part, { force: true }); throw new Error('The download ended after ' + received + ' of ' + entry.bytes + ' bytes. It was deleted.'); }
    if (digest !== entry.sha256) { fsImpl.rmSync(part, { force: true }); throw new Error('The downloaded file did not match its pinned checksum (SHA-256). It was deleted and not used.'); }
    if (onProgress) onProgress({ id: entry.id, received, total: entry.bytes });
    return part;
  }

  // Takes only the allowed names out of the zip, into a fresh folder, and swaps it in.
  function unpackEngine(zipFile) {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipFile);
    const staging = engineDir + '.new';
    fsImpl.rmSync(staging, { recursive: true, force: true });
    fsImpl.mkdirSync(staging, { recursive: true });
    const written = [];
    for (const e of zip.getEntries()) {
      if (e.isDirectory) continue;
      const name = path.posix.basename(e.entryName.replace(/\\/g, '/'));
      if (!ENGINE_FILES.test(name)) continue;
      const data = e.getData();
      if (data.length > 64 * 1024 * 1024) throw new Error('An entry in the engine zip is unexpectedly large: ' + name);
      fsImpl.writeFileSync(path.join(staging, name), data);
      written.push(name);
    }
    if (!written.includes('whisper-cli.exe') || !written.includes('whisper.dll')) {
      fsImpl.rmSync(staging, { recursive: true, force: true });
      throw new Error('The engine zip does not contain whisper-cli.exe. It was not installed.');
    }
    fsImpl.writeFileSync(path.join(staging, 'engine.json'), JSON.stringify({ sha256: engineEntry.sha256, url: engineEntry.url, files: written.sort(), at: new Date(now()).toISOString() }, null, 2));
    fsImpl.rmSync(engineDir, { recursive: true, force: true });
    fsImpl.renameSync(staging, engineDir);
    return written;
  }

  // download('engine') or download('base' | 'small'). One at a time. Resolves { ok: true } or { ok: false, cancelled: true };
  // anything else is thrown.
  async function download(id, onProgress) {
    if (active) throw new Error('A voice download is already running (' + active.id + ')');
    const isEngine = id === 'engine';
    const entry = isEngine ? engineEntry : models[id];
    if (!entry) throw new Error('Unknown voice file: ' + String(id).slice(0, 40));
    const controller = new AbortController();
    active = { id, controller };
    try {
      const target = isEngine ? path.join(dir, 'engine.zip') : modelPath(id);
      const part = await fetchPinned(entry, target, onProgress, controller.signal);
      if (isEngine) {
        try { unpackEngine(part); } finally { fsImpl.rmSync(part, { force: true }); }
      } else {
        fsImpl.renameSync(part, target);
        verified.delete(target);
      }
      return { ok: true };
    } catch (err) {
      if (controller.signal.aborted) return { ok: false, cancelled: true };
      throw err;
    } finally {
      active = null;
    }
  }

  function cancel() {
    if (!active) return false;
    active.controller.abort();
    return true;
  }

  // The full hash of an installed file, once per file version: called before the engine first uses a model, so a file
  // that was changed on disk after the download is never fed to the engine.
  async function verifyModel(id) {
    const p = modelPath(id);
    const m = models[id];
    const st = fsImpl.statSync(p);
    if (st.size !== m.bytes) throw new Error('The voice model file has the wrong size. Delete it in Settings and download it again.');
    const stamp = st.size + ':' + st.mtimeMs;
    if (verified.get(p) === stamp) return true;
    const hash = crypto.createHash('sha256');
    await new Promise((resolve, reject) => {
      const s = fsImpl.createReadStream(p);
      s.on('data', (d) => hash.update(d)); s.on('error', reject); s.on('end', resolve);
    });
    if (hash.digest('hex') !== m.sha256) throw new Error('The voice model file does not match its pinned checksum. Delete it in Settings and download it again.');
    verified.set(p, stamp);
    return true;
  }

  function remove(which) {
    if (active) throw new Error('Cancel the running download first');
    const ids = which === 'all' ? Object.keys(models) : [which];
    for (const id of ids) {
      const p = modelPath(id);
      fsImpl.rmSync(p, { force: true });
      fsImpl.rmSync(p + '.part', { force: true });
      verified.delete(p);
    }
    if (which === 'all') {
      fsImpl.rmSync(engineDir, { recursive: true, force: true });
      fsImpl.rmSync(engineDir + '.new', { recursive: true, force: true });
      fsImpl.rmSync(path.join(dir, 'engine.zip.part'), { force: true });
    }
    return status();
  }

  return { status, download, cancel, remove, verifyModel, modelPath, enginePath, engineDir, dir };
}

module.exports = { createVoiceStore, ENGINE, MODELS, ENGINE_FILES, hostAllowed };
