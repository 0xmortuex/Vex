// === The lists the dangerous-site check may download ==========================
//
// Only a list whose OWN published terms allow it to be used and copied is here, and the
// licence is written next to it (and in docs/threat-lists.md, with what was and was not
// verified). Nothing is downloaded from a list that is not in this table: a source needs
// `licenceVerified`, a licence name and the address of the licence text.
//
// Not used, and why (checked 2026-11-01, see docs/threat-lists.md):
//   OpenPhish community feed   its terms forbid commercial use and redistribution
//   URLhaus (abuse.ch)         every download needs a personal Auth-Key from abuse.ch
//   hagezi dns-blocklists      GPL-3.0 (copyleft); not needed, the data would not be bundled but the terms are stricter than MIT
//   StevenBlack hosts          MIT, but an ad/malware hosts list: not a phishing list, so it would block ordinary ad hosts as "dangerous"

const MB = 1024 * 1024;

const SOURCES = [
  {
    id: 'phishing-database-domains',
    name: 'Phishing.Database: active phishing domains',
    url: 'https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-domains-ACTIVE.txt',
    format: 'lines',                 // one domain per line; a line with a path is an exact address
    maxBytes: 32 * MB,               // the file is about 11 MB today
    minEntries: 10000,               // fewer than this means the file is wrong (empty, an error page): the old list is kept
    licence: 'MIT',
    licenceUrl: 'https://github.com/Phishing-Database/Phishing.Database/blob/master/LICENSE',
    licenceVerified: '2026-11-01',
    note: 'The MIT licence covers the repository; the project does not state a separate licence for the data files.',
  },
];

function validateSource(s) {
  const need = (c, m) => { if (!c) throw new Error('Threat list source "' + (s && s.id) + '": ' + m); };
  need(s && typeof s.id === 'string' && /^[a-z0-9-]+$/.test(s.id), 'needs an id');
  need(/^https:\/\//.test(s.url), 'must be an https address');
  need(s.format === 'lines', 'unknown format');
  need(Number.isFinite(s.maxBytes) && s.maxBytes > 0, 'needs a size cap');
  need(Number.isFinite(s.minEntries) && s.minEntries >= 0, 'needs minEntries');
  need(typeof s.licence === 'string' && s.licence && /^https:\/\//.test(s.licenceUrl || '') && /^\d{4}-\d{2}-\d{2}$/.test(s.licenceVerified || ''), 'has no verified licence');
  return s;
}
SOURCES.forEach(validateSource);

module.exports = { SOURCES, validateSource };
