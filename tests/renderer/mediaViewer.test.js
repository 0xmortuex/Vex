// @vitest-environment jsdom
//
// Vex's own video and sound player, the page side (src/renderer/media-viewer): the subtitle readers, the tag reader, the queue, what is
// kept per file, the words in two languages, and the page's own markup (a name for everything you press).
// How it looks and behaves in the real window is checked by driving a real Vex (scripts are in the report).

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(__dirname, '..', '..', 'src', 'renderer', 'media-viewer');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');

describe('subtitles', () => {
  it('reads SubRip: the tags go, the lines stay, the times are right', async () => {
    const { parseSubtitles } = await import('../../src/renderer/media-viewer/subs.js');
    const r = parseSubtitles('\uFEFF1\r\n00:00:01,500 --> 00:00:04,000\r\n<i>Merhaba</i> {\\an8}dünya\r\nikinci satır\r\n\r\n2\r\n01:02:03,004 --> 01:02:05,000\r\nSon\r\n');
    expect(r.format).toBe('srt');
    expect(r.cues).toEqual([{ s: 1.5, e: 4, text: 'Merhaba dünya\nikinci satır' }, { s: 3723.004, e: 3725, text: 'Son' }]);
  });
  it('reads WebVTT, with or without hours, skipping notes and styles', async () => {
    const { parseSubtitles } = await import('../../src/renderer/media-viewer/subs.js');
    const r = parseSubtitles('WEBVTT\n\nNOTE this is a note\n\nSTYLE\n::cue { color: red }\n\n00:01.000 --> 00:04.000 line:90%\nline <b>one</b>\n\ncue2\n00:00:05.000 --> 00:00:06.000\n<v Ann>two</v>\n');
    expect(r.format).toBe('vtt');
    expect(r.cues.map((c) => [c.s, c.e, c.text])).toEqual([[1, 4, 'line one'], [5, 6, 'two']]);
  });
  it('reads SubStation: overrides go, \\N is a new line, a comma in the text stays, a drawing is skipped', async () => {
    const { parseSubtitles } = await import('../../src/renderer/media-viewer/subs.js');
    const r = parseSubtitles('[Script Info]\nTitle: x\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:04.50,Default,,0,0,0,,ASS {\\i1}one{\\i0}\\Nsecond, row\nDialogue: 0,0:00:05.00,0:00:06.00,Default,,0,0,0,,{\\p1}m 0 0 l 10 10{\\p0}\nComment: 0,0:00:07.00,0:00:08.00,Default,,0,0,0,,nope\n');
    expect(r.format).toBe('ass');
    expect(r.cues).toEqual([{ s: 1, e: 4.5, text: 'ASS one\nsecond, row' }]);
  });
  it('finds the cues showing at a time, with overlaps', async () => {
    const { cuesAt } = await import('../../src/renderer/media-viewer/subs.js');
    const cues = [{ s: 1, e: 5, text: 'a' }, { s: 2, e: 3, text: 'b' }, { s: 6, e: 7, text: 'c' }];
    expect(cuesAt(cues, 0.5)).toEqual([]);
    expect(cuesAt(cues, 2.5).map((c) => c.text)).toEqual(['a', 'b']);
    expect(cuesAt(cues, 4).map((c) => c.text)).toEqual(['a']);
    expect(cuesAt(cues, 6.5).map((c) => c.text)).toEqual(['c']);
    expect(cuesAt(cues, 9)).toEqual([]);
  });
  it('reads a Windows-1254 file as Turkish, and a UTF-8 file as it is', async () => {
    const { decodeText } = await import('../../src/renderer/media-viewer/util.js');
    expect(decodeText(Uint8Array.from([0x47, 0xFC, 0xF0, 0xFE, 0xDD, 0xFD]))).toBe('Güğşİı');
    expect(decodeText(new TextEncoder().encode('Güğşİı'))).toBe('Güğşİı');
  });
});

