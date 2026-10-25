// OpenDocument files (.odt text, .ods spreadsheets, .odp presentations) read into the same shapes the Word, Excel and PowerPoint
// readers produce, so one viewer shows all of them:
//   odt -> a DOM document (renderOdt)           like docx.js
//   ods -> a workbook model + sheet models      like xlsx-core.js
//   odp -> a slide model (renderOdpSlide ...)   like pptx.js
// Same promises as those readers: nodes made with createElement / textContent, pictures only from the file itself, links only
// http / https / mailto or inside the document, nothing run, nothing fetched.

import { NS, parseXml, kids, kid, all, attr, imageMime, isUndrawable, safeHref, readableOn, luminanceOf, dirOf } from './xml.js';
import { t } from './strings.js';

const T = NS.text, TB = NS.table, DR = NS.draw, FO = NS.fo, ST = NS.style, SVG = NS.svg, XL = NS.xlink, OF = NS.office;
const at = (el, ns, name) => (el ? el.getAttributeNS(ns, name) : null);

export function odfKind(mimetype, doc) {
  const m = String(mimetype || '').trim();
  if (/opendocument\.text/.test(m)) return 'odt';
  if (/opendocument\.spreadsheet/.test(m)) return 'ods';
  if (/opendocument\.presentation/.test(m)) return 'odp';
  const body = doc && all(doc, 'body')[0];
  const first = body && kid(body);
  if (first) return { text: 'odt', spreadsheet: 'ods', presentation: 'odp' }[first.localName] || null;
  return null;
}

// "2.5cm" -> px
export function lengthPx(v) {
  const m = /^(-?[\d.]+)\s*(cm|mm|in|pt|px|pc)?$/.exec(String(v || '').trim());
  if (!m) return 0;
  const n = parseFloat(m[1]);
  switch (m[2]) { case 'cm': return n * 37.7953; case 'mm': return n * 3.77953; case 'in': return n * 96; case 'pt': return n * 4 / 3; case 'pc': return n * 16; default: return n; }
}

