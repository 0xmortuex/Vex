// === Where a download lands, and what it is called =========================
//
// Everything arrives in one Downloads folder under whatever name the server
// chose ("invoice_final_2.pdf", "download.zip"), and sorting it out later is
// a job nobody does. A rule says: PDFs from this site go in Invoices, and are
// named with the date and the site.
//
// A rule is { id, ext, site, folder, rename }:
//   ext     "pdf" or "pdf, zip" — the file's kind, without the dot
//   site    a host, matched on the end ("github.com" also matches a subdomain)
//   folder  where it goes, under the Downloads folder — "Invoices/2026"
//   rename  a pattern: {date} {site} {name} {ext}
// Both ext and site must match when both are given. The first rule that
// matches wins, so the specific ones go first.
const path = require('path');

const clean = (s) => String(s || '').trim();
// A folder or file name a person typed is still user input: no climbing out
// of the Downloads folder, no drive letters, no reserved Windows names.
function safeSegment(name) {
  // A slash in a NAME is not a folder, it is an attempt at one.
  return clean(name).replace(/[\\/<>:"|?*\u0000-\u001f]/g, '').replace(/^\.+/, '').replace(/[. ]+$/, '')
    // Windows reserves these whatever the extension: CON and CON.txt alike.
    .replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?=$|\.)/i, '_$1');
}
function safeFolder(folder) {
  return clean(folder).split(/[\\/]+/).map(safeSegment).filter(p => p && p !== '..').slice(0, 4).join(path.sep);
}

function hostOf(url) {
  try { return new URL(String(url)).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

function matches(rule, { filename, url }) {
  const ext = path.extname(String(filename || '')).replace(/^\./, '').toLowerCase();
  const host = hostOf(url);
  const wantExt = clean(rule.ext).toLowerCase().split(/[,\s]+/).filter(Boolean);
  const wantSite = clean(rule.site).toLowerCase().replace(/^www\./, '');
  if (wantExt.length && !wantExt.includes(ext)) return false;
  if (wantSite && !(host === wantSite || host.endsWith('.' + wantSite))) return false;
  return !!(wantExt.length || wantSite);          // a rule matching everything is not a rule
}

// The name after a rule's pattern, if it has one.
function rename(pattern, { filename, url, date = new Date() }) {
  const p = clean(pattern);
  const base = path.basename(String(filename || ''), path.extname(String(filename || '')));
  const ext = path.extname(String(filename || '')).replace(/^\./, '');
  if (!p) return clean(filename);
  const stamp = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  const named = p
    .replace(/\{date\}/gi, stamp)
    .replace(/\{site\}/gi, hostOf(url) || 'web')
    .replace(/\{name\}/gi, base)
    .replace(/\{ext\}/gi, ext);
  const out = safeSegment(named.endsWith('.' + ext) || !ext ? named : named + '.' + ext);
  return out || clean(filename);
}

// → { folder, filename }: where this download goes, relative to the Downloads
// folder, and what to call it. No rule matching means no change.
function place(rules, { filename, url, date }) {
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (!matches(rule, { filename, url })) continue;
    return { folder: safeFolder(rule.folder), filename: rename(rule.rename, { filename, url, date }), rule: rule.id || null };
  }
  return { folder: '', filename: clean(filename), rule: null };
}

module.exports = { place, matches, rename, safeFolder, safeSegment, hostOf };
