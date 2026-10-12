// === HTTPS-Only mode: the upgrade rule and the pages it shows ===
// main.js keeps the state (which hosts were upgraded in which tab, which ones
// the person chose to load unencrypted); this file is what can be said
// without it.

function isLocalHost(h) {
  return h === 'localhost' || h === '::1' || h === '[::1]'
    || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /\.local$/i.test(h) || /\.onion$/i.test(h);
}
function isIpLiteral(h) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':'); }

// The https address for a page or frame asked for over http, or null to leave
// it alone (not http, this computer or the local network, an IP address, a
// Tor .onion). A custom port is kept, as Firefox does: http://site:8080 is
// tried as https://site:8080. It was skipped before, so such pages always
// loaded unencrypted.
function upgradeTarget(url, resourceType) {
  if (resourceType !== 'mainFrame' && resourceType !== 'subFrame') return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'http:') return null;
  const hn = u.hostname;
  if (isLocalHost(hn) || isIpLiteral(hn)) return null;
  u.protocol = 'https:';
  if (u.port === '80') u.port = '';
  return { url: u.toString(), bare: hn.replace(/^www\./, '') };
}

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><meta name="color-scheme" content="light dark">
<style>:root{--bg:#f6f7f9;--text:#1b1f27;--muted:#5b6472;--accent:#b4232a;--btn:#1b1f27;--btn-text:#fff}@media (prefers-color-scheme:dark){:root{--bg:#121419;--text:#e6e9ef;--muted:#9aa3b2;--accent:#ff6b6b;--btn:#e6e9ef;--btn-text:#121419}}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{max-width:560px;padding:32px 24px}h1{font-size:21px;margin:0 0 12px;color:var(--accent)}p{margin:0 0 14px}.muted{color:var(--muted);font-size:13.5px}a{color:var(--text)}
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:16px;margin:20px 0 14px}button{font:inherit;font-weight:600;padding:8px 18px;border-radius:8px;border:0;background:var(--btn);color:var(--btn-text);cursor:pointer}</style></head>
<body><main>${body}</main></body></html>`;
}

const back = '<button type="button" id="vex-back" onclick="history.back()">Go back</button>';

// HTTPS-Only asked for the secure version of a site and the site has none.
// The page used to be loaded unencrypted at once, with only a toast.
function noHttpsPage(host, httpUrl) {
  return page('Secure connection not available', `<h1>This site doesn't support a secure connection</h1>
<p><b>${esc(host)}</b> did not answer over HTTPS, so HTTPS-Only mode stopped here instead of loading it unencrypted.</p>
<p>Over an unencrypted connection, anyone on the network (public Wi-Fi, your provider) can read and change what you see and send.</p>
<div class="actions">${back}<a id="vex-continue" href="${esc(httpUrl)}">Continue to the unencrypted site</a></div>
<p class="muted">If you continue, Vex loads <b>${esc(host)}</b> unencrypted until it closes, without asking again.</p>`);
}

// A certificate that does not check out, outside HTTPS-Only (which has its
// own notice with a way through over http). Chromium's own error page said
// only the error's name.
function certErrorPage(host, error) {
  return page('Certificate not valid', `<h1>This site's certificate is not valid</h1>
<p><b>${esc(host)}</b> offered a secure connection whose certificate does not check out${error ? ` (${esc(String(error).replace(/^net::/, ''))})` : ''}. It may be out of date or made for another site, or someone in the middle of your connection may be trying to read it.</p>
<p>Vex did not load the page, so nothing you would send it has left your computer.</p>
<div class="actions">${back}</div>
<p class="muted">If this is your own server or device, give it a certificate your computer trusts.</p>`);
}

const isCertError = (code) => code <= -200 && code >= -299;

module.exports = { upgradeTarget, isLocalHost, isIpLiteral, noHttpsPage, certErrorPage, isCertError };