// ---- loading and styles -------------------------------------------------------------------------------------
export async function loadOdf(pkg) {
  if (!pkg.has('content.xml')) throw Object.assign(new Error('This file has no content. It may not be an OpenDocument file'), { code: 'corrupt' });
  const doc = parseXml(await pkg.text('content.xml'), 'The content');
  const mimetype = pkg.has('mimetype') ? await pkg.text('mimetype') : '';
  const kind = odfKind(mimetype, doc);
  if (!kind) throw Object.assign(new Error('This is not a text, spreadsheet or presentation file'), { code: 'corrupt' });
  const stylesDoc = pkg.has('styles.xml') ? parseXml(await pkg.text('styles.xml'), 'The styles') : null;
  const model = { pkg, doc, stylesDoc, kind, styles: new Map(), listStyles: new Map(), dataStyles: new Map(), images: new Map(), props: {}, macros: pkg.has('Basic/script-lc.xml') || [...pkg.names].some((n) => /^(Basic|Scripts)\//.test(n)) };
  for (const d of [stylesDoc, doc]) if (d) readStyles(d, model);
  if (pkg.has('meta.xml')) {
    try { const meta = parseXml(await pkg.text('meta.xml'), ''); const title = all(meta, 'title')[0]; model.props = { title: title ? title.textContent.trim() : '' }; } catch { model.props = {}; }
  }
  model.hasChanges = all(doc, 'changed-region').length > 0;
  model.hasComments = all(doc, 'annotation').length > 0;
  return model;
}

export function releaseOdf(model) { for (const u of model.images.values()) if (u) URL.revokeObjectURL(u); model.images.clear(); }

function props(el) {
  const out = {};
  const tp = el && kids(el, 'text-properties')[0];
  if (tp) {
    if (at(tp, FO, 'font-weight') === 'bold' || +at(tp, FO, 'font-weight') >= 600) out.b = true;
    if (at(tp, FO, 'font-style') === 'italic') out.i = true;
    const ul = at(tp, ST, 'text-underline-style');
    if (ul && ul !== 'none') out.u = true;
    const ls = at(tp, ST, 'text-line-through-style');
    if (ls && ls !== 'none') out.s = true;
    const col = at(tp, FO, 'color');
    if (col && /^#[0-9a-f]{6}$/i.test(col)) out.color = col;
    const bg = at(tp, FO, 'background-color');
    if (bg && /^#[0-9a-f]{6}$/i.test(bg)) out.bg = bg;
    const pos = at(tp, ST, 'text-position');
    if (pos && /^super/.test(pos)) out.sup = true; else if (pos && /^sub/.test(pos)) out.sub = true;
    const sz = at(tp, FO, 'font-size');
    if (sz) out.size = lengthPx(sz);
  }
  const pp = el && kids(el, 'paragraph-properties')[0];
  if (pp) {
    const al = at(pp, FO, 'text-align');
    if (al) out.align = al === 'end' ? 'right' : al === 'start' ? 'left' : al;
    const bg = at(pp, FO, 'background-color');
    if (bg && /^#[0-9a-f]{6}$/i.test(bg)) out.pbg = bg;
  }
  const cp = el && kids(el, 'table-column-properties')[0];
  if (cp && at(cp, ST, 'column-width')) out.colWidth = lengthPx(at(cp, ST, 'column-width'));
  const rp = el && kids(el, 'table-row-properties')[0];
  if (rp && at(rp, ST, 'row-height')) out.rowHeight = lengthPx(at(rp, ST, 'row-height'));
  const gp = el && (kids(el, 'graphic-properties')[0] || kids(el, 'drawing-page-properties')[0]);
  if (gp) {
    const fill = at(gp, DR, 'fill-color'), mode = at(gp, DR, 'fill');
    if (fill && /^#[0-9a-f]{6}$/i.test(fill) && mode !== 'none') out.fill = fill;
    const stroke = at(gp, SVG, 'stroke-color');
    if (stroke && /^#[0-9a-f]{6}$/i.test(stroke)) out.stroke = stroke;
  }
  const tcp = el && kids(el, 'table-cell-properties')[0];
  if (tcp) {
    const bg = at(tcp, FO, 'background-color');
    if (bg && /^#[0-9a-f]{6}$/i.test(bg)) out.cellBg = bg;
  }
  const dsn = el && at(el, ST, 'data-style-name');
  if (dsn) out.dataStyle = dsn;
  return out;
}

function readStyles(doc, model) {
  for (const s of all(doc, 'style')) {
    const name = at(s, ST, 'name');
    if (!name) continue;
    const family = at(s, ST, 'family');
    model.styles.set(family + ':' + name, { ...props(s), parent: at(s, ST, 'parent-style-name'), family });
    if (!model.styles.has(name)) model.styles.set(name, model.styles.get(family + ':' + name));
  }
  for (const ls of all(doc, 'list-style')) {
    const name = at(ls, ST, 'name');
    const levels = {};
    for (const l of kids(ls)) {
      const lvl = +at(l, T, 'level') || 1;
      levels[lvl] = l.localName === 'list-level-style-number' ? { ol: true, fmt: at(l, ST, 'num-format') || '1' } : { ol: false };
    }
    if (name) model.listStyles.set(name, levels);
  }
  readDataStyles(doc, model);
}

const NUMBER = 'urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0';
function readDataStyles(doc, model) {
  for (const el of doc.getElementsByTagNameNS(NUMBER, '*')) {
    const name = at(el, ST, 'name');
    if (!name || !/-style$/.test(el.localName) || model.dataStyles.has(name)) continue;
    const parts = kids(el);
    let code = '';
    const kind = el.localName;
    if (kind === 'date-style' || kind === 'time-style') {
      for (const p of parts) {
        const long = at(p, NUMBER, 'style') === 'long';
        switch (p.localName) {
          case 'day': code += long ? 'dd' : 'd'; break;
          case 'month': code += at(p, NUMBER, 'textual') === 'true' ? (long ? 'mmmm' : 'mmm') : (long ? 'mm' : 'm'); break;
          case 'year': code += long ? 'yyyy' : 'yy'; break;
          case 'day-of-week': code += long ? 'dddd' : 'ddd'; break;
          case 'hours': code += long ? 'hh' : 'h'; break;
          case 'minutes': code += long ? 'mm' : 'm'; break;
          case 'seconds': code += long ? 'ss' : 's'; break;
          case 'am-pm': code += 'AM/PM'; break;
          case 'text': code += '"' + p.textContent.replace(/"/g, '') + '"'; break;
          default: break;
        }
      }
    } else if (kind === 'number-style' || kind === 'percentage-style' || kind === 'currency-style') {
      for (const p of parts) {
        if (p.localName === 'number') {
          const dp = +at(p, NUMBER, 'decimal-places') || 0;
          const grouping = at(p, NUMBER, 'grouping') === 'true';
          code += (grouping ? '#,##0' : '0') + (dp ? '.' + '0'.repeat(dp) : '');
        } else if (p.localName === 'scientific-number') {
          const dp = +at(p, NUMBER, 'decimal-places') || 0;
          code += '0' + (dp ? '.' + '0'.repeat(dp) : '') + 'E+00';
        } else if (p.localName === 'currency-symbol') code += '"' + p.textContent.replace(/"/g, '') + '"';
        else if (p.localName === 'text') code += '"' + p.textContent.replace(/"/g, '') + '"';
      }
      if (kind === 'percentage-style' && !code.includes('%')) code += '%';
    }
    if (code) model.dataStyles.set(name, code);
  }
}

function styleOf(model, name, family) {
  let s = model.styles.get((family || 'text') + ':' + name) || model.styles.get(name);
  if (!s) return {};
  const merged = {};
  const chain = [];
  const seen = new Set();
  while (s && !seen.has(s)) { seen.add(s); chain.unshift(s); s = s.parent ? (model.styles.get((s.family || family) + ':' + s.parent) || model.styles.get(s.parent)) : null; }
  for (const c of chain) Object.assign(merged, c);
  return merged;
}

async function imageUrl(model, href) {
  const path = String(href || '').replace(/^\.\//, '');
  if (model.images.has(path)) return model.images.get(path);
  if (!model.pkg.has(path) || !imageMime(path) || isUndrawable(path)) { model.images.set(path, null); return null; }
  const parts = await model.pkg.bytes([path]);
  const url = parts[path] ? URL.createObjectURL(new Blob([parts[path]], { type: imageMime(path) })) : null;
  model.images.set(path, url);
  return url;
}

// ---- ODT -----------------------------------------------------------------------------------------------------------------
// opts as renderDocx: { changes, comments, surface, token }.  -> { root, outline, comments, unsupported }
export async function renderOdt(model, host, opts = {}) {
  const o = { changes: 'all', comments: true, surface: '#ffffff', ...opts };
  const ctx = { model, opts: o, outline: [], comments: [], notes: [], unsupported: { picture: 0, chart: 0, diagram: 0, shape: 0 }, heading: 0, regions: new Map(), insDepth: 0, delDepth: 0, pending: [] };
  for (const cr of all(model.doc, 'changed-region')) {
    const id = at(cr, T, 'id');
    const k = kid(cr, 'insertion') ? 'ins' : (kid(cr, 'deletion') ? 'del' : null);
    const info = kid(kid(cr, 'insertion') || kid(cr, 'deletion') || kid(cr, 'format-change'), 'change-info');
    ctx.regions.set(id, { kind: k, author: info ? (all(info, 'creator')[0] || {}).textContent : '', date: info ? (all(info, 'date')[0] || {}).textContent : '', el: kid(cr, 'deletion') });
  }
  host.textContent = '';
  const root = document.createElement('div');
  root.className = 'od-doc';
  host.append(root);
  const body = all(model.doc, 'text').find((e) => e.namespaceURI === OF);
  if (!body) throw Object.assign(new Error('This file has no text'), { code: 'corrupt' });
  let n = 0;
  for (const child of kids(body)) {
    if (opts.token && opts.token.cancelled) return null;
    odtBlock(child, root, ctx);
    if (++n % 150 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  if (ctx.notes.length) {
    const sec = document.createElement('section');
    sec.className = 'od-notes';
    sec.setAttribute('aria-label', t('Footnotes'));
    const h = document.createElement('h2');
    h.textContent = t('Footnotes');
    const ol = document.createElement('ol');
    sec.append(h, ol);
    ctx.notes.forEach((nt, i) => {
      const li = document.createElement('li');
      li.id = 'fn-' + (i + 1);
      for (const c of kids(nt.body)) odtBlock(c, li, ctx);
      const back = document.createElement('a');
      back.href = '#fnref-' + (i + 1);
      back.className = 'od-noteback';
      back.textContent = '↩';
      back.setAttribute('aria-label', t('Back to the text'));
      (li.lastElementChild || li).append(document.createTextNode(' '), back);
      ol.append(li);
    });
    root.append(sec);
  }
  await resolveImages(ctx);
  return { root, outline: ctx.outline, comments: ctx.comments, unsupported: ctx.unsupported };
}

async function resolveImages(ctx) {
  for (const p of ctx.pending) {
    const url = await imageUrl(ctx.model, p.href);
    if (url) p.img.src = url;
    else { ctx.unsupported.picture++; p.img.replaceWith(Object.assign(document.createElement('span'), { className: 'od-missing', textContent: t('Picture not shown') })); }
  }
}

function odtBlock(el, container, ctx) {
  const { model } = ctx;
  switch (el.localName) {
    case 'h': case 'p': {
      const level = el.localName === 'h' ? Math.min(6, Math.max(1, +at(el, T, 'outline-level') || 1)) : 0;
      const e = document.createElement(level ? 'h' + level : 'p');
      const st = styleOf(model, at(el, T, 'style-name'), 'paragraph');
      if (st.align === 'center' || st.align === 'right' || st.align === 'justify') e.style.textAlign = st.align;
      if (st.pbg) { e.style.background = st.pbg; e.style.color = readableOn(st.pbg); }
      container.append(e);
      odtInline(el, e, ctx, st);
      if (level) { const text = e.textContent.trim(); if (text) { const id = 'od-h-' + (++ctx.heading); e.id = id; ctx.outline.push({ level, text, id }); } }
      if (!e.childNodes.length) { e.classList.add('od-empty'); e.append(document.createElement('br')); }
      break;
    }
    case 'list': odtList(el, container, ctx, 1, at(el, T, 'style-name')); break;
    case 'table': container.append(odtTable(el, ctx)); break;
    case 'section': case 'index-body': case 'table-of-content': case 'alphabetical-index': case 'bibliography':
      for (const c of kids(el)) odtBlock(c, container, ctx);
      break;
    case 'tracked-changes': break;
    default: break;
  }
}

function odtList(el, container, ctx, level, styleName) {
  const levels = ctx.model.listStyles.get(styleName) || {};
  const ordered = levels[level] ? levels[level].ol : false;
  const list = document.createElement(ordered ? 'ol' : 'ul');
  if (ordered && levels[level].fmt) list.style.listStyleType = { a: 'lower-alpha', A: 'upper-alpha', i: 'lower-roman', I: 'upper-roman' }[levels[level].fmt] || 'decimal';
  container.append(list);
  for (const item of kids(el, 'list-item')) {
    const li = document.createElement('li');
    list.append(li);
    for (const c of kids(item)) {
      if (c.localName === 'list') odtList(c, li, ctx, level + 1, at(c, T, 'style-name') || styleName);
      else if (c.localName === 'p' || c.localName === 'h') { const holder = document.createElement('div'); odtBlock(c, holder, ctx); while (holder.firstChild) { const f = holder.firstChild; if (f.tagName === 'P') { while (f.firstChild) li.append(f.firstChild); f.remove(); } else li.append(f); } li.append(document.createTextNode('')); }
    }
  }
}

function odtTable(tbl, ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'od-table-wrap';
  const table = document.createElement('table');
  table.className = 'od-table';
  wrap.append(table);
  const rowsOf = (parent) => { const out = []; for (const c of kids(parent)) { if (c.localName === 'table-row') out.push([c, false]); else if (c.localName === 'table-header-rows') for (const r of kids(c, 'table-row')) out.push([r, true]); else if (c.localName === 'table-row-group') out.push(...rowsOf(c)); } return out; };
  const thead = document.createElement('thead'), tbody = document.createElement('tbody');
  for (const [row, head] of rowsOf(tbl)) {
    const tr = document.createElement('tr');
    for (const c of kids(row)) {
      if (c.localName === 'covered-table-cell') continue;
      if (c.localName !== 'table-cell') continue;
      const td = document.createElement(head ? 'th' : 'td');
      const cs = +at(c, TB, 'number-columns-spanned') || 1, rs = +at(c, TB, 'number-rows-spanned') || 1;
      if (cs > 1) td.colSpan = cs;
      if (rs > 1) td.rowSpan = rs;
      const st = styleOf(ctx.model, at(c, TB, 'style-name'), 'table-cell');
      if (st.cellBg) { td.style.background = st.cellBg; td.style.color = readableOn(st.cellBg); }
      for (const k of kids(c)) odtBlock(k, td, ctx);
      if (!td.childNodes.length) td.append(document.createElement('br'));
      const repeat = Math.min(+at(c, TB, 'number-columns-repeated') || 1, 30);
      tr.append(td);
      for (let k = 1; k < repeat && cs === 1; k++) tr.append(td.cloneNode(true));
    }
    (head ? thead : tbody).append(tr);
  }
  if (thead.childNodes.length) table.append(thead);
  table.append(tbody);
  return wrap;
}

function odtInline(el, into, ctx, base) {
  for (const n of el.childNodes) {
    if (n.nodeType === 3) {
      if (ctx.delDepth && ctx.opts.changes === 'final') continue;
      if (ctx.insDepth && ctx.opts.changes === 'original') continue;
      emitText(n.nodeValue.replace(/[\t\r\n ]+/g, ' '), into, ctx, base);
      continue;
    }
    if (n.nodeType !== 1) continue;
    switch (n.localName) {
      case 's': { const c = Math.min(+at(n, T, 'c') || 1, 200); emitText(' '.repeat(c), into, ctx, base); break; }
      case 'tab': emitText(' ', into, ctx, base); break;
      case 'line-break': into.append(document.createElement('br')); break;
      case 'span': odtInline(n, into, ctx, { ...base, ...styleOf(ctx.model, at(n, T, 'style-name'), 'text') }); break;
      case 'a': {
        const href = at(n, XL, 'href');
        const safe = href && (safeHref(href) || (href[0] === '#' ? '#bm-' + href.slice(1) : null));
        if (safe) {
          const a = document.createElement('a');
          a.href = safe;
          if (safe[0] !== '#') { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
          into.append(a);
          odtInline(n, a, ctx, base);
        } else odtInline(n, into, ctx, base);
        break;
      }
      case 'bookmark': case 'bookmark-start': { const name = at(n, T, 'name'); if (name) { const a = document.createElement('a'); a.id = 'bm-' + name; a.className = 'od-anchor'; into.append(a); } break; }
      case 'note': {
        const body = kid(n, 'note-body');
        if (!body) break;
        ctx.notes.push({ body });
        const i = ctx.notes.length;
        const sup = document.createElement('sup');
        const a = document.createElement('a');
        a.id = 'fnref-' + i; a.href = '#fn-' + i; a.className = 'od-noteref'; a.textContent = String(i);
        a.setAttribute('aria-label', t('Footnote') + ' ' + i);
        sup.append(a);
        into.append(sup);
        break;
      }
      case 'annotation': {
        if (!ctx.opts.comments) break;
        const author = (all(n, 'creator')[0] || {}).textContent || '';
        const date = (all(n, 'date')[0] || {}).textContent || '';
        const text = all(n, 'p').map((p) => p.textContent).filter(Boolean).join('\n');
        ctx.comments.push({ id: String(ctx.comments.length), author, date, text });
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'od-cm'; b.dataset.cid = String(ctx.comments.length - 1); b.textContent = String(ctx.comments.length);
        b.setAttribute('aria-label', t('Comment {n} by {who}', { n: ctx.comments.length, who: author || '?' }));
        into.append(b);
        break;
      }
      case 'change-start': {
        const r = ctx.regions.get(at(n, T, 'change-id'));
        if (r && r.kind === 'ins') ctx.insDepth++;
        break;
      }
      case 'change-end': {
        const r = ctx.regions.get(at(n, T, 'change-id'));
        if (r && r.kind === 'ins' && ctx.insDepth) ctx.insDepth--;
        break;
      }
      case 'change': {
        const r = ctx.regions.get(at(n, T, 'change-id'));
        if (r && r.kind === 'del' && ctx.opts.changes !== 'final' && r.el) {
          const d = document.createElement(ctx.opts.changes === 'all' ? 'del' : 'span');
          if (ctx.opts.changes === 'all') { d.className = 'od-del'; d.title = t('Deleted by {who}', { who: r.author || '?' }); }
          d.textContent = all(r.el, 'p').map((p) => p.textContent).join(' ');
          into.append(d);
        }
        break;
      }
      case 'frame': odtFrame(n, into, ctx); break;
      case 'soft-page-break': break;
      default: odtInline(n, into, ctx, base);
    }
  }
}

function emitText(text, into, ctx, base) {
  if (!text) return;
  let node = document.createElement('span');
  const cls = [];
  if (base.b) cls.push('b');
  if (base.i) cls.push('i');
  if (base.u) cls.push('u');
  if (base.s) cls.push('s');
  if (base.sup) cls.push('sup');
  if (base.sub) cls.push('sub');
  if (cls.length) node.className = 'od-r ' + cls.join(' ');
  if (base.bg) { node.style.background = base.bg; node.style.color = readableOn(base.bg); }
  else if (base.color && luminanceOf(base.color) >= 0 && contrastOk(base.color, ctx.opts.surface)) node.style.color = base.color;
  if (ctx.sizes && base.size) node.style.fontSize = base.size + 'px';
  node.textContent = text;
  if (ctx.insDepth && ctx.opts.changes === 'all') { const ins = document.createElement('ins'); ins.className = 'od-ins'; ins.append(node); node = ins; }
  into.append(node);
}

function contrastOk(hex, surface) {
  const a = luminanceOf(hex), b = luminanceOf(surface);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 3;
}

function odtFrame(frame, into, ctx) {
  const image = all(frame, 'image')[0];
  if (image) {
    const href = at(image, XL, 'href');
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
      ctx.unsupported.picture++;
      into.append(Object.assign(document.createElement('span'), { className: 'od-missing', textContent: t('Picture on the web (not loaded)') }));
      return;
    }
    const img = document.createElement('img');
    const w = lengthPx(at(frame, SVG, 'width')), h = lengthPx(at(frame, SVG, 'height'));
    if (w > 0 && h > 0) { img.width = Math.round(w); img.height = Math.round(h); }
    const title = all(frame, 'title')[0] || all(frame, 'desc')[0];
    img.alt = title ? title.textContent : '';
    img.loading = 'lazy';
    into.append(img);
    ctx.pending.push({ img, href });
    return;
  }
  const box = all(frame, 'text-box')[0];
  if (box) {
    const span = document.createElement('span');
    span.className = 'od-txbx';
    for (const c of kids(box)) odtBlock(c, span, ctx);
    into.append(span);
    return;
  }
  if (all(frame, 'object').length || all(frame, 'object-ole').length) {
    ctx.unsupported.chart++;
    into.append(Object.assign(document.createElement('span'), { className: 'od-missing', textContent: t('Chart (not shown)') }));
  }
}

// ---- ODS ---------------------------------------------------------------------------------------------------------------------
// -> { sheets: [{ name, state }], styles: [..], date1904: false }  and  loadOdsSheet(model, i) -> sheet model
export function odsWorkbook(model) {
  const tables = all(model.doc, 'table').filter((e) => e.namespaceURI === TB && e.parentNode && e.parentNode.localName === 'spreadsheet');
  model.tables = tables;
  model.cellStyles = [{}];
  model.cellStyleIndex = new Map();
  return { sheets: tables.map((tb, i) => ({ name: at(tb, TB, 'name') || 'Sheet' + (i + 1), state: at(tb, TB, 'display') === 'false' ? 'hidden' : 'visible' })), date1904: false, styles: model.cellStyles, macros: model.macros };
}

function styleIndex(model, name, extra) {
  const key = (name || '') + '|' + (extra || '');
  if (model.cellStyleIndex.has(key)) return model.cellStyleIndex.get(key);
  const st = name ? styleOf(model, name, 'table-cell') : {};
  const s = {};
  if (st.b) s.b = 1;
  if (st.i) s.i = 1;
  if (st.color) s.color = st.color.slice(1);
  if (st.cellBg) s.fill = st.cellBg.slice(1);
  if (st.align) s.al = st.align === 'center' ? 'center' : st.align === 'right' ? 'right' : 'left';
  const code = st.dataStyle ? model.dataStyles.get(st.dataStyle) : null;
  if (code) s.nf = code; else if (extra) s.nf = extra;
  const idx = model.cellStyles.length;
  model.cellStyles.push(s);
  model.cellStyleIndex.set(key, idx);
  return idx;
}

function cellText(c) { return kids(c, 'p').map((p) => Array.from(p.childNodes).map(nodeText).join('')).join('\n'); }
function nodeText(n) {
  if (n.nodeType === 3) return n.nodeValue;
  if (n.nodeType !== 1) return '';
  if (n.localName === 's') return ' '.repeat(Math.min(+at(n, T, 'c') || 1, 200));
  if (n.localName === 'tab') return '\t';
  if (n.localName === 'line-break') return '\n';
  return Array.from(n.childNodes).map(nodeText).join('');
}

function isoToSerial(iso) {
  const m = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d)(?::(\d\d))?)?/.exec(iso || '');
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  let serial = (ms - Date.UTC(1899, 11, 30)) / 86400000;
  if (serial < 61) serial -= 1;
  return { serial, time: m[4] != null };
}
function durationToSerial(d) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(d || '');
  return m ? ((+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + parseFloat(m[3] || 0)) / 86400 : null;
}
function odsFormula(f) {
  // [.B1] [.B1:.C3] [$Sheet2.B1] ['My sheet'.B1]  ->  B1  B1:C3  Sheet2!B1  'My sheet'!B1
  return String(f).replace(/^of:/, '').replace(/^=/, '').replace(/\[([^\]]*)\]/g, (m, body) => body.split(':').map((part, i) => {
    const hit = /^\$?('[^']+'|[^.]*)\.(.+)$/.exec(part);
    if (!hit) return part;
    return (i === 0 && hit[1] ? hit[1] + '!' : '') + hit[2];
  }).join(':')).replace(/;/g, ',');
}

const ROW_CAP = 200000, COL_CAP = 1024, CELL_CAP = 1200000;
export function loadOdsSheet(model, index) {
  const tb = model.tables[index];
  const sheet = { rows: [], colWidths: {}, rowHeights: {}, hiddenCols: [], hiddenRows: [], merges: [], freeze: { rows: 0, cols: 0 }, filter: null, maxRow: 0, maxCol: 0, cells: 0, truncated: false, defaultCol: null, defaultRow: null };
  let c0 = 0;
  const colsOf = (parent) => { for (const c of kids(parent)) { if (c.localName === 'table-column') { const rep = Math.min(+at(c, TB, 'number-columns-repeated') || 1, COL_CAP); const st = styleOf(model, at(c, TB, 'style-name'), 'table-column'); for (let k = 0; k < rep; k++) { if (st.colWidth) sheet.colWidths[c0] = Math.round(st.colWidth); if (at(c, TB, 'visibility') === 'collapse' || at(c, TB, 'visibility') === 'filter') sheet.hiddenCols.push(c0); c0++; } } else if (c.localName === 'table-columns' || c.localName === 'table-header-columns' || c.localName === 'table-column-group') colsOf(c); } };
  colsOf(tb);
  let r = 0;
  const walkRows = (parent) => {
    for (const row of kids(parent)) {
      if (row.localName === 'table-rows' || row.localName === 'table-header-rows' || row.localName === 'table-row-group') { walkRows(row); continue; }
      if (row.localName !== 'table-row') continue;
      const rowRep = Math.min(+at(row, TB, 'number-rows-repeated') || 1, ROW_CAP);
      const cells = [];
      let c = 0, any = false;
      for (const cell of kids(row)) {
        if (cell.localName !== 'table-cell' && cell.localName !== 'covered-table-cell') continue;
        const rep = Math.min(+at(cell, TB, 'number-columns-repeated') || 1, COL_CAP);
        if (cell.localName === 'covered-table-cell') { c += rep; continue; }
        const vt = at(cell, OF, 'value-type');
        const styleName = at(cell, TB, 'style-name');
        let v = null, type = 'n', nf = null, f;
        if (vt === 'float' || vt === 'currency' || vt === 'percentage') { v = parseFloat(at(cell, OF, 'value')); if (vt === 'percentage') nf = '0%'; else if (vt === 'currency') nf = '#,##0.00 "' + (at(cell, OF, 'currency') || '') + '"'; if (!Number.isFinite(v)) v = null; }
        else if (vt === 'date') { const d = isoToSerial(at(cell, OF, 'date-value')); if (d) { v = d.serial; nf = d.time ? 22 : 14; } }
        else if (vt === 'time') { v = durationToSerial(at(cell, OF, 'time-value')); nf = 21; }
        else if (vt === 'boolean') { v = at(cell, OF, 'boolean-value') === 'true'; type = 'b'; }
        else if (vt === 'string') { v = at(cell, OF, 'string-value'); if (v == null) v = cellText(cell); type = 's'; }
        else if (kids(cell, 'p').length) { v = cellText(cell); type = 's'; }
        const fm = at(cell, TB, 'formula');
        if (fm) f = odsFormula(fm);
        if (v === null && !f && !styleName) { c += rep; continue; }
        const st = styleIndex(model, styleName, nf);
        const cs = +at(cell, TB, 'number-columns-spanned') || 1, rs = +at(cell, TB, 'number-rows-spanned') || 1;
        for (let k = 0; k < rep && c < COL_CAP; k++, c++) {
          const entry = [v, type, st];
          if (f) entry.push(f);
          if (v !== null || f) any = true;
          cells[c] = entry;
          if (cs > 1 || rs > 1) sheet.merges.push({ r1: r, c1: c, r2: r + rs - 1, c2: c + cs - 1 });
          if (v !== null || f) { sheet.cells++; if (c + 1 > sheet.maxCol) sheet.maxCol = c + 1; }
        }
      }
      const rst = styleOf(model, at(row, TB, 'style-name'), 'table-row');
      for (let k = 0; k < rowRep; k++, r++) {
        if (r >= ROW_CAP) { sheet.truncated = true; return; }
        if (rst.rowHeight) sheet.rowHeights[r] = Math.round(rst.rowHeight);
        if (at(row, TB, 'visibility') === 'collapse' || at(row, TB, 'visibility') === 'filter') sheet.hiddenRows.push(r);
        if (any) {
          const copy = cells.slice();
          for (let q = 0; q < copy.length; q++) if (copy[q] === undefined) copy[q] = null;
          sheet.rows[r] = copy;
          if (r + 1 > sheet.maxRow) sheet.maxRow = r + 1;
          if (sheet.cells >= CELL_CAP) { sheet.truncated = true; return; }
          if (rowRep > 1 && k > 50000) break;
        }
      }
    }
  };
  walkRows(tb);
  return sheet;
}

// ---- ODP ---------------------------------------------------------------------------------------------------------------------
export function odpModel(model) {
  const pages = all(model.doc, 'page').filter((e) => e.namespaceURI === DR);
  let w = 1058, h = 595;      // 28 x 15.75 cm
  if (model.stylesDoc) {
    const pl = all(model.stylesDoc, 'page-layout-properties')[0];
    if (pl) { w = lengthPx(at(pl, FO, 'page-width')) || w; h = lengthPx(at(pl, FO, 'page-height')) || h; }
  }
  model.pages = pages;
  model.size = { w, h };
  return { count: pages.length, size: model.size };
}

export async function renderOdpSlide(model, index, host) {
  const page = model.pages[index];
  host.textContent = '';
  const stage = document.createElement('div');
  stage.className = 'od-pslide';
  stage.style.width = model.size.w + 'px';
  stage.style.height = model.size.h + 'px';
  stage.style.background = '#ffffff';
  const unsupported = { shape: 0, chart: 0, diagram: 0, object: 0, media: 0, picture: 0 };
  const layer = document.createElement('div');
  layer.className = 'od-player';
  stage.append(layer);
  const ctx = { model, opts: { changes: 'final', comments: false, surface: '#ffffff' }, outline: [], comments: [], notes: [], unsupported: { picture: 0, chart: 0, diagram: 0, shape: 0 }, regions: new Map(), insDepth: 0, delDepth: 0, pending: [], heading: 0, sizes: true };
  const pst = styleOf(model, at(page, DR, 'style-name'), 'drawing-page');
  const dp = model.styles.get('drawing-page:' + at(page, DR, 'style-name'));
  if (dp && dp.fill) stage.style.background = dp.fill;
  const drawFrameEl = (fr) => {
    const x = lengthPx(at(fr, SVG, 'x')), y = lengthPx(at(fr, SVG, 'y')), w = lengthPx(at(fr, SVG, 'width')), h = lengthPx(at(fr, SVG, 'height'));
    const el = document.createElement('div');
    el.className = 'od-pshape';
    el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.width = w + 'px'; el.style.height = h + 'px';
    const gst = styleOf(model, at(fr, DR, 'style-name') || at(fr, DR, 'class-names'), 'graphic');
    if (gst.fill) el.style.background = gst.fill;
    return { el, x, y, w, h };
  };
  for (const fr of kids(page)) {
    if (fr.localName === 'frame') {
      const { el } = drawFrameEl(fr);
      const img = kid(fr, 'image'), tbx = kid(fr, 'text-box');
      if (img) {
        const href = at(img, XL, 'href');
        const url = href && !/^[a-z][a-z0-9+.-]*:/i.test(href) ? await imageUrl(model, href) : null;
        el.className = 'od-ppic';
        if (url) { const im = document.createElement('img'); im.src = url; im.alt = ''; el.append(im); }
        else { unsupported.picture++; el.classList.add('od-pmissing'); el.textContent = t('Picture not shown'); }
      } else if (tbx) {
        const box = document.createElement('div');
        box.className = 'od-ptext';
        for (const c of kids(tbx)) {
          if (c.localName === 'p' || c.localName === 'h') {
            const p = document.createElement('div');
            p.className = 'od-pp';
            const st = styleOf(model, at(c, T, 'style-name'), 'paragraph');
            p.style.textAlign = st.align === 'center' || st.align === 'right' ? st.align : 'left';
            odtInline(c, p, ctx, st);
            p.style.fontSize = ((st.size || 24) ) + 'px';
            if (!p.childNodes.length) p.append(document.createElement('br'));
            box.append(p);
          } else if (c.localName === 'list') odtList(c, box, ctx, 1, at(c, T, 'style-name'));
        }
        el.append(box);
      } else if (kid(fr, 'object') || kid(fr, 'object-ole')) { unsupported.chart++; el.className = 'od-ppic od-pmissing'; el.textContent = t('Embedded object (not shown)'); }
      else continue;
      layer.append(el);
    } else if (/^(rect|ellipse|custom-shape|line|polygon|path|connector)$/.test(fr.localName)) {
      const x = lengthPx(at(fr, SVG, 'x')), y = lengthPx(at(fr, SVG, 'y')), w = lengthPx(at(fr, SVG, 'width')), h = lengthPx(at(fr, SVG, 'height'));
      const el = document.createElement('div');
      el.className = 'od-pshape';
      el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.width = w + 'px'; el.style.height = h + 'px';
      const gst = styleOf(model, at(fr, DR, 'style-name'), 'graphic');
      if (gst.fill) el.style.background = gst.fill;
      if (gst.stroke) el.style.border = '1px solid ' + gst.stroke;
      if (fr.localName === 'ellipse') el.style.borderRadius = '50%';
      if (fr.localName === 'custom-shape' || fr.localName === 'polygon' || fr.localName === 'path') { unsupported.shape++; el.classList.add('od-pdraft'); }
      layer.append(el);
      const txt = kids(fr, 'p');
      if (txt.length) { const box = document.createElement('div'); box.className = 'od-ptext'; for (const p of txt) { const d = document.createElement('div'); d.className = 'od-pp'; odtInline(p, d, ctx, {}); d.style.textAlign = 'center'; d.style.fontSize = '24px'; box.append(d); } el.append(box); }
    }
  }
  for (const p of ctx.pending) { const url = await imageUrl(model, p.href); if (url) p.img.src = url; }
  host.append(stage);
  const notesEl = kid(page, 'notes');
  const notes = notesEl ? all(notesEl, 'p').map((p) => nodeText(p)).filter(Boolean).join('\n') : '';
  const text = all(page, 'p').filter((p) => !notesEl || !notesEl.contains(p)).map((p) => nodeText(p)).filter(Boolean).join('\n');
  void pst;
  return { text, notes, unsupported, flags: { animations: false, transition: false }, stage };
}

export function odpTitles(model) {
  return model.pages.map((pg, i) => {
    const p = all(pg, 'p').find((x) => !(kid(pg, 'notes') && kid(pg, 'notes').contains(x)));
    return (p && nodeText(p).trim()) || at(pg, DR, 'name') || t('Slide {n}', { n: i + 1 });
  });
}
export function odpText(model, i) {
  const pg = model.pages[i];
  const notesEl = kid(pg, 'notes');
  return all(pg, 'p').filter((p) => !(notesEl && notesEl.contains(p))).map((p) => nodeText(p)).filter(Boolean).join('\n');
}
export function odpNotes(model, i) {
  const notesEl = kid(model.pages[i], 'notes');
  return notesEl ? all(notesEl, 'p').map((p) => nodeText(p)).filter(Boolean).join('\n') : '';
}
