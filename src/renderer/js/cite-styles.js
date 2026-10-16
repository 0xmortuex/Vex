// === Citation styles and BibTeX (pure) =========================================
//
// Turns one source record (js/sources.js) into a reference in APA 7, MLA 9,
// Chicago (bibliography entry), the Turkish "Kaynakca" form (APA-based, with
// "Erisim tarihi") or a BibTeX entry. Nothing here touches the page, storage or
// the network, so it is the same in the app and in tests.
//
// A record is
//   { kind: 'webpage'|'article'|'book'|'preprint', title, authors: [{family, given}],
//     date: 'YYYY' | 'YYYY-MM' | 'YYYY-MM-DD', site, container, publisher,
//     volume, issue, pages, doi, isbn, arxiv, url, accessed: 'YYYY-MM-DD' }
// An author with no `given` is an organisation and is written as it is.
//
// These are the common cases of each style, not the whole manual: a record with
// an editor, a translator or a series needs a person to finish it. Italics are
// written as *asterisks* when `md` is true (Markdown notes) and left out otherwise.

const VexCiteStyles = {
  STYLES: [
    { id: 'apa', label: 'APA 7' },
    { id: 'mla', label: 'MLA 9' },
    { id: 'chicago', label: 'Chicago (bibliography)' },
    { id: 'tr', label: 'Kaynakça (Türkçe)' },
    { id: 'bibtex', label: 'BibTeX' },
  ],
  MONTHS_EN: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  MONTHS_MLA: ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'],
  MONTHS_TR: ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'],

  // ---- small helpers -------------------------------------------------------------
  parseDate(s) {
    const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(String(s == null ? '' : s).trim());
    if (!m) return null;
    const y = Number(m[1]);
    const mo = m[2] ? Number(m[2]) : 0;
    const d = m[3] ? Number(m[3]) : 0;
    if (mo > 12 || d > 31) return null;
    return { y, m: mo, d };
  },
  _it(s, md) { return md && s ? '*' + s + '*' : s; },
  _end(s) { const t = String(s || '').trim(); return !t ? '' : (/[.?!]$/.test(t) ? t : t + '.'); },
  _doiUrl(rec) { return rec.doi ? 'https://doi.org/' + String(rec.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') : ''; },
  _link(rec) { return this._doiUrl(rec) || String(rec.url || ''); },
  _host(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } },
  _initials(given) {
    return String(given || '').split(/[\s]+/).filter(Boolean)
      .map(part => part.split('-').filter(Boolean).map(p => p[0].toLocaleUpperCase() + '.').join('-')).join(' ');
  },
  _people(rec) { return Array.isArray(rec.authors) ? rec.authors.filter(a => a && (a.family || a.given)) : []; },
  _pages(p, dash = '\u2013') { return String(p || '').replace(/\s*[-\u2013\u2014]+\s*/g, dash); },
  _clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); },

  // ---- authors -------------------------------------------------------------------
  _apaNames(list) {
    const n = list.map(a => (a.given ? a.family + ', ' + this._initials(a.given) : a.family));
    if (n.length === 1) return n[0];
    if (n.length <= 20) return n.slice(0, -1).join(', ') + ', & ' + n[n.length - 1];
    return n.slice(0, 19).join(', ') + ', . . . ' + n[n.length - 1];
  },
  _fullFirst(a) { return a.given ? a.family + ', ' + a.given : a.family; },
  _fullLast(a) { return a.given ? a.given + ' ' + a.family : a.family; },
  _mlaNames(list) {
    if (list.length === 1) return this._fullFirst(list[0]);
    if (list.length === 2) return this._fullFirst(list[0]) + ', and ' + this._fullLast(list[1]);
    return this._fullFirst(list[0]) + ', et al';
  },
  _chicagoNames(list) {
    if (list.length === 1) return this._fullFirst(list[0]);
    const shown = list.length > 10 ? list.slice(0, 7) : list;
    const out = [this._fullFirst(shown[0]), ...shown.slice(1).map(a => this._fullLast(a))];
    if (list.length > 10) return out.join(', ') + ', et al';
    return out.slice(0, -1).join(', ') + (out.length > 2 ? ',' : '') + ' and ' + out[out.length - 1];
  },
  _trNames(list) {
    const n = list.map(a => (a.given ? a.family + ', ' + this._initials(a.given) : a.family));
    if (n.length === 1) return n[0];
    return n.slice(0, -1).join(', ') + ' ve ' + n[n.length - 1];
  },

  // ---- dates ---------------------------------------------------------------------
  _apaDate(date, web) {
    if (!date) return 'n.d.';
    if (!web || !date.m) return String(date.y);
    return date.y + ', ' + this.MONTHS_EN[date.m - 1] + (date.d ? ' ' + date.d : '');
  },
  _mlaDate(date) {
    if (!date) return '';
    return (date.d ? date.d + ' ' : '') + (date.m ? this.MONTHS_MLA[date.m - 1] + ' ' : '') + date.y;
  },
  _chicagoDate(date) {
    if (!date) return '';
    return (date.m ? this.MONTHS_EN[date.m - 1] + ' ' : '') + (date.d ? date.d + ', ' : '') + date.y;
  },
  _trDate(date) { return date ? String(date.y) : 's.t.'; },
  _accessLong(acc, months, order) {
    const d = this.parseDate(acc);
    if (!d || !d.m || !d.d) return '';
    return order === 'dmy' ? d.d + ' ' + months[d.m - 1] + ' ' + d.y : months[d.m - 1] + ' ' + d.d + ', ' + d.y;
  },

  // ---- the styles ----------------------------------------------------------------
  _apa(rec, md) {
    const people = this._people(rec);
    const date = this.parseDate(rec.date);
    const web = rec.kind === 'webpage';
    const title = this._clean(rec.title);
    const journal = rec.container && rec.kind !== 'webpage';
    const lead = people.length ? this._end(this._apaNames(people)) : '';
    const when = '(' + this._apaDate(date, web) + ').';
    const parts = [];
    if (lead) parts.push(lead, when, journal ? this._end(title) : this._end(this._it(title, md)));
    else parts.push(journal ? this._end(title) : this._end(this._it(title, md)), when);
    if (journal) {
      let c = this._it(rec.container, md);
      if (rec.volume) c += ', ' + this._it(rec.volume, md);
      if (rec.issue) c += '(' + rec.issue + ')';
      if (rec.pages) c += ', ' + this._pages(rec.pages);
      parts.push(this._end(c));
    } else if (rec.publisher && !web) parts.push(this._end(rec.publisher));
    else if (web && rec.site && this._clean(rec.site) !== lead.replace(/\.$/, '')) parts.push(this._end(rec.site));
    const link = this._link(rec);
    if (link) parts.push(link);
    return parts.join(' ');
  },

  _mla(rec, md) {
    const people = this._people(rec);
    const date = this.parseDate(rec.date);
    const title = this._clean(rec.title);
    const web = rec.kind === 'webpage';
    const journal = rec.container && !web;
    const out = [];
    if (people.length) out.push(this._end(this._mlaNames(people)));
    out.push(journal || web ? '"' + title.replace(/[.?!]$/, '') + '."' : this._end(this._it(title, md)));
    const tail = [];
    if (journal) {
      tail.push(this._it(rec.container, md));
      if (rec.volume) tail.push('vol. ' + rec.volume);
      if (rec.issue) tail.push('no. ' + rec.issue);
      if (date) tail.push(this._mlaDate(date));
      if (rec.pages) tail.push((/[-\u2013]/.test(rec.pages) ? 'pp. ' : 'p. ') + this._pages(rec.pages));
    } else if (web) {
      if (rec.site) tail.push(this._it(rec.site, md));
      if (date) tail.push(this._mlaDate(date));
    } else {
      if (rec.publisher) tail.push(rec.publisher);
      if (date) tail.push(this._mlaDate(date));
    }
    if (tail.length) out.push(this._end(tail.join(', ')));
    const link = this._link(rec).replace(/^https?:\/\//i, '');
    if (link) out.push(this._end(link));
    const acc = this._accessLong(rec.accessed, this.MONTHS_MLA, 'dmy');
    if (web && acc) out.push('Accessed ' + acc + '.');
    return out.join(' ');
  },

  _chicago(rec, md) {
    const people = this._people(rec);
    const date = this.parseDate(rec.date);
    const title = this._clean(rec.title);
    const web = rec.kind === 'webpage';
    const journal = rec.container && !web;
    const out = [];
    if (people.length) out.push(this._end(this._chicagoNames(people)));
    out.push(journal || web ? '"' + title.replace(/[.?!]$/, '') + '."' : this._end(this._it(title, md)));
    if (journal) {
      let c = this._it(rec.container, md);
      if (rec.volume) c += ' ' + rec.volume;
      if (rec.issue) c += ', no. ' + rec.issue;
      if (date) c += ' (' + date.y + ')';
      if (rec.pages) c += ': ' + this._pages(rec.pages);
      out.push(this._end(c));
    } else if (web) {
      if (rec.site) out.push(this._end(rec.site));
      if (date) out.push(this._end(this._chicagoDate(date)));
    } else {
      const pub = [rec.publisher, date ? date.y : ''].filter(Boolean).join(', ');
      if (pub) out.push(this._end(pub));
    }
    const link = this._link(rec);
    if (link) out.push(this._end(link));
    return out.join(' ');
  },

  _tr(rec, md) {
    const people = this._people(rec);
    const date = this.parseDate(rec.date);
    const title = this._clean(rec.title);
    const journal = rec.container && rec.kind !== 'webpage';
    const out = [];
    if (people.length) out.push(this._end(this._trNames(people)));
    out.push('(' + this._trDate(date) + ').');
    out.push(journal ? this._end(title) : this._end(this._it(title, md)));
    if (journal) {
      let c = this._it(rec.container, md);
      if (rec.volume) c += ', ' + this._it(rec.volume, md);
      if (rec.issue) c += '(' + rec.issue + ')';
      if (rec.pages) c += ', ' + this._pages(rec.pages);
      out.push(this._end(c));
    } else if (rec.publisher) out.push(this._end(rec.publisher));
    else if (rec.site) out.push(this._end(rec.site));
    const link = this._link(rec);
    if (link) out.push(link);
    const acc = this._accessLong(rec.accessed, this.MONTHS_TR, 'dmy');
    if (acc && rec.kind === 'webpage') out.push('Erişim tarihi: ' + acc + '.');
    return out.join(' ');
  },

  // ---- BibTeX --------------------------------------------------------------------
  _bibEscape(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().replace(/([&%$#_])/g, '\\$1').replace(/[{}]/g, ''); },
  _bibAscii(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/İ/g, 'I').replace(/[^A-Za-z0-9]/g, '');
  },
  bibKey(rec) {
    const people = this._people(rec);
    const date = this.parseDate(rec.date);
    const first = people.length ? this._bibAscii(people[0].family || people[0].given) : this._bibAscii(this._host(rec.url)).slice(0, 12);
    const word = this._bibAscii(String(rec.title || '').split(/\s+/).find(w => this._bibAscii(w).length > 3) || '');
    return (first || 'source') + (date ? date.y : 'nd') + (word ? word[0].toLocaleUpperCase() + word.slice(1, 12).toLowerCase() : '');
  },
  _bibtex(rec) {
    const people = this._people(rec);
    const date = this.parseDate(rec.date);
    const web = rec.kind === 'webpage';
    const type = rec.container && !web ? 'article' : (rec.kind === 'book' ? 'book' : (rec.kind === 'preprint' ? 'misc' : 'misc'));
    const f = [];
    const add = (k, v) => { if (v !== undefined && v !== null && String(v).trim() !== '') f.push('  ' + k + ' = {' + v + '}'); };
    if (people.length) add('author', people.map(a => (a.given ? this._bibEscape(a.family) + ', ' + this._bibEscape(a.given) : '{' + this._bibEscape(a.family) + '}')).join(' and '));
    add('title', '{' + this._bibEscape(rec.title) + '}');
    if (type === 'article') {
      add('journal', this._bibEscape(rec.container));
      add('volume', this._bibEscape(rec.volume));
      add('number', this._bibEscape(rec.issue));
      add('pages', this._bibEscape(this._pages(rec.pages, '--')));
    } else if (type === 'book') add('publisher', this._bibEscape(rec.publisher));
    else if (web && rec.site) add('howpublished', this._bibEscape(rec.site));
    if (date) { add('year', date.y); if (date.m) add('month', this.MONTHS_EN[date.m - 1].slice(0, 3).toLowerCase()); }
    add('doi', this._bibEscape(String(rec.doi || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')).replace(/\\_/g, '_'));
    add('isbn', this._bibEscape(rec.isbn));
    if (rec.arxiv) { add('eprint', this._bibEscape(rec.arxiv)); add('archiveprefix', 'arXiv'); }
    if (rec.url) add('url', String(rec.url).replace(/[{}\s]/g, ''));
    if (rec.accessed) add('urldate', rec.accessed);
    return '@' + type + '{' + this.bibKey(rec) + ',\n' + f.join(',\n') + '\n}';
  },

  // ---- entry points ----------------------------------------------------------------
  // -> string. Throws for a record with no title or an unknown style.
  format(style, rec, { md = false } = {}) {
    if (!this.STYLES.some(s => s.id === style)) throw new Error('Unknown citation style ' + style);
    if (!rec || !this._clean(rec.title)) throw new Error('This source has no title to cite');
    if (style === 'apa') return this._apa(rec, md);
    if (style === 'mla') return this._mla(rec, md);
    if (style === 'chicago') return this._chicago(rec, md);
    if (style === 'tr') return this._tr(rec, md);
    return this._bibtex(rec);
  },

  // Several records as one bibliography, sorted by the first author's family name then title,
  // BibTeX entries separated by a blank line. Records with no title are skipped and counted.
  bibliography(style, recs, opts) {
    const keyOf = (r) => ((this._people(r)[0] || {}).family || r.title || '').toLocaleLowerCase('tr') + '|' + String(r.title || '').toLocaleLowerCase('tr');
    const usable = (Array.isArray(recs) ? recs : []).filter(r => r && this._clean(r.title));
    const skipped = (Array.isArray(recs) ? recs.length : 0) - usable.length;
    const sorted = usable.slice().sort((a, b) => keyOf(a).localeCompare(keyOf(b), 'tr'));
    const lines = sorted.map(r => this.format(style, r, opts));
    return { text: lines.join(style === 'bibtex' ? '\n\n' : '\n\n'), count: lines.length, skipped };
  },
};

if (typeof window !== 'undefined') window.VexCiteStyles = VexCiteStyles;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexCiteStyles };
