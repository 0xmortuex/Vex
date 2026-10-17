// === arXiv and ISBN lookup for the sources list ================================
//
// Like the DOI lookup (main/doi-resolve.js): only when the person presses the button on a source that has
// an arXiv id or an ISBN, one request to ONE fixed public host, nothing else sent.
//
//   arXiv  https://export.arxiv.org/api/query?id_list=<id>      (the arXiv API, an Atom feed)
//   ISBN   https://openlibrary.org/api/books?bibkeys=ISBN:<isbn> (Open Library's public book data)
//
// No cookie, no account, no email address. The caller passes the polite client (main/polite-fetch.js:
// per-host rate limit, Retry-After back-off, small cache), which sits on the bounded fetch that bounds size
// and time and feeds the "What left this computer" list. A refusal or an unknown id comes back as a plain
// sentence, never as a made-up record.
//
// createSourceLookup({ fetch }) so tests pass a local stand-in.

const ARXIV_NEW = /^\d{4}\.\d{4,5}$/;
const ARXIV_OLD = /^[a-z-]+(?:\.[A-Za-z]{2})?\/\d{7}$/;

// "arXiv:2101.00001v2", "https://arxiv.org/abs/2101.00001" or "2101.00001" -> "2101.00001" (version dropped).
function normalizeArxiv(input) {
  let s = String(input == null ? '' : input).trim();
  s = s.replace(/^arxiv:\s*/i, '').replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, '').replace(/\.pdf$/i, '').replace(/v\d+$/i, '');
  if (!ARXIV_NEW.test(s) && !ARXIV_OLD.test(s)) throw new Error('That is not an arXiv id. One looks like 2101.00001 or hep-th/9901001');
  return s;
}

// "0-306-40615-2", "978 0 306 40615 7" -> digits only, check digit verified; throws for anything else.
function normalizeIsbn(input) {
  const s = String(input == null ? '' : input).replace(/^isbn(?:-1[03])?:?\s*/i, '').replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{9}[\dX]$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (10 - i) * (s[i] === 'X' ? 10 : Number(s[i]));
    if (sum % 11 !== 0) throw new Error('That ISBN-10 has a wrong check digit. Check it for a typing mistake');
    return s;
  }
  if (/^\d{13}$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 13; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1);
    if (sum % 10 !== 0) throw new Error('That ISBN-13 has a wrong check digit. Check it for a typing mistake');
    return s;
  }
  throw new Error('That is not an ISBN. It has 10 or 13 digits');
}

function decodeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}
const tag = (xml, name) => { const m = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i').exec(xml); return m ? decodeXml(m[1]) : ''; };

// "Given Middle Family" -> { family, given }
function personName(full) {
  const parts = decodeXml(full).split(' ').filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) return { family: parts[0].slice(0, 120), given: '' };
  return { family: parts[parts.length - 1].slice(0, 80), given: parts.slice(0, -1).join(' ').slice(0, 80) };
}

// The Atom answer of the arXiv API -> the fields of a source record. Only what arXiv said.
function recordFromArxiv(xml, id) {
  const text = String(xml || '');
  const entry = /<entry[\s>][\s\S]*?<\/entry>/i.exec(text);
  if (!entry) throw new Error('arXiv does not know the id ' + id);
  const e = entry[0];
  const title = tag(e, 'title');
  if (!title || /^error$/i.test(title)) throw new Error('arXiv does not know the id ' + id);
  const authors = [...e.matchAll(/<author[\s>][\s\S]*?<\/author>/gi)].slice(0, 50).map(a => personName(tag(a[0], 'name'))).filter(Boolean);
  const published = tag(e, 'published').slice(0, 10);
  const doi = tag(e, 'arxiv:doi');
  const ref = tag(e, 'arxiv:journal_ref');
  return {
    kind: 'preprint',
    title: title.slice(0, 500),
    authors,
    container: ref ? ref.slice(0, 300) : 'arXiv',
    publisher: 'arXiv',
    date: /^\d{4}-\d{2}-\d{2}$/.test(published) ? published : '',
    arxiv: id,
    doi: /^10\.\d{4,9}\/\S{1,180}$/.test(doi) ? doi : '',
    url: 'https://arxiv.org/abs/' + id,
  };
}

// Open Library's answer for one ISBN -> the fields of a source record.
function recordFromOpenLibrary(body, isbn) {
  const rec = body && typeof body === 'object' ? body['ISBN:' + isbn] : null;
  if (!rec || typeof rec !== 'object') throw new Error('Open Library does not know the ISBN ' + isbn);
  const title = [rec.title, rec.subtitle].filter(Boolean).map(s => String(s).trim()).join(': ');
  if (!title) throw new Error('Open Library has no title for that ISBN');
  const authors = (Array.isArray(rec.authors) ? rec.authors : []).slice(0, 50).map(a => personName(a && a.name)).filter(Boolean);
  const publisher = Array.isArray(rec.publishers) && rec.publishers[0] ? String(rec.publishers[0].name || '') : '';
  const year = /\b(1[4-9]\d\d|20\d\d)\b/.exec(String(rec.publish_date || ''));
  return {
    kind: 'book',
    title: title.slice(0, 500),
    authors,
    publisher: publisher.slice(0, 200),
    date: year ? year[1] : '',
    isbn,
    url: typeof rec.url === 'string' && /^https:\/\/openlibrary\.org\//.test(rec.url) ? rec.url : '',
  };
}

function createSourceLookup({ fetch } = {}) {
  if (typeof fetch !== 'function') throw new Error('createSourceLookup needs a fetch');
  async function get(url, host, feature) {
    let res;
    try {
      res = await fetch(url, { headers: { Accept: '*/*' }, redirect: 'error', credentials: 'omit', timeoutMs: 15000, maxBytes: 512 * 1024, egress: { feature, kind: 'fetch' } });
    } catch (err) {
      throw new Error('Could not reach ' + host + ': ' + (err && err.message ? err.message : err), { cause: err });
    }
    if (!res.ok) throw new Error(host + ' answered ' + res.status);
    return res;
  }
  async function arxiv(input) {
    const id = normalizeArxiv(input);
    const res = await get('https://export.arxiv.org/api/query?max_results=1&id_list=' + encodeURIComponent(id), 'arXiv', 'Citation lookup (arXiv)');
    let xml;
    try { xml = await res.text(); } catch (err) { throw new Error('arXiv sent an answer Vex could not read', { cause: err }); }
    return recordFromArxiv(xml, id);
  }
  async function isbn(input) {
    const n = normalizeIsbn(input);
    const res = await get('https://openlibrary.org/api/books?format=json&jscmd=data&bibkeys=' + encodeURIComponent('ISBN:' + n), 'Open Library', 'Citation lookup (ISBN)');
    let body;
    try { body = await res.json(); } catch (err) { throw new Error('Open Library sent an answer Vex could not read', { cause: err }); }
    return recordFromOpenLibrary(body, n);
  }
  return { arxiv, isbn };
}

module.exports = { createSourceLookup, normalizeArxiv, normalizeIsbn, recordFromArxiv, recordFromOpenLibrary };
