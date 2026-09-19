// === Getting things OUT of a page ===========================================
//
// A browser is very good at showing you a page and oddly bad at letting you
// keep any of it. Four things people do by hand every day:
//
//   keep it        as a PDF (hidden behind the print dialog) or as one file
//                  that opens offline (hidden behind nothing — there is no menu)
//   open a list    someone sends you twelve links; you open them one by one
//   its images     every picture on the page, full size, instead of
//                  right-click → save, forty times
//   cite it        APA, MLA, Harvard, Chicago or BibTeX, from what the page
//                  already says about itself, rather than a citation website
//                  full of adverts

// Runs INSIDE the page (serialized by PageExport.readable), so it must stand
// alone. → { title, url, markdown, xhtml }. The article if the page marks
// one, else its main region, else the body; minus navigation, headers,
// footers, sidebars, forms and anything hidden. The XHTML keeps only plain
// structural tags and absolute links, so it is well-formed and safe to put
// in an e-book; pictures become their alt text there.
function vexReadablePage() {
  const root = document.querySelector('article') || document.querySelector('main, [role="main"]') || document.body;
  const copy = root.cloneNode(true);
  copy.querySelectorAll('script, style, noscript, template, iframe, svg, canvas, video, audio, nav, header, footer, aside, form, button, input, select, textarea, [aria-hidden="true"], [hidden]').forEach(e => e.remove());
  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return ''; } };
  const squash = (s) => s.replace(/\s+/g, ' ');

  function md(node) {
    if (node.nodeType === 3) return squash(node.nodeValue);
    if (node.nodeType !== 1) return '';
    const tag = node.tagName.toLowerCase();
    const inner = () => Array.from(node.childNodes).map(md).join('');
    // "<b>Moon </b>pulls": the space belongs outside the marks, or it is lost.
    const wrap = (mark) => { const raw = inner(), t = raw.trim(); return t ? (/^\s/.test(raw) ? ' ' : '') + mark + t + mark + (/\s$/.test(raw) ? ' ' : '') : raw; };
    if (/^h[1-6]$/.test(tag)) return '\n\n' + '#'.repeat(Number(tag[1])) + ' ' + inner().trim() + '\n\n';
    switch (tag) {
      case 'p': case 'div': case 'section': case 'figure': case 'dl': return '\n\n' + inner().trim() + '\n\n';
      case 'figcaption': case 'dt': case 'dd': return '\n' + inner().trim() + '\n';
      case 'br': return '  \n';
      case 'hr': return '\n\n---\n\n';
      case 'strong': case 'b': return wrap('**');
      case 'em': case 'i': return wrap('*');
      case 'code': return '`' + node.textContent + '`';
      case 'pre': return '\n\n```\n' + node.textContent.replace(/\n+$/, '') + '\n```\n\n';
      case 'blockquote': return '\n\n' + inner().trim().split('\n').map(l => '> ' + l).join('\n') + '\n\n';
      case 'a': { const t = inner().trim(); const h = abs(node.getAttribute('href') || ''); return t && /^https?:/.test(h) ? '[' + t + '](' + h + ')' : t; }
      case 'img': { const alt = (node.getAttribute('alt') || '').trim(); const src = abs(node.getAttribute('src') || ''); return /^https?:/.test(src) ? '![' + alt + '](' + src + ')' : alt; }
      case 'ul': case 'ol': {
        const items = Array.from(node.children).filter(c => c.tagName === 'LI');
        return '\n\n' + items.map((li, i) => (tag === 'ol' ? (i + 1) + '. ' : '- ') + md(li).trim().replace(/\n/g, '\n   ')).join('\n') + '\n\n';
      }
      case 'table': {
        const rows = Array.from(node.querySelectorAll('tr')).map(tr => Array.from(tr.children).map(c => squash(c.textContent).trim().replace(/\|/g, '\\|')));
        if (!rows.length) return '';
        const width = Math.max(...rows.map(r => r.length));
        const line = (r) => '| ' + Array.from({ length: width }, (_, i) => r[i] || '').join(' | ') + ' |';
        return '\n\n' + [line(rows[0]), '|' + ' --- |'.repeat(width), ...rows.slice(1).map(line)].join('\n') + '\n\n';
      }
      default: return inner();
    }
  }
  const markdown = md(copy).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  // The e-book copy: known tags only, links made absolute, nothing else kept.
  const KEEP = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'ul', 'ol', 'li', 'a', 'strong', 'b', 'em', 'i', 'code', 'pre', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'figure', 'figcaption', 'sup', 'sub', 'dl', 'dt', 'dd']);
  function clean(node) {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 8) { child.remove(); continue; }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toLowerCase();
      if (tag === 'img') { child.replaceWith(document.createTextNode((child.getAttribute('alt') || '').trim())); continue; }
      clean(child);
      if (!KEEP.has(tag)) { child.replaceWith(...Array.from(child.childNodes)); continue; }
      const href = tag === 'a' ? abs(child.getAttribute('href') || '') : '';
      for (const a of Array.from(child.attributes)) child.removeAttribute(a.name);
      if (/^https?:/.test(href)) child.setAttribute('href', href);
    }
  }
  clean(copy);
  const xs = new XMLSerializer();
  const xhtml = Array.from(copy.childNodes).map(n => xs.serializeToString(n)).join('')
    .replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');
  return { title: document.title || location.hostname, url: location.href, markdown, xhtml };
}

const PageExport = {
  _webview() {
    const wv = (typeof WebviewManager !== 'undefined') ? WebviewManager.getActiveWebview() : null;
    if (!wv) throw new Error('No page is open');
    return wv;
  },

  _tab() { return (typeof TabManager !== 'undefined' && TabManager.getActiveTab) ? TabManager.getActiveTab() : null; },

  // ---- keep it ----------------------------------------------------------
  async savePage(format) {
    const wv = this._webview();
    let wcId = null;
    try { wcId = wv.getWebContentsId(); } catch {}
    if (typeof wcId !== 'number' || wcId < 0) throw new Error('This page has not finished opening yet');
    const tab = this._tab();
    const r = await window.vex.pageSave(wcId, format, (tab && tab.title) || '');
    if (!r || r.cancelled) return null;
    if (!r.ok) throw new Error(r.error || 'Could not save the page');
    window.showToast?.((format === 'pdf' ? 'Saved as PDF — ' : 'Saved as one file — ') + String(r.path).split(/[\\/]/).pop());
    return r;
  },

  // ---- keep its words ------------------------------------------------------
  // The readable part of the page — the article, not the menus, headers,
  // footers and forms around it — as Markdown (for notes and editors) or as an
  // EPUB (for an e-reader). Runs inside the page, on a copy of it.
  async readable() {
    const r = await window.vexGuestEval(this._webview(), '(' + vexReadablePage.toString() + ')()');
    if (!r || !r.markdown.trim()) throw new Error('There is no readable text on this page');
    return r;
  },

  async saveMarkdown() {
    const r = await this.readable();
    const head = '# ' + r.title + '\n\nFrom <' + r.url + '>, saved ' + new Date().toDateString() + '.\n\n';
    const res = await window.vex.saveTextFile(this._fileName(r.title, 'md'), head + r.markdown + '\n', 'md');
    if (!res || res.cancelled) return null;
    if (!res.ok) throw new Error(res.error || 'The file was not saved');
    window.showToast?.('Saved as Markdown — ' + String(res.path).split(/[\\/]/).pop());
    return res;
  },

  async saveEpub() {
    const r = await this.readable();
    const res = await window.vex.saveEpub({ title: r.title, url: r.url, xhtml: r.xhtml });
    if (!res || res.cancelled) return null;
    if (!res.ok) throw new Error(res.error || 'The book was not saved');
    window.showToast?.('Saved as an e-book — ' + String(res.path).split(/[\\/]/).pop());
    return res;
  },

  _fileName(title, ext) {
    return (String(title || 'page').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100) || 'page') + '.' + ext;
  },

  // ---- open a list -----------------------------------------------------
  // Pull every address out of whatever was pasted: one per line, a comma
  // list, a chat message with links in it, bare "example.com/page". Only
  // http(s) comes out the other end.
  parseUrls(text) {
    const found = [];
    const seen = new Set();
    const tokens = String(text || '').split(/[\s,;<>"'()[\]]+/);
    for (let t of tokens) {
      t = t.replace(/[.,;:!?]+$/, '');
      if (!t) continue;
      let candidate = null;
      if (/^https?:\/\//i.test(t)) candidate = t;
      else if (/^www\./i.test(t) || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(t)) candidate = 'https://' + t;
      if (!candidate) continue;
      let u;
      try { u = new URL(candidate); } catch { continue; }
      if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) continue;
      const key = u.href;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(key);
    }
    return found;
  },

  async openMany(text) {
    const urls = this.parseUrls(text);
    if (!urls.length) throw new Error('There are no web addresses in that');
    if (urls.length > 50) throw new Error('That is ' + urls.length + ' addresses — Vex opens at most 50 at once');
    if (urls.length > 8 && !(await vexConfirm({ title: 'Open ' + urls.length + ' tabs?', message: urls.slice(0, 6).join('\n') + '\n…and ' + (urls.length - 6) + ' more', okLabel: 'Open them' }))) return 0;
    // The first becomes the tab you are looking at; the rest wait behind it.
    urls.forEach((u, i) => { try { TabManager.createTab(u, i === 0); } catch {} });
    window.showToast?.('Opened ' + urls.length + ' tab' + (urls.length === 1 ? '' : 's'));
    return urls.length;
  },

  async promptOpenMany() {
    let clip = '';
    try { clip = await navigator.clipboard.readText(); } catch {}
    const fromClip = this.parseUrls(clip);
    const text = await vexPrompt({
      title: 'Open a list of links',
      message: fromClip.length ? 'Found ' + fromClip.length + ' on your clipboard. Paste something else to replace them.' : 'Paste them in any form — one per line, separated by commas, or inside a message.',
      label: 'Links', value: fromClip.join(' '), okLabel: 'Open',
    });
    if (text == null) return 0;
    return this.openMany(text);
  },

  // ---- its images ---------------------------------------------------------
  // Runs in the page. The largest source a <picture>/srcset offers, CSS
  // background images, and nothing tiny: a 1-pixel tracker is not a picture.
  IMAGE_SCRIPT: `(() => {
    const out = new Map();
    const add = (src, w, h, alt) => {
      try {
        const u = new URL(src, location.href);
        if (!/^https?:$/.test(u.protocol)) return;
        if (w && h && (w < 48 || h < 48)) return;
        const key = u.href;
        const prev = out.get(key);
        if (!prev || (w * h) > (prev.w * prev.h)) out.set(key, { src: key, w: w || 0, h: h || 0, alt: String(alt || '').slice(0, 140) });
      } catch (e) {}
    };
    const best = (img) => {
      const set = img.getAttribute('srcset') || '';
      let pick = img.currentSrc || img.src, width = 0;
      for (const part of set.split(',')) {
        const [u, d] = part.trim().split(/\\s+/);
        const n = parseFloat(d || '') || 0;
        if (u && n > width) { width = n; pick = u; }
      }
      return pick;
    };
    for (const img of document.images) add(best(img), img.naturalWidth, img.naturalHeight, img.alt);
    for (const el of document.querySelectorAll('[style*="background"]')) {
      const m = /url\\((['"]?)(.*?)\\1\\)/.exec(el.style.backgroundImage || '');
      if (m) { const r = el.getBoundingClientRect(); add(m[2], Math.round(r.width), Math.round(r.height), ''); }
    }
    const og = document.querySelector('meta[property="og:image"]');
    if (og && og.content) add(og.content, 0, 0, 'Preview image');
    return [...out.values()].slice(0, 400);
  })()`,

  async images() {
    const found = await window.vexGuestEval(this._webview(), this.IMAGE_SCRIPT);
    return Array.isArray(found) ? found.sort((a, b) => (b.w * b.h) - (a.w * a.h)) : [];
  },

  async openImages() {
    const wv = this._webview();
    const list = await this.images();
    if (!list.length) throw new Error('There are no pictures on this page');
    let wcId = null;
    try { wcId = wv.getWebContentsId(); } catch {}
    const save = (src) => window.vex?.mediaDownload?.(wcId, src);

    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const { overlay, body, head, close } = this._sheet('Images on this page', 'vex-img-overlay');
    head.insertAdjacentHTML('beforeend', `<span style="font-size:11.5px;color:var(--text-muted)">${list.length}</span><button data-all type="button" style="font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer">Save all</button>`);
    body.style.cssText += ';display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;padding:10px';
    for (const img of list) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.title = (img.alt ? img.alt + ' — ' : '') + (img.w ? img.w + '×' + img.h + ' — ' : '') + 'click to save';
      cell.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:6px;border:1px solid var(--border);border-radius:8px;background:var(--surface);cursor:pointer;text-align:left';
      cell.innerHTML = `<img src="${esc(img.src)}" alt="" loading="lazy" referrerpolicy="no-referrer" style="width:100%;height:96px;object-fit:contain;border-radius:5px;background:var(--bg)" data-image-fallback="hide">
        <span style="font-size:10.5px;color:var(--text-muted);font-variant-numeric:tabular-nums">${img.w ? esc(img.w + '×' + img.h) : '&nbsp;'}</span>`;
      cell.addEventListener('click', () => { save(img.src); window.showToast?.('Saving — see Downloads'); });
      body.appendChild(cell);
    }
    head.querySelector('[data-all]').addEventListener('click', async () => {
      if (list.length > 10 && !(await vexConfirm({ title: 'Save ' + list.length + ' images?', message: 'Each one goes to your Downloads folder.', okLabel: 'Save them' }))) return;
      list.forEach(i => save(i.src));
      window.showToast?.('Saving ' + list.length + ' images — see Downloads');
      close();
    });
    return overlay;
  },

  // ---- cite it ----------------------------------------------------------
  // What the page says about itself. Scholarly sites publish citation_* tags
  // (Google Scholar reads the same ones); news sites use Open Graph and
  // article:*; JSON-LD covers most of the rest.
  CITE_SCRIPT: `(() => {
    const meta = (sel) => { const e = document.querySelector(sel); return e ? String(e.getAttribute('content') || '').trim() : ''; };
    const metas = (sel) => [...document.querySelectorAll(sel)].map(e => String(e.getAttribute('content') || '').trim()).filter(Boolean);
    let ld = {};
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        let j = JSON.parse(s.textContent);
        if (Array.isArray(j)) j = j[0];
        if (j && j['@graph']) j = j['@graph'].find(x => /Article|Posting|Report|Scholarly/i.test(String(x['@type']))) || j['@graph'][0];
        if (j && /Article|Posting|Report|Scholarly|WebPage/i.test(String(j['@type']))) { ld = j; break; }
      } catch (e) {}
    }
    const ldAuthors = [].concat(ld.author || []).map(a => typeof a === 'string' ? a : (a && a.name) || '').filter(Boolean);
    return {
      title: meta('meta[name="citation_title"]') || meta('meta[property="og:title"]') || ld.headline || document.title,
      authors: metas('meta[name="citation_author"]').length ? metas('meta[name="citation_author"]')
        : ldAuthors.length ? ldAuthors : [meta('meta[name="author"]') || meta('meta[property="article:author"]')].filter(a => a && !/^https?:/.test(a)),
      date: meta('meta[name="citation_publication_date"]') || meta('meta[name="citation_date"]') || meta('meta[property="article:published_time"]') || ld.datePublished || '',
      site: meta('meta[name="citation_journal_title"]') || meta('meta[property="og:site_name"]') || (ld.publisher && ld.publisher.name) || location.hostname.replace(/^www\\./, ''),
      doi: meta('meta[name="citation_doi"]'),
      url: meta('link[rel="canonical"]') || location.href,
    };
  })()`,

  async pageMeta() {
    const m = await window.vexGuestEval(this._webview(), this.CITE_SCRIPT);
    return m || {};
  },

  // "Jane Q. Smith" → { last: 'Smith', first: 'Jane Q.' }; "Smith, Jane" too.
  _name(full) {
    const s = String(full || '').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    if (s.includes(',')) { const [last, first] = s.split(',').map(x => x.trim()); return { last, first: first || '' }; }
    const parts = s.split(' ');
    if (parts.length === 1) return { last: s, first: '' };       // an organisation, or one name
    return { last: parts.pop(), first: parts.join(' ') };
  },
  _initials(first) { return String(first || '').split(/[\s-]+/).filter(Boolean).map(p => p[0].toUpperCase() + '.').join(' '); },

  _date(raw) {
    const d = raw ? new Date(raw) : null;
    return d && !isNaN(d) ? d : null;
  },

  cite(meta, style, today = new Date()) {
    const m = meta || {};
    const title = String(m.title || '').trim() || 'Untitled';
    const site = String(m.site || '').trim();
    const url = m.doi ? 'https://doi.org/' + m.doi : String(m.url || '');
    const names = (Array.isArray(m.authors) ? m.authors : []).map(a => this._name(a)).filter(Boolean);
    const d = this._date(m.date);
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const mShort = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
    const year = d ? d.getFullYear() : null;
    const accessed = today;
    // An author list ends with a full stop — one, even when the name already
    // ends in an initial ("Smith, Jane Q." not "Smith, Jane Q..").
    const stop = (s) => s ? s.replace(/\.\s*$/, '') + '. ' : '';

    if (style === 'apa') {
      // Smith, J. Q., & Doe, A. (2024, March 3). Title. Site. URL
      const who = names.length === 0 ? '' : names.length === 1 ? names[0].last + (names[0].first ? ', ' + this._initials(names[0].first) : '')
        : names.slice(0, -1).map(n => n.last + (n.first ? ', ' + this._initials(n.first) : '')).join(', ') + ', & ' + (n => n.last + (n.first ? ', ' + this._initials(n.first) : ''))(names[names.length - 1]);
      const when = d ? '(' + year + ', ' + months[d.getMonth()] + ' ' + d.getDate() + ')' : '(n.d.)';
      // With no author, APA moves the title to the front.
      return who ? `${who} ${when}. ${title}. ${site ? site + '. ' : ''}${url}` : `${title}. ${when}. ${site ? site + '. ' : ''}${url}`;
    }
    if (style === 'mla') {
      // Smith, Jane, and Alan Doe. "Title." Site, 3 Mar. 2024, URL. Accessed 19 Sept. 2026.
      const full = (n) => n.first ? n.last + ', ' + n.first : n.last;
      const who = names.length === 0 ? '' : names.length === 1 ? stop(full(names[0]))
        : names.length === 2 ? stop(full(names[0]) + ', and ' + (names[1].first ? names[1].first + ' ' : '') + names[1].last)
          : full(names[0]) + ', et al. ';
      const when = d ? d.getDate() + ' ' + mShort[d.getMonth()] + ' ' + year + ', ' : '';
      return `${who}"${title}." ${site ? site + ', ' : ''}${when}${url.replace(/^https?:\/\//, '')}. Accessed ${accessed.getDate()} ${mShort[accessed.getMonth()]} ${accessed.getFullYear()}.`;
    }
    if (style === 'harvard') {
      // Smith, J. and Doe, A. (2024) Title. Available at: URL (Accessed: 19 September 2026).
      const one = (n) => n.last + (n.first ? ', ' + this._initials(n.first) : '');
      const who = names.length === 0 ? site : names.length === 1 ? one(names[0]) : names.slice(0, -1).map(one).join(', ') + ' and ' + one(names[names.length - 1]);
      return `${who} (${year || 'no date'}) ${title}. Available at: ${url} (Accessed: ${accessed.getDate()} ${months[accessed.getMonth()]} ${accessed.getFullYear()}).`;
    }
    if (style === 'chicago') {
      // Smith, Jane, and Alan Doe. "Title." Site. March 3, 2024. URL.
      const who = names.length === 0 ? '' : names.length === 1 ? stop(names[0].first ? names[0].last + ', ' + names[0].first : names[0].last)
        : stop((names[0].first ? names[0].last + ', ' + names[0].first : names[0].last) + ', ' + names.slice(1, -1).map(n => (n.first ? n.first + ' ' : '') + n.last).map(x => x + ', ').join('') + 'and ' + (names[names.length - 1].first ? names[names.length - 1].first + ' ' : '') + names[names.length - 1].last);
      const when = d ? months[d.getMonth()] + ' ' + d.getDate() + ', ' + year + '. ' : '';
      return `${who}"${title}." ${site ? site + '. ' : ''}${when}${url}.`;
    }
    if (style === 'bibtex') {
      const key = ((names[0] && names[0].last) || site || 'web').toLowerCase().replace(/[^a-z0-9]/g, '') + (year || '');
      const esc = (s) => String(s).replace(/([{}%&$#_])/g, '\\$1');
      const lines = [
        '@misc{' + (key || 'web') + ',',
        names.length ? '  author = {' + esc(names.map(n => n.first ? n.last + ', ' + n.first : '{' + n.last + '}').join(' and ')) + '},' : null,
        '  title = {' + esc(title) + '},',
        site ? '  howpublished = {' + esc(site) + '},' : null,
        year ? '  year = {' + year + '},' : null,
        m.doi ? '  doi = {' + esc(m.doi) + '},' : null,
        '  url = {' + url + '},',
        // The local date: toISOString() is UTC, which east of Greenwich
        // turns a citation made after midnight into yesterday's.
        '  note = {Accessed ' + accessed.getFullYear() + '-' + String(accessed.getMonth() + 1).padStart(2, '0') + '-' + String(accessed.getDate()).padStart(2, '0') + '}',
        '}',
      ];
      return lines.filter(Boolean).join('\n');
    }
    throw new Error('Unknown citation style "' + style + '"');
  },

  STYLES: [['apa', 'APA 7'], ['mla', 'MLA 9'], ['harvard', 'Harvard'], ['chicago', 'Chicago'], ['bibtex', 'BibTeX']],
  STYLE_KEY: 'vex.citeStyle',

  async openCitation() {
    const meta = await this.pageMeta();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    let style = 'apa';
    try { style = localStorage.getItem(this.STYLE_KEY) || 'apa'; } catch {}
    const { overlay, body, close } = this._sheet('Cite this page', 'vex-cite-overlay');
    const draw = () => {
      const text = this.cite(meta, style);
      body.innerHTML = `
        <div style="display:flex;gap:6px;flex-wrap:wrap;padding:10px 12px 4px">${this.STYLES.map(([id, label]) =>
          `<button data-style="${id}" type="button" style="font-size:11.5px;padding:3px 10px;border-radius:14px;cursor:pointer;border:1px solid ${id === style ? 'var(--primary)' : 'var(--border)'};background:${id === style ? 'var(--primary)' : 'none'};color:${id === style ? '#fff' : 'var(--text)'}">${label}</button>`).join('')}</div>
        <pre data-cite style="margin:8px 12px;padding:10px 12px;white-space:pre-wrap;word-break:break-word;font:13px/1.55 var(--font-ui, inherit);background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);user-select:text">${esc(text)}</pre>
        <div style="display:flex;align-items:center;gap:8px;padding:0 12px 12px">
          <div style="flex:1;font-size:11px;color:var(--text-muted)">${(meta.authors || []).length ? '' : 'The page names no author, so none is given — check before you hand it in.'}</div>
          <button data-copy type="button" style="font-size:12px;padding:5px 12px;border-radius:7px;border:none;background:var(--primary);color:#fff;cursor:pointer">Copy</button>
        </div>`;
      body.querySelectorAll('[data-style]').forEach(b => b.addEventListener('click', () => {
        style = b.dataset.style;
        try { localStorage.setItem(this.STYLE_KEY, style); } catch {}
        draw();
      }));
      body.querySelector('[data-copy]').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(text); window.showToast?.('Citation copied'); close(); }
        catch { window.showToast?.('Could not copy that', 'error'); }
      });
    };
    draw();
    return overlay;
  },

  // ---- a sheet to show things in ------------------------------------------
  _sheet(title, cls) {
    document.querySelector('.' + cls)?.remove();
    const overlay = document.createElement('div');
    overlay.className = cls;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.38);display:grid;place-items:start center;padding-top:8vh';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-label="${window.escapeHtml(title)}"
           style="width:min(680px,93vw);max-height:80vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45));overflow:hidden">
        <div data-head style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)">
          <div style="flex:1;font-size:13.5px;font-weight:650;color:var(--text)">${window.escapeHtml(title)}</div>
        </div>
        <div data-body style="overflow-y:auto"></div>
      </div>`;
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => {
      if (!overlay.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
      if (e.key === 'Escape' && !document.querySelector('.vex-dialog-overlay')) { e.preventDefault(); close(); }
    };
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    return { overlay, head: overlay.querySelector('[data-head]'), body: overlay.querySelector('[data-body]'), close };
  },
};

if (typeof window !== 'undefined') window.PageExport = PageExport;
if (typeof module !== 'undefined' && module.exports) module.exports = { PageExport, vexReadablePage };
