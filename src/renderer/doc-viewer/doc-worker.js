// The document viewer's worker. The document lives here, as bytes, and the page only ever asks small questions of it: "give me rows 400 to
// 440", "where is this word", "open this branch". That is what keeps a 50 MB JSON file, a 200,000-row CSV or a 100 MB log from freezing
// the page: nothing big is ever copied to it or built there.
//
//   init       the bytes (+ encoding)            -> size, encoding, byte-order mark, whether it is binary
//   lines      text: the line index, lines a..b, a search over lines, appended bytes (a growing log)
//   tree       JSON, JSON Lines, XML: a flat node table, the visible rows, open/close, search, path, value
//   csv        a table: row index, column types, sort, filter, rows a..b
//
// Everything is plain functions on typed arrays, so a test can run this file in a vm context with a stand-in for `self`.

'use strict';

// ---------------------------------------------------------------- the bytes
let RAW = null;          // what arrived
let STORE = null;        // the UTF-8 bytes, with room to grow (a log that is being followed)
let OWNED = false;       // STORE is our own buffer (it can grow in place)
let B = null;            // STORE.subarray(0, length): the document
let ENCODING = 'utf-8';
let BOM = false;
const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

// An error the page can show in its own words: `tpl` is the English sentence (with {name} places), `args` fill them.
class Fail extends Error {
  constructor(tpl, args, cause) {
    super(tpl.replace(/\{(\w+)\}/g, (m, k) => (args && k in args ? args[k] : m)), cause ? { cause } : undefined);
    this.tpl = tpl; this.args = args || null;
  }
}

const str = (s, e) => decoder.decode(B.subarray(s, e));

function sniffEncoding(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { name: 'utf-8', skip: 3, bom: true };
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return { name: 'utf-16le', skip: 2, bom: true };
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { name: 'utf-16be', skip: 2, bom: true };
  // UTF-16 without a mark: a NUL in every other byte of the first bytes of text.
  const n = Math.min(bytes.length, 256);
  if (n >= 4) {
    let even = 0, odd = 0;
    for (let i = 0; i < n; i++) if (bytes[i] === 0) { if (i % 2) odd++; else even++; }
    if (odd > n / 4 && even === 0) return { name: 'utf-16le', skip: 0, bom: false };
    if (even > n / 4 && odd === 0) return { name: 'utf-16be', skip: 0, bom: false };
  }
  // Valid UTF-8, or not: the first 2 MB decide. A Turkish file saved by an older program is windows-1254, not UTF-8.
  const sample = bytes.subarray(0, Math.min(bytes.length, 2 * 1024 * 1024));
  try { new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: sample.length < bytes.length }); return { name: 'utf-8', skip: 0, bom: false }; }
  catch { return { name: 'windows-1254', skip: 0, bom: false }; }
}

function init(m) {
  // The bytes arrive once; a later init (another encoding) works on the ones already here.
  if (m.buffer) RAW = new Uint8Array(m.buffer);
  if (!RAW) throw new Fail('There is no document to read');
  const sniffed = sniffEncoding(RAW);
  // An encoding the person picked wins, except that a byte-order mark of the same encoding is still skipped.
  const enc = m.encoding && m.encoding !== 'auto' ? { name: m.encoding, skip: sniffed.bom && sniffed.name === m.encoding ? sniffed.skip : 0, bom: sniffed.bom && sniffed.name === m.encoding } : sniffed;
  ENCODING = enc.name;
  BOM = enc.bom;
  if (enc.name === 'utf-8') { STORE = RAW.subarray(enc.skip); OWNED = false; }
  else {
    // Everything else is turned into UTF-8 once, so every search and scan below works on one encoding.
    let text;
    try { text = new TextDecoder(enc.name).decode(RAW.subarray(enc.skip)); } catch (err) { throw new Fail('That encoding is not known here: {name}', { name: enc.name }, err); }
    STORE = encoder.encode(text);
    OWNED = true;
  }
  B = STORE;
  LS = null; LN = 0; LSCAN = 0; tree = null; csv = null;
  return { size: RAW.length, bytes: B.length, encoding: ENCODING, bom: BOM, binary: looksBinary(B) };
}

// A NUL byte, or a good many control bytes, in the first 8 KB: not a text document.
function looksBinary(bytes) {
  const n = Math.min(bytes.length, 8192);
  let ctl = 0;
  for (let i = 0; i < n; i++) {
    const c = bytes[i];
    if (c === 0) return true;
    if (c < 9 || (c > 13 && c < 32 && c !== 27)) ctl++;
  }
  return n > 0 && ctl / n > 0.1;
}

function lineColOf(offset) {
  let line = 1, last = -1;
  const end = Math.min(offset, B.length);
  for (let i = B.indexOf(10); i !== -1 && i < end; i = B.indexOf(10, i + 1)) { line++; last = i; }
  return { line, col: offset - last };
}

// ---------------------------------------------------------------- search over bytes
const FOLD = new Uint8Array(256);
for (let i = 0; i < 256; i++) FOLD[i] = i >= 65 && i <= 90 ? i + 32 : i;

// Every offset where the query occurs (ASCII letters match in either case unless `cs`). Stops at `cap`.
function findAll(query, cs, cap) {
  const q = encoder.encode(String(query));
  const m = q.length;
  const hits = [];
  if (!m) return { hits, capped: false };
  const needle = cs ? q : q.map((c) => FOLD[c]);
  const skipTable = new Int32Array(256).fill(m);
  for (let j = 0; j < m - 1; j++) skipTable[needle[j]] = m - 1 - j;
  const n = B.length;
  const lastByte = needle[m - 1];
  let i = 0;
  while (i <= n - m) {
    const raw = B[i + m - 1];
    const last = cs ? raw : FOLD[raw];
    if (last === lastByte) {
      let j = m - 2;
      if (cs) while (j >= 0 && B[i + j] === needle[j]) j--;
      else while (j >= 0 && FOLD[B[i + j]] === needle[j]) j--;
      if (j < 0) { hits.push(i); if (hits.length >= cap) return { hits, capped: true }; i += m; continue; }
    }
    i += skipTable[last];
  }
  return { hits, capped: false };
}

function grown(arr, size, Type) {
  const next = new Type(size);
  next.set(arr);
  return next;
}

// ================================================================ TEXT: lines
let LS = null;           // Uint32Array: where each line starts
let LN = 0;              // how many lines
let LSCAN = 0;           // how far the index has looked

