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

  // ---- postcodes --------------------------------------------------------------
  // Open-Meteo's place search matches NAMES only: "34852" finds nothing, and the
  // name of the neighbourhood that postcode covers (Zümrütevler, Maltepe) finds a
  // different Zümrütevler in Bursa. A postcode is looked up on its own, in the
  // chosen country, at OpenStreetMap's Nominatim (structured postalcode= query).
  //
  // Why Nominatim and not Zippopotam.us: Zippopotam names the right neighbourhoods
  // for 34852 but gives every Turkish code the same point (40.1537, 33.1779, which
  // is near Çankırı, not Istanbul), so its coordinates cannot be used for weather.
  // Nominatim returns the postcode's own boundary and centre (40.9408, 29.1504 for
  // 34852). Terms (operations.osmfoundation.org/policies/nominatim): at most one
  // request a second, an identifying User-Agent (Electron's default one names
  // Vex), cached results, no autocomplete (one request per press of Search), and
  // "© OpenStreetMap contributors" shown with the results (ODbL).
  POSTCODE_ENDPOINT: 'https://nominatim.openstreetmap.org/search',
  ATTRIBUTION: '© OpenStreetMap contributors',
  MIN_GAP_MS: 1100,
  _cache: new Map(),
  _lastRequestAt: 0,

  // A postcode has a digit, is 3-10 characters of letters, digits, space or dash,
  // and has no run of more than two letters ("SW1A 1AA", "K1A 0B1", "1012 AB",
  // "34852"). A place name such as "Springfield" or "Paris 8e" is not one.
  looksLikePostcode(q) {
    const s = String(q || '').trim();
    if (!/\d/.test(s) || s.length < 3 || s.length > 10) return false;
    if (!/^[A-Za-z0-9][A-Za-z0-9 -]*[A-Za-z0-9]$/.test(s)) return false;
    return !/[A-Za-z]{3,}/.test(s);
  },

  // Text for the line under the results: who the data is from, when it is theirs.
  attribution(hits) {
    return Array.isArray(hits) && hits.some((h) => h && h.source === 'osm') ? this.ATTRIBUTION : '';
  },

  // What to tell the person when a search found nothing. One wording for the
  // wizard, the start page and Settings.
  noMatchMessage(q, found, country) {
    const where = country ? this.countryName(country) : '';
    if (found && found.postcode) {
      return 'No place has the postcode “' + q + '”' + (where ? ' in ' + where : '')
        + '. Check the number' + (country ? ' and the country' : ', or choose a country') + ', or search by district name.';
    }
    if (found && found.elsewhere) {
      return 'No match for “' + q + '”' + (where ? ' in ' + where : '') + '. There are ' + found.elsewhere
        + ' elsewhere — set Country to “Any country” to see them.';
    }
    return 'No match for “' + q + '” — try the nearest town, another spelling, or the postcode.';
  },

  // One Nominatim result as the shape the rest of this file already uses, or
  // null when the answer cannot be trusted as a place for a forecast.
  _fromNominatim(r, postcode) {
    if (!r || typeof r !== 'object') return null;
    const lat = Number(r.lat), lon = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    // The centre must lie inside the box Nominatim gives with it; a point outside
    // its own box is the kind of wrong coordinate Zippopotam gave.
    const bb = Array.isArray(r.boundingbox) ? r.boundingbox.map(Number) : null;
    if (bb && bb.length === 4 && bb.every(Number.isFinite)) {
      const [s, n, w, e] = bb;
      if (lat < s || lat > n || lon < w || lon > e) return null;
    }
    const a = r.address || {};
    const local = a.neighbourhood || a.suburb || a.quarter || '';
    const district = a.village || a.town || a.city || a.municipality || a.city_district || '';
    const name = local || district || (r.name && r.name !== postcode ? r.name : '');
    if (!name) return null;
    return {
      name,
      // Most specific first, the way Open-Meteo's own admin levels read: district, county, province.
      admin3: local ? district : '',
      admin2: a.county || a.state_district || '',
      admin1: a.province || a.state || '',
      country: a.country || '',
      country_code: String(a.country_code || '').toUpperCase(),
      latitude: lat,
      longitude: lon,
      postcodes: [a.postcode || postcode],
      source: 'osm',
    };
  },

  // -> { hits, elsewhere: 0, postcode: '34852' }. Throws when the service cannot
  // be reached or answers badly: an empty list must mean "no such postcode".
  async searchPostcode(query, opts) {
    const o = opts || {};
    const q = String(query || '').trim().replace(/\s+/g, ' ');
    const lang = String(o.lang || 'en').slice(0, 2);
    const country = String(o.country || '').toLowerCase();
    const url = this.POSTCODE_ENDPOINT + '?postalcode=' + encodeURIComponent(q)
      + (country ? '&country=' + encodeURIComponent(country) : '')
      + '&format=jsonv2&addressdetails=1&limit=10&accept-language=' + encodeURIComponent(lang);
    let rows = this._cache.get(url);
    if (!rows) {
      const wait = this._lastRequestAt + this.MIN_GAP_MS - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this._lastRequestAt = Date.now();
      const fetcher = (typeof window !== 'undefined' && window.VexNet && window.VexNet.fetch) || fetch;
      let res;
      try { res = await fetcher(url, { headers: { Accept: 'application/json' }, credentials: 'omit', referrerPolicy: 'no-referrer' }); }
      catch (err) { throw new Error('Could not reach the postcode service (OpenStreetMap). Check your connection and try again.', { cause: err }); }
      if (res.status === 429) throw new Error('The postcode service is busy. Wait a minute and try again.');
      if (!res.ok) throw new Error('The postcode service answered with an error (' + res.status + '). Try again later, or search by district name.');
      try { rows = await res.json(); }
      catch (err) { throw new Error('The postcode service sent an answer Vex could not read.', { cause: err }); }
      if (!Array.isArray(rows)) throw new Error('The postcode service sent an answer Vex could not read.');
      this._cache.set(url, rows);
    }
    const seen = new Set();
    const hits = [];
    for (const r of rows) {
      const h = this._fromNominatim(r, q);
      if (!h) continue;
      if (country && h.country_code.toLowerCase() !== country) continue;
      const key = this.label(h);
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(h);
    }
    return { hits, elsewhere: 0, postcode: q };
  },

  // Search. Returns { hits, elsewhere } — `elsewhere` counts matches that exist
  // but are outside the chosen country, so the caller can say "there are 12
  // elsewhere" instead of a flat "no matches". A postcode answers { postcode }.
  // Throws on a network/parse failure: a lookup that silently returns nothing
  // is indistinguishable from a place that doesn't exist.
  async search(query, opts) {
    const o = opts || {};
    const q = String(query || '').trim();
    if (!q) return { hits: [], elsewhere: 0 };
    if (this.looksLikePostcode(q)) return this.searchPostcode(q, o);
    const lang = String(o.lang || 'en').slice(0, 2);
    const url = this.ENDPOINT + '?name=' + encodeURIComponent(q)
      + '&count=' + (o.limit || this.LIMIT) + '&language=' + encodeURIComponent(lang) + '&format=json';

    const fetcher = (typeof window !== 'undefined' && window.VexNet && window.VexNet.fetch) || fetch;
    const res = await fetcher(url);
    if (!res.ok) throw new Error('The place search answered with an error (' + res.status + '). Try again later.');
    const data = await res.json();
    const all = (data && data.results) || [];
    if (!o.country) return { hits: all, elsewhere: 0 };
    const hits = all.filter((h) => h.country_code === o.country);
    return { hits, elsewhere: all.length - hits.length };
  },
};

if (typeof window !== 'undefined') window.VexGeo = VexGeo;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexGeo };
