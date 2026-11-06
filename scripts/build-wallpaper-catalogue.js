#!/usr/bin/env node
// === Build the hosted wallpaper catalogue (src/main/data/wallpaper-catalogue.json) ==
//
// Vex does NOT bundle wallpaper pictures. It ships a CATALOGUE (a JSON list, schema 1,
// see src/main/wallpaper-catalogue.js) and downloads one picture from its public host
// only when a person picks it. This script builds that list from public APIs, keeps only
// pictures whose licence lets anyone use them, checks every address, and writes:
//
//   src/main/data/wallpaper-catalogue.json             the list (schema 1)
//   src/main/data/wallpaper-catalogue-categories.json  [{ id, title, blurb }] for the store
//   src/main/data/wallpaper-catalogue-hosts.json       the only hosts Vex may download from
//
// Refresh:  node scripts/build-wallpaper-catalogue.js
//   --sources met,cma,nasa,wiki       only these sources (default: all four; a partial run writes only
//                                      what it found, so use it to test). "aic" exists but is off: see below.
//   --quick                            first two queries of each source (pipeline test)
//   --refresh                          ignore the API/verification cache (slow, polite)
// Responses are cached in scripts/.wallpaper-catalogue-cache/ (gitignored), so a re-run is cheap
// and the ids stay stable (they come from the source's own object id).
//
// SOURCES AND TERMS (checked 2026-11-06; the same text is in src/main/data/README-wallpaper-catalogue.md)
//
//  met   The Metropolitan Museum of Art Open Access. API: https://collectionapi.metmuseum.org/public/collection/v1.1/search
//        (isPublicDomain=true&hasImages=true, paginated by offset/limit) + /public/collection/v1/objects/{id}.
//        Terms: Open Access images and data are CC0 (https://www.metmuseum.org/policies/open-access).
//        Only objects the API marks isPublicDomain are used. No key. Pictures: images.metmuseum.org.
//        The Met serves no size parameter: fullUrl is the original, kept only if it is <= 12 MB and >= 2560 px wide.
//  aic   Art Institute of Chicago API. API: https://api.artic.edu/api/v1/artworks/search with
//        query[term][is_public_domain]=true. Terms: public-domain works' images are CC0 and the API data is
//        CC0 (https://www.artic.edu/open-access/open-access-images, API response "license_text").
//        Pictures through the museum's IIIF server https://www.artic.edu/iiif/2/{image_id}/full/{w},/0/default.jpg,
//        w = 3840 (or the original width if smaller). No key.
//  cma   Cleveland Museum of Art Open Access API. API: https://openaccess-api.clevelandart.org/api/artworks/
//        with cc0=1&has_image=1. Terms: CC0 for works flagged share_license_status "CC0"
//        (https://www.clevelandart.org/open-access). No key. Pictures: openaccess-cdn.clevelandart.org ("print" size).
//  nasa  NASA Image and Video Library. API: https://images-api.nasa.gov/search?media_type=image.
//        Terms: NASA media usage guidelines (https://www.nasa.gov/nasa-brand-center/images-and-media/):
//        NASA content is generally not subject to copyright in the United States and may be used freely; the
//        exceptions are pictures that carry a third-party copyright. We keep only items whose credit names
//        NASA and whose text does not mention a copyright or (c) sign. Licence field: PDM-1.0, credit "NASA".
//        Pictures: images-assets.nasa.gov (~orig.jpg, ~small.jpg). No key.
//  wiki  Wikimedia Commons. API: https://commons.wikimedia.org/w/api.php (generator=search, namespace 6,
//        haswbstatement:P6216=Q19652 (copyright status: public domain) or deepcategory Carol M. Highsmith) +
//        prop=imageinfo with extmetadata. Terms: each file has its own licence; we keep a file ONLY when
//        extmetadata LicenseShortName is "Public domain", "CC0", "PD-USGov*", "PD-old*", "PD-art*" or "PD-US*"
//        (see LICENCE_OK). CC-BY, CC-BY-SA, GFDL, "Attribution" etc. are rejected. Pictures: thumbnails at 3840 px
//        from upload.wikimedia.org / thumb.wikimedia.org (a standard thumbnail step).
//  Not used: Smithsonian Open Access (api.data.gov needs an API key), Rijksmuseum (its new API is
//        Linked Art with no simple image-size filter; not worth the risk of a wrong licence).
//
// Every kept entry was fetched: thumb (image/*, decodes) and full (status 200/206, image/*, <= 12 MB,
// real pixel size read from the file header). Dead links are dropped. Look-alike pictures (same artwork
// from two sources or two object ids) are dropped by a small perceptual hash.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UA = 'VexWallpaperCatalogue/1.0 (https://github.com/0xmortuex/Vex)';
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'src', 'main', 'data');
const CACHE_DIR = path.join(__dirname, '.wallpaper-catalogue-cache');
const MAX_BYTES = 12 * 1024 * 1024;
const MIN_WIDTH = 2560;
const MAX_ASPECT = 3.0;

// The only hosts Vex may download pictures from (thumbUrl and fullUrl). sourceUrl pages are SOURCE_HOSTS.
const ALLOWED_HOSTS = Object.freeze([
  'images.metmuseum.org',
  'www.artic.edu',
  'openaccess-cdn.clevelandart.org',
  'images-assets.nasa.gov',
  'upload.wikimedia.org',
  'thumb.wikimedia.org',
]);
const SOURCE_HOSTS = Object.freeze([
  'www.metmuseum.org',
  'www.artic.edu',
  'clevelandart.org',
  'images.nasa.gov',
  'commons.wikimedia.org',
]);

const CATEGORY_TITLES = Object.freeze([
  { id: 'art-landscapes', title: 'Painted landscapes', blurb: 'Museum paintings of valleys, rivers, forests and fields, from old masters to the Hudson River School.' },
  { id: 'art-seascapes', title: 'Seascapes', blurb: 'Ships, harbours, waves and coasts, painted and printed.' },
  { id: 'art-japan', title: 'Japanese art', blurb: 'Woodblock prints, folding screens and ink landscapes from Japan.' },
  { id: 'art-patterns', title: 'Patterns and designs', blurb: 'Real textiles, carpets, tiles, wallpaper and ornament designs.' },
  { id: 'art-classic', title: 'Classic art', blurb: 'Cityscapes, skies and other wide museum pictures.' },
  { id: 'space', title: 'Space', blurb: 'Nebulae, galaxies, planets and Earth seen from orbit, from NASA telescopes and probes.' },
  { id: 'nature', title: 'Nature', blurb: 'Forests, lakes, rivers, deserts and weather in public-domain photographs.' },
  { id: 'mountains', title: 'Mountains', blurb: 'Peaks, canyons, glaciers and volcanoes.' },
  { id: 'sea-and-sky', title: 'Sea and sky', blurb: 'Sunsets, clouds, beaches and open water.' },
  { id: 'cities', title: 'Cities', blurb: 'Skylines, bridges and streets.' },
  { id: 'architecture', title: 'Architecture', blurb: 'Cathedrals, castles, temples and monuments.' },
]);

