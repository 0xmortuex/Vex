// What the player remembers, on this computer only (the page's own localStorage, in the session the tab runs in; never synced).
// A private page, a Tor tab and the Tor route are served with <meta name="vex-persist" content="0"> (main/media-viewer.js wireSession),
// and then nothing is kept: read() gives the default and write() does nothing.

const PREFIX = 'vexmedia.';
const MAX_PLACES = 200;
const MIN_LENGTH = 90;        // a file shorter than this is not worth a place
const MIN_PLACE = 8;          // before this many seconds in, there is nothing to resume
const END_MARGIN = 10;        // within this of the end, the file is finished

export const canKeep = () => document.querySelector('meta[name="vex-persist"]')?.getAttribute('content') === '1';

export function read(key, fallback) {
  if (!canKeep()) return fallback;
  const raw = localStorage.getItem(PREFIX + key);
  if (raw == null) return fallback;
  try { const v = JSON.parse(raw); return v == null ? fallback : v; }
  catch (err) { console.error('[Player] "' + key + '" is not readable and was ignored:', err.message); return fallback; }
}

export function write(key, value) {
  if (!canKeep()) return false;
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; }
  catch (err) { console.error('[Player] "' + key + '" could not be kept:', err.message); return false; }
}

const placeKey = (address) => String(address || '').replace(/#.*$/, '');

export function getPlace(address) {
  const p = read('resume', {})[placeKey(address)];
  return p && Number.isFinite(p.t) && p.t >= MIN_PLACE ? p.t : null;
}

// Keeps where the file was left, or forgets it when it is at the start or the end. Returns whether something was kept.
export function setPlace(address, t, d, now = Date.now()) {
  if (!canKeep()) return false;
  const key = placeKey(address);
  if (!key) return false;
  const all = read('resume', {});
  const finished = !Number.isFinite(d) || d < MIN_LENGTH || t < MIN_PLACE || t > d - END_MARGIN;
  if (finished) {
    if (key in all) { delete all[key]; write('resume', all); }
    return false;
  }
  all[key] = { t: Math.floor(t), d: Math.floor(d), at: now };
  const keys = Object.keys(all);
  if (keys.length > MAX_PLACES) keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - MAX_PLACES).forEach((k) => { delete all[k]; });
  return write('resume', all);
}

export const LIMITS = Object.freeze({ MAX_PLACES, MIN_LENGTH, MIN_PLACE, END_MARGIN });
