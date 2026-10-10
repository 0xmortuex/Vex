// === Pop-up blocker, as in Chrome ===
// A window a page opens (window.open, a target=_blank link it clicks by
// script, an about:blank, blob: or data: pop-up) opens only right after you
// clicked or pressed a key on that page, one window per click; anything else
// is blocked unless you allowed pop-ups for the site (site panel › Pop-ups),
// and the address bar says one was blocked (security finding SE5).
//
// Pop-ups were allowed by default before, about:blank/blob:/data: ones always
// (even on a site set to Block), and the "was it the person" test came from
// the page itself (navigator.userActivation, which a page can redefine). The
// test is now main's own: the input Chromium delivered to the page
// (webContents 'input-event', main.js _watchGestures), which a page cannot
// fake.
//
// Vex's own pages (file:, vex:, an extension's page, DevTools) are not judged.

const ACTIVATION_MS = 5000;   // Chromium's transient user activation lifespan
const EXEMPT = /^(?:file|vex|chrome-extension|chrome|devtools):/i;

function originOf(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.origin : null;
  } catch { return null; }
}

// lastGestureAt(contentsId) -> when the page last had a click or key press
// sitePopups(contents, origin) -> 'allow' | 'deny' | undefined, the site's saved answer
function createPopupBlocker({ lastGestureAt, sitePopups, now = () => Date.now() }) {
  const used = new Map();   // contents id -> the gesture a pop-up already used

  // { block, origin }: whether this window request from `contents` (whose page
  // is at openerUrl) is refused.
  function judge(contents, openerUrl) {
    if (EXEMPT.test(openerUrl || '')) return { block: false, origin: null };
    const origin = originOf(openerUrl);
    if (origin && sitePopups(contents, origin) === 'allow') return { block: false, origin };
    const id = contents.id;
    const at = lastGestureAt(id);
    const fresh = Number.isFinite(at) && now() - at >= 0 && now() - at <= ACTIVATION_MS;
    if (fresh && used.get(id) !== at) {
      used.set(id, at);
      return { block: false, origin };
    }
    return { block: true, origin };
  }

  function forget(contentsId) { used.delete(contentsId); }

  return { judge, forget };
}

module.exports = { createPopupBlocker, ACTIVATION_MS, originOf };