// Reject text-heavy, violent or nude subjects by title/tags (a heuristic: see the README for what it cannot catch).
const BAD_SUBJECT = /\b(nude|naked|bather|bathers|bathing|venus|nymphs?|odalisque|shunga|erotic|susanna|lucretia|leda|rape|abduction|battle|massacre|execution|martyr|martyrdom|crucifixion|crucified|slaughter|killing|beheading|hanging|corpse|dead|death of|siege|skirmish|bloody|decapitat|flaying|torture|sacrifice|slave|warriors?|soldiers?|shipwreck|drown|lynch|skull|skeleton|hell|inferno|last judgment|wounded)\b/i;
const BAD_TEXTY = /\b(manuscript|folio|leaf from|page from|pages?|letter|poem|calligraphy|inscription|certificate|document|label|plaque|poster|handbill|sheet music|book|bookplate|title page|frontispiece|map of|chart|diagram|logo|sign|ticket|invoice|newspaper|menu|catalog(ue)?|specimen|portrait|self-portrait|bust|astronaut|crew|ceremony|briefing|press conference|team)\b/i;

// Museum objects that are not pictures of a place or a design (coins, vessels, jewellery, figure studies...).
const BAD_OBJECT = /\b(coin|coins|medal|medallion|ornament|dish|dishes|bowl|bowls|vase|cup|jar|vessel|plate|figure|figurine|statuette|jewel\w*|pendant|ring|earring|nose|helmet|armor|armour|sword|dagger|knife|portrait|woman|women|man|men|girl|boy|lady|child|children|angel|saint|virgin|madonna|christ|jesus|apostle|study|studies|recto|verso|sketch|head|hands?|nursing|mother|family|dancer|musician|actor|kneeling|seated|standing|reclining|horse|horses|cow|cattle|dog|cat|bird|birds|fan|mask|box|casket|tankard|ewer|teapot|stirrup|bit|saddle|club|tunic|tent|grate|chimneypiece|door|textile with figures)\b/i;
const SCENIC = /\b(landscapes?|views?|rivers?|mountains?|mount|valley|forest|woods?|lakes?|sea|seas|coast\w*|harbou?rs?|sunsets?|sunrise|moonlight|moon|snow|winter|autumn|summer|spring|fields?|garden|falls|waterfall|village|town|city|cities|road|bridge|islands?|beach|shore|storm|sky|clouds?|fuji|alps|hills?|plains?|meadow|pastoral|marine|ships?|boats?|canal|venice|rome|paris|panorama|skyline|vista|lagoon|bay|cliffs?|rocks?|trees?|pines?|bamboo|cherry|rain|mist|fog|evening|morning|night|dawn|dusk|tokaido|stations?|kyoto|edo|scenes?|famous places|eight views|thirty-six|one hundred)\b/i;
const PATTERNY = /\b(textiles?|carpets?|rugs?|tiles?|wallpapers?|tapestr\w+|brocad\w+|damask|embroider\w+|silks?|velvet|designs?|patterns?|kimono|quilt|coverlet|shawl|fragment|panel|hanging|screen|lattice|arabesque|floral|border|cloth|printed|woven|iznik|kilim|medallion carpet)\b/i;
const BAD_WIKI = /\b(army|navy|air force|marines?|military|uss|usaf|soldiers?|troops|governor|press office|auctions?|heritage auctions|dollar|double eagle|exercise|deployment|ceremony|congress|senator|president|campaign|festival|visitors?|firefighters?|fire|wildfire|coast guard|police|rangers?|volunteers?|staff|employees|personnel|workshop|students|youth|kids|fish|trout|salmon|weekend|workers?|crew|meets?|tour|personnel|epa|usepa|inspection|response|survey|sampling|researchers?|scientists?|biologists?|officials?|event|dedication|memorial|parade|conference|training|boat ramp|stocking|hatchery)\b/i;
const BAD_NASA = /\b(maps?|telescopes?|spacecraft|instruments?|lineage|timeline|part \d|what happened|how |mapping|comparison|heading down|mission|rover|rovers)\b/i;
// main = title and object type (checked against the deny list); extra = tags/subjects (only help to match).
function relevant(cat, main, extra = '') {
  const all = main + ' ' + extra;
  if (cat === 'art-patterns') return PATTERNY.test(all) && !/\b(dish|dishes|bowl|bowls|vase|cup|vessel|box|fan|mask|coin|medal|nose|portrait)\b/i.test(main);
  if (cat.startsWith('art-')) return SCENIC.test(all) && !BAD_OBJECT.test(main);
  return true;
}

const LICENCE_OK = /^(public domain|cc0.*|pd-usgov.*|pd-old.*|pd-art.*|pd-us.*|pd-nasa.*|pd-ineligible.*)$/i;

// ---------- small helpers -------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const FLAG = (n) => args.includes('--' + n);
const OPT = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };

async function pmap(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) { const k = i++; if (k >= items.length) return; out[k] = await fn(items[k], k); }
  }));
  return out;
}

const HOST_GAP = { 'api.artic.edu': 1100, 'collectionapi.metmuseum.org': 450, 'images.metmuseum.org': 60, 'www.artic.edu': 250,
  'images-api.nasa.gov': 250, 'images-assets.nasa.gov': 120, 'commons.wikimedia.org': 400, 'upload.wikimedia.org': 350,
  'thumb.wikimedia.org': 350, 'openaccess-api.clevelandart.org': 250, 'openaccess-cdn.clevelandart.org': 150 };
const nextSlot = new Map();
async function throttle(host) {
  const gap = HOST_GAP[host] || 200;
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(host) || 0);
  nextSlot.set(host, at + gap);
  if (at > now) await sleep(at - now);
}

async function readBody(res, maxBytes) {
  const chunks = [];
  let total = 0, truncated = false;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    total += value.length;
    if (total >= maxBytes) { truncated = true; await reader.cancel(); break; }
  }
  return { body: Buffer.concat(chunks), truncated, read: total };
}

// One polite request with retries on 429/5xx/network errors. Never throws: returns { status:0, error } when it gave up.
async function request(url, { headers = {}, maxBytes = 8 * 1024 * 1024, tries = 5 } = {}) {
  const host = new URL(url).hostname;
  let lastErr = 'no attempt';
  for (let attempt = 0; attempt < tries; attempt++) {
    await throttle(host);
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, redirect: 'follow', signal: AbortSignal.timeout(120000) });
    } catch (e) { lastErr = String(e && e.cause && e.cause.code || e.message); await sleep(1500 * (attempt + 1)); continue; }
    // The Met answers a too-fast burst on its API with HTTP 403 for a minute or so: wait it out, do not give up.
    const metBurst = res.status === 403 && host === 'collectionapi.metmuseum.org';
    if (res.status === 429 || res.status >= 500 || metBurst) {
      lastErr = 'HTTP ' + res.status;
      const ra = Number(res.headers.get('retry-after'));
      try { await res.body.cancel(); } catch (e) { /* vex-allow-empty-catch: body already closed */ }
      await sleep(metBurst ? 30000 * (attempt + 1) : ra > 0 ? Math.min(ra, 60) * 1000 : 2000 * 2 ** attempt);
      continue;
    }
    try {
      const b = await readBody(res, maxBytes);
      return { status: res.status, headers: res.headers, url: res.url, ...b };
    } catch (e) { lastErr = 'body: ' + e.message; await sleep(1500 * (attempt + 1)); }
  }
  return { status: 0, error: lastErr };
}

// ---------- cache -----------------------------------------------------------------------

const REFRESH = FLAG('refresh');
function cacheFile(kind, key) { return path.join(CACHE_DIR, kind, crypto.createHash('sha1').update(key).digest('hex') + '.json'); }

async function getJson(url, kind = 'api') {
  const file = cacheFile(kind, url);
  if (!REFRESH && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const r = await request(url, { headers: { Accept: 'application/json' }, maxBytes: 64 * 1024 * 1024 });
  if (r.status !== 200) {
    // A missing object is normal for the Met (404); anything else must be loud.
    if (r.status === 404) return null;
    throw new Error('API request failed: ' + url + ' -> ' + (r.status || r.error));
  }
  const json = JSON.parse(r.body.toString('utf8'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(json));
  return json;
}

// ---------- text helpers ---------------------------------------------------------------

function slug(s) {
  return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function makeId(src, title, nid) {
  const tail = String(nid).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const room = 48 - src.length - 1 - tail.length - 1;
  const head = room > 2 ? slug(title).slice(0, room).replace(/-+$/g, '') : '';
  const id = [src, head, tail].filter(Boolean).join('-');
  return id.slice(0, 48).replace(/-+$/g, '');
}
function clip(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[ ,;:\-]+$/, '') + '…';
}
function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}
function cleanTags(list, extra = []) {
  const seen = new Set();
  const out = [];
  for (const t of [...extra, ...list]) {
    const w = String(t || '').toLowerCase().replace(/[^a-z0-9 \-]/g, '').replace(/\s+/g, ' ').trim();
    if (w.length < 2 || w.length > 24 || seen.has(w)) continue;
    seen.add(w); out.push(w);
    if (out.length >= 6) break;
  }
  return out;
}
function normKey(s) { return slug(s).replace(/-/g, ''); }

// ---------- candidate sources -------------------------------------------------------------
// A candidate: { src, nid, title, author, licence, sourceUrl, thumbUrl, fullUrl, tags, category, minAspect, width?, height? }

const QUICK = FLAG('quick');

// ---- Met
const MET_QUERIES = [
  // [q, departmentId|null, category, max ids]
  ['landscape', 11, 'art-landscapes', 500], ['landscape', 1, 'art-landscapes', 400], ['landscape', 21, 'art-landscapes', 300],
  ['mountains', 11, 'art-landscapes', 300], ['river valley', null, 'art-landscapes', 400], ['forest', 11, 'art-landscapes', 300],
  ['lake', null, 'art-landscapes', 300], ['snow winter', 11, 'art-landscapes', 300], ['autumn', 11, 'art-landscapes', 200],
  ['sunset', 11, 'art-landscapes', 300], ['moonlight', null, 'art-landscapes', 300], ['waterfall', null, 'art-landscapes', 200],
  ['Hudson River School', 1, 'art-landscapes', 300], ['Barbizon', null, 'art-landscapes', 300], ['Alps', null, 'art-landscapes', 300],
  ['Italian landscape', 11, 'art-landscapes', 300], ['pastoral', 11, 'art-landscapes', 200], ['fields wheat', null, 'art-landscapes', 300],
  ['seascape', null, 'art-seascapes', 500], ['harbor', null, 'art-seascapes', 400], ['ships at sea', null, 'art-seascapes', 300],
  ['coast', null, 'art-seascapes', 400], ['beach', null, 'art-seascapes', 300], ['waves', null, 'art-seascapes', 300], ['lighthouse', null, 'art-seascapes', 100],
  ['folding screen', 6, 'art-japan', 500], ['byobu', 6, 'art-japan', 200], ['landscape', 6, 'art-japan', 600], ['Hiroshige', 6, 'art-japan', 400],
  ['Hokusai', 6, 'art-japan', 300], ['woodblock print landscape', 6, 'art-japan', 500], ['Utagawa', 6, 'art-japan', 400], ['Mount Fuji', null, 'art-japan', 300],
  ['hanging scroll landscape', 6, 'art-japan', 300], ['Kyoto', 6, 'art-japan', 200], ['ink landscape', 6, 'art-japan', 300],
  ['wallpaper', null, 'art-patterns', 500], ['textile', null, 'art-patterns', 600], ['tile', 14, 'art-patterns', 400], ['carpet', 14, 'art-patterns', 400],
  ['rug', null, 'art-patterns', 300], ['brocade', null, 'art-patterns', 300], ['damask', null, 'art-patterns', 300], ['embroidery', null, 'art-patterns', 300],
  ['tapestry', null, 'art-patterns', 400], ['design for', null, 'art-patterns', 500], ['ornament', null, 'art-patterns', 400], ['Iznik', null, 'art-patterns', 200],
  ['silk', 6, 'art-patterns', 300], ['kimono', null, 'art-patterns', 300], ['block-printed', null, 'art-patterns', 200], ['Tiffany', null, 'art-patterns', 200],
  ['cityscape', 11, 'art-classic', 400], ['view of Venice', null, 'art-classic', 400], ['panorama', null, 'art-classic', 300], ['sky clouds', null, 'art-classic', 300],
  ['skyline', null, 'art-classic', 200], ['view of Rome', null, 'art-classic', 300], ['Paris', 11, 'art-classic', 300], ['village', 11, 'art-classic', 300],
];

// The Met's WAF answers a burst (about 15 requests a second) with HTTP 403; one request every 0.45 s
// is accepted (300 in a row tested). The number of objects read per query is the second lever (--met-scale 1 = all).
const MET_SCALE = Number(OPT('met-scale') || 0.5);

async function metCandidates() {
  const queries = QUICK ? MET_QUERIES.slice(0, 2) : MET_QUERIES;
  const idCat = new Map();
  for (const [q, dept, cat, fullMax] of queries) {
    const max = Math.round(fullMax * MET_SCALE);
    let offset = 0;
    while (offset < max) {
      const limit = Math.min(500, max - offset);
      const p = new URLSearchParams({ isPublicDomain: 'true', hasImages: 'true', q, limit: String(limit), offset: String(offset) });
      if (dept) p.set('departmentId', String(dept));
      const j = await getJson('https://collectionapi.metmuseum.org/public/collection/v1.1/search?' + p);
      const ids = (j && j.objectIDs) || [];
      for (const id of ids) if (!idCat.has(id)) idCat.set(id, cat);
      if (ids.length < limit) break;
      offset += limit;
    }
    console.log('met query', q, dept || '', '-> total ids', idCat.size);
  }
  const ids = [...idCat.keys()];
  console.log('met: fetching', ids.length, 'objects');
  let done = 0;
  const objs = await pmap(ids, 2, async (id) => {
    const o = await getJson('https://collectionapi.metmuseum.org/public/collection/v1/objects/' + id, 'met');
    if (++done % 500 === 0) console.log('  met objects', done, '/', ids.length);
    return o;
  });
  const out = [];
  for (const o of objs) {
    if (!o || !o.isPublicDomain || !o.primaryImage || !o.primaryImageSmall) continue;
    if (!o.primaryImage.startsWith('https://images.metmuseum.org/') || !o.primaryImageSmall.startsWith('https://images.metmuseum.org/')) continue;
    if (!/\.jpe?g$/i.test(o.primaryImage)) continue;
    if (deptIdOf(o.department) > 0) continue;
    const title = clip(o.title, 80);
    const tagTerms = (o.tags || []).map((t) => t.term);
    const text = [o.title, o.objectName, o.classification, ...tagTerms].join(' ');
    if (!title || BAD_SUBJECT.test(text) || BAD_TEXTY.test(o.title + ' ' + (o.objectName || ''))) continue;
    // The Met lists real sizes in cm: skip clearly upright works before downloading anything.
    const cat = idCat.get(o.objectID);
    if (!relevant(cat, o.title + ' ' + (o.objectName || ''), tagTerms.join(' '))) continue;
    const minAspect = cat === 'art-patterns' ? 1.3 : 1.45;
    const m = (o.measurements || []).find((x) => x.elementName === 'Overall' || x.elementName === 'Image') || (o.measurements || [])[0];
    if (m && m.elementMeasurements && m.elementMeasurements.Height > 0 && m.elementMeasurements.Width > 0) {
      const a = m.elementMeasurements.Width / m.elementMeasurements.Height;
      if (a < minAspect - 0.15 || a > MAX_ASPECT + 0.4) continue;
    }
    const artist = (o.artistDisplayName || '').split('|').map((s) => s.trim()).filter(Boolean).slice(0, 2).join(' and ');
    out.push({
      src: 'met', nid: o.objectID, title, author: clip(artist || 'Metropolitan Museum of Art', 80), licence: 'CC0-1.0',
      sourceUrl: o.objectURL || 'https://www.metmuseum.org/art/collection/search/' + o.objectID,
      thumbUrl: o.primaryImageSmall, fullUrl: o.primaryImage,
      tags: cleanTags(tagTerms, [o.culture, o.classification, o.objectName]), category: cat, minAspect,
    });
  }
  console.log('met candidates', out.length);
  return out;
}
const DEPT_IDS = { 'Arms and Armor': 4, 'The Costume Institute': 8, 'Musical Instruments': 18, 'Egyptian Art': 10, 'The Libraries': 16, 'Ancient West Asian Art': 3, 'Greek and Roman Art': 13 };
function deptIdOf(name) { return DEPT_IDS[name] || -1; }

// ---- Art Institute of Chicago
const AIC_QUERIES = [
  ['landscape', 'art-landscapes', 5], ['mountains', 'art-landscapes', 3], ['river', 'art-landscapes', 3], ['forest trees', 'art-landscapes', 3],
  ['lake', 'art-landscapes', 3], ['snow', 'art-landscapes', 3], ['sunset', 'art-landscapes', 3], ['fields', 'art-landscapes', 3],
  ['Impressionism landscape', 'art-landscapes', 4], ['Hudson River School', 'art-landscapes', 3], ['moonlight', 'art-landscapes', 2], ['valley', 'art-landscapes', 3],
  ['seascape', 'art-seascapes', 4], ['harbor', 'art-seascapes', 3], ['sea waves', 'art-seascapes', 3], ['beach coast', 'art-seascapes', 3], ['ships', 'art-seascapes', 3],
  ['Japanese woodblock landscape', 'art-japan', 5], ['Hiroshige', 'art-japan', 3], ['Hokusai', 'art-japan', 3], ['Japanese screen', 'art-japan', 3], ['Mount Fuji', 'art-japan', 2],
  ['textile', 'art-patterns', 4], ['wallpaper', 'art-patterns', 3], ['tile', 'art-patterns', 3], ['design ornament', 'art-patterns', 3], ['carpet rug', 'art-patterns', 2], ['coverlet quilt', 'art-patterns', 2],
  ['cityscape', 'art-classic', 4], ['view of Venice', 'art-classic', 3], ['panorama', 'art-classic', 3], ['sky clouds', 'art-classic', 3], ['Paris street', 'art-classic', 3], ['village', 'art-classic', 3],
];

async function aicCandidates() {
  const queries = QUICK ? AIC_QUERIES.slice(0, 2) : AIC_QUERIES;
  const fields = 'id,title,artist_title,image_id,thumbnail.width,thumbnail.height,classification_title,subject_titles,place_of_origin';
  const seen = new Map();
  for (const [q, cat, pages] of queries) {
    for (let page = 1; page <= pages; page++) {
      const u = 'https://api.artic.edu/api/v1/artworks/search?' + new URLSearchParams({
        q, 'query[term][is_public_domain]': 'true', limit: '100', page: String(page), fields,
      });
      const j = await getJson(u);
      for (const d of j.data || []) if (!seen.has(d.id)) seen.set(d.id, { d, cat });
      if (!j.data || j.data.length < 100) break;
    }
    console.log('aic query', q, '-> ids', seen.size);
  }
  const out = [];
  for (const { d, cat } of seen.values()) {
    if (!d.image_id || !d.thumbnail || !d.thumbnail.width || !d.thumbnail.height) continue;
    const w = d.thumbnail.width, h = d.thumbnail.height;
    const minAspect = cat === 'art-patterns' ? 1.3 : 1.45;
    if (w < MIN_WIDTH || w / h < minAspect || w / h > MAX_ASPECT) continue;
    const title = clip(d.title, 80);
    const text = [d.title, d.classification_title, ...(d.subject_titles || [])].join(' ');
    if (!title || BAD_SUBJECT.test(text) || BAD_TEXTY.test(d.title + ' ' + (d.classification_title || ''))) continue;
    if (!relevant(cat, d.title + ' ' + (d.classification_title || ''), (d.subject_titles || []).join(' '))) continue;
    const fw = Math.min(3840, w);
    out.push({
      src: 'aic', nid: d.id, title, author: clip(d.artist_title ? d.artist_title.split('\n')[0] : 'Art Institute of Chicago', 80), licence: 'CC0-1.0',
      sourceUrl: 'https://www.artic.edu/artworks/' + d.id,
      thumbUrl: 'https://www.artic.edu/iiif/2/' + d.image_id + '/full/640,/0/default.jpg',
      fullUrl: 'https://www.artic.edu/iiif/2/' + d.image_id + '/full/' + fw + ',/0/default.jpg',
      tags: cleanTags(d.subject_titles || [], [d.classification_title, d.place_of_origin]), category: cat, minAspect,
    });
  }
  console.log('aic candidates', out.length);
  return out;
}

// ---- Cleveland Museum of Art
const CMA_QUERIES = [
  ['landscape', 'art-landscapes'], ['mountains', 'art-landscapes'], ['river', 'art-landscapes'], ['sunset', 'art-landscapes'], ['winter snow', 'art-landscapes'], ['forest', 'art-landscapes'],
  ['seascape', 'art-seascapes'], ['harbor', 'art-seascapes'], ['ships', 'art-seascapes'], ['coast', 'art-seascapes'],
  ['Japanese landscape', 'art-japan'], ['Hiroshige', 'art-japan'], ['Hokusai', 'art-japan'], ['screen', 'art-japan'], ['Chinese landscape', 'art-japan'],
  ['textile', 'art-patterns'], ['carpet', 'art-patterns'], ['tile', 'art-patterns'], ['wallpaper', 'art-patterns'], ['design', 'art-patterns'],
  ['view of', 'art-classic'], ['cityscape', 'art-classic'], ['sky', 'art-classic'],
];

async function cmaCandidates() {
  const queries = QUICK ? CMA_QUERIES.slice(0, 2) : CMA_QUERIES;
  const seen = new Map();
  for (const [q, cat] of queries) {
    const u = 'https://openaccess-api.clevelandart.org/api/artworks/?' + new URLSearchParams({
      q, cc0: '1', has_image: '1', limit: '1000', fields: 'id,accession_number,title,images,creators,url,type,share_license_status,culture,technique',
    });
    const j = await getJson(u);
    for (const d of j.data || []) if (!seen.has(d.id)) seen.set(d.id, { d, cat });
    console.log('cma query', q, '-> ids', seen.size);
  }
  const out = [];
  for (const { d, cat } of seen.values()) {
    if (d.share_license_status !== 'CC0') continue;
    const im = d.images && d.images.print;
    if (!im || !im.url || !/\.jpe?g$/i.test(im.url) || !d.images.web || !d.images.web.url) continue;
    const w = Number(im.width), h = Number(im.height);
    const minAspect = cat === 'art-patterns' ? 1.3 : 1.45;
    if (!(w >= MIN_WIDTH) || w / h < minAspect || w / h > MAX_ASPECT || Number(im.filesize) > MAX_BYTES) continue;
    const title = clip(d.title, 80);
    if (!title || BAD_SUBJECT.test(d.title + ' ' + (d.type || '')) || BAD_TEXTY.test(d.title + ' ' + (d.type || ''))) continue;
    if (!relevant(cat, d.title + ' ' + (d.type || ''), (d.culture || []).join(' '))) continue;
    const creator = ((d.creators || [])[0] || {}).description || '';
    const author = creator.replace(/\s*\([^)]*\)\s*$/, '').trim() || 'Cleveland Museum of Art';
    out.push({
      src: 'cma', nid: d.id, title, author: clip(author, 80), licence: 'CC0-1.0',
      sourceUrl: d.url || 'https://clevelandart.org/art/' + d.accession_number,
      thumbUrl: d.images.web.url, fullUrl: im.url,
      tags: cleanTags([], [d.type, ...(d.culture || []), d.technique]), category: cat, minAspect,
    });
  }
  console.log('cma candidates', out.length);
  return out;
}

