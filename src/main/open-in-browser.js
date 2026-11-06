// === Open a page in another browser =========================================================================
//
// For the sites that turn an Electron browser away (some banks, e-Devlet, DRM players), the person can hand the
// address to the default browser, or to Edge, Chrome, Firefox or Brave when one is installed.
//
// Only an http or https address leaves, 8192 characters at most, and it is passed as ONE element of an argument
// array to a program found at a fixed install path: no shell, no string that is parsed again. Which browsers exist
// is read from those fixed paths (nothing from the registry, nothing the page can influence). Spawning and
// opening are injected so a test never starts a browser.
const path = require('path');
const fs = require('fs');

const MAX_URL = 8192;

// [environment variable, path segments under it]. The first one that exists wins.
const EDGE = ['Microsoft', 'Edge', 'Application', 'msedge.exe'];
const CHROME = ['Google', 'Chrome', 'Application', 'chrome.exe'];
const FIREFOX = ['Mozilla Firefox', 'firefox.exe'];
const BRAVE = ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'];
const BROWSERS = Object.freeze([
  { id: 'edge', name: 'Microsoft Edge', where: [['ProgramFiles(x86)', EDGE], ['ProgramFiles', EDGE]] },
  { id: 'chrome', name: 'Google Chrome', where: [['ProgramFiles', CHROME], ['ProgramFiles(x86)', CHROME], ['LOCALAPPDATA', CHROME]] },
  { id: 'firefox', name: 'Mozilla Firefox', where: [['ProgramFiles', FIREFOX], ['ProgramFiles(x86)', FIREFOX]] },
  { id: 'brave', name: 'Brave', where: [['ProgramFiles', BRAVE], ['ProgramFiles(x86)', BRAVE], ['LOCALAPPDATA', BRAVE]] },
]);

// The address as it will be handed over, or an Error saying why not.
function checkUrl(url) {
  if (typeof url !== 'string' || !url || url.length > MAX_URL) throw new Error('That address is empty or longer than ' + MAX_URL + ' characters');
  let u;
  try { u = new URL(url); } catch { throw new Error('That is not a web address'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http and https addresses can be opened in another browser');
  if (u.href.length > MAX_URL) throw new Error('That address is longer than ' + MAX_URL + ' characters');
  return u.href;
}

// The installed ones: [{ id, name, exe }].
function detect({ env = process.env, exists = (p) => fs.existsSync(p) } = {}) {
  const out = [];
  for (const b of BROWSERS) {
    for (const [variable, rel] of b.where) {
      const base = env[variable];
      if (!base || !path.isAbsolute(base)) continue;
      const exe = path.join(base, ...rel);
      if (exists(exe)) { out.push({ id: b.id, name: b.name, exe }); break; }
    }
  }
  return out;
}

function createOpener({ openDefault, spawn, detectImpl = detect }) {
  if (typeof openDefault !== 'function' || typeof spawn !== 'function') throw new Error('The opener needs openDefault and spawn');
  return {
    list() { return detectImpl().map(({ id, name }) => ({ id, name })); },
    // browser: 'default' or the id of an installed one. Resolves { ok } or { ok:false, error }.
    async open(url, browser) {
      let href;
      try { href = checkUrl(url); } catch (err) { return { ok: false, error: err.message }; }
      if (browser === 'default') {
        await openDefault(href);
        return { ok: true };
      }
      const found = detectImpl().find(b => b.id === browser);
      if (!found) return { ok: false, error: 'That browser is not installed' };
      return new Promise((resolve) => {
        let child;
        try { child = spawn(found.exe, [href], { detached: true, stdio: 'ignore', shell: false }); }
        catch (err) { resolve({ ok: false, error: found.name + ' could not be started: ' + err.message }); return; }
        child.once('error', (err) => resolve({ ok: false, error: found.name + ' could not be started: ' + err.message }));
        child.once('spawn', () => { if (typeof child.unref === 'function') child.unref(); resolve({ ok: true }); });
      });
    },
  };
}

module.exports = { MAX_URL, BROWSERS, checkUrl, detect, createOpener };
