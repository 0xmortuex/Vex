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