// ---- NASA Image and Video Library
const NASA_QUERIES = [
  ['nebula', 'space', 4], ['galaxy', 'space', 4], ['hubble deep field', 'space', 1], ['supernova remnant', 'space', 2], ['star cluster', 'space', 3],
  ['spiral galaxy', 'space', 3], ['pillars of creation', 'space', 1], ['james webb space telescope', 'space', 4], ['carina nebula', 'space', 1], ['chandra x-ray', 'space', 2],
  ['spitzer infrared', 'space', 2], ['jupiter', 'space', 2], ['saturn rings', 'space', 2], ['mars surface', 'space', 3], ['moon surface', 'space', 2], ['comet', 'space', 1],
  ['milky way', 'space', 2], ['solar flare sun', 'space', 3], ['europa titan enceladus', 'space', 1], ['exoplanet artist concept', 'space', 2], ['globular cluster', 'space', 2],
  ['planetary nebula', 'space', 2], ['star forming region', 'space', 2], ['pluto', 'space', 1], ['uranus neptune', 'space', 1], ['mercury venus', 'space', 1], ['eclipse', 'space', 1],
  ['earth from space', 'space', 4], ['earth at night city lights', 'space', 3], ['hurricane from space', 'space', 2], ['aurora from space station', 'space', 3],
  ['blue marble', 'space', 1], ['landsat', 'space', 3], ['international space station earth horizon', 'space', 3], ['earth limb sunrise', 'space', 2],
  ['hubble space telescope image', 'space', 4], ['webb telescope infrared image', 'space', 3], ['stellar nursery', 'space', 2], ['colliding galaxies', 'space', 2], ['mars panorama', 'space', 2],
  ['lunar landscape', 'space', 2], ['sun corona solar dynamics observatory', 'space', 2], ['asteroid', 'space', 1], ['galaxy cluster', 'space', 2], ['dwarf galaxy', 'space', 2],
  ['earth horizon sunrise orbit', 'space', 3], ['night lights earth', 'space', 2], ['river delta from space', 'space', 2], ['volcano from space', 'space', 2], ['clouds swirl satellite', 'space', 2],
  ['clouds from orbit', 'space', 2], ['desert from orbit', 'space', 2], ['island coral reef from space', 'space', 2], ['glacier from space', 'space', 2],
];
const NASA_BAD_TITLE = /\b(astronaut|astronauts|crew|expedition \d+|portrait|rocket|launch|shuttle|test|testing|simulat\w*|facility|training|workers?|engineers?|technicians?|ceremony|briefing|conference|team|mission control|logo|poster|infographic|chart|graph|diagram|model of|building|center|visit|award|photo op)\b/i;

