// A stand-in for the page window a run uses: a jsdom document per address, the
// same evaluate / load / settle / screenshot surface the Electron driver has.
// Pages are plain HTML; a page may set window.__goto = '/next' (from an inline
// handler) to say "the click navigated", the way a link or a form would.
const { JSDOM } = require('jsdom');

function createFakeDriver(pages, { origin = 'http://127.0.0.1:9', onClick } = {}) {
  let dom = null;
  let url = null;
  const loads = [];
  const calls = [];
  const driver = {
    loads, calls, clicks: [],
    async load(u) {
      loads.push(u);
      const key = new URL(u, origin).pathname + new URL(u, origin).search;
      const html = pages[key] ?? pages[new URL(u, origin).pathname];
      if (html == null) throw new Error('net::ERR_NAME_NOT_RESOLVED ' + u);
      if (dom) dom.window.close();
      dom = new JSDOM(html, { url: new URL(u, origin).href, runScripts: 'dangerously', pretendToBeVisual: true });
      url = dom.window.location.href;
    },
    async evaluate(code) {
      if (!dom) throw new Error('no page loaded');
      calls.push(code.length);
      const r = dom.window.eval(code);
      return r && typeof r.then === 'function' ? await r : JSON.parse(JSON.stringify(r === undefined ? null : r));
    },
    async settle() {
      const w = dom && dom.window;
      if (w && w.__goto) { const to = w.__goto; w.__goto = null; await driver.load(new URL(to, url).href); }
    },
    async screenshot() { return dom ? 'data:image/jpeg;base64,FAKE' : null; },
    async reveal() { driver.revealed = (driver.revealed || 0) + 1; },
    currentUrl() { return url; },
    async close() { if (dom) dom.window.close(); dom = null; driver.closed = true; },
    get document() { return dom.window.document; },
    get window() { return dom.window; },
  };
  return driver;
}

// A recording with sensible defaults for tests.
function recording(steps, extra) {
  return { name: 'Test', partition: 'persist:main', steps, ...(extra || {}) };
}
const open = (url) => ({ type: 'open', url });
const click = (name, extra) => ({ type: 'click', target: { role: 'button', name, tag: 'button', ...(extra && extra.target) }, ...(extra || {}) });

module.exports = { createFakeDriver, recording, open, click };
