// Vex's video and sound player: the page. See main/media-viewer.js for how a media file reaches it and how it is read.

import { t, applyStatic } from './strings.js';
import { applyThemePayload, onThemeChange, refreshScheme, cssColor } from './theme.js';
import { clamp, fmtTime, parseStart, guessKind, extOf, nameOf, viewerHref, docHref, paintIcons, iconHtml, h, AUDIO_EXT, VIDEO_EXT } from './util.js';
import * as store from './store.js';
import { openMenu, openPanel, closePop, isOpen, openAnchor, toast } from './ui.js';
import { createCaptions } from './captions.js';
import { Queue } from './queue.js';
import { readTags } from './tags.js';
import { createVisualiser } from './viz.js';

const $ = (id) => document.getElementById(id);
const media = $('mv-media'), stage = $('mv-stage'), controls = $('mv-controls');
const host = window.vexMediaHost || null;

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3, 4];
const SUBTITLE_EXT = ['.srt', '.vtt', '.ass', '.ssa'];
const IDLE_MS = 2600;

const S = {
  original: '', kind: 'video', tags: null, coverUrl: '', chapters: [], ab: { a: null, b: null }, beside: [],
  frameDur: 1 / 30, lastSave: 0, noticeFor: '', loadId: 0, clickTimer: 0, idleTimer: 0, raf: 0, seeking: false, hoverRatio: null,
  resumed: false, ready: false, pendingStart: null,
};
const queue = new Queue();
const captions = createCaptions({ media, overlay: $('mv-subs'), stage, onChange: () => { syncSubsButton(); } });
const viz = createVisualiser({ canvas: $('mv-viz'), media, color: () => cssColor('var(--mv-accent)') });

function needHost() { if (!host) throw new Error(t('This window cannot do that')); return host; }
function fail(err) { console.error('[Player]', err); toast(err && err.message ? err.message : String(err)); }
function guard(fn) { return (...args) => { try { const r = fn(...args); if (r && typeof r.catch === 'function') r.catch(fail); } catch (err) { fail(err); } }; }

// ---- small UI helpers -------------------------------------------------------------
function setIcon(button, name, size) { button.innerHTML = iconHtml(name, size || Number(button.dataset.iconSize) || 18); button.dataset.icon = name; }
function setLabel(button, title, aria) { button.title = title; button.setAttribute('aria-label', aria || title); }
const fmtRate = (r) => (Math.round(r * 100) / 100) + '×';

// ---- the state of the screen --------------------------------------------------------
function setKind(kind) {
  S.kind = kind;
  document.body.dataset.kind = kind;
  $('mv-audio').hidden = kind !== 'audio';
  if (kind === 'audio') { viz.start(); activity(); } else viz.stop();
  syncUI();
}

function showState({ title, text, detail, actions }) {
  $('mv-state-title').textContent = title;
  $('mv-state-text').textContent = text;
  $('mv-state-detail').textContent = detail || '';
  const box = $('mv-state-actions');
  box.replaceChildren(...actions.map((a) => h('button', { class: 'mv-btn ' + (a.primary ? 'mv-btn-primary' : 'mv-btn-pill'), type: 'button', text: a.label, onclick: guard(a.run) })));
  $('mv-state').hidden = false;
  document.body.dataset.state = 'error';
  const first = box.querySelector('button');
  if (first) first.focus({ preventScroll: true });
}
function hideState() { $('mv-state').hidden = true; }

function showNotice(text, actions) {
  $('mv-notice-text').textContent = text;
  $('mv-notice-actions').replaceChildren(...(actions || []).map((a) => h('button', { class: 'mv-btn mv-btn-pill mv-btn-sm', type: 'button', text: a.label, onclick: guard(a.run) })));
  $('mv-notice').hidden = false;
}

const externalActions = () => {
  const isFile = /^file:/i.test(S.original);
  return [
    { label: t('Open with Windows'), primary: true, run: async () => { const r = await needHost().openExternal(); if (!r.ok) throw new Error(r.error); } },
    { label: isFile ? t('Show in folder') : t('Download'), run: async () => { const r = await needHost().download(); if (!r.ok) throw new Error(r.error); if (r.viaDownloads) toast(t('The download has started')); } },
  ];
};

// ---- the play state -----------------------------------------------------------------
function syncUI() {
  const playing = !media.paused && !media.ended;
  const play = $('mv-play');
  setIcon(play, playing ? 'pause' : 'play', 22);
  setLabel(play, playing ? t('Pause (Space)') : t('Play (Space)'), playing ? t('Pause') : t('Play'));
  const big = $('mv-big');
  big.hidden = playing || S.kind !== 'video' || !S.ready || !$('mv-state').hidden;
  setLabel(big, t('Play (Space)'), t('Play'));
  const muted = media.muted || media.volume === 0;
  const mute = $('mv-mute');
  setIcon(mute, muted ? 'mute' : 'volume');
  mute.setAttribute('aria-pressed', String(muted));
  setLabel(mute, muted ? t('Unmute (M)') : t('Mute (M)'), muted ? t('Unmute') : t('Mute'));
  const vol = $('mv-vol');
  const level = muted ? 0 : Math.round(media.volume * 100);
  vol.value = String(level);
  vol.style.setProperty('--fill', level + '%');
  vol.setAttribute('aria-valuetext', level + '%');
  $('mv-speed-text').textContent = fmtRate(media.playbackRate);
  const full = !!document.fullscreenElement;
  const fb = $('mv-full');
  setIcon(fb, full ? 'minimize' : 'maximize');
  fb.setAttribute('aria-pressed', String(full));
  setLabel(fb, full ? t('Leave full screen (F)') : t('Full screen (F)'), full ? t('Leave full screen') : t('Full screen'));
  const pip = $('mv-pip');
  pip.setAttribute('aria-pressed', String(!!document.pictureInPictureElement));
  pip.hidden = !document.pictureInPictureEnabled;
  const ab = $('mv-ab-btn');
  const abOn = S.ab.a != null;
  ab.setAttribute('aria-pressed', String(abOn));
  setLabel(ab, S.ab.a == null ? t('Loop a section: set the start (A)') : S.ab.b == null ? t('Loop a section: set the end (A)') : t('Loop a section: clear (A)'),
    S.ab.a == null ? t('Loop a section') : S.ab.b == null ? t('Loop a section, start set') : t('Loop a section, on'));
  const night = $('mv-night');
  const nightOn = !!(window.__vexNight && window.__vexNight.on);
  night.setAttribute('aria-pressed', String(nightOn));
  // The queue buttons.
  const q = queue.usable;
  for (const el of document.querySelectorAll('.mv-queue-only')) el.hidden = !q;
  const shuffle = $('mv-shuffle');
  shuffle.setAttribute('aria-pressed', String(queue.shuffle));
  setLabel(shuffle, queue.shuffle ? t('Shuffle: on') : t('Shuffle: off'), queue.shuffle ? t('Shuffle: on') : t('Shuffle: off'));
  const rep = $('mv-repeat');
  setIcon(rep, queue.repeat === 'one' ? 'repeat-one' : 'repeat');
  rep.setAttribute('aria-pressed', String(queue.repeat !== 'off'));
  const repText = queue.repeat === 'one' ? t('Repeat: this file') : queue.repeat === 'all' ? t('Repeat: all') : t('Repeat: off');
  setLabel(rep, repText, repText);
  setLabel($('mv-prev'), t('Previous (P)'), t('Previous'));
  setLabel($('mv-next'), t('Next (N)'), t('Next'));
  $('mv-queue-btn').setAttribute('aria-pressed', String(!$('mv-queue').hidden));
  $('mv-tracks').hidden = !(media.audioTracks && media.audioTracks.length > 1);
  syncSubsButton();
}

function syncSubsButton() {
  const b = $('mv-subs-btn');
  b.setAttribute('aria-pressed', String(captions.on()));
  setLabel(b, captions.on() ? t('Subtitles: on (C)') : t('Subtitles (C)'), t('Subtitles'));
}

function updateProgress() {
  const d = media.duration, c = media.currentTime;
  const known = Number.isFinite(d) && d > 0;
  const ratio = known ? clamp(c / d, 0, 1) : 0;
  $('mv-played').style.width = ratio * 100 + '%';
  $('mv-thumb').style.left = ratio * 100 + '%';
  $('mv-cur').textContent = fmtTime(c);
  $('mv-dur').textContent = known ? fmtTime(d) : '0:00';
  // A-B loop.
  if (S.ab.a != null && S.ab.b != null && !media.paused && c >= S.ab.b) media.currentTime = S.ab.a;
}
function updateAria() {
  const d = media.duration, c = media.currentTime;
  const seek = $('mv-seek');
  seek.setAttribute('aria-valuemax', String(Number.isFinite(d) ? Math.floor(d) : 0));
  seek.setAttribute('aria-valuenow', String(Math.floor(c || 0)));
  seek.setAttribute('aria-valuetext', t('{cur} of {total}', { cur: fmtTime(c), total: fmtTime(d) }));
}
function updateBuffered() {
  const d = media.duration;
  const box = $('mv-buffered');
  box.replaceChildren();
  if (!Number.isFinite(d) || d <= 0) return;
  const b = media.buffered;
  for (let i = 0; i < b.length; i++) {
    const seg = document.createElement('i');
    seg.style.left = (b.start(i) / d) * 100 + '%';
    seg.style.width = ((b.end(i) - b.start(i)) / d) * 100 + '%';
    box.append(seg);
  }
}
function updateAB() {
  const box = $('mv-ab');
  const d = media.duration;
  if (S.ab.a == null || !Number.isFinite(d) || d <= 0) { box.hidden = true; return; }
  box.hidden = false;
  const end = S.ab.b == null ? S.ab.a + d * 0.004 : S.ab.b;
  box.style.left = (S.ab.a / d) * 100 + '%';
  box.style.width = Math.max(0.4, ((end - S.ab.a) / d) * 100) + '%';
}
function frameLoop() {
  S.raf = 0;
  updateProgress();
  if (!media.paused && !media.ended) S.raf = requestAnimationFrame(frameLoop);
}
function startFrameLoop() { if (!S.raf) S.raf = requestAnimationFrame(frameLoop); }

// ---- chapters -------------------------------------------------------------------------
function setChapters(list) {
  S.chapters = (list || []).filter((c) => Number.isFinite(c.start)).sort((a, b) => a.start - b.start);
  const box = $('mv-chapters');
  box.replaceChildren();
  const d = media.duration;
  if (Number.isFinite(d) && d > 0) for (const c of S.chapters) if (c.start > 0.5) { const i = document.createElement('i'); i.style.left = (c.start / d) * 100 + '%'; box.append(i); }
}
function chapterAt(time) {
  let found = null;
  for (const c of S.chapters) { if (c.start <= time + 0.01) found = c; else break; }
  return found;
}
function readTrackChapters() {
  for (const tt of Array.from(media.textTracks || [])) {
    if (tt.kind !== 'chapters') continue;
    tt.mode = 'hidden';
    setTimeout(() => {
      const list = Array.from(tt.cues || []).map((c) => ({ start: c.startTime, title: String(c.text || '').replace(/<[^>]+>/g, '').trim() }));
      if (list.length && !S.chapters.length) setChapters(list);
    }, 400);
    return;
  }
}
function jumpChapter(dir) {
  if (!S.chapters.length) { seekBy(dir * 60); return; }
  const now = media.currentTime;
  const target = dir > 0 ? S.chapters.find((c) => c.start > now + 0.5) : [...S.chapters].reverse().find((c) => c.start < now - 2);
  if (target) { media.currentTime = target.start; toast(target.title || fmtTime(target.start)); }
  else if (dir < 0) media.currentTime = 0;
}

