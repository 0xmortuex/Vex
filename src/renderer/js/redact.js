// === Redaction of addresses and text for anything you might paste somewhere ====
//
// Shared by the bug report (js/bug-bundle.js) and the failed-request log in main
// (main/request-log.js requires this file). Pure: no storage, no network.
//
// redactUrl(address): drops credentials and the fragment, hides query values whose
//   NAME says secret (token, key, auth, session, signature, code ...) and values
//   that LOOK like a token (24+ characters of letters, digits and - _ = . + / %),
//   and long id-like path segments.
// redactText(text): the same idea for free text (a console message): bearer
//   tokens, JWTs, GitHub / OpenAI / AWS keys, Discord tokens, e-mail addresses,
//   user names in Windows paths, and every address inside it via redactUrl.
(function () {
  const SENSITIVE_KEY = /(token|secret|passw|pwd|auth|session|sid$|signature|^sig$|credential|key|jwt|bearer|^code$|otp|cookie|csrf|xsrf|nonce|ticket|^hash$|^state$)/i;
  const TOKENISH = /^[A-Za-z0-9_\-=.+/%]{24,}$/;
  const MAX_URL = 300;

  function redactSegment(seg) {
    // A long run of letters and digits that holds a digit is an id or a token, not a word.
    return seg.length >= 32 && /^[A-Za-z0-9_-]+$/.test(seg) && /\d/.test(seg) ? '[redacted]' : seg;
  }

  function redactUrl(raw) {
    let u;
    try { u = new URL(String(raw)); } catch { return '[address not readable]'; }
    if (!/^(?:https?|wss?):$/.test(u.protocol)) return u.protocol + '//[not shown]';
    const path = u.pathname.split('/').map(redactSegment).join('/');
    const pairs = [];
    for (const [k, v] of u.searchParams) {
      const hide = SENSITIVE_KEY.test(k) || TOKENISH.test(v);
      pairs.push(encodeURIComponent(k) + (v === '' ? '' : '=' + (hide ? '[redacted]' : encodeURIComponent(v))));
    }
    const out = u.protocol + '//' + u.host + path + (pairs.length ? '?' + pairs.join('&') : '');
    return out.length > MAX_URL ? out.slice(0, MAX_URL) + '...' : out;
  }

  const TEXT_RULES = [
    [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]'],
    [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, '[redacted jwt]'],
    [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[redacted github token]'],
    [/\bsk-[A-Za-z0-9_-]{16,}/g, '[redacted key]'],
    [/\bAKIA[0-9A-Z]{16}\b/g, '[redacted aws key]'],
    [/\b[MN][A-Za-z\d]{23,25}\.[\w-]{6}\.[\w-]{27,}/g, '[redacted discord token]'],
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted email]'],
    [/([A-Za-z]:\\Users\\)[^\\\s"']+/gi, '$1~'],
  ];
  function redactText(text, max = 400) {
    let s = String(text == null ? '' : text);
    s = s.replace(/\bhttps?:\/\/[^\s"'<>)]+/gi, (m) => redactUrl(m));
    for (const [rx, to] of TEXT_RULES) s = s.replace(rx, to);
    return s.length > max ? s.slice(0, max) + '...' : s;
  }

  const api = { redactUrl, redactText };
  if (typeof window !== 'undefined') window.VexRedact = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
