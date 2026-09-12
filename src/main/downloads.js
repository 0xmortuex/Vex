const path = require('path');
function createDownloadService({ app, secureSessions, broadcast, ipcMain }) {
const _broadcastDownloadEvent = broadcast;
// Live DownloadItems, keyed by the id the renderer knows them by, so the panel
// can pause/resume/cancel a transfer that is still running. An item is dropped
// the moment it finishes — a stale handle throws on every call.
const _liveDownloads = new Map();
function _uniqueDownloadPath(dir, filename) {
  const fs = require('fs');
  let candidate = path.join(dir, filename);
  if (!fs.existsSync(candidate)) return candidate;
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  for (let i = 1; i < 1000; i++) {
    candidate = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(dir, `${base} (${Date.now()})${ext}`);
}

function wireDownloadsOnSession(ses, tag) {
  if (!ses || ses.__vexDownloadsWired) return;
  ses.__vexDownloadsWired = true;
  ses.on('will-download', (event, item, contents) => {
    const owner = secureSessions.owner(contents);
    const partition = contents && secureSessions.partitionOf(contents);
    const emit = (channel, data) => {
      if (partition && !partition.startsWith('persist:')) { try { owner?.win.webContents.send(channel, data); } catch {} }
      else _broadcastDownloadEvent(channel, data);
    };
    const savePath = _uniqueDownloadPath(app.getPath('downloads'), item.getFilename());
    item.setSavePath(savePath);
    const info = {
      id: `dl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      fileName: path.basename(savePath),
      url: item.getURL(),
      totalBytes: item.getTotalBytes(),
      path: savePath,
      startedAt: new Date().toISOString()
    };
    _liveDownloads.set(info.id, item);
    console.log(`[Downloads] (${tag || 'session'}) start:`, info.fileName, info.totalBytes, 'bytes');
    emit('download-started', info);
    item.on('updated', (_e, state) => {
      emit('download-progress', {
        id: info.id,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        // A paused transfer still reports state 'progressing'; the panel needs
        // to know it has actually stopped, or the row lies about what it's doing.
        paused: safeCall(item, 'isPaused', false),
        canResume: safeCall(item, 'canResume', false),
        state
      });
    });
    item.once('done', (_e, state) => {
      _liveDownloads.delete(info.id);
      console.log(`[Downloads] (${tag || 'session'}) done:`, info.fileName, state);
      // Report the real byte counts: a server that sent no Content-Length leaves
      // totalBytes at 0, and the panel used to copy that 0 over the received
      // count and then render a completed download as "0 B".
      emit('download-complete', {
        id: info.id,
        fileName: info.fileName,
        state,
        path: savePath,
        url: info.url,
        receivedBytes: safeCall(item, 'getReceivedBytes', 0),
        totalBytes: safeCall(item, 'getTotalBytes', 0)
      });
    });
  });
}

// A DownloadItem whose transfer has ended throws on most getters. Reading one
// must never take down the emit that carries the final state to the panel.
function safeCall(item, method, fallback) {
  try { const value = item[method](); return value == null ? fallback : value; }
  catch { return fallback; }
}

function control(id, action) {
  if (typeof id !== 'string') throw new Error('Invalid download id');
  const item = _liveDownloads.get(id);
  if (!item) return { ok: false, error: 'That download has already finished' };
  if (action === 'pause') {
    if (item.isPaused()) return { ok: true, paused: true };
    item.pause();
    return { ok: true, paused: true };
  }
  if (action === 'resume') {
    if (!item.isPaused()) return { ok: true, paused: false };
    if (!item.canResume()) return { ok: false, error: 'This download cannot be resumed' };
    item.resume();
    return { ok: true, paused: false };
  }
  if (action === 'cancel') { item.cancel(); return { ok: true }; }
  throw new Error('Unknown download action: ' + action);
}

if (ipcMain) {
  ipcMain.handle('downloads:control', (_e, id, action) => {
    try { return control(id, action); }
    catch (err) { return { ok: false, error: err.message }; }
  });
  // Re-request a URL that failed or was cancelled. Routed through the calling
  // window's own webContents so it uses that window's session (proxy/routing,
  // cookies) exactly like the original attempt.
  ipcMain.handle('downloads:retry', (event, url) => {
    try {
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { ok: false, error: 'Only http(s) downloads can be retried' };
      const sender = event.sender;
      if (!sender || sender.isDestroyed()) return { ok: false, error: 'Window is gone' };
      sender.downloadURL(url);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });
}

return { wireDownloadsOnSession, control, _liveDownloads };
}
module.exports = { createDownloadService };