// ---- actions ----------------------------------------------------------------------------
function togglePlay() {
  if (!S.ready && media.readyState === 0) return;
  if (media.ended) media.currentTime = 0;
  if (media.paused) media.play().catch((err) => { if (err.name !== 'AbortError') fail(err); });
  else media.pause();
}
function seekBy(sec) {
  const d = Number.isFinite(media.duration) ? media.duration : Infinity;
  media.currentTime = clamp(media.currentTime + sec, 0, d);
  updateProgress(); updateAria();
}
function seekRatio(r) {
  if (!Number.isFinite(media.duration)) return;
  media.currentTime = clamp(r, 0, 1) * media.duration;
  updateProgress(); updateAria();
}
function setVolume(v) {
  media.volume = clamp(v, 0, 1);
  if (v > 0) media.muted = false;
  store.write('volume', media.volume);
  toast(t('Volume {n}%', { n: Math.round(media.volume * 100) }), { ms: 900 });
}
function toggleMute() { media.muted = !media.muted; }
function setRate(r) {
  media.playbackRate = clamp(Math.round(r * 100) / 100, 0.25, 4);
  toast(t('Speed {rate}', { rate: fmtRate(media.playbackRate) }), { ms: 1000 });
}
function stepRate(dir) {
  const at = RATES.findIndex((r) => r >= media.playbackRate - 0.001);
  const next = clamp((at < 0 ? RATES.length - 1 : at) + dir, 0, RATES.length - 1);
  setRate(RATES[next]);
}
function cycleAB() {
  if (S.ab.a == null) { S.ab = { a: media.currentTime, b: null }; toast(t('Loop starts at {time}', { time: fmtTime(media.currentTime) })); }
  else if (S.ab.b == null) {
    if (media.currentTime <= S.ab.a + 0.3) { toast(t('Pick an end after the start')); return; }
    S.ab.b = media.currentTime;
    media.currentTime = S.ab.a;
    toast(t('Looping {a} to {b}', { a: fmtTime(S.ab.a), b: fmtTime(S.ab.b) }));
  } else { S.ab = { a: null, b: null }; toast(t('Loop cleared')); }
  updateAB(); syncUI();
}
function frameStep(dir) {
  if (S.kind !== 'video') return;
  media.pause();
  const d = Number.isFinite(media.duration) ? media.duration : Infinity;
  media.currentTime = clamp(media.currentTime + dir * S.frameDur, 0, d);
}
async function toggleFullscreen() {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await stage.requestFullscreen();
}
async function togglePip() {
  if (S.kind !== 'video') return;
  if (document.pictureInPictureElement) await document.exitPictureInPicture();
  else await media.requestPictureInPicture();
}

function frameBlob() {
  if (!media.videoWidth) throw new Error(t('There is no picture to take'));
  const canvas = document.createElement('canvas');
  canvas.width = media.videoWidth; canvas.height = media.videoHeight;
  canvas.getContext('2d').drawImage(media, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(t('The picture could not be made')))), 'image/png'));
}
const frameName = () => (S.tags && S.tags.title ? S.tags.title : nameOf(S.original)).replace(/[<>:"/\\|?*]/g, '_').slice(0, 80) + ' ' + fmtTime(media.currentTime).replace(/:/g, '-') + '.png';
async function copyFrame() {
  const blob = await frameBlob();
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  toast(t('The picture is copied'));
}
async function saveFrame() {
  const blob = await frameBlob();
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: frameName() });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(t('The picture is being saved to Downloads'));
}

// ---- loading a file ------------------------------------------------------------------------
function revokeCover() { if (S.coverUrl) { URL.revokeObjectURL(S.coverUrl); S.coverUrl = ''; } }

function applyTags(tags) {
  S.tags = tags;
  const title = tags.title || nameOf(S.original);
  $('mv-title').textContent = title;
  $('mv-artist').textContent = tags.artist || '';
  $('mv-album').textContent = tags.album || '';
  document.title = tags.artist && tags.title ? tags.artist + ' – ' + tags.title : title;
  revokeCover();
  const img = $('mv-cover-img');
  if (tags.cover) {
    S.coverUrl = URL.createObjectURL(new Blob([tags.cover.bytes], { type: tags.cover.type }));
    img.src = S.coverUrl; img.hidden = false; $('mv-cover-ph').hidden = true;
  } else { img.removeAttribute('src'); img.hidden = true; $('mv-cover-ph').hidden = false; }
  if (tags.chapters && tags.chapters.length) setChapters(tags.chapters);
  setMediaSession();
  if (tags.unsupportedAudio && tags.unsupportedAudio.length) S.codecs = tags.unsupportedAudio;
}

function setMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const tags = S.tags || {};
  const meta = { title: tags.title || nameOf(S.original), artist: tags.artist || '', album: tags.album || '' };
  if (S.coverUrl && tags.cover) meta.artwork = [{ src: S.coverUrl, sizes: '512x512', type: tags.cover.type }];
  navigator.mediaSession.metadata = new MediaMetadata(meta);
}
function wireMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const set = (name, fn) => { try { navigator.mediaSession.setActionHandler(name, fn); } catch (err) { console.warn('[Player] the media key "' + name + '" is not available:', err.message); } };
  set('play', () => { if (media.paused) togglePlay(); });
  set('pause', () => media.pause());
  set('stop', () => { media.pause(); media.currentTime = 0; });
  set('seekbackward', (d) => seekBy(-(d && d.seekOffset ? d.seekOffset : 10)));
  set('seekforward', (d) => seekBy(d && d.seekOffset ? d.seekOffset : 10));
  set('seekto', (d) => { if (d && Number.isFinite(d.seekTime)) media.currentTime = d.seekTime; });
  set('previoustrack', () => goPrev());
  set('nexttrack', () => goNext(false));
}
let lastPos = 0;
function updatePosition() {
  if (!('mediaSession' in navigator) || !Number.isFinite(media.duration)) return;
  const now = Date.now();
  if (now - lastPos < 1000) return;
  lastPos = now;
  try { navigator.mediaSession.setPositionState({ duration: media.duration, position: clamp(media.currentTime, 0, media.duration), playbackRate: media.playbackRate || 1 }); } catch { /* vex-allow-empty-catch: not valid yet */ }
}

async function loadSource(address, { start = null } = {}) {
  const id = ++S.loadId;
  S.original = address;
  S.ready = false; S.resumed = false; S.codecs = null; S.noticeFor = '';
  S.ab = { a: null, b: null };
  S.pendingStart = start;
  hideState(); $('mv-notice').hidden = true;
  document.body.dataset.state = 'loading';
  captions.reset();
  setChapters([]);
  setKind(guessKind(address));
  $('mv-title').textContent = nameOf(address);
  $('mv-artist').textContent = ''; $('mv-album').textContent = '';
  document.title = nameOf(address);
  const img = $('mv-cover-img'); img.hidden = true; $('mv-cover-ph').hidden = false; revokeCover();
  media.src = docHref(address);
  media.load();
  updateAB(); updateProgress(); syncUI();
  highlightQueue();
  const ext = extOf(address);
  if (['.mp3', '.m4a', '.mp4', '.m4v', '.mov', '.flac', '.mkv', '.webm', '.aac', '.wav'].includes(ext)) {
    try {
      const tags = await readTags(docHref(address), ext);
      if (id === S.loadId) applyTags(tags);
    } catch (err) { console.warn('[Player] the file\'s tags could not be read:', err.message); }
  }
}

function playTimeFromStore() {
  if (S.pendingStart != null) return { t: S.pendingStart, resumed: false };
  const place = store.getPlace(S.original);
  return place != null ? { t: place, resumed: true } : null;
}

async function diagnose() {
  let response;
  try { response = await fetch(docHref(S.original), { headers: { Range: 'bytes=0-0' } }); }
  catch (err) { return { kind: 'network', detail: err.message }; }
  if (response.status === 404) return { kind: 'missing', detail: String(response.status) };
  if (response.status === 401 || response.status === 403) return { kind: 'refused', detail: String(response.status) };
  if (response.status >= 400) return { kind: 'server', detail: String(response.status) };
  try { await response.body.cancel(); } catch { /* vex-allow-empty-catch: done */ }
  return { kind: 'ok', detail: response.headers.get('content-type') || '' };
}

async function onError() {
  const err = media.error;
  if (!err || err.code === 1) return;                    // MEDIA_ERR_ABORTED: a new file was loaded
  const id = S.loadId;
  const why = await diagnose();
  if (id !== S.loadId) return;
  const retry = { label: t('Try again'), run: () => loadSource(S.original) };
  const detail = (err.message || '').replace(/^MEDIA_ELEMENT_ERROR:\s*/, '');
  S.ready = false;
  if (why.kind === 'missing') showState({ title: t('That file is not there'), text: t('The address answered "not found". It may have been moved or deleted.'), detail: S.original, actions: [retry, ...externalActions().slice(1)] });
  else if (why.kind === 'refused') showState({ title: t('The server would not give the file'), text: t('It asked for a sign-in or refused the request. Sign in to the site in this tab, then try again.'), detail: S.original, actions: [retry, ...externalActions().slice(1)] });
  else if (why.kind === 'network' || why.kind === 'server' || err.code === 2) showState({ title: t('The file could not be read'), text: t('The connection stopped or the server did not answer.'), detail: why.detail || detail, actions: [retry, ...externalActions()] });
  else {
    const ext = extOf(S.original).replace('.', '').toUpperCase();
    showState({
      title: t('This file cannot be played here'),
      text: err.code === 3
        ? t('Part of it could not be decoded: the file may be damaged, or it uses a format Vex\'s player does not have, such as HEVC video or AC3 and DTS sound.')
        : t('Its format is not one Vex\'s player can open{ext}. Video in HEVC and sound in AC3 or DTS are the usual reasons.', { ext: ext ? ' (' + ext + ')' : '' }),
      detail,
      actions: externalActions(),
    });
  }
  syncUI();
}

