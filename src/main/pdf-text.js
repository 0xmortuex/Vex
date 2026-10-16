// === The words inside a PDF ================================================
//
// A PDF is a set of objects, and the text lives in content streams that are
// almost always compressed (FlateDecode). The renderer cannot inflate those —
// so this runs in the main process, where zlib is.
//
// What it does, in order:
//   1. find every `… stream …endstream` and inflate the ones that say Flate
//   2. read the text-showing operators out of the result:
//        (text) Tj        one string
//        [(a) -20 (b)] TJ  a line broken up by kerning
//        T*, ', "          go to the next line
//   3. glue it back together, one line per line of the document
//
// It is not a renderer: a PDF that is a scan of paper has no text objects at
// all, and this says so rather than pretending. Encrypted PDFs come back empty
// too, which is the same answer from the reader's point of view.
const MAX_TEXT = 200000;

// Text inside ( ) with PDF's own escapes: \( \) \\ \n \t and \053 octal.
function unescapePdf(s) {
  return String(s)
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
    .replace(/\\b/g, '\b').replace(/\\f/g, '\f')
    .replace(/\\([()\\])/g, '$1');
}

// The text out of one content stream.
function textFromContent(content) {
  const out = [];
  let line = '';
  const push = () => { const t = line.replace(/\s+/g, ' ').trim(); if (t) out.push(t); line = ''; };
  // Each match is one operator we care about: a string, an array of strings,
  // or a move to the next line.
  const OPS = /\(((?:[^()\\]|\\[\s\S])*)\)\s*(Tj|')|\[((?:[^\]\\]|\\[\s\S])*)\]\s*TJ|(T\*|Td|TD|ET)/g;
  let m;
  while ((m = OPS.exec(content))) {
    if (m[1] !== undefined) {
      line += unescapePdf(m[1]);
      if (m[2] === "'") push();                     // ' shows the string on a new line
    } else if (m[3] !== undefined) {
      // [(He) -250 (llo)] TJ — the numbers are kerning; a big gap is a space.
      for (const part of m[3].matchAll(/\(((?:[^()\\]|\\[\s\S])*)\)|(-?\d+(?:\.\d+)?)/g)) {
        if (part[1] !== undefined) line += unescapePdf(part[1]);
        else if (Number(part[2]) < -180) line += ' ';
      }
    } else {
      push();
    }
  }
  push();
  return out.join('\n');
}

// Every stream in the file, inflated where it needs to be. `inflate` is
// injected so this can be tested without zlib, and so a stream that will not
// inflate (a broken or encrypted file) is skipped rather than throwing.
function streams(buffer, inflate) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const latin = bytes.toString('latin1');
  const out = [];
  const re = /stream\r?\n?/g;
  let m;
  while ((m = re.exec(latin))) {
    const start = m.index + m[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) break;
    const header = latin.slice(Math.max(0, m.index - 400), m.index);
    const raw = bytes.subarray(start, end);
    if (/FlateDecode/.test(header)) {
      try { out.push(inflate(raw).toString('latin1')); } catch { /* not ours to read */ }
    } else if (!/\/(DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode|RunLengthDecode|LZWDecode)/.test(header)) {
      out.push(raw.toString('latin1'));
    }
    re.lastIndex = end + 9;
  }
  return out;
}

// → the document's text, or '' when there is none to be had.
function extract(buffer, inflate) {
  const parts = [];
  for (const content of streams(buffer, inflate)) {
    if (!/\bBT\b|\bTj\b|\bTJ\b/.test(content)) continue;      // not a text stream
    const text = textFromContent(content);
    if (text) parts.push(text);
    if (parts.join('\n').length > MAX_TEXT) break;
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT);
}

// === The text page by page ================================================
// A paper brief has to say WHERE a claim is, so the pages are kept apart. Where the file's
// objects are readable (not packed into compressed object streams), the page tree is followed
// in order: /Pages -> /Kids -> each /Page -> its /Contents streams. When it is not, every text
// stream counts as one page in file order and `approx` is true: the page numbers are then a
// best guess and the caller must say so.
const MAX_PAGES = 400;
const MAX_PAGE_TEXT = 30000;

function objectsOf(buffer, inflate) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const latin = bytes.toString('latin1');
  const objs = new Map();      // number -> { dict (text before the stream), content (inflated stream or '') }
  const head = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = head.exec(latin))) {
    const bodyStart = m.index + m[0].length;
    const end = latin.indexOf('endobj', bodyStart);
    if (end < 0) break;
    const body = latin.slice(bodyStart, end);
    const si = body.search(/stream\r?\n?/);
    let dict = body, content = '';
    if (si >= 0) {
      dict = body.slice(0, si);
      const after = body.slice(si).match(/^stream\r?\n?/)[0].length;
      const es = body.lastIndexOf('endstream');
      const raw = bytes.subarray(bodyStart + si + after, es >= 0 ? bodyStart + es : end);
      if (/FlateDecode/.test(dict)) { try { content = inflate(raw).toString('latin1'); } catch { content = ''; } }
      else if (!/\/(DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode|RunLengthDecode|LZWDecode)/.test(dict)) content = raw.toString('latin1');
    }
    objs.set(Number(m[1]), { dict, content });
    head.lastIndex = end + 6;
  }
  return objs;
}

function refs(text) { return [...String(text).matchAll(/(\d+)\s+\d+\s+R\b/g)].map(r => Number(r[1])); }

function extractPages(buffer, inflate) {
  const objs = objectsOf(buffer, inflate);
  const isPage = (o) => /\/Type\s*\/Page(?![A-Za-z])/.test(o.dict);
  const pageNums = [...objs.entries()].filter(([, o]) => isPage(o)).map(([n]) => n);
  const textOf = (n) => {
    const o = objs.get(n);
    if (!o) return '';
    const c = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(o.dict);
    if (!c) return '';
    return refs(c[1]).map(r => { const s = objs.get(r); return s && s.content && /\bBT\b|\bTj\b|\bTJ\b/.test(s.content) ? textFromContent(s.content) : ''; }).filter(Boolean).join('\n');
  };
  let order = null;
  if (pageNums.length) {
    // Follow /Kids from the root (a /Pages object with no /Parent).
    const root = [...objs.entries()].find(([, o]) => /\/Type\s*\/Pages(?![A-Za-z])/.test(o.dict) && !/\/Parent\b/.test(o.dict));
    if (root) {
      const out = [];
      const walk = (n, depth) => {
        const o = objs.get(n);
        if (!o || depth > 12 || out.length > MAX_PAGES) return;
        if (isPage(o)) { out.push(n); return; }
        const k = /\/Kids\s*\[([^\]]*)\]/.exec(o.dict);
        if (k) for (const r of refs(k[1])) walk(r, depth + 1);
      };
      walk(root[0], 0);
      if (out.length === pageNums.length) order = out;
    }
  }
  if (order) {
    const pages = order.slice(0, MAX_PAGES).map(n => textOf(n).replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_PAGE_TEXT));
    if (pages.some(Boolean)) return { pages, approx: false };
  }
  // The file's objects could not give the page order: every text stream is a page, in file order.
  const pages = [];
  for (const content of streams(buffer, inflate)) {
    if (!/\bBT\b|\bTj\b|\bTJ\b/.test(content)) continue;
    const t = textFromContent(content).trim();
    if (t) pages.push(t.slice(0, MAX_PAGE_TEXT));
    if (pages.length >= MAX_PAGES) break;
  }
  return { pages, approx: true };
}

module.exports = { extract, extractPages, streams, textFromContent, unescapePdf, MAX_TEXT };
