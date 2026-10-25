// Subtitle files -> cues. SubRip (.srt), WebVTT (.vtt) and Advanced SubStation (.ass / .ssa) are read here, in the page, as text; nothing
// is sent anywhere. A cue is { s, e, text } in seconds; text has no markup (lines are separated by \n).

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&quot;': '"', '&#39;': "'", '&lrm;': '', '&rlm;': '' };

function plain(text) {
  return String(text)
    .replace(/\{\\[^}]*\}/g, '')                 // {\an8} and other SubStation overrides that appear in .srt files too
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')           // <i>, <b>, <font color=..>, <c.yellow>, <v Name>
    .replace(/&(?:amp|lt|gt|nbsp|quot|#39|lrm|rlm);/g, (m) => ENTITIES[m])
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

// "01:02:03,456", "02:03.456" (WebVTT may leave out the hours) -> seconds
export function parseClock(value) {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(String(value).trim());
  if (!m) return null;
  const frac = m[4] ? Number('0.' + m[4].padEnd(3, '0')) : 0;
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + frac;
}

function parseBlocks(text, vtt) {
  const cues = [];
  const blocks = text.split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) continue;
    if (vtt && /^(?:NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
    const m = /^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)/.exec(lines[at]);
    if (!m) continue;
    const s = parseClock(m[1]), e = parseClock(m[2]);
    if (s == null || e == null || e < s) continue;
    const body = plain(lines.slice(at + 1).join('\n'));
    if (body) cues.push({ s, e, text: body });
  }
  return cues;
}

// "0:01:02.50" (centiseconds) -> seconds
function parseAssClock(value) {
  const m = /^(\d+):(\d{2}):(\d{2})[.](\d{1,3})$/.exec(String(value).trim());
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number('0.' + m[4]);
}

function parseAss(text) {
  const cues = [];
  let inEvents = false;
  let fields = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^\[.+\]$/.test(line)) { inEvents = /^\[events\]$/i.test(line); continue; }
    if (!inEvents) continue;
    if (/^format\s*:/i.test(line)) { fields = line.slice(line.indexOf(':') + 1).split(',').map((f) => f.trim().toLowerCase()); continue; }
    if (!/^dialogue\s*:/i.test(line) || !fields) continue;
    const parts = line.slice(line.indexOf(':') + 1).trimStart().split(',');
    const textAt = fields.indexOf('text');
    if (textAt < 0 || parts.length < fields.length) continue;
    const body = parts.slice(textAt).join(',');
    const s = parseAssClock(parts[fields.indexOf('start')]), e = parseAssClock(parts[fields.indexOf('end')]);
    if (s == null || e == null || e < s) continue;
    if (/\{[^}]*\\p[1-9]/.test(body)) continue;                  // a drawing, not words
    const cleaned = plain(body.replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' '));
    if (cleaned) cues.push({ s, e, text: cleaned });
  }
  return cues;
}

// -> { format: 'srt' | 'vtt' | 'ass', cues }
export function parseSubtitles(input) {
  const text = String(input).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  let format = 'srt', cues;
  if (/^\s*WEBVTT/.test(text)) { format = 'vtt'; cues = parseBlocks(text, true); }
  else if (/^\s*\[(?:script info|v4\+? styles|events)\]/im.test(text) && /^\s*dialogue\s*:/im.test(text)) { format = 'ass'; cues = parseAss(text); }
  else cues = parseBlocks(text, false);
  cues.sort((a, b) => a.s - b.s || a.e - b.e);
  return { format, cues };
}

// The cues showing at time t (a cue may overlap the next). `cues` is sorted by start.
export function cuesAt(cues, t) {
  let lo = 0, hi = cues.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cues[mid].s <= t) lo = mid + 1; else hi = mid; }
  const out = [];
  for (let i = lo - 1; i >= 0 && i >= lo - 40; i--) if (cues[i].e > t) out.unshift(cues[i]);
  return out;
}

// The cues of a browser text track (an embedded or <track> WebVTT), in the same shape.
export function cuesOfTrack(track) {
  const out = [];
  if (!track.cues) return out;
  for (const cue of Array.from(track.cues)) {
    const body = plain(String(cue.text || '').replace(/<\d+:\d+(?::\d+)?\.\d+>/g, ''));
    if (body) out.push({ s: cue.startTime, e: cue.endTime, text: body });
  }
  out.sort((a, b) => a.s - b.s || a.e - b.e);
  return out;
}