// ---- events from the media ---------------------------------------------------------------------
media.addEventListener('loadedmetadata', () => {
  S.ready = true;
  document.body.dataset.state = 'ready';
  if (S.kind === 'video' && media.videoWidth === 0) setKind('audio');
  const where = playTimeFromStore();
  if (where && Number.isFinite(media.duration) && where.t < media.duration - 1) {
    media.currentTime = where.t;
    if (where.resumed) toast(t('Continuing from {time}', { time: fmtTime(where.t) }), { action: { label: t('Start over'), run: () => { media.currentTime = 0; } }, ms: 6000 });
  }
  setChapters(S.chapters);
  readTrackChapters();
  captions.syncEmbedded();
  updateProgress(); updateAria(); updateBuffered(); updateAB(); syncUI();
  media.play().catch((err) => { if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') fail(err); });
});
media.addEventListener('durationchange', () => { setChapters(S.chapters); updateProgress(); updateAria(); updateAB(); });
media.addEventListener('timeupdate', () => {
  updateProgress(); updateAria(); updatePosition(); captions.render();
  const now = Date.now();
  if (!media.paused && now - S.lastSave > 4000) { S.lastSave = now; store.setPlace(S.original, media.currentTime, media.duration); }
});
media.addEventListener('progress', updateBuffered);
media.addEventListener('seeked', () => { captions.render(); updateBuffered(); });
media.addEventListener('play', () => { startFrameLoop(); if (S.kind === 'audio') { viz.resume(); viz.start(); } activity(); syncUI(); });
media.addEventListener('playing', () => { checkSound(); if (S.kind === 'audio') viz.resume(); });
media.addEventListener('pause', () => { store.setPlace(S.original, media.currentTime, media.duration); activity(); syncUI(); });
media.addEventListener('ended', () => {
  store.setPlace(S.original, media.duration, media.duration);
  syncUI();
  const next = queue.peekNext(true);
  if (!next) return;
  if (next.index === queue.index) { media.currentTime = 0; media.play().catch(fail); return; }       // repeat this file
  playIndex(next.index);
});
media.addEventListener('volumechange', syncUI);
media.addEventListener('ratechange', syncUI);
media.addEventListener('error', guard(onError));
media.addEventListener('enterpictureinpicture', syncUI);
media.addEventListener('leavepictureinpicture', syncUI);
document.addEventListener('fullscreenchange', syncUI);
window.addEventListener('pagehide', () => store.setPlace(S.original, media.currentTime, media.duration));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { store.setPlace(S.original, media.currentTime, media.duration); viz.stop(); }
  else if (S.kind === 'audio' && !media.paused) viz.start();
});

// A video that plays but has no sound: when the header names a sound format the decoders lack, say so.
function checkSound() {
  if (S.kind !== 'video' || S.noticeFor === S.original) return;
  const wanted = S.codecs && S.codecs.length;
  if (!wanted) return;
  setTimeout(() => {
    if (media.paused || S.noticeFor === S.original) return;
    if (typeof media.webkitAudioDecodedByteCount === 'number' && media.webkitAudioDecodedByteCount === 0 && media.currentTime > 1) {
      S.noticeFor = S.original;
      showNotice(t('This video plays without sound: its sound is in {codec}, which Vex\'s player cannot decode.', { codec: S.codecs.join(', ') }), externalActions().slice(0, 1));
    }
  }, 2500);
}

// The frame length, measured from the frames the player presents; 1/30 until it knows.
if (typeof media.requestVideoFrameCallback === 'function') {
  let lastMedia = null;
  const gaps = [];
  const onFrame = (_now, meta) => {
    if (lastMedia != null && meta.mediaTime > lastMedia) {
      const gap = meta.mediaTime - lastMedia;
      if (gap > 0.004 && gap < 0.1) { gaps.push(gap); if (gaps.length > 15) gaps.shift(); const sorted = [...gaps].sort((a, b) => a - b); S.frameDur = sorted[Math.floor(sorted.length / 2)]; }
    }
    lastMedia = meta.mediaTime;
    media.requestVideoFrameCallback(onFrame);
  };
  media.requestVideoFrameCallback(onFrame);
}

// ---- hiding the bar --------------------------------------------------------------------------------
function activity() {
  document.body.dataset.idle = 'false';
  clearTimeout(S.idleTimer);
  if (S.kind !== 'video' || media.paused) return;
  S.idleTimer = setTimeout(() => {
    const keyboardFocus = controls.contains(document.activeElement) && document.activeElement.matches(':focus-visible');
    if (controls.matches(':hover') || keyboardFocus || isOpen() || media.paused || !$('mv-queue').hidden) { activity(); return; }
    document.body.dataset.idle = 'true';
  }, IDLE_MS);
}
for (const type of ['pointermove', 'pointerdown', 'keydown', 'focusin']) stage.addEventListener(type, activity, true);

// ---- the seek bar ---------------------------------------------------------------------------------------
{
  const seek = $('mv-seek');
  const ratioOf = (event) => { const r = $('mv-seek').getBoundingClientRect(); return clamp((event.clientX - r.left) / r.width, 0, 1); };
  const hover = $('mv-hover');
  const showHover = (event) => {
    const d = media.duration;
    if (!Number.isFinite(d) || d <= 0) { hover.hidden = true; return; }
    const r = ratioOf(event);
    const time = r * d;
    $('mv-hover-time').textContent = fmtTime(time);
    const chapter = chapterAt(time);
    $('mv-hover-chapter').textContent = chapter && chapter.title ? chapter.title : '';
    hover.hidden = false;
    const box = seek.getBoundingClientRect();
    const half = hover.offsetWidth / 2;
    hover.style.left = clamp(r * box.width, half, box.width - half) + 'px';
  };
  seek.addEventListener('pointerdown', (event) => { seek.setPointerCapture(event.pointerId); seek.dataset.drag = 'true'; seekRatio(ratioOf(event)); showHover(event); });
  seek.addEventListener('pointermove', (event) => { showHover(event); if (seek.dataset.drag === 'true') seekRatio(ratioOf(event)); });
  seek.addEventListener('pointerup', () => { seek.dataset.drag = 'false'; });
  seek.addEventListener('pointercancel', () => { seek.dataset.drag = 'false'; });
  seek.addEventListener('pointerleave', () => { if (seek.dataset.drag !== 'true') hover.hidden = true; });
}