async function nasaCandidates() {
  const queries = QUICK ? NASA_QUERIES.slice(0, 2) : NASA_QUERIES;
  const seen = new Map();
  for (const [q, cat, pages] of queries) {
    for (let page = 1; page <= pages; page++) {
      const u = 'https://images-api.nasa.gov/search?' + new URLSearchParams({ q, media_type: 'image', page_size: '100', page: String(page) });
      const j = await getJson(u);
      const items = (j && j.collection && j.collection.items) || [];
      for (const it of items) {
        const d = (it.data || [])[0];
        if (d && d.nasa_id && !seen.has(d.nasa_id)) seen.set(d.nasa_id, { d, cat });
      }
      if (items.length < 100) break;
    }
    console.log('nasa query', q, '-> ids', seen.size);
  }
  const out = [];
  for (const { d, cat } of seen.values()) {
    const credit = d.secondary_creator || '';
    const text = [d.title, d.description, credit].join(' ');
    if (!/nasa/i.test(credit + ' ' + (d.center || ''))) continue;
    if (/copyright|©|\(c\)|shutterstock|getty|reuters|\bAP\b|used with permission/i.test(text)) continue;
    const title = clip(d.title, 80);
    if (!title || NASA_BAD_TITLE.test(d.title) || BAD_NASA.test(d.title) || /^(PIA|GSFC|JSC|KSC)[\w-]*$/i.test(d.title)) continue;
    if (!/^[\w\-.]+$/.test(d.nasa_id)) continue;
    const base = 'https://images-assets.nasa.gov/image/' + d.nasa_id + '/' + d.nasa_id;
    let author = 'NASA';
    if (credit && credit.length <= 80) author = /^nasa/i.test(credit.trim()) ? credit.trim() : 'NASA, ' + credit.trim();
    out.push({
      src: 'nasa', nid: d.nasa_id, title, author: clip(author, 80), licence: 'PDM-1.0',
      sourceUrl: 'https://images.nasa.gov/details/' + d.nasa_id,
      thumbUrl: base + '~small.jpg', fullUrl: base + '~orig.jpg',
      tags: cleanTags(d.keywords || [], []), category: cat, minAspect: 1.45,
    });
  }
  console.log('nasa candidates', out.length);
  return out;
}

