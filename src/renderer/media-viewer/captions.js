// Subtitles: the tracks (embedded WebVTT the browser exposes, files loaded from disk, files found beside the media), drawn by the player
// itself so that size, colour, background, position and delay are the person's. Nothing leaves the computer: a file is read here, as text.

import { h, decodeText, iconHtml } from './util.js';
import { t } from './strings.js';
import { parseSubtitles, cuesAt, cuesOfTrack } from './subs.js';
import * as store from './store.js';

export const COLORS = [
  { id: 'white', value: '#ffffff', name: 'White' },
  { id: 'yellow', value: '#ffe45c', name: 'Yellow' },
  { id: 'cyan', value: '#7fe7ff', name: 'Cyan' },
  { id: 'green', value: '#a6ffb4', name: 'Green' },
];
export const BACKGROUNDS = [
  { id: 'none', value: 'transparent', name: 'None' },
  { id: 'dim', value: 'rgba(0, 0, 0, 0.74)', name: 'Dim' },
  { id: 'solid', value: '#000000', name: 'Solid' },
];
export const DEFAULTS = Object.freeze({ scale: 1, color: 'white', bg: 'dim', pos: 6 });
export const LIMITS = Object.freeze({ scaleMin: 0.6, scaleMax: 2.4, posMin: 2, posMax: 40, delayMax: 15 });

export function createCaptions({ media, overlay, stage, onChange }) {
  let tracks = [];                 // { id, label, cues, source: 'embedded' | 'file' | 'beside' }
  let activeId = null;
  let delay = 0;
  let prefs = { ...DEFAULTS, ...store.read('subs', {}) };
  let lastKey = '';
  let seq = 0;

  function applyPrefs() {
    const color = COLORS.find((c) => c.id === prefs.color) || COLORS[0];
    const bg = BACKGROUNDS.find((c) => c.id === prefs.bg) || BACKGROUNDS[1];
    const root = document.documentElement.style;
    root.setProperty('--mv-sub-scale', String(prefs.scale));
    root.setProperty('--mv-sub-pos', prefs.pos + '%');
    root.setProperty('--mv-sub-color', color.value);
    root.setProperty('--mv-sub-bg', bg.value);
  }
  function setPref(key, value) {
    prefs = { ...prefs, [key]: value };
    store.write('subs', prefs);
    applyPrefs();
  }
  applyPrefs();

  function render() {
    const active = tracks.find((x) => x.id === activeId);
    const cues = active ? cuesAt(active.cues, media.currentTime - delay) : [];
    const key = cues.map((c) => c.text).join('\u0001');
    if (key === lastKey) return;
    lastKey = key;
    overlay.replaceChildren();
    for (const cue of cues) for (const line of cue.text.split('\n')) overlay.append(h('span', { class: 'mv-sub-line', text: line, dir: 'auto' }));
  }

  function add(label, cues, source) {
    const track = { id: 't' + (++seq), label, cues, source };
    tracks.push(track);
    return track;
  }
  function select(id) {
    activeId = id;
    lastKey = '\u0000';
    render();
    if (onChange) onChange();
  }

  // Embedded text tracks the browser itself exposes (WebVTT in the media or in a <track>). They are read, then hidden: the player draws them.
  function syncEmbedded() {
    const list = media.textTracks;
    if (!list) return;
    for (const tt of Array.from(list)) {
      if (tt.kind !== 'subtitles' && tt.kind !== 'captions') continue;
      if (tracks.some((x) => x.native === tt)) continue;
      if (tt.mode === 'disabled') tt.mode = 'hidden';
      const entry = { id: 't' + (++seq), label: tt.label || tt.language || t('Subtitles'), cues: [], source: 'embedded', native: tt };
      tracks.push(entry);
      const read = () => { entry.cues = cuesOfTrack(tt); lastKey = '\u0000'; render(); if (onChange) onChange(); };
      tt.addEventListener('cuechange', () => { if (!entry.cues.length) read(); });
      setTimeout(read, 400);
    }
    if (onChange) onChange();
  }

  async function loadFile(file) {
    const text = decodeText(new Uint8Array(await file.arrayBuffer()));
    const parsed = parseSubtitles(text);
    if (!parsed.cues.length) throw new Error(t('No subtitles were found in {name}', { name: file.name }));
    const track = add(file.name.replace(/\.[^.]+$/, ''), parsed.cues, 'file');
    select(track.id);
    return track;
  }

  // A file found beside the media (the host listed it): fetched through the player's own route.
  async function loadBeside(entry) {
    const response = await fetch('/doc?u=' + encodeURIComponent(entry.url));
    if (!response.ok) throw new Error(t('{name} could not be read', { name: entry.name }));
    const parsed = parseSubtitles(decodeText(new Uint8Array(await response.arrayBuffer())));
    if (!parsed.cues.length) throw new Error(t('No subtitles were found in {name}', { name: entry.name }));
    const track = add(entry.name.replace(/\.[^.]+$/, ''), parsed.cues, 'beside');
    select(track.id);
    return track;
  }

  function reset() {
    tracks = []; activeId = null; delay = 0; lastKey = '\u0000';
    overlay.replaceChildren();
    if (onChange) onChange();
  }

  // The panel: tracks, and how they look.
  function panel({ onLoad, beside }) {
    const body = h('div', {});
    const draw = () => {
      body.replaceChildren();
      const list = h('div', { role: 'radiogroup', 'aria-label': t('Subtitle track') });
      const radio = (label, id, hint) => {
        const check = h('span', { class: 'mv-item-check', 'aria-hidden': 'true' });
        if (activeId === id) check.innerHTML = iconHtml('check', 16);
        const b = h('button', { class: 'mv-item', type: 'button', role: 'radio', 'aria-checked': String(activeId === id) },
          check, h('span', { class: 'mv-item-label', text: label }), hint ? h('span', { class: 'mv-item-hint', text: hint }) : null);
        b.addEventListener('click', () => { select(id); draw(); });
        return b;
      };
      list.append(radio(t('Off'), null));
      for (const track of tracks) list.append(radio(track.label, track.id, track.cues.length ? String(track.cues.length) : ''));
      body.append(h('div', { class: 'mv-pop-title', text: t('Subtitle track') }), list);
      for (const entry of beside()) {
        if (tracks.some((x) => x.label === entry.name.replace(/\.[^.]+$/, ''))) continue;
        body.append(h('button', { class: 'mv-item', type: 'button', onclick: () => onLoad('beside', entry) },
          h('span', { class: 'mv-item-check', 'aria-hidden': 'true' }), h('span', { class: 'mv-item-label', text: t('Use {name}', { name: entry.name }) })));
      }
      body.append(h('button', { class: 'mv-item', type: 'button', onclick: () => onLoad('file') },
        h('span', { class: 'mv-item-check', 'aria-hidden': 'true' }), h('span', { class: 'mv-item-label', text: t('Load subtitles…') })));
      body.append(h('div', { class: 'mv-sep', role: 'separator' }));

      // size
      const sizeValue = h('span', { class: 'mv-field-value', text: Math.round(prefs.scale * 100) + '%' });
      const size = h('input', { type: 'range', id: 'mv-sub-size', min: String(LIMITS.scaleMin * 100), max: String(LIMITS.scaleMax * 100), step: '10', value: String(Math.round(prefs.scale * 100)) });
      size.addEventListener('input', () => { setPref('scale', Number(size.value) / 100); sizeValue.textContent = size.value + '%'; });
      body.append(h('div', { class: 'mv-field' }, h('label', { for: 'mv-sub-size', text: t('Size') }), sizeValue, size));

      // position
      const posValue = h('span', { class: 'mv-field-value', text: prefs.pos + '%' });
      const pos = h('input', { type: 'range', id: 'mv-sub-pos', min: String(LIMITS.posMin), max: String(LIMITS.posMax), step: '1', value: String(prefs.pos) });
      pos.addEventListener('input', () => { setPref('pos', Number(pos.value)); posValue.textContent = pos.value + '%'; });
      body.append(h('div', { class: 'mv-field' }, h('label', { for: 'mv-sub-pos', text: t('Height from the bottom') }), posValue, pos));

      // colour
      const colors = h('div', { class: 'mv-swatches', role: 'radiogroup', 'aria-label': t('Colour') });
      for (const c of COLORS) {
        const sw = h('button', { class: 'mv-swatch', type: 'button', role: 'radio', 'aria-checked': String(prefs.color === c.id), 'aria-label': t(c.name), title: t(c.name) });
        sw.style.background = c.value;
        sw.addEventListener('click', () => { setPref('color', c.id); colors.querySelectorAll('.mv-swatch').forEach((x) => x.setAttribute('aria-checked', String(x === sw))); });
        colors.append(sw);
      }
      body.append(h('div', { class: 'mv-field' }, h('span', { class: 'mv-field-name', text: t('Colour') }), h('span'), colors));

      // background
      const segs = h('div', { class: 'mv-segs', role: 'radiogroup', 'aria-label': t('Background') });
      for (const b of BACKGROUNDS) {
        const seg = h('button', { class: 'mv-seg', type: 'button', role: 'radio', 'aria-checked': String(prefs.bg === b.id), text: t(b.name) });
        seg.addEventListener('click', () => { setPref('bg', b.id); segs.querySelectorAll('.mv-seg').forEach((x) => x.setAttribute('aria-checked', String(x === seg))); });
        segs.append(seg);
      }
      body.append(h('div', { class: 'mv-field' }, h('span', { class: 'mv-field-name', text: t('Background') }), h('span'), segs));

      // delay
      const delayValue = h('span', { class: 'mv-field-value', text: fmtDelay(delay) });
      const delayRange = h('input', { type: 'range', id: 'mv-sub-delay', min: String(-LIMITS.delayMax), max: String(LIMITS.delayMax), step: '0.1', value: String(delay) });
      const setDelay = (v) => { delay = Math.round(Math.max(-LIMITS.delayMax, Math.min(LIMITS.delayMax, v)) * 10) / 10; delayRange.value = String(delay); delayValue.textContent = fmtDelay(delay); lastKey = '\u0000'; render(); };
      delayRange.addEventListener('input', () => setDelay(Number(delayRange.value)));
      const nudge = (label, aria, by) => h('button', { class: 'mv-btn', type: 'button', text: label, 'aria-label': aria, onclick: () => setDelay(delay + by) });
      body.append(h('div', { class: 'mv-field' }, h('label', { for: 'mv-sub-delay', text: t('Delay') }), delayValue, delayRange,
        h('div', { class: 'mv-nudge' }, nudge('− 0.5', t('Show subtitles 0.5 seconds earlier'), -0.5), nudge('0', t('Reset the delay'), -delay), nudge('+ 0.5', t('Show subtitles 0.5 seconds later'), 0.5))));
    };
    draw();
    return { node: body, redraw: draw };
  }

  return {
    get tracks() { return tracks; },
    get activeId() { return activeId; },
    get delay() { return delay; },
    get prefs() { return prefs; },
    add, select, syncEmbedded, loadFile, loadBeside, reset, render, panel,
    on() { return activeId != null; },
    // The C key: off when on; else the last track (or the first).
    toggle() {
      if (activeId != null) { select(null); return false; }
      if (!tracks.length) return null;
      select(tracks[tracks.length - 1].id);
      return true;
    },
  };
}

export function fmtDelay(v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + ' ' + t('s'); }
