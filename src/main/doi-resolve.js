// === DOI lookup for the sources list ===========================================
//
// "Look up this DOI" on a source record asks Crossref (api.crossref.org) for the
// title, authors, journal, volume, issue, pages, publisher and date of that one
// DOI and hands them back to fill the record. It is the only network call the
// citation features make, it runs only when the person presses the button, and
// it sends one thing: the DOI (a public identifier). No cookie, no header that
// names the person, no email address ("polite pool" mailto is deliberately not
// sent). The request is bounded in time and size and goes on the "What left
// this computer" list as "Citation lookup (DOI)" to api.crossref.org.
//
// DataCite and other registries are not asked: one host keeps the egress line
// honest. A DOI Crossref does not know comes back as a plain refusal.
//
// createDoiResolver({ fetch }) so tests pass a local stand-in; main passes the
// bounded net fetch that feeds the egress ledger.

const DOI_RE = /^10\.\d{4,9}\/[^\s"<>]{1,180}$/i;

// "doi:10.1/x", "https://doi.org/10.1/x" or "10.1/x" -> "10.1/x"; throws for anything else.
function normalizeDoi(input) {
  let s = String(input == null ? '' : input).trim();
  s = s.replace(/^doi:\s*/i, '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  s = s.replace(/[.,;)\]]+$/, '');
  try { s = decodeURIComponent(s); } catch { s = String(s); /* vex-allow-empty-catch: not percent-encoded, so the text as typed is used */ }
  if (!DOI_RE.test(s)) throw new Error('That is not a DOI. A DOI looks like 10.1000/xyz123');
  return s;
}

function datePart(parts) {
  const p = parts && Array.isArray(parts['date-parts']) ? parts['date-parts'][0] : null;
  if (!Array.isArray(p) || !Number.isInteger(p[0])) return '';
  return String(p[0]) + (Number.isInteger(p[1]) ? '-' + String(p[1]).padStart(2, '0') + (Number.isInteger(p[2]) ? '-' + String(p[2]).padStart(2, '0') : '') : '');
}

// Crossref "message" -> the fields of a source record. Only what Crossref said.
function recordFromWork(msg, doi) {
  if (!msg || typeof msg !== 'object') throw new Error('Crossref sent an answer Vex could not read');
  const first = (v) => (Array.isArray(v) ? String(v[0] == null ? '' : v[0]) : String(v == null ? '' : v)).replace(/\s+/g, ' ').trim();
  const title = first(msg.title);
  if (!title) throw new Error('Crossref has no title for that DOI');
  const authors = (Array.isArray(msg.author) ? msg.author : []).slice(0, 50)
    .map(a => (a && a.family ? { family: String(a.family).slice(0, 80), given: String(a.given || '').slice(0, 80) } : (a && a.name ? { family: String(a.name).slice(0, 120), given: '' } : null)))
    .filter(Boolean);
  const type = String(msg.type || '');
  const kind = /book/.test(type) ? 'book' : (type === 'posted-content' ? 'preprint' : 'article');
  const licenses = (Array.isArray(msg.license) ? msg.license : []).map(l => String(l && l.URL || ''));
  const open = licenses.some(u => /creativecommons\.org/i.test(u));
  return {
    kind,
    title: title.slice(0, 500),
    authors,
    container: first(msg['container-title']).slice(0, 300),
    publisher: first(msg.publisher).slice(0, 200),
    volume: first(msg.volume).slice(0, 40),
    issue: first(msg.issue).slice(0, 40),
    pages: first(msg.page).slice(0, 40),
    date: datePart(msg.issued) || datePart(msg['published-print']) || datePart(msg['published-online']),
    doi,
    url: 'https://doi.org/' + doi,
    // Crossref says a work is under a Creative Commons licence; it does not say where a free copy is.
    // The DOI link is the best address, and only when the licence says it is open.
    oaUrl: open ? 'https://doi.org/' + doi : '',
  };
}

function createDoiResolver({ fetch } = {}) {
  if (typeof fetch !== 'function') throw new Error('createDoiResolver needs a fetch');
  async function resolve(input) {
    const doi = normalizeDoi(input);
    let res;
    try {
      res = await fetch('https://api.crossref.org/works/' + encodeURIComponent(doi), {
        headers: { Accept: 'application/json', 'User-Agent': 'Vex citation lookup' },
        redirect: 'error', credentials: 'omit', timeoutMs: 15000, maxBytes: 512 * 1024,
        egress: { feature: 'Citation lookup (DOI)', kind: 'fetch' },
      });
    } catch (err) {
      throw new Error('Could not reach Crossref: ' + (err && err.message ? err.message : err), { cause: err });
    }
    if (res.status === 404) throw new Error('Crossref does not know the DOI ' + doi + ' (DataCite and other registries are not asked)');
    if (!res.ok) throw new Error('Crossref answered ' + res.status + ' for that DOI');
    let body;
    try { body = await res.json(); } catch (err) { throw new Error('Crossref sent an answer Vex could not read', { cause: err }); }
    return recordFromWork(body && body.message, doi);
  }
  return { resolve };
}

module.exports = { createDoiResolver, normalizeDoi, recordFromWork };
