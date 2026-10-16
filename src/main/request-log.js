// === Failed requests of a page, for a bug report ============================
//
// "Copy bug report" (js/bug-bundle.js) lists the requests that failed on the
// page in front: a 4xx or 5xx answer, or a network error. Main sees them from
// the two webRequest events every tab session already has (onCompleted is the
// one shared listener in main.js; onErrorOccurred is new).
//
// Only the ADDRESS is kept, never a header, a cookie, a body or a response.
// The address itself can carry a secret (?token=..., a signed URL, a long id in
// the path), so it is redacted when it is recorded (js/redact.js), not when it
// is shown: a secret is never held in memory here at all. Nothing is stored on
// disk and nothing is sent anywhere; the list belongs to the page and is
// dropped with it.
const { redactUrl } = require('../renderer/js/redact');

function createRequestLog({ max = 40, maxPages = 200, now = () => Date.now() } = {}) {
  const pages = new Map();   // webContents id -> [{ t, method, url, status, error, type }]

  // details: the object webRequest hands over (onCompleted / onErrorOccurred).
  function record(details) {
    const id = details && details.webContentsId;
    if (!id) return false;
    // A main-frame request is a new page: the failures of the page before it are not this one's.
    if (details.resourceType === 'mainFrame') pages.delete(id);
    const status = Number(details.statusCode) || 0;
    const error = details.error ? String(details.error) : '';
    // A request the page itself cancelled (a navigation, an abort) is not a failure.
    if (error === 'net::ERR_ABORTED') return false;
    if (!error && status < 400) return false;
    let list = pages.get(id);
    if (!list) {
      list = [];
      pages.set(id, list);
      if (pages.size > maxPages) pages.delete(pages.keys().next().value);
    }
    list.push({
      t: now(), method: String(details.method || 'GET').toUpperCase().slice(0, 8), url: redactUrl(details.url),
      status: status || null, error: error ? error.slice(0, 80) : '', type: String(details.resourceType || '').slice(0, 24),
    });
    if (list.length > max) list.shift();
    return true;
  }
  const list = (id) => (pages.get(id) || []).slice();
  const forget = (id) => pages.delete(id);
  return { record, list, forget };
}

module.exports = { createRequestLog, redactUrl };
