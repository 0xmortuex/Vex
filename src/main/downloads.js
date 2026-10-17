const path = require('path');
// knownBefore: the paths of the finished downloads already in the panel's
// saved list, read once (see _loadKnown).
// webContents: Electron's, to find a live page in a session for a retry.
// prefs: where downloads go and whether each is asked about
// (src/main/download-prefs.js current()); folder null = the Downloads folder.
// lastGestureAt(contents): when the page last had a click or key press
// (main.js, _watchGestures). askAutoDownloads: permissions.js
// askAutomaticDownloads; without it no download is ever asked about.
// judgeDownload / askRiskyDownload (web-safety.js classifyDownload,
// permissions.js askRiskyDownload): a program or script from a site with no
// standing waits in the holding folder for a confirm; without them none is.
// releases: the record of GitHub release assets that were downloaded (download-desk.js
// createReleaseDesk), so the window can offer the hash and a VirusTotal link for one.
function createDownloadService({ app, secureSessions, broadcast, ipcMain, rules = () => [], knownBefore = () => [], webContents = null, prefs = () => ({ folder: null, ask: false }), lastGestureAt = () => undefined, askAutoDownloads = null, dialog = null, judgeDownload = null, askRiskyDownload = null, releases = null, inspectFile = null }) {
const { hasRecentGesture } = require('../main-helpers');
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
  markMine(url, now);
  return true;
}

