// === Vex Reading Mode ===
//
// Rebuilds the current page as a plain article document and loads it into the
// same tab, remembering the URL it replaced so exiting can put it back.
//
// Everything that crosses from the page into the reading document is UNTRUSTED:
// the title, the headings, the body text, the links. It is extracted as plain
// data (text runs, link targets, image addresses) and rebuilt here, never
// spliced into markup as-is — a page whose <title> was
// `Bread &amp; Butter <script>…</script>` used to land in the reading document
// as live markup.

// ---- Runs INSIDE the page (it is stringified and sent over) ---------------
//
// Finds the article and walks it into plain data. Scoring follows the idea of
// Firefox's Readability: paragraphs vote for the containers they sit in, so
// the box that holds the most prose wins and the sidebars, menus and comment
// threads around it are left out. The old extractor took <article>, <main> or
// the whole <body>, so a news page without <article> came out with its
// "Trending" sidebar first and a blog with its menu and archive list
// (found 2026-10-03). It also kept text only, so every link was dead and
// every table was dropped.
function vexReaderPageLib() {
  const NEG = /(?:^|[\s_-])(?:comments?|disqus|respond|sidebar|side-bar|widget|footer|masthead|menu|nav|navbar|navbox|navigation|related|recommend(?:ed|ations)?|share|sharing|social|sponsor(?:ed)?|promo|advert(?:isement)?|ads?|banner|breadcrumbs?|cookie|consent|newsletter|subscribe|popup|modal|toc|editsection|noprint|catlinks|tags|pagination|pager|outbrain|taboola|more-from|clap|skip-link|sr-only|visually-hidden)(?:[\s_-]|$)/i;
  const POS = /(?:^|[\s_-])(?:article|body|content|entry|main|post|story|text|prose|markdown|mw-parser-output|blog)(?:[\s_-]|$)/i;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'NAV', 'ASIDE', 'FOOTER', 'DIALOG', 'AUDIO', 'VIDEO', 'MAP', 'LINK', 'META', 'MATH']);
  const BLOCK = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE', 'UL', 'OL', 'DL', 'TABLE', 'FIGURE', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'HR', 'DETAILS', 'SUMMARY', 'ADDRESS', 'FIELDSET', 'CENTER', 'LI', 'DD', 'DT', 'FIGCAPTION', 'TR', 'TD', 'TH', 'TBODY', 'THEAD', 'TFOOT', 'CAPTION', 'HGROUP']);
  const ROLES = /^(navigation|complementary|banner|contentinfo|dialog|alertdialog|search|menu|menubar|toolbar|tablist)$/;
  const tagOf = (el) => String(el.tagName || '').toUpperCase();
  const cls = (el) => ((typeof el.className === 'string' ? el.className : (el.getAttribute && el.getAttribute('class')) || '') + ' ' + (el.id || ''));
  const collapse = (s) => String(s || '').replace(/\s+/g, ' ');
  const textLen = (el) => collapse(el.textContent).trim().length;

  function hidden(el) {
    if (el.hidden || (el.getAttribute && el.getAttribute('aria-hidden') === 'true')) return true;
    let cs = null;
    try { cs = getComputedStyle(el); } catch { return false; }
    return !!cs && (cs.display === 'none' || cs.visibility === 'hidden');
  }
  function skip(el) {
    if (SKIP.has(tagOf(el))) return true;
    const role = el.getAttribute && el.getAttribute('role');
    if (role && ROLES.test(role)) return true;
    const c = cls(el);
    if (NEG.test(c) && !POS.test(c)) return true;
    return hidden(el);
  }
  function linkDensity(el) {
    const t = textLen(el);
    if (!t) return 0;
    let a = 0;
    for (const x of el.querySelectorAll('a')) a += textLen(x);
    return Math.min(1, a / t);
  }
  // A block that is mostly links (a list of "related stories", a tag cloud)
  // is navigation, however it is labelled. A short "See also" list survives.
  function linkHeavy(el) {
    if (el.querySelectorAll('a').length < 4) return false;
    return linkDensity(el) > 0.6;
  }

  function findRoot(doc) {
    const d = doc || document;
    const marked = d.querySelector('[itemprop="articleBody"], .mw-parser-output');
    if (marked && textLen(marked) > 300) return marked;
    const scores = new Map();
    const add = (el, s) => { if (el && el.nodeType === 1 && el !== d.documentElement) scores.set(el, (scores.get(el) || 0) + s); };
    let n = 0;
    for (const p of (d.body ? d.body.querySelectorAll('p, pre, td, blockquote') : [])) {
      if (++n > 6000) break;
      const t = collapse(p.textContent).trim();
      if (t.length < 25) continue;
      const s = 1 + (t.split(/[,，、]/).length - 1) + Math.min(3, Math.floor(t.length / 100));
      const a = p.parentElement, b = a && a.parentElement, c = b && b.parentElement;
      add(a, s); add(b, s / 2); add(c, s / 3);
    }
    let best = null, bestScore = 0;
    for (const [el, raw] of scores) {
      const c = cls(el);
      let s = raw;
      if (POS.test(c)) s += 25;
      if (NEG.test(c) && !POS.test(c)) s -= 25;
      const tag = tagOf(el);
      if (tag === 'ARTICLE' || tag === 'MAIN') s += 10;
      s *= 1 - linkDensity(el);
      if (s > bestScore) { best = el; bestScore = s; }
    }
    if (!best || textLen(best) < 140) return d.querySelector('article') || d.querySelector('[role="main"]') || d.querySelector('main') || d.body;
    // An article split across sibling boxes (an intro block, then the body).
    const parent = best.parentElement;
    if (parent && parent !== d.body) {
      for (const sib of parent.children) {
        if (sib !== best && (scores.get(sib) || 0) >= Math.max(10, bestScore * 0.3)) return parent;
      }
    }
    return best;
  }

  const absUrl = (u) => { try { return new URL(u, document.baseURI).href; } catch { return ''; } };
  function imgSrc(img) {
    let s = img.currentSrc || img.getAttribute('src') || '';
    const lazy = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original');
    if (lazy && (!s || (/^data:image\//i.test(s) && s.length < 600))) s = lazy;
    if (!s) {
      const set = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
      s = (set.split(',')[0] || '').trim().split(/\s+/)[0] || '';
    }
    s = /^data:/i.test(s) ? s : absUrl(s);
    return /^(https?:|data:image\/)/i.test(s) ? s : '';
  }
  function tinyImg(img) {
    const w = img.naturalWidth || Number(img.getAttribute('width')) || 0;
    const h = img.naturalHeight || Number(img.getAttribute('height')) || 0;
    return (w > 0 && w < 32) || (h > 0 && h < 32);
  }
  function isBlock(el) {
    const tag = tagOf(el);
    if (BLOCK.has(tag) || SKIP.has(tag)) return true;
    if (tag.includes('-')) { for (const c of el.children) if (isBlock(c)) return true; }
    return false;
  }

  let budget = 600000;
  const hasText = (runs) => runs.some(r => (typeof r.t === 'string' && r.t.trim()) || r.code || r.img || (r.a && hasText(r.c)) || (r.b && hasText(r.b)) || (r.i && hasText(r.i)) || (r.sup && hasText(r.sup)) || (r.sub && hasText(r.sub)));

  function runsOf(nodes, out) {
    for (const ch of nodes) {
      if (budget <= 0) return out;
      if (ch.nodeType === 3) { const t = collapse(ch.data); if (t) { out.push({ t }); budget -= t.length; } continue; }
      if (ch.nodeType !== 1) continue;
      const tag = tagOf(ch);
      if (skip(ch)) continue;
      if (tag === 'BR') { out.push({ br: 1 }); continue; }
      if (tag === 'IMG' || tag === 'PICTURE') {
        const im = tag === 'IMG' ? ch : ch.querySelector('img');
        const src = im && imgSrc(im);
        if (src && !tinyImg(im)) out.push({ img: src, alt: collapse(im.getAttribute('alt')).trim().slice(0, 300) });
        continue;
      }
      if (tag === 'A') {
        const raw = ch.getAttribute('href') || '';
        const href = raw && !raw.startsWith('#') ? absUrl(raw) : '';
        const inner = runsOf(ch.childNodes, []);
        if (/^(https?:|mailto:)/i.test(href)) out.push({ a: href, c: inner }); else out.push(...inner);
        continue;
      }
      if (tag === 'B' || tag === 'STRONG') { out.push({ b: runsOf(ch.childNodes, []) }); continue; }
      if (tag === 'I' || tag === 'EM' || tag === 'CITE' || tag === 'DFN') { out.push({ i: runsOf(ch.childNodes, []) }); continue; }
      if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP' || tag === 'TT' || tag === 'VAR') {
        const t = ch.textContent || '';
        if (t) { out.push({ code: t.slice(0, 20000) }); budget -= t.length; }
        continue;
      }
      if (tag === 'SUP' || tag === 'SUB') { out.push({ [tag.toLowerCase()]: runsOf(ch.childNodes, []) }); continue; }
      // Spans and the like; a block that turns up inside inline content
      // (a <div> in a table cell) is kept on a line of its own.
      const inner = runsOf(ch.childNodes, []);
      if (isBlock(ch) && inner.length) { out.push(...inner, { br: 1 }); } else out.push(...inner);
    }
    return out;
  }
  const runs = (el) => runsOf(el.childNodes, []);

  function flow(el, out, depth) {
    let pending = [];
    const flush = () => {
      if (!pending.length) return;
      const r = runsOf(pending, []);
      pending = [];
      while (r.length && r[r.length - 1].br) r.pop();
      if (hasText(r)) out.push({ tag: 'P', runs: r });
    };
    for (const ch of el.childNodes) {
      if (out.length >= 3000 || budget <= 0) break;
      if (ch.nodeType === 1 && isBlock(ch)) { flush(); block(ch, out, depth + 1); } else pending.push(ch);
    }
    flush();
  }

  function block(el, out, depth) {
    if (out.length >= 3000 || budget <= 0 || depth > 60) return;
    if (skip(el)) return;
    const tag = tagOf(el);
    if (/^H[1-6]$/.test(tag)) {
      const r = runs(el);
      if (hasText(r)) out.push({ tag: 'H' + Math.min(4, Math.max(2, Number(tag[1]))), runs: r });
      return;
    }
    if (tag === 'P' || tag === 'ADDRESS' || tag === 'SUMMARY' || tag === 'FIGCAPTION' || tag === 'CAPTION') {
      for (const c of el.children) if (isBlock(c)) { flow(el, out, depth); return; }
      const r = runs(el);
      if (hasText(r)) out.push({ tag: 'P', runs: r });
      return;
    }
    if (tag === 'PRE') {
      const t = (el.textContent || '').replace(/\s+$/, '');
      if (t.trim()) { out.push({ tag: 'PRE', text: t.slice(0, 100000) }); budget -= t.length; }
      return;
    }
    if (tag === 'BLOCKQUOTE') {
      const inner = [];
      flow(el, inner, depth);
      if (inner.length) out.push({ tag: 'BLOCKQUOTE', children: inner });
      return;
    }
    if (tag === 'UL' || tag === 'OL') {
      if (linkHeavy(el)) return;
      const items = [];
      for (const li of el.children) {
        if (tagOf(li) !== 'LI' || skip(li)) continue;
        const inner = [];
        flow(li, inner, depth);
        if (inner.length) items.push(inner);
      }
      if (items.length) out.push({ tag, items });
      return;
    }
    if (tag === 'DL') {
      const items = [];
      for (const c of el.children) {
        const t = tagOf(c);
        if ((t !== 'DT' && t !== 'DD') || skip(c)) continue;
        const inner = [];
        flow(c, inner, depth);
        if (inner.length) items.push({ dt: t === 'DT', c: inner });
      }
      if (items.length) out.push({ tag: 'DL', items });
      return;
    }
    if (tag === 'TABLE') {
      if (linkHeavy(el)) return;
      // A table used for page layout holds tables or whole articles: read
      // through it rather than drawing a grid around the text.
      if (el.querySelector('table')) { for (const cell of el.querySelectorAll('td')) if (cell.closest('table') === el) flow(cell, out, depth); return; }
      const rows = [];
      for (const tr of (el.rows || [])) {
        if (rows.length >= 400) break;
        if (skip(tr)) continue;
        const cells = [];
        for (const td of (tr.cells || [])) {
          if (cells.length >= 30) break;
          if (hidden(td)) continue;
          cells.push({ h: tagOf(td) === 'TH', c: runs(td), span: Math.min(20, Math.max(1, Number(td.colSpan) || 1)) });
        }
        if (cells.length) rows.push(cells);
      }
      const caption = el.caption && !skip(el.caption) ? runs(el.caption) : null;
      if (rows.length) out.push({ tag: 'TABLE', rows, caption });
      return;
    }
    if (tag === 'FIGURE') {
      const imgs = [];
      for (const im of el.querySelectorAll('img')) {
        if (imgs.length >= 10) break;
        const src = imgSrc(im);
        if (src && !tinyImg(im) && !hidden(im)) imgs.push({ img: src, alt: collapse(im.getAttribute('alt')).trim().slice(0, 300) });
      }
      if (!imgs.length) { flow(el, out, depth); return; }
      const fc = el.querySelector('figcaption');
      out.push({ tag: 'FIGURE', imgs, caption: fc && !skip(fc) ? runs(fc) : null });
      return;
    }
    if (tag === 'HR') { out.push({ tag: 'HR' }); return; }
    if (tag === 'TR' || tag === 'TD' || tag === 'TH' || tag === 'TBODY' || tag === 'THEAD' || tag === 'TFOOT') { flow(el, out, depth); return; }
    if (linkHeavy(el)) return;
    flow(el, out, depth);
  }

  function pickTitle() {
    const meta = (sel) => { const m = document.querySelector(sel); return m ? collapse(m.getAttribute('content')).trim() : ''; };
    const og = meta('meta[property="og:title"]');
    const docTitle = collapse(document.title).trim();
    const h1s = [...document.querySelectorAll('h1')].filter(h => !hidden(h)).map(h => collapse(h.textContent).trim()).filter(Boolean);
    const own = h1s.find(h => h.length > 2 && (docTitle.includes(h) || og.includes(h)));
    if (own) return own;
    if (og) return og;
    const parts = docTitle.split(/\s+[|\-–—·»:]\s+/).filter(Boolean);
    if (parts.length > 1) return parts.reduce((a, b) => (b.length > a.length ? b : a));
    return docTitle || h1s[0] || '';
  }
  function pickByline() {
    const m = document.querySelector('meta[name="author"]');
    if (m && m.getAttribute('content')) return collapse(m.getAttribute('content')).trim().slice(0, 200);
    const el = document.querySelector('[rel="author"], [itemprop="author"], .byline, .author');
    const t = el ? collapse(el.textContent).trim() : '';
    return t.length > 1 && t.length < 120 ? t : '';
  }

  function extract() {
    const root = findRoot(document);
    const blocks = [];
    if (root) flow(root, blocks, 0);
    const site = document.querySelector('meta[property="og:site_name"]');
    return {
      title: pickTitle(),
      byline: pickByline(),
      siteName: site ? collapse(site.getAttribute('content')).trim().slice(0, 120) : '',
      lang: (document.documentElement.getAttribute('lang') || '').slice(0, 20),
      dir: document.dir === 'rtl' || document.documentElement.getAttribute('dir') === 'rtl' ? 'rtl' : '',
      blocks,
      scrollY: Math.round(window.scrollY || 0),
    };
  }

  return { NEG, POS, collapse, hidden, skip, findRoot, extract };
}

const ReadingMode = {
  // tabId -> the URL reading mode replaced. Entries are dropped on exit and
  // when the tab goes away, so this cannot grow for the life of the window.
  _originalUrls: new Map(),
  // tabId -> how far down the page you were, so leaving the reader puts you
  // back there instead of at the top (found 2026-10-03).
  _scroll: new Map(),

  // Legacy block tags we are willing to rebuild from plain text.
  _ALLOWED: new Set(['H1', 'H2', 'H3', 'H4', 'P', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE']),

  PREFS_KEY: 'vex.readerPrefs',
  FONTS: {
    serif: "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif",
    sans: "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif",
    mono: "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace",
  },
  WIDTHS: { narrow: 560, medium: 700, wide: 900 },
  SPACING: { tight: 1.45, normal: 1.7, loose: 2 },
  THEMES: ['vex', 'light', 'sepia', 'dark'],
  DEFAULT_PREFS: { font: 'serif', size: 19, width: 'medium', spacing: 'normal', theme: 'vex' },

  // The page side, as source. Kept as a real function so it is linted and can
  // be run against fixtures in the tests.
  pageLibSource() { return vexReaderPageLib.toString(); },
  _extractScript() { return '(' + vexReaderPageLib.toString() + ')().extract()'; },

  _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  },

  // ---- preferences ----
  cleanPrefs(p) {
    const d = this.DEFAULT_PREFS;
    const o = (p && typeof p === 'object') ? p : {};
    const size = Math.round(Number(o.size));
    return {
      font: Object.prototype.hasOwnProperty.call(this.FONTS, o.font) ? o.font : d.font,
      size: Number.isFinite(size) ? Math.min(32, Math.max(14, size)) : d.size,
      width: Object.prototype.hasOwnProperty.call(this.WIDTHS, o.width) ? o.width : d.width,
      spacing: Object.prototype.hasOwnProperty.call(this.SPACING, o.spacing) ? o.spacing : d.spacing,
      theme: this.THEMES.includes(o.theme) ? o.theme : d.theme,
    };
  },
  prefs() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.PREFS_KEY) || 'null'); } catch { raw = null; }
    return this.cleanPrefs(raw);
  },
  savePrefs(p) {
    const clean = this.cleanPrefs(p);
    localStorage.setItem(this.PREFS_KEY, JSON.stringify(clean));
    return clean;
  },

  // The Vex theme's own colours for the "Vex" reader theme, read off the
  // chrome. Only plain colour values are taken: they go into a stylesheet.
  _vexColors() {
    const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%/]+\)|hsla?\([\d.,\s%/a-z]+\))$/i;
    let cs = null;
    try { cs = getComputedStyle(document.body || document.documentElement); } catch { cs = null; }
    const get = (name, fallback) => {
      const v = cs ? String(cs.getPropertyValue(name) || '').trim() : '';
      return COLOR.test(v) ? v : fallback;
    };
    const bg = get('--vex-bg-base', '#fdfcf9');
    return {
      bg,
      text: get('--vex-text-primary', '#1d1d1f'),
      muted: get('--vex-text-secondary', '#5f5f66'),
      link: get('--vex-text-accent', get('--vex-accent', '#1a56b8')),
      code: get('--vex-bg-deep', '#f0eee8'),
      border: get('--vex-border-subtle', '#dcd8ce'),
      accent: get('--vex-accent', '#1a56b8'),
      dark: this._isDark(bg),
    };
  },
  _isDark(color) {
    const m = /^#([0-9a-f]{6})/i.exec(color) || null;
    let r, g, b;
    if (m) { r = parseInt(m[1].slice(0, 2), 16); g = parseInt(m[1].slice(2, 4), 16); b = parseInt(m[1].slice(4, 6), 16); }
    else {
      const n = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(color);
      if (!n) return false;
      r = +n[1]; g = +n[2]; b = +n[3];
    }
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 128;
  },

  // ---- rendering ----
  _okHref(u) { return /^(https?:|mailto:)/i.test(String(u || '')); },
  _okImg(u) { return /^(https?:|data:image\/)/i.test(String(u || '')); },

  _runs(list, depth = 0) {
    if (!Array.isArray(list) || depth > 40) return '';
    let s = '';
    for (const x of list) {
      if (!x || typeof x !== 'object') continue;
      if (typeof x.t === 'string') s += this._esc(x.t);
      else if (x.br) s += '<br>';
      else if (typeof x.img === 'string') { if (this._okImg(x.img)) s += `<img src="${this._esc(x.img)}" alt="${this._esc(x.alt || '')}">`; }
      else if (typeof x.a === 'string') {
        const inner = this._runs(x.c, depth + 1);
        s += this._okHref(x.a) ? `<a href="${this._esc(x.a)}">${inner}</a>` : inner;
      }
      else if (Array.isArray(x.b)) s += `<strong>${this._runs(x.b, depth + 1)}</strong>`;
      else if (Array.isArray(x.i)) s += `<em>${this._runs(x.i, depth + 1)}</em>`;
      else if (typeof x.code === 'string') s += `<code>${this._esc(x.code)}</code>`;
      else if (Array.isArray(x.sup)) s += `<sup>${this._runs(x.sup, depth + 1)}</sup>`;
      else if (Array.isArray(x.sub)) s += `<sub>${this._runs(x.sub, depth + 1)}</sub>`;
    }
    return s;
  },

  // A list item or definition that is a single paragraph is drawn inline.
  _inner(blocks, depth) {
    if (Array.isArray(blocks) && blocks.length === 1 && blocks[0] && blocks[0].tag === 'P' && Array.isArray(blocks[0].runs)) return this._runs(blocks[0].runs);
    return this._render(blocks, depth + 1);
  },

  // Turn the extracted block list into markup. Blocks are plain data and are
  // escaped on the way in. The old shape ({ tag, text } and { tag: 'IMG', src })
  // is still understood.
  _render(blocks, depth = 0) {
    const out = [];
    if (!Array.isArray(blocks) || depth > 30) return '';
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;
      if (b.tag === 'IMG') {
        // Only http(s)/data images, and the URL is attribute-escaped.
        if (!this._okImg(b.src)) continue;
        out.push(`<img src="${this._esc(b.src)}" alt="">`);
        continue;
      }
      if (b.tag === 'HR') { out.push('<hr>'); continue; }
      if (b.tag === 'PRE' && typeof b.text === 'string' && !b.runs) {
        if (b.text.trim()) out.push(`<pre><code>${this._esc(b.text)}</code></pre>`);
        continue;
      }
      if (Array.isArray(b.runs)) {
        const tag = { H1: 'h2', H2: 'h2', H3: 'h3', H4: 'h4', P: 'p' }[b.tag];
        if (!tag) continue;
        const inner = this._runs(b.runs);
        if (inner.replace(/<br>/g, '').trim()) out.push(`<${tag}>${inner}</${tag}>`);
        continue;
      }
      if (b.tag === 'BLOCKQUOTE' && Array.isArray(b.children)) { out.push(`<blockquote>${this._render(b.children, depth + 1)}</blockquote>`); continue; }
      if ((b.tag === 'UL' || b.tag === 'OL') && Array.isArray(b.items)) {
        const tag = b.tag.toLowerCase();
        out.push(`<${tag}>${b.items.map(it => `<li>${this._inner(it, depth)}</li>`).join('')}</${tag}>`);
        continue;
      }
      if (b.tag === 'DL' && Array.isArray(b.items)) {
        out.push(`<dl>${b.items.map(it => (it && it.dt) ? `<dt>${this._inner(it.c, depth)}</dt>` : `<dd>${this._inner(it && it.c, depth)}</dd>`).join('')}</dl>`);
        continue;
      }
      if (b.tag === 'TABLE' && Array.isArray(b.rows)) {
        const cap = Array.isArray(b.caption) && b.caption.length ? `<caption>${this._runs(b.caption)}</caption>` : '';
        const rows = b.rows.map(r => '<tr>' + (Array.isArray(r) ? r : []).map(c => {
          const t = c && c.h ? 'th' : 'td';
          const span = Math.min(20, Math.max(1, Math.round(Number(c && c.span) || 1)));
          return `<${t}${span > 1 ? ` colspan="${span}"` : ''}>${this._runs(c && c.c)}</${t}>`;
        }).join('') + '</tr>').join('');
        out.push(`<div class="vr-table" tabindex="0"><table>${cap}<tbody>${rows}</tbody></table></div>`);
        continue;
      }
      if (b.tag === 'FIGURE' && Array.isArray(b.imgs)) {
        const imgs = b.imgs.filter(i => i && this._okImg(i.img)).map(i => `<img src="${this._esc(i.img)}" alt="${this._esc(i.alt || '')}">`).join('');
        if (!imgs) continue;
        const cap = Array.isArray(b.caption) && b.caption.length ? `<figcaption>${this._runs(b.caption)}</figcaption>` : '';
        out.push(`<figure>${imgs}${cap}</figure>`);
        continue;
      }
      // Legacy plain-text blocks.
      if (!this._ALLOWED.has(b.tag)) continue;
      const text = String(b.text || '').trim();
      if (!text) continue;
      const tag = b.tag.toLowerCase();
      out.push(`<${tag}>${this._esc(text)}</${tag}>`);
    }
    return out.join('');
  },

  // Plain text of the blocks, for the word count.
  _plain(blocks) {
    const parts = [];
    const runs = (r) => { for (const x of (r || [])) { if (!x) continue; if (typeof x.t === 'string') parts.push(x.t); else if (typeof x.code === 'string') parts.push(x.code); else runs(x.c || x.b || x.i || x.sup || x.sub); } };
    const walk = (list) => {
      for (const b of (list || [])) {
        if (!b) continue;
        if (typeof b.text === 'string') parts.push(b.text);
        if (b.runs) runs(b.runs);
        if (b.children) walk(b.children);
        if (b.items) for (const it of b.items) walk(Array.isArray(it) ? it : (it && it.c));
        if (b.rows) for (const r of b.rows) for (const c of (r || [])) runs(c && c.c);
        if (b.caption) runs(b.caption);
        parts.push(' ');
      }
    };
    walk(blocks);
    return parts.join(' ');
  },

  // The article's own title is drawn once, at the top: the copy the page
  // repeats as its first heading is dropped (it was shown twice).
  _dropTitleHeading(blocks, title) {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const want = norm(title);
    if (!want || !Array.isArray(blocks)) return blocks;
    for (let i = 0; i < Math.min(4, blocks.length); i++) {
      const b = blocks[i];
      if (!b || !/^H[1-4]$/.test(b.tag)) continue;
      const text = Array.isArray(b.runs) ? norm(this._plain([b])) : norm(b.text);
      if (text === want) return blocks.slice(0, i).concat(blocks.slice(i + 1));
    }
    return blocks;
  },

  _icon(name) { return (typeof VexIcons !== 'undefined' && VexIcons.svg) ? VexIcons.svg(name, { size: 16 }) : ''; },

  _css(colors) {
    const c = colors;
    return `
*{box-sizing:border-box}
:root{--vr-font:${this.FONTS.serif};--vr-size:19px;--vr-width:700px;--vr-lh:1.7}
:root,[data-theme="light"]{--vr-bg:#fdfcf9;--vr-text:#1d1d1f;--vr-muted:#5b5b62;--vr-link:#1a56b8;--vr-code:#efede7;--vr-border:#d9d5cb;--vr-hl:rgba(255,200,40,.5);--vr-bar:#fdfcf9;color-scheme:light}
[data-theme="sepia"]{--vr-bg:#f4ecd8;--vr-text:#433422;--vr-muted:#6b5841;--vr-link:#8a4510;--vr-code:#e9ddc1;--vr-border:#d5c4a1;--vr-hl:rgba(214,150,30,.42);--vr-bar:#f4ecd8;color-scheme:light}
[data-theme="dark"]{--vr-bg:#1b1c1f;--vr-text:#e6e3dd;--vr-muted:#a9a59e;--vr-link:#8ab4f8;--vr-code:#2a2b30;--vr-border:#3b3c42;--vr-hl:rgba(255,210,80,.32);--vr-bar:#1b1c1f;color-scheme:dark}
[data-theme="vex"]{--vr-bg:${c.bg};--vr-text:${c.text};--vr-muted:${c.muted};--vr-link:${c.link};--vr-code:${c.code};--vr-border:${c.border};--vr-hl:color-mix(in srgb, ${c.accent} 30%, transparent);--vr-bar:${c.bg};color-scheme:${c.dark ? 'dark' : 'light'}}
html{background:var(--vr-bg)}
body{margin:0;background:var(--vr-bg);color:var(--vr-text);font-family:var(--vr-font);font-size:var(--vr-size);line-height:var(--vr-lh);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.vr-bar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px 8px;padding:8px 12px;background:var(--vr-bar);border-bottom:1px solid var(--vr-border);font:13px/1.2 'Segoe UI',system-ui,sans-serif;color:var(--vr-text)}
.vr-bar button,.vr-bar select{font:inherit;color:inherit;background:transparent;border:1px solid var(--vr-border);border-radius:8px;min-height:30px;padding:0 10px;display:inline-flex;align-items:center;gap:6px;cursor:pointer}
.vr-bar select{padding:0 6px}
.vr-bar select option{background:var(--vr-bg);color:var(--vr-text)}
.vr-bar button:hover,.vr-bar select:hover{border-color:var(--vr-muted)}
.vr-bar :focus-visible,main :focus-visible{outline:2px solid var(--vr-link);outline-offset:2px}
.vr-bar label{display:inline-flex;align-items:center;gap:6px;color:var(--vr-muted)}
.vr-group{display:inline-flex;align-items:center;gap:4px}
.vr-size{min-width:2.4em;text-align:center;color:var(--vr-muted)}
.vr-sep{width:1px;height:20px;background:var(--vr-border);margin:0 2px}
main{max-width:var(--vr-width);margin:0 auto;padding:36px 24px 120px;outline:none}
h1{font-size:1.9em;line-height:1.22;margin:0 0 .35em;letter-spacing:-.01em}
h2{font-size:1.4em;line-height:1.3;margin:1.7em 0 .55em}
h3{font-size:1.18em;line-height:1.35;margin:1.5em 0 .5em}
h4{font-size:1.02em;line-height:1.4;margin:1.3em 0 .4em}
p{margin:0 0 1em}
a{color:var(--vr-link);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:2px}
img{display:block;max-width:100%;height:auto;margin:1.1em auto;border-radius:6px}
td img,th img{max-width:min(100%,320px);margin:.3em auto}
figure{margin:1.5em 0}
figcaption{color:var(--vr-muted);font-size:.82em;line-height:1.45;text-align:center;margin-top:.4em}
blockquote{margin:1.3em 0;padding:.1em 0 .1em 1.1em;border-left:3px solid var(--vr-border);color:var(--vr-muted);font-style:italic}
pre{background:var(--vr-code);border:1px solid var(--vr-border);border-radius:8px;padding:14px 16px;overflow-x:auto;font-size:.8em;line-height:1.55;white-space:pre;tab-size:4;margin:1.2em 0}
code{font-family:'JetBrains Mono','Cascadia Mono',Consolas,monospace;font-size:.86em;background:var(--vr-code);padding:.08em .32em;border-radius:4px}
pre code{background:none;padding:0;font-size:inherit}
.vr-table{overflow-x:auto;margin:1.3em 0}
table{border-collapse:collapse;font-size:.86em;line-height:1.45}
th,td{border:1px solid var(--vr-border);padding:6px 10px;vertical-align:top;text-align:start}
th{background:var(--vr-code);font-weight:600}
caption{color:var(--vr-muted);font-size:.92em;padding-bottom:6px;text-align:start}
ul,ol{padding-inline-start:1.4em;margin:0 0 1em}
li{margin:.3em 0}
li>p:last-child{margin-bottom:0}
dt{font-weight:600;margin-top:.7em}
dd{margin:0 0 .5em 1.2em}
hr{border:0;border-top:1px solid var(--vr-border);margin:2em 0}
.vr-meta{color:var(--vr-muted);font:14px/1.5 'Segoe UI',system-ui,sans-serif;margin:0 0 2.2em}
::highlight(vex-tts){background-color:var(--vr-hl);color:var(--vr-text)}
@media (max-width:640px){main{padding:24px 16px 96px}.vr-bar{justify-content:flex-start}}
`;
  },

  // The reader page's own controls. They change the page at once and send the
  // choice back over the reader's console channel (webview.js lets a reader
  // page ask for exactly these three things), so the next article opens the
  // same way. Escape leaves, like the button.
  _script(prefs) {
    const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
    return `(function(){
var FONTS=${json(this.FONTS)},WIDTHS=${json(this.WIDTHS)},SPACING=${json(this.SPACING)};
var prefs=${json(prefs)};
var root=document.documentElement;
function send(o){console.log('VEX_CMD:'+JSON.stringify(o));}
function apply(){
  root.setAttribute('data-theme',prefs.theme);
  root.style.setProperty('--vr-font',FONTS[prefs.font]);
  root.style.setProperty('--vr-size',prefs.size+'px');
  root.style.setProperty('--vr-width',WIDTHS[prefs.width]+'px');
  root.style.setProperty('--vr-lh',String(SPACING[prefs.spacing]));
  document.getElementById('vr-font').value=prefs.font;
  document.getElementById('vr-width').value=prefs.width;
  document.getElementById('vr-spacing').value=prefs.spacing;
  document.getElementById('vr-theme').value=prefs.theme;
  document.getElementById('vr-size').textContent=String(prefs.size);
  document.getElementById('vr-smaller').disabled=prefs.size<=14;
  document.getElementById('vr-bigger').disabled=prefs.size>=32;
}
function change(k,v){prefs[k]=v;apply();send({type:'reader-prefs',prefs:prefs});}
['font','width','spacing','theme'].forEach(function(k){document.getElementById('vr-'+k).addEventListener('change',function(e){change(k,e.target.value);});});
document.getElementById('vr-smaller').addEventListener('click',function(){change('size',Math.max(14,prefs.size-1));});
document.getElementById('vr-bigger').addEventListener('click',function(){change('size',Math.min(32,prefs.size+1));});
document.getElementById('vr-exit').addEventListener('click',function(){send({type:'exit-reading'});});
document.getElementById('vr-listen').addEventListener('click',function(){send({type:'reader-listen'});});
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&!e.shiftKey&&!e.isComposing&&!e.defaultPrevented){e.preventDefault();send({type:'exit-reading'});}
});
apply();
try{document.querySelector('main').focus({preventScroll:true});}catch(e){}
})();`;
  },

  // The whole reader document. Exposed for the tests.
  buildHtml(article, sourceUrl, prefs, colors) {
    const p = this.cleanPrefs(prefs);
    const title = String((article && article.title) || 'Reading mode');
    const blocks = this._dropTitleHeading(article && article.blocks, title);
    const body = this._render(blocks)
      || (article && article.fallbackText ? `<p>${this._esc(article.fallbackText)}</p>` : '');
    if (!body) return null;
    const words = Number.isFinite(Number(article && article.wordCount)) && Number(article.wordCount) > 0
      ? Math.round(Number(article.wordCount))
      : this._plain(blocks).split(/\s+/).filter(Boolean).length;
    const minutes = Math.max(1, Math.round(words / 230));
    const meta = [article && article.siteName, article && article.byline].filter(Boolean).map(s => this._esc(String(s).slice(0, 200)));
    meta.push(`${minutes} min read`);
    meta.push(`${words.toLocaleString('en-US')} words`);
    const lang = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(String((article && article.lang) || '')) ? article.lang : '';
    const dir = article && article.dir === 'rtl' ? ' dir="rtl"' : '';
    const sel = (id, label, options, value) => `<label for="vr-${id}">${label}<select id="vr-${id}">${options.map(([v, l]) => `<option value="${v}"${v === value ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
    const bar = `<div class="vr-bar" role="toolbar" aria-label="Reader view">`
      + `<button id="vr-exit" type="button" title="Leave reader view (Esc)">${this._icon('arrow-left')}<span>Exit reader</span></button>`
      + `<span class="vr-sep" aria-hidden="true"></span>`
      + sel('font', 'Font', [['serif', 'Serif'], ['sans', 'Sans'], ['mono', 'Mono']], p.font)
      + `<span class="vr-group" role="group" aria-label="Text size"><button id="vr-smaller" type="button" aria-label="Smaller text" title="Smaller text">${this._icon('minus')}</button><span id="vr-size" class="vr-size" aria-live="polite">${p.size}</span><button id="vr-bigger" type="button" aria-label="Bigger text" title="Bigger text">${this._icon('plus')}</button></span>`
      + sel('width', 'Width', [['narrow', 'Narrow'], ['medium', 'Medium'], ['wide', 'Wide']], p.width)
      + sel('spacing', 'Lines', [['tight', 'Tight'], ['normal', 'Normal'], ['loose', 'Loose']], p.spacing)
      + sel('theme', 'Theme', [['vex', 'Vex'], ['light', 'Light'], ['sepia', 'Sepia'], ['dark', 'Dark']], p.theme)
      + `<span class="vr-sep" aria-hidden="true"></span>`
      + `<button id="vr-listen" type="button" title="Read this article aloud">${this._icon('volume')}<span>Listen</span></button>`
      + `</div>`;
    return `<!DOCTYPE html><html${lang ? ` lang="${lang}"` : ''}${dir} data-theme="${p.theme}"><head><meta charset="UTF-8">`
      + `<meta name="vex-reading-source" content="${this._esc(sourceUrl)}">`
      + `<meta name="viewport" content="width=device-width, initial-scale=1">`
      + `<title>${this._esc(title)}</title><style>${this._css(colors || this._vexColors())}</style></head><body>`
      + bar
      + `<main id="vr-main" tabindex="-1"><article><h1>${this._esc(title)}</h1><p class="vr-meta">${meta.join(' &middot; ')}</p>${body}</article></main>`
      + `<script>${this._script(p)}</script></body></html>`;
  },

  // The page a Vex reader page was made from, read from the address of the
  // reader page itself, or '' if it is not one. The reader carries it in
  // <meta name="vex-reading-source">: after Exit and then Back the reader page
  // comes back with nothing remembered for the tab, so its Exit did nothing
  // and reading mode made a reader of the reader (found 2026-09-29). Only
  // http(s) comes out, so a crafted data: page cannot send the tab to file:.
  sourceOf(url) {
    const s = String(url || '');
    if (!/^data:text\/html/i.test(s)) return '';
    let html;
    try { html = decodeURIComponent(s.slice(s.indexOf(',') + 1)); } catch { return ''; }
    const m = /<meta name="vex-reading-source" content="([^"]*)">/.exec(html);
    if (!m) return '';
    const src = m[1].replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e]));
    return /^https?:\/\//i.test(src) ? src : '';
  },

  // Is this webview showing a Vex reader page right now?
  isReader(wv) {
    let u = '';
    try { u = wv && wv.getURL ? wv.getURL() : ''; } catch { u = ''; }
    return !!this.sourceOf(u);
  },

  async activate() {
    const wv = WebviewManager.getActiveWebview();
    if (!wv) { window.showToast?.('No active tab'); return; }

    const tabId = TabManager.activeTabId;
    const currentUrl = wv.getURL();

    // Already reading this tab: the second press exits. Running it again used
    // to overwrite the remembered page with the reader's own data: URL, so the
    // original page was lost (found 2026-09-29). A reader page reached by
    // Back has nothing remembered, so its own source line is used.
    if ((this._originalUrls.has(tabId) && /^data:text\/html/i.test(currentUrl)) || this.sourceOf(currentUrl)) {
      this.exitReadingMode(tabId);
      return;
    }

    let article;
    try {
      // Extract STRUCTURE AND TEXT, not markup. innerHTML from the page would
      // carry the page's own scripts and event handlers into the document we
      // build below.
      article = await wv.executeJavaScript(this._extractScript());
    } catch (err) {
      window.showToast?.('Reading mode could not read this page: ' + (err?.message || 'extraction failed'), 'error');
      return;
    }

    let html = this.buildHtml(article || {}, currentUrl, this.prefs());
    if (!html) {
      window.showToast?.('Reading mode found no article text on this page');
      return;
    }
    // Chromium refuses an address over 2 MB. Pictures carried inline as data:
    // go first; then the article is cut, and the reader says so.
    let url = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    if (url.length > 1900000 && article && Array.isArray(article.blocks)) {
      const strip = (v) => JSON.parse(JSON.stringify(v), (k, val) => ((k === 'img' || k === 'src') && /^data:/i.test(String(val)) ? '' : val));
      let blocks = strip(article.blocks);
      url = 'data:text/html;charset=utf-8,' + encodeURIComponent(this.buildHtml({ ...article, blocks }, currentUrl, this.prefs()));
      while (url.length > 1900000 && blocks.length > 10) {
        blocks = blocks.slice(0, Math.floor(blocks.length * 0.75));
        url = 'data:text/html;charset=utf-8,' + encodeURIComponent(this.buildHtml({ ...article, blocks }, currentUrl, this.prefs()));
      }
      window.showToast?.('This article is very long, so reader view shows the first part of it');
    }

    this._prune();
    this._originalUrls.set(tabId, currentUrl);
    const y = Number(article && article.scrollY);
    if (Number.isFinite(y) && y > 0) this._scroll.set(tabId, { url: currentUrl, y }); else this._scroll.delete(tabId);

    wv.loadURL(url);
    // Keys go to the article at once: Esc leaves, the arrows and Space
    // scroll. Opened from the command bar or a shortcut, the focus was left in
    // Vex's own window and Esc never reached the reader (found 2026-10-03).
    try { if (typeof wv.focus === 'function') wv.focus(); }
    catch (err) { console.warn('[ReadingMode] could not move the focus to the article:', err && err.message); }
    window.showToast?.('Reader view — Esc to leave');
  },

  // Commands from a reader page (webview.js passes them on, and only from a
  // reader page).
  onReaderCommand(tabId, cmd) {
    if (!cmd || typeof cmd !== 'object') return false;
    if (cmd.type === 'exit-reading') return this.exitReadingMode(tabId);
    if (cmd.type === 'reader-prefs') {
      try { this.savePrefs(cmd.prefs); }
      catch (err) { window.showToast?.('Reader settings could not be saved: ' + (err && err.message), 'error'); return false; }
      return true;
    }
    if (cmd.type === 'reader-listen') {
      const wv = (typeof WebviewManager !== 'undefined' && WebviewManager.webviews) ? WebviewManager.webviews.get(tabId) : null;
      if (!wv || typeof ReadAloud === 'undefined') return false;
      ReadAloud.toggle({ wv, tabId });
      return true;
    }
    return false;
  },

  // Exit reading mode for ONE tab. It used to navigate whatever tab happened to
  // be active, so exiting a background tab's reading mode threw away the page
  // the user was actually looking at.
  exitReadingMode(tabId) {
    this._prune();
    const id = tabId || (typeof TabManager !== 'undefined' ? TabManager.activeTabId : null);
    if (!id) return false;
    const wv = (typeof WebviewManager !== 'undefined' && WebviewManager.webviews)
      ? WebviewManager.webviews.get(id)
      : null;
    // Nothing remembered (the reader page came back through Back): the
    // reader page names its own source.
    let url = this._originalUrls.get(id);
    if (!url && wv) { try { url = this.sourceOf(wv.getURL()); } catch { url = ''; } }
    if (!url) return false;
    if (!wv) return false;          // tab is gone or asleep — keep the URL for when it is back
    this._originalUrls.delete(id);
    const saved = this._scroll.get(id);
    this._scroll.delete(id);
    // Back, not a fresh load: the page the reader replaced is the entry
    // behind it, and going back returns to it as it was. Loading it again
    // started at the top and stacked a second copy of the page onto the
    // history every time (found 2026-10-03). Where we land is checked, and a
    // wrong landing is corrected with a load.
    let wentBack = false;
    try {
      if (typeof wv.canGoBack === 'function' && typeof wv.goBack === 'function' && wv.canGoBack()) { wv.goBack(); wentBack = true; }
    } catch (err) { console.warn('[ReadingMode] going back failed, loading the page instead:', err && err.message); wentBack = false; }
    if (!wentBack) wv.loadURL(url);
    this._afterExit(wv, url, saved && saved.url === url ? saved.y : 0, wentBack);
    return true;
  },

  _samePage(a, b) {
    const strip = (u) => String(u || '').replace(/#.*$/, '').replace(/\/$/, '');
    return strip(a) === strip(b);
  },

  _afterExit(wv, url, y, wentBack) {
    if (!wv || typeof wv.addEventListener !== 'function') return;
    const onNav = (e) => {
      wv.removeEventListener('did-navigate', onNav);
      clearTimeout(timer);
      if (wentBack && !this._samePage(e && e.url, url)) {
        try { wv.loadURL(url); } catch (err) { console.error('[ReadingMode] could not load the page back:', err && err.message); return; }
        this._afterExit(wv, url, y, false);
        return;
      }
      if (y > 40) this._restoreScroll(wv, y);
    };
    const timer = setTimeout(() => wv.removeEventListener('did-navigate', onNav), 30000);
    wv.addEventListener('did-navigate', onNav);
  },

  // Put the page back where it was. Only while it is still sitting at the top:
  // a page restored from the back/forward cache is already in place, and
  // someone who has started scrolling is not dragged anywhere.
  _restoreScroll(wv, y) {
    const target = Math.round(y);
    const js = `(function(){var y=${target};if(window.scrollY<40&&document.documentElement.scrollHeight>y){window.scrollTo(0,y);}return Math.round(window.scrollY);})()`;
    let tries = 0;
    const attempt = () => {
      tries++;
      let p;
      try { p = wv.executeJavaScript(js); } catch { return; }
      Promise.resolve(p).then((now) => {
        if (Math.abs(Number(now) - target) > 40 && tries < 6) setTimeout(attempt, 350 * tries);
      }, () => { /* the tab moved on */ });
    };
    setTimeout(attempt, 120);
  },

  forgetTab(tabId) { this._scroll.delete(tabId); return this._originalUrls.delete(tabId); },

  // Drop entries for tabs that no longer exist. Closing a tab while it is in
  // reading mode left its original URL in the map forever; there is no
  // tab-closed event to hook, so prune whenever we touch the map.
  _prune() {
    if (typeof TabManager === 'undefined' || !Array.isArray(TabManager.tabs)) return;
    const live = new Set(TabManager.tabs.map(t => t.id));
    for (const id of [...this._originalUrls.keys()]) if (!live.has(id)) this._originalUrls.delete(id);
    for (const id of [...this._scroll.keys()]) if (!live.has(id)) this._scroll.delete(id);
  },
};

if (typeof window !== 'undefined') { window.ReadingMode = ReadingMode; window.vexReaderPageLib = vexReaderPageLib; }
if (typeof module !== 'undefined' && module.exports) module.exports = { ReadingMode, vexReaderPageLib };
