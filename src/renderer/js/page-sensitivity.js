// === Pages a page-changing tool must stay away from ============================
//
// A banking, payment, sign-in, mail or health page is the one place a hidden
// element or a script that edits the page can cost money or a locked account.
// This says, in a plain sentence, why an address is one of those, or null.
// It is the same list the archive library keeps in src/main/archive-library.js
// (sensitiveReason), written here for the window; the element zapper uses it.
//
//   VexPageSensitivity.reason(url)  ->  string | null

const VexPageSensitivity = {
  HOSTS: [
    /bank/i,
    /(^|\.)(paypal|stripe|venmo|wise|revolut|klarna|chase|wellsfargo|citi|capitalone|schwab|fidelity|vanguard|hsbc|barclays|coinbase|binance|kraken)\./i,
    /(mychart|myhealth|patient|healthcare|medical|clinic|hospital|pharmacy)/i,
    /^(mail|webmail|inbox|outlook|accounts|login|signin|sso|auth|secure|my|id|pay|payments?|checkout|billing|wallet)\./i,
    /(^|\.)(mail\.google\.com|outlook\.live\.com|outlook\.office\.com|outlook\.office365\.com|mail\.yahoo\.com|proton\.me|protonmail\.com)$/i,
  ],
  PATH: /\/(log-?in|sign-?in|sign-?on|sign-?up|register|account|my-?account|checkout|cart|payment|payments|billing|password|reset|verify|oauth|2fa|mfa|admin|inbox)(\/|$|\?|#)/i,
  QUERY: /(^|[?&])(password|passwd|pwd|token|access_token|id_token|session|sessionid|sid|code|otp|secret|api_?key|auth)=/i,

  reason(url) {
    let u;
    try { u = new URL(String(url)); } catch { return 'That is not a web address'; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Only web pages can be changed this way';
    const host = u.hostname.toLowerCase();
    if (this.HOSTS.some(re => re.test(host))) return 'This looks like a banking, payment, sign-in, mail or health site, so it is left alone';
    if (this.PATH.test(u.pathname)) return 'This looks like a sign-in, account or payment page, so it is left alone';
    if (this.QUERY.test(u.search)) return 'This address carries a token or code, so it is left alone';
    return null;
  },
};

if (typeof window !== 'undefined') window.VexPageSensitivity = VexPageSensitivity;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPageSensitivity };
