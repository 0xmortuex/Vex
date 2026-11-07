// === Vex Mobile — the files a page made itself ===
//
// Android's DownloadManager fetches a URL over the network. A page that builds a
// file in the browser — an exported spreadsheet, a generated image, a PDF a form
// produced — hands the download a blob: or data: URL, which DownloadManager
// refuses outright. So those downloads simply failed, with "Download failed" and
// no way to get the file.
//
// This reads the bytes where they are. A data: URL the chrome can decode itself.
// A blob: URL belongs to the page's own origin and nothing outside the page can
// read it, so the page is asked: a script fetches its own blob, turns it into
// base64 and leaves it on the window, and the chrome collects it. That round trip
// is why there is a size cap — the bytes travel as a string through the bridge.

const VexDownloads = (() => {
  // 12 MB of file is 16 MB of base64 through the bridge. Past that the string
  // itself is the problem, and a page-made file that big is rare enough to say
  // no to plainly rather than to fail slowly at.
  const CAP = 12 * 1024 * 1024;

  // Stream jobs this run of Vex started: jobId -> { state, done, total, bytes,
  // rowId, why }. Native forgets a job when Vex is killed, so this does too.
  const streams = new Map();

  // Runs in the page. Starts the read and leaves the answer on the window,
  // because evaluateJavascript hands back what the expression returned and a
  // promise is not an answer.
  const read = (url, cap) => `(function(){
  window.__vexDownload = { state: 'reading' };
  fetch(${JSON.stringify(url)}).then(function (response) {
    return response.blob();
  }).then(function (blob) {
    if (blob.size > ${cap}) { window.__vexDownload = { state: 'too-big', size: blob.size }; return; }
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result || '');
      var comma = text.indexOf(',');
      window.__vexDownload = { state: 'done', base64: comma < 0 ? '' : text.slice(comma + 1), size: blob.size };
    };
    reader.onerror = function () { window.__vexDownload = { state: 'failed' }; };
    reader.readAsDataURL(blob);
  }).catch(function () { window.__vexDownload = { state: 'failed' }; });
  return 'started';
})()`;

  const COLLECT = `(function(){
  var held = window.__vexDownload;
  if (!held || held.state === 'reading') return JSON.stringify({ state: 'reading' });
  window.__vexDownload = null;
  return JSON.stringify(held);
})()`;

  function unwrap(raw) {
    let value = raw;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (typeof value !== 'string') break;
      try { value = JSON.parse(value); } catch { break; }
    }
    return value && typeof value === 'object' ? value : null;
  }

  // A data: URL is the chrome's to decode; no page needed.
  function fromDataUrl(url) {
    const comma = String(url || '').indexOf(',');
    if (comma < 0) return null;
    const head = url.slice(5, comma);
    const body = url.slice(comma + 1);
    if (/;base64/i.test(head)) return body;
    try { return btoa(unescape(encodeURIComponent(decodeURIComponent(body)))); }
    catch { return null; }
  }

  return {
    CAP,

    /**
     * Hand a URL to Android's download queue on the chrome's behalf — a PDF it
     * was showing, a video file — and list it with the rest. Returns the row,
     * or null with the reason already said.
     */
    async queue(tab, url, filename) {
      try {
        const answer = await VexBridge.saveFile(tab.id, url, filename);
        const row = {
          url, filename, size: 0, at: Date.now(),
          downloadId: answer && answer.downloadId ? String(answer.downloadId) : '',
          incognito: !!tab.incognito
        };
        row.id = await VexDB.add('downloads', row);
        VexUI.toast('Downloading ' + filename, 3500, { label: 'Downloads', run: () => VexPanels.downloads() });
        return row;
      } catch (error) {
        VexUI.toast((error && error.message) || 'That could not be downloaded', 4000);
        return null;
      }
    },

    /**
     * Save an HLS stream as one file. The job runs natively; its progress is
     * kept here, in memory, for the downloads list to draw, and the row in
     * IndexedDB is finished off when the file is whole.
     */
    async stream(tab, url, filename) {
      // A long save shows its progress in the notification shade, which on
      // Android 13 and later needs asking for. Asked here, where the reason is
      // plain; the save goes ahead whatever the answer.
      try { await VexBridge.requestPermission('notifications'); } catch { /* the save does not need it */ }
      let answer;
      try { answer = await VexBridge.downloadStream(tab.id, url, filename); }
      catch (error) {
        VexUI.toast((error && error.message) || 'That video could not be saved', 4000);
        return null;
      }
      const jobId = answer && answer.jobId;
      if (!jobId) { VexUI.toast('That video could not be saved'); return null; }
      const row = {
        url, filename, size: 0, at: Date.now(), streamJob: jobId, pageUrl: tab.incognito ? '' : (tab.url || ''),
        incognito: !!tab.incognito
      };
      // Registered before the row is written: a playlist that fails at once
      // can answer before IndexedDB does, and its event must find the job.
      const job = { state: 'running', done: 0, total: 0, bytes: 0, rowId: null };
      streams.set(jobId, job);
      job.ready = VexDB.add('downloads', row).then(id => { job.rowId = id; row.id = id; return id; });
      await job.ready;
      VexUI.toast('Saving the video — it is a few hundred pieces, so it takes a while', 4500,
        { label: 'Downloads', run: () => VexPanels.downloads() });
      return row;
    },

    /** What a stream job is doing now; null once Vex has restarted. */
    /**
     * The private tabs are all closed: their downloads leave the list, as in
     * Chrome. The files stay in Downloads — you saved them on purpose — but the
     * list of what you fetched in private is not something to keep.
     */
    async forgetPrivate() {
      const rows = await VexDB.scan('downloads', { limit: 2000 }).catch(() => []);
      let gone = 0;
      for (const row of rows) {
        if (!row || !row.incognito || row.id == null) continue;
        await VexDB.delete('downloads', row.id).catch(() => {});
        gone++;
      }
      return gone;
    },

    streamState(jobId) { return streams.get(jobId) || null; },

    // Stopped by hand is a regret, not a failure: the row goes with it.
    async cancelStream(jobId) {
      const job = streams.get(jobId);
      if (job) job.state = 'cancelled';
      await VexBridge.cancelStream(jobId);
      if (job && job.ready) await VexDB.delete('downloads', await job.ready);
    },

    /** Wired once at boot. */
    bind() {
      VexBridge.on('streamProgress', data => {
        const job = data && streams.get(data.jobId);
        if (!job || job.state !== 'running') return;
        job.done = Number(data.done) || 0;
        job.total = Number(data.total) || 0;
        job.bytes = Number(data.bytes) || 0;
      });
      VexBridge.on('streamDone', async data => {
        const job = data && streams.get(data.jobId);
        if (!job) return;
        job.state = 'done';
        job.bytes = Number(data.bytes) || job.bytes;
        await job.ready;
        const row = await VexDB.get('downloads', job.rowId);
        if (row) {
          await VexDB.put('downloads', Object.assign(row, {
            localUri: data.localUri || '', size: job.bytes, streamDone: true
          }));
        }
        VexUI.toast('Saved ' + ((row && row.filename) || 'the video') + ' to Downloads', 4500, data.localUri ? {
          label: 'Open',
          run: () => VexBridge.openDownload({ localUri: data.localUri }).catch(error => VexUI.toast(error.message))
        } : undefined);
      });
      VexBridge.on('streamFailed', async data => {
        const job = data && streams.get(data.jobId);
        if (!job) return;
        const cancelled = job.state === 'cancelled' || data.message === 'cancelled';
        job.state = cancelled ? 'cancelled' : 'failed';
        job.why = data.message || '';
        await job.ready;
        const row = await VexDB.get('downloads', job.rowId);
        if (cancelled) { if (row) await VexDB.delete('downloads', job.rowId); return; }
        if (row) await VexDB.put('downloads', Object.assign(row, { streamFailed: job.why || 'failed' }));
        VexUI.toast(job.why || 'The video could not be saved', 5000);
      });
    },

    /**
     * Save a blob: or data: download. Returns { ok } or { ok: false, why } — a
     * sentence, because every way this fails is something to tell someone.
     */
    async saveLocal({ id, url, filename, mimeType }) {
      const name = filename || 'download';
      if (String(url || '').startsWith('data:')) {
        const base64 = fromDataUrl(url);
        if (!base64) return { ok: false, why: 'That file could not be read' };
        if (base64.length * 0.75 > CAP) return { ok: false, why: 'That file is too big for Vex to save' };
        try {
          const saved = await VexBridge.saveData(id, name, mimeType || '', base64);
          return { ok: true, localUri: (saved && saved.localUri) || '' };
        } catch (error) { return { ok: false, why: error.message || 'It could not be saved' }; }
      }

      // blob: — only the page can read it.
      try {
        await VexBridge.evaluate(id, read(url, CAP));
      } catch { return { ok: false, why: 'That file could not be read' }; }

      // Polled, because the page answers when the FileReader finishes. Ten
      // seconds is longer than reading anything under the cap takes.
      for (let attempt = 0; attempt < 80; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 125));
        let held = null;
        try { held = unwrap((await VexBridge.evaluate(id, COLLECT)).result); } catch { held = null; }
        if (!held || held.state === 'reading') continue;
        if (held.state === 'too-big') return { ok: false, why: 'That file is too big for Vex to save' };
        if (held.state !== 'done' || !held.base64) return { ok: false, why: 'That file could not be read' };
        try {
          const saved = await VexBridge.saveData(id, name, mimeType || '', held.base64);
          return { ok: true, localUri: (saved && saved.localUri) || '' };
        } catch (error) { return { ok: false, why: error.message || 'It could not be saved' }; }
      }
      return { ok: false, why: 'That file took too long to read' };
    }
  };
})();

if (typeof window !== 'undefined') window.VexDownloads = VexDownloads;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDownloads };
