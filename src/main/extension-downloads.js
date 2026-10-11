// === chrome.downloads for extensions, from Vex's own downloads ===
// Electron has no chrome.downloads: an extension that saves a file
// ("download all images", a video saver) or lists what was downloaded did
// nothing (found 2026-10-10). This keeps Vex's downloads as Chrome describes
// them, from the events the downloads panel gets (main.js
// _broadcastDownloadEvent: normal and container tabs, never a private or Tor
// one), so download(), search(), pause(), resume(), cancel() and the
// onCreated / onChanged events can answer. Opening, showing, erasing and
// deleting files are not offered to extensions.

const MAX_ITEMS = 1000;

function createExtensionDownloads({ now = Date.now } = {}) {
  const byVex = new Map();   // Vex's download id -> Chrome's DownloadItem (+ _vex)
  const byId = new Map();    // Chrome's id -> Vex's id
  const waiting = [];        // downloads an extension asked for: { url, resolve, reject, timer }
  let seq = 0;

  const copy = (item) => { const out = { ...item }; delete out._vex; return out; };

  // A download-panel event; answers what extensions are to be told, or null.
  // urlChain: every address the download went through (DownloadItem
  // getURLChain), first to last. The panel names only the last, so a download
  // an extension asked for at an address that redirects (most "download"
  // links) was never matched: download() failed after 15 s while the file
  // was saved (found 2026-10-11).
  function note(channel, data, urlChain = []) {
    if (!data || typeof data.id !== 'string') return null;
    if (channel === 'download-started') {
      const chain = (Array.isArray(urlChain) ? urlChain : []).filter(u => typeof u === 'string' && u);
      const item = {
        id: ++seq, _vex: data.id, url: chain[0] || data.url || '', finalUrl: data.url || chain[chain.length - 1] || '', referrer: '', filename: data.path || '',
        incognito: false, danger: 'safe', mime: '', startTime: new Date(now()).toISOString(), state: 'in_progress',
        paused: false, canResume: false, bytesReceived: 0, totalBytes: data.totalBytes > 0 ? data.totalBytes : -1,
        fileSize: data.totalBytes > 0 ? data.totalBytes : -1, exists: true,
      };
      byVex.set(data.id, item); byId.set(item.id, data.id);
      while (byVex.size > MAX_ITEMS) { const [v, it] = byVex.entries().next().value; byVex.delete(v); byId.delete(it.id); }
      const w = waiting.findIndex(x => x.url === item.url || x.url === item.finalUrl || chain.includes(x.url));
      if (w !== -1) { const [x] = waiting.splice(w, 1); clearTimeout(x.timer); x.resolve(item.id); }
      return { event: 'downloads.onCreated', args: [copy(item)], vexId: data.id };
    }
    const item = byVex.get(data.id);
    if (!item) return null;
    const delta = { id: item.id };
    const change = (key, value) => {
      if (value === undefined || item[key] === value) return;
      delta[key] = { previous: item[key], current: value };
      item[key] = value;
    };
    if (channel === 'download-progress') {
      item.bytesReceived = data.receivedBytes || 0;
      if (data.totalBytes > 0) { change('totalBytes', data.totalBytes); change('fileSize', data.totalBytes); }
      change('paused', !!data.paused);
      change('canResume', !!data.canResume);
      if (data.state === 'interrupted') { change('state', 'interrupted'); change('error', 'NETWORK_FAILED'); }
    } else if (channel === 'download-complete') {
      item.bytesReceived = data.receivedBytes || item.bytesReceived;
      if (data.path) change('filename', data.path);
      const done = data.state === 'completed';
      change('state', done ? 'complete' : 'interrupted');
      if (!done) change('error', data.state === 'cancelled' ? 'USER_CANCELED' : 'NETWORK_FAILED');
      change('paused', false);
      change('canResume', false);
      change('endTime', new Date(now()).toISOString());
      if (done && data.receivedBytes > 0) { change('totalBytes', data.receivedBytes); change('fileSize', data.receivedBytes); }
    } else return null;
    return Object.keys(delta).length > 1 ? { event: 'downloads.onChanged', args: [delta], vexId: data.id } : null;
  }

  // The id of the download started for `url`, once it starts.
  function waitFor(url, ms) {
    return new Promise((resolve, reject) => {
      const x = { url, resolve, reject };
      x.timer = setTimeout(() => {
        const i = waiting.indexOf(x);
        if (i !== -1) waiting.splice(i, 1);
        reject(new Error('The download did not start'));
      }, ms);
      waiting.push(x);
    });
  }

  // Chrome's DownloadQuery, the parts that say which and how many.
  function search(q) {
    q = q || {};
    let list = [...byVex.values()];
    const eq = (k) => { if (q[k] !== undefined) list = list.filter(i => i[k] === q[k]); };
    ['id', 'url', 'finalUrl', 'filename', 'state', 'paused', 'mime', 'exists', 'danger', 'error'].forEach(eq);
    if (typeof q.query === 'object' && Array.isArray(q.query)) {
      for (const term of q.query) {
        const t = String(term);
        list = list.filter(i => (t.startsWith('-') ? !(i.url + i.filename).includes(t.slice(1)) : (i.url + i.filename).includes(t)));
      }
    }
    if (q.urlRegex) { const re = new RegExp(q.urlRegex); list = list.filter(i => re.test(i.url)); }
    if (q.filenameRegex) { const re = new RegExp(q.filenameRegex); list = list.filter(i => re.test(i.filename)); }
    const order = Array.isArray(q.orderBy) && q.orderBy.length ? q.orderBy : ['-startTime'];
    list.sort((a, b) => {
      for (const o of order) {
        const desc = o.startsWith('-'); const k = desc ? o.slice(1) : o;
        if (a[k] === b[k]) continue;
        return (a[k] < b[k] ? -1 : 1) * (desc ? -1 : 1);
      }
      return b.id - a.id;
    });
    const limit = Number.isInteger(q.limit) && q.limit > 0 ? q.limit : (q.limit === 0 ? list.length : 1000);
    return list.slice(0, limit).map(copy);
  }

  function vexIdOf(id) {
    const v = byId.get(id);
    if (!v) throw new Error(`Invalid download id ${id}`);
    return v;
  }

  return { note, waitFor, search, vexIdOf };
}

module.exports = { createExtensionDownloads };
