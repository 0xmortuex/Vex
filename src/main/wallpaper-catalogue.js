// === The wallpaper catalogue: what a hosted list of free photos must look like ==
//
// The Wallpaper Store can read a list of free-to-use photos from an address the
// person (or the owner, on his own hosting) sets in Settings > Wallpapers. This
// file is the one place that says what such a list is. Nothing in it is trusted:
// every entry is checked here, in the main process, before the window sees it,
// and an entry that fails is dropped with a reason (never half used).
//
//   {
//     "schema": 1,
//     "name": "My wallpapers",              // shown in the store, optional
//     "updated": "2026-10-31",              // optional, YYYY-MM-DD
//     "entries": [{
//       "id": "mist-valley",                // a-z 0-9 and dashes, 3 to 48, unique
//       "title": "Mist in the valley",
//       "author": "Jane Example",           // who made it (the credit)
//       "licence": "CC0-1.0",               // one of LICENCES below
//       "sourceUrl": "https://...",         // https page where the licence can be checked
//       "thumbUrl": "https://...",          // small preview, jpg/png/webp, 640 px wide is plenty
//       "fullUrl": "https://...",           // the picture itself, at most 12 MB
//       "tags": ["mist", "green"],          // optional, up to 12
//       "category": "nature",               // a-z and dashes
//       "dominant": "#4a6b5c",              // the picture's main colour, #rrggbb
//       "width": 3840, "height": 2160       // optional
//     }]
//   }
//
// Only licences that let anyone use a picture without asking are accepted:
// Vex does not accept a picture whose licence it cannot name.

const LICENCES = Object.freeze({
  'CC0-1.0': 'Creative Commons Zero (public domain dedication)',
  'PDM-1.0': 'Public Domain Mark',
  'Pexels': 'Pexels License (free to use, no attribution required)',
  'Unsplash': 'Unsplash License (free to use)',
  'Own': 'Made by the owner of this list',
});
const MAX_ENTRIES = 2000;
const ID_RE = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
const CATEGORY_RE = /^[a-z][a-z-]{0,29}$/;

function httpsUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  let u;
  try { u = new URL(value); } catch { return false; }
  // https only, no credentials in the address.
  return u.protocol === 'https:' && !u.username && !u.password && !!u.hostname;
}

// One entry -> { entry } or { problem }. Strings are trimmed and length-limited; unknown fields are not kept.
function checkEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { problem: 'is not an object' };
  const text = (key, max) => (typeof raw[key] === 'string' && raw[key].trim() && raw[key].trim().length <= max ? raw[key].trim() : null);
  const id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : null;
  if (!id) return { problem: 'needs an "id" of 3 to 48 letters (a-z), digits and dashes' };
  const fail = (why) => ({ problem: why, id });
  const title = text('title', 80);
  if (!title) return fail('needs a "title" (up to 80 characters)');
  const author = text('author', 80);
  if (!author) return fail('needs an "author"');
  if (typeof raw.licence !== 'string' || !Object.prototype.hasOwnProperty.call(LICENCES, raw.licence)) return fail('"licence" must be one of ' + Object.keys(LICENCES).join(', '));
  for (const key of ['sourceUrl', 'thumbUrl', 'fullUrl']) if (!httpsUrl(raw[key])) return fail('"' + key + '" must be an https address');
  if (typeof raw.category !== 'string' || !CATEGORY_RE.test(raw.category)) return fail('"category" must be lowercase letters and dashes');
  if (typeof raw.dominant !== 'string' || !/^#[0-9a-f]{6}$/i.test(raw.dominant)) return fail('"dominant" must be a colour like #4a6b5c');
  let tags = [];
  if (raw.tags != null) {
    if (!Array.isArray(raw.tags) || raw.tags.length > 12 || raw.tags.some(t => typeof t !== 'string' || !t.trim() || t.length > 30)) return fail('"tags" must be up to 12 short words');
    tags = raw.tags.map(t => t.trim().toLowerCase());
  }
  const size = (key) => {
    if (raw[key] == null) return undefined;
    return Number.isInteger(raw[key]) && raw[key] >= 16 && raw[key] <= 20000 ? raw[key] : null;
  };
  const width = size('width'), height = size('height');
  if (width === null || height === null) return fail('"width" and "height" must be whole numbers from 16 to 20000');
  const entry = {
    id, title, author, licence: raw.licence, sourceUrl: raw.sourceUrl, thumbUrl: raw.thumbUrl, fullUrl: raw.fullUrl,
    tags, category: raw.category, dominant: raw.dominant.toLowerCase(),
  };
  if (width !== undefined) entry.width = width;
  if (height !== undefined) entry.height = height;
  return { entry };
}

// A parsed document -> { name, updated, entries, problems: ['entry "x" ...'] }. Throws when the document as a whole is wrong.
function validateCatalogue(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('The wallpaper list is not a JSON object');
  if (doc.schema !== 1) throw new Error('The wallpaper list has "schema": ' + JSON.stringify(doc.schema) + ' but this Vex reads schema 1');
  if (!Array.isArray(doc.entries)) throw new Error('The wallpaper list has no "entries" list');
  if (doc.entries.length > MAX_ENTRIES) throw new Error('The wallpaper list has ' + doc.entries.length + ' entries; ' + MAX_ENTRIES + ' at most');
  const problems = [], entries = [], seen = new Set();
  doc.entries.forEach((raw, i) => {
    const r = checkEntry(raw);
    const label = r.id ? 'entry "' + r.id + '"' : 'entry number ' + (i + 1);
    if (r.problem) { problems.push(label + ' ' + r.problem); return; }
    if (seen.has(r.entry.id)) { problems.push(label + ' repeats an id'); return; }
    seen.add(r.entry.id);
    entries.push(r.entry);
  });
  const name = typeof doc.name === 'string' ? doc.name.trim().slice(0, 80) : '';
  const updated = typeof doc.updated === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(doc.updated) ? doc.updated : '';
  return { name, updated, entries, problems };
}

module.exports = { validateCatalogue, checkEntry, httpsUrl, LICENCES, MAX_ENTRIES };
