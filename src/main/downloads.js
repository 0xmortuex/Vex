const path = require('path');
// knownBefore: the paths of the finished downloads already in the panel's
// saved list, read once (see _loadKnown).
// webContents: Electron's, to find a live page in a session for a retry.
function createDownloadService({ app, secureSessions, broadcast, ipcMain, rules = () => [], knownBefore = () => [], webContents = null }) {
const _broadcastDownloadEvent = broadcast;
// Live DownloadItems, keyed by the id the renderer knows them by, so the panel
// can pause/resume/cancel a transfer that is still running. An item is dropped
// the moment it finishes — a stale handle throws on every call.
const _liveDownloads = new Map();
// "Save Image As..." (js/webview.js saveImage): the next download of this
// address asks where to go instead of landing in Downloads. Marked for a few
// seconds only, so an unrelated later download of the same file is not asked.
const ASK_FOR_MS = 15000;
const _askWhere = new Map();                       // url -> until
function askWhere(url, now = Date.now()) {
  if (typeof url !== 'string' || !url) throw new Error('Nothing to save');
  _askWhere.set(url, now + ASK_FOR_MS);
  return true;
}
function _takeAsk(urls, now = Date.now()) {
  let asked = false;
  for (const u of urls) {
    const until = _askWhere.get(u);
    if (until == null) continue;
    _askWhere.delete(u);
    if (until >= now) asked = true;
  }
  for (const [u, until] of _askWhere) if (until < now) _askWhere.delete(u);
  return asked;
}
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

// The files Vex itself downloaded: "Open" in the panel opens only one of these
// (main.js, downloads:open-file). It took any path from the interface, so a
// script in it could run any program on the disk (security scan L5). Files
// from a persist: session are remembered across restarts, as the panel's list
// is; a private, off-the-record or Tor tab's only until Vex closes.
const KNOWN_MAX = 1000;
const _knownFile = () => path.join(app.getPath('userData'), 'downloaded-files.json');
let _known = null;
const _knownEphemeral = new Set();
let _knownWrites = Promise.resolve();
const _fileKey = (p) => path.resolve(p).toLowerCase();
function _loadKnown() {
  if (_known) return _known;
  const fs = require('fs');
  try {
    if (fs.existsSync(_knownFile())) _known = JSON.parse(fs.readFileSync(_knownFile(), 'utf8'));
    else {
      // Once, the first time: the finished files already in the panel's list,
      // downloaded before this record was kept.
      _known = [...new Set(knownBefore().filter(p => typeof p === 'string' && p).map(_fileKey))].slice(0, KNOWN_MAX);
      const bytes = JSON.stringify(_known);
      _knownWrites = _knownWrites.then(() => require('./file-store').atomicWrite(_knownFile(), bytes, { backup: false }))
        .catch(err => console.error('[Downloads] could not save the list of downloaded files:', err.message));
    }
  } catch (err) { console.error('[Downloads] could not read the list of downloaded files:', err.message); _known = []; }
  if (!Array.isArray(_known)) _known = [];
  return _known;
}
function _noteFile(p, ephemeral) {
  if (typeof p !== 'string' || !p) return;
  const key = _fileKey(p);
  if (ephemeral) { _knownEphemeral.add(key); return; }
  const list = [key, ..._loadKnown().filter(x => x !== key)].slice(0, KNOWN_MAX);
  _known = list;
  const bytes = JSON.stringify(list);
  _knownWrites = _knownWrites.catch(() => {}).then(() => require('./file-store').atomicWrite(_knownFile(), bytes, { backup: false }))
    .catch(err => console.error('[Downloads] could not save the list of downloaded files:', err.message));
}
function isDownloadedFile(p) {
  if (typeof p !== 'string' || !p) return false;
  const key = _fileKey(p);
  return _knownEphemeral.has(key) || _loadKnown().includes(key);
}
// Each download's session, by the id the panel knows it by, so Retry fetches
// it again through the same one: it went through the Vex window's own session,
// direct and in the default profile, for a Tor or private download too
// (security scan M4). Kept until Vex closes; a Retry after a restart uses
// persist:main, the only session a remembered download can have come from.
const _sources = new Map();   // id -> { session, partition, hostId }
const SOURCES_MAX = 500;
// Which window asked for a retry made with no page, so its events go there.
const _retryHosts = new Map();   // url -> owner

function wireDownloadsOnSession(ses, tag) {
  if (!ses || ses.__vexDownloadsWired) return;
  ses.__vexDownloadsWired = true;
  ses.on('will-download', (event, item, contents) => {
    let owner = contents ? secureSessions.owner(contents) : null;
    // A retry made through the session itself has no page.
    const partition = contents ? secureSessions.partitionOf(contents) : secureSessions.partitionOf({ session: ses });
    if (!contents && _retryHosts.has(item.getURL())) { owner = _retryHosts.get(item.getURL()); _retryHosts.delete(item.getURL()); }
    // Not written to disk by the panel: a private window keeps its storage in
    // memory anyway, but a Tor, off-the-record or burner tab in the main window
    // left its download's address and path in vex-persist.json (security scan S5-1).
    const ephemeral = !!partition && !partition.startsWith('persist:');
    const emit = (channel, data) => {
      if (partition && !partition.startsWith('persist:')) { try { owner?.win.webContents.send(channel, data); } catch {} }
      else _broadcastDownloadEvent(channel, data);
    };
    // A sorting rule can put this in a folder of its own and rename it
    // (src/main/download-rules.js). No rule matching leaves both alone.
    const placed = require('./download-rules').place(rules(), { filename: item.getFilename(), url: item.getURL() });
    let dir = app.getPath('downloads');
    if (placed.folder) {
      const wanted = path.join(dir, placed.folder);
      try { require('fs').mkdirSync(wanted, { recursive: true }); dir = wanted; }
      catch (err) { console.warn('[Downloads] could not make ' + wanted + ', using the Downloads folder:', err.message); }
    }
    const chain = [item.getURL(), ...safeCall(item, 'getURLChain', [])];
    const ask = _takeAsk(chain);
    let savePath = _uniqueDownloadPath(dir, placed.filename || item.getFilename());
    // Not setting a save path is what makes Electron show the Save dialog;
    // where the user puts it is read back from the item once it is chosen.
    if (ask) item.setSaveDialogOptions({ title: 'Save image as', defaultPath: savePath, buttonLabel: 'Save' });
    else item.setSavePath(savePath);
    const info = {
      id: `dl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      fileName: path.basename(savePath),
      url: item.getURL(),
      totalBytes: item.getTotalBytes(),
      path: savePath,
      startedAt: new Date().toISOString(),
      ephemeral,
    };
    _liveDownloads.set(info.id, item);
    _sources.set(info.id, { session: ses, partition: partition || '', hostId: owner ? owner.win.webContents.id : null });
    while (_sources.size > SOURCES_MAX) _sources.delete(_sources.keys().next().value);
    console.log(`[Downloads] (${tag || 'session'}) start:`, info.fileName, info.totalBytes, 'bytes');
    emit('download-started', info);
    item.on('updated', (_e, state) => {
      if (ask) { const chosen = safeCall(item, 'getSavePath', ''); if (chosen) { savePath = chosen; info.path = chosen; info.fileName = path.basename(chosen); } }
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
      if (ask) { const chosen = safeCall(item, 'getSavePath', ''); if (chosen) { savePath = chosen; info.fileName = path.basename(chosen); } }
      console.log(`[Downloads] (${tag || 'session'}) done:`, info.fileName, state);
      if (state === 'completed') _noteFile(savePath, ephemeral);
      // Report the real byte counts: a server that sent no Content-Length leaves
      // totalBytes at 0, and the panel used to copy that 0 over the received
      // count and then render a completed download as "0 B".
      emit('download-complete', {
        id: info.id,
        fileName: info.fileName,
        state,
        path: savePath,
        url: info.url,
        ephemeral,
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
  ipcMain.handle('downloads:ask-where', (_e, url) => {
    try { return { ok: askWhere(url) }; }
    catch (err) { return { ok: false, error: err.message }; }
  });
  // Re-request a URL that failed or was cancelled, through the session the
  // first attempt used (its proxy or Tor route, its cookies).
  ipcMain.handle('downloads:retry', (event, url, id) => {
    try { return retry(event.sender, url, id); }
    catch (err) { return { ok: false, error: err.message }; }
  });
}

function retry(sender, url, id) {
  const webContentsModule = webContents || require('electron').webContents;
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { ok: false, error: 'Only http(s) downloads can be retried' };
  if (!sender || sender.isDestroyed()) return { ok: false, error: 'Window is gone' };
  const host = secureSessions.owner(sender);
  const source = typeof id === 'string' ? _sources.get(id) : null;
  let ses, partition;
  if (source) {
    if (source.hostId != null && host && source.hostId !== host.win.webContents.id) return { ok: false, error: 'That download belongs to another window' };
    ({ session: ses, partition } = source);
    // A private, off-the-record or Tor session is wiped when its last tab
    // closes; it is never fetched again some other way.
    if (partition && !partition.startsWith('persist:') && !secureSessions.sessions.has(ses)) {
      return { ok: false, error: 'The tab this came from is closed, so it cannot be downloaded again the same way' };
    }
  } else {
    partition = host && host.privatePartition ? host.privatePartition : 'persist:main';
    ses = secureSessions.fromPartition(partition);
  }
  // Through a page of this window in that session when there is one, so the
  // download is this window's; else through the session itself.
  const page = webContentsModule.getAllWebContents().find(c => !c.isDestroyed() && c.session === ses && c.getType() === 'webview' && secureSessions.owner(c) === host);
  if (page) { page.downloadURL(url); return { ok: true }; }
  if (host) _retryHosts.set(url, host);
  ses.downloadURL(url);
  return { ok: true };
}

return { wireDownloadsOnSession, control, askWhere, _takeAsk, _liveDownloads, retry, isDownloadedFile, _noteFile, _sources, flushKnown: () => _knownWrites };
}
module.exports = { createDownloadService };
