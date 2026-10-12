// === Is this Vex's own New Tab page? ========================================
//
// Strict start-page matcher for everything the window hands only to its own
// New Tab page: the VEX_CMD console channel (js/webview.js), Today
// (js/today.js), the tabs from your other devices (js/handoff.js), the theme
// and its picture (js/theme-manager.js), the weather place and shortcuts
// (js/onboarding.js), and the site panel's "New Tab" (js/site-panel.js).
//
// Deliberately stricter than isStartPage() (js/tabs.js, which only sorts tabs
// for display): the canonical vex://start origin, or Vex's own start.html —
// the file beside this window's own index.html. Any file whose path merely
// ended in /renderer/start.html passed before, a download or a file on a
// network share, and so did a web page at that path for some of these (audit
// SE6, 2026-10-10). `own` is this window's address. Mirrors _isVexStartPage
// in preload-webview.js and session-security's isStartPageFile in main.
function _isTrustedStartPage(href, own = (typeof location !== 'undefined' ? location.href : '')) {
  if (typeof href !== 'string' || !href) return false;
  let u, mine;
  try { u = new URL(href); } catch { return false; }
  if (u.protocol === 'vex:' && /^start$/i.test(u.host || '')) return true;
  // A file on this computer, never one on a network share.
  if (u.protocol !== 'file:' || u.host !== '') return false;
  try { mine = new URL('start.html', own); } catch { return false; }
  let a, b;
  try { a = decodeURIComponent(u.pathname); b = decodeURIComponent(mine.pathname); } catch { return false; }
  // A Windows path names the same file whatever its letter case.
  if (/^\/[a-z]:\//i.test(b)) { a = a.toLowerCase(); b = b.toLowerCase(); }
  return a === b;
}

if (typeof window !== 'undefined') window._isTrustedStartPage = _isTrustedStartPage;
if (typeof module !== 'undefined' && module.exports) module.exports = { _isTrustedStartPage };