function buildLines() {
  if (!LS) { LS = new Uint32Array(Math.max(1024, Math.min(B.length >> 5, 1 << 24))); LN = 0; LSCAN = 0; }
  if (LN === 0 && B.length > 0) { LS[0] = 0; LN = 1; }
  // A line is what lies between two line feeds; the last one has no feed after it. A trailing feed does not start a line of its own.
  let i = B.indexOf(10, LSCAN);
  while (i !== -1) {
    if (i + 1 < B.length) {
      if (LN >= LS.length) LS = grown(LS, LS.length * 2, Uint32Array);
      LS[LN++] = i + 1;
    }
    i = B.indexOf(10, i + 1);
  }
  LSCAN = B.length;
}

function lineEnd(i) {
  let e = i + 1 < LN ? LS[i + 1] - 1 : B.length;       // before the line feed
  if (i + 1 >= LN && e > LS[i] && B[e - 1] === 10) e--;
  if (e > LS[i] && B[e - 1] === 13) e--;
  return e;
}

const LINE_CAP = 20000;      // characters of one line the page is given
function lineText(i) {
  const s = LS[i], e = lineEnd(i);
  if (e - s > LINE_CAP * 3) {
    // A very long line (a minified file): the start of it, and how much more there is.
    let cut = s + LINE_CAP;
    while (cut > s && (B[cut] & 0xc0) === 0x80) cut--;
    return { t: decoder.decode(B.subarray(s, cut)), more: e - cut };
  }
  const t = decoder.decode(B.subarray(s, e));
  if (t.length > LINE_CAP) return { t: t.slice(0, LINE_CAP), more: t.length - LINE_CAP };
  return { t, more: 0 };
}

function lineOfOffset(off) {
  let lo = 0, hi = LN - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (LS[mid] <= off) lo = mid; else hi = mid - 1; }
  return lo;
}

function linesInfo() { buildLines(); return { count: LN, bytes: B.length }; }

function linesGet(m) {
  buildLines();
  const from = Math.max(0, m.from | 0), to = Math.min(LN, from + Math.min(m.count | 0, 2000));
  const out = [], more = [];
  for (let i = from; i < to; i++) { const l = lineText(i); out.push(l.t); more.push(l.more); }
  return { from, lines: out, more };
}

function linesFind(m) {
  buildLines();
  const r = findAll(m.q, !!m.cs, m.cap || 50000);
  const line = new Int32Array(r.hits.length), col = new Int32Array(r.hits.length);
  for (let k = 0; k < r.hits.length; k++) {
    const li = lineOfOffset(r.hits[k]);
    line[k] = li;
    // The column in characters, not bytes (a hit past the part of a very long line the page is given has no column there).
    col[k] = r.hits[k] - LS[li] > LINE_CAP * 3 ? -1 : decoder.decode(B.subarray(LS[li], r.hits[k])).length;
  }
  return { line, col, capped: r.capped, __transfer: [line.buffer, col.buffer] };
}

// More bytes at the end of a document that is growing (a log). UTF-8 only.
function append(m) {
  if (ENCODING !== 'utf-8') throw new Fail('Only a UTF-8 document can be followed as it grows');
  const add = new Uint8Array(m.buffer);
  const old = B.length;
  const need = old + add.length;
  if (!OWNED || need > STORE.length) {
    const next = new Uint8Array(Math.max(Math.ceil(need * 1.5), 1 << 20));
    next.set(B, 0);
    STORE = next;
    OWNED = true;
  }
  STORE.set(add, old);
  B = STORE.subarray(0, need);
  if (LS) { LSCAN = Math.max(0, old - 1); buildLines(); }
  return { bytes: B.length, lines: LS ? LN : 0 };
}

// The text of the whole document (Copy all). Refused above `limit` bytes.
function textGet(m) {
  const limit = m.limit || 64 * 1024 * 1024;
  if (B.length > limit) throw new Fail('This document is larger than {mb} MB: save it instead of copying it', { mb: Math.round(limit / 1048576) });
  return { text: decoder.decode(B) };
}

// ================================================================ TREE (JSON, JSON Lines, XML)
// Kinds. JSON: object, array, string, number, true, false, null, and error (a JSON Lines line that did not parse). XML: element, text, comment...
const OBJ = 0, ARR = 1, STR = 2, NUM = 3, TRU = 4, FAL = 5, NUL = 6, ERR = 7;
const ELEM = 10, TEXT = 12, COMMENT = 13, CDATA = 14, PI = 15, DOCTYPE = 16, DOC = 17;
const F_OPEN = 1, F_LEAF = 2;

let tree = null;
let errMsg = new Map();

function newTree(kind, estimate) {
  const cap = Math.max(1024, Math.min(estimate, 1 << 25));
  return {
    kind, n: 0, cap,
    k: new Uint8Array(cap), flags: new Uint8Array(cap),
    parent: new Int32Array(cap), first: new Int32Array(cap), next: new Int32Array(cap),
    keyS: new Int32Array(cap), keyE: new Int32Array(cap), valS: new Int32Array(cap), valE: new Int32Array(cap),
    count: new Int32Array(cap),
    attrS: kind === 'xml' ? new Int32Array(cap) : null, attrE: kind === 'xml' ? new Int32Array(cap) : null,
    vis: new Int32Array(4096), visD: new Uint16Array(4096), visN: 0, hidden: false, nodes: 0, badLines: 0,
  };
}

function ensure(t) {
  if (t.n < t.cap) return;
  const cap = Math.ceil(t.cap * 1.5);
  t.k = grown(t.k, cap, Uint8Array); t.flags = grown(t.flags, cap, Uint8Array);
  for (const f of ['parent', 'first', 'next', 'keyS', 'keyE', 'valS', 'valE', 'count']) t[f] = grown(t[f], cap, Int32Array);
  if (t.attrS) { t.attrS = grown(t.attrS, cap, Int32Array); t.attrE = grown(t.attrE, cap, Int32Array); }
  t.cap = cap;
}

// A new node as the last child of `parent`, whose last child so far is `last` (-1: none). For an array's item keyS is -1 and keyE the index.
function alloc(t, kind, parent, last, keyS, keyE) {
  ensure(t);
  const id = t.n++;
  t.k[id] = kind; t.flags[id] = 0; t.parent[id] = parent; t.first[id] = -1; t.next[id] = -1;
  t.keyS[id] = keyS; t.keyE[id] = keyE; t.valS[id] = 0; t.valE[id] = 0; t.count[id] = 0;
  if (t.attrS) { t.attrS[id] = 0; t.attrE[id] = 0; }
  if (parent >= 0) {
    if (last < 0) t.first[parent] = id; else t.next[last] = id;
    t.count[parent]++;
  }
  return id;
}

class ParseError extends Fail {
  constructor(message, offset, args) { super(message, args); this.offset = offset; }
}

const isWs = (c) => c === 32 || c === 10 || c === 13 || c === 9;
const MAX_DEPTH = 4000;

function skip(p, end) {
  while (p < end && isWs(B[p])) p++;
  return p;
}
function lit(p, end, word) {
  if (p + word.length > end) return false;
  for (let i = 1; i < word.length; i++) if (B[p + i] !== word.charCodeAt(i)) return false;
  const after = p + word.length < end ? B[p + word.length] : 0;
  return !((after >= 97 && after <= 122) || (after >= 65 && after <= 90) || (after >= 48 && after <= 57) || after === 95);
}
// p is at the opening quote; returns the position after the closing quote.
function scanString(p, end) {
  let i = p + 1;
  while (i < end) {
    const c = B[i];
    if (c === 34) return i + 1;
    if (c === 92) { i += 2; continue; }
    if (c < 32) throw new ParseError('A raw line break or control character inside a string', i);
    i++;
  }
  throw new ParseError('A string is not closed', p);
}
function scanNumber(p, end) {
  let i = p;
  if (B[i] === 45) i++;
  if (B[i] === 48) i++;
  else if (B[i] >= 49 && B[i] <= 57) while (i < end && B[i] >= 48 && B[i] <= 57) i++;
  else throw new ParseError('This is not a valid number', p);
  if (i < end && B[i] === 46) {
    i++;
    if (!(i < end && B[i] >= 48 && B[i] <= 57)) throw new ParseError('A digit was expected after the decimal point', i);
    while (i < end && B[i] >= 48 && B[i] <= 57) i++;
  }
  if (i < end && (B[i] === 101 || B[i] === 69)) {
    i++;
    if (i < end && (B[i] === 43 || B[i] === 45)) i++;
    if (!(i < end && B[i] >= 48 && B[i] <= 57)) throw new ParseError('A digit was expected in the exponent', i);
    while (i < end && B[i] >= 48 && B[i] <= 57) i++;
  }
  return i;
}

// ---- JSON
// Parses the one value that starts at `p`, as a child of `parent` (-1: free-standing) with the given key span. Returns { p, root }.
function parseJsonValue(t, p, end, parent, keyS, keyE) {
  const nodes = [], lasts = [], isObj = [];
  let root = -1;
  let ks = keyS, ke = keyE;
  let pendS = -1, pendE = 0;

  const readKey = () => {
    p = skip(p, end);
    if (p >= end) throw new ParseError('The object is not closed', p);
    if (B[p] !== 34) throw new ParseError('A key (in double quotes) was expected', p);
    const s = p + 1;
    p = scanString(p, end);
    pendS = s; pendE = p - 1;
    p = skip(p, end);
    if (p >= end || B[p] !== 58) throw new ParseError('A colon (:) was expected after the key', p);
    p++;
  };
  const add = (kind) => {
    const top = nodes.length - 1;
    let id;
    if (top < 0) id = alloc(t, kind, parent, -1, ks, ke);
    else {
      const owner = nodes[top];
      id = isObj[top] ? alloc(t, kind, owner, lasts[top], pendS, pendE) : alloc(t, kind, owner, lasts[top], -1, t.count[owner]);
      lasts[top] = id;
    }
    if (root < 0) root = id;
    return id;
  };

  for (;;) {
    // ---- a value
    p = skip(p, end);
    if (p >= end) throw new ParseError('A value was expected', p);
    const c = B[p];
    let opened = false;
    if (c === 123 || c === 91) {
      if (nodes.length >= MAX_DEPTH) throw new ParseError('Nested deeper than {n} levels', p, { n: MAX_DEPTH });
      const id = add(c === 123 ? OBJ : ARR);
      t.valS[id] = p;
      p = skip(p + 1, end);
      if (p < end && B[p] === (c === 123 ? 125 : 93)) { t.valE[id] = p + 1; p++; }
      else {
        nodes.push(id); lasts.push(-1); isObj.push(c === 123);
        if (c === 123) readKey();
        opened = true;
      }
    } else if (c === 34) {
      const id = add(STR); const s = p + 1; p = scanString(p, end); t.valS[id] = s; t.valE[id] = p - 1;
    } else if (c === 45 || (c >= 48 && c <= 57)) {
      const id = add(NUM); const s = p; p = scanNumber(p, end); t.valS[id] = s; t.valE[id] = p;
    } else if (c === 116 && lit(p, end, 'true')) { const id = add(TRU); t.valS[id] = p; p += 4; t.valE[id] = p; }
    else if (c === 102 && lit(p, end, 'false')) { const id = add(FAL); t.valS[id] = p; p += 5; t.valE[id] = p; }
    else if (c === 110 && lit(p, end, 'null')) { const id = add(NUL); t.valS[id] = p; p += 4; t.valE[id] = p; }
    else throw new ParseError(c === 93 || c === 125 ? 'A value was expected here, not a closing bracket' : 'This is not valid JSON', p);
    if (opened) continue;
    // ---- after a value: a comma and the next one, or the close of the container (and of those above it)
    for (;;) {
      if (!nodes.length) return { p, root };
      p = skip(p, end);
      const top = nodes.length - 1;
      if (p >= end) throw new ParseError(isObj[top] ? 'The object is not closed' : 'The array is not closed', p);
      const d = B[p];
      if (d === 44) { p++; if (isObj[top]) readKey(); break; }
      if (d === (isObj[top] ? 125 : 93)) { t.valE[nodes[top]] = p + 1; p++; nodes.pop(); lasts.pop(); isObj.pop(); continue; }
      throw new ParseError(isObj[top] ? 'A comma or a closing } was expected' : 'A comma or a closing ] was expected', p);
    }
  }
}

function openJson() {
  const t = newTree('json', Math.floor(B.length / 9));
  tree = t; errMsg = new Map();
  let p = skip(0, B.length);
  if (p >= B.length) throw new ParseError('The document is empty', 0);
  const r = parseJsonValue(t, p, B.length, -1, -1, 0);
  p = skip(r.p, B.length);
  if (p < B.length) throw new ParseError('There is more after the end of the JSON value', p);
  finishTree(t);
  return treeInfo();
}

// JSON Lines: a hidden document node, and one child per non-empty line. A line that is not JSON becomes an error node, so one bad
// line does not hide the others.
function openJsonLines() {
  const t = newTree('jsonl', Math.floor(B.length / 9));
  tree = t; errMsg = new Map();
  const doc = alloc(t, DOC, -1, -1, -1, 0);
  t.hidden = true;
  let last = -1, lineNo = 0, p = 0;
  const n = B.length;
  while (p < n) {
    let e = B.indexOf(10, p);
    if (e === -1) e = n;
    lineNo++;
    let le = e;
    if (le > p && B[le - 1] === 13) le--;
    const ls = skip(p, le);
    if (ls < le) {
      const mark = t.n;
      let id = -1, failure = null;
      try {
        const r = parseJsonValue(t, ls, le, -1, -1, lineNo);
        const after = skip(r.p, le);
        if (after < le) throw new ParseError('There is more after the end of the JSON value', after);
        id = r.root;
      } catch (err) {
        if (!(err instanceof ParseError)) throw err;
        failure = err;
      }
      if (failure) {
        t.n = mark;      // what the failed line half-made is dropped
        id = alloc(t, ERR, -1, -1, -1, lineNo);
        t.valS[id] = ls; t.valE[id] = le;
        errMsg.set(id, { m: failure.tpl, a: failure.args || null, col: failure.offset - ls + 1 });
        t.badLines++;
      }
      // link the line as the next child of the document
      t.parent[id] = doc;
      if (last < 0) t.first[doc] = id; else t.next[last] = id;
      t.count[doc]++;
      t.keyS[id] = -1; t.keyE[id] = lineNo;
      last = id;
    }
    p = e + 1;
  }
  if (t.count[doc] === 0) throw new ParseError('There is no JSON in this document', 0);
  finishTree(t);
  return treeInfo();
}

// ---- XML
function nameEnd(p, end) {
  let i = p;
  while (i < end) { const c = B[i]; if (isWs(c) || c === 62 || c === 47 || c === 61) break; i++; }
  return i;
}
function indexOfSeq(seq, from) {
  const first = seq.charCodeAt(0);
  let i = B.indexOf(first, from);
  outer: while (i !== -1) {
    for (let j = 1; j < seq.length; j++) if (B[i + j] !== seq.charCodeAt(j)) { i = B.indexOf(first, i + 1); continue outer; }
    return i;
  }
  return -1;
}
function sameName(aS, aE, bS, bE) {
  if (aE - aS !== bE - bS) return false;
  for (let i = 0; i < aE - aS; i++) if (B[aS + i] !== B[bS + i]) return false;
  return true;
}

function openXml() {
  const t = newTree('xml', Math.floor(B.length / 40));
  tree = t; errMsg = new Map();
  const doc = alloc(t, DOC, -1, -1, -1, 0);
  t.hidden = true;
  const n = B.length;
  const stack = [doc], lasts = [-1];       // open elements, and the last child of each so far
  let p = 0, roots = 0;
  const add = (kind, ks, ke, vs, ve) => {
    const d = stack.length - 1;
    const id = alloc(t, kind, stack[d], lasts[d], ks, ke);
    lasts[d] = id;
    t.valS[id] = vs; t.valE[id] = ve;
    return id;
  };
  while (p < n) {
    if (B[p] !== 60) {
      let e = B.indexOf(60, p);
      if (e === -1) e = n;
      let s = p, f = e;
      while (s < f && isWs(B[s])) s++;
      while (f > s && isWs(B[f - 1])) f--;
      if (s < f) {
        if (stack.length === 1) throw new ParseError('Text outside of the root element', s);
        add(TEXT, -1, 0, s, f);
      }
      p = e;
      continue;
    }
    const c1 = B[p + 1];
    if (c1 === 63) {            // <? ... ?>
      const e = indexOfSeq('?>', p + 2);
      if (e === -1) throw new ParseError('A processing instruction (<?) is not closed', p);
      add(PI, p + 2, nameEnd(p + 2, e), p, e + 2);
      p = e + 2;
    } else if (c1 === 33) {     // <! ...
      if (B[p + 2] === 45 && B[p + 3] === 45) {
        const e = indexOfSeq('-->', p + 4);
        if (e === -1) throw new ParseError('A comment is not closed', p);
        add(COMMENT, -1, 0, p + 4, e);
        p = e + 3;
      } else if (B[p + 2] === 91 && str(p + 3, p + 9) === 'CDATA[') {
        const e = indexOfSeq(']]>', p + 9);
        if (e === -1) throw new ParseError('A CDATA section is not closed', p);
        add(CDATA, -1, 0, p + 9, e);
        p = e + 3;
      } else {
        // <!DOCTYPE ... [ ... ]> : to the matching >
        let i = p + 2, depth = 0, quote = 0;
        for (; i < n; i++) {
          const c = B[i];
          if (quote) { if (c === quote) quote = 0; continue; }
          if (c === 34 || c === 39) quote = c;
          else if (c === 91) depth++;
          else if (c === 93) depth--;
          else if (c === 62 && depth <= 0) break;
        }
        if (i >= n) throw new ParseError('A declaration (<!) is not closed', p);
        add(DOCTYPE, p + 2, nameEnd(p + 2, i), p, i + 1);
        p = i + 1;
      }
    } else if (c1 === 47) {     // </name>
      const ns = p + 2;
      const e = B.indexOf(62, ns);
      if (e === -1) throw new ParseError('A closing tag is not finished', p);
      let ne = e;
      while (ne > ns && isWs(B[ne - 1])) ne--;
      const top = stack[stack.length - 1];
      if (stack.length === 1) throw new ParseError('A closing tag </{name}> has no opening tag', p, { name: str(ns, ne) });
      if (!sameName(t.keyS[top], t.keyE[top], ns, ne)) throw new ParseError('The closing tag </{a}> does not match <{b}>', p, { a: str(ns, ne), b: str(t.keyS[top], t.keyE[top]) });
      t.valE[top] = e + 1;
      // an element holding only one piece of text is shown on one row
      if (t.count[top] === 1 && t.k[t.first[top]] === TEXT) t.flags[top] |= F_LEAF;
      stack.pop(); lasts.pop();
      p = e + 1;
    } else {                    // <name attr="v" ...> or <name/>
      const ns = p + 1;
      const ne = nameEnd(ns, n);
      if (ne === ns) throw new ParseError('A tag has no name', p);
      let i = ne;
      let selfClose = false;
      for (;;) {
        while (i < n && isWs(B[i])) i++;
        if (i >= n) throw new ParseError('The tag <{name}> is not finished', p, { name: str(ns, ne) });
        const c = B[i];
        if (c === 62) break;
        if (c === 47 && B[i + 1] === 62) { selfClose = true; i++; break; }
        const as = i;
        const ae = nameEnd(i, n);
        if (ae === as) throw new ParseError('An attribute is not valid', i);
        i = ae;
        while (i < n && isWs(B[i])) i++;
        if (B[i] !== 61) throw new ParseError('The attribute {name} has no value', i, { name: str(as, ae) });
        i++;
        while (i < n && isWs(B[i])) i++;
        const q = B[i];
        if (q !== 34 && q !== 39) throw new ParseError('The value of {name} must be in quotes', i, { name: str(as, ae) });
        const qe = B.indexOf(q, i + 1);
        if (qe === -1) throw new ParseError('The value of {name} is not closed', i, { name: str(as, ae) });
        i = qe + 1;
      }
      const tagEnd = i + 1;
      if (stack.length === 1) roots++;
      const id = add(ELEM, ns, ne, p, tagEnd);
      t.attrS[id] = ne;
      t.attrE[id] = selfClose ? i - 1 : i;
      if (selfClose) t.flags[id] |= F_LEAF;
      else { stack.push(id); lasts.push(-1); }
      p = tagEnd;
    }
  }
  if (stack.length > 1) {
    const open = stack[stack.length - 1];
    throw new ParseError('The element <{name}> is never closed', t.valS[open], { name: str(t.keyS[open], t.keyE[open]) });
  }
  if (roots === 0) throw new ParseError('There is no element in this document', 0);
  finishTree(t);
  return treeInfo();
}

// ---- both
function finishTree(t) {
  t.nodes = t.n;
  autoOpen(t);
  rebuild(t);
}

function expandable(t, n) {
  const k = t.k[n];
  return (k === OBJ || k === ARR || k === ELEM || k === DOC) && t.count[n] > 0 && !(t.flags[n] & F_LEAF);
}

// The top of the tree is opened for the person: the root, then the next levels while the list stays short.
function autoOpen(t) {
  if (expandable(t, 0)) t.flags[0] |= F_OPEN;
  let rows = 1 + (expandable(t, 0) ? t.count[0] : 0);
  const queue = [];
  for (let c = t.first[0]; c !== -1; c = t.next[c]) queue.push(c);
  let head = 0;
  while (head < queue.length && rows < 120) {
    const n = queue[head++];
    if (!expandable(t, n) || rows + t.count[n] > 400) continue;
    t.flags[n] |= F_OPEN;
    rows += t.count[n];
    for (let c = t.first[n]; c !== -1; c = t.next[c]) queue.push(c);
  }
}

// The list of visible rows: the open branches, in order, with their depth.
function rebuild(t) {
  let count = 0;
  const rootN = t.hidden ? t.first[0] : 0;
  let n = rootN, depth = 0;
  while (n !== -1) {
    if (count >= t.vis.length) { t.vis = grown(t.vis, t.vis.length * 2, Int32Array); t.visD = grown(t.visD, t.visD.length * 2, Uint16Array); }
    t.vis[count] = n; t.visD[count] = depth > 65535 ? 65535 : depth; count++;
    if ((t.flags[n] & F_OPEN) && t.first[n] !== -1) { n = t.first[n]; depth++; continue; }
    while (n !== -1) {
      if (t.next[n] !== -1) { n = t.next[n]; break; }
      n = t.parent[n]; depth--;
      if (n === -1 || (t.hidden && n === 0)) { n = -1; break; }
    }
  }
  t.visN = count;
}

function treeInfo() {
  const t = tree;
  return { nodes: t.nodes, rows: t.visN, bad: t.badLines, tkind: t.kind };
}

const TYPE_CHAR = { [OBJ]: 'o', [ARR]: 'a', [STR]: 's', [NUM]: 'n', [TRU]: 'b', [FAL]: 'b', [NUL]: 'z', [ERR]: 'e', [ELEM]: 'E', [TEXT]: 'T', [COMMENT]: 'C', [CDATA]: 'D', [PI]: 'P', [DOCTYPE]: 'Q', [DOC]: 'd' };

function decodeKey(t, n) {
  const s = t.keyS[n];
  if (s < 0) return null;
  const raw = str(s, t.keyE[n]);
  if (t.kind === 'json' || t.kind === 'jsonl') {
    if (raw.indexOf('\\') === -1) return raw;
    try { return JSON.parse('"' + raw + '"'); } catch { return raw; }
  }
  return raw;
}

const PREVIEW = 300;
// The text of a string value, escapes resolved, at most `cap` characters.
function decodeStringValue(t, n, cap) {
  const s = t.valS[n];
  let e = t.valE[n];
  let clipped = false;
  if (e - s > cap * 3) {
    e = s + cap * 3; while (e > s && (B[e] & 0xc0) === 0x80) e--;
    // do not cut an escape sequence in half
    let back = 0;
    while (e - back > s && B[e - back - 1] === 92) back++;
    if (back % 2) e--;
    clipped = true;
  }
  let text = str(s, e);
  if (text.indexOf('\\') !== -1) { try { text = JSON.parse('"' + text + '"'); } catch { /* vex-allow-empty-catch: a stray backslash in a string the preview cut: the raw text is shown */ } }
  if (text.length > cap) { text = text.slice(0, cap); clipped = true; }
  return { text, clipped };
}

const ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" };
function decodeText(t, n, cap) {
  const s = t.valS[n];
  let e = t.valE[n];
  let clipped = false;
  if (e - s > cap * 3) { e = s + cap * 3; while (e > s && (B[e] & 0xc0) === 0x80) e--; clipped = true; }
  let text = str(s, e);
  if (t.k[n] === TEXT) {
    text = text.replace(/&(?:lt|gt|amp|quot|apos);|&#(\d+);|&#x([0-9a-f]+);/gi, (m, d, h) => {
      if (d || h) { try { return String.fromCodePoint(d ? Number(d) : parseInt(h, 16)); } catch { return m; } }
      return ENTITIES[m.toLowerCase()] || m;
    });
  }
  text = text.replace(/\s+/g, ' ');
  if (text.length > cap) { text = text.slice(0, cap); clipped = true; }
  return { text, clipped };
}

