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

module.exports = { extract, streams, textFromContent, unescapePdf, MAX_TEXT };
