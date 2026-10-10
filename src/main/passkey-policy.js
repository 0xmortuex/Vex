// Should this host get the WebAuthn suppression (site-tweaks.js) that stops
// Windows popping its passkey / security-key dialog over a password sign-in?
//
// suppressed: 'vex.passkeySuppressedHosts' — ["*"] (the default) is every site,
//   hostnames narrow it, [] turns it off everywhere.
// allowed: 'vex.passkeyAllowedHosts' — sites the person allowed from the
//   "asked for a passkey" bar (js/passwords.js) or kept in Settings; never
//   suppressed, whatever the other list says.
// A corrupt stored value suppresses nothing rather than throwing.
function passkeySuppressed(suppressed, allowed, hostname) {
  if (Array.isArray(allowed) && allowed.includes(hostname)) return false;
  if (!Array.isArray(suppressed)) return false;
  return suppressed.includes('*') || suppressed.includes(hostname);
}

module.exports = { passkeySuppressed };