// ---- Wikimedia Commons (public domain files only)
const WIKI_PD = 'haswbstatement:P6216=Q19652';
const WIKI_BASE = 'filetype:bitmap filew:>2559 ';
const WIKI_QUERIES = [
  // [search text (without base), category, pages of 50]
  ...['mountain peaks', 'mountains snow', 'glacier', 'volcano', 'canyon', 'alpine lake', 'rocky mountains', 'cliffs', 'mountain range sunrise', 'Yosemite', 'Grand Canyon', 'Alps', 'Himalaya', 'Mount Rainier', 'Tetons', 'Alaska mountains']
    .map((t) => [t + ' ' + WIKI_PD, 'mountains', 2]),
  ...['forest', 'lake', 'river', 'waterfall', 'meadow', 'desert', 'prairie', 'wildflowers', 'autumn foliage', 'fog valley', 'wetland marsh', 'sand dunes', 'national park landscape', 'redwood trees', 'bayou swamp', 'canyon river', 'tundra', 'rainforest', 'hot springs']
    .map((t) => [t + ' ' + WIKI_PD, 'nature', 2]),
  ...['sunset', 'sunrise', 'clouds', 'ocean waves', 'beach', 'coast', 'lighthouse', 'storm clouds', 'night sky stars', 'milky way', 'rainbow', 'lightning', 'sea cliffs', 'sky', 'harbor boats', 'dusk']
    .map((t) => [t + ' ' + WIKI_PD, 'sea-and-sky', 2]),
  ...['city skyline', 'skyline night', 'downtown', 'bridge', 'aerial city', 'street', 'harbor city', 'Manhattan', 'San Francisco', 'Chicago skyline', 'Washington D.C.']
    .map((t) => [t + ' ' + WIKI_PD, 'cities', 2]),
  ...['cathedral', 'castle', 'palace', 'temple', 'mosque', 'interior architecture', 'monument', 'tower', 'capitol building', 'church', 'bridge architecture', 'dome', 'ruins', 'mission', 'lighthouse architecture', 'fort', 'abbey']
    .map((t) => [t + ' ' + WIKI_PD, 'architecture', 2]),
  // Carol M. Highsmith archive (Library of Congress; she dedicated the photographs to the public domain)
  ...['mountains', 'lake', 'river', 'desert', 'forest', 'sunset', 'canyon', 'waterfall', 'coast', 'national park']
    .map((t) => ['deepcategory:"Photographs by Carol M. Highsmith" ' + t, t === 'coast' || t === 'sunset' ? 'sea-and-sky' : t === 'mountains' || t === 'canyon' ? 'mountains' : 'nature', 2]),
  ...['skyline', 'bridge', 'downtown', 'night']
    .map((t) => ['deepcategory:"Photographs by Carol M. Highsmith" ' + t, 'cities', 2]),
  ...['cathedral', 'castle', 'courthouse', 'capitol', 'church', 'mansion', 'museum', 'library interior']
    .map((t) => ['deepcategory:"Photographs by Carol M. Highsmith" ' + t, 'architecture', 2]),
  // Old paintings in the public domain, scanned at high resolution
  ...['Hudson River School', 'Romanticism landscape painting', 'Impressionism landscape painting', 'Barbizon school landscape', 'Bierstadt', 'Frederic Edwin Church', 'Thomas Cole', 'Aivazovsky seascape', 'Turner landscape', 'Caspar David Friedrich', 'Hiroshige', 'Hokusai', 'Monet', 'Van Gogh landscape', 'Cezanne landscape', 'Claude Lorrain', 'Constable', 'Corot']
    .map((t) => [t + ' ' + WIKI_PD, /Aivazovsky|Hiroshige|Hokusai/.test(t) ? (/Aivazovsky/.test(t) ? 'art-seascapes' : 'art-japan') : 'art-landscapes', 2]),
];
const WIKI_NOT_PHOTO = /\b(paintings?|artworks?|drawings?|illustrations?|engravings?|lithographs?|stamps?|maps?|coats? of arms|diagrams?|posters?|scans?|manuscripts?|documents?|postcards?|prints?|sculptures?|statues?|caricatures?|cartoons?|screenshots?|logos?|portraits?|people|men|women|children|soldiers?|military)\b/i;

