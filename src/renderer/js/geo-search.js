// === Vex place search ======================================================
//
// Finding "where you are" for the weather, shared by the setup wizard and the
// start page's own "Change location" button. It lived twice, and both copies
// had the same two faults:
//
//   * they asked Open-Meteo for the 5 best matches in TURKISH, whatever
//     language you had chosen. Manchester and Springfield have about a hundred
//     matches each, so the one you wanted usually wasn't among the five — and
//     an English name searched against Turkish results often matched nothing
//     at all. That is why "it doesn't recognize some cities".
//   * they showed "name · region · country", which cannot tell two districts
//     of the same name apart.
//
// So: search in the user's own language, ask for enough results to contain the
// right one, narrow by country, and write each place out in full.
const VexGeo = {
  // ISO 3166-1 alpha-2, for the country picker. Names come from Intl, so they
  // appear in the reader's own language rather than a hardcoded English list.
  COUNTRY_CODES: ('AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ '
    + 'CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB '
    + 'GD GE GH GM GN GQ GR GT GW GY HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR '
    + 'KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MR MT MU MV MW MX MY MZ NA NE '
    + 'NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN '
    + 'SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS XK YE '
    + 'ZA ZM ZW').split(' '),

  ENDPOINT: 'https://geocoding-api.open-meteo.com/v1/search',
  LIMIT: 100,

  countryName(code) {
    try {
      const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en';
      return new Intl.DisplayNames([lang], { type: 'region' }).of(code) || code;
    } catch { return code; }
  },

  // The country the browser's locale implies, or '' for "any".
  guessCountry() {
    try {
      const m = /[-_]([A-Za-z]{2})$/.exec((typeof navigator !== 'undefined' && navigator.language) || '');
      if (m) { const c = m[1].toUpperCase(); if (this.COUNTRY_CODES.includes(c)) return c; }
    } catch { /* no locale to read */ }
    return '';
  },

  // Countries sorted by their name in the reader's language.
  countries() {
    return this.COUNTRY_CODES
      .map((code) => ({ code, name: this.countryName(code) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  // <option> markup for a country <select>, "Any country" first.
  optionsHtml(selected, anyLabel) {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    return '<option value="">' + esc(anyLabel || 'Any country') + '</option>'
      + this.countries().map((c) => '<option value="' + c.code + '"'
        + (c.code === selected ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('');
  },

  // A place written out in full, most specific first, duplicates dropped:
  //   "Ataşehir · Istanbul · Türkiye"   not   "Ataşehir · Istanbul"
  // with its postcodes when it has them, because that is often the only thing
  // that separates two places of the same name.
  label(hit) {
    if (!hit) return '';
    const parts = [hit.name, hit.admin3, hit.admin2, hit.admin1, hit.country].filter(Boolean);
    const seen = new Set();
    const unique = parts.filter((p) => {
      const k = String(p).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    let out = unique.join(' · ');
    const codes = Array.isArray(hit.postcodes) ? hit.postcodes.slice(0, 2) : [];
    if (codes.length) out += '  [' + codes.join(', ') + ']';
    return out;
  },

  // The short name stored and shown on the weather card.
  short(hit) {
    if (!hit) return '';
    const bits = [hit.name];
    if (hit.admin1 && hit.admin1 !== hit.name) bits.push(hit.admin1);
    if (hit.country_code) bits.push(hit.country_code);
    return bits.join(', ');
  },

  // What the start page and the wizard both store.
  toLocation(hit) {
    return { lat: hit.latitude, lon: hit.longitude, city: this.short(hit) };
  },

  // Search. Returns { hits, elsewhere } — `elsewhere` counts matches that exist
  // but are outside the chosen country, so the caller can say "there are 12
  // elsewhere" instead of a flat "no matches".
  // Throws on a network/parse failure: a lookup that silently returns nothing
  // is indistinguishable from a place that doesn't exist.
  async search(query, opts) {
    const o = opts || {};
    const q = String(query || '').trim();
    if (!q) return { hits: [], elsewhere: 0 };
    const lang = String(o.lang || 'en').slice(0, 2);
    const url = this.ENDPOINT + '?name=' + encodeURIComponent(q)
      + '&count=' + (o.limit || this.LIMIT) + '&language=' + encodeURIComponent(lang) + '&format=json';

    const fetcher = (typeof window !== 'undefined' && window.VexNet && window.VexNet.fetch) || fetch;
    const res = await fetcher(url);
    const data = await res.json();
    const all = (data && data.results) || [];
    if (!o.country) return { hits: all, elsewhere: 0 };
    const hits = all.filter((h) => h.country_code === o.country);
    return { hits, elsewhere: all.length - hits.length };
  },
};

if (typeof window !== 'undefined') window.VexGeo = VexGeo;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexGeo };
