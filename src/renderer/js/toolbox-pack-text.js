// === Vex Toolbox pack: text, writing and generators ===
// Line tools, encoders, extractors, writing stats, number words and random
// generators. Every run() is pure. Contract: js/toolbox-packs.js.
(function () {
  // ---- field builders ----
  const area = (id = 'text', label = 'Text', placeholder = '') => ({ id, label, type: 'textarea', value: '', placeholder });
  const line = (id, label, value = '', placeholder = '') => ({ id, label, type: 'text', value, placeholder });
  const num = (id, label, value, min, max, step = 1) => ({ id, label, type: 'number', value, min, max, step });
  const check = (id, label, value = false) => ({ id, label, type: 'checkbox', value });
  const pick = (id, label, options, value = options[0][0]) => ({ id, label, type: 'select', options, value });

  // ---- text helpers ----
  const lines = s => s.split(/\r?\n/);
  const cp = s => Array.from(s); // code points, so emoji are never split in half
  const WORD = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu;
  const wordsOf = s => s.match(WORD) || [];
  const sentencesOf = s => s.split(/(?<=[.!?…])["'”’)\]]*\s+|\n\s*\n/).map(x => x.trim()).filter(x => wordsOf(x).length);
  const unescapeSep = s => s.replace(/\\t/g, '\t').replace(/\\n/g, '\n');
  const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fmt = n => String(+n.toFixed(10)); // trims float noise: 0.1 + 0.2 -> "0.3"
  const pct = (n, total) => fmt(Math.round(n / total * 1000) / 10) + '%';
  const thousands = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  function need(s, what = 'some text') {
    if (!s.trim()) throw new Error(`Enter ${what} first`);
    return s;
  }
  function whole(n, label, min, max) {
    if (!Number.isInteger(n)) throw new Error(`${label} must be a whole number`);
    if (n < min || n > max) throw new Error(`${label} must be between ${min} and ${max}`);
    return n;
  }
  // One item per non-blank line; a single comma-separated line also works.
  function listItems(s) {
    let items = lines(s).map(x => x.trim()).filter(Boolean);
    if (items.length === 1 && items[0].includes(',')) items = items[0].split(',').map(x => x.trim()).filter(Boolean);
    return items;
  }

  const SPECIAL_LETTERS = { ß: 'ss', ẞ: 'SS', æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', ø: 'o', Ø: 'O', ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ð: 'd', Ð: 'D', þ: 'th', Þ: 'Th', ı: 'i' };
  const stripAccents = s => s.normalize('NFD').replace(/[\u0300-\u036F]/g, '')
    .replace(/[ßẞæÆœŒøØłŁđĐðÐþÞı]/g, c => SPECIAL_LETTERS[c]).normalize('NFC');

  const STOP = new Set(('a an and are as at be but by for from has have he her his i in is it its of on or our she so that the their them ' +
    'they this to was we were will with you your my me not no do does did just than then there these those what when where which who why ' +
    'how all any can could would should into about over after before up down out if been am').split(' '));

  function utf8Bytes(s) { return Array.from(new TextEncoder().encode(s)); }
  function utf8Text(bytes) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes)); } catch (e) { throw new Error('Those bytes are not valid UTF-8 text', { cause: e }); }
  }

  // How a single character is shown in a table cell.
  function showChar(c) {
    const names = { ' ': '␣ space', '\t': '⇥ tab', '\n': '↵ new line', '\r': '␍ carriage return', '\u00A0': '⍽ no-break space' };
    if (names[c]) return names[c];
    if (/[\p{Cc}\p{Cf}\p{Z}]/u.test(c)) return 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
    return c;
  }

  // RFC 4180-style parser: quoted cells may hold the delimiter, "" and newlines.
  function parseDelimited(text, delim) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c !== '"') cell += c;
        else if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else if (c === '"' && cell === '') quoted = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (quoted) throw new Error('A quoted cell is never closed — check for a missing "');
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => !(r.length === 1 && !r[0].trim()));
  }
  function csvCell(val, delim, force) {
    return force || val.includes(delim) || /["\r\n]/.test(val) || val !== val.trim() ? '"' + val.replace(/"/g, '""') + '"' : val;
  }
  const DELIMS = [[',', 'Comma'], ['\t', 'Tab'], [';', 'Semicolon'], ['|', 'Pipe']];

  // ---- randomness (crypto only, rejection sampling so nothing is biased) ----
  function randomBelow(n) {
    if (typeof crypto === 'undefined' || !crypto.getRandomValues) throw new Error('No secure random source is available here');
    if (!(n >= 1 && n <= 2 ** 53)) throw new Error('That range is too large');
    const buf = new Uint32Array(2), limit = Math.floor(2 ** 53 / n) * n;
    let r;
    do { crypto.getRandomValues(buf); r = buf[0] * 2 ** 21 + (buf[1] >>> 11); } while (r >= limit);
    return r % n;
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = randomBelow(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // ---- lookup tables ----
  const MORSE = {
    A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--',
    N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
    0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
    '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--', '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...',
    ':': '---...', ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-', '"': '.-..-.', $: '...-..-', '@': '.--.-.',
  };
  const MORSE_BACK = Object.fromEntries(Object.entries(MORSE).map(([k, c]) => [c, k]));

  const NATO = {
    A: 'Alfa', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliett', K: 'Kilo',
    L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo', S: 'Sierra', T: 'Tango', U: 'Uniform',
    V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu', 0: 'Zero', 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five',
    6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine',
  };

  const NAMED_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0', copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—',
    ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', euro: '€', pound: '£', yen: '¥', cent: '¢',
    deg: '°', plusmn: '±', times: '×', divide: '÷', para: '¶', sect: '§', middot: '·', bull: '•', micro: 'µ', frac12: '½',
    frac14: '¼', frac34: '¾', iexcl: '¡', iquest: '¿', larr: '←', rarr: '→', uarr: '↑', darr: '↓', hearts: '♥', shy: '\u00AD',
    ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009', AElig: 'Æ', aelig: 'æ', szlig: 'ß', Oslash: 'Ø', oslash: 'ø', ETH: 'Ð',
    eth: 'ð', THORN: 'Þ', thorn: 'þ',
  };
  // Latin-1 accented letters follow a pattern (é = eacute), so derive them.
  const MARK_NAMES = { '\u0301': 'acute', '\u0300': 'grave', '\u0302': 'circ', '\u0308': 'uml', '\u0303': 'tilde', '\u030A': 'ring', '\u0327': 'cedil' };
  for (let c = 0xC0; c <= 0xFF; c++) {
    const ch = String.fromCharCode(c), [base, mark] = ch.normalize('NFD');
    if (mark && MARK_NAMES[mark]) NAMED_ENTITIES[base + MARK_NAMES[mark]] = ch;
  }
  function decodeEntities(s) {
    return s.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body) => {
      if (body[0] !== '#') return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : m;
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10FFFF && !(code >= 0xD800 && code <= 0xDFFF) ? String.fromCodePoint(code) : m;
    });
  }

  const UPSIDE = {
    a: 'ɐ', b: 'q', c: 'ɔ', d: 'p', e: 'ǝ', f: 'ɟ', g: 'ƃ', h: 'ɥ', i: 'ᴉ', j: 'ɾ', k: 'ʞ', l: 'ʃ', m: 'ɯ', n: 'u', o: 'o', p: 'd',
    q: 'b', r: 'ɹ', s: 's', t: 'ʇ', u: 'n', v: 'ʌ', w: 'ʍ', x: 'x', y: 'ʎ', z: 'z', 1: 'Ɩ', 2: 'ᄅ', 3: 'Ɛ', 4: 'ㄣ', 5: 'ϛ', 6: '9',
    7: 'ㄥ', 8: '8', 9: '6', 0: '0', '.': '˙', ',': "'", "'": ',', '"': '„', '?': '¿', '!': '¡', '(': ')', ')': '(', '[': ']', ']': '[',
    '{': '}', '}': '{', '<': '>', '>': '<', _: '‾', '&': '⅋',
  };

  // Unicode "Mathematical Alphanumeric Symbols": A/a/digit base code points,
  // plus the letters that live elsewhere because they were encoded earlier.
  const FANCY = {
    bold: { A: 0x1D400, a: 0x1D41A, d: 0x1D7CE },
    italic: { A: 0x1D434, a: 0x1D44E, x: { h: 0x210E } },
    'bold-italic': { A: 0x1D468, a: 0x1D482 },
    'sans-bold': { A: 0x1D5D4, a: 0x1D5EE, d: 0x1D7EC },
    script: { A: 0x1D49C, a: 0x1D4B6, x: { B: 0x212C, E: 0x2130, F: 0x2131, H: 0x210B, I: 0x2110, L: 0x2112, M: 0x2133, R: 0x211B, e: 0x212F, g: 0x210A, o: 0x2134 } },
    'bold-script': { A: 0x1D4D0, a: 0x1D4EA },
    fraktur: { A: 0x1D504, a: 0x1D51E, x: { C: 0x212D, H: 0x210C, I: 0x2111, R: 0x211C, Z: 0x2128 } },
    'double-struck': { A: 0x1D538, a: 0x1D552, d: 0x1D7D8, x: { C: 0x2102, H: 0x210D, N: 0x2115, P: 0x2119, Q: 0x211A, R: 0x211D, Z: 0x2124 } },
    monospace: { A: 0x1D670, a: 0x1D68A, d: 0x1D7F6 },
    circled: { A: 0x24B6, a: 0x24D0, x: { 0: 0x24EA, 1: 0x2460, 2: 0x2461, 3: 0x2462, 4: 0x2463, 5: 0x2464, 6: 0x2465, 7: 0x2466, 8: 0x2467, 9: 0x2468 } },
  };
  function fancyChar(c, style) {
    if (style === 'fullwidth') {
      const n = c.charCodeAt(0);
      if (c === ' ') return '\u3000';
      return c.length === 1 && n >= 0x21 && n <= 0x7E ? String.fromCharCode(n + 0xFEE0) : c;
    }
    const t = FANCY[style];
    if (t.x && t.x[c]) return String.fromCodePoint(t.x[c]);
    if (c >= 'A' && c <= 'Z') return String.fromCodePoint(t.A + c.charCodeAt(0) - 65);
    if (c >= 'a' && c <= 'z') return String.fromCodePoint(t.a + c.charCodeAt(0) - 97);
    if (c >= '0' && c <= '9' && t.d) return String.fromCodePoint(t.d + c.charCodeAt(0) - 48);
    return c;
  }

  // ---- numbers as words ----
  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
    'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const SCALES = ['', 'thousand', 'million', 'billion', 'trillion', 'quadrillion', 'quintillion', 'sextillion', 'septillion'];
  function under1000(n, useAnd) {
    const h = Math.floor(n / 100), r = n % 100, parts = [];
    if (h) parts.push(ONES[h] + ' hundred');
    if (r) {
      if (h && useAnd) parts.push('and');
      parts.push(r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? '-' + ONES[r % 10] : ''));
    }
    return parts.join(' ');
  }
  function intToWords(digits, useAnd) {
    digits = digits.replace(/^0+(?=\d)/, '');
    if (digits === '0') return 'zero';
    if (digits.length > SCALES.length * 3) throw new Error(`Numbers up to ${SCALES.length * 3} digits are supported`);
    const groups = [];
    for (let i = digits.length; i > 0; i -= 3) groups.unshift(Number(digits.slice(Math.max(0, i - 3), i)));
    const out = [];
    groups.forEach((g, i) => {
      if (!g) return;
      const scale = SCALES[groups.length - 1 - i];
      out.push(under1000(g, useAnd) + (scale ? ' ' + scale : ''));
    });
    // British style: "one thousand and five".
    const last = groups[groups.length - 1];
    if (useAnd && groups.length > 1 && last > 0 && last < 100) out[out.length - 1] = 'and ' + out[out.length - 1];
    return out.join(' ');
  }
  function ordinalWords(words) {
    const IRREG = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
    const [, head, last] = words.match(/^(.*?)([a-z]+)$/);
    return head + (IRREG[last] || (last.endsWith('y') ? last.slice(0, -1) + 'ieth' : last + 'th'));
  }
  function wholeDigits(s, label) {
    const d = s.trim().replace(/[,_\s]/g, '');
    if (!/^\d+$/.test(d)) throw new Error(`${label} must be a whole number of 0 or more`);
    return d;
  }

  const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  function toRoman(n) {
    let out = '';
    for (const [val, sym] of ROMAN) while (n >= val) { out += sym; n -= val; }
    return out;
  }

  // ---- writing helpers ----
  function syllables(word) {
    let w = stripAccents(word).toLowerCase().replace(/[^a-z]/g, '');
    if (!w) return 1; // a number is read as at least one syllable
    if (w.length <= 3) return 1;
    w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
    const groups = w.match(/[aeiouy]{1,2}/g);
    return groups ? groups.length : 1;
  }
  function duration(sec) {
    const s = Math.round(sec);
    if (s < 60) return `${s} s`;
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
    return [h && `${h} h`, m && `${m} min`, r && `${r} s`].filter(Boolean).join(' ');
  }

  const LOREM = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna ' +
    'aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure ' +
    'dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non ' +
    'proident sunt in culpa qui officia deserunt mollit anim id est laborum').split(' ');
  const LOREM_SENTENCE = [8, 11, 7, 13, 9, 12, 10];
  const LOREM_PARAGRAPH = [4, 5, 3];
  const sentenceCase = ws => (ws[0][0].toUpperCase() + ws[0].slice(1) + (ws.length > 1 ? ' ' + ws.slice(1).join(' ') : '')) + '.';

  const COMMON_PASSWORDS = new Set(['password', '123456', '123456789', '12345678', '12345', '1234567', '1234', 'qwerty', 'abc123',
    'password1', '111111', '123123', 'admin', 'letmein', 'welcome', 'monkey', 'dragon', 'iloveyou', 'football', 'baseball', 'sunshine',
    'princess', 'qwerty123', '000000', '1q2w3e4r', 'trustno1', 'master', 'shadow', 'superman', 'michael', 'login', 'passw0rd',
    'starwars', 'hello', 'freedom', 'whatever', 'qazwsx', '654321', '666666', '121212', 'zaq12wsx', 'qwertyuiop', 'asdfgh', 'secret']);

  const FILLERS = ['absolutely', 'actually', 'basically', 'certainly', 'definitely', 'honestly', 'just', 'literally', 'obviously',
    'quite', 'rather', 'really', 'seriously', 'simply', 'somewhat', 'totally', 'truly', 'very', 'a bit', 'a little', 'in order to',
    'kind of', 'pretty much', 'sort of'];

  // Line-by-line diff via longest common subsequence; unchanged ends are
  // trimmed first so the table stays small for typical edits.
  function diffLines(a, b) {
    let pre = 0;
    while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    let suf = 0;
    while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
    const A = a.slice(pre, a.length - suf), B = b.slice(pre, b.length - suf), n = A.length, m = B.length;
    if (n * m > 4e6) throw new Error('Those texts differ in too many lines to compare here (limit about 2,000 × 2,000)');
    const W = m + 1, dp = new Uint16Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      dp[i * W + j] = A[i] === B[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
    }
    const out = a.slice(0, pre).map(l => ['=', l]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) { out.push(['=', A[i]]); i++; j++; }
      else if (j >= m || (i < n && dp[(i + 1) * W + j] >= dp[i * W + j + 1])) out.push(['-', A[i++]]);
      else out.push(['+', B[j++]]);
    }
    return out.concat(a.slice(a.length - suf).map(l => ['=', l]));
  }

  const PACK = [
    // ================= text =================
    {
      id: 'text-reverse', name: 'Reverse Text', icon: '⇆', family: 'text',
      desc: 'Reverse the characters, the word order, the letters in each word, or the line order',
      keywords: ['backwards', 'mirror', 'flip'],
      fields: [area(), pick('mode', 'Reverse', [['chars', 'All characters'], ['words', 'Word order (each line)'], ['each', 'Letters inside each word'], ['lines', 'Line order']])],
      run(v) {
        need(v.text);
        if (v.mode === 'chars') return cp(v.text).reverse().join('');
        if (v.mode === 'words') return lines(v.text).map(l => l.trim().split(/\s+/).reverse().join(' ')).join('\n');
        if (v.mode === 'lines') return lines(v.text).reverse().join('\n');
        return v.text.replace(WORD, w => cp(w).reverse().join(''));
      },
      examples: [
        { in: { text: 'Hello, World', mode: 'chars' }, out: 'dlroW ,olleH' },
        { in: { text: 'one two three\nfour five', mode: 'words' }, out: 'three two one\nfive four' },
        { in: { text: 'Hello, World', mode: 'each' }, out: 'olleH, dlroW' },
        { in: { text: 'a\nb\nc', mode: 'lines' }, out: 'c\nb\na' },
      ],
    },
    {
      id: 'lines-sort', name: 'Sort Lines', icon: '⇅', family: 'text',
      desc: 'Sort lines A–Z, Z–A, by the number in them, or by length (blank lines are dropped)',
      keywords: ['order', 'alphabetical', 'arrange', 'natural'],
      fields: [
        area('text', 'Lines'),
        pick('order', 'Order', [['az', 'A → Z'], ['za', 'Z → A'], ['num', 'Number, low → high'], ['num-desc', 'Number, high → low'], ['len', 'Shortest first'], ['len-desc', 'Longest first']]),
        check('ascii', 'Strict character-code order (uppercase before lowercase)'),
      ],
      run(v) {
        const list = lines(need(v.text)).filter(l => l.trim());
        const coll = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
        const alpha = v.ascii ? (a, b) => (a < b ? -1 : a > b ? 1 : 0) : coll.compare;
        const firstNum = l => { const m = l.match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };
        const byNum = dir => (a, b) => {
          const x = firstNum(a), y = firstNum(b);
          if (isNaN(x) || isNaN(y)) return Number(isNaN(x)) - Number(isNaN(y)); // lines without a number go last
          return dir * (x - y);
        };
        const len = s => cp(s).length;
        const sorters = {
          az: alpha, za: (a, b) => alpha(b, a), num: byNum(1), 'num-desc': byNum(-1),
          len: (a, b) => len(a) - len(b), 'len-desc': (a, b) => len(b) - len(a),
        };
        return list.sort(sorters[v.order]).join('\n');
      },
      examples: [
        { in: { text: 'banana\nApple\n\ncherry\nitem10\nitem2', order: 'az' }, out: 'Apple\nbanana\ncherry\nitem2\nitem10' },
        { in: { text: 'b\nc\na', order: 'za' }, out: 'c\nb\na' },
        { in: { text: '10 apples\nnone\n9 pears\n-1.5 debt', order: 'num' }, out: '-1.5 debt\n9 pears\n10 apples\nnone' },
        { in: { text: 'aa\nb\nccc', order: 'len-desc' }, out: 'ccc\naa\nb' },
        { in: { text: 'b\nB\na\nA', order: 'az', ascii: true }, out: 'A\nB\na\nb' },
      ],
    },
    {
      id: 'lines-dedupe', name: 'Remove Duplicate Lines', icon: '⧉', family: 'text',
      desc: 'Keep only the first copy of each line',
      keywords: ['unique', 'duplicates', 'distinct'],
      fields: [area('text', 'Lines'), check('ignoreCase', 'Ignore upper/lowercase'), check('trim', 'Ignore spaces at the start and end', true)],
      run(v) {
        const seen = new Set(), out = [];
        for (const raw of lines(need(v.text))) {
          const l = v.trim ? raw.trim() : raw;
          const key = v.ignoreCase ? l.toLowerCase() : l;
          if (!seen.has(key)) { seen.add(key); out.push(l); }
        }
        return out.join('\n');
      },
      examples: [
        { in: { text: 'apple\nApple\nbanana\napple ', ignoreCase: true }, out: 'apple\nbanana' },
        { in: { text: 'apple\nApple\nbanana\napple ' }, out: 'apple\nApple\nbanana' },
      ],
    },
    {
      id: 'lines-remove-empty', name: 'Remove Empty Lines', icon: '☰', family: 'text',
      desc: 'Delete blank and whitespace-only lines',
      keywords: ['blank', 'clean'],
      fields: [area()],
      run(v) { return lines(need(v.text)).filter(l => l.trim()).join('\n'); },
      examples: [{ in: { text: 'a\n\n  \nb\n' }, out: 'a\nb' }],
    },
    {
      id: 'text-trim', name: 'Trim Whitespace', icon: '⇤', family: 'text',
      desc: 'Trim spaces from every line and squeeze repeated spaces',
      keywords: ['spaces', 'clean', 'tidy', 'strip'],
      fields: [area(), check('collapse', 'Collapse repeated spaces and tabs inside lines', true)],
      run(v) {
        return lines(need(v.text)).map(l => {
          const t = l.trim();
          return v.collapse ? t.replace(/[ \t\u00A0]+/g, ' ') : t;
        }).join('\n').replace(/^\n+|\n+$/g, '');
      },
      examples: [
        { in: { text: '\n  hello   world  \n\tfoo\t\tbar \n' }, out: 'hello world\nfoo bar' },
        { in: { text: '  a   b  ', collapse: false }, out: 'a   b' },
      ],
    },
    {
      id: 'lines-number', name: 'Number Lines', icon: '#', family: 'text',
      desc: 'Put a line number in front of each line',
      keywords: ['numbering', 'count', 'list'],
      fields: [
        area('text', 'Lines'), num('start', 'Start at', 1, -1e9, 1e9),
        pick('sep', 'After the number', [['. ', '1. '], [') ', '1) '], [': ', '1: '], ['\t', 'Tab'], [' ', 'Space']]),
        check('pad', 'Pad numbers with zeros to the same width'), check('skipBlank', 'Leave blank lines unnumbered', true),
      ],
      run(v) {
        const start = whole(v.start, 'Start', -1e9, 1e9);
        const list = lines(need(v.text));
        const total = v.skipBlank ? list.filter(l => l.trim()).length : list.length;
        const width = String(start + total - 1).length;
        let n = start;
        return list.map(l => {
          if (v.skipBlank && !l.trim()) return l;
          const label = v.pad ? String(n).padStart(width, '0') : String(n);
          n++;
          return label + v.sep + l;
        }).join('\n');
      },
      examples: [
        { in: { text: 'alpha\nbeta\n\ngamma' }, out: '1. alpha\n2. beta\n\n3. gamma' },
        { in: { text: 'a\nb', start: 9, pad: true, sep: ') ' }, out: '09) a\n10) b' },
      ],
    },
    {
      id: 'find-replace', name: 'Find & Replace', icon: '⇄', family: 'text',
      desc: 'Replace every match — plain text, whole words or a regular expression',
      keywords: ['substitute', 'search', 'swap'],
      fields: [
        area(), line('find', 'Find'), line('replace', 'Replace with'),
        check('ignoreCase', 'Ignore upper/lowercase'), check('wholeWord', 'Whole words only'), check('regex', 'Find is a regular expression ($1 works in Replace)'),
      ],
      run(v) {
        need(v.text);
        if (!v.find) throw new Error('Enter the text to find');
        let src = v.regex ? v.find : escapeRe(v.find);
        if (v.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
        let re;
        try { re = new RegExp(src, 'g' + (v.ignoreCase ? 'i' : '') + (v.wholeWord ? 'u' : '')); } catch (e) { throw new Error(`That is not a valid regular expression (${e.message})`, { cause: e }); }
        if (!re.test(v.text)) throw new Error(`"${v.find}" was not found`);
        re.lastIndex = 0;
        return v.regex ? v.text.replace(re, v.replace) : v.text.replace(re, () => v.replace);
      },
      examples: [
        { in: { text: 'Cats and cats', find: 'cat', replace: 'dog', ignoreCase: true }, out: 'dogs and dogs' },
        { in: { text: 'cat catalog cat', find: 'cat', replace: 'dog', wholeWord: true }, out: 'dog catalog dog' },
        { in: { text: '2024-05-06', find: '(\\d+)-(\\d+)-(\\d+)', replace: '$3/$2/$1', regex: true }, out: '06/05/2024' },
        { in: { text: 'price: 5', find: '5', replace: '$5' }, out: 'price: $5' },
      ],
    },
    {
      id: 'slugify', name: 'Slugify', family: 'text',
      desc: 'Turn a title into a URL-friendly slug',
      keywords: ['url', 'permalink', 'seo', 'kebab'],
      fields: [line('text', 'Title', '', 'My First Blog Post!'), pick('sep', 'Separator', [['-', 'Hyphen -'], ['_', 'Underscore _']]), check('lower', 'Lowercase', true)],
      run(v) {
        need(v.text);
        let s = stripAccents(v.text).replace(/['’]/g, '').replace(/[^A-Za-z0-9]+/g, v.sep);
        s = s.replace(new RegExp(`^${escapeRe(v.sep)}+|${escapeRe(v.sep)}+$`, 'g'), '');
        if (!s) throw new Error('Nothing is left once symbols are removed — use some letters or numbers');
        return v.lower ? s.toLowerCase() : s;
      },
      examples: [
        { in: { text: 'Héllo, Wörld! It’s 2024' }, out: 'hello-world-its-2024' },
        { in: { text: '  Straße & Co.  ', sep: '_', lower: false }, out: 'Strasse_Co' },
      ],
    },
    {
      id: 'case-more', name: 'Sentence & Swap Case', icon: 'aA', family: 'text',
      desc: 'Sentence case, sWAP cASE and aLtErNaTiNg case',
      keywords: ['capitalize', 'sentence', 'toggle', 'mocking'],
      fields: [area(), pick('mode', 'Style', [['sentence', 'Sentence case'], ['swap', 'sWAP cASE'], ['alternating', 'aLtErNaTiNg']])],
      run(v) {
        need(v.text);
        if (v.mode === 'sentence') {
          return v.text.toLowerCase()
            .replace(/(^|[.!?…]\s+|\n)([\s"'“‘(]*)(\p{Ll})/gu, (m, pre, q, c) => pre + q + c.toUpperCase())
            .replace(/(?<![\p{L}\p{N}.])i(?=[\s'’,;:!?)]|\.(?!\p{L})|$)/gu, 'I');
        }
        if (v.mode === 'swap') return cp(v.text).map(c => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('');
        let i = 0;
        return cp(v.text).map(c => (/\p{L}/u.test(c) ? (i++ % 2 ? c.toUpperCase() : c.toLowerCase()) : c)).join('');
      },
      examples: [
        { in: { text: 'hello WORLD. how are you? i am fine, i think.', mode: 'sentence' }, out: 'Hello world. How are you? I am fine, I think.' },
        { in: { text: 'Hello World', mode: 'swap' }, out: 'hELLO wORLD' },
        { in: { text: 'hello world', mode: 'alternating' }, out: 'hElLo WoRlD' },
      ],
    },
    {
      id: 'char-frequency', name: 'Character Frequency', icon: '𝑓', family: 'text',
      desc: 'How often each character appears, most common first',
      keywords: ['letters', 'count', 'histogram', 'cryptogram'],
      fields: [area(), check('ignoreCase', 'Ignore upper/lowercase', true), check('spaces', 'Count spaces and line breaks')],
      run(v) {
        const counts = new Map();
        let total = 0;
        for (let c of cp(need(v.text))) {
          if (!v.spaces && /\s/.test(c)) continue;
          if (v.ignoreCase) c = c.toLowerCase();
          counts.set(c, (counts.get(c) || 0) + 1);
          total++;
        }
        if (!total) throw new Error('There are no characters to count');
        return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([c, n]) => [showChar(c), `${n} (${pct(n, total)})`]);
      },
      examples: [
        { in: { text: 'Hello' }, out: [['l', '2 (40%)'], ['e', '1 (20%)'], ['h', '1 (20%)'], ['o', '1 (20%)']] },
        { in: { text: 'a a', spaces: true }, out: [['a', '2 (66.7%)'], ['␣ space', '1 (33.3%)']] },
      ],
    },
    {
      id: 'word-frequency', name: 'Word Frequency', family: 'text',
      desc: 'The most used words in a text',
      keywords: ['keywords', 'density', 'top words', 'count'],
      fields: [area(), num('top', 'Show the top', 10, 1, 1000), check('skipCommon', 'Skip common words (the, and, of…)')],
      run(v) {
        const top = whole(v.top, 'Top', 1, 1000);
        const counts = new Map();
        for (const w of wordsOf(need(v.text))) {
          const k = w.toLowerCase().replace(/’/g, "'");
          if (v.skipCommon && STOP.has(k)) continue;
          counts.set(k, (counts.get(k) || 0) + 1);
        }
        if (!counts.size) throw new Error('No words to count');
        return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, top).map(([w, n]) => [w, String(n)]);
      },
      examples: [
        { in: { text: 'the cat and the hat. The end' }, out: [['the', '3'], ['and', '1'], ['cat', '1'], ['end', '1'], ['hat', '1']] },
        { in: { text: 'the cat and the hat. The cat', top: 1, skipCommon: true }, out: [['cat', '2']] },
      ],
    },
    {
      id: 'vowel-count', name: 'Vowels & Consonants', icon: 'aeiou', family: 'text',
      desc: 'Count vowels, consonants, digits, spaces and everything else',
      keywords: ['letters', 'count'],
      fields: [area()],
      run(v) {
        const c = { v: 0, k: 0, d: 0, s: 0, o: 0 };
        for (const ch of cp(stripAccents(need(v.text)))) {
          if (/[aeiou]/i.test(ch)) c.v++;
          else if (/[a-z]/i.test(ch)) c.k++;
          else if (/[0-9]/.test(ch)) c.d++;
          else if (/\s/.test(ch)) c.s++;
          else c.o++;
        }
        return [['Vowels', String(c.v)], ['Consonants', String(c.k)], ['Digits', String(c.d)], ['Spaces', String(c.s)], ['Other characters', String(c.o)]];
      },
      examples: [
        { in: { text: 'Hello World 42!' }, out: [['Vowels', '3'], ['Consonants', '7'], ['Digits', '2'], ['Spaces', '2'], ['Other characters', '1']] },
        { in: { text: 'Élan' }, out: [['Vowels', '2'], ['Consonants', '2'], ['Digits', '0'], ['Spaces', '0'], ['Other characters', '0']] },
      ],
    },
    {
      id: 'text-binary', name: 'Text ⇄ Binary', icon: '01', family: 'text',
      desc: 'Convert text to 8-bit binary bytes (UTF-8) and back',
      keywords: ['bits', 'ascii', 'encode', 'decode'],
      fields: [area(), pick('mode', 'Direction', [['encode', 'Text → binary'], ['decode', 'Binary → text']])],
      run(v) {
        need(v.text);
        if (v.mode === 'encode') return utf8Bytes(v.text).map(b => b.toString(2).padStart(8, '0')).join(' ');
        const groups = v.text.trim().split(/[\s,]+/);
        let bytes;
        if (groups.length === 1) {
          if (!/^[01]+$/.test(groups[0])) throw new Error('Binary may only contain 0 and 1');
          if (groups[0].length % 8) throw new Error('Binary without spaces must be a multiple of 8 digits long');
          bytes = groups[0].match(/.{8}/g);
        } else {
          const bad = groups.find(g => !/^[01]{1,8}$/.test(g));
          if (bad) throw new Error(`"${bad}" is not a byte — use groups of up to 8 zeros and ones`);
          bytes = groups;
        }
        return utf8Text(bytes.map(b => parseInt(b, 2)));
      },
      examples: [
        { in: { text: 'Hi', mode: 'encode' }, out: '01001000 01101001' },
        { in: { text: 'é', mode: 'encode' }, out: '11000011 10101001' },
        { in: { text: '01001000 01101001', mode: 'decode' }, out: 'Hi' },
        { in: { text: '0100100001101001', mode: 'decode' }, out: 'Hi' },
      ],
    },
    {
      id: 'text-hex', name: 'Text ⇄ Hex', icon: '0x', family: 'text',
      desc: 'Convert text to hexadecimal bytes (UTF-8) and back',
      keywords: ['hexadecimal', 'bytes', 'encode', 'decode'],
      fields: [area(), pick('mode', 'Direction', [['encode', 'Text → hex'], ['decode', 'Hex → text']]), pick('sep', 'Byte separator (text → hex)', [[' ', 'Space'], ['', 'None']])],
      run(v) {
        need(v.text);
        if (v.mode === 'encode') return utf8Bytes(v.text).map(b => b.toString(16).padStart(2, '0')).join(v.sep);
        const hex = v.text.replace(/0x|\\x/gi, '').replace(/[\s:,-]/g, '');
        if (!/^[0-9a-f]*$/i.test(hex)) throw new Error('Hex may only contain 0–9 and a–f');
        if (hex.length % 2) throw new Error('Hex needs two digits per byte — one digit is left over');
        return utf8Text(hex.match(/../g).map(h => parseInt(h, 16)));
      },
      examples: [
        { in: { text: 'Hi!', mode: 'encode' }, out: '48 69 21' },
        { in: { text: 'é', mode: 'encode', sep: '' }, out: 'c3a9' },
        { in: { text: '0x48 0x69 0x21', mode: 'decode' }, out: 'Hi!' },
        { in: { text: 'F0:9F:98:80', mode: 'decode' }, out: '😀' },
      ],
    },
    {
      id: 'rot13', name: 'ROT13', icon: '↻', family: 'text',
      desc: 'Rotate letters by 13 — run it again to undo',
      keywords: ['cipher', 'spoiler', 'encode', 'decode'],
      fields: [area()],
      run(v) {
        return need(v.text).replace(/[a-z]/gi, c => {
          const base = c <= 'Z' ? 65 : 97;
          return String.fromCharCode((c.charCodeAt(0) - base + 13) % 26 + base);
        });
      },
      examples: [{ in: { text: 'Hello, World!' }, out: 'Uryyb, Jbeyq!' }, { in: { text: 'Uryyb' }, out: 'Hello' }],
    },
    {
      id: 'caesar-cipher', name: 'Caesar Cipher', family: 'text',
      desc: 'Shift letters along the alphabet, or try every shift to crack one',
      keywords: ['cipher', 'shift', 'encrypt', 'decrypt', 'brute force'],
      fields: [area(), num('shift', 'Shift', 3, -1000, 1000), pick('mode', 'Mode', [['encode', 'Encode'], ['decode', 'Decode'], ['all', 'Try all 25 shifts']])],
      run(v) {
        need(v.text);
        const rotate = (s, k) => s.replace(/[a-z]/gi, c => {
          const base = c <= 'Z' ? 65 : 97;
          return String.fromCharCode(((c.charCodeAt(0) - base + k) % 26 + 26) % 26 + base);
        });
        if (v.mode === 'all') return Array.from({ length: 25 }, (_, i) => [`Shift ${i + 1}`, rotate(v.text, -(i + 1))]);
        const k = whole(v.shift, 'Shift', -1000, 1000);
        return rotate(v.text, v.mode === 'decode' ? -k : k);
      },
      examples: [
        { in: { text: 'abc xyz', shift: 3 }, out: 'def abc' },
        { in: { text: 'Khoor, Zruog!', shift: 3, mode: 'decode' }, out: 'Hello, World!' },
        { in: { text: 'abc', shift: -1 }, out: 'zab' },
        { in: { text: 'Ifmmp', mode: 'all' }, match: /^Shift 1: Hello\nShift 2: Gdkkn\n/ },
      ],
    },
    {
      id: 'morse', name: 'Morse Code', icon: '·−', family: 'text',
      desc: 'Translate text to Morse code and back (words split by /)',
      keywords: ['telegraph', 'dots', 'dashes', 'sos'],
      fields: [area(), pick('mode', 'Direction', [['encode', 'Text → Morse'], ['decode', 'Morse → text']])],
      run(v) {
        need(v.text);
        if (v.mode === 'encode') {
          return stripAccents(v.text).trim().toUpperCase().split(/\s+/).map(word => cp(word).map(c => {
            if (!MORSE[c]) throw new Error(`"${c}" has no Morse code`);
            return MORSE[c];
          }).join(' ')).join(' / ');
        }
        const norm = v.text.replace(/[·•∙]/g, '.').replace(/[–—−_]/g, '-').trim();
        return norm.split(/\s*\/\s*|\s{3,}|\n+/).filter(Boolean).map(word => word.split(/\s+/).map(code => {
          if (!MORSE_BACK[code]) throw new Error(`"${code}" is not a Morse code letter`);
          return MORSE_BACK[code];
        }).join('')).join(' ');
      },
      examples: [
        { in: { text: 'SOS', mode: 'encode' }, out: '... --- ...' },
        { in: { text: 'hello world', mode: 'encode' }, out: '.... . .-.. .-.. --- / .-- --- .-. .-.. -..' },
        { in: { text: '.... . .-.. .-.. --- / .-- --- .-. .-.. -..', mode: 'decode' }, out: 'HELLO WORLD' },
        { in: { text: '•••   −−−   •••', mode: 'decode' }, out: 'S O S' },
      ],
    },
    {
      id: 'nato-phonetic', name: 'NATO Phonetic Spelling', family: 'text',
      desc: 'Spell text out as Alfa, Bravo, Charlie…',
      keywords: ['spelling alphabet', 'radio', 'icao', 'alpha bravo'],
      fields: [line('text', 'Text', '', 'Confirmation code')],
      run(v) {
        return stripAccents(need(v.text)).trim().toUpperCase().split(/\s+/)
          .map(word => cp(word).map(c => NATO[c] || c).join(' ')).join(' / ');
      },
      examples: [{ in: { text: 'Vex 1' }, out: 'Victor Echo X-ray / One' }, { in: { text: 'b-2' }, out: 'Bravo - Two' }],
    },
    {
      id: 'html-entities', name: 'HTML Entities', icon: '&;', family: 'text',
      desc: 'Escape text for HTML, or turn &amp;-style entities back into characters',
      keywords: ['escape', 'unescape', 'encode', 'decode', 'amp'],
      fields: [area(), pick('mode', 'Direction', [['encode', 'Text → entities'], ['decode', 'Entities → text']]), check('all', 'Also encode every non-ASCII character')],
      run(v) {
        need(v.text);
        if (v.mode === 'decode') return decodeEntities(v.text);
        const basic = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        let s = v.text.replace(/[&<>"']/g, c => basic[c]);
        if (v.all) s = cp(s).map(c => (c.codePointAt(0) > 126 ? `&#${c.codePointAt(0)};` : c)).join('');
        return s;
      },
      examples: [
        { in: { text: '<a href="x">Tom & Jerry\'s</a>' }, out: '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;' },
        { in: { text: 'café 😀', all: true }, out: 'caf&#233; &#128512;' },
        { in: { text: '&lt;p&gt;Caf&eacute; &amp; cr&#232;me &#x1F600; &bogus;', mode: 'decode' }, out: '<p>Café & crème 😀 &bogus;' },
      ],
    },
    {
      id: 'strip-html', name: 'Strip HTML Tags', icon: '</>', family: 'text',
      desc: 'Remove tags, scripts and styles and keep the readable text',
      keywords: ['plain text', 'remove tags', 'clean html'],
      fields: [area('text', 'HTML')],
      run(v) {
        const s = need(v.text, 'some HTML')
          .replace(/<!--[\s\S]*?-->/g, '')
          .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, '')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|pre|section|article|header|footer|ul|ol|table|dt|dd)\s*>/gi, '\n')
          .replace(/<\/?[a-zA-Z!][^>]*>/g, '');
        return decodeEntities(s).split('\n').map(l => l.replace(/[ \t\u00A0]+/g, ' ').trim()).join('\n')
          .replace(/\n{3,}/g, '\n\n').trim();
      },
      examples: [
        { in: { text: '<p>Hello <b>world</b></p><p>Bye &amp; <i>thanks</i></p>' }, out: 'Hello world\nBye & thanks' },
        { in: { text: '<style>p{}</style><script>alert(1)</script>1 < 2<br>ok<!-- note -->' }, out: '1 < 2\nok' },
      ],
    },
    {
      id: 'remove-accents', name: 'Remove Accents', icon: 'é→e', family: 'text',
      desc: 'Strip accents and diacritics (é → e, ß → ss, Ł → L)',
      keywords: ['diacritics', 'ascii', 'normalize', 'transliterate'],
      fields: [area()],
      run(v) { return stripAccents(need(v.text)); },
      examples: [{ in: { text: 'Crème Brûlée, Straße, Łódź, Ærø' }, out: 'Creme Brulee, Strasse, Lodz, AEro' }],
    },
    {
      id: 'text-wrap', name: 'Wrap Text', family: 'text',
      desc: 'Hard-wrap lines at a set width, breaking between words',
      keywords: ['columns', 'line length', 'fold'],
      fields: [area(), num('width', 'Maximum line length', 80, 1, 1000), check('breakLong', 'Split words longer than the width')],
      run(v) {
        const width = whole(v.width, 'Width', 1, 1000);
        const len = s => cp(s).length;
        return lines(need(v.text)).map(l => {
          const out = [];
          let cur = '';
          for (let w of l.trim().split(/\s+/).filter(Boolean)) {
            while (v.breakLong && len(w) > width) {
              if (cur) { out.push(cur); cur = ''; }
              out.push(cp(w).slice(0, width).join(''));
              w = cp(w).slice(width).join('');
            }
            if (!cur) cur = w;
            else if (len(cur) + 1 + len(w) <= width) cur += ' ' + w;
            else { out.push(cur); cur = w; }
          }
          if (cur || !out.length) out.push(cur);
          return out.join('\n');
        }).join('\n');
      },
      examples: [
        { in: { text: 'The quick brown fox jumps', width: 10 }, out: 'The quick\nbrown fox\njumps' },
        { in: { text: 'abcdefghij kl', width: 4, breakLong: true }, out: 'abcd\nefgh\nij\nkl' },
      ],
    },
    {
      id: 'text-unwrap', name: 'Unwrap Lines', icon: '⟷', family: 'text',
      desc: 'Join hard-wrapped lines back into paragraphs (handy for text copied from PDFs)',
      keywords: ['remove line breaks', 'join', 'pdf', 'paragraph'],
      fields: [area(), check('hyphens', 'Rejoin words split with a hyphen at the line end')],
      run(v) {
        return need(v.text).split(/\r?\n\s*\r?\n/).map(p => lines(p).map(l => l.trim()).filter(Boolean)
          .reduce((acc, l) => (!acc ? l : v.hyphens && /\p{L}-$/u.test(acc) ? acc.slice(0, -1) + l : acc + ' ' + l), ''))
          .filter(Boolean).join('\n\n');
      },
      examples: [
        { in: { text: 'This is a\nwrapped line.\n\nNew para-\ngraph here.' }, out: 'This is a wrapped line.\n\nNew para- graph here.' },
        { in: { text: 'New para-\ngraph here.', hyphens: true }, out: 'New paragraph here.' },
      ],
    },
    {
      id: 'lines-join', name: 'Join Lines', icon: '⇉', family: 'text',
      desc: 'Join lines into one, with a separator of your choice (\\t = tab, \\n = new line)',
      keywords: ['merge', 'combine', 'comma separated', 'implode'],
      fields: [area('text', 'Lines'), line('sep', 'Separator', ', '), check('skipBlank', 'Skip blank lines', true), check('trim', 'Trim each line', true)],
      run(v) {
        let list = lines(need(v.text));
        if (v.trim) list = list.map(l => l.trim());
        if (v.skipBlank) list = list.filter(l => l.trim());
        return list.join(unescapeSep(v.sep));
      },
      examples: [
        { in: { text: 'a\nb\n\n c ' }, out: 'a, b, c' },
        { in: { text: 'x\ny', sep: ' | ' }, out: 'x | y' },
        { in: { text: 'x\ny', sep: '\\t' }, out: 'x\ty' },
      ],
    },
    {
      id: 'text-split', name: 'Split into Lines', icon: '⇶', family: 'text',
      desc: 'Split text on a separator and put each piece on its own line (\\t = tab)',
      keywords: ['explode', 'separate', 'comma', 'list'],
      fields: [area(), line('sep', 'Split on', ','), check('trim', 'Trim each piece', true), check('dropEmpty', 'Drop empty pieces', true)],
      run(v) {
        need(v.text);
        const sep = unescapeSep(v.sep);
        if (!sep) throw new Error('Enter the separator to split on');
        let parts = v.text.split(sep);
        if (v.trim) parts = parts.map(p => p.trim());
        if (v.dropEmpty) parts = parts.filter(p => p !== '');
        return parts.join('\n');
      },
      examples: [
        { in: { text: 'red, green,,blue' }, out: 'red\ngreen\nblue' },
        { in: { text: 'a;b', sep: ';', trim: false }, out: 'a\nb' },
      ],
    },
    {
      id: 'extract-emails', name: 'Extract Emails', icon: '@', family: 'text',
      desc: 'Pull every email address out of a block of text',
      keywords: ['find emails', 'scrape', 'addresses'],
      fields: [area(), check('unique', 'Remove duplicates', true)],
      run(v) {
        let found = need(v.text).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g) || [];
        if (v.unique) { const seen = new Set(); found = found.filter(e => !seen.has(e.toLowerCase()) && seen.add(e.toLowerCase())); }
        if (!found.length) throw new Error('No email addresses found');
        return found.join('\n');
      },
      examples: [{ in: { text: 'Mail ann@example.com or BOB@Mail.co.uk, not me@x. Also ann@example.com.' }, out: 'ann@example.com\nBOB@Mail.co.uk' }],
    },
    {
      id: 'extract-urls', name: 'Extract URLs', family: 'text',
      desc: 'Pull every web link (http, https, www.) out of a block of text',
      keywords: ['links', 'find urls', 'scrape'],
      fields: [area(), check('unique', 'Remove duplicates', true)],
      run(v) {
        let found = (need(v.text).match(/\bhttps?:\/\/[^\s<>"'`]+|\bwww\.[^\s<>"'`]+/gi) || []).map(u => {
          // Trailing punctuation usually belongs to the sentence, but keep a ) that closes a ( in the URL.
          for (;;) {
            const last = u[u.length - 1];
            if (/[.,;:!?'"\]]/.test(last)) u = u.slice(0, -1);
            else if (last === ')' && (u.match(/\(/g) || []).length < (u.match(/\)/g) || []).length) u = u.slice(0, -1);
            else return u;
          }
        });
        if (v.unique) found = [...new Set(found)];
        if (!found.length) throw new Error('No links found');
        return found.join('\n');
      },
      examples: [{
        in: { text: 'See https://example.com/a?b=1, and (https://en.wikipedia.org/wiki/Foo_(bar)). Also www.vex.dev.' },
        out: 'https://example.com/a?b=1\nhttps://en.wikipedia.org/wiki/Foo_(bar)\nwww.vex.dev',
      }],
    },
    {
      id: 'extract-numbers', name: 'Extract Numbers', icon: '123', family: 'text',
      desc: 'Pull the numbers out of text, as a list or with sum, min, max and average',
      keywords: ['digits', 'sum', 'find numbers'],
      fields: [area(), pick('mode', 'Show', [['list', 'List'], ['stats', 'Sum, min, max, average']])],
      run(v) {
        const text = need(v.text), found = [];
        for (const m of text.matchAll(/(?<![\d.])-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\d.])-?\d+(?:\.\d+)?/g)) {
          let s = m[0];
          // "x-5" or "2024-05": the hyphen joins words, it is not a minus sign.
          if (s[0] === '-' && m.index > 0 && /[\p{L}\p{N}]/u.test(text[m.index - 1])) s = s.slice(1);
          found.push(s.replace(/,/g, ''));
        }
        if (!found.length) throw new Error('No numbers found');
        if (v.mode === 'list') return found.join('\n');
        const nums = found.map(Number), sum = nums.reduce((a, b) => a + b, 0);
        return [['Count', String(nums.length)], ['Sum', fmt(sum)], ['Min', fmt(Math.min(...nums))], ['Max', fmt(Math.max(...nums))], ['Average', fmt(sum / nums.length)]];
      },
      examples: [
        { in: { text: 'Paid $1,234.50, got -3 back and 0.5% off, rated 4.' }, out: '1234.50\n-3\n0.5\n4' },
        { in: { text: 'Paid $1,234.50, got -3 back and 0.5% off, rated 4.', mode: 'stats' }, out: [['Count', '4'], ['Sum', '1236'], ['Min', '-3'], ['Max', '1234.5'], ['Average', '309']] },
        { in: { text: 'room B-12, 2024-05' }, out: '12\n2024\n05' },
      ],
    },
    {
      id: 'text-diff', name: 'Text Diff', icon: '±', family: 'text',
      desc: 'Compare two texts line by line: − removed, + added',
      keywords: ['compare', 'difference', 'changes'],
      fields: [area('a', 'Original'), area('b', 'Changed'), check('onlyChanges', 'Show only changed lines')],
      run(v) {
        if (!v.a.trim() && !v.b.trim()) throw new Error('Enter the two texts to compare');
        const d = diffLines(lines(v.a), lines(v.b));
        if (d.every(([op]) => op === '=')) return 'The two texts are the same';
        return d.filter(([op]) => !v.onlyChanges || op !== '=').map(([op, l]) => (op === '=' ? '  ' : op + ' ') + l).join('\n');
      },
      examples: [
        { in: { a: 'one\ntwo\nthree', b: 'one\n2\nthree\nfour' }, out: '  one\n- two\n+ 2\n  three\n+ four' },
        { in: { a: 'one\ntwo\nthree', b: 'one\n2\nthree\nfour', onlyChanges: true }, out: '- two\n+ 2\n+ four' },
        { in: { a: 'same', b: 'same' }, out: 'The two texts are the same' },
      ],
    },
    {
      id: 'table-transpose', name: 'Transpose Table', icon: '⤡', family: 'text',
      desc: 'Swap rows and columns of tab- or comma-separated data',
      keywords: ['rows to columns', 'columns to rows', 'pivot', 'tsv', 'csv'],
      fields: [area('text', 'Table'), pick('delim', 'Separator', [['\t', 'Tab'], [',', 'Comma'], [';', 'Semicolon'], ['|', 'Pipe']])],
      run(v) {
        const rows = parseDelimited(need(v.text, 'a table'), v.delim);
        const cols = Math.max(...rows.map(r => r.length));
        return Array.from({ length: cols }, (_, c) => rows.map(r => csvCell(r[c] ?? '', v.delim, false)).join(v.delim)).join('\n');
      },
      examples: [
        { in: { text: 'a\tb\tc\n1\t2\t3' }, out: 'a\t1\nb\t2\nc\t3' },
        { in: { text: 'name,"Doe, Jane"\nage,40', delim: ',' }, out: 'name,age\n"Doe, Jane",40' },
        { in: { text: 'a\tb\n1' }, out: 'a\t1\nb\t' },
      ],
    },
    {
      id: 'csv-to-list', name: 'CSV Column to List', icon: '▤', family: 'text',
      desc: 'Take one column from CSV or TSV data and list it one value per line',
      keywords: ['column', 'extract', 'spreadsheet'],
      fields: [area('text', 'CSV data'), num('column', 'Column number', 1, 1, 1000), pick('delim', 'Separator', DELIMS), check('header', 'First row is a header (skip it)')],
      run(v) {
        const col = whole(v.column, 'Column', 1, 1000);
        let rows = parseDelimited(need(v.text, 'some CSV'), v.delim);
        if (v.header) rows = rows.slice(1);
        const cols = Math.max(0, ...rows.map(r => r.length));
        if (col > cols) throw new Error(`There ${cols === 1 ? 'is only 1 column' : `are only ${cols} columns`}`);
        return rows.map(r => (r[col - 1] ?? '').trim()).join('\n');
      },
      examples: [
        { in: { text: 'name,age\nAda,36\n"Hopper, Grace",85', header: true }, out: 'Ada\nHopper, Grace' },
        { in: { text: 'a\t1\nb\t2', column: 2, delim: '\t' }, out: '1\n2' },
      ],
    },
    {
      id: 'list-to-csv', name: 'List to CSV', icon: '⸴', family: 'text',
      desc: 'Turn a list (one item per line) into a properly quoted CSV row or column',
      keywords: ['comma separated', 'quote', 'spreadsheet'],
      fields: [area('text', 'Items, one per line'), pick('layout', 'Layout', [['row', 'One row'], ['column', 'One column']]), pick('delim', 'Separator', DELIMS), check('quoteAll', 'Quote every item')],
      run(v) {
        const items = lines(need(v.text)).map(l => l.trim()).filter(Boolean).map(i => csvCell(i, v.delim, v.quoteAll));
        return items.join(v.layout === 'row' ? v.delim : '\n');
      },
      examples: [
        { in: { text: 'apple\nbanana, split\nsay "hi"' }, out: 'apple,"banana, split","say ""hi"""' },
        { in: { text: 'a\nb', quoteAll: true, layout: 'column' }, out: '"a"\n"b"' },
      ],
    },
    {
      id: 'whitespace-show', name: 'Show Whitespace', icon: '·', family: 'text',
      desc: 'Reveal spaces (·), tabs (→), line ends (↵) and invisible characters',
      keywords: ['invisible', 'hidden characters', 'zero width', 'tabs'],
      fields: [area()],
      run(v) {
        if (!v.text) throw new Error('Enter some text first');
        const marks = { ' ': '·', '\t': '→', '\u00A0': '⍽', '\r': '␍', '\n': '↵\n', '\u200B': '[ZWSP]', '\u200C': '[ZWNJ]', '\u200D': '[ZWJ]', '\uFEFF': '[BOM]', '\u2060': '[WJ]', '\u00AD': '[SHY]' };
        return cp(v.text).map(c => marks[c] ?? (/[\p{Z}\p{Cf}\p{Cc}]/u.test(c) ? `[U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}]` : c)).join('');
      },
      examples: [
        { in: { text: 'a b\tc \nd' }, out: 'a·b→c·↵\nd' },
        { in: { text: 'x\u200By\u2003' }, out: 'x[ZWSP]y[U+2003]' },
      ],
    },
    {
      id: 'emoji-remove', name: 'Remove Emoji', family: 'text',
      desc: 'Strip emoji and pictographs from text',
      keywords: ['emoticons', 'clean', 'plain text'],
      fields: [area(), check('tidy', 'Tidy the spaces left behind', true)],
      run(v) {
        let s = need(v.text).replace(/(?![©®™])\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}]|\uFE0F|\u200D|\u20E3/gu, '');
        if (v.tidy) s = lines(s).map(l => l.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/, '')).join('\n');
        return s;
      },
      examples: [
        { in: { text: 'Great job 👍🏽 team 🎉!' }, out: 'Great job team !' },
        { in: { text: '© 2024 Vex™ 🇺🇸' }, out: '© 2024 Vex™' },
      ],
    },
    {
      id: 'text-pad', name: 'Pad Lines', icon: '⇥', family: 'text',
      desc: 'Pad each line to a fixed width — left, right or centred',
      keywords: ['align', 'leading zeros', 'fixed width', 'justify'],
      fields: [area(), num('width', 'Width', 10, 1, 1000), pick('align', 'Text position', [['right', 'Right (pad the start)'], ['left', 'Left (pad the end)'], ['center', 'Centre']]), line('char', 'Pad with (one character)', ' ')],
      run(v) {
        const width = whole(v.width, 'Width', 1, 1000);
        if (cp(v.char).length !== 1) throw new Error('Enter exactly one character to pad with');
        return lines(need(v.text)).map(l => {
          const gap = width - cp(l).length;
          if (gap <= 0) return l;
          const left = v.align === 'right' ? gap : v.align === 'left' ? 0 : Math.floor(gap / 2);
          return v.char.repeat(left) + l + v.char.repeat(gap - left);
        }).join('\n');
      },
      examples: [
        { in: { text: '7\n42', width: 3, char: '0' }, out: '007\n042' },
        { in: { text: 'hi', width: 6, align: 'center', char: '*' }, out: '**hi**' },
        { in: { text: 'ab', width: 4, align: 'left', char: '.' }, out: 'ab..' },
      ],
    },
    {
      id: 'text-truncate', name: 'Truncate Text', family: 'text',
      desc: 'Shorten text to a maximum length, with an ellipsis',
      keywords: ['shorten', 'limit', 'ellipsis', 'character limit'],
      fields: [area(), num('max', 'Maximum length (including the ellipsis)', 100, 1, 100000), line('ellipsis', 'Ellipsis', '…'), check('word', 'Cut at a word boundary', true)],
      run(v) {
        const max = whole(v.max, 'Maximum length', 1, 100000), chars = cp(need(v.text)), dots = cp(v.ellipsis).length;
        if (chars.length <= max) return v.text;
        if (dots >= max) throw new Error('The ellipsis is as long as the limit — shorten it or raise the limit');
        let cut = chars.slice(0, max - dots).join('');
        if (v.word && !/\s/.test(chars[max - dots])) {
          const sp = cut.search(/\s\S*$/);
          if (sp > 0) cut = cut.slice(0, sp);
        }
        return cut.trimEnd() + v.ellipsis;
      },
      examples: [
        { in: { text: 'The quick brown fox', max: 12 }, out: 'The quick…' },
        { in: { text: 'The quick brown fox', max: 12, word: false, ellipsis: '...' }, out: 'The quick...' },
        { in: { text: 'short', max: 12 }, out: 'short' },
      ],
    },
    {
      id: 'upside-down', name: 'Upside-Down Text', icon: 'ʇ', family: 'text',
      desc: 'Flip text upside down with look-alike characters (letters come out lowercase)',
      keywords: ['flip', 'rotate', 'fun', 'unicode'],
      fields: [area()],
      run(v) { return cp(need(v.text).toLowerCase()).reverse().map(c => UPSIDE[c] ?? c).join(''); },
      examples: [{ in: { text: 'hello' }, out: 'oʃʃǝɥ' }, { in: { text: 'Hi!' }, out: '¡ᴉɥ' }],
    },
    {
      id: 'fancy-letters', name: 'Fancy Unicode Letters', icon: '𝐁', family: 'text',
      desc: 'Bold, italic, script, double-struck and other Unicode letter styles for bios and posts',
      keywords: ['bold text', 'italic', 'font', 'instagram', 'cursive', 'unicode'],
      fields: [area(), pick('style', 'Style', [['bold', '𝐁𝐨𝐥𝐝'], ['italic', '𝐼𝑡𝑎𝑙𝑖𝑐'], ['bold-italic', '𝑩𝒐𝒍𝒅 𝒊𝒕𝒂𝒍𝒊𝒄'], ['sans-bold', '𝗦𝗮𝗻𝘀 𝗯𝗼𝗹𝗱'], ['script', '𝒮𝒸𝓇𝒾𝓅𝓉'], ['bold-script', '𝓑𝓸𝓵𝓭 𝓼𝓬𝓻𝓲𝓹𝓽'], ['fraktur', '𝔉𝔯𝔞𝔨𝔱𝔲𝔯'], ['double-struck', '𝔻𝕠𝕦𝕓𝕝𝕖'], ['monospace', '𝙼𝚘𝚗𝚘'], ['circled', 'Ⓒⓘⓡⓒⓛⓔⓓ'], ['fullwidth', 'Ｗｉｄｅ']])],
      run(v) { return cp(need(v.text)).map(c => fancyChar(c, v.style)).join(''); },
      examples: [
        { in: { text: 'Vex 1', style: 'bold' }, out: '\u{1D415}\u{1D41E}\u{1D431} \u{1D7CF}' },
        { in: { text: 'high', style: 'italic' }, out: 'ℎ\u{1D456}\u{1D454}ℎ' },
        { in: { text: 'CR', style: 'double-struck' }, out: 'ℂℝ' },
        { in: { text: 'Hi 5', style: 'fullwidth' }, out: 'Ｈｉ\u3000５' },
        { in: { text: 'a0', style: 'circled' }, out: 'ⓐ⓪' },
      ],
    },
    {
      id: 'lines-affix', name: 'Add Prefix / Suffix', icon: '⊢', family: 'text',
      desc: 'Add text to the start and/or end of every line (\\t = tab)',
      keywords: ['wrap lines', 'quote lines', 'append', 'prepend'],
      fields: [area('text', 'Lines'), line('prefix', 'Prefix'), line('suffix', 'Suffix'), check('skipBlank', 'Leave blank lines alone', true)],
      run(v) {
        if (!v.prefix && !v.suffix) throw new Error('Enter a prefix or a suffix');
        const pre = unescapeSep(v.prefix), suf = unescapeSep(v.suffix);
        return lines(need(v.text)).map(l => (v.skipBlank && !l.trim() ? l : pre + l + suf)).join('\n');
      },
      examples: [
        { in: { text: 'a\nb', prefix: '- ', suffix: ';' }, out: '- a;\n- b;' },
        { in: { text: 'x\n\ny', prefix: '"', suffix: '",' }, out: '"x",\n\n"y",' },
      ],
    },
    {
      id: 'lines-filter', name: 'Filter Lines', icon: '⏚', family: 'text',
      desc: 'Keep or remove lines that contain some text',
      keywords: ['grep', 'contains', 'search lines', 'exclude'],
      fields: [area('text', 'Lines'), line('find', 'Lines containing'), pick('mode', 'Action', [['keep', 'Keep matching lines'], ['remove', 'Remove matching lines']]), check('ignoreCase', 'Ignore upper/lowercase', true), check('regex', 'Treat as a regular expression')],
      run(v) {
        need(v.text);
        if (!v.find) throw new Error('Enter the text to look for');
        let re;
        try { re = new RegExp(v.regex ? v.find : escapeRe(v.find), v.ignoreCase ? 'i' : ''); } catch (e) { throw new Error(`That is not a valid regular expression (${e.message})`, { cause: e }); }
        const out = lines(v.text).filter(l => re.test(l) === (v.mode === 'keep'));
        if (!out.length) throw new Error(v.mode === 'keep' ? `No lines contain "${v.find}"` : 'Every line matched, so nothing is left');
        return out.join('\n');
      },
      examples: [
        { in: { text: 'ok\nERROR: x\nerror y', find: 'error' }, out: 'ERROR: x\nerror y' },
        { in: { text: 'ok\nERROR: x\nerror y', find: 'error', mode: 'remove' }, out: 'ok' },
        { in: { text: 'a1\nb\nc22', find: '\\d+$', regex: true }, out: 'a1\nc22' },
      ],
    },
    {
      id: 'text-repeat', name: 'Repeat Text', family: 'text',
      desc: 'Repeat text a number of times with a separator (\\n = new line)',
      keywords: ['duplicate', 'multiply', 'copy'],
      fields: [area(), num('count', 'Times', 3, 1, 10000), line('sep', 'Separator', ' ')],
      run(v) {
        const n = whole(v.count, 'Times', 1, 10000), sep = unescapeSep(v.sep);
        if ((need(v.text).length + sep.length) * n > 1e6) throw new Error('That would be over a million characters — use fewer repeats');
        return Array(n).fill(v.text).join(sep);
      },
      examples: [{ in: { text: 'ab', count: 3, sep: '-' }, out: 'ab-ab-ab' }, { in: { text: 'x', count: 2, sep: '\\n' }, out: 'x\nx' }],
    },
    {
      id: 'string-escape', name: 'Escape / Unescape String', icon: '\\n', family: 'text',
      desc: 'Escape text for a JSON or JavaScript string literal, or undo it',
      keywords: ['backslash', 'quotes', 'json string', 'unicode escape'],
      fields: [area(), pick('mode', 'Mode', [['escape', 'Escape (JSON)'], ['ascii', 'Escape, with non-ASCII as \\uXXXX'], ['unescape', 'Unescape']])],
      run(v) {
        need(v.text);
        if (v.mode === 'unescape') {
          // Accept the string with or without its surrounding quotes, bare quotes and raw
          // line breaks inside it, and \' (which JSON lacks); then let JSON.parse do the rest.
          const body = v.text.length >= 2 && /^"[\s\S]*"$/.test(v.text) ? v.text.slice(1, -1) : v.text;
          const raw = { '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
          let json = '';
          for (let i = 0; i < body.length; i++) {
            const c = body[i];
            if (c !== '\\') { json += raw[c] ?? c; continue; }
            const next = body[++i];
            if (next === undefined) throw new Error('The text ends with a lone backslash');
            json += next === "'" ? "'" : c + next;
          }
          try { return JSON.parse('"' + json + '"'); } catch (e) { throw new Error(`That is not a valid escaped string (${e.message})`, { cause: e }); }
        }
        const s = JSON.stringify(v.text).slice(1, -1);
        return v.mode === 'ascii' ? s.replace(/[\u007F-\uFFFF]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) : s;
      },
      examples: [
        { in: { text: 'He said "hi"\n\ttab' }, out: 'He said \\"hi\\"\\n\\ttab' },
        { in: { text: 'café 😀', mode: 'ascii' }, out: 'caf\\u00e9 \\ud83d\\ude00' },
        { in: { text: 'He said \\"hi\\"\\n\\u00e9', mode: 'unescape' }, out: 'He said "hi"\né' },
      ],
    },
    {
      id: 'unicode-info', name: 'Unicode Inspector', icon: 'U+', family: 'text',
      desc: 'Code point, kind, UTF-8 bytes and HTML code for each character',
      keywords: ['code point', 'character info', 'utf-8', 'hex', 'emoji'],
      fields: [line('text', 'Characters', '', 'é€😀')],
      run(v) {
        const chars = cp(v.text);
        if (!chars.length) throw new Error('Enter a character or two first');
        if (chars.length > 500) throw new Error('Inspect at most 500 characters at a time');
        const kind = c => (/\p{Cc}/u.test(c) ? 'control character' : /\p{Cf}/u.test(c) ? 'invisible format character' : /\p{Z}/u.test(c) ? 'space'
          : /\p{Lu}/u.test(c) ? 'uppercase letter' : /\p{Ll}/u.test(c) ? 'lowercase letter' : /\p{L}/u.test(c) ? 'letter'
            : /\p{M}/u.test(c) ? 'combining mark' : /\p{Nd}/u.test(c) ? 'digit' : /\p{N}/u.test(c) ? 'number' : /\p{Sc}/u.test(c) ? 'currency symbol'
              : /\p{Extended_Pictographic}/u.test(c) ? 'emoji / pictograph' : /\p{S}/u.test(c) ? 'symbol' : /\p{P}/u.test(c) ? 'punctuation' : 'other');
        return chars.map(c => {
          const code = c.codePointAt(0);
          const bytes = utf8Bytes(c).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
          return [showChar(c), `U+${code.toString(16).toUpperCase().padStart(4, '0')} · ${kind(c)} · UTF-8 ${bytes} · &#${code};`];
        });
      },
      examples: [{
        in: { text: 'A€ ' },
        out: [['A', 'U+0041 · uppercase letter · UTF-8 41 · &#65;'], ['€', 'U+20AC · currency symbol · UTF-8 E2 82 AC · &#8364;'], ['␣ space', 'U+0020 · space · UTF-8 20 · &#32;']],
      }],
    },
    {
      id: 'quotes-smart', name: 'Smart ⇄ Straight Quotes', icon: '“”', family: 'text',
      desc: 'Turn "straight" quotes into “curly” ones, or back again',
      keywords: ['curly quotes', 'typography', 'apostrophe'],
      fields: [area(), pick('mode', 'Convert to', [['curly', 'Curly “smart” quotes'], ['straight', 'Straight "plain" quotes']])],
      run(v) {
        need(v.text);
        if (v.mode === 'straight') return v.text.replace(/[“”„‟″]/g, '"').replace(/[‘’‚‛′]/g, "'");
        return v.text.replace(/(^|[\s([{–—-])"/gm, '$1“').replace(/"/g, '”')
          .replace(/(^|[\s([{–—-])'/gm, '$1‘').replace(/'/g, '’');
      },
      examples: [
        { in: { text: 'He said "it\'s fine" (\'really\')' }, out: 'He said “it’s fine” (‘really’)' },
        { in: { text: '“Don’t”', mode: 'straight' }, out: '"Don\'t"' },
      ],
    },
    {
      id: 'pig-latin', name: 'Pig Latin', family: 'text',
      desc: 'Translate English into Pig Latin (ellohay orldway)',
      keywords: ['fun', 'language game', 'secret'],
      fields: [area()],
      run(v) {
        return need(v.text).replace(/[A-Za-z]+(?:'[A-Za-z]+)*/g, w => {
          const lower = w.toLowerCase();
          // Leading consonants move to the end: "qu" travels together, and y is a vowel after the first letter.
          let i = 0;
          while (i < lower.length) {
            const c = lower[i];
            if (c === 'u' && lower[i - 1] === 'q') { i++; continue; }
            if ('aeiou'.includes(c) || (c === 'y' && i > 0)) break;
            i++;
          }
          const out = i === 0 ? lower + 'way' : lower.slice(i) + lower.slice(0, i) + 'ay';
          return w[0] === w[0].toUpperCase() ? out[0].toUpperCase() + out.slice(1) : out;
        });
      },
      examples: [
        { in: { text: 'Hello world, apple quick' }, out: 'Ellohay orldway, appleway ickquay' },
        { in: { text: 'rhythm string yes' }, out: 'ythmrhay ingstray esyay' },
      ],
    },
    {
      id: 'palindrome-check', name: 'Palindrome Check', icon: '⟲', family: 'text',
      desc: 'Does it read the same backwards? Ignores case, spaces and punctuation',
      keywords: ['reverse', 'word play'],
      fields: [line('text', 'Word or phrase', '', 'A man, a plan, a canal: Panama')],
      run(v) {
        const s = cp(stripAccents(need(v.text)).toLowerCase()).filter(c => /[\p{L}\p{N}]/u.test(c)).join('');
        if (!s) throw new Error('Enter some letters or digits');
        const yes = s === cp(s).reverse().join('');
        return [['Palindrome?', yes ? 'Yes' : 'No'], ['Compared as', s]];
      },
      examples: [
        { in: { text: 'A man, a plan, a canal: Panama' }, out: [['Palindrome?', 'Yes'], ['Compared as', 'amanaplanacanalpanama']] },
        { in: { text: 'Vex' }, out: [['Palindrome?', 'No'], ['Compared as', 'vex']] },
      ],
    },
    {
      id: 'anagram-check', name: 'Anagram Check', family: 'text',
      desc: 'Are two words or phrases made of exactly the same letters?',
      keywords: ['word play', 'letters', 'scrabble'],
      fields: [line('a', 'First', '', 'Listen'), line('b', 'Second', '', 'Silent')],
      run(v) {
        const norm = s => cp(stripAccents(s).toLowerCase()).filter(c => /[\p{L}\p{N}]/u.test(c)).sort();
        const a = norm(v.a), b = norm(v.b);
        if (!a.length || !b.length) throw new Error('Enter two words or phrases');
        const left = [...b], extraA = [];
        for (const c of a) { const i = left.indexOf(c); if (i >= 0) left.splice(i, 1); else extraA.push(c); }
        if (!extraA.length && !left.length) return [['Anagrams?', 'Yes'], ['Letters', a.join('')]];
        return [['Anagrams?', 'No'], ['Only in the first', extraA.join('') || '—'], ['Only in the second', left.join('') || '—']];
      },
      examples: [
        { in: { a: 'Listen', b: 'Silent' }, out: [['Anagrams?', 'Yes'], ['Letters', 'eilnst']] },
        { in: { a: 'Dormitory', b: 'Dirty room!' }, out: [['Anagrams?', 'Yes'], ['Letters', 'dimoorrty']] },
        { in: { a: 'cats', b: 'acts!!s' }, out: [['Anagrams?', 'No'], ['Only in the first', '—'], ['Only in the second', 's']] },
      ],
    },

    // ================= writing =================
    {
      id: 'readability', name: 'Readability Score', family: 'write',
      desc: 'Flesch reading ease and school grade level of a text',
      keywords: ['flesch', 'kincaid', 'grade level', 'plain english'],
      fields: [area('text', 'Text', 'Paste a paragraph or more')],
      run(v) {
        const words = wordsOf(need(v.text)), sentences = Math.max(1, sentencesOf(v.text).length);
        if (!words.length) throw new Error('There are no words to score');
        const syl = words.reduce((n, w) => n + syllables(w), 0);
        const wps = words.length / sentences, spw = syl / words.length;
        const ease = 206.835 - 1.015 * wps - 84.6 * spw;
        const grade = Math.max(0, 0.39 * wps + 11.8 * spw - 15.59);
        const band = ease >= 90 ? 'very easy' : ease >= 80 ? 'easy' : ease >= 70 ? 'fairly easy' : ease >= 60 ? 'plain English'
          : ease >= 50 ? 'fairly difficult' : ease >= 30 ? 'difficult' : 'very difficult';
        return [
          ['Reading ease', `${ease.toFixed(1)} (${band})`], ['School grade level', grade.toFixed(1)],
          ['Words', String(words.length)], ['Sentences', String(sentences)], ['Syllables', String(syl)],
          ['Words per sentence', wps.toFixed(1)], ['Syllables per word', spw.toFixed(2)],
        ];
      },
      examples: [{
        in: { text: 'The quick brown fox jumps over the lazy dog. It was not amused.' },
        out: [['Reading ease', '96.1 (very easy)'], ['School grade level', '1.5'], ['Words', '13'], ['Sentences', '2'], ['Syllables', '16'], ['Words per sentence', '6.5'], ['Syllables per word', '1.23']],
      }],
    },
    {
      id: 'speech-time', name: 'Speaking Time', family: 'write',
      desc: 'How long a speech or script takes to say out loud (and to read silently)',
      keywords: ['presentation', 'talk', 'script', 'reading time', 'wpm'],
      fields: [area('text', 'Script'), pick('pace', 'Speaking pace', [['130', 'Slow — 130 words/min'], ['150', 'Average — 150 words/min'], ['180', 'Fast — 180 words/min']], '150')],
      run(v) {
        const words = wordsOf(need(v.text)).length;
        if (!words) throw new Error('There are no words to time');
        return [['Words', String(words)], ['Speaking time', duration(words / Number(v.pace) * 60)], ['Reading time (silent, 238 words/min)', duration(words / 238 * 60)]];
      },
      examples: [
        { in: { text: 'word '.repeat(300) }, out: [['Words', '300'], ['Speaking time', '2 min'], ['Reading time (silent, 238 words/min)', '1 min 16 s']] },
        { in: { text: 'Hello there, friends.', pace: '180' }, out: [['Words', '3'], ['Speaking time', '1 s'], ['Reading time (silent, 238 words/min)', '1 s']] },
      ],
    },
    {
      id: 'text-stats', name: 'Sentence & Paragraph Count', icon: '§', family: 'write',
      desc: 'Sentences, paragraphs, lines and sentence length',
      keywords: ['count sentences', 'count paragraphs', 'statistics'],
      fields: [area()],
      run(v) {
        const sentences = sentencesOf(need(v.text));
        const words = wordsOf(v.text).length;
        const paragraphs = v.text.split(/\r?\n\s*\r?\n/).filter(p => p.trim()).length;
        const longest = Math.max(0, ...sentences.map(s => wordsOf(s).length));
        return [
          ['Sentences', String(sentences.length)], ['Paragraphs', String(paragraphs)], ['Lines (not blank)', String(lines(v.text).filter(l => l.trim()).length)],
          ['Words', String(words)], ['Average words per sentence', sentences.length ? (words / sentences.length).toFixed(1) : '0'], ['Longest sentence', `${longest} words`],
        ];
      },
      examples: [{
        in: { text: 'Hi there. How are you?\n\nFine!' },
        out: [['Sentences', '3'], ['Paragraphs', '2'], ['Lines (not blank)', '2'], ['Words', '6'], ['Average words per sentence', '2.0'], ['Longest sentence', '3 words']],
      }],
    },
    {
      id: 'filler-words', name: 'Filler Word Finder', family: 'write',
      desc: 'Spot words that weaken writing: very, really, just, actually…',
      keywords: ['weasel words', 'editing', 'concise', 'style'],
      fields: [area()],
      run(v) {
        const text = need(v.text), total = wordsOf(text).length;
        const found = FILLERS.map(f => [f, (text.match(new RegExp(`(?<![\\p{L}])${f.replace(/ /g, '\\s+')}(?![\\p{L}])`, 'giu')) || []).length]).filter(([, n]) => n);
        if (!found.length) return [['Filler words', 'None found']];
        const sum = found.reduce((n, [, c]) => n + c, 0);
        return found.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([f, n]) => [f, String(n)])
          .concat([['Total', `${sum} of ${total} words (${pct(sum, total)})`]]);
      },
      examples: [
        { in: { text: 'I just really think it is very, very good. Actually, it is.' }, out: [['very', '2'], ['actually', '1'], ['just', '1'], ['really', '1'], ['Total', '5 of 12 words (41.7%)']] },
        { in: { text: 'Clear and direct.' }, out: [['Filler words', 'None found']] },
      ],
    },
    {
      id: 'acronym', name: 'Acronym Maker', icon: 'ABC', family: 'write',
      desc: 'Build an acronym from the first letter of each word',
      keywords: ['initials', 'abbreviation', 'initialism'],
      fields: [line('text', 'Phrase', '', 'Portable Network Graphics'), check('skipSmall', 'Skip small words (of, and, the…)', true), check('dots', 'Add dots (A.B.C.)')],
      run(v) {
        const SMALL = new Set(['a', 'an', 'and', 'the', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'or', 'with']);
        const all = need(v.text).split(/[\s\-–—_/]+/).filter(w => /[\p{L}\p{N}]/u.test(w));
        const kept = v.skipSmall && all.some(w => !SMALL.has(w.toLowerCase())) ? all.filter(w => !SMALL.has(w.toLowerCase())) : all;
        if (!kept.length) throw new Error('Enter a phrase with some words in it');
        return kept.map(w => w.match(/[\p{L}\p{N}]/u)[0].toUpperCase() + (v.dots ? '.' : '')).join('');
      },
      examples: [
        { in: { text: 'Portable Network Graphics' }, out: 'PNG' },
        { in: { text: 'Federal Bureau of Investigation' }, out: 'FBI' },
        { in: { text: 'read-only memory', dots: true }, out: 'R.O.M.' },
      ],
    },
    {
      id: 'bullet-list', name: 'Bullet List Maker', icon: '•', family: 'write',
      desc: 'Turn lines into a bulleted, numbered, lettered or checkbox list',
      keywords: ['list', 'numbered list', 'markdown list', 'checklist'],
      fields: [area('text', 'Items, one per line'), pick('style', 'Style', [['-', '- dash'], ['*', '* asterisk'], ['•', '• bullet'], ['1.', '1. numbered'], ['1)', '1) numbered'], ['a.', 'a. lettered'], ['[ ]', '- [ ] checkbox']]), check('strip', 'Remove existing bullets or numbers', true)],
      run(v) {
        const letters = n => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(97 + (n - 1) % 26) + s; return s; };
        const items = lines(need(v.text)).map(l => (v.strip ? l.replace(/^\s*(?:[-*•+]\s+\[[ xX]\]|[-*•+]|\d+[.)]|[a-z][.)]|\[[ xX]\])\s+/, '') : l).trim()).filter(Boolean);
        return items.map((it, i) => {
          const n = i + 1;
          const mark = v.style === '1.' ? `${n}.` : v.style === '1)' ? `${n})` : v.style === 'a.' ? `${letters(n)}.` : v.style === '[ ]' ? '- [ ]' : v.style;
          return `${mark} ${it}`;
        }).join('\n');
      },
      examples: [
        { in: { text: 'milk\n- eggs\n\n3) bread', style: '1.' }, out: '1. milk\n2. eggs\n3. bread' },
        { in: { text: 'a\nb', style: '[ ]' }, out: '- [ ] a\n- [ ] b' },
        { in: { text: 'x\ny\nz', style: '•' }, out: '• x\n• y\n• z' },
      ],
    },
    {
      id: 'markdown-table', name: 'Markdown Table Maker', icon: '⊞', family: 'write',
      desc: 'Turn rows copied from a spreadsheet (tab or comma separated) into a Markdown table',
      keywords: ['tsv', 'csv', 'github table', 'readme'],
      fields: [area('text', 'Rows (paste from a spreadsheet)'), pick('delim', 'Separator', [['auto', 'Detect'], ['\t', 'Tab'], [',', 'Comma'], [';', 'Semicolon'], ['|', 'Pipe']]), pick('align', 'Align columns', [['none', 'Default'], ['left', 'Left'], ['center', 'Centre'], ['right', 'Right']]), check('header', 'First row is the header', true)],
      run(v) {
        need(v.text, 'some rows');
        const delim = v.delim === 'auto' ? (v.text.includes('\t') ? '\t' : ',') : v.delim;
        let rows = parseDelimited(v.text, delim).map(r => r.map(c => c.trim().replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')));
        const cols = Math.max(...rows.map(r => r.length));
        rows = rows.map(r => Array.from({ length: cols }, (_, i) => r[i] ?? ''));
        const head = v.header ? rows.shift() : Array.from({ length: cols }, (_, i) => `Column ${i + 1}`);
        const len = s => cp(s).length;
        const widths = head.map((h, i) => Math.max(3, len(h), ...rows.map(r => len(r[i]))));
        const cell = (s, i) => s + ' '.repeat(widths[i] - len(s));
        const rule = w => (v.align === 'left' ? ':' + '-'.repeat(w - 1) : v.align === 'right' ? '-'.repeat(w - 1) + ':' : v.align === 'center' ? ':' + '-'.repeat(w - 2) + ':' : '-'.repeat(w));
        const fmtRow = r => '| ' + r.map(cell).join(' | ') + ' |';
        return [fmtRow(head), '| ' + widths.map(rule).join(' | ') + ' |', ...rows.map(fmtRow)].join('\n');
      },
      examples: [
        { in: { text: 'Name\tAge\nAda\t36' }, out: '| Name | Age |\n| ---- | --- |\n| Ada  | 36  |' },
        { in: { text: 'a,b|c\n1,2', align: 'center' }, out: '| a   | b\\|c |\n| :-: | :--: |\n| 1   | 2    |' },
        { in: { text: '1,2', header: false }, out: '| Column 1 | Column 2 |\n| -------- | -------- |\n| 1        | 2        |' },
      ],
    },
    {
      id: 'hashtags', name: 'Hashtag Generator', family: 'write',
      desc: 'Turn a caption into hashtags — one per keyword, or one #CamelCase tag',
      keywords: ['social media', 'instagram', 'tags', 'twitter'],
      fields: [area('text', 'Caption or keywords'), pick('mode', 'Make', [['words', 'A tag for each keyword'], ['phrase', 'One #CamelCase tag']]), num('max', 'Maximum tags', 10, 1, 30)],
      run(v) {
        const ws = wordsOf(stripAccents(need(v.text))).map(w => w.replace(/[^A-Za-z0-9]/g, '')).filter(Boolean);
        if (!ws.length) throw new Error('There are no words to make tags from');
        if (v.mode === 'phrase') return '#' + ws.map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
        const max = whole(v.max, 'Maximum tags', 1, 30), counts = new Map();
        for (const w of ws.map(x => x.toLowerCase())) if (!STOP.has(w) && w.length > 1) counts.set(w, (counts.get(w) || 0) + 1);
        if (!counts.size) throw new Error('Only very common words were found — add some keywords');
        return [...counts].sort((a, b) => b[1] - a[1]).slice(0, max).map(([w]) => '#' + w).join(' ');
      },
      examples: [
        { in: { text: 'Summer beach party at the beach!' }, out: '#beach #summer #party' },
        { in: { text: 'summer beach party', mode: 'phrase' }, out: '#SummerBeachParty' },
      ],
    },

    // ================= generators =================
    {
      id: 'lorem-ipsum', name: 'Lorem Ipsum', icon: '¶', family: 'generate',
      desc: 'Placeholder text — a set number of paragraphs, sentences or words',
      keywords: ['placeholder', 'dummy text', 'filler text'],
      fields: [num('count', 'How many', 3, 1, 5000), pick('unit', 'Of', [['paragraphs', 'Paragraphs'], ['sentences', 'Sentences'], ['words', 'Words']])],
      run(v) {
        const max = { paragraphs: 50, sentences: 500, words: 5000 }[v.unit];
        const n = whole(v.count, 'How many', 1, max);
        let w = 0, s = 0;
        const take = k => Array.from({ length: k }, () => LOREM[w++ % LOREM.length]);
        const sentence = () => sentenceCase(take(LOREM_SENTENCE[s++ % LOREM_SENTENCE.length]));
        if (v.unit === 'words') return sentenceCase(take(n));
        if (v.unit === 'sentences') return Array.from({ length: n }, sentence).join(' ');
        return Array.from({ length: n }, (_, p) => Array.from({ length: LOREM_PARAGRAPH[p % LOREM_PARAGRAPH.length] }, sentence).join(' ')).join('\n\n');
      },
      examples: [
        { in: { count: 5, unit: 'words' }, out: 'Lorem ipsum dolor sit amet.' },
        { in: { count: 2, unit: 'sentences' }, out: 'Lorem ipsum dolor sit amet consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' },
        { in: { count: 2, unit: 'paragraphs' }, match: /^Lorem ipsum[^\n]+\.\n\n[A-Z][^\n]+\.$/ },
      ],
    },
    {
      id: 'random-number', name: 'Random Number', family: 'generate',
      desc: 'Random numbers in a range — whole or with decimals, repeats allowed or not',
      keywords: ['rng', 'random integer', 'lottery', 'pick a number'],
      fields: [num('min', 'From', 1, -1e15, 1e15, 'any'), num('max', 'To', 100, -1e15, 1e15, 'any'), num('count', 'How many', 1, 1, 1000), num('decimals', 'Decimal places', 0, 0, 10), check('unique', 'No repeats')],
      run(v) {
        const count = whole(v.count, 'How many', 1, 1000), dp = whole(v.decimals, 'Decimal places', 0, 10);
        if (!Number.isFinite(v.min) || !Number.isFinite(v.max)) throw new Error('Enter both ends of the range');
        if (v.min > v.max) throw new Error('"From" must not be more than "To"');
        const scale = 10 ** dp, lo = Math.ceil(v.min * scale - 1e-9), hi = Math.floor(v.max * scale + 1e-9), size = hi - lo + 1;
        if (size < 1) throw new Error('No number with that many decimal places fits in the range');
        if (size > 2 ** 53) throw new Error('That range is too large — narrow it or use fewer decimal places');
        if (v.unique && count > size) throw new Error(`Only ${size} different numbers fit in that range`);
        const picked = [], seen = new Set();
        while (picked.length < count) {
          const x = lo + randomBelow(size);
          if (v.unique) { if (seen.has(x)) continue; seen.add(x); }
          picked.push((x / scale).toFixed(dp));
        }
        return picked.join('\n');
      },
      examples: [
        { in: { min: 1, max: 6 }, match: /^[1-6]$/ },
        { in: { min: 0, max: 1, decimals: 2, count: 3 }, match: /^(0\.\d\d|1\.00)(\n(0\.\d\d|1\.00)){2}$/ },
        { in: { min: 5, max: 5 }, out: '5' },
      ],
    },
    {
      id: 'dice-roll', name: 'Dice Roller', icon: '⚄', family: 'generate',
      desc: 'Roll dice in RPG notation: 2d6+3, d20, 4d6kh3 (keep highest 3), 1d%',
      keywords: ['d20', 'dnd', 'tabletop', 'rpg', 'roll'],
      fields: [line('dice', 'Dice', '2d6', '2d6+3')],
      run(v) {
        const src = need(v.dice, 'the dice to roll').replace(/\s+/g, '').toLowerCase();
        const re = /([+-]?)(?:(\d*)d(\d+|%)(?:(kh|kl|k)(\d+))?|(\d+))/y;
        const rows = [];
        let total = 0, pos = 0;
        while (pos < src.length) {
          re.lastIndex = pos;
          const m = re.exec(src);
          if (!m || (pos > 0 && !m[1])) throw new Error(`Couldn't read "${src.slice(pos)}" — use notation like 2d6+3 or 4d6kh3`);
          pos = re.lastIndex;
          const sign = m[1] === '-' ? -1 : 1;
          if (m[6] !== undefined) { total += sign * Number(m[6]); continue; }
          const count = m[2] === '' ? 1 : Number(m[2]), sides = m[3] === '%' ? 100 : Number(m[3]);
          if (count < 1 || count > 1000) throw new Error('Roll between 1 and 1000 dice at a time');
          if (sides < 2 || sides > 1e6) throw new Error('Dice need between 2 and 1,000,000 sides');
          const rolls = Array.from({ length: count }, () => 1 + randomBelow(sides));
          let kept = rolls;
          if (m[4]) {
            const k = Number(m[5]);
            if (k < 1 || k > count) throw new Error(`You can keep between 1 and ${count} of ${count} dice`);
            kept = [...rolls].sort((a, b) => (m[4] === 'kl' ? a - b : b - a)).slice(0, k);
          }
          const sum = kept.reduce((a, b) => a + b, 0);
          total += sign * sum;
          rows.push([m[0].replace(/^\+/, ''), rolls.join(', ') + (m[4] ? ` → kept ${kept.join(', ')}` : '') + ` = ${sum}`]);
        }
        if (!rows.length) throw new Error('Add at least one die, like d20');
        return rows.concat([['Total', String(total)]]);
      },
      examples: [
        { in: { dice: '2d6+3' }, match: /^2d6: [1-6], [1-6] = \d+\nTotal: \d+$/ },
        { in: { dice: '4d6kh3' }, match: /^4d6kh3: [1-6], [1-6], [1-6], [1-6] → kept [1-6], [1-6], [1-6] = \d+\nTotal: \d+$/ },
        { in: { dice: 'd2 - 1d2' }, match: /^d2: [12] = [12]\n-1d2: [12] = [12]\nTotal: (-1|0|1)$/ },
      ],
    },
    {
      id: 'coin-flip', name: 'Coin Flip', family: 'generate',
      desc: 'Flip a fair coin once or many times',
      keywords: ['heads or tails', 'toss', 'decide', 'random'],
      fields: [num('count', 'Flips', 1, 1, 10000)],
      run(v) {
        const n = whole(v.count, 'Flips', 1, 10000);
        const flips = Array.from({ length: n }, () => (randomBelow(2) ? 'H' : 'T'));
        if (n === 1) return flips[0] === 'H' ? 'Heads' : 'Tails';
        const heads = flips.filter(f => f === 'H').length;
        const rows = [['Heads', `${heads} (${pct(heads, n)})`], ['Tails', `${n - heads} (${pct(n - heads, n)})`]];
        return n <= 100 ? [['Results', flips.join(' ')], ...rows] : rows;
      },
      examples: [
        { in: { count: 1 }, match: /^(Heads|Tails)$/ },
        { in: { count: 10 }, match: /^Results: ([HT] ){9}[HT]\nHeads: \d+ \(\d+%\)\nTails: \d+ \(\d+%\)$/ },
      ],
    },
    {
      id: 'random-pick', name: 'Random Picker', family: 'generate',
      desc: 'Pick one or more random items from a list — raffles, giveaways, who goes first',
      keywords: ['raffle', 'draw', 'winner', 'choose', 'decide'],
      fields: [area('items', 'Items (one per line, or comma separated)'), num('count', 'How many to pick', 1, 1, 1000), check('unique', 'Never pick the same item twice', true)],
      run(v) {
        const items = listItems(need(v.items, 'some items'));
        const n = whole(v.count, 'How many', 1, 1000);
        if (v.unique) {
          if (n > items.length) throw new Error(`There are only ${items.length} items to pick from`);
          return shuffle(items).slice(0, n).join('\n');
        }
        return Array.from({ length: n }, () => items[randomBelow(items.length)]).join('\n');
      },
      examples: [
        { in: { items: 'red\ngreen\nblue' }, match: /^(red|green|blue)$/ },
        { in: { items: 'a, b, c', count: 3 }, match: /^[abc]\n[abc]\n[abc]$/ },
      ],
    },
    {
      id: 'lines-shuffle', name: 'Shuffle Lines', family: 'generate',
      desc: 'Put lines in a random order',
      keywords: ['randomize', 'random order', 'mix'],
      fields: [area('text', 'Lines')],
      run(v) { return shuffle(lines(need(v.text)).filter(l => l.trim())).join('\n'); },
      examples: [{ in: { text: 'a\nb\n\nc' }, match: /^[abc]\n[abc]\n[abc]$/ }],
    },
    {
      id: 'team-split', name: 'Team Splitter', family: 'generate',
      desc: 'Split a list of names into random, evenly sized teams',
      keywords: ['groups', 'random teams', 'classroom', 'pairs'],
      fields: [area('items', 'Names (one per line, or comma separated)'), num('teams', 'Number of teams', 2, 2, 100), check('shuffle', 'Shuffle first', true)],
      run(v) {
        const names = listItems(need(v.items, 'some names'));
        const t = whole(v.teams, 'Teams', 2, 100);
        if (t > names.length) throw new Error(`${names.length} names can't make ${t} teams`);
        const order = v.shuffle ? shuffle(names) : names;
        const teams = Array.from({ length: t }, () => []);
        order.forEach((name, i) => teams[i % t].push(name));
        return teams.map((members, i) => [`Team ${i + 1}`, members.join(', ')]);
      },
      examples: [
        { in: { items: 'a\nb\nc\nd\ne', shuffle: false }, out: [['Team 1', 'a, c, e'], ['Team 2', 'b, d']] },
        { in: { items: 'a, b, c, d', teams: 2 }, match: /^Team 1: [abcd], [abcd]\nTeam 2: [abcd], [abcd]$/ },
      ],
    },
    {
      id: 'random-string', name: 'Random String', family: 'generate',
      desc: 'Random strings from the characters you choose — IDs, codes, test data',
      keywords: ['token', 'random code', 'random letters', 'nonce'],
      fields: [
        num('length', 'Length', 16, 1, 4096), num('count', 'How many', 1, 1, 100),
        check('lower', 'a–z', true), check('upper', 'A–Z', true), check('digits', '0–9', true), check('symbols', 'Symbols !@#…'),
        check('noSimilar', 'Leave out look-alikes (0 O o 1 l I |)'), line('extra', 'Also use these characters'),
      ],
      run(v) {
        const len = whole(v.length, 'Length', 1, 4096), count = whole(v.count, 'How many', 1, 100);
        const pool = (v.lower ? 'abcdefghijklmnopqrstuvwxyz' : '') + (v.upper ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : '') + (v.digits ? '0123456789' : '')
          + (v.symbols ? '!@#$%^&*()-_=+[]{};:,.<>?/~' : '') + v.extra;
        let chars = [...new Set(cp(pool))];
        if (v.noSimilar) chars = chars.filter(c => !'0Oo1lI|'.includes(c));
        if (!chars.length) throw new Error('Choose at least one kind of character');
        return Array.from({ length: count }, () => Array.from({ length: len }, () => chars[randomBelow(chars.length)]).join('')).join('\n');
      },
      examples: [
        { in: {}, match: /^[A-Za-z0-9]{16}$/ },
        { in: { length: 8, count: 2, lower: false, upper: false, digits: false, extra: 'xy' }, match: /^[xy]{8}\n[xy]{8}$/ },
      ],
    },
    {
      id: 'username-gen', name: 'Username Ideas', family: 'generate',
      desc: 'Username variations built from your name, with an optional number or word',
      keywords: ['handle', 'screen name', 'gamertag', 'nickname'],
      fields: [line('name', 'Your name', '', 'Jane Doe'), line('extra', 'Number or word to add (optional)', '', '42')],
      run(v) {
        const parts = wordsOf(stripAccents(need(v.name, 'a name')).toLowerCase()).map(w => w.replace(/[^a-z0-9]/g, '')).filter(Boolean);
        if (!parts.length) throw new Error('Enter a name with some letters in it');
        const extra = stripAccents(v.extra).toLowerCase().replace(/[^a-z0-9]/g, '');
        const f = parts[0], l = parts.length > 1 ? parts[parts.length - 1] : '';
        const out = l
          ? [f + l, `${f}.${l}`, `${f}_${l}`, f[0] + l, f + l[0], l + f, `${f[0]}.${l}`, `${l}.${f}`, 'the' + f + l]
          : [f, 'the' + f, 'real' + f, 'iam' + f, f + 'official', 'its' + f];
        if (parts.length > 2) out.push(parts.slice(0, -1).map(p => p[0]).join('') + l); // Mary Ann Smith -> masmith
        if (extra) out.push(...(l ? [f + l + extra, `${f}.${l}${extra}`, f[0] + l + extra, f + extra] : [f + extra, `${f}_${extra}`, extra + f]));
        return [...new Set(out)].join('\n');
      },
      examples: [
        { in: { name: 'Jane Doe' }, out: 'janedoe\njane.doe\njane_doe\njdoe\njaned\ndoejane\nj.doe\ndoe.jane\nthejanedoe' },
        { in: { name: 'Zoë', extra: '42' }, out: 'zoe\nthezoe\nrealzoe\niamzoe\nzoeofficial\nitszoe\nzoe42\nzoe_42\n42zoe' },
      ],
    },

    // ================= everyday =================
    {
      id: 'number-words', name: 'Number to Words', icon: '½', family: 'general',
      desc: 'Write a number out in English words (for cheques, forms and captions)',
      keywords: ['spell number', 'cheque', 'check writing', 'english'],
      fields: [line('n', 'Number', '', '1234.56'), check('and', 'British style ("one hundred and five")')],
      run(v) {
        const s = need(v.n, 'a number').trim().replace(/[,_\s]/g, '');
        const m = s.match(/^(-?)(\d+)(?:\.(\d+))?$/);
        if (!m) throw new Error('Enter a plain number, like 1234 or -12.5');
        const out = intToWords(m[2], v.and) + (m[3] ? ' point ' + [...m[3]].map(d => ONES[d]).join(' ') : '');
        return (m[1] && /[1-9]/.test(m[2] + (m[3] || '')) ? 'minus ' : '') + out;
      },
      examples: [
        { in: { n: '1234' }, out: 'one thousand two hundred thirty-four' },
        { in: { n: '1,234', and: true }, out: 'one thousand two hundred and thirty-four' },
        { in: { n: '1005', and: true }, out: 'one thousand and five' },
        { in: { n: '-12.05' }, out: 'minus twelve point zero five' },
        { in: { n: '7000000019' }, out: 'seven billion nineteen' },
        { in: { n: '0' }, out: 'zero' },
      ],
    },
    {
      id: 'ordinal', name: 'Ordinal Numbers', icon: '1st', family: 'general',
      desc: 'Turn a number into its ordinal: 1st, 22nd, 113th — and in words',
      keywords: ['first second third', 'suffix', 'st nd rd th'],
      fields: [line('n', 'Number', '', '21')],
      run(v) {
        const d = wholeDigits(need(v.n, 'a number'), 'The number').replace(/^0+(?=\d)/, '');
        const last2 = Number(d.slice(-2)), last = last2 % 10;
        const suffix = last2 >= 11 && last2 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][last] || 'th';
        return [['Ordinal', d + suffix], ['In words', ordinalWords(intToWords(d, false))]];
      },
      examples: [
        { in: { n: '21' }, out: [['Ordinal', '21st'], ['In words', 'twenty-first']] },
        { in: { n: '112' }, out: [['Ordinal', '112th'], ['In words', 'one hundred twelfth']] },
        { in: { n: '1003' }, out: [['Ordinal', '1003rd'], ['In words', 'one thousand third']] },
        { in: { n: '40' }, out: [['Ordinal', '40th'], ['In words', 'fortieth']] },
      ],
    },
    {
      id: 'roman-numerals', name: 'Roman Numerals', icon: 'Ⅻ', family: 'general',
      desc: 'Convert numbers to Roman numerals and back (1–3999)',
      keywords: ['roman', 'numerals', 'mcmxc', 'latin numbers'],
      fields: [line('value', 'Number or numeral', '', '2024 or MMXXIV')],
      run(v) {
        const s = need(v.value, 'a number or a Roman numeral').trim();
        if (/^\d+$/.test(s)) {
          const n = Number(s);
          if (n < 1 || n > 3999) throw new Error('Roman numerals cover 1 to 3999');
          return toRoman(n);
        }
        const r = s.toUpperCase();
        if (!/^[MDCLXVI]+$/.test(r)) throw new Error('Enter digits, or a numeral made of I V X L C D M');
        const val = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
        let n = 0;
        for (let i = 0; i < r.length; i++) n += val[r[i]] < (val[r[i + 1]] || 0) ? -val[r[i]] : val[r[i]];
        // Reject forms like IIII or IC by insisting the numeral is written the standard way.
        if (n < 1 || n > 3999 || toRoman(n) !== r) throw new Error(`"${s}" is not a standard Roman numeral${n >= 1 && n <= 3999 ? ` — did you mean ${toRoman(n)}?` : ''}`);
        return String(n);
      },
      examples: [
        { in: { value: '2024' }, out: 'MMXXIV' },
        { in: { value: 'mcmxciv' }, out: '1994' },
        { in: { value: '3999' }, out: 'MMMCMXCIX' },
      ],
    },
    {
      id: 'password-strength', name: 'Password Strength', family: 'general',
      desc: 'Estimate how hard a password is to guess (entropy bits) — nothing leaves this page',
      keywords: ['entropy', 'password checker', 'crack time', 'security'],
      fields: [line('password', 'Password', '', 'Type a password to test')],
      run(v) {
        const pw = v.password;
        if (!pw) throw new Error('Type a password to test');
        const chars = cp(pw);
        const has = { lowercase: /[a-z]/.test(pw), uppercase: /[A-Z]/.test(pw), digits: /[0-9]/.test(pw), symbols: /[ -/:-@[-`{-~]/.test(pw), 'other characters': /[^\x20-\x7e]/.test(pw) };
        const pool = (has.lowercase ? 26 : 0) + (has.uppercase ? 26 : 0) + (has.digits ? 10 : 0) + (has.symbols ? 33 : 0) + (has['other characters'] ? 100 : 0);
        // Characters that repeat or continue a run (aaa, 123, abc) add almost nothing for a guesser.
        let bits = 0, patterned = false;
        chars.forEach((c, i) => {
          const d = i ? c.codePointAt(0) - chars[i - 1].codePointAt(0) : NaN;
          const run = i > 0 && (d === 0 || (Math.abs(d) === 1 && /[a-z0-9]/i.test(c) && /[a-z0-9]/i.test(chars[i - 1])));
          if (run) patterned = true;
          bits += run ? 1 : Math.log2(pool);
        });
        const common = COMMON_PASSWORDS.has(pw.toLowerCase()) || COMMON_PASSWORDS.has(pw.toLowerCase().replace(/[\d\W_]+$/, ''));
        if (common) bits = Math.min(bits, 10);
        const rating = bits < 28 ? 'Very weak' : bits < 36 ? 'Weak' : bits < 60 ? 'Reasonable' : bits < 128 ? 'Strong' : 'Very strong';
        const secs = 2 ** bits / 2 / 1e10; // average guesses, offline attack at 10 billion guesses a second
        const years = secs / 31557600;
        const time = secs < 1 ? 'less than a second' : secs < 60 ? `${Math.round(secs)} seconds` : secs < 3600 ? `${Math.round(secs / 60)} minutes`
          : secs < 86400 ? `${Math.round(secs / 3600)} hours` : years < 1 ? `${Math.round(secs / 86400)} days`
            : years < 1e9 ? `about ${thousands(Number(years.toPrecision(2)))} years` : 'more than a billion years';
        const tips = [];
        if (common) tips.push('this is one of the most common passwords');
        if (chars.length < 12) tips.push('use at least 12 characters');
        if (Object.values(has).filter(Boolean).length < 3) tips.push('mix in more kinds of characters');
        if (patterned) tips.push('avoid repeated or sequential characters (aaa, 123, abc)');
        const rows = [
          ['Length', `${chars.length} characters`], ['Character types', Object.keys(has).filter(k => has[k]).join(', ')],
          ['Estimated entropy', `${bits.toFixed(1)} bits`], ['Rating', rating], ['Time to guess (offline, 10 billion/s)', time],
        ];
        if (tips.length) rows.push(['Tips', tips.join('; ')]);
        return rows;
      },
      examples: [
        {
          in: { password: 'Tr0ub4dor&3' },
          out: [['Length', '11 characters'], ['Character types', 'lowercase, uppercase, digits, symbols'], ['Estimated entropy', '72.3 bits'], ['Rating', 'Strong'], ['Time to guess (offline, 10 billion/s)', 'about 9,000 years'], ['Tips', 'use at least 12 characters']],
        },
        { in: { password: 'Password1!' }, match: /Rating: Very weak[\s\S]*Tips: this is one of the most common passwords/ },
        { in: { password: 'correct horse battery staple' }, match: /Rating: Very strong/ },
      ],
    },
  ];

  if (typeof ToolboxPacks !== 'undefined') ToolboxPacks.add(PACK);
  if (typeof module !== 'undefined' && module.exports) module.exports = PACK;
})();