async function wikiCandidates() {
  const queries = QUICK ? WIKI_QUERIES.slice(0, 2) : WIKI_QUERIES;
  const found = new Map();
  for (const [text, cat, pages] of queries) {
    let cont = {};
    for (let page = 0; page < pages; page++) {
      const p = new URLSearchParams({
        action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrlimit: '50', gsrsearch: WIKI_BASE + text,
        prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '3840', iiextmetadatalanguage: 'en',
        iiextmetadatafilter: 'LicenseShortName|Artist|ObjectName|Categories|ImageDescription', ...cont,
      });
      const j = await getJson('https://commons.wikimedia.org/w/api.php?' + p);
      const pagesObj = (j.query && j.query.pages) || {};
      for (const pg of Object.values(pagesObj)) if (!found.has(pg.pageid)) found.set(pg.pageid, { pg, cat });
      if (!j.continue) break;
      cont = j.continue;
    }
    console.log('wiki query', text.slice(0, 50), '-> files', found.size);
  }
  const keep = [];
  const wantPainting = (c) => c.startsWith('art-');
  for (const { pg, cat } of found.values()) {
    const ii = (pg.imageinfo || [])[0];
    if (!ii || !/^image\/(jpeg|png)$/.test(ii.mime || '') && !(ii.mime === 'image/tiff')) continue;
    const meta = ii.extmetadata || {};
    const lic = stripHtml((meta.LicenseShortName || {}).value);
    if (!LICENCE_OK.test(lic)) continue;
    if (ii.width < MIN_WIDTH) continue;
    const aspect = ii.width / ii.height;
    if (aspect < 1.45 || aspect > MAX_ASPECT) continue;
    const fileName = pg.title.replace(/^File:/, '').replace(/\.[A-Za-z0-9]+$/, '');
    const objectName = stripHtml((meta.ObjectName || {}).value);
    let title = (objectName && objectName.length >= 6 ? objectName : fileName).replace(/_/g, ' ').replace(/\s*\b(LCCN|NARA|LOC|HDR)\w*.*$/i, '').replace(/\s+/g, ' ').trim();
    title = title.replace(/\s*[-–]\s*[A-Z]{2,}\d+\w*$/, '').trim();
    const letters = title.replace(/[^A-Za-zÀ-ɏ]/g, '').length;
    if (letters < 8 || /^(dsc|img|p\d|dscf|dji|copy of|image|file|photo)\b/i.test(title) || /\b(NARA|page \d)\b/.test(pg.title)) continue;
    const cats = stripHtml((meta.Categories || {}).value);
    const descr = stripHtml((meta.ImageDescription || {}).value).slice(0, 600);
    const bad = title + ' ' + descr;
    if (BAD_SUBJECT.test(bad) || BAD_TEXTY.test(title) || BAD_WIKI.test(title + ' ' + descr + ' ' + stripHtml((meta.Artist || {}).value))) continue;
    if (!wantPainting(cat) && /\b(coin|dollar|currency|banknote)\b/i.test(cats)) continue;
    if (wantPainting(cat)) { if (!/paint/i.test(cats + ' ' + descr)) continue; }
    else if (WIKI_NOT_PHOTO.test(cats) || /\b(painting|drawing|engraving|lithograph|illustration)\b/i.test(descr)) continue;
    let artist = stripHtml((meta.Artist || {}).value).replace(/\s*\(.*$/, '').replace(/^(photograph(er)?|photo|by|creator)\s*[:\-]?\s*/i, '').trim();
    if (!artist || /^(unknown|anonymous|unidentified|own work|see below|n\/a)/i.test(artist) || artist.length < 3) continue;
    if (/highsmith/i.test(artist)) artist = 'Carol M. Highsmith';
    const full = ii.thumburl && ii.thumbwidth >= MIN_WIDTH ? ii.thumburl : ii.url;
    if (!full) continue;
    keep.push({
      src: 'wiki', nid: pg.pageid, title: clip(title, 80), author: clip(artist, 80), licence: /^cc0/i.test(lic) ? 'CC0-1.0' : 'PDM-1.0',
      sourceUrl: ii.descriptionurl, fullUrl: full.replace(/\?utm_[^ ]*$/, ''), thumbUrl: null, pageTitle: pg.title,
      tags: cleanTags([], []), category: cat, minAspect: 1.45, width: ii.width, height: ii.height,
    });
  }
  // thumbnails at 640 px, 50 titles per request
  for (let i = 0; i < keep.length; i += 50) {
    const batch = keep.slice(i, i + 50);
    const p = new URLSearchParams({ action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url', iiurlwidth: '640', titles: batch.map((c) => c.pageTitle).join('|') });
    const j = await getJson('https://commons.wikimedia.org/w/api.php?' + p);
    const byTitle = new Map();
    for (const pg of Object.values((j.query && j.query.pages) || {})) byTitle.set(pg.title, pg);
    for (const c of batch) {
      const pg = byTitle.get(c.pageTitle) || [...byTitle.values()].find((x) => x.title.replace(/_/g, ' ') === c.pageTitle.replace(/_/g, ' '));
      const ii = pg && (pg.imageinfo || [])[0];
      if (ii && ii.thumburl) c.thumbUrl = ii.thumburl.replace(/\?utm_[^ ]*$/, '');
    }
  }
  const out = keep.filter((c) => c.thumbUrl);
  console.log('wiki candidates', out.length);
  return out;
}

// ---------- verification ----------------------------------------------------------------

const VERIFY_FILE = path.join(CACHE_DIR, 'verify.json');
let verifyCache = {};
function loadVerify() { if (!REFRESH && fs.existsSync(VERIFY_FILE)) verifyCache = JSON.parse(fs.readFileSync(VERIFY_FILE, 'utf8')); }
function saveVerify() { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(VERIFY_FILE, JSON.stringify(verifyCache)); }

function sameHostFinal(orig, final) {
  try {
    const a = new URL(orig), b = new URL(final);
    if (a.hostname === b.hostname && b.protocol === 'https:') return b.href;
  } catch (e) { return orig; }
  return orig;
}

async function probeFull(url) {
  const sharp = require('sharp');
  const r = await request(url, { headers: { Range: 'bytes=0-262143' }, maxBytes: 262144 });
  if (!r.status) return { ok: false, why: 'unreachable: ' + r.error };
  if (r.status !== 200 && r.status !== 206) return { ok: false, why: 'HTTP ' + r.status };
  const ct = String(r.headers.get('content-type') || '').toLowerCase();
  if (!/^image\/(jpeg|png|webp)/.test(ct)) return { ok: false, why: 'content-type ' + ct };
  let total = null;
  const cr = r.headers.get('content-range');
  if (cr && /\/(\d+)$/.test(cr)) total = Number(cr.match(/\/(\d+)$/)[1]);
  else if (r.status === 200 && r.headers.get('content-length')) total = Number(r.headers.get('content-length'));
  if (total === null) {
    // No length given (on-demand thumbnails): count the bytes, up to the limit.
    const c = await request(url, { maxBytes: MAX_BYTES + 1 });
    if (c.status !== 200) return { ok: false, why: 'HTTP ' + c.status + ' while sizing' };
    total = c.read;
  }
  if (total > MAX_BYTES) return { ok: false, why: 'too big: ' + total };
  let meta;
  try { meta = await sharp(r.body, { failOn: 'none' }).metadata(); } catch (e) { return { ok: false, why: 'unreadable header: ' + e.message }; }
  if (!meta.width || !meta.height) return { ok: false, why: 'no pixel size' };
  const orient = meta.orientation && meta.orientation >= 5 ? true : false;
  return { ok: true, url: sameHostFinal(url, r.url), size: total, w: orient ? meta.height : meta.width, h: orient ? meta.width : meta.height };
}

async function probeThumb(url) {
  const sharp = require('sharp');
  const r = await request(url, { maxBytes: 4 * 1024 * 1024 });
  if (!r.status) return { ok: false, why: 'unreachable: ' + r.error };
  if (r.status !== 200) return { ok: false, why: 'HTTP ' + r.status };
  const ct = String(r.headers.get('content-type') || '').toLowerCase();
  if (!/^image\/(jpeg|png|webp)/.test(ct)) return { ok: false, why: 'content-type ' + ct };
  if (r.truncated) return { ok: false, why: 'thumbnail larger than 4 MB' };
  try {
    const img = sharp(r.body, { failOn: 'none' }).rotate();
    const meta = await img.metadata();
    const { data, info } = await img.clone().resize(48, 48, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const buckets = new Map();
    let satSum = 0, n = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      const R = data[i], G = data[i + 1], B = data[i + 2];
      const key = (R >> 4) << 8 | (G >> 4) << 4 | (B >> 4);
      const b = buckets.get(key) || [0, 0, 0, 0];
      b[0]++; b[1] += R; b[2] += G; b[3] += B;
      buckets.set(key, b);
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      satSum += mx ? (mx - mn) / mx : 0; n++;
    }
    let best = null;
    for (const b of buckets.values()) if (!best || b[0] > best[0]) best = b;
    const hex = '#' + [best[1], best[2], best[3]].map((v) => Math.round(v / best[0]).toString(16).padStart(2, '0')).join('');
    const g = await img.clone().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
    let bits = '';
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += g[y * 9 + x] > g[y * 9 + x + 1] ? '1' : '0';
    return { ok: true, url: sameHostFinal(url, r.url), dominant: hex, sat: Math.round(satSum / n * 1000) / 1000, hash: bits, tw: meta.width };
  } catch (e) { return { ok: false, why: 'cannot decode: ' + e.message }; }
}

async function verifyOne(url, kind) {
  const key = kind + ' ' + url;
  if (verifyCache[key]) return verifyCache[key];
  const r = kind === 'full' ? await probeFull(url) : await probeThumb(url);
  verifyCache[key] = r;
  return r;
}

// ---------- assembly -----------------------------------------------------------------------

function hamming(a, b) { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; }

async function main() {
  // aic is not in the default list: www.artic.edu answers every non-browser request for an IIIF picture with
  // HTTP 403 (bot protection), so none of its pictures can be verified from a script. See the README.
  const only = (OPT('sources') || 'met,cma,nasa,wiki').split(',');
  loadVerify();
  const makers = { met: metCandidates, aic: aicCandidates, cma: cmaCandidates, nasa: nasaCandidates, wiki: wikiCandidates };
  let cands = [];
  for (const s of only) {
    if (!makers[s]) throw new Error('unknown source ' + s);
    cands = cands.concat(await makers[s]());
  }
  // The same address twice (a work found by two queries is already merged inside a source).
  const byFull = new Map();
  for (const c of cands) if (!byFull.has(c.fullUrl)) byFull.set(c.fullUrl, c);
  cands = [...byFull.values()];
  console.log('candidates to verify:', cands.length);

  let n = 0;
  // 10 in flight so a slow on-demand thumbnail does not stall the rest; every host still gets one request per HOST_GAP.
  const results = await pmap(cands, 10, async (c) => {
    const t = await verifyOne(c.thumbUrl, 'thumb');
    let f = { ok: false, why: 'thumb failed' };
    if (t.ok) f = await verifyOne(c.fullUrl, 'full');
    if (++n % 100 === 0) { console.log('  verified', n, '/', cands.length); saveVerify(); }
    return { c, t, f };
  });
  saveVerify();

  const dropped = {};
  const drop = (why) => { dropped[why] = (dropped[why] || 0) + 1; };
  const kept = [];
  for (const { c, t, f } of results) {
    if (!t.ok) { drop('thumb: ' + t.why.replace(/[0-9]+/g, 'N').slice(0, 40)); continue; }
    if (!f.ok) { drop('full: ' + f.why.replace(/[0-9]+/g, 'N').slice(0, 40)); continue; }
    if (f.w < MIN_WIDTH) { drop('narrower than ' + MIN_WIDTH); continue; }
    const aspect = f.w / f.h;
    if (aspect < c.minAspect) { drop('not wide enough'); continue; }
    if (aspect > MAX_ASPECT) { drop('too panoramic'); continue; }
    if (c.src === 'wiki' && !c.category.startsWith('art-') && t.sat < 0.05) { drop('black and white photo'); continue; }
    if (c.src === 'wiki' && Math.abs(f.w - c.width) > 0 && f.w > 3840) { drop('wiki size mismatch'); continue; }
    kept.push({ c, t, f });
  }

  // Look-alikes: keep the first (sources are ordered met, aic, cma, nasa, wiki).
  const hashes = [];
  const finalList = [];
  for (const k of kept) {
    // Same title and author is only a duplicate when the pictures also look alike ("Landscape" by one painter is common).
    const nk = normKey(k.c.title + '|' + k.c.author);
    if (hashes.some((h) => hamming(h.hash, k.t.hash) <= 4 || (h.key === nk && hamming(h.hash, k.t.hash) <= 14))) { drop('look-alike picture'); continue; }
    hashes.push({ hash: k.t.hash, key: nk });
    finalList.push(k);
  }

  const ids = new Set();
  const entries = [];
  for (const { c, t, f } of finalList) {
    const id = makeId(c.src, c.title, c.nid);
    if (ids.has(id)) { drop('id clash'); continue; }
    ids.add(id);
    entries.push({
      id, title: c.title, author: c.author, licence: c.licence, sourceUrl: c.sourceUrl, thumbUrl: t.url, fullUrl: f.url,
      tags: c.tags, category: c.category, dominant: t.dominant, width: f.w, height: f.h,
    });
  }
  // stable order: category, then id
  entries.sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : a.id < b.id ? -1 : 1));
  const MAX = require('../src/main/wallpaper-catalogue').MAX_ENTRIES;
  if (entries.length > MAX) {
    // Over the limit: keep a fair share of every category (evenly spaced picks).
    const keepN = MAX;
    const step = entries.length / keepN;
    const cut = [];
    for (let i = 0; i < keepN; i++) cut.push(entries[Math.floor(i * step)]);
    entries.length = 0; entries.push(...cut);
  }

  const { checkEntry } = require('../src/main/wallpaper-catalogue');
  const bad = entries.map((e) => ({ e, r: checkEntry(e) })).filter((x) => x.r.problem);
  if (bad.length) throw new Error('The validator rejects ' + bad.length + ' entries, first: ' + bad[0].e.id + ' ' + bad[0].r.problem);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const lines = entries.map((e) => '    ' + JSON.stringify(e));
  const doc = '{\n  "schema": 1,\n  "name": "Vex free wallpapers",\n  "updated": "' + new Date().toISOString().slice(0, 10) + '",\n  "entries": [\n' + lines.join(',\n') + '\n  ]\n}\n';
  fs.writeFileSync(path.join(OUT_DIR, 'wallpaper-catalogue.json'), doc);
  fs.writeFileSync(path.join(OUT_DIR, 'wallpaper-catalogue-categories.json'), JSON.stringify(CATEGORY_TITLES, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT_DIR, 'wallpaper-catalogue-hosts.json'), JSON.stringify(ALLOWED_HOSTS, null, 2) + '\n');

  const count = (key) => entries.reduce((m, e) => { const k = typeof key === 'function' ? key(e) : e[key]; m[k] = (m[k] || 0) + 1; return m; }, {});
  console.log('\nWROTE', entries.length, 'entries,', Buffer.byteLength(doc), 'bytes');
  console.log('per source:', count((e) => e.id.split('-')[0]));
  console.log('per category:', count('category'));
  console.log('dropped:', dropped);
}

module.exports = { ALLOWED_HOSTS, SOURCE_HOSTS, CATEGORY_TITLES };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
