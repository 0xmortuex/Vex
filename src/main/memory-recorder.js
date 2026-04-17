// === Vex Phase 17A: Memory Recorder (main process) ===
// Audio comes from the renderer (getUserMedia → WAV) via `memory:ingest-audio`.
// We spawn whisper.cpp per chunk, assemble conversations, and store them
// AES-256-GCM encrypted in userData/memory/*.vxm.

const { app, ipcMain, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

class MemoryRecorder {
  constructor() {
    this.isRecording = false;
    this.isPaused = false;
    this.currentConversation = null;
    this.lastActivityAt = Date.now();

    this.whisperPath = null;
    this.modelPath = null;
    this._resolveAssetPaths();

    this.storagePath = path.join(app.getPath('userData'), 'memory');
    if (!fs.existsSync(this.storagePath)) fs.mkdirSync(this.storagePath, { recursive: true });

    this.audioTmpDir = path.join(app.getPath('temp'), 'vex-memory-audio');
    if (!fs.existsSync(this.audioTmpDir)) fs.mkdirSync(this.audioTmpDir, { recursive: true });

    // Auto-finalize if nothing has arrived in a while
    this._watchdog = setInterval(() => this._maybeAutoFinalize(), 60 * 1000);
  }

  _resolveAssetPaths() {
    const candidates = [
      path.join(process.resourcesPath || '', 'assets', 'whisper'),
      path.join(app.getAppPath(), 'assets', 'whisper'),
      path.join(app.getPath('userData'), 'assets', 'whisper')
    ];
    for (const base of candidates) {
      const wx = path.join(base, 'whisper.exe');
      const mdl = path.join(base, 'ggml-base.bin');
      if (fs.existsSync(wx) && fs.existsSync(mdl)) {
        this.whisperPath = wx;
        this.modelPath = mdl;
        return;
      }
    }
    // Fall back to last candidate paths (still useful for error messages)
    this.whisperPath = path.join(app.getAppPath(), 'assets', 'whisper', 'whisper.exe');
    this.modelPath = path.join(app.getAppPath(), 'assets', 'whisper', 'ggml-base.bin');
  }

  isAvailable() {
    this._resolveAssetPaths();
    return fs.existsSync(this.whisperPath) && fs.existsSync(this.modelPath);
  }

  async startRecording() {
    if (!this.isAvailable()) throw new Error('Whisper not installed — see Memory panel for setup');
    this.isRecording = true;
    this.isPaused = false;
    this.lastActivityAt = Date.now();
    return { ok: true };
  }

  pauseRecording()  { this.isPaused = true;  return { ok: true }; }
  resumeRecording() { this.isPaused = false; this.lastActivityAt = Date.now(); return { ok: true }; }
  stopRecording() {
    this.isRecording = false;
    this.isPaused = false;
    if (this.currentConversation) this.finalizeConversation();
    return { ok: true };
  }

  async ingestAudioChunk(audioBuffer, metadata) {
    if (!this.isRecording || this.isPaused) return { skipped: true };
    if (!audioBuffer || audioBuffer.byteLength < 2048) return { skipped: true };

    const chunkId = crypto.randomBytes(8).toString('hex');
    const wavPath = path.join(this.audioTmpDir, `${chunkId}.wav`);
    try {
      fs.writeFileSync(wavPath, Buffer.from(audioBuffer));
    } catch (err) {
      return { ok: false, error: 'Write failed: ' + err.message };
    }
    this.transcribeChunk(wavPath, metadata || {});
    return { ok: true };
  }

  transcribeChunk(wavPath, metadata) {
    return new Promise((resolve) => {
      const outputBase = wavPath.replace(/\.wav$/, '');
      const proc = spawn(this.whisperPath, [
        '-m', this.modelPath,
        '-f', wavPath,
        '-l', 'auto',
        '-otxt',
        '-of', outputBase,
        '--no-prints'
      ], { windowsHide: true });

      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', (err) => {
        console.error('[MemoryRecorder] spawn failed:', err.message);
        this._cleanup(wavPath, outputBase);
        resolve({ ok: false });
      });
      proc.on('close', (code) => {
        try {
          if (code !== 0) {
            console.error('[MemoryRecorder] whisper exit', code, stderr.slice(-200));
            return resolve({ ok: false });
          }
          const txtPath = outputBase + '.txt';
          if (!fs.existsSync(txtPath)) return resolve({ ok: true, skipped: true });
          const text = fs.readFileSync(txtPath, 'utf-8').trim();
          if (text) this.addToConversation(text, metadata);
          resolve({ ok: true, text });
        } finally {
          this._cleanup(wavPath, outputBase);
        }
      });
    });
  }

  _cleanup(wavPath, outputBase) {
    try { if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath); } catch {}
    try { const t = outputBase + '.txt'; if (fs.existsSync(t)) fs.unlinkSync(t); } catch {}
  }

  addToConversation(text, metadata) {
    const now = Date.now();
    const silenceGap = now - this.lastActivityAt;

    if (!this.currentConversation || silenceGap > 3 * 60 * 1000) {
      if (this.currentConversation) this.finalizeConversation();
      this.currentConversation = {
        id: crypto.randomBytes(12).toString('hex'),
        startedAt: new Date().toISOString(),
        segments: [],
        durationMs: 0
      };
    }

    const startTs = new Date(this.currentConversation.startedAt).getTime();
    this.currentConversation.segments.push({
      text,
      at: new Date().toISOString(),
      offsetMs: now - startTs
    });
    this.lastActivityAt = now;

    if (now - startTs > 30 * 60 * 1000) this.finalizeConversation();

    this._notify('memory:live-segment', {
      conversationId: this.currentConversation?.id,
      text,
      startedAt: this.currentConversation?.startedAt
    });
  }

  _maybeAutoFinalize() {
    if (!this.currentConversation) return;
    if (this.isRecording && !this.isPaused) return; // still live
    // If recording paused/stopped and a conversation is open, finalize it
    if (this.currentConversation) this.finalizeConversation();
  }

  finalizeConversation() {
    const conv = this.currentConversation;
    if (!conv) return;
    this.currentConversation = null;
    conv.endedAt = new Date().toISOString();
    conv.durationMs = new Date(conv.endedAt).getTime() - new Date(conv.startedAt).getTime();
    conv.transcript = conv.segments.map(s => s.text).join(' ').trim();
    if (conv.transcript.length < 20) return; // discard trivial
    this.saveConversation(conv);
    this._notify('memory:conversation-finalized', { id: conv.id });
  }

  getEncryptionKey() {
    const keyPath = path.join(app.getPath('userData'), 'memory-key.bin');
    if (fs.existsSync(keyPath)) return fs.readFileSync(keyPath);
    const key = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, key, { mode: 0o600 });
    return key;
  }

  saveConversation(conv) {
    try {
      const key = this.getEncryptionKey();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const plaintext = Buffer.from(JSON.stringify(conv));
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const authTag = cipher.getAuthTag();
      const blob = Buffer.concat([iv, authTag, encrypted]);
      fs.writeFileSync(path.join(this.storagePath, `${conv.id}.vxm`), blob);
      this.updateIndex(conv);
    } catch (err) {
      console.error('[MemoryRecorder] save failed:', err);
    }
  }

  updateIndex(conv) {
    const indexPath = path.join(this.storagePath, 'index.json');
    let index = [];
    try {
      if (fs.existsSync(indexPath)) index = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) || [];
    } catch {}
    index.unshift({
      id: conv.id,
      startedAt: conv.startedAt,
      endedAt: conv.endedAt,
      durationMs: conv.durationMs,
      segmentCount: conv.segments.length,
      title: null,
      summary: null,
      processed: false
    });
    if (index.length > 10000) index.length = 10000;
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  }

  loadConversation(id) {
    const filePath = path.join(this.storagePath, `${id}.vxm`);
    if (!fs.existsSync(filePath)) return null;
    try {
      const blob = fs.readFileSync(filePath);
      const iv = blob.slice(0, 12);
      const authTag = blob.slice(12, 28);
      const encrypted = blob.slice(28);
      const key = this.getEncryptionKey();
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return JSON.parse(plaintext.toString());
    } catch (err) {
      console.error('[MemoryRecorder] decrypt failed:', err.message);
      return null;
    }
  }

  loadIndex() {
    const p = path.join(this.storagePath, 'index.json');
    if (!fs.existsSync(p)) return [];
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')) || []; }
    catch { return []; }
  }

  updateConversationMeta(id, updates) {
    const index = this.loadIndex();
    const i = index.findIndex(e => e.id === id);
    if (i < 0) return { ok: false };
    index[i] = { ...index[i], ...updates };
    fs.writeFileSync(path.join(this.storagePath, 'index.json'), JSON.stringify(index, null, 2));
    return { ok: true };
  }

  deleteConversation(id) {
    const f = path.join(this.storagePath, `${id}.vxm`);
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
    const index = this.loadIndex().filter(e => e.id !== id);
    fs.writeFileSync(path.join(this.storagePath, 'index.json'), JSON.stringify(index, null, 2));
    return { ok: true };
  }

  forgetRecent(minutesAgo) {
    const cutoff = Date.now() - minutesAgo * 60 * 1000;
    const index = this.loadIndex();
    const toDelete = index.filter(e => new Date(e.startedAt).getTime() > cutoff);
    for (const e of toDelete) this.deleteConversation(e.id);
    if (this.currentConversation) this.currentConversation = null;
    return { deleted: toDelete.length };
  }

  wipeAll() {
    const index = this.loadIndex();
    for (const e of index) this.deleteConversation(e.id);
    this.currentConversation = null;
    return { ok: true };
  }

  _notify(channel, data) {
    BrowserWindow.getAllWindows().forEach(w => {
      try { w.webContents.send(channel, data); } catch {}
    });
  }
}

const recorder = new MemoryRecorder();

// ---- IPC ----
ipcMain.handle('memory:is-available', () => recorder.isAvailable());
ipcMain.handle('memory:paths', () => ({ whisper: recorder.whisperPath, model: recorder.modelPath, userData: app.getPath('userData') }));
ipcMain.handle('memory:start',  async () => { try { return await recorder.startRecording(); } catch (err) { return { ok: false, error: err.message }; } });
ipcMain.handle('memory:pause',  () => recorder.pauseRecording());
ipcMain.handle('memory:resume', () => recorder.resumeRecording());
ipcMain.handle('memory:stop',   () => recorder.stopRecording());
ipcMain.handle('memory:status', () => ({
  isRecording: recorder.isRecording, isPaused: recorder.isPaused,
  currentConversationId: recorder.currentConversation?.id || null
}));
ipcMain.handle('memory:ingest-audio', async (_e, audioBuffer, metadata) => {
  try { return await recorder.ingestAudioChunk(audioBuffer, metadata); }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('memory:list',        () => recorder.loadIndex());
ipcMain.handle('memory:load',        (_e, id) => recorder.loadConversation(id));
ipcMain.handle('memory:update-meta', (_e, id, updates) => recorder.updateConversationMeta(id, updates));
ipcMain.handle('memory:delete',      (_e, id) => recorder.deleteConversation(id));
ipcMain.handle('memory:forget-recent', (_e, minutes) => recorder.forgetRecent(minutes));
ipcMain.handle('memory:wipe-all',    () => recorder.wipeAll());

module.exports = recorder;
