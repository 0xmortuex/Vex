// A mailto: link for a new draft with no recipient. Mail apps and Windows
// cut mailto: links at around 2,000 characters, so a long body is shortened
// and says so, rather than arriving truncated mid-word with no sign.
const MAX_URL = 1900;

function mailtoUrl(subject, body) {
  const enc = (s) => encodeURIComponent(String(s || ''));
  const head = 'mailto:?subject=' + enc(String(subject || '').slice(0, 200)) + '&body=';
  let text = String(body || '').replace(/\r?\n/g, '\r\n');
  if ((head + enc(text)).length <= MAX_URL) return head + enc(text);
  const note = '\r\n\r\n[Shortened: the full text is in Vex.]';
  // Cut by whole characters: half an emoji would not encode at all.
  const chars = Array.from(text);
  let lo = 0, hi = chars.length;
  while (lo < hi) {                       // the longest prefix that still fits
    const mid = Math.ceil((lo + hi) / 2);
    if ((head + enc(chars.slice(0, mid).join('') + note)).length <= MAX_URL) lo = mid; else hi = mid - 1;
  }
  return head + enc(chars.slice(0, lo).join('') + note);
}

module.exports = { mailtoUrl, MAX_URL };
