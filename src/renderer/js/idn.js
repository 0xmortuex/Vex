// === Addresses in other alphabets: shown as written, warned only when false ==
//
// Every xn-- address was shown as punycode and warned about as "not what it
// looks like", münchen.de and пример.рф included (found 2026-10-10). As in
// Chrome, a name in one alphabet is shown in that alphabet; the warning is
// kept for the ones built to be mistaken: letters of two alphabets mixed in
// one name (Cyrillic "а" in "аpple"), or a name made only of Cyrillic or Greek
// letters that look Latin ("раураl") under a Latin ending.
//
// Public: VexIdn.toUnicode(host), VexIdn.suspicious(host) -> reason or null,
// VexIdn.display(host) -> what to show.
(function () {
  // RFC 3492 decoding.
  const BASE = 36, TMIN = 1, TMAX = 26, SKEW = 38, DAMP = 700, INITIAL_BIAS = 72, INITIAL_N = 128;
  function adapt(delta, numPoints, first) {
    let k = 0;
    delta = first ? Math.floor(delta / DAMP) : delta >> 1;
    delta += Math.floor(delta / numPoints);
    for (; delta > ((BASE - TMIN) * TMAX) >> 1; k += BASE) delta = Math.floor(delta / (BASE - TMIN));
    return Math.floor(k + ((BASE - TMIN + 1) * delta) / (delta + SKEW));
  }
  function digit(cp) {
    if (cp >= 48 && cp < 58) return cp - 22;
    if (cp >= 65 && cp < 91) return cp - 65;
    if (cp >= 97 && cp < 123) return cp - 97;
    throw new Error('Not a punycode letter');
  }
  function decodeLabel(input) {
    const out = [];
    let n = INITIAL_N, i = 0, bias = INITIAL_BIAS;
    let basic = input.lastIndexOf('-');
    if (basic < 0) basic = 0;
    for (let j = 0; j < basic; j++) out.push(input.charCodeAt(j));
    for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length;) {
      const oldi = i;
      for (let w = 1, k = BASE; ; k += BASE) {
        if (idx >= input.length) throw new Error('Broken punycode');
        const d = digit(input.charCodeAt(idx++));
        i += d * w;
        const t = k <= bias ? TMIN : (k >= bias + TMAX ? TMAX : k - bias);
        if (d < t) break;
        w *= BASE - t;
      }
      bias = adapt(i - oldi, out.length + 1, oldi === 0);
      n += Math.floor(i / (out.length + 1));
      i %= out.length + 1;
      out.splice(i++, 0, n);
    }
    return String.fromCodePoint(...out);
  }

  function toUnicode(host) {
    return String(host || '').split('.').map(l => {
      if (!/^xn--/i.test(l)) return l;
      try { return decodeLabel(l.slice(4).toLowerCase()); } catch { return l; }
    }).join('.');
  }

  const SCRIPTS = ['Latin', 'Cyrillic', 'Greek', 'Armenian', 'Hebrew', 'Arabic', 'Han', 'Hiragana', 'Katakana', 'Hangul', 'Thai', 'Devanagari', 'Georgian', 'Bopomofo'];
  const RE = Object.fromEntries(SCRIPTS.map(s => [s, new RegExp('\\p{Script=' + s + '}', 'u')]));
  function scriptsOf(label) {
    const found = new Set();
    for (const ch of label) {
      if (!/\p{L}/u.test(ch)) continue;
      const s = SCRIPTS.find(x => RE[x].test(ch));
      found.add(s || 'Other');
    }
    return found;
  }
  // Mixes a language writes with: Japanese, Chinese and Korean with Latin.
  const ALLOWED_MIXES = [['Latin', 'Han', 'Hiragana', 'Katakana'], ['Latin', 'Han', 'Bopomofo'], ['Latin', 'Han', 'Hangul']];
  // Cyrillic and Greek letters that read as Latin ones.
  const LATIN_LOOKING = /^[аеорсухіјѕԁԛԝһӏъьвкмнтгпАВЕКМНОРСТХІЈЅοαιкνρτυχεϲ]+$/u;

  function suspicious(host) {
    const labels = toUnicode(host).toLowerCase().split('.').filter(Boolean);
    const tld = labels[labels.length - 1] || '';
    const tldLatin = /^[a-z0-9-]+$/.test(tld);
    for (const label of labels) {
      const scripts = scriptsOf(label);
      if (scripts.size > 1 && !ALLOWED_MIXES.some(mix => [...scripts].every(s => mix.includes(s)))) {
        return 'This address mixes letters of ' + [...scripts].join(' and ') + ', which is how a fake of a familiar name is made.';
      }
      if (tldLatin && scripts.size === 1 && (scripts.has('Cyrillic') || scripts.has('Greek')) && LATIN_LOOKING.test(label.replace(/-/g, ''))) {
        return 'This address is written in ' + [...scripts][0] + ' letters that look exactly like Latin ones.';
      }
    }
    return null;
  }

  // The host as a person should read it: in its own alphabet, or as punycode
  // when that alphabet is being used to deceive.
  function display(host) {
    const h = String(host || '');
    if (!/(^|\.)xn--/i.test(h)) return h;
    return suspicious(h) ? h : toUnicode(h);
  }

  const api = { toUnicode, suspicious, display, scriptsOf };
  if (typeof window !== 'undefined') window.VexIdn = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
