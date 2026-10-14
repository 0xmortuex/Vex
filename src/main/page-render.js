// === A page, read as a hidden tab would show it =============================
//
// A watched page that builds itself with JavaScript (a shop, a status board, a
// single-page app) is empty to a plain fetch. A watch can ask for this read
// instead: the page is loaded ONCE in a window nobody sees, given a moment to
// settle, its text (or one part of it) is read out, and the window is closed.
//
//   * No interaction at all: nothing is clicked, typed or submitted, and the
//     window never has focus. It is a load and a read.
//   * The session of the main window, so the site rules, the ad blocker, the
//     HTTPS-only upgrade and the network routing apply as they do to a tab —
//     and Vex's own window already refuses a routed site (js/page-watch.js).
//   * Bounded: one at a time, a deadline for the whole thing, a cap on the
//     text, and a page that is a download or not a web page is refused before
//     it is loaded.
//   * A site whose JavaScript is switched off in its site settings is not
//     rendered: the read would be the plain one, so the watch says so.
//   * Never this computer or the home network: those are read directly.
//
// Everything else is injected, so the module is unit-tested without Electron.
const TIMEOUT_MS = 25000;
const SETTLE_MS = 2500;
const MAX_CHARS = 400000;

// The script run in the page: the whole body's text, or one part of it —
// by selector, or by the first words that were picked when the selector no
// longer matches.
function readerScript(selector, anchor, max) {
  return `(function (sel, anchor, max) {
    function norm(s) { return String(s || '').replace(/\\s+/g, ' ').trim().toLowerCase(); }
    var el = null;
    if (sel) {
      try { el = document.querySelector(sel); } catch (e) { return { invalid: true, found: false, text: '', title: document.title }; }
      var want = norm(anchor);
      if (!el && want.length >= 6) {
        var best = null, bestLen = Infinity, all = document.body ? document.body.querySelectorAll('*') : [];
        for (var i = 0; i < all.length; i++) {
          var n = all[i];
          if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(n.tagName)) continue;
          var t = norm(n.textContent);
          if (t.length < bestLen && t.indexOf(want) >= 0) { best = n; bestLen = t.length; }
        }
        el = best;
      }
      if (!el) return { found: false, text: '', title: document.title };
    } else {
      el = document.body || document.documentElement;
    }
    var text = (el.innerText != null ? el.innerText : el.textContent) || '';
    return { found: true, text: String(text).slice(0, max), title: document.title };
  })(${JSON.stringify(String(selector || ''))}, ${JSON.stringify(String(anchor || ''))}, ${Number(max) || MAX_CHARS})`;
}

function createPageRender({ BrowserWindow, getSession, scriptsOff, isPrivateHost, timeoutMs = TIMEOUT_MS, settleMs = SETTLE_MS, maxChars = MAX_CHARS, wait = (ms) => new Promise(r => setTimeout(r, ms)) }) {
  let queue = Promise.resolve();

  // What the address would be, before it is loaded: a file or a download is
  // refused rather than saved into the Downloads folder by a hidden window.
  async function probe(url) {
    const ses = getSession();
    if (!ses || typeof ses.fetch !== 'function') return null;
    let res;
    try { res = await ses.fetch(url, { method: 'HEAD', redirect: 'follow' }); }
    catch { return null; }   // a server that refuses HEAD is judged by the load itself
    const type = String(res.headers.get('content-type') || '').toLowerCase();
    const disp = String(res.headers.get('content-disposition') || '').toLowerCase();
    if (/^\s*attachment/.test(disp)) throw new Error('That address is a download, not a page — open it in a tab instead');
    if (type && !/(^|\/)(?:x?html|xml|plain|json)\b|\+xml|^text\//.test(type)) throw new Error('That address is a ' + (type.split(';')[0] || 'file') + ', not a page — open it in a tab instead');
    return type;
  }

  async function once(url, selector, anchor) {
    let u;
    try { u = new URL(String(url)); } catch { throw new Error('Not a web address: ' + String(url).slice(0, 200)); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only a web page can be read');
    if (isPrivateHost(u.hostname)) throw new Error('A page on this computer or the home network is read directly, not through a hidden tab');
    if (scriptsOff(u.href)) throw new Error('JavaScript is switched off for this site, so a hidden tab would show the same page as the plain read');
    await probe(u.href);

    const win = new BrowserWindow({
      show: false, width: 1280, height: 900, skipTaskbar: true, focusable: false,
      webPreferences: {
        session: getSession(), sandbox: true, contextIsolation: true, nodeIntegration: false,
        webSecurity: true, spellcheck: false, backgroundThrottling: false, autoplayPolicy: 'user-gesture-required',
      },
    });
    const wc = win.webContents;
    let timer = null;
    try {
      wc.setAudioMuted(true);
      wc.setWindowOpenHandler(() => ({ action: 'deny' }));
      wc.on('will-navigate', (e, to) => { if (!/^https?:/i.test(String(to))) e.preventDefault(); });
      let status = 0;
      wc.on('did-navigate', (_e, _url, code) => { if (Number.isFinite(code)) status = code; });
      const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The page took too long to load')), timeoutMs); });
      await Promise.race([wc.loadURL(u.href), deadline]);
      if (status >= 400) throw new Error('HTTP ' + status + ' from ' + u.hostname);
      // A page built by script is not there at the load event.
      await Promise.race([wait(settleMs), deadline]);
      const r = await Promise.race([wc.executeJavaScript(readerScript(selector, anchor, maxChars), false), deadline]);
      if (!r || typeof r !== 'object') throw new Error('The page could not be read');
      if (r.invalid) throw new Error('"' + selector + '" is not a valid selector');
      return { text: String(r.text || '').slice(0, maxChars), found: r.found === true, title: String(r.title || '').slice(0, 300), finalUrl: wc.getURL ? wc.getURL() : u.href };
    } finally {
      if (timer) clearTimeout(timer);
      try { if (!win.isDestroyed()) win.destroy(); } catch (err) { console.error('[PageRender] could not close the hidden window:', err && err.message); }
    }
  }

  return {
    // One page at a time: sixteen gigabytes are shared with the user's tabs.
    render(url, { selector = '', anchor = '' } = {}) {
      const run = queue.then(() => once(url, selector, anchor));
      queue = run.catch(() => {});
      return run;
    },
    readerScript,
  };
}

module.exports = { createPageRender, readerScript, TIMEOUT_MS, SETTLE_MS, MAX_CHARS };