// ---- menus -------------------------------------------------------------------------------------------------------
function speedMenu(anchor) {
  openMenu(anchor || $('mv-speed'), {
    label: t('Playback speed'), title: t('Playback speed'),
    items: RATES.map((r) => ({ label: r === 1 ? t('Normal') : fmtRate(r), role: 'menuitemradio', checked: Math.abs(media.playbackRate - r) < 0.001, onSelect: () => setRate(r) })),
  });
}
function shotMenu() {
  openMenu($('mv-shot'), {
    label: t('Picture of this frame'),
    items: [
      { label: t('Copy the picture'), icon: 'copy', onSelect: guard(copyFrame) },
      { label: t('Save the picture'), icon: 'download', onSelect: guard(saveFrame) },
    ],
  });
}
function tracksMenu() {
  const list = Array.from(media.audioTracks || []);
  openMenu($('mv-tracks'), {
    label: t('Audio track'), title: t('Audio track'),
    items: list.map((tr, i) => ({ label: tr.label || tr.language || t('Track {n}', { n: i + 1 }), role: 'menuitemradio', checked: tr.enabled, onSelect: () => { list.forEach((x) => { x.enabled = x === tr; }); } })),
  });
}
function chaptersMenu(anchor) {
  openMenu(anchor, {
    label: t('Chapters'), title: t('Chapters'),
    items: S.chapters.map((c) => ({ label: c.title || fmtTime(c.start), hint: fmtTime(c.start), role: 'menuitemradio', checked: chapterAt(media.currentTime) === c, onSelect: () => { media.currentTime = c.start; } })),
  });
}
function shortcutsPanel(anchor) {
  const rows = [
    ['Space / K', t('Play or pause')], ['J / L', t('Back or forward 10 seconds')], ['← / →', t('Back or forward 5 seconds')], ['↑ / ↓', t('Volume')],
    ['0–9', t('Jump to 0% to 90%')], ['Home / End', t('Start or end')], ['M', t('Mute')], ['F', t('Full screen')],
    ['< / >', t('Slower or faster')], [', / .', t('Previous or next frame')], ['A', t('Loop a section')], ['C', t('Subtitles on or off')],
    ['S', t('Copy a picture of this frame')], ['I', t('Picture in picture')], ['N / P', t('Next or previous in the queue')], ['PgUp / PgDn', t('Previous or next chapter')],
    ['V', t('Visualiser')], ['Q', t('Queue')],
  ];
  const dl = h('dl', {}, ...rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]));
  const panel = openPanel(anchor, h('div', {}, h('div', { class: 'mv-pop-title', text: t('Keyboard shortcuts') }), dl), { label: t('Keyboard shortcuts') });
  panel.classList.add('mv-keys');
}
function subsPanel(anchor) {
  const built = captions.panel({
    beside: () => S.beside,
    onLoad: guard(async (what, entry) => {
      if (what === 'file') $('mv-file').click();
      else { await captions.loadBeside(entry); built.redraw(); }
    }),
  });
  openPanel(anchor, built.node, { label: t('Subtitles'), onClose: () => { subsRedraw = null; } });
  subsRedraw = built.redraw;
}
let subsRedraw = null;

function moreMenu() {
  const isFile = /^file:/i.test(S.original);
  const video = S.kind === 'video';
  const items = [];
  if (S.chapters.length) items.push({ label: t('Chapters'), icon: 'list', hint: String(S.chapters.length), onSelect: () => chaptersMenu($('mv-more')) });
  items.push({ label: t('Subtitles'), icon: 'captions', onSelect: () => subsPanel($('mv-more')) });
  items.push({ label: t('Playback speed'), icon: 'gauge', hint: fmtRate(media.playbackRate), onSelect: () => speedMenu($('mv-more')) });
  items.push({ label: S.ab.a == null ? t('Loop a section: set the start') : S.ab.b == null ? t('Loop a section: set the end') : t('Loop a section: clear'), icon: 'ab-loop', hint: 'A', onSelect: cycleAB });
  if (video) {
    items.push({ label: t('Previous frame'), icon: 'frame-back', hint: ',', onSelect: () => frameStep(-1) });
    items.push({ label: t('Next frame'), icon: 'frame-forward', hint: '.', onSelect: () => frameStep(1) });
    items.push({ label: t('Copy the picture'), icon: 'camera', hint: 'S', onSelect: guard(copyFrame) });
    items.push({ label: t('Save the picture'), icon: 'download', onSelect: guard(saveFrame) });
    if (document.pictureInPictureEnabled) items.push({ label: t('Picture in picture'), icon: 'pip', hint: 'I', onSelect: guard(togglePip) });
  } else {
    items.push({ label: t('Visualiser: {mode}', { mode: vizName(viz.mode) }), icon: 'wave', hint: 'V', onSelect: cycleViz });
  }
  items.push({ label: t('Night mode'), icon: 'moon', role: 'menuitemcheckbox', checked: !!(window.__vexNight && window.__vexNight.on), onSelect: toggleNight });
  items.push({ separator: true });
  items.push({ label: t('Open with Windows'), icon: 'external', onSelect: guard(async () => { const r = await needHost().openExternal(); if (!r.ok) throw new Error(r.error); }) });
  items.push({ label: isFile ? t('Show in folder') : t('Download'), icon: isFile ? 'folder-open' : 'download', onSelect: guard(async () => { const r = await needHost().download(); if (!r.ok) throw new Error(r.error); if (r.viaDownloads) toast(t('The download has started')); }) });
  items.push({ label: t('Copy the address'), icon: 'link', onSelect: guard(async () => { await navigator.clipboard.writeText(S.original); toast(t('The address is copied')); }) });
  items.push({ label: t('Keyboard shortcuts'), icon: 'keyboard', hint: '?', onSelect: () => shortcutsPanel($('mv-more')) });
  openMenu($('mv-more'), { label: t('More'), items });
}

const vizName = (m) => (m === 'bars' ? t('Bars') : m === 'wave' ? t('Wave') : t('Off'));
function cycleViz() {
  const order = ['bars', 'wave', 'off'];
  const next = order[(order.indexOf(viz.mode) + 1) % order.length];
  viz.setMode(next);
  store.write('viz', next);
  toast(t('Visualiser: {mode}', { mode: vizName(next) }), { ms: 1200 });
}

// Night mode is the window's own (js/night-audio.js): it is asked, and answers.
function toggleNight() {
  const on = !(window.__vexNight && window.__vexNight.on);
  needHost().tell('night', on);
}

// ---- the queue --------------------------------------------------------------------------------------------------------
function renderQueue() {
  const list = $('mv-queue-list');
  list.replaceChildren();
  queue.items.forEach((item, i) => {
    const current = i === queue.index;
    const row = h('button', { class: 'mv-queue-item', type: 'button', 'aria-current': current ? 'true' : null, onclick: () => playIndex(i) },
      h('span', { class: 'mv-queue-num', text: String(i + 1) }), h('span', { class: 'mv-queue-name', text: item.name.replace(/\.[^.]+$/, '') }));
    if (current) { const mark = h('span', { class: 'mv-queue-now', 'aria-hidden': 'true' }); mark.innerHTML = iconHtml('play', 14); row.append(mark); }
    list.append(h('li', {}, row));
  });
  $('mv-queue-count').textContent = String(queue.size);
}
function highlightQueue() { if (queue.usable) renderQueue(); }
function toggleQueue(force) {
  const open = force != null ? force : $('mv-queue').hidden;
  $('mv-queue').hidden = !open;
  syncUI();
  if (open) { const cur = $('mv-queue-list').querySelector('[aria-current="true"]'); if (cur) cur.scrollIntoView({ block: 'center' }); }
}
function playIndex(i, { back } = {}) {
  const item = queue.goTo(i, { back });
  history.pushState({}, '', viewerHref(item.url));
  return loadSource(item.url);
}
function goNext() { const n = queue.peekNext(false); if (n) playIndex(n.index); }
function goPrev() {
  if (media.currentTime > 4 || !queue.usable) { media.currentTime = 0; return; }
  const p = queue.peekPrev();
  if (p) playIndex(p.index, { back: !!p.fromTrail });
}

async function loadSiblings() {
  if (!host || !/^file:/i.test(S.original)) return;
  const r = await host.siblings();
  if (!r.ok) throw new Error(r.error);
  const kindOf = (e) => (AUDIO_EXT.includes(e) ? 'audio' : VIDEO_EXT.includes(e) ? 'video' : '');
  const mine = kindOf(extOf(S.original));
  const items = r.items.filter((i) => kindOf(i.ext) === mine);
  queue.set(items, S.original);
  if (queue.index < 0) queue.set(r.items, S.original);
  S.beside = r.subs || [];
  renderQueue(); syncUI();
}

// ---- keys ------------------------------------------------------------------------------------------------------------------
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
  const target = event.target;
  const tag = target && target.tagName;
  const range = tag === 'INPUT' && target.type === 'range';
  if ((tag === 'INPUT' && !range) || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (isOpen() && event.key !== 'Escape') return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const onButton = !!(target && target.closest && target.closest('button'));
  let handled = true;
  switch (key) {
    case ' ': if (onButton) { handled = false; break; } togglePlay(); break;
    case 'k': togglePlay(); break;
    case 'ArrowLeft': if (range) { handled = false; break; } seekBy(event.shiftKey ? -1 : -5); break;
    case 'ArrowRight': if (range) { handled = false; break; } seekBy(event.shiftKey ? 1 : 5); break;
    case 'ArrowUp': if (range) { handled = false; break; } setVolume(media.volume + 0.05); break;
    case 'ArrowDown': if (range) { handled = false; break; } setVolume(media.volume - 0.05); break;
    case 'j': seekBy(-10); break;
    case 'l': seekBy(10); break;
    case 'm': toggleMute(); break;
    case 'f': guard(toggleFullscreen)(); break;
    case 'Home': media.currentTime = 0; break;
    case 'End': if (Number.isFinite(media.duration)) media.currentTime = Math.max(0, media.duration - 0.1); break;
    case 'PageUp': jumpChapter(-1); break;
    case 'PageDown': jumpChapter(1); break;
    case ',': frameStep(-1); break;
    case '.': frameStep(1); break;
    case '<': stepRate(-1); break;
    case '>': stepRate(1); break;
    case 'a': cycleAB(); break;
    case 'c': { const r = captions.toggle(); if (r === null) toast(t('There are no subtitles yet. Load a file from the subtitles button.')); else toast(r ? t('Subtitles on') : t('Subtitles off'), { ms: 1200 }); break; }
    case 's': guard(copyFrame)(); break;
    case 'i': guard(togglePip)(); break;
    case 'n': goNext(); break;
    case 'p': goPrev(); break;
    case 'q': if (queue.usable) toggleQueue(); break;
    case 'v': if (S.kind === 'audio') cycleViz(); else handled = false; break;
    case '?': shortcutsPanel($('mv-more')); break;
    case 'Escape': if ($('mv-queue').hidden === false) toggleQueue(false); else handled = false; break;
    default:
      if (/^[0-9]$/.test(key)) { seekRatio(Number(key) / 10); break; }
      handled = false;
  }
  if (handled) { event.preventDefault(); activity(); }
});

// ---- buttons ----------------------------------------------------------------------------------------------------------------------
$('mv-play').addEventListener('click', togglePlay);
$('mv-big').addEventListener('click', togglePlay);
$('mv-back').addEventListener('click', () => seekBy(-10));
$('mv-fwd').addEventListener('click', () => seekBy(10));
$('mv-prev').addEventListener('click', goPrev);
$('mv-next').addEventListener('click', () => goNext());
$('mv-mute').addEventListener('click', toggleMute);
$('mv-vol').addEventListener('input', () => { media.volume = Number($('mv-vol').value) / 100; if (media.volume > 0) media.muted = false; store.write('volume', media.volume); });
const toggler = (anchor, open) => () => { if (openAnchor() === anchor) closePop(true); else open(); };
$('mv-speed').addEventListener('click', toggler($('mv-speed'), () => speedMenu()));
$('mv-shot').addEventListener('click', toggler($('mv-shot'), shotMenu));
$('mv-tracks').addEventListener('click', toggler($('mv-tracks'), tracksMenu));
$('mv-more').addEventListener('click', toggler($('mv-more'), moreMenu));
$('mv-subs-btn').addEventListener('click', toggler($('mv-subs-btn'), () => subsPanel($('mv-subs-btn'))));
$('mv-ab-btn').addEventListener('click', cycleAB);
$('mv-step-back').addEventListener('click', () => frameStep(-1));
$('mv-step-fwd').addEventListener('click', () => frameStep(1));
$('mv-night').addEventListener('click', guard(toggleNight));
$('mv-pip').addEventListener('click', guard(togglePip));
$('mv-full').addEventListener('click', guard(toggleFullscreen));
$('mv-shuffle').addEventListener('click', () => { queue.toggleShuffle(); syncUI(); });
$('mv-repeat').addEventListener('click', () => { queue.cycleRepeat(); media.loop = false; syncUI(); toast($('mv-repeat').title, { ms: 1200 }); });
$('mv-queue-btn').addEventListener('click', () => toggleQueue());
$('mv-queue-close').addEventListener('click', () => { toggleQueue(false); $('mv-queue-btn').focus(); });
$('mv-notice-close').addEventListener('click', () => { $('mv-notice').hidden = true; });

// Clicking the picture plays or pauses; a double click is full screen.
function stageClick(event) {
  if (event.target.closest('.mv-controls, .mv-pop, .mv-queue, .mv-state, .mv-notice, .mv-toast')) return;
  if (S.kind !== 'video') return;
  clearTimeout(S.clickTimer);
  S.clickTimer = setTimeout(togglePlay, 220);
}
stage.addEventListener('click', stageClick);
stage.addEventListener('dblclick', (event) => {
  if (event.target.closest('.mv-controls, .mv-pop, .mv-queue, .mv-state, .mv-notice') || S.kind !== 'video') return;
  clearTimeout(S.clickTimer);
  guard(toggleFullscreen)();
});

// Subtitle files: the file chooser, and a file dropped on the page. A dropped media file is left to the browser (main sends it here).
$('mv-file').addEventListener('change', guard(async () => {
  const file = $('mv-file').files[0];
  $('mv-file').value = '';
  if (!file) return;
  await captions.loadFile(file);
  toast(t('Subtitles loaded: {name}', { name: file.name }));
  if (subsRedraw) subsRedraw();
}));
stage.addEventListener('dragover', (event) => {
  const items = Array.from((event.dataTransfer && event.dataTransfer.items) || []);
  if (items.some((i) => i.kind === 'file' && /^(video|audio)\//.test(i.type))) return;
  if (items.some((i) => i.kind === 'file')) event.preventDefault();
});
stage.addEventListener('drop', guard(async (event) => {
  const file = Array.from((event.dataTransfer && event.dataTransfer.files) || []).find((f) => SUBTITLE_EXT.includes(extOf(f.name)));
  if (!file) return;
  event.preventDefault();
  await captions.loadFile(file);
  toast(t('Subtitles loaded: {name}', { name: file.name }));
}));

// ---- the window talking to the page -------------------------------------------------------------------------------------------------
function onHost(msg) {
  if (!msg) return;
  if (msg.type === 'theme') applyThemePayload(msg.payload);
  else if (msg.type === 'night') {
    if (!msg.ok) toast(msg.error || t('Night mode could not be turned on'));
    else toast(msg.on ? t('Night mode on') : t('Night mode off'), { ms: 1500 });
    syncUI();
  }
}

function relabel() {
  applyStatic();
  syncUI();
  if (S.kind === 'audio' && !S.tags) $('mv-title').textContent = nameOf(S.original);
}

window.addEventListener('popstate', () => {
  const u = new URLSearchParams(location.search).get('u');
  if (!u || u === S.original) return;
  const i = queue.items.findIndex((x) => x.url === u);
  if (i >= 0) queue.goTo(i);
  loadSource(u, { start: parseStart(location.hash) });
});

// ---- start --------------------------------------------------------------------------------------------------------------------------------
function boot() {
  paintIcons();
  applyStatic();
  refreshScheme();
  onThemeChange(() => { relabel(); viz.refreshColor(); });
  viz.setMode(store.read('viz', matchMedia('(prefers-reduced-motion: reduce)').matches ? 'off' : 'bars'));
  const savedVolume = store.read('volume', null);
  if (typeof savedVolume === 'number') media.volume = clamp(savedVolume, 0, 1);
  wireMediaSession();
  if (host) host.onHost(onHost);
  const original = new URLSearchParams(location.search).get('u');
  if (!original) {
    showState({ title: t('Nothing to play'), text: t('This page was opened without a file.'), actions: [] });
    return;
  }
  const start = parseStart(location.hash);
  loadSource(original, { start });
  loadSiblings().catch((err) => console.warn('[Player] the folder could not be listed:', err.message));
  new ResizeObserver(() => { document.documentElement.style.setProperty('--mv-bar-h', controls.offsetHeight + 'px'); }).observe(controls);
}
boot();
