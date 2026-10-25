// Small helpers the player's modules share. Nothing here touches the network or the page's state.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 83 -> "1:23", 3725 -> "1:02:05". Not a number, or negative, is 0:00.
export function fmtTime(seconds) {
  let s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? h + ':' + two(m) + ':' + two(s) : m + ':' + two(s);
}

// The start time in a media fragment: #t=90, #t=1:30, #t=90,120, #t=1h2m3s. -> seconds or null
export function parseStart(hash) {
  const m = /(?:^|[#&])t=([^&,]+)/.exec(String(hash || ''));
  if (!m) return null;
  const v = m[1];
  if (/^\d+(?:\.\d+)?$/.test(v)) return Number(v);
  const parts = v.split(':');
  if (parts.length >= 2 && parts.length <= 3 && parts.every((p) => /^\d+(?:\.\d+)?$/.test(p))) return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
  const hms = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(v);
  if (hms && (hms[1] || hms[2] || hms[3])) return Number(hms[1] || 0) * 3600 + Number(hms[2] || 0) * 60 + Number(hms[3] || 0);
  return null;
}

export const AUDIO_EXT = ['.mp3', '.m4a', '.aac', '.flac', '.ogg', '.oga', '.opus', '.wav', '.weba'];
export const VIDEO_EXT = ['.mp4', '.m4v', '.webm', '.mkv', '.mov', '.ogv'];

export function extOf(address) {
  let path = String(address || '');
  try { path = new URL(path).pathname; } catch { /* vex-allow-empty-catch: a bare name */ }
  const m = /(\.[A-Za-z0-9]{1,5})$/.exec(path);
  return m ? m[1].toLowerCase() : '';
}

// The file name an address ends in, decoded; no extension unless asked.
export function nameOf(address, keepExt) {
  let path = String(address || '');
  try { path = new URL(path).pathname; } catch { /* vex-allow-empty-catch: a bare name */ }
  let last = path.split('/').filter(Boolean).pop() || '';
  try { last = decodeURIComponent(last); } catch { /* vex-allow-empty-catch: keep it as it is */ }
  return keepExt ? last : last.replace(/\.[A-Za-z0-9]{1,5}$/, '');
}

export function guessKind(address) {
  const e = extOf(address);
  if (AUDIO_EXT.includes(e)) return 'audio';
  return 'video';
}

// The window's address for the media's own address: the page lives at vex-media://view/?u=...
export function viewerHref(original) {
  const o = String(original || '');
  const at = o.indexOf('#');
  return '/?u=' + encodeURIComponent(at < 0 ? o : o.slice(0, at)) + (at < 0 ? '' : o.slice(at));
}
export function docHref(original) { return '/doc?u=' + encodeURIComponent(String(original || '').replace(/#.*$/, '')); }

// element builder: h('button', { class: 'x', onclick() {} }, child, 'text')
export function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) if (child != null && child !== false) node.append(child);
  return node;
}

export function iconHtml(name, size) {
  if (typeof VexIcons === 'undefined') throw new Error('The icon set (/icons.js) did not load');
  return VexIcons.svg(name, { size: size || 18 });
}
export function paintIcons(root) {
  for (const node of (root || document).querySelectorAll('[data-icon]')) node.innerHTML = iconHtml(node.dataset.icon, Number(node.dataset.iconSize) || 18);
}

// A subtitle file's bytes -> text. UTF-8 when it is valid; else Windows-1254 (the Turkish code page most old .srt files are in).
export function decodeText(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view[0] === 0xFF && view[1] === 0xFE) return new TextDecoder('utf-16le').decode(view.subarray(2));
  if (view[0] === 0xFE && view[1] === 0xFF) return new TextDecoder('utf-16be').decode(view.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(view); }
  catch { return new TextDecoder('windows-1254').decode(view); }
}