describe('small helpers', () => {
  it('writes times and reads a start time from a media fragment', async () => {
    const { fmtTime, parseStart, extOf, nameOf, guessKind, viewerHref, docHref } = await import('../../src/renderer/media-viewer/util.js');
    expect(fmtTime(0)).toBe('0:00');
    expect(fmtTime(83.9)).toBe('1:23');
    expect(fmtTime(3725)).toBe('1:02:05');
    expect(fmtTime(NaN)).toBe('0:00');
    expect(parseStart('#t=90')).toBe(90);
    expect(parseStart('#t=1:30')).toBe(90);
    expect(parseStart('#t=1h2m3s')).toBe(3723);
    expect(parseStart('#t=90,120')).toBe(90);
    expect(parseStart('#x=1')).toBe(null);
    expect(extOf('http://a/b/Song%20One.MP3?x=1')).toBe('.mp3');
    expect(nameOf('file:///C:/music/01%20First%20light.mp3')).toBe('01 First light');
    expect(guessKind('http://a/b.flac')).toBe('audio');
    expect(guessKind('http://a/b.mkv')).toBe('video');
    expect(guessKind('http://a/watch')).toBe('video');
    expect(viewerHref('http://a/b.mp4#t=5')).toBe('/?u=' + encodeURIComponent('http://a/b.mp4') + '#t=5');
    expect(docHref('http://a/b.mp4#t=5')).toBe('/doc?u=' + encodeURIComponent('http://a/b.mp4'));
  });
});

// ---- tags -----------------------------------------------------------------------------------------------------------------
const enc = (s) => Array.from(new TextEncoder().encode(s));
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const sync32 = (n) => [(n >>> 21) & 127, (n >>> 14) & 127, (n >>> 7) & 127, n & 127];
const frame = (id, body) => [...enc(id), ...be32(body.length), 0, 0, ...body];
const text = (id, s) => frame(id, [3, ...enc(s)]);
const JPEG = [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4, 5];

describe('the tag reader', () => {
  it('reads an ID3v2.3 title, artist, album, front cover and chapters', async () => {
    const { parseId3, id3Size } = await import('../../src/renderer/media-viewer/tags.js');
    const apic = frame('APIC', [0, ...enc('image/jpeg'), 0, 3, ...enc('cover'), 0, ...JPEG]);
    const chap = (start, title) => frame('CHAP', [...enc('ch' + start), 0, ...be32(start), ...be32(start + 1000), ...be32(0xFFFFFFFF), ...be32(0xFFFFFFFF), ...text('TIT2', title)]);
    const body = [...text('TIT2', 'First light'), ...text('TPE1', 'The Test Band'), ...text('TALB', 'Quiet Tones'), ...apic, ...chap(5000, 'Second'), ...chap(0, 'Intro')];
    const bytes = Uint8Array.from([...enc('ID3'), 3, 0, 0, ...sync32(body.length), ...body]);
    expect(id3Size(bytes)).toBe(10 + body.length);
    const t = parseId3(bytes);
    expect(t.title).toBe('First light');
    expect(t.artist).toBe('The Test Band');
    expect(t.album).toBe('Quiet Tones');
    expect(t.cover.type).toBe('image/jpeg');
    expect(Array.from(t.cover.bytes)).toEqual(JPEG);
    expect(t.chapters).toEqual([{ start: 0, title: 'Intro' }, { start: 5, title: 'Second' }]);
  });
  it('reads UTF-16 text and gives nothing for a file with no tag', async () => {
    const { parseId3 } = await import('../../src/renderer/media-viewer/tags.js');
    const u16 = [1, 0xFF, 0xFE, ...Array.from('Şarkı').flatMap((c) => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8])];
    const body = frame('TIT2', u16);
    const t = parseId3(Uint8Array.from([...enc('ID3'), 3, 0, 0, ...sync32(body.length), ...body]));
    expect(t.title).toBe('Şarkı');
    const none = parseId3(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
    expect(none).toMatchObject({ title: '', artist: '', album: '', cover: null, chapters: [] });
  });
  const box = (type, payload) => [...be32(8 + payload.length), ...enc(type), ...payload];
  const dataBox = (flags, bytes) => box('data', [...be32(flags), 0, 0, 0, 0, ...bytes]);
  it('reads MP4 / M4A tags, the cover and the chapter list', async () => {
    const { parseMoov, mp4Boxes, unsupportedAudioIn } = await import('../../src/renderer/media-viewer/tags.js');
    const item = (name, payload) => [...be32(8 + payload.length), 0xA9, ...enc(name), ...payload];
    const nam = item('nam', dataBox(1, enc('Fourth song')));
    const art = item('ART', dataBox(1, enc('The Test Band')));
    const covr = box('covr', dataBox(13, JPEG));
    const ilstBox = box('ilst', [...nam, ...art, ...covr]);
    const meta = box('meta', [0, 0, 0, 0, ...ilstBox]);
    const chplPayload = [1, 0, 0, 0, 0, 0, 0, 0, 2, ...be32(0), ...be32(0), 5, ...enc('Intro'), ...be32(0), ...be32(50000000), 4, ...enc('Next')];
    const udta = box('udta', [...meta, ...box('chpl', chplPayload)]);
    const moov = Uint8Array.from(box('moov', [...udta, ...enc('xx ac-3 xx')]));
    const inside = mp4Boxes(moov, 0, moov.length)[0];
    expect(inside.type).toBe('moov');
    const t = parseMoov(moov, inside.start, inside.end);
    expect(t.title).toBe('Fourth song');
    expect(t.artist).toBe('The Test Band');
    expect(t.cover.type).toBe('image/jpeg');
    expect(Array.from(t.cover.bytes)).toEqual(JPEG);
    expect(t.chapters).toEqual([{ start: 0, title: 'Intro' }, { start: 5, title: 'Next' }]);
    expect(unsupportedAudioIn(moov)).toEqual(['AC3']);
    expect(unsupportedAudioIn(Uint8Array.from(enc('A_DTS and A_TRUEHD')))).toEqual(['DTS', 'TrueHD']);
  });
  it('reads FLAC comments and picture blocks', async () => {
    const { parseFlacBlock, flacBlockHeader } = await import('../../src/renderer/media-viewer/tags.js');
    const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    const c = (s) => [...le32(enc(s).length), ...enc(s)];
    const comment = Uint8Array.from([...le32(3), ...enc('abc'), ...le32(3), ...c('TITLE=Fifth tune'), ...c('artist=The Test Band'), ...c('ALBUM=Quiet Tones')]);
    const out = { title: '', artist: '', album: '', cover: null, chapters: [] };
    parseFlacBlock(4, comment, out);
    expect(out).toMatchObject({ title: 'Fifth tune', artist: 'The Test Band', album: 'Quiet Tones' });
    const pic = Uint8Array.from([...be32(3), ...be32(10), ...enc('image/jpeg'), ...be32(0), ...be32(1), ...be32(1), ...be32(24), ...be32(0), ...be32(JPEG.length), ...JPEG]);
    parseFlacBlock(6, pic, out);
    expect(out.cover.type).toBe('image/jpeg');
    expect(Array.from(out.cover.bytes)).toEqual(JPEG);
    expect(flacBlockHeader(Uint8Array.from([0x84, 0, 1, 2]), 0)).toEqual({ last: true, type: 4, length: 258 });
  });
  it('reads only the bytes it needs, by range, and refuses a source that cannot do ranges for anything but the start', async () => {
    const { fetchBytes } = await import('../../src/renderer/media-viewer/tags.js');
    const data = Uint8Array.from({ length: 100 }, (_, i) => i);
    const ranged = async (_u, o) => { const m = /bytes=(\d+)-(\d+)/.exec(o.headers.Range); const s = Number(m[1]), e = Math.min(Number(m[2]), 99); return new Response(data.slice(s, e + 1), { status: 206, headers: { 'content-range': `bytes ${s}-${e}/100` } }); };
    const r = await fetchBytes('x', 10, 5, ranged);
    expect(Array.from(r.bytes)).toEqual([10, 11, 12, 13, 14]);
    expect(r.total).toBe(100);
    const whole = async () => new Response(data, { status: 200 });
    expect(Array.from((await fetchBytes('x', 0, 4, whole)).bytes)).toEqual([0, 1, 2, 3]);
    await expect(fetchBytes('x', 5, 4, whole)).rejects.toThrow(/range/);
  });
});

