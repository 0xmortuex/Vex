// === Voice control: running the speech engine ===========================================
//
// One utterance = one short-lived child process: whisper-cli.exe, started with an argument list (no shell), a near-empty
// environment (no proxy variables, no PATH to anything else), the engine folder as its working directory and no window.
// It exits when it has printed the text, so there is nothing to keep warm and nothing left running while the person is silent.
// A watchdog kills it if it has not finished in TIMEOUT_MS, and cancel() / dispose() (quit) kill it at once.
//
// THE AUDIO NEVER TOUCHES THE DISK. whisper-cli can only read a "file", so the speech is handed over through a Windows
// NAMED PIPE that this process serves: the engine opens \\.\pipe\vex-voice-<128 random bits> as if it were a WAV file and
// reads the bytes straight out of this process's memory. Measured 2026-11-06 with whisper.cpp b5454: it works, and it does
// not need a temp file, a stdin redirect (Windows text-mode stdin corrupts the audio and the engine printed nothing) or a
// local web server (the engine's own server would open a network port). The pipe accepts ONE connection and is closed
// after it. No file is written by this module at all, and no audio byte, no text and no argument that holds speech is ever
// logged.
//
// The engine has no network code of its own to start with (it is the plain command-line program, not whisper-server), and it
// is started with no proxy settings. Windows does not let a program take a process's network away without a firewall rule,
// which needs administrator rights; Vex does not claim that it has one.
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const RATE = 16000;
const MIN_BYTES = RATE * 2 * 0.3;          // 0.3 s
const MAX_BYTES = RATE * 2 * 60;           // 60 s: the renderer stops at 30 s; this is the limit it cannot talk past
const TIMEOUT_MS = 60 * 1000;
const MAX_OUT = 64 * 1024;
const LANGUAGES = Object.freeze(['auto', 'tr', 'en']);

// 16-bit mono PCM at 16 kHz -> a WAV file image in memory.
function pcmToWav(pcm) {
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF', 0, 'latin1'); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVE', 8, 'latin1'); wav.write('fmt ', 12, 'latin1');
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(RATE, 24); wav.writeUInt32LE(RATE * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'latin1'); wav.writeUInt32LE(pcm.length, 40);
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.length).copy(wav, 44);
  return wav;
}

// What whisper prints for silence and sound effects is not speech.
function cleanText(raw) {
  const text = String(raw || '').split(/\r?\n/).map(l => l.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ').trim();
  return /^[\s.,!?\u2026-]*$/.test(text) ? '' : text;
}

function defaultPipePath() {
  const name = 'vex-voice-' + crypto.randomBytes(16).toString('hex');
  return process.platform === 'win32' ? '\\\\.\\pipe\\' + name : path.join(os.tmpdir(), name + '.sock');
}

function createVoiceEngine({ store, spawnImpl = childProcess.spawn, netImpl = net, pipePath = defaultPipePath, timeoutMs = TIMEOUT_MS, threads = Math.max(2, Math.min(4, os.cpus().length - 1)), platform = process.platform } = {}) {
  if (!store) throw new Error('The voice engine needs the voice store');
  let current = null;                      // { child, cancel() }

  function validate(pcm, opts) {
    if (platform !== 'win32') throw new Error('Voice control runs on Windows for now');
    if (!(pcm instanceof Uint8Array)) throw new Error('The audio must be bytes');
    if (pcm.length % 2) throw new Error('The audio must be 16-bit samples');
    if (pcm.length < MIN_BYTES) throw new Error('That was too short to hear');
    if (pcm.length > MAX_BYTES) throw new Error('That recording is longer than 60 seconds');
    const language = opts.language == null ? 'auto' : opts.language;
    if (!LANGUAGES.includes(language)) throw new Error('Unknown language: ' + String(language).slice(0, 12));
    return language;
  }

  async function transcribe(pcm, opts = {}) {
    if (current) throw new Error('The speech engine is already listening to another clip');
    const language = validate(pcm, opts);
    const st = store.status();
    if (!st.engine.installed) throw new Error('The speech engine is not downloaded. Open Settings > Voice control.');
    if (!st.models[opts.model] || !st.models[opts.model].installed) throw new Error('The voice model is not downloaded. Open Settings > Voice control.');
    await store.verifyModel(opts.model);
    const wav = pcmToWav(pcm);
    const pipe = pipePath();
    const t0 = Date.now();
    const run = { child: null, cancelled: false, cancel() { this.cancelled = true; if (this.child) this.child.kill(); } };
    current = run;
    let server = null;
    let timer = null;
    try {
      let pipeError = null;
      server = netImpl.createServer((sock) => {
        sock.on('error', (e) => { pipeError = e; });      // the engine closes its end as soon as it has read the data (EPIPE); reported below only if the run failed
        sock.end(wav);
        server.close();
      });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(pipe, resolve); });
      if (run.cancelled) throw Object.assign(new Error('Cancelled'), { cancelled: true });
      const args = ['-m', store.modelPath(opts.model), '-f', pipe, '-l', language, '-nt', '-np', '-sns', '-t', String(threads)];
      const result = await new Promise((resolve, reject) => {
        const child = spawnImpl(store.enginePath(), args, {
          cwd: store.engineDir, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
          env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows', PATH: store.engineDir },
        });
        run.child = child;
        let out = '', err = '', over = false;
        child.stdout.on('data', (d) => { out += d; if (out.length > MAX_OUT) { over = true; child.kill(); } });
        child.stderr.on('data', (d) => { err = (err + d).slice(-400); });
        timer = setTimeout(() => { run.timedOut = true; child.kill(); }, timeoutMs);
        child.on('error', (e) => reject(new Error('The speech engine could not start: ' + e.message)));
        child.on('close', (code) => {
          if (run.cancelled) return reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
          if (run.timedOut) return reject(new Error('The speech engine took longer than ' + Math.round(timeoutMs / 1000) + ' seconds and was stopped'));
          if (over) return reject(new Error('The speech engine printed too much and was stopped'));
          if (code !== 0) return reject(new Error('The speech engine stopped with code ' + code + (pipeError ? ' (' + pipeError.message + ')' : '') + (err ? ': ' + err.replace(/\s+/g, ' ').trim().slice(0, 160) : '')));
          resolve(out);
        });
      });
      return { text: cleanText(result), ms: Date.now() - t0, language };
    } finally {
      clearTimeout(timer);
      if (server && server.listening) server.close();
      current = null;
    }
  }

  function cancel() {
    if (!current) return false;
    current.cancel();
    return true;
  }
  const dispose = cancel;

  return { transcribe, cancel, dispose, busy: () => !!current, pid: () => (current && current.child ? current.child.pid : null) };
}

module.exports = { createVoiceEngine, pcmToWav, cleanText, LANGUAGES, MIN_BYTES, MAX_BYTES, TIMEOUT_MS };
