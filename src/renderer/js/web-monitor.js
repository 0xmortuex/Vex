// === Vex Web Monitor: link-rot archiving ===
//
// LinkRot — one-click "Save to Wayback Machine" + "View archived version" so a
//   page you care about (or a dead link) is preserved / recoverable.
// "Watch this page" lives in page-watch.js (PageWatch); the older PageMonitor
// that was here kept a second list of watches and was merged into it.

const LinkRot = {
  saveToWayback(url) {
    if (!url || !/^https?:/i.test(url)) { window.showToast?.('No page to archive'); return; }
    TabManager.createTab('https://web.archive.org/save/' + url, true);
    window.showToast?.('Saving a snapshot to the Wayback Machine…');
  },
  viewArchived(url) {
    if (!url || !/^https?:/i.test(url)) { window.showToast?.('No URL to look up'); return; }
    // /web/2/<url> redirects to the most recent capture.
    TabManager.createTab('https://web.archive.org/web/2/' + url, true);
  },
};

if (typeof window !== 'undefined') { window.LinkRot = LinkRot; }
if (typeof module !== 'undefined' && module.exports) module.exports = { LinkRot };
