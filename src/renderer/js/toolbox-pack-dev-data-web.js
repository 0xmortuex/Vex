// === Vex Toolbox pack: developer, data, web, security and design ===
// Converters, formatters, parsers, checksums and CSS generators — all pure
// and synchronous (hashes are plain JS, no crypto.subtle). Contract: js/toolbox-packs.js.
(function () {
  const fail = (msg) => { throw new Error(msg); };

  // Trim to at most `d` decimals and drop trailing zeros (and "-0").
  const fmt = (n, d = 4) => { const x = Number(n.toFixed(d)); return String(Object.is(x, -0) ? 0 : x); };

  function num(v, label, { min = -Infinity, max = Infinity, int = false } = {}) {
    if (!Number.isFinite(v)) fail(`Enter a number for ${label}`);
    if (int && !Number.isInteger(v)) fail(`${label} must be a whole number`);
    if (v < min || v > max) fail(`${label} must be between ${min} and ${max}`);
    return v;
  }

  const need = (s, what) => { if (!String(s).trim()) fail(`Enter ${what}`); return s; };

  function parseJson(text, what = 'the JSON') {
    need(text, what);
    try { return JSON.parse(text); } catch (e) { fail(`${what[0].toUpperCase() + what.slice(1)} is not valid: ${e.message}`); }
  }

  const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

  // ---- bytes, UTF-8, hex, base64 ----------------------------------------
  function utf8(str) {
    const out = [];
    for (const ch of str) {
      let c = ch.codePointAt(0);
      if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd; // lone surrogate, as TextEncoder does
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  // Strict UTF-8 decode; null when the bytes are not valid UTF-8.
  function utf8Text(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length;) {
      const b = bytes[i];
      if (b < 0x80) { s += String.fromCharCode(b); i++; continue; }
      let n, c;
      if (b >= 0xc2 && b < 0xe0) { n = 1; c = b & 31; }
      else if (b >= 0xe0 && b < 0xf0) { n = 2; c = b & 15; }
      else if (b >= 0xf0 && b < 0xf5) { n = 3; c = b & 7; }
      else return null;
      if (i + n >= bytes.length) return null;
      for (let k = 1; k <= n; k++) {
        const x = bytes[i + k];
        if ((x & 0xc0) !== 0x80) return null;
        c = (c << 6) | (x & 63);
      }
      if ((n === 2 && c < 0x800) || (n === 3 && (c < 0x10000 || c > 0x10ffff)) || (c >= 0xd800 && c <= 0xdfff)) return null;
      s += String.fromCodePoint(c);
      i += n + 1;
    }
    return s;
  }

  const hex = (bytes) => bytes.map(b => b.toString(16).padStart(2, '0')).join('');

  function hexBytes(text) {
    const h = text.replace(/^0x/i, '').replace(/[\s:-]/g, '');
    if (!h) fail('Enter some hex');
    if (/[^0-9a-f]/i.test(h)) fail('Hex may only contain 0-9 and a-f');
    if (h.length % 2) fail('Hex needs an even number of digits (two per byte)');
    const out = [];
    for (let i = 0; i < h.length; i += 2) out.push(parseInt(h.slice(i, i + 2), 16));
    return out;
  }

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      s += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
    }
    return s;
  }
  function b64Bytes(text) {
    let s = text.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
    if (!s) fail('Enter some Base64');
    s = s.replace(/=+$/, '');
    if (/[^A-Za-z0-9+/]/.test(s)) fail('Base64 may only contain A-Z, a-z, 0-9, + and / (or - and _)');
    if (s.length % 4 === 1) fail('Base64 length is wrong — a character is missing or extra');
    const out = [];
    let buf = 0, bits = 0;
    for (const ch of s) {
      buf = ((buf << 6) | B64.indexOf(ch)) & 0x3fff; bits += 6;
      if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); }
    }
    return out;
  }

  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function b32(bytes) {
    let s = '', buf = 0, bits = 0;
    for (const b of bytes) {
      buf = (buf << 8) | b; bits += 8;
      while (bits >= 5) { bits -= 5; s += B32[(buf >> bits) & 31]; }
      buf &= 0xff;
    }
    if (bits) s += B32[(buf << (5 - bits)) & 31];
    while (s.length % 8) s += '=';
    return s;
  }
  function b32Bytes(text) {
    const s = text.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
    if (!s) fail('Enter some Base32');
    const bad = s.match(/[^A-Z2-7]/);
    if (bad) fail(`"${bad[0]}" is not a Base32 character (A-Z and 2-7 only)`);
    const out = [];
    let buf = 0, bits = 0;
    for (const ch of s) {
      buf = ((buf << 5) | B32.indexOf(ch)) & 0xfff; bits += 5;
      if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); }
    }
    return out;
  }

  // ---- SHA-1, SHA-256, HMAC (FIPS 180-4, RFC 2104) ------------------------
  function mdPad(bytes) {
    const p = bytes.slice();
    p.push(0x80);
    while (p.length % 64 !== 56) p.push(0);
    const bitLen = bytes.length * 8;
    const hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
    p.push(hi >>> 24, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, lo >>> 24, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
    return p;
  }
  const word = (p, i) => (p[i] << 24) | (p[i + 1] << 16) | (p[i + 2] << 8) | p[i + 3];
  const wordsToBytes = (ws) => ws.flatMap(w => [w >>> 24, (w >>> 16) & 255, (w >>> 8) & 255, w & 255]);

  function sha1(bytes) {
    const p = mdPad(bytes);
    const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    const w = new Array(80);
    for (let off = 0; off < p.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = word(p, off + 4 * i);
      for (let i = 16; i < 80; i++) { const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
      let [a, b, c, d, e] = h;
      for (let i = 0; i < 80; i++) {
        const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
        const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
        const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
        e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0; h[4] = (h[4] + e) | 0;
    }
    return wordsToBytes(h);
  }

  const K256 = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  function sha256(bytes) {
    const p = mdPad(bytes);
    const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Array(64);
    const rot = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < p.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = word(p, off + 4 * i);
      for (let i = 16; i < 64; i++) {
        const s0 = rot(w[i - 15], 7) ^ rot(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rot(w[i - 2], 17) ^ rot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = (hh + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) | 0;
        const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    return wordsToBytes(h);
  }

  function hmac(hash, key, msg) {
    let k = key.length > 64 ? hash(key) : key.slice();
    while (k.length < 64) k.push(0);
    const inner = hash(k.map(b => b ^ 0x36).concat(msg));
    return hash(k.map(b => b ^ 0x5c).concat(inner));
  }
  const HASHES = { sha1, sha256 };

  // RFC 4226 HOTP / RFC 6238 TOTP.
  function hotp(keyBytes, counter, digits, hash) {
    const c = [];
    let n = counter;
    for (let i = 0; i < 8; i++) { c.unshift(n % 256); n = Math.floor(n / 256); }
    const mac = hmac(hash, keyBytes, c);
    const o = mac[mac.length - 1] & 15;
    const bin = ((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
    return String(bin % 10 ** digits).padStart(digits, '0');
  }

  // ---- CSV (RFC 4180: quoted fields may hold delimiters, "" and newlines) --
  function parseCsv(text, delim = ',') {
    const rows = [];
    let row = [], field = '', quoted = false, atStart = true;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c !== '"') { field += c; continue; }
        if (text[i + 1] === '"') { field += '"'; i++; continue; }
        quoted = false;
        const n = text[i + 1];
        if (n !== undefined && n !== delim && n !== '\n' && n !== '\r') fail(`Row ${rows.length + 1}: unexpected text after a closing quote`);
        continue;
      }
      if (c === '"' && atStart) { quoted = true; atStart = false; continue; }
      if (c === delim) { row.push(field); field = ''; atStart = true; continue; }
      if (c === '\r' || c === '\n') {
        row.push(field); rows.push(row); row = []; field = ''; atStart = true;
        if (c === '\r' && text[i + 1] === '\n') i++;
        continue;
      }
      field += c; atStart = false;
    }
    if (quoted) fail('A quoted field is never closed (missing ")');
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => !(r.length === 1 && r[0] === ''));
  }

  function csvField(s, delim = ',') {
    s = s == null ? '' : String(s);
    return s.includes(delim) || /["\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const toCsv = (rows, delim = ',') => rows.map(r => r.map(f => csvField(f, delim)).join(delim)).join('\n');

  function csvTable(text, delim = ',') {
    need(text, 'some CSV');
    const rows = parseCsv(text, delim);
    if (!rows.length) fail('The CSV has no rows');
    return rows;
  }

  // A column by header name or 1-based number.
  function columnIndex(header, ref) {
    const r = String(ref).trim();
    if (!r) fail('Enter a column name or number');
    if (header) {
      const i = header.indexOf(r);
      if (i >= 0) return i;
    }
    if (/^\d+$/.test(r)) {
      const i = Number(r) - 1;
      const width = header ? header.length : Infinity;
      if (i < 0 || i >= width) fail(`Column ${r} does not exist`);
      return i;
    }
    fail(`No column named "${r}"`);
  }

  const isNumeric = (s) => /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(s);

  // ---- YAML ---------------------------------------------------------------
  const YAML_RESERVED = /^(true|false|null|yes|no|on|off|y|n|~)$/i;
  function yamlStr(s) {
    const plainOk = s !== '' && s === s.trim() && !YAML_RESERVED.test(s) && !isNumeric(s) &&
      !/^[-?:,[\]{}#&*!|>'"%@`]/.test(s) && !/[\x00-\x1f\x7f]/.test(s) &&
      !/: |:$| #/.test(s) && !/^0x[0-9a-f]+$|^0o[0-7]+$|^[-+]?\.(inf|nan)$/i.test(s);
    return plainOk ? s : JSON.stringify(s);
  }
  function yamlScalar(v) {
    if (v === null) return 'null';
    if (typeof v === 'string') return yamlStr(v);
    return String(v);
  }
  const hasItems = (x) => x !== null && typeof x === 'object' && (Array.isArray(x) ? x.length > 0 : Object.keys(x).length > 0);
  function toYaml(v, ind = 0) {
    const pad = ' '.repeat(ind);
    if (Array.isArray(v)) {
      if (!v.length) return pad + '[]';
      return v.map(x => hasItems(x) ? pad + '- ' + toYaml(x, ind + 2).slice(ind + 2) : pad + '- ' + toYamlLeaf(x)).join('\n');
    }
    if (isObj(v)) {
      const keys = Object.keys(v);
      if (!keys.length) return pad + '{}';
      return keys.map(k => hasItems(v[k]) ? `${pad}${yamlStr(k)}:\n${toYaml(v[k], ind + 2)}` : `${pad}${yamlStr(k)}: ${toYamlLeaf(v[k])}`).join('\n');
    }
    return pad + yamlScalar(v);
  }
  const toYamlLeaf = (x) => Array.isArray(x) ? '[]' : isObj(x) ? '{}' : yamlScalar(x);

  // YAML subset → value. Supports block maps and lists (incl. "- key: v"),
  // plain/quoted scalars, one-level flow lists/maps, comments and a leading
  // "---". Anything else (anchors, tags, block scalars, multi-docs…) throws.
  function parseYaml(text) {
    const lines = [];
    text.split(/\r?\n/).forEach((raw, idx) => {
      const n = idx + 1;
      if (/^\s*$/.test(raw) || /^\s*#/.test(raw)) return;
      if (/^ *\t/.test(raw)) fail(`Line ${n}: tabs are not allowed for indentation in YAML`);
      const t = yamlStripComment(raw, n).replace(/\s+$/, '');
      if (!t.trim()) return;
      if (t === '---' && !lines.length) return;
      if (t === '---') fail(`Line ${n}: multiple documents are not supported`);
      if (t === '...') return;
      if (/^%/.test(t)) fail(`Line ${n}: YAML directives are not supported`);
      lines.push({ n, indent: t.match(/^ */)[0].length, text: t.trim() });
    });
    if (!lines.length) fail('The YAML document is empty');
    let i = 0;
    const isSeq = (t) => t === '-' || t.startsWith('- ');

    function block(indent) {
      return isSeq(lines[i].text) ? seq(indent) : map(indent);
    }
    function seq(indent) {
      const out = [];
      while (i < lines.length && lines[i].indent === indent && isSeq(lines[i].text)) {
        const L = lines[i];
        const rest = L.text.slice(1).replace(/^ +/, '');
        if (!rest) {
          i++;
          out.push(i < lines.length && lines[i].indent > indent ? block(lines[i].indent) : null);
        } else if (isSeq(rest) || yamlSplitKey(rest, L.n)) {
          lines[i] = { n: L.n, indent: indent + (L.text.length - rest.length), text: rest };
          out.push(block(lines[i].indent));
        } else {
          out.push(yamlValue(rest, L.n)); i++;
        }
      }
      if (i < lines.length && lines[i].indent > indent) fail(`Line ${lines[i].n}: unexpected indentation`);
      return out;
    }
    function map(indent) {
      const out = {};
      while (i < lines.length && lines[i].indent === indent && !isSeq(lines[i].text)) {
        const L = lines[i];
        const kv = yamlSplitKey(L.text, L.n);
        if (!kv) fail(`Line ${L.n}: expected "key: value"`);
        const [key, rest] = kv;
        if (Object.prototype.hasOwnProperty.call(out, key)) fail(`Line ${L.n}: duplicate key "${key}"`);
        i++;
        if (rest) out[key] = yamlValue(rest, L.n);
        else if (i < lines.length && (lines[i].indent > indent || (lines[i].indent === indent && isSeq(lines[i].text)))) out[key] = block(lines[i].indent);
        else out[key] = null;
      }
      if (i < lines.length && lines[i].indent > indent) fail(`Line ${lines[i].n}: unexpected indentation`);
      return out;
    }

    let result;
    if (lines.length === 1 && !isSeq(lines[0].text) && !yamlSplitKey(lines[0].text, lines[0].n)) { result = yamlValue(lines[0].text, lines[0].n); i = 1; }
    else result = block(lines[0].indent);
    if (i < lines.length) fail(`Line ${lines[i].n}: this line does not fit the structure above it (check its indentation)`);
    return result;
  }

  function yamlStripComment(line, n) {
    let q = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i], prev = line[i - 1];
      if (q) {
        if (q === "'" && c === "'" && line[i + 1] === "'") { i++; continue; }
        if (q === '"' && c === '\\') { i++; continue; }
        if (c === q) q = null;
      } else if ((c === '"' || c === "'") && (prev === undefined || /[\s[{,:-]/.test(prev))) q = c;
      else if (c === '#' && (prev === undefined || /\s/.test(prev))) return line.slice(0, i);
    }
    if (q) fail(`Line ${n}: a quoted string is never closed`);
    return line;
  }

  // [key, rest] when the text is "key: rest" / "key:", else null.
  function yamlSplitKey(t, n) {
    if (t.startsWith('? ')) fail(`Line ${n}: complex keys ("? ") are not supported`);
    if (t[0] === '"' || t[0] === "'") {
      const end = yamlQuotedEnd(t, 0);
      if (end < 0) return null;
      const after = t.slice(end + 1);
      const m = after.match(/^\s*:(\s|$)/);
      if (!m) return null;
      return [yamlQuoted(t.slice(0, end + 1), n), after.slice(m[0].length).trim()];
    }
    if (/^[[{]/.test(t)) return null;
    const m = t.match(/:(\s|$)/);
    if (!m) return null;
    return [t.slice(0, m.index).trim(), t.slice(m.index + 1).trim()];
  }

  function yamlQuotedEnd(t, start) {
    const q = t[start];
    for (let i = start + 1; i < t.length; i++) {
      if (q === '"' && t[i] === '\\') { i++; continue; }
      if (t[i] === q) { if (q === "'" && t[i + 1] === "'") { i++; continue; } return i; }
    }
    return -1;
  }

  function yamlQuoted(t, n) {
    if (t[0] === "'") return t.slice(1, -1).replace(/''/g, "'");
    const ESC = { '"': '"', '\\': '\\', '/': '/', n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', 0: '\0', e: '\x1b', ' ': ' ' };
    return t.slice(1, -1).replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (_, e) => {
      if (e.length > 1) return String.fromCodePoint(parseInt(e.slice(1), 16));
      if (ESC[e] === undefined) fail(`Line ${n}: unknown escape "\\${e}" in a double-quoted string`);
      return ESC[e];
    });
  }

  function yamlValue(t, n) {
    if (t[0] === '"' || t[0] === "'") {
      const end = yamlQuotedEnd(t, 0);
      if (end < 0) fail(`Line ${n}: a quoted string is never closed`);
      if (end !== t.length - 1) fail(`Line ${n}: unexpected text after a quoted string`);
      return yamlQuoted(t, n);
    }
    if (t[0] === '[' || t[0] === '{') return yamlFlow(t, n);
    if (/^[|>]/.test(t)) fail(`Line ${n}: block scalars ("|" and ">") are not supported`);
    if (/^&/.test(t)) fail(`Line ${n}: anchors ("&") are not supported`);
    if (/^\*/.test(t)) fail(`Line ${n}: aliases ("*") are not supported`);
    if (/^!/.test(t)) fail(`Line ${n}: tags ("!") are not supported`);
    if (/^[@`]/.test(t)) fail(`Line ${n}: "${t[0]}" cannot start a plain value — quote it`);
    return yamlPlain(t, n);
  }

  // YAML 1.2 core schema.
  function yamlPlain(t, n) {
    if (/^(~|null|Null|NULL)$/.test(t)) return null;
    if (/^(true|True|TRUE)$/.test(t)) return true;
    if (/^(false|False|FALSE)$/.test(t)) return false;
    if (/^[-+]?[0-9]+$/.test(t)) return Number(t);
    if (/^0o[0-7]+$/.test(t)) return parseInt(t.slice(2), 8);
    if (/^0x[0-9a-fA-F]+$/.test(t)) return parseInt(t.slice(2), 16);
    if (/^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/.test(t)) return Number(t);
    if (/^[-+]?\.(inf|Inf|INF)$|^\.(nan|NaN|NAN)$/.test(t)) fail(`Line ${n}: "${t}" has no JSON equivalent`);
    return t;
  }

  function yamlFlow(t, n) {
    const close = t[0] === '[' ? ']' : '}';
    if (t[t.length - 1] !== close) fail(`Line ${n}: flow collection is not closed on the same line (multi-line flow is not supported)`);
    const body = t.slice(1, -1).trim();
    const items = [];
    let cur = '', q = null;
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (q) { cur += c; if (c === '\\' && q === '"') { cur += body[++i]; } else if (c === q) q = null; continue; }
      if ((c === '"' || c === "'") && !cur.trim()) { q = c; cur += c; continue; }
      if (c === '[' || c === '{') fail(`Line ${n}: nested flow collections are not supported — use block style`);
      if (c === ',') { items.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    if (q) fail(`Line ${n}: a quoted string is never closed`);
    if (cur.trim()) items.push(cur.trim());
    if (items.some(x => !x)) fail(`Line ${n}: empty entry in a flow collection`);
    if (close === ']') return items.map(x => yamlValue(x, n));
    const out = {};
    for (const it of items) {
      const kv = yamlSplitKey(it, n);
      if (!kv) fail(`Line ${n}: expected "key: value" inside {…}`);
      out[kv[0]] = kv[1] ? yamlValue(kv[1], n) : null;
    }
    return out;
  }

  // ---- XML (well-formed subset: elements, attributes, text, CDATA,
  // comments, processing instructions, a simple DOCTYPE) --------------------
  const XML_ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
  function xmlDecode(s, where) {
    return s.replace(/&([^;\s&]*);?/g, (m, e) => {
      if (!m.endsWith(';')) fail(`${where}: "&" must start an entity like &amp;`);
      if (XML_ENT[e]) return XML_ENT[e];
      const c = /^#x[0-9a-fA-F]+$/.test(e) ? parseInt(e.slice(2), 16) : /^#[0-9]+$/.test(e) ? parseInt(e.slice(1), 10) : -1;
      if (c < 0) fail(`${where}: unknown entity &${e};`);
      if (c > 0x10ffff) fail(`${where}: character reference &${e}; is out of range`);
      return String.fromCodePoint(c);
    });
  }

  function parseXml(src) {
    let i = 0;
    const lineAt = (p) => src.slice(0, p).split('\n').length;
    const err = (msg, p = i) => fail(`Line ${lineAt(p)}: ${msg}`);
    const NAME = /[A-Za-z_:][\w.:-]*/y;
    const readName = () => { NAME.lastIndex = i; const m = NAME.exec(src); if (!m) err('expected a tag or attribute name'); i += m[0].length; return m[0]; };
    const ws = () => { while (/\s/.test(src[i] || '')) i++; };

    function misc(allowDoctype) {
      for (;;) {
        ws();
        if (src.startsWith('<!--', i)) { const e = src.indexOf('-->', i + 4); if (e < 0) err('comment is never closed'); i = e + 3; }
        else if (src.startsWith('<?', i)) { const e = src.indexOf('?>', i + 2); if (e < 0) err('processing instruction is never closed'); i = e + 2; }
        else if (allowDoctype && src.startsWith('<!DOCTYPE', i)) {
          const e = src.indexOf('>', i);
          if (e < 0) err('DOCTYPE is never closed');
          if (src.slice(i, e).includes('[')) err('DOCTYPE with an internal subset is not supported');
          i = e + 1;
        } else return;
      }
    }

    function element() {
      if (src[i] !== '<') err('expected an element');
      const start = i;
      i++;
      const name = readName();
      const attrs = {};
      for (;;) {
        const hadWs = /\s/.test(src[i] || '');
        ws();
        if (src.startsWith('/>', i)) { i += 2; return { name, attrs, kids: [] }; }
        if (src[i] === '>') { i++; break; }
        if (i >= src.length) err(`<${name}> is never closed`, start);
        if (!hadWs) err(`expected a space before attribute in <${name}>`);
        const an = readName();
        ws();
        if (src[i] !== '=') err(`attribute "${an}" needs a value`);
        i++; ws();
        const q = src[i];
        if (q !== '"' && q !== "'") err(`attribute "${an}" value must be quoted`);
        const e = src.indexOf(q, i + 1);
        if (e < 0) err(`attribute "${an}" value is never closed`);
        const raw = src.slice(i + 1, e);
        if (raw.includes('<')) err(`"<" is not allowed in attribute "${an}"`);
        if (Object.prototype.hasOwnProperty.call(attrs, an)) err(`duplicate attribute "${an}"`);
        attrs[an] = xmlDecode(raw, `Line ${lineAt(i)}`);
        i = e + 1;
      }
      const kids = [];
      for (;;) {
        if (i >= src.length) err(`<${name}> is never closed`, start);
        if (src.startsWith('</', i)) {
          i += 2;
          const close = readName();
          if (close !== name) err(`expected </${name}> but found </${close}>`);
          ws();
          if (src[i] !== '>') err(`</${close}> is not closed with ">"`);
          i++;
          return { name, attrs, kids };
        }
        if (src.startsWith('<!--', i)) { const e = src.indexOf('-->', i + 4); if (e < 0) err('comment is never closed'); i = e + 3; continue; }
        if (src.startsWith('<![CDATA[', i)) { const e = src.indexOf(']]>', i); if (e < 0) err('CDATA section is never closed'); kids.push(src.slice(i + 9, e)); i = e + 3; continue; }
        if (src.startsWith('<?', i)) { const e = src.indexOf('?>', i + 2); if (e < 0) err('processing instruction is never closed'); i = e + 2; continue; }
        if (src[i] === '<') { kids.push(element()); continue; }
        const e = src.indexOf('<', i);
        const end = e < 0 ? src.length : e;
        kids.push(xmlDecode(src.slice(i, end), `Line ${lineAt(i)}`));
        i = end;
      }
    }

    need(src, 'some XML');
    misc(true);
    if (i >= src.length) fail('The XML has no root element');
    const root = element();
    misc(false);
    if (i < src.length) err('only one root element is allowed and nothing may follow it');
    return root;
  }

  // Element → JSON: attributes as "@name", text as "#text" (or a bare string
  // when that is all there is), repeated children as arrays.
  function xmlToJson(el) {
    const out = {};
    for (const [k, v] of Object.entries(el.attrs)) out['@' + k] = v;
    let text = '';
    for (const k of el.kids) {
      if (typeof k === 'string') { text += k; continue; }
      const v = xmlToJson(k);
      if (!Object.prototype.hasOwnProperty.call(out, k.name)) out[k.name] = v;
      else if (Array.isArray(out[k.name])) out[k.name].push(v); // xmlToJson never returns arrays itself
      else out[k.name] = [out[k.name], v];
    }
    text = text.trim();
    if (!Object.keys(out).length) return text;
    if (text) out['#text'] = text;
    return out;
  }

  function xmlEsc(s, attr) {
    const t = String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return attr ? t.replace(/"/g, '&quot;') : t;
  }

  function jsonToXml(name, v, ind) {
    const pad = '  '.repeat(ind);
    if (!/^[A-Za-z_][\w.-]*$/.test(name)) fail(`"${name}" is not a valid XML element name`);
    if (Array.isArray(v)) return v.map(x => jsonToXml(name, x, ind)).join('\n');
    if (!isObj(v)) return v === null || v === '' ? `${pad}<${name}/>` : `${pad}<${name}>${xmlEsc(v)}</${name}>`;
    let attrs = '', text = '';
    const kids = [];
    for (const [k, x] of Object.entries(v)) {
      if (k[0] === '@') {
        if (x !== null && typeof x === 'object') fail(`Attribute "${k}" must be a plain value`);
        if (!/^[A-Za-z_][\w.:-]*$/.test(k.slice(1))) fail(`"${k.slice(1)}" is not a valid attribute name`);
        attrs += ` ${k.slice(1)}="${xmlEsc(x, true)}"`;
      } else if (k === '#text') text = xmlEsc(x);
      else kids.push(jsonToXml(k, x, ind + 1));
    }
    if (!kids.length) return text ? `${pad}<${name}${attrs}>${text}</${name}>` : `${pad}<${name}${attrs}/>`;
    return `${pad}<${name}${attrs}>${text ? '\n' + '  '.repeat(ind + 1) + text : ''}\n${kids.join('\n')}\n${pad}</${name}>`;
  }

  // ---- numbers: 123, -5, 0xFF, 0b1010, 0o17 as BigInt ----------------------
  function parseBig(s, label) {
    let t = String(s).trim().replace(/[_\s]/g, '');
    if (!t) fail(`Enter ${label}`);
    let neg = false;
    if (t[0] === '-' || t[0] === '+') { neg = t[0] === '-'; t = t.slice(1); }
    if (!/^(0x[0-9a-f]+|0b[01]+|0o[0-7]+|\d+)$/i.test(t)) fail(`${label[0].toUpperCase() + label.slice(1)} is not a number (use 123, 0xFF, 0b1010 or 0o17)`);
    const v = BigInt(t);
    return neg ? -v : v;
  }
  const group4 = (s) => s.replace(/\B(?=(.{4})+$)/g, ' ');

  // ---- IPv4 -----------------------------------------------------------------
  function ipv4(s) {
    const t = s.trim();
    const p = t.split('.');
    if (p.length !== 4 || p.some(x => !/^\d{1,3}$/.test(x))) fail(`"${t}" is not an IPv4 address (four numbers 0-255 separated by dots)`);
    if (p.some(x => x.length > 1 && x[0] === '0')) fail('Leading zeros in an IPv4 address are ambiguous (some tools read them as octal)');
    const n = p.map(Number);
    if (n.some(x => x > 255)) fail('Each part of an IPv4 address must be 0-255');
    return n[0] * 16777216 + n[1] * 65536 + n[2] * 256 + n[3];
  }
  const ipStr = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  const IPV4_RANGES = [
    ['0.0.0.0', 8, 'This network'], ['10.0.0.0', 8, 'Private (RFC 1918)'], ['100.64.0.0', 10, 'Shared / carrier-grade NAT'],
    ['127.0.0.0', 8, 'Loopback'], ['169.254.0.0', 16, 'Link-local'], ['172.16.0.0', 12, 'Private (RFC 1918)'],
    ['192.0.2.0', 24, 'Documentation'], ['192.168.0.0', 16, 'Private (RFC 1918)'], ['198.18.0.0', 15, 'Benchmarking'],
    ['198.51.100.0', 24, 'Documentation'], ['203.0.113.0', 24, 'Documentation'], ['224.0.0.0', 4, 'Multicast'],
    ['255.255.255.255', 32, 'Broadcast'], ['240.0.0.0', 4, 'Reserved'],
  ];
  const maskOf = (p) => (p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0);
  function ipv4Kind(n) {
    for (const [base, p, label] of IPV4_RANGES) if (((n & maskOf(p)) >>> 0) === ipv4(base)) return label;
    return 'Public';
  }

  // ---- colour ---------------------------------------------------------------
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
  }
  function rgbToHsl({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    return { h: hueOf(r, g, b, max, d), s: s * 100, l: l * 100 };
  }
  function rgbToHsv({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
    return { h: hueOf(r, g, b, max, d), s: max === 0 ? 0 : (d / max) * 100, v: max * 100 };
  }
  function hueOf(r, g, b, max, d) {
    if (d === 0) return 0;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  }
  const clamp255 = (x) => Math.min(255, Math.max(0, Math.round(x)));
  const toHex = ({ r, g, b }) => '#' + [r, g, b].map(x => clamp255(x).toString(16).padStart(2, '0')).join('');

  function parseColor(s) {
    const t = s.trim().toLowerCase();
    let m;
    if ((m = t.match(/^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/))) {
      let h = m[1];
      if (h.length <= 4) h = [...h].map(c => c + c).join('');
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
    }
    const alpha = (x) => (x === undefined ? 1 : x.endsWith('%') ? parseFloat(x) / 100 : parseFloat(x));
    if ((m = t.match(/^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/))) {
      const [r, g, b] = [m[1], m[2], m[3]].map(Number);
      if ([r, g, b].some(x => !(x <= 255))) fail('rgb() values must be 0-255');
      return { r, g, b, a: alpha(m[4]) };
    }
    if ((m = t.match(/^hsla?\(\s*(-?[\d.]+)(?:deg)?\s*[,\s]\s*([\d.]+)%\s*[,\s]\s*([\d.]+)%\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/))) {
      const [h, sat, l] = [m[1], m[2], m[3]].map(Number);
      if (sat > 100 || l > 100) fail('hsl() saturation and lightness must be 0-100%');
      return { ...hslToRgb(h, sat, l), a: alpha(m[4]) };
    }
    fail(`"${s.trim()}" is not a colour — use #hex, rgb(…) or hsl(…)`);
  }
  const hslText = (c) => { const h = rgbToHsl(c); return `hsl(${Math.round(h.h) % 360}, ${Math.round(h.s)}%, ${Math.round(h.l)}%)`; };

  // ---- developer helpers ----------------------------------------------------
  const pascal = (s) => (String(s).match(/[A-Za-z0-9]+/g) || ['Item']).map(w => w[0].toUpperCase() + w.slice(1)).join('').replace(/^(\d)/, '_$1');
  const singular = (s) => (s.length > 1 && /[^s]s$/.test(s) ? s.slice(0, -1) : s + 'Item');
  const tsProp = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));

  function jsonToTs(value, rootName) {
    const blocks = [], used = new Set();
    function unionOf(values, name) {
      const types = new Set();
      const objs = values.filter(isObj);
      if (objs.length) types.add(iface(objs, name));
      for (const x of values) if (!isObj(x)) types.add(tsType(x, name));
      return [...types].join(' | ');
    }
    function tsType(v, name) {
      if (v === null) return 'null';
      if (Array.isArray(v)) {
        if (!v.length) return 'unknown[]';
        const u = unionOf(v, singular(name));
        return u.includes(' | ') ? `(${u})[]` : `${u}[]`;
      }
      return typeof v;
    }
    function iface(objs, name) {
      let n = name, k = 2;
      while (used.has(n)) n = name + k++;
      used.add(n);
      const block = { name: n, lines: [] };
      blocks.push(block);
      const keys = [];
      for (const o of objs) for (const key of Object.keys(o)) if (!keys.includes(key)) keys.push(key);
      for (const key of keys) {
        const vals = objs.filter(o => Object.prototype.hasOwnProperty.call(o, key)).map(o => o[key]);
        block.lines.push(`  ${tsProp(key)}${vals.length < objs.length ? '?' : ''}: ${unionOf(vals, pascal(key))};`);
      }
      return n;
    }
    let head = '';
    if (Array.isArray(value)) head = `type ${rootName} = ${tsType(value, rootName)};`;
    else if (isObj(value)) iface([value], rootName);
    else fail('Paste a JSON object or array');
    return [head, ...blocks.map(b => `interface ${b.name} {\n${b.lines.join('\n')}\n}`)].filter(Boolean).join('\n\n');
  }

  function parseJsonPath(p) {
    let s = p.trim();
    if (s[0] === '$') s = s.slice(1);
    const segs = [];
    for (let i = 0; i < s.length;) {
      if (s[i] === '[') {
        const m = s.slice(i).match(/^\[\s*(\*|-?\d+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*\]/);
        if (!m) fail(`Unreadable [...] at position ${i + 1} — use [0], [*] or ["key"]`);
        const t = m[1];
        segs.push(t === '*' ? '*' : /^-?\d/.test(t) ? Number(t) : t[0] === '"' ? JSON.parse(t) : t.slice(1, -1).replace(/\\(.)/g, '$1'));
        i += m[0].length;
        continue;
      }
      if (s[i] === '.') {
        if (s[i + 1] === '.') fail('Recursive descent (..) is not supported');
        i++;
      } else if (i > 0) fail(`Expected "." or "[" at position ${i + 1}`);
      const m = s.slice(i).match(/^[^.[\]]+/);
      if (!m) fail(`Expected a key name at position ${i + 1}`);
      segs.push(m[0].trim() === '*' ? '*' : m[0].trim());
      i += m[0].length;
    }
    return segs;
  }

  const pathKey = (base, k) => typeof k === 'number' ? `${base}[${k}]` : /^[A-Za-z_$][\w$]*$/.test(k) ? (base ? `${base}.${k}` : k) : `${base}[${JSON.stringify(k)}]`;
  function jsonDiff(a, b, path, out) {
    const kind = (x) => (Array.isArray(x) ? 'array' : x === null ? 'null' : typeof x);
    const show = (x) => JSON.stringify(x);
    const label = path || '(root)';
    if (kind(a) !== kind(b) || (kind(a) !== 'array' && kind(a) !== 'object')) {
      if (show(a) !== show(b)) out.push(`~ ${label}: ${show(a)} → ${show(b)}`);
      return out;
    }
    if (Array.isArray(a)) {
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const p = pathKey(path, i);
        if (i >= b.length) out.push(`- ${p}: ${show(a[i])}`);
        else if (i >= a.length) out.push(`+ ${p}: ${show(b[i])}`);
        else jsonDiff(a[i], b[i], p, out);
      }
      return out;
    }
    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    for (const k of Object.keys(a)) {
      if (!has(b, k)) out.push(`- ${pathKey(path, k)}: ${show(a[k])}`);
      else jsonDiff(a[k], b[k], pathKey(path, k), out);
    }
    for (const k of Object.keys(b)) if (!has(a, k)) out.push(`+ ${pathKey(path, k)}: ${show(b[k])}`);
    return out;
  }

  function quotedEnd(s, i) {
    const q = s[i];
    for (let j = i + 1; j < s.length; j++) {
      if (s[j] === '\\') { j++; continue; }
      if (s[j] === q) return j;
    }
    fail('A quoted string is never closed');
  }

  function cssMinify(css) {
    let out = '', pending = false;
    const dropAfter = '{};,:>(', dropBefore = '{};,>)';
    for (let i = 0; i < css.length;) {
      const c = css[i];
      if (css.startsWith('/*', i)) {
        const e = css.indexOf('*/', i + 2);
        if (e < 0) fail('A /* comment is never closed');
        i = e + 2; pending = true; continue;
      }
      if (/\s/.test(c)) { pending = true; i++; continue; }
      if (pending && out && !dropAfter.includes(out[out.length - 1]) && !dropBefore.includes(c)) out += ' ';
      pending = false;
      if (c === '"' || c === "'") { const e = quotedEnd(css, i); out += css.slice(i, e + 1); i = e + 1; continue; }
      if (c === '}' && out[out.length - 1] === ';') out = out.slice(0, -1);
      out += c; i++;
    }
    return out;
  }

  function cssBeautify(css) {
    const min = cssMinify(css);
    const lines = [];
    let buf = '', depth = 0, paren = 0;
    const pad = () => '  '.repeat(depth);
    const splitTop = (s, sep) => { const parts = []; let cur = '', p = 0; for (const ch of s) { if (ch === '(') p++; if (ch === ')') p--; if (ch === sep && !p) { parts.push(cur); cur = ''; } else cur += ch; } parts.push(cur); return parts; };
    const decl = (s) => { const t = s.trim(); const k = t.indexOf(':'); return depth === 0 || t[0] === '@' || k < 0 ? t : `${t.slice(0, k).trim()}: ${t.slice(k + 1).trim()}`; };
    for (let i = 0; i < min.length; i++) {
      const c = min[i];
      if (c === '"' || c === "'") { const e = quotedEnd(min, i); buf += min.slice(i, e + 1); i = e; continue; }
      if (c === '(') paren++;
      if (c === ')') paren--;
      if (paren > 0 || c === ')') { buf += c; continue; }
      if (c === '{') { lines.push(pad() + (buf.trim()[0] === '@' ? buf.trim() : splitTop(buf.trim(), ',').join(', ')) + ' {'); buf = ''; depth++; continue; }
      if (c === ';') { if (buf.trim()) lines.push(pad() + decl(buf) + ';'); buf = ''; continue; }
      if (c === '}') {
        if (depth === 0) fail('There is a "}" without a matching "{"');
        if (buf.trim()) lines.push(pad() + decl(buf) + ';');
        buf = ''; depth--;
        lines.push(pad() + '}');
        if (depth === 0) lines.push('');
        continue;
      }
      buf += c;
    }
    if (depth > 0) fail('A "{" block is never closed');
    if (buf.trim()) lines.push(buf.trim());
    return lines.join('\n').trim();
  }

  // ---- HTML (basic, whitespace-safe) -----------------------------------------
  const HTML_TAG = /<\/?([a-zA-Z][\w:-]*)(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/y;
  const HTML_RAW = /^(script|style|pre|textarea)$/;
  const HTML_VOID = new Set('area base br col embed hr img input link meta source track wbr'.split(' '));
  const HTML_INLINE = new Set('a abbr b bdi bdo br button cite code data dfn em i img input kbd label mark q s samp select option small span strong sub sup time u var wbr'.split(' '));

  function htmlTokens(html) {
    const toks = [];
    for (let i = 0; i < html.length;) {
      if (html.startsWith('<!--', i)) {
        const e = html.indexOf('-->', i + 4);
        if (e < 0) fail('An HTML comment is never closed (missing -->)');
        toks.push({ t: 'comment', s: html.slice(i, e + 3) }); i = e + 3; continue;
      }
      if (html[i] === '<') {
        HTML_TAG.lastIndex = i;
        const m = HTML_TAG.exec(html);
        if (m) {
          const name = m[1].toLowerCase(), close = m[0][1] === '/', self = /\/>$/.test(m[0]);
          toks.push({ t: close ? 'close' : 'open', name, s: m[0], self });
          i += m[0].length;
          if (!close && !self && HTML_RAW.test(name)) {
            const e = html.slice(i).search(new RegExp(`</${name}\\s*>`, 'i'));
            if (e < 0) fail(`<${name}> is never closed`);
            toks.push({ t: 'raw', s: html.slice(i, i + e) }); i += e;
          }
          continue;
        }
        if (html.startsWith('<!', i)) {
          const e = html.indexOf('>', i);
          if (e < 0) fail('A <!…> declaration is never closed');
          toks.push({ t: 'decl', s: html.slice(i, e + 1) }); i = e + 1; continue;
        }
      }
      let e = html.indexOf('<', i + 1);
      if (e < 0) e = html.length;
      const last = toks[toks.length - 1];
      if (last && last.t === 'text') last.s += html.slice(i, e); else toks.push({ t: 'text', s: html.slice(i, e) });
      i = e;
    }
    return toks;
  }

  // Collapse whitespace inside a tag, but not inside quoted attribute values.
  function tidyTag(s) {
    let out = '', q = null;
    for (const c of s) {
      if (q) { out += c; if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; out += c; continue; }
      if (/\s/.test(c)) { if (!out.endsWith(' ')) out += ' '; continue; }
      out += c;
    }
    return out.replace(/ (\/?>)$/, '$1');
  }

  const isBlockTok = (t) => t && (t.t === 'decl' || ((t.t === 'open' || t.t === 'close') && !HTML_INLINE.has(t.name)));

  function htmlMinify(html) {
    const toks = [];
    for (const t of htmlTokens(html)) {
      if (t.t === 'comment' && !/^<!--\[if/i.test(t.s)) continue;
      const last = toks[toks.length - 1];
      if (t.t === 'text' && last && last.t === 'text') last.s += t.s; else toks.push({ ...t });
    }
    return toks.map((t, i) => {
      if (t.t === 'raw' || t.t === 'comment') return t.s;
      if (t.t !== 'text') return tidyTag(t.s);
      let s = t.s.replace(/\s+/g, ' ');
      if (isBlockTok(toks[i - 1]) || i === 0) s = s.replace(/^ /, '');
      if (isBlockTok(toks[i + 1]) || i === toks.length - 1) s = s.replace(/ $/, '');
      return s;
    }).join('');
  }

  function htmlBeautify(html) {
    const toks = htmlTokens(html);
    const lines = [];
    let depth = 0, line = '';
    const pad = () => '  '.repeat(depth);
    const flush = () => { const t = line.replace(/\s+/g, ' ').trim(); if (t) lines.push(pad() + t); line = ''; };
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.t === 'text') { line += t.s; continue; }
      if ((t.t === 'open' || t.t === 'close') && HTML_INLINE.has(t.name)) { line += tidyTag(t.s); continue; }
      flush();
      if (t.t === 'comment' || t.t === 'decl') { lines.push(pad() + t.s.trim()); continue; }
      if (t.t === 'close') { depth = Math.max(0, depth - 1); lines.push(pad() + tidyTag(t.s)); continue; }
      const tag = tidyTag(t.s);
      if (toks[i + 1] && toks[i + 1].t === 'raw') {
        const raw = toks[i + 1].s, close = toks[i + 2] ? tidyTag(toks[i + 2].s) : `</${t.name}>`;
        i += 2;
        if (t.name === 'pre' || t.name === 'textarea' || !raw.trim()) { lines.push(pad() + tag + raw + close); continue; }
        const body = raw.replace(/^\s*\n|\s+$/g, '').split(/\r?\n/);
        const common = Math.min(...body.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length));
        lines.push(pad() + tag);
        for (const l of body) lines.push(l.trim() ? pad() + '  ' + l.slice(common) : '');
        lines.push(pad() + close);
        continue;
      }
      lines.push(pad() + tag);
      if (!t.self && !HTML_VOID.has(t.name)) depth++;
    }
    flush();
    return lines.join('\n');
  }

  // ---- SQL --------------------------------------------------------------------
  const SQL_KW = new Set(('SELECT FROM WHERE AND OR NOT IN IS NULL AS ON JOIN LEFT RIGHT INNER OUTER FULL CROSS NATURAL GROUP BY ORDER ' +
    'HAVING LIMIT OFFSET UNION ALL DISTINCT INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE VIEW ALTER DROP ADD COLUMN INDEX ' +
    'PRIMARY KEY FOREIGN REFERENCES DEFAULT UNIQUE CHECK CONSTRAINT CASE WHEN THEN ELSE END ASC DESC LIKE ILIKE BETWEEN EXISTS ' +
    'WITH RETURNING TRUE FALSE COUNT SUM AVG MIN MAX COALESCE CAST OVER PARTITION FETCH NEXT ROWS ONLY EXCEPT INTERSECT USING IF').split(' '));
  const SQL_FUNCS = new Set('COUNT SUM AVG MIN MAX COALESCE CAST'.split(' '));
  const SQL_CLAUSES = ['LEFT OUTER JOIN', 'RIGHT OUTER JOIN', 'FULL OUTER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'INNER JOIN',
    'CROSS JOIN', 'GROUP BY', 'ORDER BY', 'UNION ALL', 'INSERT INTO', 'DELETE FROM', 'SELECT', 'FROM', 'WHERE', 'HAVING', 'LIMIT',
    'OFFSET', 'UNION', 'EXCEPT', 'INTERSECT', 'VALUES', 'UPDATE', 'SET', 'RETURNING', 'WITH', 'JOIN'].map(c => c.split(' '));
  const SQL_TOKEN = /\s+|--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|\d+(?:\.\d+)?|[@:$]?[A-Za-z_][\w$]*|<>|<=|>=|!=|::|\|\||[\s\S]/y;

  function sqlFormat(sql) {
    const toks = [];
    for (let i = 0; i < sql.length;) {
      SQL_TOKEN.lastIndex = i;
      const s = SQL_TOKEN.exec(sql)[0];
      i += s.length;
      if (/^\s/.test(s)) continue;
      if (s === "'" || s === '"' || s === '`') fail('A quoted string is never closed'); // the full-string patterns did not match
      if (s === '/' && sql[i] === '*') fail('A /* comment is never closed');
      toks.push({ s, word: /^[A-Za-z_]/.test(s) });
    }
    let out = '', depth = 0, fresh = true, between = false;
    const nl = (extra = 0) => { out = out.replace(/ +$/, '') + '\n' + '  '.repeat(depth) + ' '.repeat(extra); fresh = true; };
    const emit = (s) => {
      const prev = out[out.length - 1];
      if (!fresh && !/^[,.;)]/.test(s) && prev !== '(' && prev !== '.') out += ' ';
      out += s; fresh = false;
    };
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      const up = t.word ? t.s.toUpperCase() : t.s;
      const clause = t.word && SQL_CLAUSES.find(c => c.every((w, k) => toks[i + k] && toks[i + k].word && toks[i + k].s.toUpperCase() === w));
      if (clause) { if (!fresh) nl(); emit(clause.join(' ')); i += clause.length - 1; continue; }
      if (up === 'BETWEEN') between = true;
      if ((up === 'AND' || up === 'OR') && !(up === 'AND' && between)) { nl(2); emit(up); continue; }
      if (up === 'AND') between = false;
      if (t.s.startsWith('--')) { emit(t.s); nl(); continue; }
      if (t.s === '(') {
        const prev = toks[i - 1];
        const call = prev && prev.word && (!SQL_KW.has(prev.s.toUpperCase()) || SQL_FUNCS.has(prev.s.toUpperCase()));
        if (call) out += '('; else emit('(');
        fresh = false; depth++;
        continue;
      }
      if (t.s === ')') { depth = Math.max(0, depth - 1); emit(')'); continue; }
      if (t.s === ';') { emit(';'); out += '\n\n'; fresh = true; continue; }
      emit(t.word && SQL_KW.has(up) ? up : t.s);
    }
    return out.trim();
  }

  const DEV = [
    {
      id: 'dev-json-yaml', name: 'JSON → YAML', icon: 'Y', family: 'dev',
      desc: 'Convert JSON into clean block-style YAML', keywords: 'yaml convert config',
      fields: [{ id: 'json', label: 'JSON', type: 'textarea', value: '{"name":"Vex","tags":["fast","private"]}' }],
      run: (v) => toYaml(parseJson(v.json)),
      examples: [
        { in: { json: '{"name":"Vex","version":2,"tags":["fast","private"],"owner":{"id":1,"active":true},"note":null}' },
          out: 'name: Vex\nversion: 2\ntags:\n  - fast\n  - private\nowner:\n  id: 1\n  active: true\nnote: null' },
        { in: { json: '{"a":"yes","b":"1.0","c":"x: y","d":[],"e":"line\\nbreak"}' }, out: 'a: "yes"\nb: "1.0"\nc: "x: y"\nd: []\ne: "line\\nbreak"' },
        { in: { json: '[{"a":1,"b":2},{"a":3}]' }, out: '- a: 1\n  b: 2\n- a: 3' },
      ],
    },
    {
      id: 'dev-yaml-json', name: 'YAML → JSON', icon: '{Y}', family: 'dev',
      desc: 'Convert common YAML (maps, lists, scalars, quotes, comments) to JSON', keywords: 'yaml parse config',
      fields: [{ id: 'yaml', label: 'YAML', type: 'textarea', value: 'name: Vex\ntags:\n  - fast\n  - private' }],
      run: (v) => JSON.stringify(parseYaml(need(v.yaml, 'some YAML')), null, 2),
      examples: [
        { in: { yaml: '# app config\nname: Vex\nversion: 2\ntags: [fast, "private"]\nowner:\n  id: 0x1F\n  active: true\nnote: ~\nlist:\n- a: 1\n  b: \'it\'\'s\'\n- 2.5' },
          out: '{\n  "name": "Vex",\n  "version": 2,\n  "tags": [\n    "fast",\n    "private"\n  ],\n  "owner": {\n    "id": 31,\n    "active": true\n  },\n  "note": null,\n  "list": [\n    {\n      "a": 1,\n      "b": "it\'s"\n    },\n    2.5\n  ]\n}' },
        { in: { yaml: '---\nservers:\n  - host: "a.example"\n    ports:\n      - 80\n      - 443\n  -\n    host: b # trailing comment\nempty: {}\n' },
          out: '{\n  "servers": [\n    {\n      "host": "a.example",\n      "ports": [\n        80,\n        443\n      ]\n    },\n    {\n      "host": "b"\n    }\n  ],\n  "empty": {}\n}' },
      ],
    },
    {
      id: 'dev-json-ts', name: 'JSON → TypeScript', icon: 'TS', family: 'dev',
      desc: 'Generate TypeScript interfaces from a JSON sample', keywords: 'types interface typescript',
      fields: [
        { id: 'json', label: 'JSON sample', type: 'textarea', value: '{"id":1,"name":"Ann"}' },
        { id: 'root', label: 'Root type name', type: 'text', value: 'Root' },
      ],
      run: (v) => jsonToTs(parseJson(v.json), pascal(v.root || 'Root')),
      examples: [
        { in: { json: '{"id":1,"name":"Ann","tags":["a"],"address":{"city":"Oslo"},"pets":[{"name":"Rex","age":3},{"name":"Tom"}],"x":null}', root: 'User' },
          out: 'interface User {\n  id: number;\n  name: string;\n  tags: string[];\n  address: Address;\n  pets: Pet[];\n  x: null;\n}\n\ninterface Address {\n  city: string;\n}\n\ninterface Pet {\n  name: string;\n  age?: number;\n}' },
        { in: { json: '[1,"a",{"ok":true}]', root: 'Mixed' }, out: 'type Mixed = (MixedItem | number | string)[];\n\ninterface MixedItem {\n  ok: boolean;\n}' },
      ],
    },
    {
      id: 'dev-json-path', name: 'JSON Path Query', icon: '$.', family: 'dev',
      desc: 'Pick values out of JSON with a path like store.book[0].title or items[*].id', keywords: 'jsonpath query select',
      fields: [
        { id: 'json', label: 'JSON', type: 'textarea', value: '{"store":{"book":[{"title":"A","price":8},{"title":"B","price":12}]}}' },
        { id: 'path', label: 'Path', type: 'text', value: 'store.book[*].title' },
      ],
      run: (v) => {
        const segs = parseJsonPath(v.path);
        let vals = [parseJson(v.json)], wild = false, at = '$';
        for (const seg of segs) {
          const next = [];
          for (const x of vals) {
            if (seg === '*') {
              wild = true;
              if (x === null || typeof x !== 'object') fail(`${at} is not an array or object, so [*] has nothing to expand`);
              next.push(...(Array.isArray(x) ? x : Object.values(x)));
            } else if (typeof seg === 'number') {
              if (!Array.isArray(x)) fail(`${at} is not an array, so [${seg}] does not apply`);
              const idx = seg < 0 ? x.length + seg : seg;
              if (idx < 0 || idx >= x.length) fail(`${at} has ${x.length} item(s); [${seg}] is out of range`);
              next.push(x[idx]);
            } else {
              if (x === null || typeof x !== 'object' || !Object.prototype.hasOwnProperty.call(x, seg)) fail(`No "${seg}" at ${at}`);
              next.push(x[seg]);
            }
          }
          at = seg === '*' ? `${at}[*]` : pathKey(at, seg);
          vals = next;
        }
        return JSON.stringify(wild ? vals : vals[0], null, 2);
      },
      examples: [
        { in: {}, out: '[\n  "A",\n  "B"\n]' },
        { in: { path: '$.store.book[-1]' }, out: '{\n  "title": "B",\n  "price": 12\n}' },
        { in: { json: '{"a b":{"c":[10,20]}}', path: '["a b"].c[1]' }, out: '20' },
      ],
    },
    {
      id: 'dev-json-diff', name: 'JSON Diff', icon: '±', family: 'dev',
      desc: 'List keys added (+), removed (−) and changed (~) between two JSON documents', keywords: 'compare difference',
      fields: [
        { id: 'a', label: 'Original JSON', type: 'textarea', value: '{"name":"Vex","v":1}' },
        { id: 'b', label: 'New JSON', type: 'textarea', value: '{"name":"Vex","v":2,"beta":true}' },
      ],
      run: (v) => {
        const lines = jsonDiff(parseJson(v.a, 'the original JSON'), parseJson(v.b, 'the new JSON'), '', []);
        return lines.length ? lines.join('\n') : 'No differences';
      },
      examples: [
        { in: { a: '{"name":"Vex","v":1,"tags":["a","b"],"old":true}', b: '{"name":"Vex","v":2,"tags":["a","c","d"],"new":null}' },
          out: '~ v: 1 → 2\n~ tags[1]: "b" → "c"\n+ tags[2]: "d"\n- old: true\n+ new: null' },
        { in: { a: '{"x":[1,2]}', b: '{ "x" : [1, 2] }' }, out: 'No differences' },
      ],
    },
    {
      id: 'dev-json-escape', name: 'JSON String Escape', icon: '\\"', family: 'dev',
      desc: 'Escape text for a JSON/JS string literal, or unescape one', keywords: 'escape unescape string literal quote',
      fields: [
        { id: 'mode', label: 'Mode', type: 'select', options: [['escape', 'Escape'], ['unescape', 'Unescape']] },
        { id: 'text', label: 'Text', type: 'textarea', value: 'He said "hi"' },
      ],
      run: (v) => {
        if (v.mode === 'escape') return JSON.stringify(v.text).slice(1, -1);
        let t = v.text;
        if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') t = t.slice(1, -1);
        t = t.replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
        try { return JSON.parse(`"${t}"`); } catch (e) { fail('Not a valid escaped string — check for a stray " or \\ (' + e.message + ')'); }
      },
      examples: [
        { in: { mode: 'escape', text: 'He said "hi"\nC:\\temp\t✓' }, out: 'He said \\"hi\\"\\nC:\\\\temp\\t✓' },
        { in: { mode: 'unescape', text: '"Tab\\there \\"q\\" \\u00e9"' }, out: 'Tab\there "q" é' },
      ],
    },
    {
      id: 'dev-css-format', name: 'CSS Minify / Beautify', icon: '#{}', family: 'dev',
      desc: 'Minify CSS or re-indent it one declaration per line', keywords: 'css compress pretty format',
      fields: [
        { id: 'mode', label: 'Mode', type: 'select', options: [['minify', 'Minify'], ['beautify', 'Beautify']] },
        { id: 'css', label: 'CSS', type: 'textarea', value: 'a { color: red; }' },
      ],
      run: (v) => (v.mode === 'minify' ? cssMinify : cssBeautify)(need(v.css, 'some CSS')),
      examples: [
        { in: { mode: 'minify', css: 'a { color: red ; }  /* note */\n.b, .c { margin: 0 auto; content: "a  ;  b"; width: calc(100% - 10px) }' },
          out: 'a{color:red}.b,.c{margin:0 auto;content:"a  ;  b";width:calc(100% - 10px)}' },
        { in: { mode: 'beautify', css: 'a{color:red}.b,.c{margin:0 auto}@media (max-width:600px){a{background:url(data:x;y)}}' },
          out: 'a {\n  color: red;\n}\n\n.b, .c {\n  margin: 0 auto;\n}\n\n@media (max-width:600px) {\n  a {\n    background: url(data:x;y);\n  }\n}' },
      ],
    },
    {
      id: 'dev-html-format', name: 'HTML Minify / Beautify', icon: '</>', family: 'dev',
      desc: 'Safely minify HTML (keeps meaningful spaces, pre/script untouched) or indent it', keywords: 'html compress pretty format',
      fields: [
        { id: 'mode', label: 'Mode', type: 'select', options: [['minify', 'Minify'], ['beautify', 'Beautify']] },
        { id: 'html', label: 'HTML', type: 'textarea', value: '<div>\n  <p>Hello   <b>world</b></p>\n</div>' },
      ],
      run: (v) => (v.mode === 'minify' ? htmlMinify : htmlBeautify)(need(v.html, 'some HTML')),
      examples: [
        { in: { mode: 'minify', html: '<!DOCTYPE html>\n<html>\n  <body>\n    <!-- nav -->\n    <p class="a   b">Hello   <b>world</b> !</p>\n    <pre>  keep\n   me </pre>\n  </body>\n</html>' },
          out: '<!DOCTYPE html><html><body><p class="a   b">Hello <b>world</b> !</p><pre>  keep\n   me </pre></body></html>' },
        { in: { mode: 'beautify', html: '<div><p>Hi <b>there</b></p><img src="a.png"><hr><script>\n    let a = 1;\n      if (a) go();\n</script></div>' },
          out: '<div>\n  <p>\n    Hi <b>there</b>\n  </p>\n  <img src="a.png">\n  <hr>\n  <script>\n    let a = 1;\n      if (a) go();\n  </script>\n</div>' },
      ],
    },
    {
      id: 'dev-sql-format', name: 'SQL Formatter', icon: 'SQL', family: 'dev',
      desc: 'Uppercase SQL keywords and put each clause on its own line', keywords: 'sql pretty format query',
      fields: [{ id: 'sql', label: 'SQL', type: 'textarea', value: "select id, name from users where active = 1 and role = 'admin'" }],
      run: (v) => sqlFormat(need(v.sql, 'some SQL')),
      examples: [
        { in: { sql: 'select id, count(*) as n from users u left join orders o on o.user_id = u.id where u.active = 1 and o.total between 10 and 100 group by id order by n desc;' },
          out: 'SELECT id, COUNT(*) AS n\nFROM users u\nLEFT JOIN orders o ON o.user_id = u.id\nWHERE u.active = 1\n  AND o.total BETWEEN 10 AND 100\nGROUP BY id\nORDER BY n DESC;' },
        { in: { sql: "select 'from where' as s, \"Order\" from t where x in (select y from z)" },
          out: "SELECT 'from where' AS s, \"Order\"\nFROM t\nWHERE x IN (\n  SELECT y\n  FROM z)" },
      ],
    },
    {
      id: 'dev-querystring', name: 'Query String ⇄ JSON', icon: '?=', family: 'dev',
      desc: 'Turn a query string into JSON (repeated keys become arrays) or back', keywords: 'url params search parameters',
      fields: [
        { id: 'mode', label: 'Direction', type: 'select', options: [['toJson', 'Query string → JSON'], ['toQs', 'JSON → query string']] },
        { id: 'text', label: 'Input', type: 'textarea', value: '?q=vex+browser&tag=a&tag=b' },
      ],
      run: (v) => {
        need(v.text, 'a query string or JSON');
        if (v.mode === 'toQs') {
          const o = parseJson(v.text);
          if (!isObj(o)) fail('JSON must be an object of keys and values');
          const enc = (k, x) => {
            if (x !== null && typeof x === 'object') fail(`"${k}" is nested — query strings only hold plain values and lists`);
            return `${encodeURIComponent(k)}=${encodeURIComponent(x === null ? '' : x)}`;
          };
          return Object.entries(o).flatMap(([k, x]) => Array.isArray(x) ? x.map(y => enc(k, y)) : [enc(k, x)]).join('&');
        }
        let q = v.text.trim();
        if (q.includes('?')) q = q.slice(q.indexOf('?') + 1);
        q = q.replace(/#.*$/, '');
        const out = {};
        for (const part of q.split('&')) {
          if (!part) continue;
          const eq = part.indexOf('=');
          const dec = (s) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { fail(`"${s}" has a broken %-escape`); } };
          const k = dec(eq < 0 ? part : part.slice(0, eq)), val = eq < 0 ? '' : dec(part.slice(eq + 1));
          if (!Object.prototype.hasOwnProperty.call(out, k)) out[k] = val;
          else if (Array.isArray(out[k])) out[k].push(val);
          else out[k] = [out[k], val];
        }
        return JSON.stringify(out, null, 2);
      },
      examples: [
        { in: { mode: 'toJson', text: 'https://x.test/s?q=vex+browser&tag=a&tag=b&empty=&flag&e=%C3%A9#top' },
          out: '{\n  "q": "vex browser",\n  "tag": [\n    "a",\n    "b"\n  ],\n  "empty": "",\n  "flag": "",\n  "e": "é"\n}' },
        { in: { mode: 'toQs', text: '{"q":"vex browser","tag":["a","b"],"n":1,"amp":"a&b"}' }, out: 'q=vex%20browser&tag=a&tag=b&n=1&amp=a%26b' },
      ],
    },
    {
      id: 'dev-url-parse', name: 'URL Parser', icon: '🔗', family: 'dev',
      desc: 'Split a URL into protocol, host, port, path, query parameters and fragment', keywords: 'url parse link components',
      fields: [{ id: 'url', label: 'URL', type: 'text', value: 'https://example.com:8080/path/page.html?x=1&y=two#top' }],
      run: (v) => {
        let u;
        try { u = new URL(need(v.url, 'a URL').trim()); } catch { fail('Not a valid absolute URL — include the scheme, e.g. https://'); }
        const DEFAULT_PORTS = { 'http:': '80', 'https:': '443', 'ftp:': '21', 'ws:': '80', 'wss:': '443' };
        const rows = [['Protocol', u.protocol]];
        if (u.username) rows.push(['Username', decodeURIComponent(u.username)]);
        if (u.password) rows.push(['Password', decodeURIComponent(u.password)]);
        rows.push(['Hostname', u.hostname || '(none)'],
          ['Port', u.port || (DEFAULT_PORTS[u.protocol] ? `${DEFAULT_PORTS[u.protocol]} (default)` : '(none)')],
          ['Path', u.pathname || '/'], ['Query', u.search || '(none)'], ['Fragment', u.hash || '(none)'],
          ['Origin', u.origin === 'null' ? '(opaque)' : u.origin]);
        for (const [k, val] of u.searchParams) rows.push([`Param ${k}`, val]);
        return rows;
      },
      examples: [
        { in: { url: 'https://user:p%40ss@example.com:8080/path/page.html?x=1&y=two%20words#top' },
          out: [['Protocol', 'https:'], ['Username', 'user'], ['Password', 'p@ss'], ['Hostname', 'example.com'], ['Port', '8080'],
            ['Path', '/path/page.html'], ['Query', '?x=1&y=two%20words'], ['Fragment', '#top'], ['Origin', 'https://example.com:8080'],
            ['Param x', '1'], ['Param y', 'two words']] },
        { in: { url: 'http://EXAMPLE.org' }, out: [['Protocol', 'http:'], ['Hostname', 'example.org'], ['Port', '80 (default)'], ['Path', '/'], ['Query', '(none)'], ['Fragment', '(none)'], ['Origin', 'http://example.org']] },
      ],
    },
    {
      id: 'dev-http-status', name: 'HTTP Status Codes', icon: '200', family: 'dev',
      desc: 'Look up any HTTP status code, or search them by name', keywords: 'http status code error 404 500 response',
      fields: [{ id: 'q', label: 'Code, class (4xx) or word', type: 'text', value: '404' }],
      run: (v) => {
        const q = need(v.q, 'a status code or word').trim();
        const cls = (c) => HTTP_CLASSES[String(c)[0]];
        if (/^\d{3}$/.test(q)) {
          const hit = HTTP_STATUS.find(s => s[0] === Number(q));
          if (!hit) fail(`${q} is not a registered HTTP status code`);
          return [['Code', String(hit[0])], ['Name', hit[1]], ['Class', cls(hit[0])], ['Meaning', hit[2]]];
        }
        const m = q.match(/^([1-5])xx$/i);
        const hits = m ? HTTP_STATUS.filter(s => String(s[0])[0] === m[1]) : HTTP_STATUS.filter(s => (s[1] + ' ' + s[2]).toLowerCase().includes(q.toLowerCase()));
        if (!hits.length) fail(`No status code matches "${q}"`);
        return hits.map(s => [String(s[0]), s[1]]);
      },
      examples: [
        { in: {}, out: [['Code', '404'], ['Name', 'Not Found'], ['Class', '4xx Client error'], ['Meaning', 'Nothing exists at this URL.']] },
        { in: { q: 'redirect' }, out: [['307', 'Temporary Redirect'], ['308', 'Permanent Redirect']] },
        { in: { q: '1xx' }, out: [['100', 'Continue'], ['101', 'Switching Protocols'], ['102', 'Processing'], ['103', 'Early Hints']] },
      ],
    },
    {
      id: 'dev-mime', name: 'MIME Type Lookup', icon: 'MIME', family: 'dev',
      desc: 'File extension → MIME type, or MIME type → extensions', keywords: 'content-type mime extension file type',
      fields: [{ id: 'q', label: 'Extension, file name or MIME type', type: 'text', value: 'png' }],
      run: (v) => {
        const q = need(v.q, 'an extension or MIME type').trim().toLowerCase();
        if (q.includes('/')) {
          const exts = Object.keys(MIME).filter(e => MIME[e] === q);
          if (!exts.length) fail(`No known extension for ${q}`);
          return exts.map(e => '.' + e).join(', ');
        }
        const ext = q.replace(/^.*\./, '');
        if (!MIME[ext]) fail(`Unknown extension ".${ext}" — application/octet-stream is the generic fallback`);
        return MIME[ext];
      },
      examples: [
        { in: {}, out: 'image/png' },
        { in: { q: 'Report.DOCX' }, out: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { in: { q: 'image/jpeg' }, out: '.jpg, .jpeg' },
      ],
    },
    {
      id: 'dev-chmod', name: 'chmod Calculator', icon: 'rwx', family: 'dev',
      desc: 'Convert Unix permissions between octal (755) and symbolic (rwxr-xr-x)', keywords: 'unix linux permissions file mode',
      fields: [{ id: 'mode', label: 'Octal or symbolic', type: 'text', value: '755' }],
      run: (v) => {
        let t = need(v.mode, 'a permission like 755 or rwxr-xr-x').trim();
        let special, perms;
        if (/^[0-7]{3,4}$/.test(t)) {
          const d = t.padStart(4, '0').split('').map(Number);
          special = d[0]; perms = d.slice(1);
        } else {
          if (t.length === 10) t = t.slice(1);
          if (!/^[r-][w-][xsS-][r-][w-][xsS-][r-][w-][xtT-]$/.test(t)) fail('Enter octal like 755 / 4755 or symbolic like rwxr-xr-x');
          perms = [0, 3, 6].map(o => (t[o] === 'r' ? 4 : 0) + (t[o + 1] === 'w' ? 2 : 0) + (/[xst]/.test(t[o + 2]) ? 1 : 0));
          special = (/[sS]/.test(t[2]) ? 4 : 0) + (/[sS]/.test(t[5]) ? 2 : 0) + (/[tT]/.test(t[8]) ? 1 : 0);
        }
        const sym = perms.map((p, k) => {
          const on = special & [4, 2, 1][k], ch = k === 2 ? 't' : 's';
          return (p & 4 ? 'r' : '-') + (p & 2 ? 'w' : '-') + (on ? (p & 1 ? ch : ch.toUpperCase()) : (p & 1 ? 'x' : '-'));
        }).join('');
        const oct = (special ? String(special) : '') + perms.join('');
        const words = (p) => ['read', 'write', 'execute'].filter((w, i) => p & [4, 2, 1][i]).join(', ') || 'none';
        const sp = ['setuid', 'setgid', 'sticky'].filter((w, i) => special & [4, 2, 1][i]).join(', ') || 'none';
        return [['Octal', oct], ['Symbolic', sym], ['Owner', words(perms[0])], ['Group', words(perms[1])], ['Others', words(perms[2])], ['Special', sp], ['Command', `chmod ${oct} <file>`]];
      },
      examples: [
        { in: {}, out: [['Octal', '755'], ['Symbolic', 'rwxr-xr-x'], ['Owner', 'read, write, execute'], ['Group', 'read, execute'], ['Others', 'read, execute'], ['Special', 'none'], ['Command', 'chmod 755 <file>']] },
        { in: { mode: '-rw-r--r--' }, out: [['Octal', '644'], ['Symbolic', 'rw-r--r--'], ['Owner', 'read, write'], ['Group', 'read'], ['Others', 'read'], ['Special', 'none'], ['Command', 'chmod 644 <file>']] },
        { in: { mode: 'rwsr-x--T' }, out: [['Octal', '5750'], ['Symbolic', 'rwsr-x--T'], ['Owner', 'read, write, execute'], ['Group', 'read, execute'], ['Others', 'none'], ['Special', 'setuid, sticky'], ['Command', 'chmod 5750 <file>']] },
      ],
    },
    {
      id: 'dev-semver', name: 'SemVer Compare & Bump', icon: '1.2.3', family: 'dev',
      desc: 'Compare two semantic versions and see the next patch/minor/major/prerelease', keywords: 'version semver npm bump compare',
      fields: [
        { id: 'a', label: 'Version', type: 'text', value: '1.2.3' },
        { id: 'b', label: 'Compare with (optional)', type: 'text', value: '1.10.0' },
      ],
      run: (v) => {
        const a = semver(v.a, 'Version');
        const rows = [];
        if (v.b.trim()) {
          const b = semver(v.b, 'The second version');
          const c = semverCmp(a, b);
          rows.push(['Compare', `${a.text} ${c < 0 ? '<' : c > 0 ? '>' : '='} ${b.text}`]);
        }
        const core = (M, m, p, pre) => `${M}.${m}.${p}${pre.length ? '-' + pre.join('.') : ''}`;
        const hasPre = a.pre.length > 0;
        const nextPre = !hasPre ? core(a.major, a.minor, a.patch + 1, ['0'])
          : /^\d+$/.test(a.pre[a.pre.length - 1]) ? core(a.major, a.minor, a.patch, [...a.pre.slice(0, -1), String(Number(a.pre[a.pre.length - 1]) + 1)])
          : core(a.major, a.minor, a.patch, [...a.pre, '0']);
        rows.push(
          ['Next patch', hasPre ? core(a.major, a.minor, a.patch, []) : core(a.major, a.minor, a.patch + 1, [])],
          ['Next minor', hasPre && a.patch === 0 ? core(a.major, a.minor, 0, []) : core(a.major, a.minor + 1, 0, [])],
          ['Next major', hasPre && a.minor === 0 && a.patch === 0 ? core(a.major, 0, 0, []) : core(a.major + 1, 0, 0, [])],
          ['Next prerelease', nextPre]);
        return rows;
      },
      examples: [
        { in: {}, out: [['Compare', '1.2.3 < 1.10.0'], ['Next patch', '1.2.4'], ['Next minor', '1.3.0'], ['Next major', '2.0.0'], ['Next prerelease', '1.2.4-0']] },
        { in: { a: 'v1.0.0-alpha.1', b: '1.0.0-alpha.beta' }, out: [['Compare', '1.0.0-alpha.1 < 1.0.0-alpha.beta'], ['Next patch', '1.0.0'], ['Next minor', '1.0.0'], ['Next major', '1.0.0'], ['Next prerelease', '1.0.0-alpha.2']] },
        { in: { a: '2.0.0+build.5', b: '2.0.0-rc.1' }, out: [['Compare', '2.0.0+build.5 > 2.0.0-rc.1'], ['Next patch', '2.0.1'], ['Next minor', '2.1.0'], ['Next major', '3.0.0'], ['Next prerelease', '2.0.1-0']] },
      ],
    },
    {
      id: 'dev-line-endings', name: 'Line Ending Converter', icon: '↵', family: 'dev',
      desc: 'Convert line endings to LF (Unix), CRLF (Windows) or CR', keywords: 'crlf lf newline eol dos unix',
      fields: [
        { id: 'to', label: 'Convert to', type: 'select', options: [['lf', 'LF (\\n)'], ['crlf', 'CRLF (\\r\\n)'], ['cr', 'CR (\\r)']] },
        { id: 'text', label: 'Text', type: 'textarea', value: '' },
      ],
      run: (v) => v.text.replace(/\r\n|\r|\n/g, { lf: '\n', crlf: '\r\n', cr: '\r' }[v.to]),
      examples: [
        { in: { to: 'lf', text: 'a\r\nb\nc\rd' }, out: 'a\nb\nc\nd' },
        { in: { to: 'crlf', text: 'a\nb\r\nc' }, out: 'a\r\nb\r\nc' },
      ],
    },
    {
      id: 'dev-indent', name: 'Tabs ⇄ Spaces', icon: '⇥', family: 'dev',
      desc: 'Convert leading indentation between tabs and spaces', keywords: 'indent tabs spaces whitespace',
      fields: [
        { id: 'mode', label: 'Convert', type: 'select', options: [['toSpaces', 'Tabs → spaces'], ['toTabs', 'Spaces → tabs']] },
        { id: 'width', label: 'Tab width', type: 'number', value: 2, min: 1, max: 16 },
        { id: 'text', label: 'Text', type: 'textarea', value: '' },
      ],
      run: (v) => {
        const w = num(v.width, 'Tab width', { min: 1, max: 16, int: true });
        return v.text.split('\n').map(line => {
          const lead = line.match(/^[ \t]*/)[0];
          let col = 0;
          for (const c of lead) col = c === '\t' ? (Math.floor(col / w) + 1) * w : col + 1;
          const indent = v.mode === 'toSpaces' ? ' '.repeat(col) : '\t'.repeat(Math.floor(col / w)) + ' '.repeat(col % w);
          return indent + line.slice(lead.length);
        }).join('\n');
      },
      examples: [
        { in: { mode: 'toSpaces', width: 2, text: '\tif (x) {\n\t\ty();\n\t}' }, out: '  if (x) {\n    y();\n  }' },
        { in: { mode: 'toTabs', width: 4, text: '    a\n      b\nc' }, out: '\ta\n\t  b\nc' },
      ],
    },
    {
      id: 'dev-env-json', name: '.env ⇄ JSON', icon: '.env', family: 'dev',
      desc: 'Convert a dotenv file to JSON (quotes, export, comments) or JSON back to .env', keywords: 'dotenv environment variables config',
      fields: [
        { id: 'mode', label: 'Direction', type: 'select', options: [['toJson', '.env → JSON'], ['toEnv', 'JSON → .env']] },
        { id: 'text', label: 'Input', type: 'textarea', value: 'API_URL=https://api.example.com\nDEBUG=true' },
      ],
      run: (v) => {
        need(v.text, 'some input');
        if (v.mode === 'toEnv') {
          const o = parseJson(v.text);
          if (!isObj(o)) fail('JSON must be an object of KEY: value pairs');
          return Object.entries(o).map(([k, x]) => {
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) fail(`"${k}" is not a valid variable name`);
            if (x !== null && typeof x === 'object') fail(`"${k}" is nested — .env only holds plain values`);
            const s = x === null ? '' : String(x);
            return /[\s#"'\\$`]/.test(s) ? `${k}="${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"` : `${k}=${s}`;
          }).join('\n');
        }
        const out = {};
        v.text.split(/\r?\n/).forEach((raw, i) => {
          const line = raw.trim();
          if (!line || line[0] === '#') return;
          const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/);
          if (!m) fail(`Line ${i + 1}: expected KEY=value`);
          let val = m[2];
          if (val[0] === '"' || val[0] === "'") {
            const q = val[0];
            let end = -1;
            for (let j = 1; j < val.length; j++) { if (q === '"' && val[j] === '\\') { j++; continue; } if (val[j] === q) { end = j; break; } }
            if (end < 0) fail(`Line ${i + 1}: quoted value is never closed`);
            const rest = val.slice(end + 1).trim();
            if (rest && rest[0] !== '#') fail(`Line ${i + 1}: unexpected text after the closing quote`);
            val = val.slice(1, end);
            if (q === '"') val = val.replace(/\\([nrt"\\$])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t' }[c] || c));
          } else val = val.replace(/\s+#.*$/, '').trim();
          out[m[1]] = val;
        });
        return JSON.stringify(out, null, 2);
      },
      examples: [
        { in: { mode: 'toJson', text: '# comment\nexport API_URL=https://api.example.com\nDEBUG=true\nNAME="Vex Browser" # inline\nMULTI="line1\\nline2"\nEMPTY=\nSINGLE=\'raw $value\\n\'\nPLAIN=a b # note' },
          out: '{\n  "API_URL": "https://api.example.com",\n  "DEBUG": "true",\n  "NAME": "Vex Browser",\n  "MULTI": "line1\\nline2",\n  "EMPTY": "",\n  "SINGLE": "raw $value\\\\n",\n  "PLAIN": "a b"\n}' },
        { in: { mode: 'toEnv', text: '{"A":"x y","B":1,"C":"line\\nnext","D":null,"E":"say \\"hi\\""}' }, out: 'A="x y"\nB=1\nC="line\\nnext"\nD=\nE="say \\"hi\\""' },
      ],
    },
    {
      id: 'dev-unicode', name: 'Unicode Inspector', icon: 'U+', family: 'dev',
      desc: 'Show each character\'s code point, UTF-8 bytes, UTF-16 units and HTML entity', keywords: 'unicode codepoint utf8 utf16 emoji character',
      fields: [{ id: 'text', label: 'Text', type: 'text', value: 'A€😀' }],
      run: (v) => {
        const chars = [...need(v.text, 'some text')];
        if (chars.length > 256) fail('Paste at most 256 characters');
        return chars.map(ch => {
          const cp = ch.codePointAt(0);
          const u16 = [];
          for (let i = 0; i < ch.length; i++) u16.push(ch.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0'));
          const label = cp < 0x21 || (cp >= 0x7f && cp < 0xa1) ? JSON.stringify(ch) : ch;
          return [label, `U+${cp.toString(16).toUpperCase().padStart(4, '0')} · UTF-8 ${utf8(ch).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')} · UTF-16 ${u16.join(' ')} · &#${cp};`];
        });
      },
      examples: [
        { in: {}, out: [['A', 'U+0041 · UTF-8 41 · UTF-16 0041 · &#65;'], ['€', 'U+20AC · UTF-8 E2 82 AC · UTF-16 20AC · &#8364;'], ['😀', 'U+1F600 · UTF-8 F0 9F 98 80 · UTF-16 D83D DE00 · &#128512;']] },
        { in: { text: 'é\t' }, out: [['é', 'U+00E9 · UTF-8 C3 A9 · UTF-16 00E9 · &#233;'], ['"\\t"', 'U+0009 · UTF-8 09 · UTF-16 0009 · &#9;']] },
      ],
    },
    {
      id: 'dev-byte-length', name: 'String Byte Length', icon: 'B', family: 'dev',
      desc: 'Count code points, UTF-16 units and UTF-8 / UTF-32 bytes of text', keywords: 'bytes size length utf8 characters',
      fields: [{ id: 'text', label: 'Text', type: 'textarea', value: 'héllo 😀' }],
      run: (v) => {
        const cps = [...v.text].length;
        return [['Code points', String(cps)], ['UTF-16 code units (JS .length)', String(v.text.length)],
          ['UTF-8 bytes', String(utf8(v.text).length)], ['UTF-16 bytes', String(v.text.length * 2)], ['UTF-32 bytes', String(cps * 4)],
          ['Lines', String(v.text ? v.text.split(/\r\n|\r|\n/).length : 0)]];
      },
      examples: [
        { in: {}, out: [['Code points', '7'], ['UTF-16 code units (JS .length)', '8'], ['UTF-8 bytes', '11'], ['UTF-16 bytes', '16'], ['UTF-32 bytes', '28'], ['Lines', '1']] },
      ],
    },
    {
      id: 'dev-number-base', name: 'Number Bases & Two\'s Complement', icon: '0x', family: 'dev',
      desc: 'Decimal, hex, octal and binary, plus the N-bit two\'s complement pattern', keywords: 'hex binary octal decimal twos complement signed unsigned radix',
      fields: [
        { id: 'value', label: 'Number (123, -5, 0xFF, 0b1010, 0o17)', type: 'text', value: '-42' },
        { id: 'bits', label: 'Bit width', type: 'select', options: [['8', '8-bit'], ['16', '16-bit'], ['32', '32-bit'], ['64', '64-bit']] },
      ],
      run: (v) => {
        const x = parseBig(v.value, 'a number');
        const n = BigInt(v.bits), size = 1n << n;
        if (x < -(size >> 1n) || x >= size) fail(`${x} does not fit in ${v.bits} bits`);
        const sign = x < 0n ? '-' : '', a = x < 0n ? -x : x;
        const u = ((x % size) + size) % size;
        const s = u >= size >> 1n ? u - size : u;
        return [['Decimal', String(x)], ['Hexadecimal', sign + a.toString(16).toUpperCase()], ['Octal', sign + a.toString(8)], ['Binary', sign + group4(a.toString(2))],
          [`${v.bits}-bit pattern (hex)`, u.toString(16).toUpperCase().padStart(Number(n) / 4, '0')],
          [`${v.bits}-bit pattern (binary)`, group4(u.toString(2).padStart(Number(n), '0'))],
          [`As signed ${v.bits}-bit`, String(s)], [`As unsigned ${v.bits}-bit`, String(u)]];
      },
      examples: [
        { in: { value: '-42', bits: '8' }, out: [['Decimal', '-42'], ['Hexadecimal', '-2A'], ['Octal', '-52'], ['Binary', '-10 1010'], ['8-bit pattern (hex)', 'D6'], ['8-bit pattern (binary)', '1101 0110'], ['As signed 8-bit', '-42'], ['As unsigned 8-bit', '214']] },
        { in: { value: '0xFFFF', bits: '16' }, out: [['Decimal', '65535'], ['Hexadecimal', 'FFFF'], ['Octal', '177777'], ['Binary', '1111 1111 1111 1111'], ['16-bit pattern (hex)', 'FFFF'], ['16-bit pattern (binary)', '1111 1111 1111 1111'], ['As signed 16-bit', '-1'], ['As unsigned 16-bit', '65535']] },
      ],
    },
    {
      id: 'dev-bitwise', name: 'Bitwise Calculator', icon: '&|', family: 'dev',
      desc: 'AND, OR, XOR, NOT, NAND, NOR and shifts on N-bit integers', keywords: 'bit and or xor shift mask',
      fields: [
        { id: 'a', label: 'A', type: 'text', value: '0b1100' },
        { id: 'op', label: 'Operation', type: 'select', options: [['and', 'A AND B'], ['or', 'A OR B'], ['xor', 'A XOR B'], ['not', 'NOT A'], ['nand', 'A NAND B'], ['nor', 'A NOR B'], ['shl', 'A << B'], ['sar', 'A >> B (arithmetic)'], ['shr', 'A >>> B (logical)']] },
        { id: 'b', label: 'B (or shift count)', type: 'text', value: '0b1010' },
        { id: 'bits', label: 'Bit width', type: 'select', options: [['8', '8-bit'], ['16', '16-bit'], ['32', '32-bit'], ['64', '64-bit']] },
      ],
      run: (v) => {
        const n = BigInt(v.bits), size = 1n << n, mask = size - 1n;
        const pattern = (s, label) => {
          const x = parseBig(s, label);
          if (x < -(size >> 1n) || x >= size) fail(`${label[0].toUpperCase() + label.slice(1)} does not fit in ${v.bits} bits`);
          return ((x % size) + size) % size;
        };
        const a = pattern(v.a, 'A');
        let r;
        if (v.op === 'not') r = ~a & mask;
        else if (/^(shl|sar|shr)$/.test(v.op)) {
          const k = parseBig(v.b, 'the shift count');
          if (k < 0n || k > n) fail(`Shift count must be 0-${v.bits}`);
          const signed = a >= size >> 1n ? a - size : a;
          r = v.op === 'shl' ? (a << k) & mask : v.op === 'sar' ? ((signed >> k) % size + size) % size : a >> k;
        } else {
          const b = pattern(v.b, 'B');
          r = { and: a & b, or: a | b, xor: a ^ b, nand: ~(a & b) & mask, nor: ~(a | b) & mask }[v.op];
        }
        return [['Decimal (unsigned)', String(r)], ['Decimal (signed)', String(r >= size >> 1n ? r - size : r)],
          ['Hex', r.toString(16).toUpperCase().padStart(Number(n) / 4, '0')], ['Binary', group4(r.toString(2).padStart(Number(n), '0'))]];
      },
      examples: [
        { in: { op: 'xor', bits: '8' }, out: [['Decimal (unsigned)', '6'], ['Decimal (signed)', '6'], ['Hex', '06'], ['Binary', '0000 0110']] },
        { in: { a: '0', op: 'not', bits: '8' }, out: [['Decimal (unsigned)', '255'], ['Decimal (signed)', '-1'], ['Hex', 'FF'], ['Binary', '1111 1111']] },
        { in: { a: '0x80', op: 'sar', b: '1', bits: '8' }, out: [['Decimal (unsigned)', '192'], ['Decimal (signed)', '-64'], ['Hex', 'C0'], ['Binary', '1100 0000']] },
        { in: { a: '0x80', op: 'shr', b: '1', bits: '8' }, out: [['Decimal (unsigned)', '64'], ['Decimal (signed)', '64'], ['Hex', '40'], ['Binary', '0100 0000']] },
      ],
    },
    {
      id: 'dev-useragent', name: 'User-Agent Parser', icon: 'UA', family: 'dev',
      desc: 'Detect browser, engine, OS and device type from a User-Agent string', keywords: 'user agent browser detect os device',
      fields: [{ id: 'ua', label: 'User-Agent', type: 'textarea', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' }],
      run: (v) => parseUserAgent(need(v.ua, 'a User-Agent string').trim()),
      examples: [
        { in: {}, out: [['Browser', 'Chrome 124.0.0.0'], ['Engine', 'Blink'], ['OS', 'Windows 10/11'], ['Device', 'Desktop'], ['Bot', 'No']] },
        { in: { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1' },
          out: [['Browser', 'Safari 17.4'], ['Engine', 'WebKit'], ['OS', 'iOS 17.4'], ['Device', 'Mobile'], ['Bot', 'No']] },
        { in: { ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0' }, out: [['Browser', 'Firefox 125.0'], ['Engine', 'Gecko'], ['OS', 'Linux'], ['Device', 'Desktop'], ['Bot', 'No']] },
        { in: { ua: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 Edg/124.0.0.0' }, out: [['Browser', 'Edge 124.0.0.0'], ['Engine', 'Blink'], ['OS', 'Android 14'], ['Device', 'Mobile'], ['Bot', 'No']] },
        { in: { ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }, out: [['Browser', 'Unknown'], ['Engine', 'Unknown'], ['OS', 'Unknown'], ['Device', 'Desktop'], ['Bot', 'Yes (Googlebot)']] },
      ],
    },
    {
      id: 'dev-curl-fetch', name: 'cURL → fetch()', icon: 'curl', family: 'dev',
      desc: 'Turn a curl command (-X, -H, -d, -u, --json…) into JavaScript fetch code', keywords: 'curl fetch http request convert javascript',
      fields: [{ id: 'cmd', label: 'curl command', type: 'textarea', value: "curl -X POST https://api.example.com/items -H 'Content-Type: application/json' -d '{\"name\":\"vex\"}'" }],
      run: (v) => curlToFetch(need(v.cmd, 'a curl command')),
      examples: [
        { in: { cmd: "curl -X POST https://api.example.com/items \\\n  -H 'Content-Type: application/json' \\\n  -H \"Authorization: Bearer abc\" \\\n  -d '{\"name\":\"vex\"}'" },
          out: 'fetch("https://api.example.com/items", {\n  method: "POST",\n  headers: {\n    "Content-Type": "application/json",\n    "Authorization": "Bearer abc"\n  },\n  body: "{\\"name\\":\\"vex\\"}"\n});' },
        { in: { cmd: 'curl -sL -u me:secret https://x.test/' }, out: 'fetch("https://x.test/", {\n  headers: {\n    "Authorization": "Basic bWU6c2VjcmV0"\n  }\n});' },
        { in: { cmd: 'curl https://x.test/form -d a=1 -d b=2' }, out: 'fetch("https://x.test/form", {\n  method: "POST",\n  headers: {\n    "Content-Type": "application/x-www-form-urlencoded"\n  },\n  body: "a=1&b=2"\n});' },
        { in: { cmd: 'curl -G https://x.test/s --data-urlencode "q=a b" -I' }, out: 'fetch("https://x.test/s?q=a%20b", {\n  method: "HEAD"\n});' },
      ],
    },
    {
      id: 'dev-commit-lint', name: 'Commit Message Linter', icon: '✓git', family: 'dev',
      desc: 'Check a commit message against the Conventional Commits format', keywords: 'git commit conventional lint message',
      fields: [{ id: 'msg', label: 'Commit message', type: 'textarea', value: 'feat(parser): add YAML support' }],
      run: (v) => lintCommit(need(v.msg, 'a commit message')),
      examples: [
        { in: { msg: 'feat(parser)!: add YAML support\n\nLonger explanation.\n\nBREAKING CHANGE: drops the old API' },
          out: [['Type', 'feat'], ['Scope', 'parser'], ['Breaking change', 'Yes'], ['Description', 'add YAML support'], ['Problems', 'None — looks good']] },
        { in: { msg: 'Fixed stuff.' }, out: [['Type', '—'], ['Scope', '—'], ['Breaking change', 'No'], ['Description', '—'], ['Problems', 'Header must look like "type(scope): description"']] },
        { in: { msg: 'Fix: Update deps.\nbody right away' },
          out: [['Type', 'Fix'], ['Scope', '(none)'], ['Breaking change', 'No'], ['Description', 'Update deps.'], ['Problems', 'Type "Fix" should be lowercase; Start the description with a lowercase letter; Do not end the description with a period; Leave a blank line between the header and the body']] },
      ],
    },
  ];

  const HTTP_CLASSES = { 1: '1xx Informational', 2: '2xx Success', 3: '3xx Redirection', 4: '4xx Client error', 5: '5xx Server error' };
  const HTTP_STATUS = `100|Continue|Keep sending the request body.
101|Switching Protocols|The server is switching protocols as asked (e.g. to WebSocket).
102|Processing|WebDAV: request received, still working on it.
103|Early Hints|Preload hints sent before the final response.
200|OK|The request succeeded.
201|Created|A new resource was created.
202|Accepted|Accepted for processing, but not finished yet.
203|Non-Authoritative Information|The returned metadata comes from a proxy's copy.
204|No Content|Success, with no body.
205|Reset Content|Success; the client should reset its view or form.
206|Partial Content|Only the requested byte range is returned.
207|Multi-Status|WebDAV: several status codes in the body.
208|Already Reported|WebDAV: members were already listed earlier.
226|IM Used|The response is the result of instance manipulations.
300|Multiple Choices|Several representations exist; pick one.
301|Moved Permanently|The resource has a new permanent URL.
302|Found|The resource is temporarily at another URL.
303|See Other|Fetch the result with GET at another URL.
304|Not Modified|The cached copy is still valid.
305|Use Proxy|Deprecated: must be accessed through a proxy.
307|Temporary Redirect|Temporarily elsewhere; repeat with the same method.
308|Permanent Redirect|Permanently elsewhere; repeat with the same method.
400|Bad Request|The request is malformed.
401|Unauthorized|Authentication is required or failed.
402|Payment Required|Reserved; sometimes used for paywalls or quotas.
403|Forbidden|The client is known but not allowed.
404|Not Found|Nothing exists at this URL.
405|Method Not Allowed|This URL does not support that HTTP method.
406|Not Acceptable|No representation matches the Accept headers.
407|Proxy Authentication Required|Authenticate with the proxy first.
408|Request Timeout|The client took too long to send the request.
409|Conflict|The request conflicts with the current state of the resource.
410|Gone|Removed permanently, with no forwarding address.
411|Length Required|A Content-Length header is required.
412|Precondition Failed|A conditional header (If-Match, If-Unmodified-Since) did not hold.
413|Content Too Large|The request body is too big.
414|URI Too Long|The URL is too long.
415|Unsupported Media Type|The body's format is not supported.
416|Range Not Satisfiable|The requested range is outside the resource.
417|Expectation Failed|The Expect header cannot be met.
418|I'm a teapot|April Fools' joke from RFC 2324: refuses to brew coffee.
421|Misdirected Request|Sent to a server that cannot answer for this host.
422|Unprocessable Content|Well-formed, but semantically invalid.
423|Locked|WebDAV: the resource is locked.
424|Failed Dependency|WebDAV: an earlier request it depended on failed.
425|Too Early|The server won't risk processing a request that might be replayed.
426|Upgrade Required|Switch to another protocol (see the Upgrade header).
428|Precondition Required|The request must be conditional.
429|Too Many Requests|Rate limited; slow down (see Retry-After).
431|Request Header Fields Too Large|The headers are too big.
451|Unavailable For Legal Reasons|Blocked for legal reasons.
500|Internal Server Error|The server hit an unexpected error.
501|Not Implemented|The server does not support this functionality.
502|Bad Gateway|An upstream server sent an invalid response.
503|Service Unavailable|Overloaded or down for maintenance.
504|Gateway Timeout|An upstream server did not answer in time.
505|HTTP Version Not Supported|That HTTP version is not supported.
506|Variant Also Negotiates|Content negotiation is misconfigured.
507|Insufficient Storage|WebDAV: no space to store the result.
508|Loop Detected|WebDAV: an infinite loop was found while processing.
510|Not Extended|Further extensions are required (obsolete).
511|Network Authentication Required|Log in to the network first (captive portal).`.split('\n').map(l => { const [c, n, m] = l.split('|'); return [Number(c), n, m]; });

  const MIME = {};
  `text/html html htm|text/css css|text/javascript js mjs cjs|application/json json map|application/ld+json jsonld|application/xml xml|text/plain txt log|text/csv csv|
text/markdown md markdown|text/calendar ics|text/vcard vcf|image/png png|image/jpeg jpg jpeg|image/gif gif|image/webp webp|image/avif avif|image/svg+xml svg|
image/vnd.microsoft.icon ico|image/bmp bmp|image/tiff tif tiff|image/heic heic|audio/mpeg mp3|audio/wav wav|audio/ogg ogg oga|audio/flac flac|audio/mp4 m4a|
audio/aac aac|audio/webm weba|audio/opus opus|audio/midi mid midi|video/mp4 mp4 m4v|video/webm webm|video/ogg ogv|video/quicktime mov|video/x-msvideo avi|
video/x-matroska mkv|video/mpeg mpeg mpg|video/mp2t ts|font/woff woff|font/woff2 woff2|font/ttf ttf|font/otf otf|application/pdf pdf|application/zip zip|
application/gzip gz|application/x-tar tar|application/x-7z-compressed 7z|application/vnd.rar rar|application/x-bzip2 bz2|application/msword doc|
application/vnd.openxmlformats-officedocument.wordprocessingml.document docx|application/vnd.ms-excel xls|
application/vnd.openxmlformats-officedocument.spreadsheetml.sheet xlsx|application/vnd.ms-powerpoint ppt|
application/vnd.openxmlformats-officedocument.presentationml.presentation pptx|application/vnd.oasis.opendocument.text odt|
application/vnd.oasis.opendocument.spreadsheet ods|application/rtf rtf|application/epub+zip epub|application/wasm wasm|application/manifest+json webmanifest|
application/yaml yaml yml|application/toml toml|application/sql sql|application/x-sh sh|application/java-archive jar|application/vnd.android.package-archive apk|
application/vnd.microsoft.portable-executable exe dll|application/x-msi msi|application/octet-stream bin|application/x-apple-diskimage dmg|application/x-iso9660-image iso`
    .split('|').forEach(entry => { const [type, ...exts] = entry.trim().split(' '); for (const e of exts) MIME[e] = type; });

  const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
  function semver(s, label) {
    const t = need(s, 'a version like 1.2.3').trim();
    const m = t.match(SEMVER);
    if (!m) fail(`${label} "${t}" is not semantic versioning (MAJOR.MINOR.PATCH, e.g. 1.4.0 or 2.0.0-rc.1)`);
    return { text: t.replace(/^v/, ''), major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : [] };
  }
  function semverCmp(a, b) {
    for (const k of ['major', 'minor', 'patch']) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
    if (!a.pre.length && !b.pre.length) return 0;
    if (!a.pre.length) return 1; // a release outranks its prereleases
    if (!b.pre.length) return -1;
    for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
      const x = a.pre[i], y = b.pre[i];
      if (x === undefined) return -1;
      if (y === undefined) return 1;
      if (x === y) continue;
      const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
      if (nx && ny) return Number(x) < Number(y) ? -1 : 1;
      if (nx !== ny) return nx ? -1 : 1;
      return x < y ? -1 : 1;
    }
    return 0;
  }

  function parseUserAgent(ua) {
    const BROWSERS = [
      [/Edg(?:e|A|iOS)?\/([\d.]+)/, 'Edge'], [/OPR\/([\d.]+)/, 'Opera'], [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
      [/Vivaldi\/([\d.]+)/, 'Vivaldi'], [/YaBrowser\/([\d.]+)/, 'Yandex Browser'], [/(?:Firefox|FxiOS)\/([\d.]+)/, 'Firefox'],
      [/(?:CriOS|Chrome)\/([\d.]+)/, 'Chrome'], [/Version\/([\d.]+).*Safari\//, 'Safari'], [/MSIE ([\d.]+)/, 'Internet Explorer'],
      [/Trident\/.*rv:([\d.]+)/, 'Internet Explorer'],
    ];
    let browser = 'Unknown';
    for (const [re, name] of BROWSERS) { const m = ua.match(re); if (m) { browser = `${name} ${m[1]}`; break; } }
    const ios = /iPhone|iPad|iPod/.test(ua);
    const engine = /Trident\//.test(ua) ? 'Trident' : ios ? 'WebKit' : /Gecko\/\d/.test(ua) && /Firefox\//.test(ua) ? 'Gecko'
      : /Chrome\//.test(ua) ? 'Blink' : /AppleWebKit\//.test(ua) ? 'WebKit' : 'Unknown';
    const WIN = { '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7', '6.0': 'Vista', '5.1': 'XP' };
    let os = 'Unknown', m;
    if ((m = ua.match(/Windows NT ([\d.]+)/))) os = `Windows ${WIN[m[1]] || 'NT ' + m[1]}`;
    else if ((m = ua.match(/(?:iPhone|iPad|iPod).*? OS (\d+(?:_\d+)*)/))) os = `iOS ${m[1].replace(/_/g, '.')}`;
    else if ((m = ua.match(/Android ([\d.]+)/))) os = `Android ${m[1]}`;
    else if (/CrOS/.test(ua)) os = 'ChromeOS';
    else if ((m = ua.match(/Mac OS X (\d+(?:[_.]\d+)*)/))) os = `macOS ${m[1].replace(/_/g, '.')}`;
    else if (/Linux/.test(ua)) os = 'Linux';
    const device = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) ? 'Tablet' : /Mobi|iPhone|iPod/.test(ua) ? 'Mobile' : 'Desktop';
    const bot = ua.match(/[\w-]*(?:bot|crawl|spider|slurp|headless)[\w-]*/i);
    return [['Browser', browser], ['Engine', engine], ['OS', os], ['Device', device], ['Bot', bot ? `Yes (${bot[0]})` : 'No']];
  }

  // Split a shell command line into words (single/double quotes, backslash escapes, \-newline).
  function shellWords(cmd) {
    const s = cmd.replace(/\\\r?\n/g, ' ');
    const words = [];
    let cur = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (/\s/.test(c)) { if (cur !== null) { words.push(cur); cur = null; } continue; }
      cur = cur || '';
      if (c === "'") { const e = s.indexOf("'", i + 1); if (e < 0) fail('A single quote is never closed'); cur += s.slice(i + 1, e); i = e; }
      else if (c === '"') {
        let j = i + 1;
        for (; j < s.length && s[j] !== '"'; j++) {
          if (s[j] === '\\' && /["\\$`]/.test(s[j + 1] || '')) j++;
          cur += s[j];
        }
        if (j >= s.length) fail('A double quote is never closed');
        i = j;
      } else if (c === '\\') { cur += s[i + 1] || ''; i++; }
      else cur += c;
    }
    if (cur !== null) words.push(cur);
    return words;
  }

  function curlToFetch(cmd) {
    const w = shellWords(cmd.trim());
    if (w[0] !== 'curl') fail('The command must start with "curl"');
    const VALUE = { '-X': 'method', '--request': 'method', '-H': 'header', '--header': 'header', '-d': 'data', '--data': 'data',
      '--data-raw': 'data', '--data-binary': 'data', '--data-ascii': 'data', '--data-urlencode': 'urlencode', '--json': 'json',
      '-u': 'user', '--user': 'user', '-A': 'agent', '--user-agent': 'agent', '-b': 'cookie', '--cookie': 'cookie',
      '-e': 'referer', '--referer': 'referer', '--url': 'url' };
    const FLAG = { '-I': 'head', '--head': 'head', '-G': 'get', '--get': 'get', '-k': 'insecure', '--insecure': 'insecure' };
    const QUIET = new Set(['-s', '--silent', '-S', '--show-error', '-L', '--location', '-v', '--verbose', '-i', '--include', '--compressed', '-f', '--fail']);
    let url = null, method = null, head = false, get = false, insecure = false;
    const headers = [], data = [];
    const setHeader = (k, val) => { const i = headers.findIndex(h => h[0].toLowerCase() === k.toLowerCase()); if (i >= 0) headers[i][1] = val; else headers.push([k, val]); };
    const hasHeader = (k) => headers.some(h => h[0].toLowerCase() === k.toLowerCase());
    for (let i = 1; i < w.length; i++) {
      let a = w[i], val;
      if (a[0] !== '-' || a === '-') { if (url) fail(`Unexpected extra argument "${a}"`); url = a; continue; }
      if (/^-[A-Za-z]{2,}$/.test(a) && [...a.slice(1)].every(c => QUIET.has('-' + c) || FLAG['-' + c])) {
        for (const c of a.slice(1)) { const f = FLAG['-' + c]; if (f === 'head') head = true; if (f === 'get') get = true; if (f === 'insecure') insecure = true; }
        continue;
      }
      if (/^-[A-Za-z]./.test(a) && VALUE[a.slice(0, 2)]) { val = a.slice(2); a = a.slice(0, 2); }
      if (QUIET.has(a)) continue;
      if (FLAG[a]) { if (FLAG[a] === 'head') head = true; else if (FLAG[a] === 'get') get = true; else insecure = true; continue; }
      const kind = VALUE[a];
      if (!kind) fail(`Unsupported curl option "${a}"`);
      if (val === undefined) { if (i + 1 >= w.length) fail(`"${a}" needs a value`); val = w[++i]; }
      if (kind === 'method') method = val.toUpperCase();
      else if (kind === 'header') { const c = val.indexOf(':'); if (c < 1) fail(`Header "${val}" must look like "Name: value"`); setHeader(val.slice(0, c).trim(), val.slice(c + 1).trim()); }
      else if (kind === 'data') data.push(val);
      else if (kind === 'urlencode') { const e = val.indexOf('='); data.push(e < 0 ? encodeURIComponent(val) : val.slice(0, e + 1) + encodeURIComponent(val.slice(e + 1))); }
      else if (kind === 'json') { data.push(val); setHeader('Content-Type', 'application/json'); setHeader('Accept', 'application/json'); }
      else if (kind === 'user') setHeader('Authorization', 'Basic ' + b64(utf8(val)));
      else if (kind === 'agent') setHeader('User-Agent', val);
      else if (kind === 'cookie') setHeader('Cookie', val);
      else if (kind === 'referer') setHeader('Referer', val);
      else if (kind === 'url') { if (url) fail('More than one URL given'); url = val; }
    }
    if (!url) fail('No URL found in the curl command');
    let body = data.length ? data.join('&') : null;
    if (body !== null && get) { url += (url.includes('?') ? '&' : '?') + body; body = null; }
    if (!method) method = head ? 'HEAD' : body !== null ? 'POST' : 'GET';
    if (body !== null && !hasHeader('Content-Type')) setHeader('Content-Type', 'application/x-www-form-urlencoded');
    const opts = [];
    if (method !== 'GET') opts.push(`  method: ${JSON.stringify(method)}`);
    if (headers.length) opts.push(`  headers: {\n${headers.map(([k, x]) => `    ${JSON.stringify(k)}: ${JSON.stringify(x)}`).join(',\n')}\n  }`);
    if (body !== null) opts.push(`  body: ${JSON.stringify(body)}`);
    const note = insecure ? '// Note: -k (skip TLS certificate checks) has no fetch() equivalent\n' : '';
    return note + (opts.length ? `fetch(${JSON.stringify(url)}, {\n${opts.join(',\n')}\n});` : `fetch(${JSON.stringify(url)});`);
  }

  const COMMIT_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];
  function lintCommit(msg) {
    const lines = msg.replace(/\r\n/g, '\n').split('\n');
    const header = lines[0];
    const m = header.match(/^([A-Za-z]+)(?:\(([^()\n]+)\))?(!)?: (.+)$/);
    const breakingFooter = /^BREAKING[ -]CHANGE: /m.test(lines.slice(1).join('\n'));
    if (!m) return [['Type', '—'], ['Scope', '—'], ['Breaking change', breakingFooter ? 'Yes' : 'No'], ['Description', '—'], ['Problems', 'Header must look like "type(scope): description"']];
    const [, type, scope, bang, desc] = m;
    const problems = [];
    if (type !== type.toLowerCase()) problems.push(`Type "${type}" should be lowercase`);
    else if (!COMMIT_TYPES.includes(type)) problems.push(`Unknown type "${type}" (use ${COMMIT_TYPES.join(', ')})`);
    if (/^[A-Z]/.test(desc)) problems.push('Start the description with a lowercase letter');
    if (/\.$/.test(desc)) problems.push('Do not end the description with a period');
    if (header.length > 72) problems.push(`Header is ${header.length} characters; keep it to 72 or fewer`);
    if (lines.length > 1 && lines[1].trim() !== '') problems.push('Leave a blank line between the header and the body');
    return [['Type', type], ['Scope', scope || '(none)'], ['Breaking change', bang || breakingFooter ? 'Yes' : 'No'], ['Description', desc],
      ['Problems', problems.length ? problems.join('; ') : 'None — looks good']];
  }

  // ---- data -------------------------------------------------------------------
  const DELIMS = [[',', 'Comma'], [';', 'Semicolon'], ['\t', 'Tab'], ['|', 'Pipe']];
  const strictNumber = (s) => /^-?(0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?$/.test(s);

  // Split off the header row (or synthesise "1", "2", … names) and check widths.
  function csvWithHeader(text, delim, hasHeader) {
    const rows = csvTable(text, delim);
    const width = Math.max(...rows.map(r => r.length));
    const header = hasHeader ? rows[0] : Array.from({ length: width }, (_, i) => String(i + 1));
    const body = hasHeader ? rows.slice(1) : rows;
    body.forEach((r, i) => {
      if (hasHeader && r.length !== header.length) fail(`Row ${i + 2} has ${r.length} field(s) but the header has ${header.length}`);
    });
    return { header, body, hasHeader };
  }
  const withHeader = (t, rows) => toCsv(t.hasHeader ? [t.header, ...rows] : rows);

  const sqlIdent = (s) => String(s).split('.').map(p => /^[A-Za-z_][A-Za-z0-9_]*$/.test(p) ? p : `"${p.replace(/"/g, '""')}"`).join('.');

  const DATA = [
    {
      id: 'data-csv-json', name: 'CSV → JSON', icon: '▦→{}', family: 'data',
      desc: 'Convert CSV (quoted fields, commas and newlines inside quotes) to a JSON array', keywords: 'csv json convert spreadsheet',
      fields: [
        { id: 'csv', label: 'CSV', type: 'textarea', value: 'name,age\nAnn,30\nBo,25' },
        { id: 'delim', label: 'Delimiter', type: 'select', options: DELIMS },
        { id: 'header', label: 'First row is a header', type: 'checkbox', value: true },
        { id: 'types', label: 'Detect numbers and true/false', type: 'checkbox', value: true },
      ],
      run: (v) => {
        const conv = (s) => !v.types ? s : strictNumber(s) ? Number(s) : s === 'true' ? true : s === 'false' ? false : s;
        if (!v.header) return JSON.stringify(csvTable(v.csv, v.delim).map(r => r.map(conv)), null, 2);
        const t = csvWithHeader(v.csv, v.delim, true);
        return JSON.stringify(t.body.map(r => Object.fromEntries(t.header.map((h, i) => [h, conv(r[i])]))), null, 2);
      },
      examples: [
        { in: { csv: 'name,age,note\n"Smith, J",42,"said ""hi""\nthen left"\r\nAnn,007,\n' },
          out: '[\n  {\n    "name": "Smith, J",\n    "age": 42,\n    "note": "said \\"hi\\"\\nthen left"\n  },\n  {\n    "name": "Ann",\n    "age": "007",\n    "note": ""\n  }\n]' },
        { in: { csv: 'a;b\n1;true', delim: ';', header: false, types: false }, out: '[\n  [\n    "a",\n    "b"\n  ],\n  [\n    "1",\n    "true"\n  ]\n]' },
      ],
    },
    {
      id: 'data-json-csv', name: 'JSON → CSV', icon: '{}→▦', family: 'data',
      desc: 'Convert a JSON array of objects (or arrays) to CSV, quoting where needed', keywords: 'json csv convert export spreadsheet',
      fields: [
        { id: 'json', label: 'JSON array', type: 'textarea', value: '[{"name":"Ann","age":30},{"name":"Bo","age":25}]' },
        { id: 'delim', label: 'Delimiter', type: 'select', options: DELIMS },
      ],
      run: (v) => {
        const arr = parseJson(v.json);
        if (!Array.isArray(arr) || !arr.length) fail('JSON must be a non-empty array');
        const cell = (x) => x === null || x === undefined ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x);
        if (arr.every(Array.isArray)) return toCsv(arr.map(r => r.map(cell)), v.delim);
        if (!arr.every(isObj)) fail('Every item must be an object (or every item an array)');
        const cols = [];
        for (const o of arr) for (const k of Object.keys(o)) if (!cols.includes(k)) cols.push(k);
        return toCsv([cols, ...arr.map(o => cols.map(k => cell(o[k])))], v.delim);
      },
      examples: [
        { in: { json: '[{"a":1,"b":"x,y"},{"a":2,"c":"q\\"t","d":{"n":1}}]' }, out: 'a,b,c,d\n1,"x,y",,\n2,,"q""t","{""n"":1}"' },
        { in: { json: '[[1,2],["x","line\\nbreak"]]', delim: '\t' }, out: '1\t2\nx\t"line\nbreak"' },
      ],
    },
    {
      id: 'data-tsv-csv', name: 'TSV ⇄ CSV', icon: '⇥,', family: 'data',
      desc: 'Convert tab-separated values to CSV or back', keywords: 'tsv csv tab excel paste',
      fields: [
        { id: 'mode', label: 'Direction', type: 'select', options: [['toCsv', 'TSV → CSV'], ['toTsv', 'CSV → TSV']] },
        { id: 'text', label: 'Input', type: 'textarea', value: 'a\tb\nx,y\tz' },
      ],
      run: (v) => v.mode === 'toCsv' ? toCsv(csvTable(v.text, '\t'), ',') : toCsv(csvTable(v.text, ','), '\t'),
      examples: [
        { in: { mode: 'toCsv' }, out: 'a,b\n"x,y",z' },
        { in: { mode: 'toTsv', text: 'a,"b\tc",d' }, out: 'a\t"b\tc"\td' },
      ],
    },
    {
      id: 'data-csv-column', name: 'CSV Column Extractor', icon: '▥', family: 'data',
      desc: 'Keep only chosen CSV columns (by name or number), in the order you list them', keywords: 'csv column select pick cut',
      fields: [
        { id: 'csv', label: 'CSV', type: 'textarea', value: 'name,age,city\nAnn,30,Oslo\nBo,25,Rome' },
        { id: 'cols', label: 'Columns (names or numbers, comma-separated)', type: 'text', value: 'city, 1' },
        { id: 'header', label: 'First row is a header', type: 'checkbox', value: true },
      ],
      run: (v) => {
        const t = csvWithHeader(v.csv, ',', v.header);
        const idx = need(v.cols, 'the columns to keep').split(',').map(c => columnIndex(t.header, c));
        const rows = [t.header, ...t.body].map(r => idx.map(i => r[i] === undefined ? '' : r[i]));
        return toCsv(t.hasHeader ? rows : rows.slice(1));
      },
      examples: [
        { in: {}, out: 'city,name\nOslo,Ann\nRome,Bo' },
        { in: { csv: 'a,b,c\n1,2,3', cols: '3,1', header: false }, out: 'c,a\n3,1' },
      ],
    },
    {
      id: 'data-csv-dedupe', name: 'CSV Dedupe Rows', icon: '⧉▦', family: 'data',
      desc: 'Remove duplicate CSV rows, keeping the first of each', keywords: 'csv duplicate unique distinct',
      fields: [
        { id: 'csv', label: 'CSV', type: 'textarea', value: 'a,b\n1,2\n1,2\n3,4' },
        { id: 'header', label: 'First row is a header', type: 'checkbox', value: true },
        { id: 'loose', label: 'Ignore case and surrounding spaces', type: 'checkbox', value: false },
      ],
      run: (v) => {
        const t = csvWithHeader(v.csv, ',', v.header);
        const seen = new Set();
        const keep = t.body.filter(r => {
          const key = JSON.stringify(v.loose ? r.map(f => f.trim().toLowerCase()) : r);
          if (seen.has(key)) return false;
          seen.add(key); return true;
        });
        return withHeader(t, keep);
      },
      examples: [
        { in: { csv: 'a,b\n1,2\n1,2\n3,4\n1,2' }, out: 'a,b\n1,2\n3,4' },
        { in: { csv: 'x,Y\n X ,y\nx,z', header: false, loose: true }, out: 'x,Y\nx,z' },
      ],
    },
    {
      id: 'data-csv-sort', name: 'CSV Sort', icon: '↕▦', family: 'data',
      desc: 'Sort CSV rows by a column — numerically when the column is all numbers', keywords: 'csv sort order column',
      fields: [
        { id: 'csv', label: 'CSV', type: 'textarea', value: 'name,score\nAnn,9\nBo,10\nCy,2' },
        { id: 'col', label: 'Column (name or number)', type: 'text', value: 'score' },
        { id: 'order', label: 'Order', type: 'select', options: [['asc', 'Ascending'], ['desc', 'Descending']] },
        { id: 'header', label: 'First row is a header', type: 'checkbox', value: true },
      ],
      run: (v) => {
        const t = csvWithHeader(v.csv, ',', v.header);
        const c = columnIndex(t.header, v.col);
        const vals = t.body.map(r => (r[c] || '').trim()).filter(Boolean);
        const numeric = vals.length > 0 && vals.every(isNumeric);
        const dir = v.order === 'desc' ? -1 : 1;
        const rows = t.body.slice().sort((ra, rb) => {
          const a = (ra[c] || '').trim(), b = (rb[c] || '').trim();
          if (!a || !b) return !a && !b ? 0 : !a ? 1 : -1; // blanks last either way
          if (numeric) return (Number(a) - Number(b)) * dir;
          const x = a.toLowerCase(), y = b.toLowerCase();
          return (x < y ? -1 : x > y ? 1 : 0) * dir;
        });
        return withHeader(t, rows);
      },
      examples: [
        { in: { order: 'desc' }, out: 'name,score\nBo,10\nAnn,9\nCy,2' },
        { in: { csv: 'n\nbeta\n\nAlpha\ngamma', col: 'n' }, out: 'n\nAlpha\nbeta\ngamma' },
        { in: { csv: 'n,v\nx,\ny,3\nz,1', col: '2' }, out: 'n,v\nz,1\ny,3\nx,' },
      ],
    },
    {
      id: 'data-csv-stats', name: 'CSV Column Stats', icon: 'Σ▦', family: 'data',
      desc: 'Count, sum, mean, median, min and max for each numeric CSV column', keywords: 'csv statistics average sum summary',
      fields: [
        { id: 'csv', label: 'CSV', type: 'textarea', value: 'name,score\nAnn,9\nBo,10\nCy,2' },
        { id: 'header', label: 'First row is a header', type: 'checkbox', value: true },
      ],
      run: (v) => {
        const t = csvWithHeader(v.csv, ',', v.header);
        if (!t.body.length) fail('The CSV has no data rows');
        return t.header.map((h, c) => {
          const all = t.body.map(r => (r[c] || '').trim());
          const vals = all.filter(Boolean), empty = all.length - vals.length;
          if (!vals.length) return [h, 'empty'];
          if (!vals.every(isNumeric)) return [h, `text · ${vals.length} value(s) · ${new Set(vals).size} unique`];
          const n = vals.map(Number).sort((a, b) => a - b);
          const sum = n.reduce((a, b) => a + b, 0);
          const mid = n.length >> 1, median = n.length % 2 ? n[mid] : (n[mid - 1] + n[mid]) / 2;
          return [h, `count ${n.length} · sum ${fmt(sum)} · mean ${fmt(sum / n.length)} · median ${fmt(median)} · min ${fmt(n[0])} · max ${fmt(n[n.length - 1])}${empty ? ` · ${empty} empty` : ''}`];
        });
      },
      examples: [
        { in: { csv: 'name,score,age\nAnn,9,30\nBo,10,\nCy,2,41' },
          out: [['name', 'text · 3 value(s) · 3 unique'], ['score', 'count 3 · sum 21 · mean 7 · median 9 · min 2 · max 10'], ['age', 'count 2 · sum 71 · mean 35.5 · median 35.5 · min 30 · max 41 · 1 empty']] },
      ],
    },
    {
      id: 'data-csv-sql', name: 'CSV → SQL INSERT', icon: 'INS', family: 'data',
      desc: 'Generate an SQL INSERT statement from CSV with a header row', keywords: 'csv sql insert database import',
      fields: [
        { id: 'csv', label: 'CSV (first row = column names)', type: 'textarea', value: 'name,age\nAnn,30' },
        { id: 'table', label: 'Table name', type: 'text', value: 'users' },
        { id: 'numbers', label: 'Leave numbers unquoted', type: 'checkbox', value: true },
      ],
      run: (v) => {
        const t = csvWithHeader(v.csv, ',', true);
        if (!t.body.length) fail('The CSV has no data rows');
        const val = (s) => s === '' ? 'NULL' : v.numbers && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(s) ? s : `'${s.replace(/'/g, "''")}'`;
        return `INSERT INTO ${sqlIdent(need(v.table, 'a table name').trim())} (${t.header.map(sqlIdent).join(', ')}) VALUES\n` +
          t.body.map(r => `  (${r.map(val).join(', ')})`).join(',\n') + ';';
      },
      examples: [
        { in: { csv: 'name,age,first name\nAnn,30,A\nO\'Brien,,007' },
          out: 'INSERT INTO users (name, age, "first name") VALUES\n  (\'Ann\', 30, \'A\'),\n  (\'O\'\'Brien\', NULL, \'007\');' },
        { in: { csv: 'id\n5', table: 'app.items', numbers: false }, out: "INSERT INTO app.items (id) VALUES\n  ('5');" },
      ],
    },
    {
      id: 'data-xml-json', name: 'XML → JSON', icon: '<>→{}', family: 'data',
      desc: 'Convert well-formed XML to JSON (attributes as "@name", repeated tags as arrays)', keywords: 'xml json convert parse',
      fields: [{ id: 'xml', label: 'XML', type: 'textarea', value: '<note id="1"><to>Ann</to><body>Hi</body></note>' }],
      run: (v) => { const root = parseXml(v.xml); return JSON.stringify({ [root.name]: xmlToJson(root) }, null, 2); },
      examples: [
        { in: { xml: '<?xml version="1.0"?>\n<!DOCTYPE library>\n<library name="City">\n  <!-- c -->\n  <book id="1"><title>A &amp; B &#233;</title></book>\n  <book id="2"><title><![CDATA[<C>]]></title><tag/></book>\n  <note lang="en">hi</note>\n</library>' },
          out: '{\n  "library": {\n    "@name": "City",\n    "book": [\n      {\n        "@id": "1",\n        "title": "A & B é"\n      },\n      {\n        "@id": "2",\n        "title": "<C>",\n        "tag": ""\n      }\n    ],\n    "note": {\n      "@lang": "en",\n      "#text": "hi"\n    }\n  }\n}' },
      ],
    },
    {
      id: 'data-json-xml', name: 'JSON → XML', icon: '{}→<>', family: 'data',
      desc: 'Convert JSON to indented XML ("@name" keys become attributes, arrays repeat the tag)', keywords: 'json xml convert',
      fields: [
        { id: 'json', label: 'JSON', type: 'textarea', value: '{"note":{"@id":"1","to":"Ann","body":"Hi"}}' },
        { id: 'root', label: 'Root element (when JSON has no single top key)', type: 'text', value: 'root' },
      ],
      run: (v) => {
        const o = parseJson(v.json);
        const keys = isObj(o) ? Object.keys(o) : [];
        const xml = keys.length === 1 && !Array.isArray(o[keys[0]]) ? jsonToXml(keys[0], o[keys[0]], 0)
          : jsonToXml(need(v.root, 'a root element name').trim(), Array.isArray(o) ? { item: o } : o, 0);
        return '<?xml version="1.0" encoding="UTF-8"?>\n' + xml;
      },
      examples: [
        { in: { json: '{"library":{"@name":"City","book":[{"@id":"1","title":"A & B"},{"@id":"2","title":"<C>","draft":null}]}}' },
          out: '<?xml version="1.0" encoding="UTF-8"?>\n<library name="City">\n  <book id="1">\n    <title>A &amp; B</title>\n  </book>\n  <book id="2">\n    <title>&lt;C&gt;</title>\n    <draft/>\n  </book>\n</library>' },
        { in: { json: '[1,"two"]', root: 'list' }, out: '<?xml version="1.0" encoding="UTF-8"?>\n<list>\n  <item>1</item>\n  <item>two</item>\n</list>' },
      ],
    },
  ];

  // ---- web --------------------------------------------------------------------
  const thousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const attrEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function parseIpv6(s) {
    let t = s.trim().replace(/^\[(.*)\]$/, '$1');
    if (!t) fail('Enter an IPv6 address');
    if (t.includes('%')) fail('Zone IDs like %eth0 are not supported — remove them');
    let prefix = null;
    const pm = t.match(/\/(\d{1,3})$/);
    if (pm) { prefix = Number(pm[1]); if (prefix > 128) fail('An IPv6 prefix must be 0-128'); t = t.slice(0, pm.index); }
    const v4 = t.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (v4) { const n = ipv4(v4[1]); t = t.slice(0, t.length - v4[1].length) + (n >>> 16).toString(16) + ':' + (n & 0xffff).toString(16); }
    const halves = t.split('::');
    if (halves.length > 2) fail('"::" may appear only once in an IPv6 address');
    const part = (x) => (x ? x.split(':') : []);
    const head = part(halves[0]), tail = halves.length === 2 ? part(halves[1]) : [];
    for (const g of head.concat(tail)) if (!/^[0-9a-f]{1,4}$/i.test(g)) fail(`"${g}" is not a valid IPv6 group (1-4 hex digits)`);
    if (halves.length === 1 && head.length !== 8) fail('A full IPv6 address has 8 groups (or use :: to skip zeros)');
    if (halves.length === 2 && head.length + tail.length > 7) fail('Too many groups for an address with ::');
    const groups = halves.length === 1 ? head : [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail];
    return { groups: groups.map(g => parseInt(g, 16)), prefix };
  }
  function ipv6Compress(groups) {
    let best = -1, bestLen = 1;
    for (let i = 0; i < 8;) {
      if (groups[i] !== 0) { i++; continue; }
      let j = i;
      while (j < 8 && groups[j] === 0) j++;
      if (j - i > bestLen) { best = i; bestLen = j - i; }
      i = j;
    }
    const h = groups.map(g => g.toString(16));
    if (best < 0) return h.join(':');
    return h.slice(0, best).join(':') + '::' + h.slice(best + bestLen).join(':');
  }
  const IPV6_TYPES = [
    ['0000:0000:0000:0000:0000:0000:0000:0000', 128, 'Unspecified'], ['0000:0000:0000:0000:0000:0000:0000:0001', 128, 'Loopback'],
    ['0000:0000:0000:0000:0000:ffff:0000:0000', 96, 'IPv4-mapped'], ['2001:0db8:0000:0000:0000:0000:0000:0000', 32, 'Documentation'],
    ['fe80:0000:0000:0000:0000:0000:0000:0000', 10, 'Link-local'], ['fc00:0000:0000:0000:0000:0000:0000:0000', 7, 'Unique local (private)'],
    ['ff00:0000:0000:0000:0000:0000:0000:0000', 8, 'Multicast'], ['2000:0000:0000:0000:0000:0000:0000:0000', 3, 'Global unicast'],
  ];
  const v6big = (groups) => groups.reduce((acc, g) => (acc << 16n) | BigInt(g), 0n);
  const v6mask = (p) => (p === 0 ? 0n : ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - p)) - 1n));

  const TRACKING = /^(utm_[a-z_]+|fbclid|gclid|gclsrc|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|_ga|_gl|igshid|yclid|twclid|ttclid|li_fat_id|s_cid|ref_src|mkt_tok|oly_anon_id|oly_enc_id|_hsenc|_hsmi|vero_id|wickedid|rb_clickid|srsltid)$/i;

  const CSP_DIRECTIVES = {
    'default-src': 'Fallback for any fetch directive not listed', 'script-src': 'Where scripts may load from',
    'script-src-elem': 'Where <script> elements may load from', 'script-src-attr': 'Inline event handlers (onclick=…)',
    'style-src': 'Where stylesheets may load from', 'style-src-elem': 'Where <style>/<link> styles may load from',
    'style-src-attr': 'Inline style="…" attributes', 'img-src': 'Where images may load from', 'font-src': 'Where fonts may load from',
    'connect-src': 'fetch, XHR, WebSocket and EventSource targets', 'media-src': 'Where audio and video may load from',
    'object-src': 'Plugins: <object> and <embed>', 'frame-src': 'Where iframes may load from', 'child-src': 'Frames and workers (legacy fallback)',
    'worker-src': 'Where workers may load from', 'manifest-src': 'Where the web app manifest may load from',
    'base-uri': 'Allowed <base href> values', 'form-action': 'Where forms may submit to', 'frame-ancestors': 'Who may embed this page in a frame',
    'upgrade-insecure-requests': 'Rewrite http:// requests to https://', 'block-all-mixed-content': 'Block mixed content (deprecated)',
    'sandbox': 'Apply iframe-style sandbox restrictions', 'report-uri': 'Where to send violation reports (deprecated — use report-to)',
    'report-to': 'Reporting API group for violation reports', 'require-trusted-types-for': 'Require Trusted Types for DOM sinks',
    'trusted-types': 'Allowed Trusted Types policy names',
  };

  const WEB = [
    {
      id: 'web-subnet', name: 'IPv4 Subnet Calculator', icon: '/24', family: 'web',
      desc: 'Network, broadcast, host range, mask and host count from CIDR (192.168.1.10/24)', keywords: 'cidr subnet netmask network ip range',
      fields: [{ id: 'cidr', label: 'Address/prefix or address + mask', type: 'text', value: '192.168.1.10/24' }],
      run: (v) => {
        const t = need(v.cidr, 'an address like 192.168.1.10/24').trim();
        let m, ip, p;
        if ((m = t.match(/^(\S+)\s*\/\s*(\d{1,2})$/))) { ip = ipv4(m[1]); p = Number(m[2]); if (p > 32) fail('The prefix must be 0-32'); }
        else if ((m = t.match(/^(\S+)\s+(\S+)$/))) {
          ip = ipv4(m[1]);
          const mask = ipv4(m[2]);
          p = mask.toString(2).replace(/0+$/, '').length;
          if (mask !== maskOf(p)) fail(`${m[2]} is not a valid netmask (the 1 bits must be contiguous)`);
        } else fail('Enter an address with a prefix (10.0.0.1/8) or a mask (10.0.0.1 255.0.0.0)');
        const mask = maskOf(p), net = (ip & mask) >>> 0, bc = (net | ~mask) >>> 0, total = 2 ** (32 - p);
        const rows = [['Address', ipStr(ip)], ['Network', `${ipStr(net)}/${p}`], ['Netmask', ipStr(mask)], ['Wildcard', ipStr(~mask >>> 0)]];
        if (p === 32) rows.push(['Broadcast', 'none (single host)'], ['First host', ipStr(ip)], ['Last host', ipStr(ip)], ['Usable hosts', '1']);
        else if (p === 31) rows.push(['Broadcast', 'none (point-to-point link, RFC 3021)'], ['First host', ipStr(net)], ['Last host', ipStr(bc)], ['Usable hosts', '2']);
        else rows.push(['Broadcast', ipStr(bc)], ['First host', ipStr(net + 1)], ['Last host', ipStr(bc - 1)], ['Usable hosts', thousands(total - 2)]);
        rows.push(['Total addresses', thousands(total)], ['Type', ipv4Kind(ip)]);
        return rows;
      },
      examples: [
        { in: {}, out: [['Address', '192.168.1.10'], ['Network', '192.168.1.0/24'], ['Netmask', '255.255.255.0'], ['Wildcard', '0.0.0.255'], ['Broadcast', '192.168.1.255'], ['First host', '192.168.1.1'], ['Last host', '192.168.1.254'], ['Usable hosts', '254'], ['Total addresses', '256'], ['Type', 'Private (RFC 1918)']] },
        { in: { cidr: '172.16.5.4 255.255.240.0' }, out: [['Address', '172.16.5.4'], ['Network', '172.16.0.0/20'], ['Netmask', '255.255.240.0'], ['Wildcard', '0.0.15.255'], ['Broadcast', '172.16.15.255'], ['First host', '172.16.0.1'], ['Last host', '172.16.15.254'], ['Usable hosts', '4,094'], ['Total addresses', '4,096'], ['Type', 'Private (RFC 1918)']] },
        { in: { cidr: '10.0.0.5/31' }, out: [['Address', '10.0.0.5'], ['Network', '10.0.0.4/31'], ['Netmask', '255.255.255.254'], ['Wildcard', '0.0.0.1'], ['Broadcast', 'none (point-to-point link, RFC 3021)'], ['First host', '10.0.0.4'], ['Last host', '10.0.0.5'], ['Usable hosts', '2'], ['Total addresses', '2'], ['Type', 'Private (RFC 1918)']] },
        { in: { cidr: '8.8.8.8/32' }, out: [['Address', '8.8.8.8'], ['Network', '8.8.8.8/32'], ['Netmask', '255.255.255.255'], ['Wildcard', '0.0.0.0'], ['Broadcast', 'none (single host)'], ['First host', '8.8.8.8'], ['Last host', '8.8.8.8'], ['Usable hosts', '1'], ['Total addresses', '1'], ['Type', 'Public']] },
      ],
    },
    {
      id: 'web-ipv4-int', name: 'IPv4 ⇄ Integer', icon: 'IP#', family: 'web',
      desc: 'Convert an IPv4 address to its 32-bit integer, hex and binary forms, or back', keywords: 'ip address integer decimal long hex',
      fields: [{ id: 'ip', label: 'IPv4 address or integer', type: 'text', value: '192.168.1.1' }],
      run: (v) => {
        const t = need(v.ip, 'an address or integer').trim();
        let n;
        if (t.includes('.')) n = ipv4(t);
        else {
          if (!/^(0x[0-9a-f]+|\d+)$/i.test(t)) fail('Enter a dotted address (10.0.0.1) or an integer (167772161 or 0x0A000001)');
          n = Number(t);
          if (n > 0xffffffff) fail('An IPv4 integer must be 0-4294967295');
        }
        return [['Dotted', ipStr(n)], ['Integer', String(n)], ['Hex', '0x' + n.toString(16).toUpperCase().padStart(8, '0')],
          ['Binary', [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].map(b => b.toString(2).padStart(8, '0')).join('.')]];
      },
      examples: [
        { in: {}, out: [['Dotted', '192.168.1.1'], ['Integer', '3232235777'], ['Hex', '0xC0A80101'], ['Binary', '11000000.10101000.00000001.00000001']] },
        { in: { ip: '0x0A000001' }, out: [['Dotted', '10.0.0.1'], ['Integer', '167772161'], ['Hex', '0x0A000001'], ['Binary', '00001010.00000000.00000000.00000001']] },
      ],
    },
    {
      id: 'web-ipv6', name: 'IPv6 Expand / Compress', icon: 'v6', family: 'web',
      desc: 'Expand an IPv6 address to 8 full groups, compress it per RFC 5952, and classify it', keywords: 'ipv6 address expand compress shorten',
      fields: [{ id: 'ip', label: 'IPv6 address (optional /prefix)', type: 'text', value: '2001:db8::1' }],
      run: (v) => {
        const { groups, prefix } = parseIpv6(v.ip);
        const expanded = groups.map(g => g.toString(16).padStart(4, '0')).join(':');
        const big = v6big(groups);
        const hit = IPV6_TYPES.find(([base, p]) => (big & v6mask(p)) === v6big(parseIpv6(base).groups));
        let type = hit ? hit[2] : 'Reserved / other';
        if (type === 'IPv4-mapped') type += ` (${ipStr(((groups[6] << 16) | groups[7]) >>> 0)})`;
        const rows = [['Expanded', expanded], ['Compressed', ipv6Compress(groups)], ['Type', type]];
        if (prefix !== null) {
          const net = big & v6mask(prefix);
          const ng = [];
          for (let i = 7; i >= 0; i--) ng.push(Number((net >> BigInt(16 * i)) & 0xffffn));
          rows.push(['Network', `${ipv6Compress(ng)}/${prefix}`]);
        }
        rows.push(['Reverse DNS', expanded.replace(/:/g, '').split('').reverse().join('.') + '.ip6.arpa']);
        return rows;
      },
      examples: [
        { in: {}, out: [['Expanded', '2001:0db8:0000:0000:0000:0000:0000:0001'], ['Compressed', '2001:db8::1'], ['Type', 'Documentation'], ['Reverse DNS', '1.' + '0.'.repeat(23) + '8.b.d.0.1.0.0.2.ip6.arpa']] },
        { in: { ip: '2001:0DB8:0000:0000:0001:0000:0000:0001' }, out: [['Expanded', '2001:0db8:0000:0000:0001:0000:0000:0001'], ['Compressed', '2001:db8::1:0:0:1'], ['Type', 'Documentation'], ['Reverse DNS', '1.0.0.0.0.0.0.0.0.0.0.0.1.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa']] },
        { in: { ip: '::ffff:192.0.2.128' }, out: [['Expanded', '0000:0000:0000:0000:0000:ffff:c000:0280'], ['Compressed', '::ffff:c000:280'], ['Type', 'IPv4-mapped (192.0.2.128)'], ['Reverse DNS', '0.8.2.0.0.0.0.c.f.f.f.f.' + '0.'.repeat(20) + 'ip6.arpa']] },
        { in: { ip: 'fe80::1:0:0:0:1/64' }, out: [['Expanded', 'fe80:0000:0000:0001:0000:0000:0000:0001'], ['Compressed', 'fe80:0:0:1::1'], ['Type', 'Link-local'], ['Network', 'fe80:0:0:1::/64'], ['Reverse DNS', '1.' + '0.'.repeat(15) + '1.' + '0.'.repeat(11) + '0.8.e.f.ip6.arpa']] },
      ],
    },
    {
      id: 'web-mac', name: 'MAC Address Formatter', icon: 'MAC', family: 'web',
      desc: 'Reformat a MAC address (colon, hyphen, Cisco dot, bare) and read its flag bits', keywords: 'mac address ethernet hardware oui',
      fields: [{ id: 'mac', label: 'MAC address', type: 'text', value: '00-1a-2b-3c-4d-5e' }],
      run: (v) => {
        const h = need(v.mac, 'a MAC address').replace(/[\s:.-]/g, '').toUpperCase();
        if (!/^[0-9A-F]{12}$/.test(h)) fail('A MAC address has 12 hex digits (e.g. 00:1A:2B:3C:4D:5E)');
        const pairs = h.match(/../g), first = parseInt(pairs[0], 16);
        const local = (first & 2) !== 0;
        return [['Colon', pairs.join(':')], ['Hyphen', pairs.join('-')], ['Cisco dot', h.toLowerCase().match(/..../g).join('.')], ['Bare', h],
          ['Cast', h === 'FFFFFFFFFFFF' ? 'Broadcast' : first & 1 ? 'Multicast' : 'Unicast'],
          ['Administration', local ? 'Locally administered (randomised or assigned by software)' : `Universally administered (OUI ${pairs.slice(0, 3).join(':')})`]];
      },
      examples: [
        { in: {}, out: [['Colon', '00:1A:2B:3C:4D:5E'], ['Hyphen', '00-1A-2B-3C-4D-5E'], ['Cisco dot', '001a.2b3c.4d5e'], ['Bare', '001A2B3C4D5E'], ['Cast', 'Unicast'], ['Administration', 'Universally administered (OUI 00:1A:2B)']] },
        { in: { mac: '0200.0000.0001' }, out: [['Colon', '02:00:00:00:00:01'], ['Hyphen', '02-00-00-00-00-01'], ['Cisco dot', '0200.0000.0001'], ['Bare', '020000000001'], ['Cast', 'Unicast'], ['Administration', 'Locally administered (randomised or assigned by software)']] },
      ],
    },
    {
      id: 'web-meta-tags', name: 'Meta Tag Generator', icon: '<meta>', family: 'web',
      desc: 'Build title, description, canonical, Open Graph and Twitter card tags', keywords: 'seo meta og open graph twitter card social',
      fields: [
        { id: 'title', label: 'Title', type: 'text', value: 'Vex Browser' },
        { id: 'desc', label: 'Description', type: 'textarea', value: 'A fast, private browser.' },
        { id: 'url', label: 'Page URL', type: 'text', value: '' },
        { id: 'image', label: 'Image URL', type: 'text', value: '' },
        { id: 'site', label: 'Site name', type: 'text', value: '' },
        { id: 'card', label: 'Twitter card', type: 'select', options: [['summary_large_image', 'Large image'], ['summary', 'Summary']] },
      ],
      run: (v) => {
        const title = need(v.title, 'a title').trim(), d = v.desc.trim(), url = v.url.trim(), img = v.image.trim(), site = v.site.trim();
        for (const [label, u] of [['Page URL', url], ['Image URL', img]]) if (u && !/^https?:\/\/\S+$/.test(u)) fail(`${label} must be an absolute http(s) URL`);
        const L = [`<title>${xmlEsc(title)}</title>`];
        const meta = (attr, k, val) => { if (val) L.push(`<meta ${attr}="${k}" content="${attrEsc(val)}">`); };
        meta('name', 'description', d);
        if (url) L.push(`<link rel="canonical" href="${attrEsc(url)}">`);
        meta('property', 'og:type', 'website'); meta('property', 'og:title', title); meta('property', 'og:description', d);
        meta('property', 'og:url', url); meta('property', 'og:image', img); meta('property', 'og:site_name', site);
        meta('name', 'twitter:card', v.card); meta('name', 'twitter:title', title); meta('name', 'twitter:description', d); meta('name', 'twitter:image', img);
        return L.join('\n');
      },
      examples: [
        { in: { title: 'Tom & Jerry "Live"', desc: 'Cat <vs> mouse', url: 'https://ex.com/tj', image: 'https://ex.com/tj.png', site: 'Ex' },
          out: '<title>Tom &amp; Jerry "Live"</title>\n<meta name="description" content="Cat &lt;vs&gt; mouse">\n<link rel="canonical" href="https://ex.com/tj">\n' +
            '<meta property="og:type" content="website">\n<meta property="og:title" content="Tom &amp; Jerry &quot;Live&quot;">\n<meta property="og:description" content="Cat &lt;vs&gt; mouse">\n' +
            '<meta property="og:url" content="https://ex.com/tj">\n<meta property="og:image" content="https://ex.com/tj.png">\n<meta property="og:site_name" content="Ex">\n' +
            '<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="Tom &amp; Jerry &quot;Live&quot;">\n' +
            '<meta name="twitter:description" content="Cat &lt;vs&gt; mouse">\n<meta name="twitter:image" content="https://ex.com/tj.png">' },
        { in: { title: 'Hi', desc: '', card: 'summary' }, out: '<title>Hi</title>\n<meta property="og:type" content="website">\n<meta property="og:title" content="Hi">\n<meta name="twitter:card" content="summary">\n<meta name="twitter:title" content="Hi">' },
      ],
    },
    {
      id: 'web-robots', name: 'robots.txt Builder', icon: '🤖', family: 'web',
      desc: 'Write a robots.txt with Disallow/Allow rules, crawl delay and sitemap', keywords: 'robots txt seo crawler sitemap',
      fields: [
        { id: 'agent', label: 'User-agent', type: 'text', value: '*' },
        { id: 'disallow', label: 'Disallow paths (one per line)', type: 'textarea', value: '/admin/\n/tmp/' },
        { id: 'allow', label: 'Allow paths (one per line)', type: 'textarea', value: '' },
        { id: 'delay', label: 'Crawl-delay seconds (optional)', type: 'number', value: '' },
        { id: 'sitemap', label: 'Sitemap URL (optional)', type: 'text', value: '' },
      ],
      run: (v) => {
        const paths = (s, label) => s.split(/\r?\n/).map(x => x.trim()).filter(Boolean).map(p => { if (!/^[/*]/.test(p)) fail(`${label} path "${p}" must start with / or *`); return p; });
        const dis = paths(v.disallow, 'Disallow'), al = paths(v.allow, 'Allow');
        const L = [`User-agent: ${v.agent.trim() || '*'}`];
        if (!dis.length && !al.length) L.push('Disallow:');
        dis.forEach(p => L.push(`Disallow: ${p}`));
        al.forEach(p => L.push(`Allow: ${p}`));
        if (!Number.isNaN(v.delay)) L.push(`Crawl-delay: ${num(v.delay, 'Crawl-delay', { min: 0, max: 86400 })}`);
        const sm = v.sitemap.trim();
        if (sm) { if (!/^https?:\/\/\S+$/.test(sm)) fail('The sitemap must be an absolute http(s) URL'); L.push('', `Sitemap: ${sm}`); }
        return L.join('\n');
      },
      examples: [
        { in: { allow: '/admin/public/', delay: 10, sitemap: 'https://example.com/sitemap.xml' }, out: 'User-agent: *\nDisallow: /admin/\nDisallow: /tmp/\nAllow: /admin/public/\nCrawl-delay: 10\n\nSitemap: https://example.com/sitemap.xml' },
        { in: { agent: 'GPTBot', disallow: '' }, out: 'User-agent: GPTBot\nDisallow:' },
      ],
    },
    {
      id: 'web-utm', name: 'UTM Link Builder', icon: 'utm', family: 'web',
      desc: 'Add utm_source / medium / campaign / term / content to a URL', keywords: 'utm campaign tracking analytics link',
      fields: [
        { id: 'url', label: 'Page URL', type: 'text', value: 'https://example.com/page' },
        { id: 'source', label: 'Source (required, e.g. newsletter)', type: 'text', value: 'newsletter' },
        { id: 'medium', label: 'Medium (e.g. email)', type: 'text', value: 'email' },
        { id: 'campaign', label: 'Campaign', type: 'text', value: '' },
        { id: 'term', label: 'Term (paid keywords)', type: 'text', value: '' },
        { id: 'content', label: 'Content (A/B variant)', type: 'text', value: '' },
      ],
      run: (v) => {
        let u;
        try { u = new URL(need(v.url, 'a page URL').trim()); } catch { fail('The page URL must be absolute, e.g. https://example.com/page'); }
        need(v.source, 'a source (utm_source)');
        for (const k of ['source', 'medium', 'campaign', 'term', 'content']) {
          if (v[k].trim()) u.searchParams.set('utm_' + k, v[k].trim()); else u.searchParams.delete('utm_' + k);
        }
        return u.href;
      },
      examples: [
        { in: { url: 'https://example.com/page?x=1#top', campaign: 'spring sale' }, out: 'https://example.com/page?x=1&utm_source=newsletter&utm_medium=email&utm_campaign=spring+sale#top' },
      ],
    },
    {
      id: 'web-strip-tracking', name: 'Tracking Parameter Remover', icon: '✂?', family: 'web',
      desc: 'Strip utm_*, fbclid, gclid and other tracking parameters from URLs (one per line)', keywords: 'clean url tracking utm fbclid gclid privacy',
      fields: [{ id: 'urls', label: 'URLs', type: 'textarea', value: 'https://shop.example/item?id=42&utm_source=x&fbclid=abc#reviews' }],
      run: (v) => need(v.urls, 'one or more URLs').split(/\r?\n/).map((line, i) => {
        const t = line.trim();
        if (!t) return '';
        try { new URL(t); } catch { fail(`Line ${i + 1} is not a valid absolute URL`); }
        const m = t.match(/^([^?#]*)(?:\?([^#]*))?(#.*)?$/);
        // Tracking parameter names are plain ASCII, so the raw key is compared as written.
        const keep = (m[2] || '').split('&').filter(p => p && !TRACKING.test(p.split('=')[0]));
        return m[1] + (keep.length ? '?' + keep.join('&') : '') + (m[3] || '');
      }).join('\n'),
      examples: [
        { in: { urls: 'https://shop.example/item?id=42&utm_source=x&UTM_Medium=y&fbclid=abc&color=red%20blue#reviews\nhttps://ex.com/?gclid=1&_ga=2\n\nhttps://ex.com/a' },
          out: 'https://shop.example/item?id=42&color=red%20blue#reviews\nhttps://ex.com/\n\nhttps://ex.com/a' },
      ],
    },
    {
      id: 'web-email-check', name: 'Email Address Checker', icon: '@', family: 'web',
      desc: 'Check an email address\'s format and explain what is wrong with it', keywords: 'email validate address format',
      fields: [{ id: 'email', label: 'Email address', type: 'text', value: 'john.doe+news@example.co.uk' }],
      run: (v) => {
        const e = need(v.email, 'an email address').trim();
        if ((e.match(/@/g) || []).length !== 1) return [['Valid', 'No'], ['Local part', '—'], ['Domain', '—'], ['Notes', 'Needs exactly one @']];
        const at = e.indexOf('@'), local = e.slice(0, at), domain = e.slice(at + 1), p = [];
        if (!local) p.push('Nothing before the @');
        else {
          if (local.length > 64) p.push('The part before @ is longer than 64 characters');
          if (!/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local)) p.push('The part before @ has characters that are not allowed unquoted (spaces, commas, brackets…)');
          if (/^\.|\.$/.test(local)) p.push('The part before @ cannot start or end with a dot');
          if (local.includes('..')) p.push('The part before @ cannot contain two dots in a row');
        }
        if (e.length > 254) p.push('The address is longer than 254 characters');
        if (!domain) p.push('Nothing after the @');
        else if (/[^\x00-\x7f]/.test(domain)) p.push('International domains are not checked here — use the punycode (xn--) form');
        else {
          const labels = domain.split('.');
          if (labels.length < 2) p.push('The domain needs a dot (e.g. example.com)');
          for (const l of labels) if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(l)) p.push(l ? `Domain part "${l}" is not valid` : 'The domain has an empty part (two dots in a row, or a leading/trailing dot)');
          const tld = labels[labels.length - 1];
          if (labels.length >= 2 && tld && /^[A-Za-z0-9-]+$/.test(tld) && !/^([A-Za-z]{2,63}|xn--[A-Za-z0-9-]+)$/.test(tld)) p.push('The top-level domain must be at least two letters (e.g. .com)');
        }
        return [['Valid', p.length ? 'No' : 'Yes'], ['Local part', local || '—'], ['Domain', domain || '—'],
          ['Notes', p.length ? p.join('; ') : 'Format is valid — this cannot tell whether the mailbox exists']];
      },
      examples: [
        { in: {}, out: [['Valid', 'Yes'], ['Local part', 'john.doe+news'], ['Domain', 'example.co.uk'], ['Notes', 'Format is valid — this cannot tell whether the mailbox exists']] },
        { in: { email: 'Bob@@example.com' }, out: [['Valid', 'No'], ['Local part', '—'], ['Domain', '—'], ['Notes', 'Needs exactly one @']] },
        { in: { email: '.bob..x@exa_mple.c' }, out: [['Valid', 'No'], ['Local part', '.bob..x'], ['Domain', 'exa_mple.c'], ['Notes', 'The part before @ cannot start or end with a dot; The part before @ cannot contain two dots in a row; Domain part "exa_mple" is not valid; The top-level domain must be at least two letters (e.g. .com)']] },
      ],
    },
    {
      id: 'web-phone-e164', name: 'Phone → E.164', icon: '☎', family: 'web',
      desc: 'Normalise a phone number to international E.164 format (+15551234567)', keywords: 'phone number e164 international format tel',
      fields: [
        { id: 'cc', label: 'Country calling code (e.g. 1, 44, 49)', type: 'text', value: '44' },
        { id: 'number', label: 'Phone number', type: 'text', value: '020 7946 0018' },
      ],
      run: (v) => {
        const raw = need(v.number, 'a phone number').trim();
        if (/[A-Za-z]/.test(raw)) fail('Letters are not supported — type the number as digits');
        if (/[^\d\s()+./-]/.test(raw)) fail('Phone numbers may only contain digits, spaces and + ( ) - . /');
        let digits = raw.replace(/\D/g, ''), cc = v.cc.replace(/\D/g, ''), national;
        if (/^\+/.test(raw) || /^00/.test(digits)) {
          if (!/^\+/.test(raw)) digits = digits.slice(2);
          national = cc && digits.startsWith(cc) ? digits.slice(cc.length) : null;
          if (national === null) cc = '';
        } else {
          if (!cc) fail('Enter the country calling code, or start the number with +');
          if (cc.length > 3) fail('Country calling codes are 1-3 digits');
          national = digits;
          if (cc === '1' && national.length === 11 && national[0] === '1') national = national.slice(1);
          else if (cc !== '39' && national[0] === '0') national = national.slice(1); // trunk prefix (Italy keeps its 0)
          digits = cc + national;
        }
        if (digits.length > 15) fail(`E.164 numbers have at most 15 digits; this has ${digits.length}`);
        if (digits.length < 8) fail('That is too short to be a full international number');
        const rows = [['E.164', '+' + digits], ['tel: link', 'tel:+' + digits]];
        if (cc && national !== null) rows.push(['Country code', '+' + cc], ['National number', national]);
        rows.push(['Digits', `${digits.length} of 15 max`]);
        return rows;
      },
      examples: [
        { in: {}, out: [['E.164', '+442079460018'], ['tel: link', 'tel:+442079460018'], ['Country code', '+44'], ['National number', '2079460018'], ['Digits', '12 of 15 max']] },
        { in: { cc: '1', number: '1 (415) 555-0132' }, out: [['E.164', '+14155550132'], ['tel: link', 'tel:+14155550132'], ['Country code', '+1'], ['National number', '4155550132'], ['Digits', '11 of 15 max']] },
        { in: { cc: '', number: '+49 30 901820' }, out: [['E.164', '+4930901820'], ['tel: link', 'tel:+4930901820'], ['Digits', '10 of 15 max']] },
        { in: { cc: '39', number: '06 1234 5678' }, out: [['E.164', '+390612345678'], ['tel: link', 'tel:+390612345678'], ['Country code', '+39'], ['National number', '0612345678'], ['Digits', '12 of 15 max']] },
      ],
    },
    {
      id: 'web-http-headers', name: 'HTTP Header Parser', icon: 'H:', family: 'web',
      desc: 'Split raw HTTP headers into a table, merging repeats (Set-Cookie kept separate)', keywords: 'http headers request response parse',
      fields: [{ id: 'raw', label: 'Raw headers', type: 'textarea', value: 'HTTP/1.1 200 OK\nContent-Type: text/html\nCache-Control: no-cache' }],
      run: (v) => {
        const lines = need(v.raw, 'some headers').replace(/\r\n/g, '\n').split('\n');
        const rows = [];
        let start = 0;
        while (start < lines.length && !lines[start].trim()) start++;
        const first = (lines[start] || '').trim();
        if (/^HTTP\/[\d.]+ \d{3}\b/.test(first)) { rows.push(['Status line', first]); start++; }
        else if (/^[A-Z]+ \S+ HTTP\/[\d.]+$/.test(first)) { rows.push(['Request line', first]); start++; }
        const index = {};
        let last = -1;
        for (let i = start; i < lines.length; i++) {
          const line = lines[i];
          if (!line.trim()) break; // blank line: the body starts
          if (/^[ \t]/.test(line)) {
            if (last < 0) fail(`Line ${i + 1}: continuation line with no header before it`);
            rows[last][1] += ' ' + line.trim();
            continue;
          }
          const c = line.indexOf(':');
          if (c < 1) fail(`Line ${i + 1}: expected "Name: value"`);
          const name = line.slice(0, c).trim(), val = line.slice(c + 1).trim();
          if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) fail(`Line ${i + 1}: "${name}" is not a valid header name`);
          const key = name.toLowerCase();
          if (key !== 'set-cookie' && index[key] !== undefined) { rows[index[key]][1] += ', ' + val; last = index[key]; }
          else { index[key] = last = rows.length; rows.push([name, val]); }
        }
        if (!rows.length) fail('No headers found');
        return rows;
      },
      examples: [
        { in: { raw: 'HTTP/2 200\ncontent-type: text/html; charset=utf-8\nCache-Control: no-cache\ncache-control: no-store\nX-Long: part one\n  part two\nSet-Cookie: a=1\nSet-Cookie: b=2\n\n<html>' },
          out: [['Status line', 'HTTP/2 200'], ['content-type', 'text/html; charset=utf-8'], ['Cache-Control', 'no-cache, no-store'], ['X-Long', 'part one part two'], ['Set-Cookie', 'a=1'], ['Set-Cookie', 'b=2']] },
        { in: { raw: 'GET /index.html HTTP/1.1\nHost: example.com' }, out: [['Request line', 'GET /index.html HTTP/1.1'], ['Host', 'example.com']] },
      ],
    },
    {
      id: 'web-cookie', name: 'Cookie Parser', icon: '🍪', family: 'web',
      desc: 'Read a Cookie header (name=value pairs) or a Set-Cookie header with its attributes', keywords: 'cookie set-cookie samesite httponly parse',
      fields: [
        { id: 'mode', label: 'Header type', type: 'select', options: [['cookie', 'Cookie (request)'], ['set', 'Set-Cookie (response)']] },
        { id: 'text', label: 'Header value', type: 'textarea', value: 'session=abc123; theme=dark' },
      ],
      run: (v) => {
        const t = need(v.text, 'a cookie header').trim().replace(/^(set-)?cookie:\s*/i, '');
        const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
        const pair = (p) => { const e = p.indexOf('='); if (e < 1) fail(`"${p.trim()}" is not name=value`); return [p.slice(0, e).trim(), p.slice(e + 1).trim().replace(/^"(.*)"$/, '$1')]; };
        if (v.mode === 'cookie') return t.split(';').filter(p => p.trim()).map(p => { const [k, x] = pair(p); return [k, dec(x)]; });
        const parts = t.split(';');
        const [name, value] = pair(parts[0]);
        const rows = [['Name', name], ['Value', dec(value)]];
        const attrs = {};
        for (const raw of parts.slice(1)) {
          const p = raw.trim();
          if (!p) continue;
          const e = p.indexOf('=');
          const k = (e < 0 ? p : p.slice(0, e)).trim(), val = e < 0 ? '' : p.slice(e + 1).trim();
          const key = k.toLowerCase();
          attrs[key] = val;
          if (key === 'secure') rows.push(['Secure', 'yes (sent over HTTPS only)']);
          else if (key === 'httponly') rows.push(['HttpOnly', 'yes (hidden from JavaScript)']);
          else if (key === 'partitioned') rows.push(['Partitioned', 'yes (separate jar per top-level site)']);
          else if (key === 'max-age') { if (!/^-?\d+$/.test(val)) fail('Max-Age must be a whole number of seconds'); rows.push(['Max-Age', `${val} s (takes precedence over Expires)`]); }
          else rows.push([{ expires: 'Expires', domain: 'Domain', path: 'Path', samesite: 'SameSite', priority: 'Priority' }[key] || k, val || 'yes']);
        }
        const warn = [];
        if ((attrs.samesite || '').toLowerCase() === 'none' && !('secure' in attrs)) warn.push('SameSite=None requires Secure — browsers will reject this cookie');
        if (/^__Host-/.test(name) && (!('secure' in attrs) || 'domain' in attrs || attrs.path !== '/')) warn.push('__Host- cookies need Secure, Path=/ and no Domain');
        if (/^__Secure-/.test(name) && !('secure' in attrs)) warn.push('__Secure- cookies need Secure');
        if (warn.length) rows.push(['Warning', warn.join('; ')]);
        return rows;
      },
      examples: [
        { in: { mode: 'cookie', text: 'Cookie: session=abc123; theme=dark; name=J%C3%B6rg; q="quoted"' }, out: [['session', 'abc123'], ['theme', 'dark'], ['name', 'Jörg'], ['q', 'quoted']] },
        { in: { mode: 'set', text: 'Set-Cookie: id=a3fWa; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Max-Age=3600; Path=/; Secure; HttpOnly; SameSite=Lax' },
          out: [['Name', 'id'], ['Value', 'a3fWa'], ['Expires', 'Wed, 21 Oct 2026 07:28:00 GMT'], ['Max-Age', '3600 s (takes precedence over Expires)'], ['Path', '/'], ['Secure', 'yes (sent over HTTPS only)'], ['HttpOnly', 'yes (hidden from JavaScript)'], ['SameSite', 'Lax']] },
        { in: { mode: 'set', text: '__Host-sid=1; SameSite=None; Path=/app' }, out: [['Name', '__Host-sid'], ['Value', '1'], ['SameSite', 'None'], ['Path', '/app'], ['Warning', 'SameSite=None requires Secure — browsers will reject this cookie; __Host- cookies need Secure, Path=/ and no Domain']] },
      ],
    },
    {
      id: 'web-csp', name: 'CSP Explainer', icon: 'CSP', family: 'web',
      desc: 'Break a Content-Security-Policy into directives, explain each, and flag risky settings', keywords: 'content security policy csp header xss',
      fields: [{ id: 'csp', label: 'Policy', type: 'textarea', value: "default-src 'self'; script-src 'self' 'unsafe-inline'" }],
      run: (v) => {
        const t = need(v.csp, 'a policy').trim().replace(/^content-security-policy(-report-only)?:\s*/i, '');
        const rows = [], seen = {}, warn = [];
        for (const part of t.split(';')) {
          const tokens = part.trim().split(/\s+/).filter(Boolean);
          if (!tokens.length) continue;
          const name = tokens[0].toLowerCase(), srcs = tokens.slice(1);
          if (seen[name]) { warn.push(`${name} appears twice — browsers ignore the second one`); continue; }
          seen[name] = srcs;
          const meaning = CSP_DIRECTIVES[name] || 'Unknown directive (browsers ignore it)';
          rows.push([name, srcs.length ? `${srcs.join(' ')} — ${meaning}` : meaning]);
        }
        if (!rows.length) fail('No directives found');
        const script = seen['script-src'] || seen['default-src'];
        const which = seen['script-src'] ? 'script-src' : 'default-src';
        if (!script) warn.push('No script-src or default-src — scripts may load from anywhere');
        else {
          const hasNonce = script.some(s => /^'(nonce|sha256|sha384|sha512)-/.test(s));
          if (script.includes("'unsafe-inline'") && !hasNonce) warn.push(`${which} allows 'unsafe-inline' — injected inline scripts can run`);
          if (script.includes("'unsafe-eval'")) warn.push(`${which} allows 'unsafe-eval' — eval() and new Function() are permitted`);
          const wild = script.filter(s => s === '*' || s === 'https:' || s === 'http:' || s === 'data:');
          if (wild.length) warn.push(`${which} allows ${wild.join(' ')} — scripts from almost anywhere`);
        }
        if (!seen['object-src'] && !seen['default-src']) warn.push("No object-src — set object-src 'none' to block plugins");
        if (!seen['base-uri']) warn.push('No base-uri — an injected <base> tag can redirect relative URLs');
        rows.push(['Warnings', warn.length ? warn.join('; ') : 'None found']);
        return rows;
      },
      examples: [
        { in: { csp: "Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.example.com; object-src 'none'; img-src * data:; upgrade-insecure-requests" },
          out: [['default-src', "'self' — Fallback for any fetch directive not listed"], ['script-src', "'self' 'unsafe-inline' https://cdn.example.com — Where scripts may load from"],
            ['object-src', "'none' — Plugins: <object> and <embed>"], ['img-src', '* data: — Where images may load from'], ['upgrade-insecure-requests', 'Rewrite http:// requests to https://'],
            ['Warnings', "script-src allows 'unsafe-inline' — injected inline scripts can run; No base-uri — an injected <base> tag can redirect relative URLs"]] },
        { in: { csp: "default-src 'none'; script-src 'nonce-abc' 'unsafe-inline'; base-uri 'self'" },
          out: [['default-src', "'none' — Fallback for any fetch directive not listed"], ['script-src', "'nonce-abc' 'unsafe-inline' — Where scripts may load from"], ['base-uri', "'self' — Allowed <base href> values"], ['Warnings', 'None found']] },
      ],
    },
  ];

  // ---- security -----------------------------------------------------------------
  const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (bytes) => { let c = 0xffffffff; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const adler32 = (bytes) => { let a = 1, b = 0; for (const x of bytes) { a = (a + x) % 65521; b = (b + a) % 65521; } return ((b << 16) | a) >>> 0; };
  const inputBytes = (text, format) => format === 'hex' ? hexBytes(text) : format === 'base64' ? b64Bytes(text) : utf8(text);
  const checksumRows = (n) => [['Hex', n.toString(16).toUpperCase().padStart(8, '0')], ['Decimal', String(n)]];
  const BYTES_FORMAT = { id: 'format', label: 'Input is', type: 'select', options: [['text', 'Text (UTF-8)'], ['hex', 'Hex'], ['base64', 'Base64']] };

  const digitsOnly = (s, what) => { const d = need(s, what).replace(/[\s-]/g, ''); if (!/^\d+$/.test(d)) fail(`${what[0].toUpperCase() + what.slice(1)} may only contain digits, spaces and dashes`); return d; };
  function luhnSum(digits) {
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
    }
    return sum;
  }
  // Check digit that makes payload+digit pass Luhn.
  const luhnDigit = (payload) => (10 - (luhnSum(payload + '0') % 10)) % 10;
  function cardNetwork(d) {
    if (/^4/.test(d)) return 'Visa';
    if (/^(5[1-5]|222[1-9]|22[3-9]\d|2[3-6]\d\d|27[01]\d|2720)/.test(d)) return 'Mastercard';
    if (/^3[47]/.test(d)) return 'American Express';
    if (/^(6011|65|64[4-9])/.test(d)) return 'Discover';
    if (/^35(2[89]|[3-8]\d)/.test(d)) return 'JCB';
    if (/^3(0[0-5]|[68])/.test(d)) return 'Diners Club';
    if (/^62/.test(d)) return 'UnionPay';
    return 'Unknown';
  }

  const IBAN_LENGTHS = { AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24,
    DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HR: 21, HU: 28,
    IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MD: 24, ME: 22,
    MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, SA: 24, SC: 31, SE: 24, SI: 19,
    SK: 24, SM: 27, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20 };
  function mod97(s) {
    let r = 0;
    for (const ch of s) {
      const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
      for (const d of v) r = (r * 10 + Number(d)) % 97;
    }
    return r;
  }
  const gtinDigit = (payload) => { let s = 0; for (let i = 0; i < payload.length; i++) s += Number(payload[payload.length - 1 - i]) * (i % 2 === 0 ? 3 : 1); return (10 - (s % 10)) % 10; };
  const GTIN_NAMES = { 8: 'EAN-8', 12: 'UPC-A', 13: 'EAN-13', 14: 'GTIN-14' };
  const isbn10Digit = (nine) => { let s = 0; for (let i = 0; i < 9; i++) s += (10 - i) * Number(nine[i]); const c = (11 - (s % 11)) % 11; return c === 10 ? 'X' : String(c); };

  const SECURITY = [
    {
      id: 'sec-hmac', name: 'HMAC Generator', icon: 'HMAC', family: 'security',
      desc: 'HMAC-SHA256 or HMAC-SHA1 of a message with a secret key (hex or Base64 out)', keywords: 'hmac signature sha256 sha1 webhook verify',
      fields: [
        { id: 'msg', label: 'Message', type: 'textarea', value: 'what do ya want for nothing?' },
        { id: 'key', label: 'Secret key', type: 'text', value: 'Jefe' },
        { id: 'keyFormat', label: 'Key is', type: 'select', options: [['text', 'Text (UTF-8)'], ['hex', 'Hex'], ['base64', 'Base64']] },
        { id: 'algo', label: 'Algorithm', type: 'select', options: [['sha256', 'HMAC-SHA256'], ['sha1', 'HMAC-SHA1']] },
        { id: 'out', label: 'Output', type: 'select', options: [['hex', 'Hex'], ['base64', 'Base64']] },
      ],
      run: (v) => {
        if (!v.key) fail('Enter a secret key');
        const mac = hmac(HASHES[v.algo], inputBytes(v.key, v.keyFormat), utf8(v.msg));
        return v.out === 'base64' ? b64(mac) : hex(mac);
      },
      examples: [
        { in: {}, out: '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843' }, // RFC 4231 case 2
        { in: { algo: 'sha1' }, out: 'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79' }, // RFC 2202 case 2
        { in: { msg: 'Hi There', key: '0b'.repeat(20), keyFormat: 'hex' }, out: 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7' }, // RFC 4231 case 1
        { in: { msg: 'Test Using Larger Than Block-Size Key - Hash Key First', key: 'aa'.repeat(131), keyFormat: 'hex' }, out: '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54' }, // RFC 4231 case 6
        { in: { out: 'base64' }, out: 'W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM=' },
      ],
    },
    {
      id: 'sec-totp', name: 'TOTP Code', icon: '⏲#', family: 'security',
      desc: 'Current 2FA code from a Base32 secret (RFC 6238), or the code at a given Unix time', keywords: 'totp 2fa otp authenticator mfa one-time password',
      fields: [
        { id: 'secret', label: 'Base32 secret', type: 'text', value: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' },
        { id: 'time', label: 'Unix time in seconds (blank = now)', type: 'text', value: '' },
        { id: 'digits', label: 'Digits', type: 'select', options: [['6', '6'], ['8', '8']] },
        { id: 'period', label: 'Period (seconds)', type: 'number', value: 30, min: 1, max: 3600 },
        { id: 'algo', label: 'Algorithm', type: 'select', options: [['sha1', 'SHA-1 (standard)'], ['sha256', 'SHA-256']] },
      ],
      run: (v) => {
        const key = b32Bytes(need(v.secret, 'the Base32 secret'));
        const period = num(v.period, 'Period', { min: 1, max: 3600, int: true });
        const ts = v.time.trim();
        if (ts && !/^\d+$/.test(ts)) fail('Unix time must be a whole number of seconds');
        const t = ts ? Number(ts) : Math.floor(Date.now() / 1000);
        const counter = Math.floor(t / period);
        return [['Code', hotp(key, counter, Number(v.digits), HASHES[v.algo])], ['Time step', String(counter)], ['Seconds left', String(period - (t % period))]];
      },
      examples: [
        // RFC 6238 appendix B (secret = ASCII "12345678901234567890")
        { in: { time: '59', digits: '8' }, out: [['Code', '94287082'], ['Time step', '1'], ['Seconds left', '1']] },
        { in: { time: '1111111109', digits: '8' }, out: [['Code', '07081804'], ['Time step', '37037036'], ['Seconds left', '1']] },
        { in: { time: '1234567890', digits: '8' }, out: [['Code', '89005924'], ['Time step', '41152263'], ['Seconds left', '30']] },
        { in: { time: '20000000000', digits: '8' }, out: [['Code', '65353130'], ['Time step', '666666666'], ['Seconds left', '10']] },
        { in: { time: '59', digits: '6' }, out: [['Code', '287082'], ['Time step', '1'], ['Seconds left', '1']] },
        { in: { secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA', time: '59', digits: '8', algo: 'sha256' }, out: [['Code', '46119246'], ['Time step', '1'], ['Seconds left', '1']] },
        { in: { time: '' }, match: /\b\d{6}\b/ },
      ],
    },
    {
      id: 'sec-base32', name: 'Base32', icon: 'B32', family: 'security',
      desc: 'Encode text to RFC 4648 Base32 or decode it', keywords: 'base32 encode decode rfc4648 totp secret',
      fields: [
        { id: 'mode', label: 'Mode', type: 'select', options: [['encode', 'Encode'], ['decode', 'Decode']] },
        { id: 'text', label: 'Input', type: 'textarea', value: 'foobar' },
      ],
      run: (v) => {
        if (v.mode === 'encode') return b32(utf8(v.text));
        const bytes = b32Bytes(v.text), text = utf8Text(bytes);
        return [['Text', text === null ? '(not valid UTF-8 text)' : text], ['Hex', hex(bytes)]];
      },
      examples: [
        { in: { mode: 'encode', text: 'foobar' }, out: 'MZXW6YTBOI======' },
        { in: { mode: 'encode', text: 'f' }, out: 'MY======' },
        { in: { mode: 'encode', text: 'fooba' }, out: 'MZXW6YTB' },
        { in: { mode: 'decode', text: 'mzxw6yq=' }, out: [['Text', 'foob'], ['Hex', '666f6f62']] },
        { in: { mode: 'decode', text: '74======' }, out: [['Text', '(not valid UTF-8 text)'], ['Hex', 'ff']] },
      ],
    },
    {
      id: 'sec-hex-base64', name: 'Hex ⇄ Base64', icon: '0x⇄', family: 'security',
      desc: 'Convert bytes between hex and Base64 (standard or URL-safe)', keywords: 'hex base64 bytes convert binary',
      fields: [
        { id: 'mode', label: 'Direction', type: 'select', options: [['toB64', 'Hex → Base64'], ['toHex', 'Base64 → Hex']] },
        { id: 'text', label: 'Input', type: 'textarea', value: '48656c6c6f' },
      ],
      run: (v) => v.mode === 'toB64' ? b64(hexBytes(v.text)) : hex(b64Bytes(v.text)),
      examples: [
        { in: { mode: 'toB64' }, out: 'SGVsbG8=' },
        { in: { mode: 'toB64', text: '0xFB FF' }, out: '+/8=' },
        { in: { mode: 'toHex', text: '-_8' }, out: 'fbff' },
      ],
    },
    {
      id: 'sec-crc32', name: 'CRC-32', icon: 'CRC', family: 'security',
      desc: 'CRC-32 checksum (the zip/PNG/Ethernet one) of text or bytes', keywords: 'crc32 checksum zip',
      fields: [BYTES_FORMAT, { id: 'text', label: 'Input', type: 'textarea', value: '123456789' }],
      run: (v) => checksumRows(crc32(inputBytes(v.text, v.format))),
      examples: [
        { in: {}, out: [['Hex', 'CBF43926'], ['Decimal', '3421780262']] },
        { in: { text: 'The quick brown fox jumps over the lazy dog' }, out: [['Hex', '414FA339'], ['Decimal', '1095738169']] },
        { in: { text: '', format: 'text' }, out: [['Hex', '00000000'], ['Decimal', '0']] },
      ],
    },
    {
      id: 'sec-adler32', name: 'Adler-32', icon: 'A32', family: 'security',
      desc: 'Adler-32 checksum (used by zlib) of text or bytes', keywords: 'adler32 checksum zlib',
      fields: [BYTES_FORMAT, { id: 'text', label: 'Input', type: 'textarea', value: 'Wikipedia' }],
      run: (v) => checksumRows(adler32(inputBytes(v.text, v.format))),
      examples: [
        { in: {}, out: [['Hex', '11E60398'], ['Decimal', '300286872']] },
        { in: { text: '', format: 'text' }, out: [['Hex', '00000001'], ['Decimal', '1']] },
      ],
    },
    {
      id: 'sec-luhn', name: 'Luhn / Card Number Check', icon: '💳', family: 'security',
      desc: 'Validate a card or IMEI number with the Luhn checksum and guess the card network', keywords: 'luhn credit card validate imei mod10',
      fields: [{ id: 'num', label: 'Number', type: 'text', value: '4111 1111 1111 1111' }],
      run: (v) => {
        const d = digitsOnly(v.num, 'the number');
        if (d.length < 2) fail('Enter at least two digits');
        const ok = luhnSum(d) % 10 === 0, expect = luhnDigit(d.slice(0, -1));
        return [['Valid', ok ? 'Yes' : 'No'], ['Last digit', ok ? String(expect) : `${d[d.length - 1]} (should be ${expect})`], ['Network', cardNetwork(d)], ['Length', `${d.length} digits`]];
      },
      examples: [
        { in: {}, out: [['Valid', 'Yes'], ['Last digit', '1'], ['Network', 'Visa'], ['Length', '16 digits']] },
        { in: { num: '79927398713' }, out: [['Valid', 'Yes'], ['Last digit', '3'], ['Network', 'Unknown'], ['Length', '11 digits']] },
        { in: { num: '3782-822463-10005' }, out: [['Valid', 'Yes'], ['Last digit', '5'], ['Network', 'American Express'], ['Length', '15 digits']] },
        { in: { num: '79927398710' }, out: [['Valid', 'No'], ['Last digit', '0 (should be 3)'], ['Network', 'Unknown'], ['Length', '11 digits']] },
      ],
    },
    {
      id: 'sec-iban', name: 'IBAN Validator', icon: 'IBAN', family: 'security',
      desc: 'Check an IBAN\'s country length and mod-97 check digits, and format it', keywords: 'iban bank account validate',
      fields: [{ id: 'iban', label: 'IBAN', type: 'text', value: 'GB82 WEST 1234 5698 7654 32' }],
      run: (v) => {
        const s = need(v.iban, 'an IBAN').replace(/[\s-]/g, '').toUpperCase();
        if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) fail('An IBAN starts with a 2-letter country code and 2 check digits, then letters and digits');
        const cc = s.slice(0, 2), problems = [];
        if (!IBAN_LENGTHS[cc]) problems.push(`"${cc}" is not a country that uses IBANs`);
        else if (s.length !== IBAN_LENGTHS[cc]) problems.push(`${cc} IBANs have ${IBAN_LENGTHS[cc]} characters; this has ${s.length}`);
        if (mod97(s.slice(4) + s.slice(0, 4)) !== 1) problems.push('Check digits do not match (mod-97 test failed — likely a typo)');
        const rows = [['Valid', problems.length ? 'No' : 'Yes'], ['Country', cc], ['Check digits', s.slice(2, 4)], ['Account (BBAN)', s.slice(4)], ['Formatted', s.match(/.{1,4}/g).join(' ')]];
        if (problems.length) rows.push(['Problems', problems.join('; ')]);
        return rows;
      },
      examples: [
        { in: {}, out: [['Valid', 'Yes'], ['Country', 'GB'], ['Check digits', '82'], ['Account (BBAN)', 'WEST12345698765432'], ['Formatted', 'GB82 WEST 1234 5698 7654 32']] },
        { in: { iban: 'de89370400440532013000' }, out: [['Valid', 'Yes'], ['Country', 'DE'], ['Check digits', '89'], ['Account (BBAN)', '370400440532013000'], ['Formatted', 'DE89 3704 0044 0532 0130 00']] },
        { in: { iban: 'GB82 WEST 1234 5698 7654 3' }, out: [['Valid', 'No'], ['Country', 'GB'], ['Check digits', '82'], ['Account (BBAN)', 'WEST1234569876543'], ['Formatted', 'GB82 WEST 1234 5698 7654 3'], ['Problems', 'GB IBANs have 22 characters; this has 21; Check digits do not match (mod-97 test failed — likely a typo)']] },
      ],
    },
    {
      id: 'sec-isbn', name: 'ISBN Validator & Converter', icon: 'ISBN', family: 'security',
      desc: 'Validate ISBN-10 or ISBN-13 and convert between them', keywords: 'isbn book validate convert',
      fields: [{ id: 'isbn', label: 'ISBN', type: 'text', value: '0-306-40615-2' }],
      run: (v) => {
        const s = need(v.isbn, 'an ISBN').replace(/[\s-]/g, '').toUpperCase().replace(/^ISBN(-1[03])?:?/, '');
        if (/^\d{9}[\dX]$/.test(s)) {
          const c = isbn10Digit(s.slice(0, 9));
          if (c !== s[9]) return [['Valid', 'No'], ['Type', 'ISBN-10'], ['Problem', `Check digit should be ${c}`]];
          const t = '978' + s.slice(0, 9);
          return [['Valid', 'Yes'], ['Type', 'ISBN-10'], ['ISBN-10', s], ['ISBN-13', t + gtinDigit(t)]];
        }
        if (/^\d{13}$/.test(s)) {
          if (!/^97[89]/.test(s)) return [['Valid', 'No'], ['Type', 'ISBN-13'], ['Problem', 'ISBN-13 must start with 978 or 979']];
          const c = String(gtinDigit(s.slice(0, 12)));
          if (c !== s[12]) return [['Valid', 'No'], ['Type', 'ISBN-13'], ['Problem', `Check digit should be ${c}`]];
          return [['Valid', 'Yes'], ['Type', 'ISBN-13'], ['ISBN-10', s.startsWith('978') ? s.slice(3, 12) + isbn10Digit(s.slice(3, 12)) : 'none (979 ISBNs have no ISBN-10)'], ['ISBN-13', s]];
        }
        fail('An ISBN has 10 characters (last may be X) or 13 digits');
      },
      examples: [
        { in: {}, out: [['Valid', 'Yes'], ['Type', 'ISBN-10'], ['ISBN-10', '0306406152'], ['ISBN-13', '9780306406157']] },
        { in: { isbn: 'ISBN 978-0-306-40615-7' }, out: [['Valid', 'Yes'], ['Type', 'ISBN-13'], ['ISBN-10', '0306406152'], ['ISBN-13', '9780306406157']] },
        { in: { isbn: '0-8044-2957-X' }, out: [['Valid', 'Yes'], ['Type', 'ISBN-10'], ['ISBN-10', '080442957X'], ['ISBN-13', '9780804429573']] },
        { in: { isbn: '0-306-40615-3' }, out: [['Valid', 'No'], ['Type', 'ISBN-10'], ['Problem', 'Check digit should be 2']] },
      ],
    },
    {
      id: 'sec-ean', name: 'EAN / UPC Check Digit', icon: '▮▯▮', family: 'security',
      desc: 'Compute or verify the check digit of EAN-8, UPC-A, EAN-13 and GTIN-14 barcodes', keywords: 'ean upc gtin barcode check digit',
      fields: [
        { id: 'mode', label: 'Mode', type: 'select', options: [['compute', 'Add check digit'], ['verify', 'Verify full code']] },
        { id: 'code', label: 'Digits', type: 'text', value: '400638133393' },
      ],
      run: (v) => {
        const d = digitsOnly(v.code, 'the barcode');
        if (v.mode === 'compute') {
          const name = GTIN_NAMES[d.length + 1];
          if (!name) fail('Enter 7, 11, 12 or 13 digits (the code without its check digit)');
          const c = gtinDigit(d);
          return [['Full code', d + c], ['Check digit', String(c)], ['Format', name]];
        }
        if (!GTIN_NAMES[d.length]) fail('Enter a full 8, 12, 13 or 14 digit code');
        const c = gtinDigit(d.slice(0, -1)), ok = String(c) === d[d.length - 1];
        return [['Valid', ok ? 'Yes' : 'No'], ['Format', GTIN_NAMES[d.length]], ['Check digit', ok ? String(c) : `${d[d.length - 1]} (should be ${c})`]];
      },
      examples: [
        { in: {}, out: [['Full code', '4006381333931'], ['Check digit', '1'], ['Format', 'EAN-13']] },
        { in: { code: '036000 29145' }, out: [['Full code', '036000291452'], ['Check digit', '2'], ['Format', 'UPC-A']] },
        { in: { mode: 'verify', code: '036000291452' }, out: [['Valid', 'Yes'], ['Format', 'UPC-A'], ['Check digit', '2']] },
        { in: { mode: 'verify', code: '4006381333932' }, out: [['Valid', 'No'], ['Format', 'EAN-13'], ['Check digit', '2 (should be 1)']] },
      ],
    },
  ];

  // ---- design -----------------------------------------------------------------
  const pct = (x) => `${Math.round(x)}%`;
  const isCssColor = (s) => /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s) || /^(rgba?|hsla?)\([^()]*\)$/i.test(s) || /^[a-z]+$/i.test(s);
  const PHI = (1 + Math.sqrt(5)) / 2;

  const DESIGN = [
    {
      id: 'design-color-formats', name: 'Color Format Converter', icon: '🎨⇄', family: 'design',
      desc: 'Convert a colour between HEX, RGB, HSL, HSV and CMYK', keywords: 'color colour hex rgb hsl hsv cmyk convert',
      fields: [{ id: 'color', label: 'Colour (#hex, rgb(), hsl())', type: 'text', value: '#ff5733' }],
      run: (v) => {
        const c = parseColor(need(v.color, 'a colour'));
        const hsv = rgbToHsv(c);
        const r = c.r / 255, g = c.g / 255, b = c.b / 255, k = 1 - Math.max(r, g, b);
        const cm = (x) => (k === 1 ? 0 : ((1 - x - k) / (1 - k)) * 100);
        const rgb = [c.r, c.g, c.b].map(clamp255);
        const rows = [['HEX', toHex(c)], ['RGB', `rgb(${rgb.join(', ')})`], ['HSL', hslText(c)],
          ['HSV', `hsv(${Math.round(hsv.h) % 360}, ${pct(hsv.s)}, ${pct(hsv.v)})`], ['CMYK', `cmyk(${pct(cm(r))}, ${pct(cm(g))}, ${pct(cm(b))}, ${pct(k * 100)})`]];
        if (c.a < 1) rows.push(['Alpha', pct(c.a * 100)], ['HEX + alpha', toHex(c) + clamp255(c.a * 255).toString(16).padStart(2, '0')], ['RGBA', `rgba(${rgb.join(', ')}, ${fmt(c.a, 2)})`]);
        return rows;
      },
      examples: [
        { in: {}, out: [['HEX', '#ff5733'], ['RGB', 'rgb(255, 87, 51)'], ['HSL', 'hsl(11, 100%, 60%)'], ['HSV', 'hsv(11, 80%, 100%)'], ['CMYK', 'cmyk(0%, 66%, 80%, 0%)']] },
        { in: { color: 'hsl(210, 50%, 40%)' }, out: [['HEX', '#336699'], ['RGB', 'rgb(51, 102, 153)'], ['HSL', 'hsl(210, 50%, 40%)'], ['HSV', 'hsv(210, 67%, 60%)'], ['CMYK', 'cmyk(67%, 33%, 0%, 40%)']] },
        { in: { color: '#33669980' }, out: [['HEX', '#336699'], ['RGB', 'rgb(51, 102, 153)'], ['HSL', 'hsl(210, 50%, 40%)'], ['HSV', 'hsv(210, 67%, 60%)'], ['CMYK', 'cmyk(67%, 33%, 0%, 40%)'], ['Alpha', '50%'], ['HEX + alpha', '#33669980'], ['RGBA', 'rgba(51, 102, 153, 0.5)']] },
        { in: { color: 'rgb(0 0 0)' }, out: [['HEX', '#000000'], ['RGB', 'rgb(0, 0, 0)'], ['HSL', 'hsl(0, 0%, 0%)'], ['HSV', 'hsv(0, 0%, 0%)'], ['CMYK', 'cmyk(0%, 0%, 0%, 100%)']] },
      ],
    },
    {
      id: 'design-shades', name: 'Tints & Shades', icon: '▤', family: 'design',
      desc: 'Lighter tints (mixed with white) and darker shades (mixed with black) of a colour', keywords: 'tint shade lighten darken palette scale',
      fields: [
        { id: 'color', label: 'Base colour', type: 'color', value: '#3366cc' },
        { id: 'steps', label: 'Steps each way', type: 'number', value: 4, min: 1, max: 10 },
      ],
      run: (v) => {
        const c = parseColor(need(v.color, 'a colour'));
        const n = num(v.steps, 'Steps', { min: 1, max: 10, int: true });
        const mix = (t, amt) => toHex({ r: c.r + (t - c.r) * amt, g: c.g + (t - c.g) * amt, b: c.b + (t - c.b) * amt });
        const rows = [];
        for (let i = n; i >= 1; i--) rows.push([`Tint ${Math.round((i / (n + 1)) * 100)}%`, mix(255, i / (n + 1))]);
        rows.push(['Base', toHex(c)]);
        for (let i = 1; i <= n; i++) rows.push([`Shade ${Math.round((i / (n + 1)) * 100)}%`, mix(0, i / (n + 1))]);
        return rows;
      },
      examples: [
        { in: { steps: 1 }, out: [['Tint 50%', '#99b3e6'], ['Base', '#3366cc'], ['Shade 50%', '#1a3366']] },
        { in: { color: '#000000', steps: 3 }, out: [['Tint 75%', '#bfbfbf'], ['Tint 50%', '#808080'], ['Tint 25%', '#404040'], ['Base', '#000000'], ['Shade 25%', '#000000'], ['Shade 50%', '#000000'], ['Shade 75%', '#000000']] },
      ],
    },
    {
      id: 'design-palette', name: 'Color Harmony Palette', icon: '◐', family: 'design',
      desc: 'Complementary, analogous, triadic, split, tetradic or monochrome palette from one colour', keywords: 'palette harmony complementary triadic analogous scheme',
      fields: [
        { id: 'color', label: 'Base colour', type: 'color', value: '#ff0000' },
        { id: 'scheme', label: 'Harmony', type: 'select', options: [['complementary', 'Complementary'], ['analogous', 'Analogous'], ['triadic', 'Triadic'], ['split', 'Split-complementary'], ['tetradic', 'Tetradic (square)'], ['mono', 'Monochromatic']] },
      ],
      run: (v) => {
        const hsl = rgbToHsl(parseColor(need(v.color, 'a colour')));
        const at = (dh, l = hsl.l) => toHex(hslToRgb(hsl.h + dh, hsl.s, Math.min(100, Math.max(0, l))));
        const S = {
          complementary: [['Base', 0], ['Complement', 180]], analogous: [['−30°', -30], ['Base', 0], ['+30°', 30]],
          triadic: [['Base', 0], ['+120°', 120], ['+240°', 240]], split: [['Base', 0], ['+150°', 150], ['+210°', 210]],
          tetradic: [['Base', 0], ['+90°', 90], ['+180°', 180], ['+270°', 270]],
        };
        if (v.scheme === 'mono') return [-30, -15, 0, 15, 30].map(d => [d ? `Lightness ${pct(Math.min(100, Math.max(0, hsl.l + d)))}` : 'Base', at(0, hsl.l + d)]);
        return S[v.scheme].map(([label, dh]) => [label, at(dh)]);
      },
      examples: [
        { in: { scheme: 'complementary' }, out: [['Base', '#ff0000'], ['Complement', '#00ffff']] },
        { in: { scheme: 'triadic' }, out: [['Base', '#ff0000'], ['+120°', '#00ff00'], ['+240°', '#0000ff']] },
        { in: { scheme: 'analogous' }, out: [['−30°', '#ff0080'], ['Base', '#ff0000'], ['+30°', '#ff8000']] },
        { in: { scheme: 'mono' }, out: [['Lightness 20%', '#660000'], ['Lightness 35%', '#b30000'], ['Base', '#ff0000'], ['Lightness 65%', '#ff4d4d'], ['Lightness 80%', '#ff9999']] },
      ],
    },
    {
      id: 'design-gradient', name: 'CSS Gradient', icon: '▰', family: 'design',
      desc: 'Build a linear, radial or conic CSS gradient from a list of colours', keywords: 'gradient css background linear radial conic',
      fields: [
        { id: 'type', label: 'Type', type: 'select', options: [['linear', 'Linear'], ['radial', 'Radial'], ['conic', 'Conic']] },
        { id: 'angle', label: 'Angle (degrees)', type: 'number', value: 90 },
        { id: 'colors', label: 'Colours, one per line (optional stop: "#f00 20%")', type: 'textarea', value: '#ff0000\n#0000ff' },
      ],
      run: (v) => {
        const items = [];
        let cur = '', depth = 0;
        for (const ch of v.colors) {
          if (ch === '(') depth++;
          if (ch === ')') depth--;
          if ((ch === '\n' || ch === ',') && depth === 0) { items.push(cur); cur = ''; } else cur += ch;
        }
        items.push(cur);
        const stops = items.map(s => s.trim()).filter(Boolean).map(s => {
          const m = s.match(/^(.*?)(?:\s+(-?\d+(?:\.\d+)?)%)?$/);
          if (!isCssColor(m[1])) fail(`"${m[1]}" is not a colour`);
          return { color: m[1], at: m[2] };
        });
        if (stops.length < 2) fail('A gradient needs at least two colours');
        const list = stops.map((s, i) => `${s.color} ${s.at !== undefined ? s.at : fmt((i / (stops.length - 1)) * 100, 2)}%`).join(', ');
        const angle = () => num(v.angle, 'Angle', { min: -360, max: 360 });
        const g = v.type === 'linear' ? `linear-gradient(${angle()}deg, ${list})` : v.type === 'radial' ? `radial-gradient(circle, ${list})` : `conic-gradient(from ${angle()}deg, ${list})`;
        return `background: ${g};`;
      },
      examples: [
        { in: { colors: '#ff0000\n#00ff00\n#0000ff' }, out: 'background: linear-gradient(90deg, #ff0000 0%, #00ff00 50%, #0000ff 100%);' },
        { in: { type: 'radial', colors: 'rgba(0, 0, 0, 0.5), white 80%, transparent' }, out: 'background: radial-gradient(circle, rgba(0, 0, 0, 0.5) 0%, white 80%, transparent 100%);' },
        { in: { type: 'conic', angle: 45, colors: '#fff\n#000\n#fff\n#000' }, out: 'background: conic-gradient(from 45deg, #fff 0%, #000 33.33%, #fff 66.67%, #000 100%);' },
      ],
    },
    {
      id: 'design-box-shadow', name: 'Box Shadow', icon: '❏', family: 'design',
      desc: 'Generate a CSS box-shadow from offset, blur, spread, colour and opacity', keywords: 'box-shadow css shadow elevation',
      fields: [
        { id: 'x', label: 'Offset X (px)', type: 'number', value: 0 },
        { id: 'y', label: 'Offset Y (px)', type: 'number', value: 4 },
        { id: 'blur', label: 'Blur (px)', type: 'number', value: 12, min: 0 },
        { id: 'spread', label: 'Spread (px)', type: 'number', value: 0 },
        { id: 'color', label: 'Colour', type: 'color', value: '#000000' },
        { id: 'opacity', label: 'Opacity (%)', type: 'number', value: 25, min: 0, max: 100 },
        { id: 'inset', label: 'Inset', type: 'checkbox', value: false },
      ],
      run: (v) => {
        const c = parseColor(need(v.color, 'a colour'));
        const x = num(v.x, 'Offset X'), y = num(v.y, 'Offset Y'), blur = num(v.blur, 'Blur', { min: 0 }), spread = num(v.spread, 'Spread');
        const a = num(v.opacity, 'Opacity', { min: 0, max: 100 }) / 100;
        return `box-shadow: ${v.inset ? 'inset ' : ''}${fmt(x, 2)}px ${fmt(y, 2)}px ${fmt(blur, 2)}px ${fmt(spread, 2)}px rgba(${[c.r, c.g, c.b].map(clamp255).join(', ')}, ${fmt(a, 2)});`;
      },
      examples: [
        { in: {}, out: 'box-shadow: 0px 4px 12px 0px rgba(0, 0, 0, 0.25);' },
        { in: { x: -2, y: 2, blur: 4, spread: 1, color: '#3366cc', opacity: 50, inset: true }, out: 'box-shadow: inset -2px 2px 4px 1px rgba(51, 102, 204, 0.5);' },
      ],
    },
    {
      id: 'design-border-radius', name: 'Border Radius', icon: '▢', family: 'design',
      desc: 'Build the shortest border-radius shorthand for four corners', keywords: 'border-radius rounded corners css',
      fields: [
        { id: 'tl', label: 'Top-left', type: 'number', value: 8, min: 0 },
        { id: 'tr', label: 'Top-right', type: 'number', value: 8, min: 0 },
        { id: 'br', label: 'Bottom-right', type: 'number', value: 8, min: 0 },
        { id: 'bl', label: 'Bottom-left', type: 'number', value: 8, min: 0 },
        { id: 'unit', label: 'Unit', type: 'select', options: [['px', 'px'], ['%', '%'], ['rem', 'rem'], ['em', 'em']] },
      ],
      run: (v) => {
        const [tl, tr, br, bl] = ['tl', 'tr', 'br', 'bl'].map(k => num(v[k], 'Each corner', { min: 0 }));
        const vals = tl === tr && tr === br && br === bl ? [tl] : tl === br && tr === bl ? [tl, tr] : tr === bl ? [tl, tr, br] : [tl, tr, br, bl];
        return `border-radius: ${vals.map(x => fmt(x, 3) + v.unit).join(' ')};`;
      },
      examples: [
        { in: {}, out: 'border-radius: 8px;' },
        { in: { tl: 10, tr: 20, br: 10, bl: 20 }, out: 'border-radius: 10px 20px;' },
        { in: { tl: 10, tr: 20, br: 30, bl: 20, unit: '%' }, out: 'border-radius: 10% 20% 30%;' },
        { in: { tl: 1, tr: 2, br: 3, bl: 4, unit: 'rem' }, out: 'border-radius: 1rem 2rem 3rem 4rem;' },
      ],
    },
    {
      id: 'design-css-units', name: 'CSS Unit Converter', icon: 'px', family: 'design',
      desc: 'Convert between px, rem, em, %, pt, pc, in, cm and mm', keywords: 'px rem em pt css units convert font size',
      fields: [
        { id: 'value', label: 'Value', type: 'number', value: 24 },
        { id: 'unit', label: 'From', type: 'select', options: [['px', 'px'], ['rem', 'rem'], ['em', 'em'], ['%', '%'], ['pt', 'pt'], ['pc', 'pc'], ['in', 'in'], ['cm', 'cm'], ['mm', 'mm']] },
        { id: 'root', label: 'Root font size (px)', type: 'number', value: 16, min: 1 },
        { id: 'parent', label: 'Parent font size (px, for em and %)', type: 'number', value: 16, min: 1 },
      ],
      run: (v) => {
        const x = num(v.value, 'the value'), root = num(v.root, 'Root font size', { min: 0.01 }), parent = num(v.parent, 'Parent font size', { min: 0.01 });
        const PX = { px: 1, rem: root, em: parent, '%': parent / 100, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 };
        const px = x * PX[v.unit];
        return Object.keys(PX).map(u => [u, fmt(px / PX[u]) + u]);
      },
      examples: [
        { in: {}, out: [['px', '24px'], ['rem', '1.5rem'], ['em', '1.5em'], ['%', '150%'], ['pt', '18pt'], ['pc', '1.5pc'], ['in', '0.25in'], ['cm', '0.635cm'], ['mm', '6.35mm']] },
        { in: { value: 2, unit: 'em', parent: 20 }, out: [['px', '40px'], ['rem', '2.5rem'], ['em', '2em'], ['%', '200%'], ['pt', '30pt'], ['pc', '2.5pc'], ['in', '0.4167in'], ['cm', '1.0583cm'], ['mm', '10.5833mm']] },
      ],
    },
    {
      id: 'design-aspect-ratio', name: 'Aspect Ratio Calculator', icon: '16:9', family: 'design',
      desc: 'Simplify a width × height to its ratio and resize while keeping it', keywords: 'aspect ratio resize dimensions width height 16:9',
      fields: [
        { id: 'w', label: 'Width', type: 'number', value: 1920, min: 0 },
        { id: 'h', label: 'Height', type: 'number', value: 1080, min: 0 },
        { id: 'nw', label: 'New width (optional)', type: 'number', value: 1280 },
        { id: 'nh', label: 'New height (optional)', type: 'number', value: '' },
      ],
      run: (v) => {
        const w = num(v.w, 'Width', { min: Number.MIN_VALUE }), h = num(v.h, 'Height', { min: Number.MIN_VALUE });
        const gcd = (a, b) => (b ? gcd(b, a % b) : a);
        const ratio = Number.isInteger(w) && Number.isInteger(h) ? `${w / gcd(w, h)}:${h / gcd(w, h)}` : `${fmt(w / h)}:1`;
        const rows = [['Ratio', ratio], ['Decimal', fmt(w / h)]];
        const hasW = !Number.isNaN(v.nw), hasH = !Number.isNaN(v.nh);
        if (hasW && hasH) fail('Fill in only one of new width or new height');
        if (hasW) rows.push(['New size', `${fmt(num(v.nw, 'New width', { min: 0 }), 2)} × ${fmt((v.nw * h) / w, 2)}`]);
        if (hasH) rows.push(['New size', `${fmt((num(v.nh, 'New height', { min: 0 }) * w) / h, 2)} × ${fmt(v.nh, 2)}`]);
        return rows;
      },
      examples: [
        { in: {}, out: [['Ratio', '16:9'], ['Decimal', '1.7778'], ['New size', '1280 × 720']] },
        { in: { nw: '', nh: 900 }, out: [['Ratio', '16:9'], ['Decimal', '1.7778'], ['New size', '1600 × 900']] },
        { in: { w: 1366, h: 768, nw: '' }, out: [['Ratio', '683:384'], ['Decimal', '1.7786']] },
      ],
    },
    {
      id: 'design-type-scale', name: 'Type Scale', icon: 'Aa↑', family: 'design',
      desc: 'Modular font-size scale from a base size and ratio, in px and rem', keywords: 'typography type scale modular font size ratio',
      fields: [
        { id: 'base', label: 'Base size (px)', type: 'number', value: 16, min: 1 },
        { id: 'ratio', label: 'Ratio', type: 'select', value: '1.25', options: [['1.067', 'Minor second (1.067)'], ['1.125', 'Major second (1.125)'], ['1.2', 'Minor third (1.2)'], ['1.25', 'Major third (1.25)'], ['1.333', 'Perfect fourth (1.333)'], ['1.414', 'Augmented fourth (1.414)'], ['1.5', 'Perfect fifth (1.5)'], ['1.618', 'Golden ratio (1.618)']] },
        { id: 'up', label: 'Steps up', type: 'number', value: 5, min: 0, max: 10 },
        { id: 'down', label: 'Steps down', type: 'number', value: 2, min: 0, max: 5 },
        { id: 'root', label: 'Root size for rem (px)', type: 'number', value: 16, min: 1 },
      ],
      run: (v) => {
        const base = num(v.base, 'Base size', { min: 0.01 }), r = Number(v.ratio), root = num(v.root, 'Root size', { min: 0.01 });
        const up = num(v.up, 'Steps up', { min: 0, max: 10, int: true }), down = num(v.down, 'Steps down', { min: 0, max: 5, int: true });
        const rows = [];
        for (let k = up; k >= -down; k--) {
          const px = base * r ** k;
          rows.push([k === 0 ? '0 (base)' : k > 0 ? `+${k}` : `−${-k}`, `${fmt(px, 2)}px · ${fmt(px / root)}rem`]);
        }
        return rows;
      },
      examples: [
        { in: { up: 3, down: 1 }, out: [['+3', '31.25px · 1.9531rem'], ['+2', '25px · 1.5625rem'], ['+1', '20px · 1.25rem'], ['0 (base)', '16px · 1rem'], ['−1', '12.8px · 0.8rem']] },
        { in: { base: 18, ratio: '1.5', up: 2, down: 0, root: 16 }, out: [['+2', '40.5px · 2.5313rem'], ['+1', '27px · 1.6875rem'], ['0 (base)', '18px · 1.125rem']] },
      ],
    },
    {
      id: 'design-clamp', name: 'Fluid Size clamp()', icon: '⟷', family: 'design',
      desc: 'CSS clamp() that scales a size smoothly between two viewport widths', keywords: 'clamp fluid typography responsive css vw',
      fields: [
        { id: 'min', label: 'Size at small screens (px)', type: 'number', value: 16, min: 0 },
        { id: 'max', label: 'Size at large screens (px)', type: 'number', value: 32, min: 0 },
        { id: 'vmin', label: 'Small viewport width (px)', type: 'number', value: 320, min: 1 },
        { id: 'vmax', label: 'Large viewport width (px)', type: 'number', value: 1280, min: 1 },
        { id: 'root', label: 'Root font size (px)', type: 'number', value: 16, min: 1 },
      ],
      run: (v) => {
        const a = num(v.min, 'Small-screen size', { min: 0 }), b = num(v.max, 'Large-screen size', { min: 0 });
        const va = num(v.vmin, 'Small viewport', { min: 1 }), vb = num(v.vmax, 'Large viewport', { min: 1 }), root = num(v.root, 'Root font size', { min: 0.01 });
        if (vb <= va) fail('The large viewport must be wider than the small one');
        const slope = (b - a) / (vb - va), intercept = a - slope * va;
        const vw = fmt(slope * 100);
        const pref = `${fmt(intercept / root)}rem ${slope < 0 ? '-' : '+'} ${vw.replace('-', '')}vw`;
        return `clamp(${fmt(Math.min(a, b) / root)}rem, ${pref}, ${fmt(Math.max(a, b) / root)}rem)`;
      },
      examples: [
        { in: {}, out: 'clamp(1rem, 0.6667rem + 1.6667vw, 2rem)' },
        { in: { min: 48, max: 24, vmin: 400, vmax: 1200 }, out: 'clamp(1.5rem, 3.75rem - 3vw, 3rem)' },
      ],
    },
    {
      id: 'design-print-size', name: 'Image Print Size (DPI)', icon: '🖨', family: 'design',
      desc: 'How large an image prints at a given DPI, in inches and centimetres', keywords: 'dpi ppi print size resolution megapixels',
      fields: [
        { id: 'w', label: 'Width (px)', type: 'number', value: 3000, min: 1 },
        { id: 'h', label: 'Height (px)', type: 'number', value: 2000, min: 1 },
        { id: 'dpi', label: 'DPI', type: 'number', value: 300, min: 1 },
      ],
      run: (v) => {
        const w = num(v.w, 'Width', { min: 1 }), h = num(v.h, 'Height', { min: 1 }), dpi = num(v.dpi, 'DPI', { min: 1 });
        return [['Inches', `${fmt(w / dpi, 2)} × ${fmt(h / dpi, 2)} in`], ['Centimetres', `${fmt((w / dpi) * 2.54, 2)} × ${fmt((h / dpi) * 2.54, 2)} cm`],
          ['Megapixels', fmt((w * h) / 1e6, 2)],
          ['Quality', dpi >= 300 ? 'Photo quality (300 DPI or more)' : dpi >= 150 ? 'Fine for posters seen from a distance' : 'Low — may look pixelated up close']];
      },
      examples: [
        { in: {}, out: [['Inches', '10 × 6.67 in'], ['Centimetres', '25.4 × 16.93 cm'], ['Megapixels', '6'], ['Quality', 'Photo quality (300 DPI or more)']] },
        { in: { w: 1920, h: 1080, dpi: 150 }, out: [['Inches', '12.8 × 7.2 in'], ['Centimetres', '32.51 × 18.29 cm'], ['Megapixels', '2.07'], ['Quality', 'Fine for posters seen from a distance']] },
      ],
    },
    {
      id: 'design-golden-ratio', name: 'Golden Ratio', icon: 'φ', family: 'design',
      desc: 'Scale a size up by φ (1.618) or split it into golden-ratio parts', keywords: 'golden ratio phi proportion layout',
      fields: [{ id: 'value', label: 'Size', type: 'number', value: 100 }],
      run: (v) => {
        const x = num(v.value, 'the size');
        return [['× φ (next size up)', fmt(x * PHI)], ['Split: larger part (÷ φ)', fmt(x / PHI)], ['Split: smaller part', fmt(x - x / PHI)]];
      },
      examples: [
        { in: {}, out: [['× φ (next size up)', '161.8034'], ['Split: larger part (÷ φ)', '61.8034'], ['Split: smaller part', '38.1966']] },
      ],
    },
  ];

  const PACK = [].concat(DEV, DATA, WEB, SECURITY, DESIGN);
  if (typeof ToolboxPacks !== 'undefined') ToolboxPacks.add(PACK);
  if (typeof module !== 'undefined' && module.exports) module.exports = PACK;
})();
