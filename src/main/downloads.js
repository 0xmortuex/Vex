const path = require('path');
function createDownloadService({ app, secureSessions, broadcast }) {
const _broadcastDownloadEvent = broadcast;
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
    console.log(`[Downloads] (${tag || 'session'}) start:`, info.fileName, info.totalBytes, 'bytes');
    emit('download-started', info);
    item.on('updated', (_e, state) => {
      emit('download-progress', {
        id: info.id,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        state
      });
    });
    item.once('done', (_e, state) => {
      console.log(`[Downloads] (${tag || 'session'}) done:`, info.fileName, state);
      emit('download-complete', {
        id: info.id, fileName: info.fileName, state, path: savePath
      });
    });
  });
}


return { wireDownloadsOnSession };
}
module.exports = { createDownloadService };
