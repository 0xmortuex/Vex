// Sizes and dates in the page's language, and the order of a folder. Pure functions: nothing here touches the page.

import { getLang } from './strings.js';

const numberFormats = new Map();
function numberFormat(digits) {
  const key = getLang() + digits;
  let f = numberFormats.get(key);
  if (!f) { f = new Intl.NumberFormat(getLang() === 'tr' ? 'tr-TR' : 'en-US', { maximumFractionDigits: digits }); numberFormats.set(key, f); }
  return f;
}
export function formatNumber(n) { return numberFormat(0).format(n); }

// 0 B, 12 KB, 1.4 MB. A file under 1 KB is shown in bytes; below 10 of a unit there is one decimal.
export function formatSize(bytes) {
  if (!(bytes >= 0)) return '';
  if (bytes < 1024) return formatNumber(bytes) + ' B';
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes / 1024, i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return numberFormat(value < 10 && i > 0 ? 1 : 0).format(value) + ' ' + units[i];
}

let dateFormat = null, dateLang = '';
export function formatDate(ms) {
  if (!ms) return '';
  if (!dateFormat || dateLang !== getLang()) {
    dateLang = getLang();
    dateFormat = new Intl.DateTimeFormat(dateLang === 'tr' ? 'tr-TR' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' });
  }
  return dateFormat.format(new Date(ms));
}
let longFormat = null, longLang = '';
export function formatDateLong(ms) {
  if (!ms) return '';
  if (!longFormat || longLang !== getLang()) {
    longLang = getLang();
    longFormat = new Intl.DateTimeFormat(longLang === 'tr' ? 'tr-TR' : 'en-GB', { dateStyle: 'long', timeStyle: 'medium' });
  }
  return longFormat.format(new Date(ms));
}

// The text the filter and the type-ahead compare: lower case by the page's language, so Turkish İ and I keep their own small letters.
export function fold(text) { return String(text).toLocaleLowerCase(getLang() === 'tr' ? 'tr-TR' : 'en-US'); }

let collator = null, collatorLang = '';
export function nameCollator() {
  if (!collator || collatorLang !== getLang()) {
    collatorLang = getLang();
    collator = new Intl.Collator(collatorLang === 'tr' ? 'tr-TR' : 'en-US', { numeric: true, sensitivity: 'base' });
  }
  return collator;
}

// Splits `indexes` (folders and files of one folder) into folders first, then files, each ordered by `compare(a, b)`; `flip` reverses
// the order inside each group (folders stay first). Returns a new Int32Array.
export function orderEntries(indexes, isDir, compareDirs, compareFiles, flip) {
  const dirs = [], files = [];
  for (let k = 0; k < indexes.length; k++) (isDir(indexes[k]) ? dirs : files).push(indexes[k]);
  dirs.sort(compareDirs);
  files.sort(compareFiles);
  if (flip) { dirs.reverse(); files.reverse(); }
  const out = new Int32Array(dirs.length + files.length);
  out.set(dirs, 0);
  out.set(files, dirs.length);
  return out;
}

// A file name with its extension kept apart, for selecting only the name when renaming.
export function splitName(name) {
  const i = name.lastIndexOf('.');
  return i > 0 && i < name.length - 1 ? [name.slice(0, i), name.slice(i)] : [name, ''];
}

// What the person typed in the path bar -> a file: address of a folder, or null.
export function typedToFileUrl(text) {
  let t = String(text || '').trim().replace(/^"(.*)"$/, '$1').trim();
  if (!t) return null;
  const enc = (segs) => segs.filter(Boolean).map((s) => encodeURIComponent(s).replace(/%3A/gi, ':')).join('/');
  if (/^file:/i.test(t)) {
    try { const u = new URL(t); const out = u.href; return out.endsWith('/') ? out : out + '/'; } catch { return null; }
  }
  if (/^[A-Za-z]:$/.test(t)) t += '\\';
  if (/^[A-Za-z]:[\\/]/.test(t)) {
    const parts = t.replace(/\//g, '\\').split('\\');
    const drive = parts.shift().toUpperCase();
    return 'file:///' + drive + '/' + enc(parts) + (enc(parts) ? '/' : '');
  }
  if (/^\\\\[^\\]+/.test(t)) {
    const parts = t.slice(2).replace(/\//g, '\\').split('\\');
    const host = parts.shift();
    return 'file://' + host + '/' + enc(parts) + (enc(parts) ? '/' : '');
  }
  return null;
}

// The pieces of a folder's path for the breadcrumb: [{ label, url }], starting at This PC.
export function crumbsOf(fileUrl, thisPcLabel) {
  const out = [{ label: thisPcLabel, url: 'file:///', pc: true }];
  let u;
  try { u = new URL(fileUrl); } catch { return out; }
  const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
  const segs = u.pathname.split('/').filter(Boolean).map(decode);
  if (u.hostname) {
    let acc = 'file://' + u.hostname + '/';
    out.push({ label: '\\\\' + decode(u.hostname), url: acc });
    for (const s of segs) { acc += encodeURIComponent(s) + '/'; out.push({ label: s, url: acc }); }
    return out;
  }
  let acc = 'file:///';
  segs.forEach((s) => { acc += (acc.endsWith('/') ? '' : '/') + encodeURIComponent(s).replace(/%3A/gi, ':') + '/'; out.push({ label: s, url: acc }); });
  return out;
}