describe('the queue', () => {
  const items = ['a', 'b', 'c', 'd'].map((n) => ({ name: n + '.mp3', url: 'file:///m/' + n + '.mp3', ext: '.mp3' }));
  it('goes forward and back, stops at the end, wraps with repeat all, repeats one by itself', async () => {
    const { Queue } = await import('../../src/renderer/media-viewer/queue.js');
    const q = new Queue();
    q.set(items, 'file:///m/b.mp3');
    expect(q.usable).toBe(true);
    expect(q.peekNext(true).index).toBe(2);
    q.goTo(3);
    expect(q.peekNext(true)).toBe(null);                          // the end, nothing repeating
    expect(q.peekNext(false).index).toBe(0);                      // a button press still wraps
    q.cycleRepeat();
    expect(q.repeat).toBe('all');
    expect(q.peekNext(true).index).toBe(0);
    q.cycleRepeat();
    expect(q.repeat).toBe('one');
    expect(q.peekNext(true).index).toBe(3);                       // the same file again
    expect(q.peekNext(false).index).toBe(0);                      // but a button moves on
    expect(q.peekPrev().index).toBe(2);
  });
  it('shuffles without repeating until every file was played, then ends or starts a new round', async () => {
    const { Queue } = await import('../../src/renderer/media-viewer/queue.js');
    const q = new Queue(() => 0);
    q.set(items, 'file:///m/a.mp3');
    q.toggleShuffle();
    const seen = [q.index];
    for (let i = 0; i < 3; i++) { const n = q.peekNext(true); seen.push(n.index); q.goTo(n.index); }
    expect(new Set(seen).size).toBe(4);
    expect(q.peekNext(true)).toBe(null);                          // all played, repeat off
    q.cycleRepeat();
    const again = q.peekNext(true);
    expect(again.index).not.toBe(q.index);                        // a new round
  });
  it('is not a queue for a single file, or one that is not in the list', async () => {
    const { Queue } = await import('../../src/renderer/media-viewer/queue.js');
    const q = new Queue();
    q.set([items[0]], items[0].url);
    expect(q.usable).toBe(false);
    q.set(items, 'file:///other.mp3');
    expect(q.usable).toBe(false);
    expect(q.peekNext(false)).toBe(null);
  });
});

