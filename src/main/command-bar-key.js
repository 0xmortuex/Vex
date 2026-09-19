// Ctrl+K opens Vex's command bar — including while a page has the focus,
// which it has most of the time (the New Tab page is a page too). Before this
// was passed up, Ctrl+K did nothing until you had clicked Vex's own toolbar.
//
// The exception is a site whose own Ctrl+K is its main shortcut: Discord's
// quick switcher, Slack's. There the key stays with the site; the command-bar
// button still opens Vex's.
const SITES_OWN_CTRL_K = ['discord.com', 'slack.com'];

function siteOwnsCtrlK(url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  return SITES_OWN_CTRL_K.some(d => host === d || host.endsWith('.' + d));
}

function isCommandBarKey(input, url) {
  if (!input || input.type !== 'keyDown') return false;
  if (!(input.control || input.meta) || input.alt || input.shift) return false;
  if (String(input.key || '').toLowerCase() !== 'k') return false;
  return !siteOwnsCtrlK(url);
}

module.exports = { isCommandBarKey, siteOwnsCtrlK, SITES_OWN_CTRL_K };