function rowFor(t, i) {
  const n = t.vis[i];
  const k = t.k[n];
  const row = { n, d: t.visD[i], t: TYPE_CHAR[k], x: (t.flags[n] & F_OPEN) ? 1 : 0, c: t.count[n], e: expandable(t, n) ? 1 : 0 };
  const key = k === ELEM ? str(t.keyS[n], t.keyE[n]) : decodeKey(t, n);
  if (key !== null) row.k = key;
  else if (t.parent[n] >= 0 && (t.k[t.parent[n]] === ARR || (t.kind === 'jsonl' && t.parent[n] === 0))) row.i = t.keyE[n];
  if (k === STR) { const v = decodeStringValue(t, n, PREVIEW); row.v = v.text; if (v.clipped) row.m = 1; }
  else if (k === NUM || k === TRU || k === FAL || k === NUL) row.v = str(t.valS[n], t.valE[n]);
  else if (k === ERR) { row.v = str(t.valS[n], Math.min(t.valE[n], t.valS[n] + PREVIEW)); row.err = errMsg.get(n) || { m: 'This is not valid JSON', a: null, col: 1 }; }
  else if (k === OBJ && !row.x && row.c > 0) {
    // A closed object shows its first keys, so it can be told from its neighbours without opening it.
    const keys = [];
    for (let c = t.first[n]; c !== -1 && keys.length < 4; c = t.next[c]) keys.push(decodeKey(t, c));
    row.p = keys.join(', ') + (row.c > keys.length ? ', ...' : '');
  } else if (k === ELEM) {
    const as = t.attrS[n], ae = t.attrE[n];
    if (ae > as) row.a = str(as, Math.min(ae, as + 600));
    if ((t.flags[n] & F_LEAF) && t.count[n] === 1) { const v = decodeText(t, t.first[n], PREVIEW); row.v = v.text; if (v.clipped) row.m = 1; }
  } else if (k === TEXT || k === COMMENT || k === CDATA) { const v = decodeText(t, n, PREVIEW); row.v = v.text; if (v.clipped) row.m = 1; }
  else if (k === PI || k === DOCTYPE) row.v = str(t.valS[n], Math.min(t.valE[n], t.valS[n] + PREVIEW));
  return row;
}

function treeRows(m) {
  const t = tree;
  const from = Math.max(0, m.from | 0), to = Math.min(t.visN, from + Math.min(m.count | 0, 500));
  const rows = [];
  for (let i = from; i < to; i++) rows.push(rowFor(t, i));
  return { from, rows, total: t.visN };
}

function rowIndex(t, n) { return t.vis.subarray(0, t.visN).indexOf(n); }

function treeToggle(m) {
  const t = tree;
  const n = m.node | 0;
  if (!expandable(t, n)) return { total: t.visN, changed: false, row: rowIndex(t, n) };
  const want = m.open === undefined ? !(t.flags[n] & F_OPEN) : !!m.open;
  const set = (x) => { if (want) t.flags[x] |= F_OPEN; else t.flags[x] &= ~F_OPEN; };
  set(n);
  if (m.deep) {
    const stack = [n];
    while (stack.length) {
      const x = stack.pop();
      for (let c = t.first[x]; c !== -1; c = t.next[c]) if (expandable(t, c)) { set(c); stack.push(c); }
    }
  }
  rebuild(t);
  return { total: t.visN, changed: true, row: rowIndex(t, n) };
}

function treeAll(m) {
  const t = tree;
  if (m.open) {
    if (t.nodes > 6000000) throw new Fail('This document has too many branches to open them all at once');
    for (let i = 0; i < t.n; i++) if (expandable(t, i)) t.flags[i] |= F_OPEN;
  } else {
    for (let i = 0; i < t.n; i++) t.flags[i] &= ~F_OPEN;
    if (expandable(t, 0)) t.flags[0] |= F_OPEN;
  }
  rebuild(t);
  return { total: t.visN };
}

// Opens every branch above `n`; returns the row of n.
function treeReveal(m) {
  const t = tree;
  const n = m.node | 0;
  for (let p = t.parent[n]; p >= 0; p = t.parent[p]) t.flags[p] |= F_OPEN;
  rebuild(t);
  return { total: t.visN, row: rowIndex(t, n) };
}

// The row of the branch a node belongs to (-1: it is at the top).
function treeParentRow(m) {
  const t = tree;
  const p = t.parent[m.node | 0];
  return { row: p < 0 || (t.hidden && p === 0) ? -1 : rowIndex(t, p) };
}

const startOf = (t, n) => (t.keyS[n] >= 0 ? t.keyS[n] : t.valS[n]);

// The nodes whose key, value or attributes hold the query, in document order.
function treeFind(m) {
  const t = tree;
  const r = findAll(m.q, !!m.cs, m.cap || 50000);
  const found = [];
  let lastNode = -1;
  for (const o of r.hits) {
    let lo = 0, hi = t.n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (startOf(t, mid) <= o) lo = mid; else hi = mid - 1; }
    let n = -1;
    for (let c = lo, tries = 0; c >= 0 && tries < 3; c--, tries++) {
      const k = t.k[c];
      // the quotes round a JSON key or string count as part of it
      const quote = t.kind === 'xml' ? 0 : 1;
      const inKey = t.keyS[c] >= 0 && o >= t.keyS[c] - quote && o < t.keyE[c] + quote;
      const inAttrs = k === ELEM && o >= t.attrS[c] && o < t.attrE[c];
      const q2 = k === STR ? 1 : 0;
      const inValue = k !== OBJ && k !== ARR && k !== ELEM && k !== DOC && o >= t.valS[c] - q2 && o < t.valE[c] + q2;
      if (inKey || inAttrs || inValue) { n = c; break; }
    }
    if (n < 0) continue;
    // text that is the only child of an element is shown on the element's row
    if (t.k[n] === TEXT && t.parent[n] >= 0 && (t.flags[t.parent[n]] & F_LEAF)) n = t.parent[n];
    if (n !== lastNode) { found.push(n); lastNode = n; }
  }
  const nodes = Int32Array.from(found);
  return { nodes, capped: r.capped, __transfer: [nodes.buffer] };
}

function pathOf(t, n) {
  const parts = [];
  for (let x = n; x >= 0; x = t.parent[x]) parts.push(x);
  parts.reverse();
  if (t.kind === 'xml') {
    let out = '';
    for (const x of parts) {
      const k = t.k[x];
      if (k === DOC) continue;
      if (k === ELEM) {
        let nth = 0, total = 0;
        for (let s = t.first[t.parent[x]]; s !== -1; s = t.next[s]) if (t.k[s] === ELEM && sameName(t.keyS[s], t.keyE[s], t.keyS[x], t.keyE[x])) { total++; if (s === x) nth = total; }
        out += '/' + str(t.keyS[x], t.keyE[x]) + (total > 1 ? '[' + nth + ']' : '');
      } else out += k === TEXT || k === CDATA ? '/text()' : k === COMMENT ? '/comment()' : '/node()';
    }
    return out || '/';
  }
  let out = '$';
  for (const x of parts) {
    if (x === 0 || t.k[x] === DOC) continue;
    const key = decodeKey(t, x);
    if (key !== null) out += /^[A-Za-z_$][\w$]*$/.test(key) ? '.' + key : '[' + JSON.stringify(key) + ']';
    else out += '[' + (t.kind === 'jsonl' && t.parent[x] === 0 ? t.keyE[x] - 1 : t.keyE[x]) + ']';
  }
  return out;
}

const COPY_LIMIT = 24 * 1024 * 1024;
function treeValue(m) {
  const t = tree;
  const n = m.node | 0;
  const k = t.k[n];
  const info = { path: pathOf(t, n), type: TYPE_CHAR[k] };
  if (m.what === 'path') return info;
  if (k === STR) { info.text = decodeStringValue(t, n, 50 * 1024 * 1024).text; return info; }
  if (k === OBJ || k === ARR) {
    if (t.valE[n] - t.valS[n] > COPY_LIMIT) throw new Fail('This branch is larger than {mb} MB: it is too big to copy', { mb: Math.round(COPY_LIMIT / 1048576) });
    const raw = str(t.valS[n], t.valE[n]);
    try { info.text = JSON.stringify(JSON.parse(raw), null, 2); } catch { info.text = raw; }
    return info;
  }
  if (k === ELEM || k === DOC) {
    if (t.valE[n] - t.valS[n] > COPY_LIMIT) throw new Fail('This element is larger than {mb} MB: it is too big to copy', { mb: Math.round(COPY_LIMIT / 1048576) });
    info.text = str(t.valS[n], t.valE[n]);
    return info;
  }
  info.text = k === TEXT || k === COMMENT || k === CDATA ? decodeText(t, n, 50 * 1024 * 1024).text : str(t.valS[n], t.valE[n]);
  return info;
}

function treeStats() {
  const t = tree;
  const counts = {};
  for (let i = 0; i < t.n; i++) counts[TYPE_CHAR[t.k[i]]] = (counts[TYPE_CHAR[t.k[i]]] || 0) + 1;
  return { counts };
}

// ================================================================ CSV
let csv = null;

const DELIMS = [44, 59, 9, 124];       // , ; tab |

function detectDelimiter() {
  const n = Math.min(B.length, 65536);
  let best = 44, bestScore = -1;
  for (const d of DELIMS) {
    const counts = [];
    let inq = false, cnt = 0;
    for (let i = 0; i < n && counts.length < 20; i++) {
      const c = B[i];
      if (c === 34) inq = !inq;
      else if (!inq && c === d) cnt++;
      else if (!inq && c === 10) { counts.push(cnt); cnt = 0; }
    }
    if (!counts.length) counts.push(cnt);
    const first = counts[0];
    if (first === 0) continue;
    const score = counts.filter((x) => x === first).length * 1000 + first;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

function openCsv(m) {
  const delim = m.delimiter && m.delimiter !== 'auto' ? (m.delimiter === 'tab' ? 9 : m.delimiter.charCodeAt(0)) : detectDelimiter();
  const n = B.length;
  let cap = Math.max(1024, Math.min(Math.floor(n / 24), 1 << 24));
  let starts = new Int32Array(cap), ends = new Int32Array(cap);
  let rows = 0, inq = false, start = 0;
  const pushRow = (s, e) => {
    if (e <= s) return;                           // an empty line is not a row
    if (rows >= cap) { cap *= 2; starts = grown(starts, cap, Int32Array); ends = grown(ends, cap, Int32Array); }
    starts[rows] = s; ends[rows] = e; rows++;
  };
  for (let i = 0; i < n; i++) {
    const c = B[i];
    if (c === 34) inq = !inq;
    else if (!inq && (c === 10 || c === 13)) {
      pushRow(start, i);
      if (c === 13 && B[i + 1] === 10) i++;
      start = i + 1;
    }
  }
  if (start < n) pushRow(start, n);
  csv = { delim, starts, ends, rows, header: m.header !== false, unclosed: inq, sort: null, filter: null, keyCache: new Map(), types: null, cols: 0, head: [], view: null };
  const head = csv.header && rows > 0 ? parseRow(0) : null;
  let cols = head ? head.length : 0;
  const sample = Math.min(rows, 1500);
  for (let r = csv.header ? 1 : 0; r < sample; r++) { const x = cellCount(r); if (x > cols) cols = x; }
  csv.cols = cols;
  csv.head = head ? head.concat(new Array(Math.max(0, cols - head.length)).fill('')) : Array.from({ length: cols }, (_, c) => 'Column ' + (c + 1));
  csv.types = inferTypes();
  applyView();
  return csvInfo();
}

function cellCount(r) {
  let cnt = 1, inq = false;
  for (let i = csv.starts[r], e = csv.ends[r]; i < e; i++) {
    const c = B[i];
    if (c === 34) inq = !inq;
    else if (!inq && c === csv.delim) cnt++;
  }
  return cnt;
}

function parseRow(r) {
  const s = csv.starts[r], e = csv.ends[r], d = csv.delim;
  const out = [];
  let i = s;
  for (;;) {
    if (i < e && B[i] === 34) {
      let j = i + 1;
      const parts = [];
      let from = j;
      for (;;) {
        const q = B.indexOf(34, j);
        if (q === -1 || q >= e) { parts.push(str(from, e)); j = e; break; }
        if (q + 1 < e && B[q + 1] === 34) { parts.push(str(from, q + 1)); j = q + 2; from = j; continue; }
        parts.push(str(from, q)); j = q + 1; break;
      }
      let k = j;
      while (k < e && B[k] !== d) k++;
      out.push(parts.join('') + (k > j ? str(j, k) : ''));
      if (k >= e) break;
      i = k + 1;
    } else {
      let k = i;
      while (k < e && B[k] !== d) k++;
      out.push(str(i, k));
      if (k >= e) break;
      i = k + 1;
    }
  }
  return out;
}

const NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const INT_RE = /^[+-]?\d+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
function inferTypes() {
  const first = csv.header ? 1 : 0;
  const total = csv.rows - first;
  const take = Math.min(total, 2000);
  const rows = [];
  for (let r = 0; r < take; r++) rows.push(parseRow(first + Math.floor(r * (total / Math.max(1, take)))));
  const types = [];
  for (let c = 0; c < csv.cols; c++) {
    let seen = 0, ints = 0, nums = 0, dates = 0, bools = 0;
    for (const row of rows) {
      const v = (row[c] || '').trim();
      if (v === '') continue;
      seen++;
      if (INT_RE.test(v)) { ints++; nums++; } else if (NUM_RE.test(v)) nums++;
      else if (DATE_RE.test(v)) dates++;
      else if (/^(?:true|false)$/i.test(v)) bools++;
    }
    types.push(!seen ? 'text' : ints === seen ? 'integer' : nums === seen ? 'number' : dates === seen ? 'date' : bools === seen ? 'boolean' : 'text');
  }
  return types;
}

function csvInfo() {
  return { rows: csv.rows - (csv.header ? 1 : 0), shown: csv.view.length, cols: csv.cols, head: csv.head, types: csv.types, delimiter: csv.delim === 9 ? 'tab' : String.fromCharCode(csv.delim), unclosed: csv.unclosed };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function sortKeys(col, type) {
  const k = col + ':' + type;
  if (csv.keyCache.has(k)) return csv.keyCache.get(k);
  const first = csv.header ? 1 : 0;
  const total = csv.rows - first;
  let keys;
  if (type === 'integer' || type === 'number' || type === 'date') {
    keys = new Float64Array(total);
    for (let r = 0; r < total; r++) {
      const v = parseRow(first + r)[col];
      keys[r] = v === undefined || v.trim() === '' ? NaN : (type === 'date' ? Date.parse(v) : Number(v));
    }
  } else {
    keys = new Array(total);
    for (let r = 0; r < total; r++) keys[r] = parseRow(first + r)[col] || '';
  }
  csv.keyCache.set(k, keys);
  if (csv.keyCache.size > 3) csv.keyCache.delete(csv.keyCache.keys().next().value);
  return keys;
}

// The rows shown: all data rows, kept by the filter, in the order of the sort.
function applyView() {
  const first = csv.header ? 1 : 0;
  const total = csv.rows - first;
  let idx;
  const f = csv.filter;
  const colFilters = f && f.cols ? Object.entries(f.cols).map(([c, v]) => [Number(c), String(v).toLowerCase()]).filter(([, v]) => v) : [];
  const q = f && f.q ? String(f.q).toLowerCase() : '';
  if (q || colFilters.length) {
    const out = [];
    for (let r = 0; r < total; r++) {
      if (q && str(csv.starts[first + r], csv.ends[first + r]).toLowerCase().indexOf(q) === -1) continue;
      if (colFilters.length) {
        const cells = parseRow(first + r);
        let ok = true;
        for (const [c, v] of colFilters) if ((cells[c] || '').toLowerCase().indexOf(v) === -1) { ok = false; break; }
        if (!ok) continue;
      }
      out.push(r);
    }
    idx = Int32Array.from(out);
  } else {
    idx = new Int32Array(total);
    for (let r = 0; r < total; r++) idx[r] = r;
  }
  const s = csv.sort;
  if (s && s.col < csv.cols && idx.length > 1) {
    const keys = sortKeys(s.col, csv.types[s.col]);
    const dir = s.dir === 'desc' ? -1 : 1;
    const arr = Array.from(idx);
    if (keys instanceof Float64Array) {
      // an empty or unreadable value goes last whichever way the sort runs
      arr.sort((a, b) => {
        const x = keys[a], y = keys[b];
        const nx = x !== x, ny = y !== y;
        if (nx || ny) return nx && ny ? a - b : nx ? 1 : -1;
        return x === y ? a - b : (x < y ? -dir : dir);
      });
    } else arr.sort((a, b) => { const c = collator.compare(keys[a], keys[b]); return c ? c * dir : a - b; });
    idx = Int32Array.from(arr);
  }
  csv.view = idx;
}

function csvSet(m) {
  if (m.sort !== undefined) csv.sort = m.sort;
  if (m.filter !== undefined) csv.filter = m.filter;
  applyView();
  return { shown: csv.view.length, rows: csv.rows - (csv.header ? 1 : 0) };
}

function csvRows(m) {
  const first = csv.header ? 1 : 0;
  const from = Math.max(0, m.from | 0), to = Math.min(csv.view.length, from + Math.min(m.count | 0, 500));
  const rows = [], nums = [];
  for (let i = from; i < to; i++) {
    const r = csv.view[i];
    rows.push(parseRow(first + r).map((c) => (c.length > 2000 ? c.slice(0, 2000) : c)));
    nums.push(r + 1);
  }
  return { from, rows, nums, total: csv.view.length };
}

// The rows shown (filtered, sorted) as text with the delimiter in use, for Copy.
function csvText(m) {
  const first = csv.header ? 1 : 0;
  const limit = Math.min(csv.view.length, m.max || 200000);
  const lines = [];
  const d = csv.delim === 9 ? '\t' : String.fromCharCode(csv.delim);
  const q = (v) => (/["\n\r]/.test(v) || v.indexOf(d) !== -1 ? '"' + v.replace(/"/g, '""') + '"' : v);
  if (csv.header) lines.push(csv.head.map(q).join(d));
  for (let i = 0; i < limit; i++) lines.push(parseRow(first + csv.view[i]).map(q).join(d));
  return { text: lines.join('\n'), rows: limit };
}

// ================================================================ messages
const handlers = {
  init, linesInfo, linesGet, linesFind, append, textGet,
  openJson, openJsonLines, openXml, treeRows, treeToggle, treeAll, treeReveal, treeParentRow, treeFind, treeValue, treeStats,
  openCsv, csvSet, csvRows, csvText,
};

if (typeof self !== 'undefined') {
  self.onmessage = (event) => {
    const m = event.data;
    try {
      const fn = handlers[m.type];
      if (!fn) throw new Error('The worker does not know ' + m.type);
      const result = fn(m) || {};
      const transfer = result.__transfer;
      delete result.__transfer;
      self.postMessage({ id: m.id, ok: true, ...result }, transfer || []);
    } catch (err) {
      const out = { id: m.id, ok: false, error: err && err.message ? err.message : String(err), tpl: err && err.tpl ? err.tpl : null, args: err && err.args ? err.args : null };
      if (err instanceof ParseError) {
        const lc = lineColOf(err.offset);
        out.parse = true; out.line = lc.line; out.col = lc.col; out.offset = err.offset;
      }
      self.postMessage(out);
    }
  };
}