describe('what is kept per file', () => {
  beforeEach(() => {
    localStorage.clear();
    document.head.innerHTML = '<meta name="vex-persist" content="1">';
  });
  it('keeps a place, forgets it near the start or the end, and caps the list', async () => {
    const store = await import('../../src/renderer/media-viewer/store.js');
    expect(store.setPlace('http://a/f.mp4#t=3', 120, 600, 1)).toBe(true);
    expect(store.getPlace('http://a/f.mp4')).toBe(120);
    expect(store.setPlace('http://a/f.mp4', 3, 600, 2)).toBe(false);              // back at the start
    expect(store.getPlace('http://a/f.mp4')).toBe(null);
    store.setPlace('http://a/f.mp4', 120, 600, 3);
    store.setPlace('http://a/f.mp4', 595, 600, 4);                                 // the end
    expect(store.getPlace('http://a/f.mp4')).toBe(null);
    expect(store.setPlace('http://a/short.mp3', 30, 60, 5)).toBe(false);           // too short to be worth it
    for (let i = 0; i < store.LIMITS.MAX_PLACES + 10; i++) store.setPlace('http://a/' + i + '.mp4', 100, 500, 1000 + i);
    expect(Object.keys(store.read('resume', {})).length).toBe(store.LIMITS.MAX_PLACES);
    expect(store.getPlace('http://a/0.mp4')).toBe(null);                           // the oldest went
    expect(store.getPlace('http://a/' + (store.LIMITS.MAX_PLACES + 9) + '.mp4')).toBe(100);
  });
  it('keeps nothing when the page says it is private (vex-persist 0)', async () => {
    document.head.innerHTML = '<meta name="vex-persist" content="0">';
    const store = await import('../../src/renderer/media-viewer/store.js');
    expect(store.canKeep()).toBe(false);
    expect(store.setPlace('http://a/f.mp4', 120, 600)).toBe(false);
    expect(store.write('volume', 0.5)).toBe(false);
    expect(store.read('volume', 1)).toBe(1);
    expect(localStorage.length).toBe(0);
  });
});

// ---- the words ------------------------------------------------------------------------------------------------------------
describe('the words are in two languages', () => {
  const files = fs.readdirSync(DIR).filter((f) => /\.(js|html)$/.test(f) && !/^strings/.test(f));
  it('every sentence the page can show has a Turkish one', async () => {
    const { TR } = await import('../../src/renderer/media-viewer/strings-tr.js');
    const keys = new Set(['White', 'Yellow', 'Cyan', 'Green', 'None', 'Dim', 'Solid']);       // colour and background names (captions.js)
    for (const f of files) {
      const s = read(f);
      for (const m of s.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(m[1].replace(/\\'/g, "'").replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
      for (const m of s.matchAll(/data-i18n(?:-title|-aria|-placeholder)?="([^"]*)"/g)) keys.add(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    }
    const missing = [...keys].filter((k) => !Object.prototype.hasOwnProperty.call(TR, k));
    expect(missing).toEqual([]);
    const spare = Object.keys(TR).filter((k) => !keys.has(k));
    expect(spare).toEqual([]);                                  // no Turkish for a sentence that is gone
    // a {name} in the English is in the Turkish
    for (const k of keys) for (const m of k.matchAll(/\{(\w+)\}/g)) expect(TR[k]).toContain('{' + m[1] + '}');
  });
  it('t() gives Turkish when the page is Turkish and English otherwise, and fills {names}', async () => {
    document.documentElement.lang = 'en';
    const strings = await import('../../src/renderer/media-viewer/strings.js');
    strings.setLang('en');
    expect(strings.t('Play')).toBe('Play');
    expect(strings.t('Continuing from {time}', { time: '1:00' })).toBe('Continuing from 1:00');
    strings.setLang('tr');
    expect(strings.t('Play')).toBe('Oynat');
    expect(strings.t('Continuing from {time}', { time: '1:00' })).toBe('1:00 konumundan devam ediliyor');
    expect(strings.t('A sentence nobody translated')).toBe('A sentence nobody translated');
    strings.setLang('en');
  });
  it('the Settings and catalogue words of the window are Turkish too', () => {
    const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
    const tr = VexI18nUI.TABLE.tr;
    const host = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'js', 'media-viewer-host.js'), 'utf8');
    const wanted = [];
    for (const m of host.matchAll(/(?:G\.note|G\.button|showToast\?\.|createTextNode|new Error)\(\s*(?:'((?:[^'\\]|\\.)*)'|[^']*?\?\s*'((?:[^'\\]|\\.)*)'\s*:\s*'((?:[^'\\]|\\.)*)')/g)) wanted.push(...[m[1], m[2], m[3]].filter(Boolean));
    for (const m of host.matchAll(/title: '([^']+)'|label: '([^']+)'|hint: '([^']+)'/g)) wanted.push(m[1] || m[2] || m[3]);
    const unescape = (s) => s.replace(/\\'/g, "'").trim();
    const missing = [...new Set(wanted.map(unescape))].filter((k) => k && !tr[k] && !/^(?:\[|Night mode is not|Could not save|keywords)/.test(k) && !/media-viewer|vex-sg|Videos? and sounds? are never/.test(k));
    expect(missing).toEqual([]);
  });
});

// ---- the markup -----------------------------------------------------------------------------------------------------------
describe('the page markup', () => {
  const html = read('viewer.html');
  it('every id the code reaches for is in the page', () => {
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    const used = new Set();
    for (const f of ['app.js', 'captions.js', 'ui.js', 'viz.js']) for (const m of read(f).matchAll(/(?:\$|getElementById)\(\s*'(mv-[a-z-]+)'/g)) used.add(m[1]);
    const missing = [...used].filter((id) => !ids.has(id) && !/^mv-sub-/.test(id));
    expect(missing).toEqual([]);
  });
  it('every button has a name (a label, or a title the words fill in)', () => {
    for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
      const attrs = m[1];
      expect(/data-i18n-aria=|aria-label=/.test(attrs) || m[2].replace(/<[^>]+>/g, '').trim() !== '', attrs).toBe(true);
    }
  });
  it('the slider and the groups carry their roles and names', () => {
    expect(html).toMatch(/id="mv-seek"[^>]*role="slider"[^>]*tabindex="0"/);
    expect(html).toMatch(/id="mv-controls"[^>]*role="group"/);
    expect(html).toMatch(/id="mv-vol"[^>]*data-i18n-aria="Volume"/);
    expect(html).toMatch(/<a class="mv-skip"/);
  });
  it('every icon it asks for exists in the icon set', () => {
    const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
    const names = new Set([...html.matchAll(/data-icon="([a-z0-9-]+)"/g)].map((m) => m[1]));
    for (const f of ['app.js', 'ui.js', 'captions.js']) for (const m of read(f).matchAll(/(?:setIcon\([^,]+,\s*|iconHtml\(|icon: )(?:[^'"]*\?\s*)?'([a-z0-9-]+)'(?:\s*:\s*'([a-z0-9-]+)')?/g)) { names.add(m[1]); if (m[2]) names.add(m[2]); }
    const unknown = [...names].filter((n) => !VexIcons.has(n));
    expect(unknown).toEqual([]);
  });
  it('the stylesheet uses only the interface tokens for its colours (and a few fixed blacks and whites)', () => {
    const css = read('viewer.css');
    const hexes = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
    // fallbacks inside var(...) and the captions' own colours are the only literal colours
    const allowed = new Set(['#f3f3f3', '#ececec', '#fff', '#1b1b1b', '#d0d0d0', '#1e3a5f', '#b3261e', '#000', '#ffffff', '#000000']);
    expect(hexes.filter((h) => !allowed.has(h))).toEqual([]);
    expect(css).not.toMatch(/linear-gradient\((?!to right, var\(--mv-accent-bg\))/);       // the one gradient is the volume fill
    expect(css).not.toMatch(/backdrop-filter/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });
  it('does not use an emoji anywhere', () => {
    for (const f of fs.readdirSync(DIR)) {
      const s = read(f);
      expect(s.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{FE0F}]/u), f).toBe(null);
    }
  });
});
