// === LRC lyrics parser =========================================================
//
// lrclib's "syncedLyrics" is an LRC file: one line of text per time stamp.
//
//   [ar:Daft Punk]                  a tag (artist, title, album, author, length, by, re, ve)
//   [offset:+500]                   shifts every time by that many milliseconds (positive = the words come EARLIER)
//   [00:31.48] Like the legend      minutes:seconds.hundredths   (also .1 / .12 / .123, or :12, or no fraction)
//   [00:10.00][01:20.50]Chorus      several stamps on one line: the same words sung more than once
//   [00:40.00]<00:40.00>Like <00:40.50>the   enhanced LRC word stamps: kept as plain words
//   [00:50.00]                      an empty line: the music between verses (kept, so the last line is cleared)
//
// Anything else (lines with no stamp, a stray `[`) is skipped. Text is capped, the line count is capped, and every
// time is a finite non-negative number, so an odd file cannot make the card draw 100,000 lines.

const MAX_LINES = 3000;
const MAX_TEXT = 300;
const TAGS = new Set(['ar', 'ti', 'al', 'au', 'length', 'by', 're', 've', 'offset']);

// "01:20.5" -> 80.5, or null when it is not a time. Minutes may exceed 59 (a long track); seconds must be < 60.
function parseStamp(text) {
  const m = /^(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?$/.exec(String(text).trim());
  if (!m) return null;
  const min = Number(m[1]);
  const sec = Number(m[2]);
  if (sec >= 60) return null;
  const frac = m[3] ? Number('0.' + m[3]) : 0;
  return min * 60 + sec + frac;
}

function cleanText(raw) {
  return String(raw)
    .replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '')   // enhanced word stamps
    .replace(/[\u0000-\u001f\u007f]/g, ' ')              // control characters (a tab is a space)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
}

// -> { lines: [[seconds, text], ...] sorted by time, meta: {ar, ti, ...}, offsetMs }
// `lines` is empty when the text has no time stamps at all (then it is not synced lyrics).
function parseLrc(input) {
  const out = { lines: [], meta: {}, offsetMs: 0 };
  if (typeof input !== 'string' || !input) return out;
  const text = input.replace(/^\uFEFF/, '');
  const rows = [];
  let order = 0;
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    let rest = rawLine.trim();
    const stamps = [];
    // Leading [..] groups: time stamps or tags.
    let tagOnly = false;
    for (;;) {
      const m = /^\[([^\]]*)\]/.exec(rest);
      if (!m) break;
      const inner = m[1];
      const t = parseStamp(inner);
      if (t != null) { stamps.push(t); rest = rest.slice(m[0].length).trimStart(); continue; }
      const tag = /^([a-z]{2,6})\s*:(.*)$/i.exec(inner);
      if (tag && TAGS.has(tag[1].toLowerCase()) && !stamps.length) {
        const key = tag[1].toLowerCase();
        const value = tag[2].trim().slice(0, 200);
        if (key === 'offset') {
          const n = Number(value.replace(/^\+/, ''));
          if (Number.isFinite(n) && Math.abs(n) <= 600000) out.offsetMs = n;
        } else if (!(key in out.meta)) out.meta[key] = value;
        tagOnly = true;
      }
      break;                                  // an unknown [..] ends the stamps: it is part of the words (or the line is junk)
    }
    if (tagOnly || !stamps.length) continue;
    const words = cleanText(rest);
    for (const t of stamps) rows.push({ t, words, order: order++ });
  }
  const shift = out.offsetMs / 1000;
  const lines = rows
    .map((r) => ({ t: Math.max(0, r.t - shift), words: r.words, order: r.order }))
    .sort((a, b) => a.t - b.t || a.order - b.order)
    .slice(0, MAX_LINES)
    .map((r) => [Math.round(r.t * 1000) / 1000, r.words]);
  out.lines = lines;
  return out;
}

// Plain lyrics: trimmed, control characters out, runs of blank lines folded into one, capped.
function cleanPlain(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
    .split('\n').map((l) => l.replace(/\s+$/, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000);
}

module.exports = { parseLrc, parseStamp, cleanPlain, MAX_LINES, MAX_TEXT };
