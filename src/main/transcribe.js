// === Local transcription of the owner's own speech (meeting copilot) =========
//
// A pluggable, local-only engine: a whisper.cpp command-line program and a model file that
// THE PERSON picked in a file dialog owned by this process. Vex does not ship an engine and
// does not download one (the engine is BLOCKED-EXTERNAL: the person installs whisper.cpp and a
// ggml model). Nothing here uses the network.
//
// The pipeline, per listening session:
//   1. begin   the window asks to start; MAIN shows the consent box itself, naming the
//              microphone, that only the person's own voice is heard (the call's sound is not
//              captured), that it is transcribed on this PC, whether audio is kept, and the
//              EXACT command that will run. No answer, no session. Every session asks again.
//   2. chunk   the window sends one WAV segment at a time (16 kHz, mono, 16-bit, at most
//              MAX_WAV_BYTES). Main writes it to a private temp folder, runs
//                 <engine> [<script>] -m <model> -f <segment.wav> -l <language> -nt -np
//              with shell:false and an argument array, reads the text it prints, and deletes the
//              segment. One engine process at a time; a queue deeper than MAX_QUEUE is refused so a
//              slow engine cannot pile up audio in memory.
//   3. end     the session closes. Audio segments are deleted as soon as they are read, unless
//              the person ticked "keep the audio": then they are moved to
//              <profile>/meeting-audio/<session>/ and the folder is named in the answer.
//
// Paths and program names never arrive from a window: pick() opens the file dialog here and
// stores what the person chose. A <script> (for an engine that is run by an interpreter, e.g.
// python.exe with a wrapper) is picked the same way. The engine is a program the person chose;
// it is run only after the box above.
const nodeFs = require('fs');
const nodePath = require('path');
const nodeOs = require('os');
const { randomUUID } = require('crypto');

const CONFIG_KEY = 'transcribe-config';
const MAX_WAV_BYTES = 4 * 1024 * 1024;     // about two minutes of 16 kHz mono; the window sends 30 seconds at most
const MAX_QUEUE = 3;
const MAX_STDOUT = 256 * 1024;
const MAX_STDERR = 8 * 1024;
const TIMEOUT_MS = 3 * 60 * 1000;
const LANGUAGE = /^(?:auto|[a-z]{2,3})$/;
const KINDS = Object.freeze(['engine', 'model', 'script']);

function wavOk(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 44) return 'That is not a WAV segment';
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
  if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WAVE') return 'That is not a WAV segment';
  if (b.readUInt16LE(20) !== 1 || b.readUInt16LE(22) !== 1 || b.readUInt32LE(24) !== 16000 || b.readUInt16LE(34) !== 16) return 'The segment must be 16 kHz, mono, 16-bit';
  return '';
}