// === A page downloading many files by itself (Chrome's "automatic downloads")
// The first download a page starts is never asked, nor one right after a click
// or key press on the page (one press, one download). A second or later one in
// AUTO_WINDOW_MS with no press asks once per site (permissions.js,
// askAutomaticDownloads), held in the profile's holding folder for the
// answer; Block cancels it and deletes it before it is in the panel. Downloads Vex itself starts for you (Save image,
// a media download, Retry) are marked mine and never counted.
const AUTO_WINDOW_MS = 30000;
const _pageDownloads = new Map();                  // page id -> { at: [times], gestureUsed }
const _mine = new Map();                           // url -> until
function markMine(url, now = Date.now()) {
  if (typeof url !== 'string' || !url) throw new Error('Nothing to download');
  _mine.set(url, now + ASK_FOR_MS);
  return true;
}
function _takeMine(urls, now) {
  let mine = false;
  for (const u of urls) {
    const until = _mine.get(u);
    if (until == null) continue;
    _mine.delete(u);
    if (until >= now) mine = true;
  }
  for (const [u, until] of _mine) if (until < now) _mine.delete(u);
  return mine;
}
// Where a download waits while its site is asked about: in the profile, never
// the user's folder. Whatever an earlier run left there (Vex closed while
// asking) is cleared the first time it is used.
let _heldSwept = false;
function _heldRoot() {
  const root = path.join(app.getPath('userData'), 'held-downloads');
  if (!_heldSwept) { _heldSwept = true; require('fs').rmSync(root, { recursive: true, force: true }); }
  return root;
}
function _removeHeld(dir) {
  try { require('fs').rmSync(dir, { recursive: true, force: true }); }
  catch (err) { console.error('[Downloads] could not clear ' + dir + ':', err.message); }
}
// Across drives a rename fails; a copy keeps the file's "downloaded from the
// internet" mark (its Zone.Identifier stream) as the rename does.
// The mark is read before and checked after (src/main/mark-of-the-web.js, T3-111): a
// copy onto another drive or a file system without streams used to lose it silently.
const _motw = require('./mark-of-the-web').createMarkOfTheWeb({ fs: require('fs'), log: (m) => console.log(m) });
function _moveFile(from, to) {
  const fs = require('fs');
  const kept = _motw.move(from, to, () => {
    try { fs.renameSync(from, to); }
    catch (err) {
      if (err.code !== 'EXDEV') throw err;
      fs.copyFileSync(from, to);
      fs.unlinkSync(from);
    }
  });
  if (kept.carried && !kept.kept && !kept.restored) console.error('[Downloads] ' + kept.error + ': ' + to);
}
// "Ask where to save each file" for a download that was held: Electron's own
// dialog was skipped by saving it into the holding folder.
async function _askSavePath(owner, defaultPath, title) {
  const d = dialog || require('electron').dialog;
  const opts = { title, defaultPath, buttonLabel: 'Save' };
  const win = owner && owner.win && !owner.win.isDestroyed() ? owner.win : null;
  const r = win ? await d.showSaveDialog(win, opts) : await d.showSaveDialog(opts);
  return r.canceled || !r.filePath ? null : r.filePath;
}
// null: go ahead. { origin, remember }: ask before it goes on.
function autoDownloadCheck(contents, urls, partition, now = Date.now()) {
  if (!contents || typeof askAutoDownloads !== 'function') return null;
  if (_takeMine(urls, now)) return null;
  let origin;
  try { origin = new URL(contents.getURL()).origin; } catch { return null; }
  if (!/^https?:\/\//.test(origin)) return null;
  const id = contents.id;
  let page = _pageDownloads.get(id);
  if (!page) {
    page = { at: [], gestureUsed: null, origin };
    _pageDownloads.set(id, page);
    contents.once('destroyed', () => _pageDownloads.delete(id));
  }
  // The tab has gone on to another site: that site's first download is its
  // first, not a second one of the site before (the count was per tab).
  if (page.origin !== origin) { page.at = []; page.origin = origin; }
  page.at = page.at.filter(t => now - t <= AUTO_WINDOW_MS);
  const earlier = page.at.length;
  page.at.push(now);
  const gesture = lastGestureAt(contents);
  if (hasRecentGesture(gesture, now) && page.gestureUsed !== gesture) { page.gestureUsed = gesture; return null; }
  if (!earlier) return null;
  // A private window's, an off-the-record or Tor tab's answer is not kept.
  const remember = (!partition || (partition.startsWith('persist:') && !partition.startsWith('persist:route-tor')))
    && !(contents.session && contents.session.__vexTor);
  return { origin, remember };
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
// Carrying on after a restart (download-resume.js), only when the person turned it on in Settings.
// _resuming: the address of a download handed back to Chromium at startup -> its record, so the
// will-download that follows is recognised. _userCancelled: ids the person cancelled, whose partial
// file is not kept; a download cancelled because Vex quit is.
let _resumeStore = null;
const _resumeStoreOf = () => _resumeStore || (_resumeStore = require('./download-resume').createResumeStore({ fs: require('fs'), file: path.join(app.getPath('userData'), 'resumable-downloads.json') }));
const _resuming = new Map();
const _userCancelled = new Set();
// Where a picked-up download is saved: its own name if free, else the same name made unique.
function _resumeTarget(rec) {
  const fs = require('fs');
  fs.mkdirSync(path.dirname(rec.savePath), { recursive: true });
  if (!fs.existsSync(rec.savePath)) return rec.savePath;
  // A leftover half-written copy of this very file (the same bytes under the other name) is replaced.
  const a = fs.statSync(rec.savePath, { bigint: true }), b = fs.statSync(rec.partPath, { bigint: true });
  if (a.ino === b.ino && a.dev === b.dev && a.ino !== 0n) { fs.unlinkSync(rec.savePath); return rec.savePath; }
  return _uniqueDownloadPath(path.dirname(rec.savePath), path.basename(rec.savePath));
}
// At startup: hand every kept partial download back to Chromium, which asks the server for the rest.
// With the setting off the kept files are removed instead.
function resumePending() {
  const store = _resumeStoreOf();
  const out = { resumed: 0, dropped: 0, problems: [] };
  if (!prefs().resume) {
    for (const r of store.all()) { store.forget(r.id); out.dropped++; }
    return out;
  }
  for (const g of store.sweep()) { out.dropped++; console.log('[Downloads] dropped a download to carry on: ' + g.why); }
  for (const rec of store.all()) {
    const key = rec.urlChain[rec.urlChain.length - 1];
    try {
      if (rec.partition && !String(rec.partition).startsWith('persist:')) throw new Error('only a normal profile\'s downloads are carried on');
      const ses = rec.partition ? secureSessions.fromPartition(rec.partition) : require('electron').session.defaultSession;
      const plan = store.plan(rec);
      _resuming.set(key, rec);
      ses.createInterruptedDownload(plan);
      out.resumed++;
      console.log('[Downloads] carrying on ' + rec.fileName + ' from ' + plan.offset + ' bytes');
    } catch (err) {
      _resuming.delete(key);
      out.problems.push(rec.fileName + ': ' + err.message);
      console.error('[Downloads] could not carry on ' + rec.fileName + ':', err.message);
      store.forget(rec.id);
    }
  }
  return out;
}

// Each download's session, by the id the panel knows it by, so Retry fetches
// it again through the same one: it went through the Vex window's own session,
// direct and in the default profile, for a Tor or private download too
// (security scan M4). Kept until Vex closes; a Retry after a restart uses
// persist:main, the only session a remembered download can have come from.
const _sources = new Map();   // id -> { session, partition, hostId }
const SOURCES_MAX = 500;
// What each download is, for "Explain this download" (safe-web-extras.js): its
// address, the page it came from, the content type the site declared and,
// once it is done, where it was saved. Memory only; never the file's contents.
const _explain = new Map();   // id -> { url, pageUrl, mime, fileName, path, state, receivedBytes, totalBytes, hash }
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
    // A private window's download to that window alone; a normal one to the
    // normal windows, never into an open private window (audit RD11).
    const emit = (channel, data) => {
      if (partition && !partition.startsWith('persist:')) { try { owner?.win.webContents.send(channel, data); } catch {} }
      else _broadcastDownloadEvent(channel, data, { skipPrivate: true });
    };
    const chain = [item.getURL(), ...safeCall(item, 'getURLChain', [])];
    // One handed back at startup (resumePending): no page, no questions, its own place.
    const resumed = _resuming.get(item.getURL()) || null;
    if (resumed) _resuming.delete(item.getURL());
    // A page's second download with no click: allowed, blocked, or asked
    // (a Promise) — see autoDownloadCheck. Blocked never reaches the panel.
    const auto = autoDownloadCheck(contents, chain, partition);
    let answer = auto ? askAutoDownloads(contents, auto.origin, { remember: auto.remember }) : true;
    if (answer === false) {
      console.log(`[Downloads] (${tag || 'session'}) blocked a download ${auto.origin} started by itself`);
      event.preventDefault();
      return;
    }
    // A program, script or installer from a site with no standing, or one
    // wearing a document's name: asked before it is kept. Not a retry made
    // with no page (that file was already allowed once).
    let risky = null;
    if (contents && judgeDownload && typeof askRiskyDownload === 'function') {
      const risk = judgeDownload({ filename: item.getFilename(), url: item.getURL(), pageUrl: safeCall(contents, 'getURL', '') });
      if (risk && risk.warn) {
        const remember = (!partition || (partition.startsWith('persist:') && !partition.startsWith('persist:route-tor')))
          && !(contents.session && contents.session.__vexTor);
        const asked = askRiskyDownload(contents, { url: item.getURL(), fileName: item.getFilename(), risk }, { remember });
        risky = risk;
        console.log(`[Downloads] (${tag || 'session'}) asking before keeping ${item.getFilename()}: ${risk.kind}`);
        answer = answer === true ? asked : answer.then(ok => (ok ? asked : false));
      }
    }
    const what = risky ? `a risky file (${risky.kind})` : `what ${auto ? auto.origin : 'a page'} started by itself`;
    // A sorting rule can put this in a folder of its own and rename it
    // (src/main/download-rules.js). No rule matching leaves both alone.
    const placed = require('./download-rules').place(rules(), { filename: item.getFilename(), url: item.getURL() });
    // The folder chosen in Settings > Downloads, or the Downloads folder.
    const where = prefs();
    let dir = where.folder || app.getPath('downloads');
    // The chosen folder is gone (a drive unplugged): asked where to save this
    // one, starting in Downloads, rather than failing or picking silently.
    const folderGone = !!where.folder && !require('fs').existsSync(where.folder);
    if (folderGone) {
      console.warn('[Downloads] the download folder ' + where.folder + ' is not there; asking where to save');
      dir = app.getPath('downloads');
    }
    if (placed.folder) {
      const wanted = path.join(dir, placed.folder);
      try { require('fs').mkdirSync(wanted, { recursive: true }); dir = wanted; }
      catch (err) { console.warn('[Downloads] could not make ' + wanted + ', using ' + dir + ':', err.message); }
    }
    const askImage = _takeAsk(chain);
    const ask = !resumed && (askImage || where.ask || folderGone);
    // An image or video with a counter for a name gets the site, the page title and the date
    // instead (download-desk.js mediaName), when that is switched on and no rule named it.
    let chosenName = placed.filename || item.getFilename();
    if (!resumed && !placed.rule && where.mediaNames === true && contents) {
      const nice = require('./download-desk').mediaName({ filename: item.getFilename(), url: item.getURL(), pageUrl: safeCall(contents, 'getURL', ''), pageTitle: safeCall(contents, 'getTitle', '') });
      if (nice) chosenName = nice;
    }
    let savePath = resumed ? _resumeTarget(resumed) : _uniqueDownloadPath(dir, chosenName);
    // A download being asked about is saved into Vex's own holding folder,
    // paused: a small file finishes even while paused (measured), so it must
    // not be written where the user's files are until the site is allowed.
    const held = answer !== true;
    const heldDir = held ? path.join(_heldRoot(), `h_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`) : null;
    const heldPath = held ? path.join(heldDir, path.basename(savePath)) : null;
    let heldDone = null;                               // how it ended while it was being asked
    // Not setting a save path is what makes Electron show the Save dialog;
    // where the user puts it is read back from the item once it is chosen.
    // Wherever it goes, Chromium still marks the file as downloaded from the
    // internet (Windows' Zone.Identifier), and Open still takes only it.
    if (held) {
      require('fs').mkdirSync(heldDir, { recursive: true });
      item.setSavePath(heldPath);
      item.pause();
      item.once('done', (_e, state) => { heldDone = state; });
    } else if (ask) item.setSaveDialogOptions({ title: askImage ? 'Save image as' : 'Save as', defaultPath: savePath, buttonLabel: 'Save' });
    else item.setSavePath(savePath);
    const readChosen = ask && !held;
    // Into the panel, and its progress reported: at once, or once allowed.
    const begin = () => {
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
      _explain.set(info.id, { url: info.url, pageUrl: contents ? safeCall(contents, 'getURL', '') : '', mime: safeCall(item, 'getMimeType', ''), fileName: info.fileName, path: savePath, state: 'progressing', receivedBytes: 0, totalBytes: info.totalBytes });
      while (_explain.size > SOURCES_MAX) _explain.delete(_explain.keys().next().value);
      console.log(`[Downloads] (${tag || 'session'}) start:`, info.fileName, info.totalBytes, 'bytes');
      // With "Ask where to save" the panel hears of it once a place is
      // chosen: a Save dialog closed with Cancel used to leave a "cancelled"
      // row and a toast for a download the user had just said no to (Chrome
      // shows nothing).
      let announced = false;
      const announce = () => { if (!announced) { announced = true; emit('download-started', info); } };
      if (!readChosen) announce();
      // Kept across a restart only when asked for (download-resume.js): a second name for the partial file.
      let tracked = null;
      let trackGaveUp = !where.resume || held;
      const keepForRestart = () => {
        const eTag = safeCall(item, 'getETag', ''), lastModified = safeCall(item, 'getLastModifiedTime', '');
        const why = _resumeStoreOf().eligible({ url: item.getURL(), totalBytes: item.getTotalBytes(), eTag, lastModified, ephemeral });
        if (why) { trackGaveUp = true; console.log(`[Downloads] (${tag || 'session'}) ${info.fileName} will not be carried on after a restart: ${why}`); return; }
        try {
          tracked = _resumeStoreOf().track({
            id: info.id, savePath, fileName: info.fileName, partition: partition || '', urlChain: safeCall(item, 'getURLChain', [item.getURL()]),
            mimeType: safeCall(item, 'getMimeType', ''), totalBytes: item.getTotalBytes(), eTag, lastModified, startTime: safeCall(item, 'getStartTime', 0),
          }, resumed ? resumed.partPath : savePath, resumed ? (resumed.gen || 1) + 1 : 1);
        } catch (err) {
          // The file may not exist yet: try again on the next update. Anything else is said once.
          if (err.code === 'ENOENT') return;
          trackGaveUp = true;
          console.error(`[Downloads] (${tag || 'session'}) ${info.fileName} cannot be carried on after a restart:`, err.message);
        }
      };
      item.on('updated', (_e, state) => {
        if (readChosen) {
          const chosen = safeCall(item, 'getSavePath', '');
          if (!chosen) return;
          savePath = chosen; info.path = chosen; info.fileName = path.basename(chosen);
          announce();
        }
        if (!tracked && !trackGaveUp && state === 'progressing' && item.getReceivedBytes() > 0) keepForRestart();
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
      const finish = (state) => {
        _liveDownloads.delete(info.id);
        // The second name for the partial file goes, unless Vex itself was closed in the middle (the
        // download is then cancelled, not by the person) and it is not a retry that already failed.
        const byPerson = _userCancelled.delete(info.id);
        if (tracked && (state === 'completed' || state === 'interrupted' || byPerson)) {
          try { _resumeStoreOf().forget(info.id); }
          catch (err) { console.error('[Downloads] could not clear the kept partial file of ' + info.fileName + ':', err.message); }
        }
        if (readChosen) { const chosen = safeCall(item, 'getSavePath', ''); if (chosen) { savePath = chosen; info.path = chosen; info.fileName = path.basename(chosen); } }
        if (!announced) {
          if (state === 'cancelled') {
            _sources.delete(info.id);
            console.log(`[Downloads] (${tag || 'session'}) Save was cancelled:`, info.fileName);
            return;
          }
          announce();
        }
        // An allowed download that was held: moved to where it belongs.
        if (held) {
          if (state === 'completed') {
            try { _moveFile(heldPath, savePath); }
            catch (err) { console.error('[Downloads] could not move ' + info.fileName + ' out of the holding folder:', err.message); state = 'interrupted'; }
          }
          _removeHeld(heldDir);
        }
        console.log(`[Downloads] (${tag || 'session'}) done:`, info.fileName, state);
        const known = _explain.get(info.id);
        if (known) Object.assign(known, { fileName: info.fileName, path: savePath, state, receivedBytes: safeCall(item, 'getReceivedBytes', 0), totalBytes: safeCall(item, 'getTotalBytes', 0) });
        if (state === 'completed') _noteFile(savePath, ephemeral);
        // What the file really is, from its first bytes and (a zip) its file list (file-content-check.js, T3-010). The answer rides
        // on the event as text; a file that could not be read is said not to be checked, never clean.
        let fileCheck = null;
        if (state === 'completed' && inspectFile) {
          try { fileCheck = inspectFile(savePath, info.fileName); }
          catch (err) { console.error('[Downloads] could not check ' + info.fileName + ':', err.message); fileCheck = { checked: false, detected: '', findings: [], note: 'The file could not be checked: ' + err.message, worst: '' }; }
        }
        // A GitHub release asset: remembered (a private or Tor tab's never is), and the window told.
        let release = null;
        if (state === 'completed' && !ephemeral && releases) {
          release = require('./download-desk').releaseOf(chain);
          if (release) {
            Promise.resolve(releases.note(savePath, release))
              .catch(err => console.error('[Downloads] could not remember the release download ' + info.fileName + ':', err.message));
          }
        }
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
          release,
          fileCheck,
          receivedBytes: safeCall(item, 'getReceivedBytes', 0),
          totalBytes: safeCall(item, 'getTotalBytes', 0)
        });
      };
      if (heldDone) finish(heldDone);
      else item.once('done', (_e, state) => finish(state));
    };
    if (!held) {
      if (resumed) item.setSavePath(savePath);
      begin();
      if (resumed) item.resume();
      return;
    }
    // Blocked, or the Save dialog cancelled: never in the panel, nothing kept.
    const drop = (why) => {
      console.log(`[Downloads] (${tag || 'session'}) not downloading ${what}: ${why}`);
      if (!heldDone) { item.once('done', () => _removeHeld(heldDir)); item.cancel(); }
      _removeHeld(heldDir);
    };
    answer.then(async (ok) => {
      if (!ok) { drop('blocked'); return; }
      if (ask) {
        const chosen = await _askSavePath(owner, savePath, askImage ? 'Save image as' : 'Save as');
        if (!chosen) { drop('Save was cancelled'); return; }
        savePath = chosen;
      } else {
        // Its name may have been taken while it was being asked.
        savePath = _uniqueDownloadPath(path.dirname(savePath), path.basename(savePath));
      }
      begin();
      if (!heldDone) item.resume();
    }).catch((err) => {
      console.error('[Downloads] could not ask about ' + what + '; not downloading it:', err.message);
      drop('the question failed');
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
    // An interrupted download (the connection dropped) is not "paused", but
    // Resume is exactly what it needs; it used to be answered "fine" and left.
    if (!item.isPaused() && safeCall(item, 'getState', '') !== 'interrupted') return { ok: true, paused: false };
    if (!item.canResume()) return { ok: false, error: 'This download cannot be resumed' };
    item.resume();
    return { ok: true, paused: false };
  }
  if (action === 'cancel') { _userCancelled.add(id); item.cancel(); return { ok: true }; }
  throw new Error('Unknown download action: ' + action);
}

if (ipcMain) {
  // A download that explains itself: where it came from, what it really is,
  // what to open it with. The hash is made when asked for, from the finished
  // file on this computer; nothing is looked up.
  ipcMain.handle('downloads:explain', async (_e, id, withHash) => {
    const rec = _explain.get(id);
    if (!rec) throw new Error('Vex no longer has the details of that download');
    const extras = require('./safe-web-extras');
    const out = extras.describeDownload(rec);
    out.state = rec.state;
    out.sha256 = null;
    if (withHash) {
      if (rec.state !== 'completed') throw new Error('The hash can be made once the download has finished');
      if (rec.hash) out.sha256 = rec.hash;
      else {
        const h = await extras.hashFile(rec.path);
        if (h.sha256) { rec.hash = h.sha256; out.sha256 = h.sha256; } else out.hashNote = h.skipped;
      }
    }
    return out;
  });
  ipcMain.handle('downloads:control', (_e, id, action) => {
    try { return control(id, action); }
    catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('downloads:ask-where', (_e, url) => {
    try { return { ok: askWhere(url) }; }
    catch (err) { return { ok: false, error: err.message }; }
  });
  // Save image (js/webview.js): a download Vex starts for you, never counted
  // as one the page started by itself.
  ipcMain.handle('downloads:mine', (_e, url) => {
    try { return { ok: markMine(url) }; }
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
  markMine(url);
  if (page) { page.downloadURL(url); return { ok: true }; }
  if (host) _retryHosts.set(url, host);
  ses.downloadURL(url);
  return { ok: true };
}

return { wireDownloadsOnSession, resumePending, control, askWhere, _takeAsk, markMine, autoDownloadCheck, _liveDownloads, retry, isDownloadedFile, _noteFile, _sources, flushKnown: () => _knownWrites,
  // The finished files Vex downloaded (not a private window's), newest first: the read-only mark-of-the-web check reads them.
  knownFiles: () => [..._loadKnown()], markOfTheWeb: _motw };
}
module.exports = { createDownloadService };
