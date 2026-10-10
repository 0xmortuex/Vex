// === Which requests a session refuses: the ad blocker and the per-site switches ===
// Every kind of session (normal tabs and containers, private windows and
// off-the-record/burner tabs, New Identity, Tor) asks the same question in its
// onBeforeRequest, so they cannot drift apart again: private windows, burner,
// New Identity and Tor tabs skipped SITE_REPAIRS and ChatGPT broke there, and
// New Identity skipped the third-party switch (found 2026-10-10, EX10).
//
// The page a request is judged by: for the page itself (a main-frame
// request) the address being loaded, since the tab still shows the page
// before it; for anything else the page the tab shows now. That page was
// remembered for 2 s and never forgotten on navigation, so a page's first
// requests were judged by the page before it: ads blocked on a site whose ads
// were allowed and the other way round, and ChatGPT's repair missed (EX2).
// main.js forgets it when a page commits (pageUrlOf is its cache).
//
// A page the blocker refuses (a click on an ad or sponsored link) left a
// blank tab (EX9). Its address is noted here, the tab shows a page saying so
// with "Go anyway" (main.js), and that one address is let through once, for
// that tab, when the person clicks it.

const GO_ANYWAY_MS = 2 * 60 * 1000;

function createAdVerdict(deps) {
  const now = deps.now || Date.now;
  const goAnyway = new Map();      // page id -> { url, until }
  const blockedPage = new Map();   // page id -> the page address the blocker refused

  function pageOf(details) {
    return details.resourceType === 'mainFrame' ? details.url : deps.pageUrlOf(details.webContentsId);
  }

  // null (let it through), 'third-party' (the site's third-party switch) or
  // 'ad' (the blocker). opts.thirdParty: whether this session honours the
  // site's third-party switch.
  function judge(details, ses, opts = {}) {
    const page = pageOf(details);
    if (details.resourceType === 'mainFrame') {
      const g = goAnyway.get(details.webContentsId);
      if (g && g.url === details.url) {
        goAnyway.delete(details.webContentsId);
        if (g.until >= now()) return null;
      }
    }
    if (opts.thirdParty !== false && deps.blocksThirdParty(page, details.url)) return 'third-party';
    if (!deps.enabled()) return null;
    if (!(deps.engineBlocks(details) === true || deps.shouldBlock(details.url))) return null;
    if (deps.repairAllows(details.url, page)) return null;
    if (deps.adsAllowedOn(page, ses)) return null;
    if (details.resourceType === 'mainFrame' && details.webContentsId) {
      blockedPage.set(details.webContentsId, details.url);
      // A cancelled page fires no did-fail-load in a webview (measured on
      // Electron 42): the tab just stays blank, so main is told here.
      if (deps.onBlockedPage) deps.onBlockedPage(details.webContentsId, details.url);
    }
    return 'ad';
  }

  // Whether the tab is navigating to the page the blocker refused in it (its
  // "Go anyway" link). Asked on every navigation the page itself starts
  // (main.js, will-navigate); any answer forgets the refused page.
  function takeBlockedPage(id, url) {
    const was = blockedPage.get(id);
    if (was === undefined) return null;
    blockedPage.delete(id);
    return was === url ? was : null;
  }

  // "Go anyway" on the blocked page: that address, in that tab, once.
  function allowOnce(id, url) { goAnyway.set(id, { url, until: now() + GO_ANYWAY_MS }); }

  function forget(id) { goAnyway.delete(id); blockedPage.delete(id); }

  return { judge, pageOf, takeBlockedPage, allowOnce, forget };
}

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The page shown in place of one the ad blocker refused.
function blockedPageHtml(url) {
  let host;
  try { host = new URL(url).host; } catch { host = ''; }
  return `<!doctype html><html><head><meta charset="utf-8"><title>Blocked by Vex's ad blocker</title><meta name="color-scheme" content="light dark">
<style>:root{--bg:#f6f7f9;--text:#1b1f27;--muted:#5b6472;--accent:#1b1f27;--btn:#1b1f27;--btn-text:#fff}@media (prefers-color-scheme:dark){:root{--bg:#121419;--text:#e6e9ef;--muted:#9aa3b2;--accent:#e6e9ef;--btn:#e6e9ef;--btn-text:#121419}}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{max-width:560px;padding:32px 24px}h1{font-size:21px;margin:0 0 12px;color:var(--accent)}p{margin:0 0 14px}.muted{color:var(--muted);font-size:13.5px;word-break:break-all}a{color:var(--text)}
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:16px;margin:20px 0 14px}button{font:inherit;font-weight:600;padding:8px 18px;border-radius:8px;border:0;background:var(--btn);color:var(--btn-text);cursor:pointer}</style></head>
<body><main><h1>Blocked by Vex's ad blocker</h1>
<p><b>${esc(host || url)}</b> is on the ad and tracker lists Vex blocks, so this page was not loaded. Ads and sponsored links often go through an address like this one before the shop or site they point to.</p>
<div class="actions"><button type="button" id="vex-back" onclick="history.back()">Go back</button><a id="vex-go-anyway" href="${esc(url)}">Go anyway</a></div>
<p class="muted">${esc(url)}</p>
</main></body></html>`;
}

module.exports = { createAdVerdict, blockedPageHtml, GO_ANYWAY_MS };