// What whisper prints for silence and sound effects is not speech.
function cleanText(raw) {
  const text = String(raw || '').split(/\r?\n/).map((l) => l.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ').trim();
  return /^[\s.,!?-]*$/.test(text) ? '' : text;
}

function commandLine(cfg, language, placeholder = '<audio segment>') {
  return [cfg.engine, ...(cfg.script ? [cfg.script] : []), '-m', cfg.model, '-f', placeholder, '-l', language, '-nt', '-np'];
}

/**
 * @param {{ store: { read(key: string): Promise<any>, write(key: string, value: any): Promise<any> },
 *           dialog: { showOpenDialog: Function, showMessageBox: Function }, spawn?: Function,
 *           userDataPath: string, tmpdir?: string, fsMod?: typeof nodeFs, log?: Console, timeoutMs?: number }} deps
 */
function createTranscriber({ store, dialog, spawn = require('child_process').spawn, userDataPath, tmpdir = nodeOs.tmpdir(), fsMod = nodeFs, log = console, timeoutMs = TIMEOUT_MS }) {
  if (!store || !dialog || !userDataPath) throw new Error('createTranscriber: store, dialog and userDataPath are required');
  const sessions = new Map();     // token -> { id, keepAudio, dir, seq, queue, closed }
  let chain = Promise.resolve();  // one engine process at a time

  async function load() {
    const c = (await store.read(CONFIG_KEY)) || {};
    return { engine: c.engine || '', model: c.model || '', script: c.script || '', language: LANGUAGE.test(c.language || '') ? c.language : 'auto', keepAudio: c.keepAudio === true };
  }
  async function save(c) { await store.write(CONFIG_KEY, c); return c; }
  const isFile = (p) => { try { return fsMod.statSync(p).isFile(); } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
  const view = (c) => ({ ...c, ready: !!(c.engine && c.model && isFile(c.engine) && isFile(c.model) && (!c.script || isFile(c.script))) });

  async function config() { return view(await load()); }

  // The person picks a file in a dialog owned by main. -> the new config, or the old one on cancel.
  async function pick(kind, win) {
    if (!KINDS.includes(kind)) throw new Error('Unknown thing to pick: ' + kind);
    const filters = kind === 'model' ? [{ name: 'Whisper model', extensions: ['bin', 'gguf'] }]
      : kind === 'script' ? [{ name: 'Script', extensions: ['py', 'js', 'ps1', 'bat', 'cmd'] }]
        : process.platform === 'win32' ? [{ name: 'Program', extensions: ['exe'] }] : [];
    const title = kind === 'engine' ? 'Choose the whisper.cpp program (whisper-cli.exe)' : kind === 'model' ? 'Choose the whisper model file (ggml-*.bin)' : 'Choose the script the program runs first';
    const r = await dialog.showOpenDialog(win || undefined, { title, properties: ['openFile'], filters });
    const c = await load();
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return view(c);
    const file = nodePath.resolve(r.filePaths[0]);
    if (!isFile(file)) throw new Error(file + ' is not a file');
    c[kind] = file;
    return view(await save(c));
  }

  async function clear(kind) {
    if (!KINDS.includes(kind)) throw new Error('Unknown thing to clear: ' + kind);
    const c = await load();
    c[kind] = '';
    return view(await save(c));
  }

  async function set({ language, keepAudio } = {}) {
    const c = await load();
    if (language !== undefined) {
      if (!LANGUAGE.test(language)) throw new Error('A language is "auto" or a short code such as en or tr');
      c.language = language;
    }
    if (keepAudio !== undefined) {
      if (typeof keepAudio !== 'boolean') throw new Error('keepAudio is on or off');
      c.keepAudio = keepAudio;
    }
    return view(await save(c));
  }

  // The consent box. Main shows it, so a window cannot answer for the person.
  async function begin(win, { sessionName = '' } = {}) {
    const c = view(await load());
    if (!c.ready) throw new Error('Choose the whisper.cpp program and a model file first (Settings > Meeting transcript)');
    const cmd = commandLine(c, c.language).map((p) => (/\s/.test(p) ? '"' + p + '"' : p)).join(' ');
    const r = await dialog.showMessageBox(win || undefined, {
      type: 'question', title: 'Listen to your microphone?', noLink: true, defaultId: 1, cancelId: 1,
      buttons: ['Start listening', 'Cancel'],
      message: 'Vex will listen to YOUR microphone for ' + (sessionName ? '"' + String(sessionName).slice(0, 80) + '"' : 'this meeting') + ' and turn your voice into text.',
      detail: 'Only your microphone is used: the other people on a call are not captured, and the screen is not recorded. '
        + 'The sound is turned into text on this computer by the program you chose; nothing is sent anywhere. '
        + (c.keepAudio ? 'The audio WILL be kept in the profile folder (meeting-audio), because you ticked that. ' : 'The audio is deleted as soon as it has been read. ')
        + 'Tell the people in the meeting that you are transcribing what you say.\n\nVex will run, for each piece of audio:\n' + cmd,
    });
    if (r.response !== 0) return { started: false };
    const token = randomUUID();
    sessions.set(token, { id: token.slice(0, 8), keepAudio: c.keepAudio, dir: '', seq: 0, queued: 0, closed: false, config: c });
    return { started: true, token, keepAudio: c.keepAudio };
  }

  function runEngine(cfg, wav) {
    return new Promise((resolve, reject) => {
      const args = [...(cfg.script ? [cfg.script] : []), '-m', cfg.model, '-f', wav, '-l', cfg.language, '-nt', '-np'];
      let child;
      try { child = spawn(cfg.engine, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (e) { reject(new Error('The program could not be started: ' + e.message, { cause: e })); return; }
      let out = '', err = '', over = false, done = false;
      const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); fn(v); };
      const timer = setTimeout(() => { try { child.kill(); } catch (e) { log.error('[Transcribe] could not stop the engine', e.message); } finish(reject, new Error('The engine took longer than ' + (timeoutMs >= 1000 ? Math.round(timeoutMs / 1000) + ' seconds' : timeoutMs + ' ms') + ' and was stopped')); }, timeoutMs);
      child.stdout.on('data', (d) => { out += d.toString('utf8'); if (out.length > MAX_STDOUT) { over = true; try { child.kill(); } catch (e) { log.error('[Transcribe] could not stop the engine', e.message); } } });
      child.stderr.on('data', (d) => { if (err.length < MAX_STDERR) err += d.toString('utf8'); });
      child.on('error', (e) => finish(reject, new Error('The program could not be started: ' + e.message, { cause: e })));
      child.on('close', (code) => {
        if (over) return finish(reject, new Error('The engine printed far more text than a segment can hold, so it was stopped'));
        if (code !== 0) return finish(reject, new Error('The engine stopped with code ' + code + (err.trim() ? ': ' + err.trim().slice(-300) : '')));
        finish(resolve, out);
      });
    });
  }

  // `audio` is the segment as base64 text (a window sends it over IPC as text) or as bytes.
  async function chunk(token, audio) {
    const s = sessions.get(token);
    if (!s || s.closed) throw new Error('Listening is not on');
    if (typeof audio === 'string' && !/^[A-Za-z0-9+/]*={0,2}$/.test(audio)) throw new Error('That segment is not valid base64');
    const bytes = typeof audio === 'string' ? Buffer.from(audio, 'base64') : audio;
    const bad = wavOk(bytes);
    if (bad) throw new Error(bad);
    if (bytes.length > MAX_WAV_BYTES) throw new Error('That segment is too long');
    if (s.queued >= MAX_QUEUE) throw new Error('The engine is not keeping up with the audio (' + MAX_QUEUE + ' segments are waiting)');
    s.queued += 1;
    const n = ++s.seq;
    const job = chain.catch(() => { /* vex-allow-empty-catch: an earlier segment's failure was reported to its own caller */ }).then(async () => {
      if (s.closed) throw new Error('Listening has stopped');
      if (!s.dir) { s.dir = fsMod.mkdtempSync(nodePath.join(tmpdir, 'vex-transcribe-')); }
      const wav = nodePath.join(s.dir, 'seg-' + n + '.wav');
      fsMod.writeFileSync(wav, bytes, { mode: 0o600 });
      try {
        const text = cleanText(await runEngine(s.config, wav));
        if (s.keepAudio) {
          const keepDir = nodePath.join(userDataPath, 'meeting-audio', s.id);
          fsMod.mkdirSync(keepDir, { recursive: true });
          fsMod.renameSync(wav, nodePath.join(keepDir, 'seg-' + n + '.wav'));
        }
        return { text, n };
      } finally { fsMod.rmSync(wav, { force: true }); }
    });
    chain = job;
    try { return await job; } finally { s.queued -= 1; }
  }

  async function end(token) {
    const s = sessions.get(token);
    if (!s) return { kept: null };
    s.closed = true;
    sessions.delete(token);
    await chain.catch(() => { /* vex-allow-empty-catch: a failed segment was reported to its caller */ });
    if (s.dir) fsMod.rmSync(s.dir, { recursive: true, force: true });
    return { kept: s.keepAudio ? nodePath.join(userDataPath, 'meeting-audio', s.id) : null };
  }

  return { config, pick, clear, set, begin, chunk, end, active: () => sessions.size };
}

// Vex's own window only (ipc-policy.js UI_ONLY, closed in private windows). The window never names a path or a program.
function registerTranscribe({ ipcMain, transcriber, mainWindowOf }) {
  const fromMain = (e) => {
    const w = mainWindowOf();
    if (!w || w.isDestroyed() || e.sender !== w.webContents || e.senderFrame !== w.webContents.mainFrame) throw new Error('Only the main Vex window does this');
    return w;
  };
  ipcMain.handle('transcribe:config', async (e) => { fromMain(e); return transcriber.config(); });
  ipcMain.handle('transcribe:pick', async (e, kind) => transcriber.pick(kind, fromMain(e)));
  ipcMain.handle('transcribe:clear', async (e, kind) => { fromMain(e); return transcriber.clear(kind); });
  ipcMain.handle('transcribe:set', async (e, opts) => { fromMain(e); return transcriber.set(opts); });
  ipcMain.handle('transcribe:begin', async (e, name) => transcriber.begin(fromMain(e), { sessionName: name }));
  ipcMain.handle('transcribe:chunk', async (e, token, bytes) => { fromMain(e); return transcriber.chunk(token, bytes); });
  ipcMain.handle('transcribe:end', async (e, token) => { fromMain(e); return transcriber.end(token); });
}

module.exports = { registerTranscribe, createTranscriber, wavOk, cleanText, commandLine, CONFIG_KEY, MAX_WAV_BYTES, MAX_QUEUE, KINDS };
