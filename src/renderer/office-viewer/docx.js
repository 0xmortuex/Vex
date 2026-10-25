// A .docx read into a DOM the viewer can show. Written for reading: headings, paragraphs, lists (with their numbering),
// tables (merged cells too), pictures, links, footnotes and endnotes, comments, tracked changes (shown, or accepted, or
// rejected), text boxes, equations as their text. Not shown, and said so by the viewer: headers and footers, page layout
// (columns, exact page breaks), charts, SmartArt, drawn shapes without text, fields' codes.
//
// Safe by construction: every node is made with createElement / textContent (never innerHTML); a link is kept only if it is
// http, https or mailto; a picture is only ever a part of the file itself (a blob), never fetched; macros are not touched.

import { NS, parseXml, parseRels, kids, kid, all, attr, resolvePath, dirOf, imageMime, isUndrawable, safeHref, EMU_PER_PX, twipsToPx, readableOn, luminanceOf } from './xml.js';
import { t } from './strings.js';

const W = NS.w;
const wattr = (el, name) => (el ? el.getAttributeNS(W, name) : null);
const onOff = (el) => { if (!el) return false; const v = wattr(el, 'val'); return !(v === '0' || v === 'false' || v === 'off'); };

// ---- loading -------------------------------------------------------------------------------------------
// pkg: { has(name), text(name), bytes(name), texts(names) }.  Returns the model renderDocx draws.
export async function loadDocx(pkg) {
  let mainPath = 'word/document.xml';
  const rootRels = pkg.has('_rels/.rels') ? parseRels(await pkg.text('_rels/.rels'), '') : {};
  for (const r of Object.values(rootRels)) if (r.type === 'officeDocument') mainPath = r.target;
  if (!pkg.has(mainPath)) throw Object.assign(new Error('This file has no document body. It may not be a Word document'), { code: 'corrupt' });
  const base = dirOf(mainPath);
  const relsPath = base + '_rels/' + mainPath.slice(base.length) + '.rels';
  const rels = pkg.has(relsPath) ? parseRels(await pkg.text(relsPath), base) : {};
  const partPath = (type) => { const r = Object.values(rels).find((x) => x.type === type); return r && pkg.has(r.target) ? r.target : null; };

  const doc = parseXml(await pkg.text(mainPath), 'The document');
  const model = { doc, rels, base, styles: new Map(), numbering: null, footnotes: new Map(), endnotes: new Map(), comments: new Map(), images: new Map(), props: {}, macros: pkg.has('word/vbaProject.bin'), defaults: { sz: 22 } };

  const stylesPath = partPath('styles');
  if (stylesPath) readStyles(parseXml(await pkg.text(stylesPath), 'The styles'), model);
  const numPath = partPath('numbering');
  if (numPath) model.numbering = readNumbering(parseXml(await pkg.text(numPath), 'The numbering'));
  for (const [type, map] of [['footnotes', model.footnotes], ['endnotes', model.endnotes]]) {
    const p = partPath(type);
    if (!p) continue;
    const x = parseXml(await pkg.text(p), 'The ' + type);
    for (const n of all(x, type === 'footnotes' ? 'footnote' : 'endnote')) {
      const kind = wattr(n, 'type');
      if (kind === 'separator' || kind === 'continuationSeparator' || kind === 'continuationNotice') continue;
      map.set(wattr(n, 'id'), n);
    }
  }
  const cPath = partPath('comments');
  if (cPath) {
    const x = parseXml(await pkg.text(cPath), 'The comments');
    for (const c of all(x, 'comment')) model.comments.set(wattr(c, 'id'), { id: wattr(c, 'id'), author: wattr(c, 'author') || '', date: wattr(c, 'date') || '', el: c, text: commentText({ el: c }) });
  }
  if (pkg.has('docProps/core.xml')) {
    try {
      const core = parseXml(await pkg.text('docProps/core.xml'), 'The properties');
      const title = all(core, 'title')[0], creator = all(core, 'creator')[0];
      model.props = { title: title ? title.textContent.trim() : '', author: creator ? creator.textContent.trim() : '' };
    } catch { model.props = {}; }
  }
  // The pictures the body and the notes name: read once, together.
  const want = new Set();
  for (const root of [doc, ...model.footnotes.values(), ...model.endnotes.values()]) {
    for (const b of all(root, 'blip')) { const id = b.getAttributeNS(NS.r, 'embed'); if (id && rels[id] && !rels[id].external) want.add(rels[id].target); }
    for (const b of all(root, 'imagedata')) { const id = b.getAttributeNS(NS.r, 'id'); if (id && rels[id] && !rels[id].external) want.add(rels[id].target); }
  }
  const list = [...want].filter((p) => pkg.has(p) && imageMime(p) && !isUndrawable(p));
  if (list.length) {
    const parts = await pkg.bytes(list);
    for (const p of list) if (parts[p]) model.images.set(p, URL.createObjectURL(new Blob([parts[p]], { type: imageMime(p) })));
  }
  const sect = all(doc, 'sectPr').pop();
  const sz = sect ? kid(sect, 'pgSz') : null, mar = sect ? kid(sect, 'pgMar') : null;
  model.page = {
    w: sz ? twipsToPx(wattr(sz, 'w')) || 794 : 794, h: sz ? twipsToPx(wattr(sz, 'h')) || 1123 : 1123,
    top: mar ? twipsToPx(wattr(mar, 'top')) : 96, right: mar ? twipsToPx(wattr(mar, 'right')) : 96, bottom: mar ? twipsToPx(wattr(mar, 'bottom')) : 96, left: mar ? twipsToPx(wattr(mar, 'left')) : 96,
  };
  model.hasChanges = all(doc, 'ins').length + all(doc, 'del').length > 0;
  model.hasComments = model.comments.size > 0;
  return model;
}

export function releaseDocx(model) { for (const u of model.images.values()) URL.revokeObjectURL(u); model.images.clear(); }

function readStyles(x, model) {
  const dd = all(x, 'docDefaults')[0];
  const sz = dd && all(dd, 'sz')[0];
  if (sz && wattr(sz, 'val')) model.defaults.sz = +wattr(sz, 'val');
  for (const s of all(x, 'style')) {
    const id = wattr(s, 'styleId');
    const name = wattr(kid(s, 'name'), 'val') || '';
    const ppr = kid(s, 'pPr'), rpr = kid(s, 'rPr');
    model.styles.set(id, { id, name, basedOn: wattr(kid(s, 'basedOn'), 'val'), type: wattr(s, 'type'), ppr, rpr });
  }
}

function readNumbering(x) {
  const abstracts = new Map(), nums = new Map();
  for (const a of all(x, 'abstractNum')) {
    const lv = new Map();
    for (const l of kids(a, 'lvl')) lv.set(+wattr(l, 'ilvl'), { fmt: wattr(kid(l, 'numFmt'), 'val') || 'decimal', start: +(wattr(kid(l, 'start'), 'val') || 1) });
    abstracts.set(wattr(a, 'abstractNumId'), lv);
  }
  for (const n of all(x, 'num')) {
    const over = new Map();
    for (const o of kids(n, 'lvlOverride')) { const s = kid(o, 'startOverride'); if (s) over.set(+wattr(o, 'ilvl'), +wattr(s, 'val')); }
    nums.set(wattr(n, 'numId'), { abstract: wattr(kid(n, 'abstractNumId'), 'val'), over });
  }
  return { abstracts, nums };
}

// ---- style resolution ----------------------------------------------------------------------------------
function styleChain(model, id) {
  const chain = [];
  const seen = new Set();
  for (let s = model.styles.get(id); s && !seen.has(s.id); s = model.styles.get(s.basedOn)) { seen.add(s.id); chain.unshift(s); }
  return chain;
}
function rprOf(rpr) {
  const o = {};
  if (!rpr) return o;
  for (const e of kids(rpr)) {
    switch (e.localName) {
      case 'b': o.b = onOff(e); break;
      case 'i': o.i = onOff(e); break;
      case 'u': o.u = wattr(e, 'val') !== 'none'; break;
      case 'strike': case 'dstrike': o.s = onOff(e); break;
      case 'caps': o.caps = onOff(e); break;
      case 'smallCaps': o.smallCaps = onOff(e); break;
      case 'vanish': o.hidden = onOff(e); break;
      case 'vertAlign': o.va = wattr(e, 'val'); break;
      case 'color': { const v = wattr(e, 'val'); if (v && v !== 'auto' && /^[0-9a-f]{6}$/i.test(v)) o.color = v.toLowerCase(); break; }
      case 'highlight': { const v = wattr(e, 'val'); if (v && v !== 'none') o.highlight = v; break; }
      case 'shd': { const v = wattr(e, 'fill'); if (v && v !== 'auto' && /^[0-9a-f]{6}$/i.test(v)) o.shade = v.toLowerCase(); break; }
      case 'sz': o.sz = +wattr(e, 'val'); break;
      case 'rFonts': { const f = wattr(e, 'ascii'); if (f && /mono|courier|consolas|code/i.test(f)) o.mono = true; break; }
      default: break;
    }
  }
  return o;
}
function pprOf(ppr) {
  const o = {};
  if (!ppr) return o;
  const jc = wattr(kid(ppr, 'jc'), 'val');
  if (jc) o.jc = jc;
  const ol = kid(ppr, 'outlineLvl');
  if (ol) o.outline = +wattr(ol, 'val');
  const num = kid(ppr, 'numPr');
  if (num) { const id = wattr(kid(num, 'numId'), 'val'); o.numId = id; o.ilvl = +(wattr(kid(num, 'ilvl'), 'val') || 0); }
  const ind = kid(ppr, 'ind');
  if (ind) { o.indent = twipsToPx(wattr(ind, 'left') || wattr(ind, 'start')); }
  const shd = kid(ppr, 'shd');
  if (shd) { const f = wattr(shd, 'fill'); if (f && f !== 'auto' && /^[0-9a-f]{6}$/i.test(f)) o.shade = f.toLowerCase(); }
  return o;
}
function resolvedPara(model, ppr) {
  const style = wattr(kid(ppr, 'pStyle'), 'val');
  let p = {}, r = {};
  const chain = style ? styleChain(model, style) : [];
  for (const s of chain) { p = { ...p, ...pprOf(s.ppr) }; r = { ...r, ...rprOf(s.rpr) }; }
  p = { ...p, ...pprOf(ppr) };
  const name = chain.length ? chain[chain.length - 1].name : '';
  return { p, r, style, name };
}

// ---- drawing ----------------------------------------------------------------------------------------------
const HIGHLIGHT = { yellow: '#fff200', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000', darkBlue: '#00008b', darkCyan: '#008b8b', darkGreen: '#006400', darkMagenta: '#8b008b', darkRed: '#8b0000', darkYellow: '#808000', darkGray: '#a9a9a9', lightGray: '#d3d3d3', black: '#000000', white: '#ffffff' };
const NUMBER_STYLE = { decimal: 'decimal', lowerLetter: 'lower-alpha', upperLetter: 'upper-alpha', lowerRoman: 'lower-roman', upperRoman: 'upper-roman', decimalZero: 'decimal-leading-zero' };

// opts: { changes: 'all' | 'final' | 'original', comments: boolean, surface: '#rrggbb' (the colour text sits on), paper: boolean }
export async function renderDocx(model, host, opts = {}) {
  const ctx = {
    model, opts: { changes: 'all', comments: true, surface: '#ffffff', paper: false, ...opts }, notes: [], noteIndex: new Map(), endnotes: [], commentOrder: [],
    outline: [], active: new Set(), counters: new Map(), unsupported: { chart: 0, diagram: 0, picture: 0, shape: 0 }, headingCount: 0, token: opts.token || { cancelled: false },
  };
  ctx.surfaceDark = luminanceOf(ctx.opts.surface) < 0.4;
  host.textContent = '';
  const body = kid(model.doc.documentElement, 'body');
  if (!body) throw Object.assign(new Error('This file has no document body'), { code: 'corrupt' });
  const root = document.createElement('div');
  root.className = 'od-doc';
  host.append(root);
  let n = 0;
  const list = { stack: [] };
  for (const child of kids(body)) {
    if (ctx.token.cancelled) return null;
    blockElement(child, root, ctx, list);
    if (++n % 120 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  endList(list);
  const sections = [];
  if (ctx.notes.length) sections.push(notesSection(ctx, ctx.notes, model.footnotes, t('Footnotes'), 'fn'));
  if (ctx.endnotes.length) sections.push(notesSection(ctx, ctx.endnotes, model.endnotes, t('Endnotes'), 'en'));
  for (const s of sections) root.append(s);
  return { root, outline: ctx.outline, comments: ctx.commentOrder.map((id) => model.comments.get(id)).filter(Boolean), unsupported: ctx.unsupported };
}

function endList(list) { list.stack.length = 0; }

function blockElement(el, container, ctx, list) {
  switch (el.localName) {
    case 'p': paragraph(el, container, ctx, list); break;
    case 'tbl': endList(list); container.append(table(el, ctx)); break;
    case 'sdt': { const c = kid(el, 'sdtContent'); if (c) for (const k of kids(c)) blockElement(k, container, ctx, list); break; }
    case 'customXml': case 'smartTag': for (const k of kids(el)) blockElement(k, container, ctx, list); break;
    case 'AlternateContent': { const ch = kid(el, 'Choice') || kid(el, 'Fallback'); if (ch) for (const k of kids(ch)) blockElement(k, container, ctx, list); break; }
    case 'ins': case 'moveTo': case 'del': case 'moveFrom': {
      const removed = el.localName === 'del' || el.localName === 'moveFrom';
      if ((removed && ctx.opts.changes === 'final') || (!removed && ctx.opts.changes === 'original')) break;
      for (const k of kids(el)) blockElement(k, container, ctx, list);
      break;
    }
    default: break;     // sectPr, bookmarks between paragraphs, ...
  }
}

function paragraph(p, container, ctx, list) {
  const { model } = ctx;
  const ppr = kid(p, 'pPr');
  const res = resolvedPara(model, ppr);
  // A paragraph whose mark was inserted or deleted by a tracked change and has no content is dropped in the matching mode.
  const mark = ppr && kid(kid(ppr, 'rPr'), 'ins') ? 'ins' : (ppr && kid(kid(ppr, 'rPr'), 'del') ? 'del' : null);
  const name = (res.name || '').toLowerCase();
  let level = 0;
  const hm = /^heading\s*(\d)/.exec(name);
  if (hm) level = Math.min(6, +hm[1]);
  else if (name === 'title') level = 1;
  else if (res.p.outline != null && res.p.outline < 9 && !res.p.numId) level = Math.min(6, res.p.outline + 1);
  const numbered = !level && res.p.numId && res.p.numId !== '0' && model.numbering;
  let el;
  if (numbered) el = listItem(res.p, container, ctx, list);
  else {
    endList(list);
    el = document.createElement(level ? 'h' + level : 'p');
    if (name === 'subtitle') el.classList.add('od-subtitle');
    if (name === 'title') el.classList.add('od-title');
    if (/quote/.test(name)) el.classList.add('od-quote');
    if (/^(code|html preformatted|source code)/.test(name) || res.r.mono) el.classList.add('od-code');
    container.append(el);
  }
  if (res.p.jc === 'center') el.style.textAlign = 'center';
  else if (res.p.jc === 'right' || res.p.jc === 'end') el.style.textAlign = 'right';
  else if (res.p.jc === 'both') el.style.textAlign = 'justify';
  if (res.p.indent > 0 && ctx.opts.paper && !numbered && res.p.indent < 400) el.style.marginInlineStart = Math.round(res.p.indent) + 'px';
  if (res.p.shade) shade(el, res.p.shade);
  const before = el.childNodes.length;
  inlines(p, el, ctx, res.r, res);
  if (level) {
    const text = el.textContent.trim();
    if (text) {
      const id = 'od-h-' + (++ctx.headingCount);
      el.id = id;
      ctx.outline.push({ level, text, id });
    }
  }
  if (!numbered && el.childNodes.length === before && !hasBreak(p)) {
    if (mark) el.remove();
    else if (!level) { el.classList.add('od-empty'); el.append(document.createElement('br')); }
  } else if (numbered && el.childNodes.length === before && mark) el.remove();
}
function hasBreak(p) { return all(p, 'br').length > 0 || all(p, 'drawing').length > 0; }

function shade(el, fill) {
  el.style.background = '#' + fill;
  el.style.color = readableOn(fill);
}

function listItem(pp, container, ctx, list) {
  const { numbering } = ctx.model;
  const num = numbering.nums.get(pp.numId);
  const abs = num && numbering.abstracts.get(num.abstract);
  const lvl = abs && abs.get(pp.ilvl);
  const bullet = !lvl || lvl.fmt === 'bullet' || lvl.fmt === 'none';
  const tag = bullet ? 'ul' : 'ol';
  const stack = list.stack;
  while (stack.length && stack[stack.length - 1].ilvl > pp.ilvl) stack.pop();
  let top = stack[stack.length - 1];
  if (top && top.ilvl === pp.ilvl && (top.numId !== pp.numId || top.tag !== tag)) { stack.pop(); top = stack[stack.length - 1]; }
  if (!top || top.ilvl < pp.ilvl) {
    const listEl = document.createElement(tag);
    if (!bullet) {
      listEl.style.listStyleType = NUMBER_STYLE[lvl.fmt] || 'decimal';
      const key = pp.numId + ':' + pp.ilvl;
      const start = ctx.counters.has(key) ? ctx.counters.get(key) + 1 : (num.over.get(pp.ilvl) != null ? num.over.get(pp.ilvl) : lvl.start);
      if (start !== 1) listEl.start = start;
    }
    let parent = container;
    if (top) { parent = top.el.lastElementChild || top.el; }
    parent.append(listEl);
    top = { el: listEl, ilvl: pp.ilvl, numId: pp.numId, tag };
    stack.push(top);
  }
  if (!bullet) {
    const key = pp.numId + ':' + pp.ilvl;
    const next = ctx.counters.has(key) ? ctx.counters.get(key) + 1 : (num.over.get(pp.ilvl) != null ? num.over.get(pp.ilvl) : lvl.start);
    ctx.counters.set(key, next);
    for (const k of [...ctx.counters.keys()]) { const [id, l] = k.split(':'); if (id === pp.numId && +l > pp.ilvl) ctx.counters.delete(k); }
  }
  const li = document.createElement('li');
  top.el.append(li);
  return li;
}

// ---- inline content -----------------------------------------------------------------------------------
function inlines(parent, into, ctx, baseR, para) {
  for (const c of kids(parent)) inlineElement(c, into, ctx, baseR, para);
}

function inlineElement(c, into, ctx, baseR, para) {
  switch (c.localName) {
    case 'r': run(c, into, ctx, baseR); break;
    case 'hyperlink': {
      const id = c.getAttributeNS(NS.r, 'id');
      const anchor = wattr(c, 'anchor');
      let href = null;
      if (id) { const rel = ctx.model.rels[id]; href = rel && rel.external ? safeHref(rel.target) : null; }
      else if (anchor) href = '#bm-' + anchor;
      if (href) {
        const a = document.createElement('a');
        a.href = href;
        if (href[0] !== '#') { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
        into.append(a);
        inlines(c, a, ctx, baseR, para);
      } else inlines(c, into, ctx, baseR, para);
      break;
    }
    case 'fldSimple': {
      const m = /HYPERLINK\s+"([^"]+)"/i.exec(wattr(c, 'instr') || '');
      const href = m && safeHref(m[1]);
      if (href) { const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; into.append(a); inlines(c, a, ctx, baseR, para); }
      else inlines(c, into, ctx, baseR, para);
      break;
    }
    case 'ins': case 'moveTo': {
      if (ctx.opts.changes === 'original') break;
      if (ctx.opts.changes === 'all') {
        const e = document.createElement('ins');
        e.className = 'od-ins';
        e.title = t('Added by {who}', { who: wattr(c, 'author') || '?' }) + (wattr(c, 'date') ? ', ' + wattr(c, 'date').slice(0, 10) : '');
        into.append(e);
        inlines(c, e, ctx, baseR, para);
      } else inlines(c, into, ctx, baseR, para);
      break;
    }
    case 'del': case 'moveFrom': {
      if (ctx.opts.changes === 'final') break;
      if (ctx.opts.changes === 'all') {
        const e = document.createElement('del');
        e.className = 'od-del';
        e.title = t('Deleted by {who}', { who: wattr(c, 'author') || '?' }) + (wattr(c, 'date') ? ', ' + wattr(c, 'date').slice(0, 10) : '');
        into.append(e);
        inlines(c, e, ctx, baseR, para);
      } else inlines(c, into, ctx, baseR, para);
      break;
    }
    case 'sdt': { const k = kid(c, 'sdtContent'); if (k) inlines(k, into, ctx, baseR, para); break; }
    case 'smartTag': case 'customXml': case 'sdtContent': inlines(c, into, ctx, baseR, para); break;
    case 'AlternateContent': { const ch = kid(c, 'Choice') || kid(c, 'Fallback'); if (ch) inlines(ch, into, ctx, baseR, para); break; }
    case 'bookmarkStart': {
      const name = wattr(c, 'name');
      if (name && !/^_/.test(name)) { const a = document.createElement('a'); a.id = 'bm-' + name; a.className = 'od-anchor'; into.append(a); }
      break;
    }
    case 'commentRangeStart': ctx.active.add(wattr(c, 'id')); break;
    case 'commentRangeEnd': ctx.active.delete(wattr(c, 'id')); break;
    case 'oMath': case 'oMathPara': {
      const s = document.createElement('span');
      s.className = 'od-math';
      s.textContent = all(c, 't').map((x) => x.textContent).join('');
      into.append(s);
      break;
    }
    default: break;
  }
}

function run(r, into, ctx, baseR) {
  const props = { ...baseR };
  const rstyle = wattr(kid(kid(r, 'rPr'), 'rStyle'), 'val');
  if (rstyle) for (const s of styleChain(ctx.model, rstyle)) Object.assign(props, rprOf(s.rpr));
  Object.assign(props, rprOf(kid(r, 'rPr')));
  if (props.hidden) return;
  const span = document.createElement('span');
  const cls = [];
  if (props.b) cls.push('b');
  if (props.i) cls.push('i');
  if (props.u) cls.push('u');
  if (props.s) cls.push('s');
  if (props.caps) cls.push('caps');
  if (props.smallCaps) cls.push('sc');
  if (props.mono) cls.push('mono');
  if (props.va === 'superscript') cls.push('sup');
  if (props.va === 'subscript') cls.push('sub');
  if (cls.length) span.className = 'od-r ' + cls.join(' ');
  // A colour the file chose is kept only if it reads on the colour the text sits on (a dark theme would swallow black text).
  const bg = props.highlight ? (HIGHLIGHT[props.highlight] || null) : (props.shade ? '#' + props.shade : null);
  if (bg) { span.style.background = bg; span.style.color = readableOn(bg); }
  else if (props.color && contrastOk(props.color, ctx.opts.surface)) span.style.color = '#' + props.color;
  if (ctx.opts.paper && props.sz && ctx.model.defaults.sz && Math.abs(props.sz - ctx.model.defaults.sz) >= 2) span.style.fontSize = (props.sz / ctx.model.defaults.sz).toFixed(2) + 'em';
  const commenting = ctx.opts.comments && ctx.active.size ? [...ctx.active] : null;
  let target = span;
  if (commenting) { const m = document.createElement('mark'); m.className = 'od-cmr'; m.dataset.cid = commenting.join(' '); m.append(span); into.append(m); } else into.append(span);
  for (const e of kids(r)) {
    switch (e.localName) {
      case 't': case 'delText': target.append(document.createTextNode(e.textContent)); break;
      case 'tab': case 'ptab': target.append(document.createTextNode(' ')); break;
      case 'noBreakHyphen': target.append(document.createTextNode('‑')); break;
      case 'br': case 'cr': {
        if (wattr(e, 'type') === 'page') { const hr = document.createElement('hr'); hr.className = 'od-pagebreak'; into.append(hr); }
        else target.append(document.createElement('br'));
        break;
      }
      case 'drawing': drawing(e, into, ctx); break;
      case 'pict': case 'object': pict(e, into, ctx); break;
      case 'footnoteReference': noteRef(e, into, ctx, 'fn'); break;
      case 'endnoteReference': noteRef(e, into, ctx, 'en'); break;
      case 'commentReference': {
        const id = wattr(e, 'id');
        const c = ctx.model.comments.get(id);
        if (!c || !ctx.opts.comments) break;
        if (!ctx.commentOrder.includes(id)) ctx.commentOrder.push(id);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'od-cm';
        b.dataset.cid = id;
        b.textContent = String(ctx.commentOrder.indexOf(id) + 1);
        b.setAttribute('aria-label', t('Comment {n} by {who}', { n: ctx.commentOrder.indexOf(id) + 1, who: c.author || '?' }));
        into.append(b);
        break;
      }
      default: break;
    }
  }
}

function contrastOk(hex, surface) {
  const a = luminanceOf(hex), b = luminanceOf(surface);
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05) >= 3;
}

function noteRef(e, into, ctx, kind) {
  const id = wattr(e, 'id');
  const list = kind === 'fn' ? ctx.notes : ctx.endnotes;
  const map = kind === 'fn' ? ctx.model.footnotes : ctx.model.endnotes;
  if (!map.has(id)) return;
  if (!list.includes(id)) list.push(id);
  const sup = document.createElement('sup');
  const a = document.createElement('a');
  a.id = kind + 'ref-' + id;
  a.href = '#' + kind + '-' + id;
  a.className = 'od-noteref';
  a.textContent = String(list.indexOf(id) + 1);
  a.setAttribute('aria-label', (kind === 'fn' ? t('Footnote') : t('Endnote')) + ' ' + (list.indexOf(id) + 1));
  sup.append(a);
  into.append(sup);
}

function notesSection(ctx, ids, map, title, kind) {
  const sec = document.createElement('section');
  sec.className = 'od-notes';
  sec.setAttribute('aria-label', title);
  const h = document.createElement('h2');
  h.textContent = title;
  sec.append(h);
  const ol = document.createElement('ol');
  sec.append(ol);
  for (const id of ids) {
    const li = document.createElement('li');
    li.id = kind + '-' + id;
    const list = { stack: [] };
    for (const k of kids(map.get(id))) blockElement(k, li, ctx, list);
    const back = document.createElement('a');
    back.href = '#' + kind + 'ref-' + id;
    back.className = 'od-noteback';
    back.textContent = '↩';
    back.setAttribute('aria-label', t('Back to the text'));
    (li.lastElementChild || li).append(document.createTextNode(' '), back);
    ol.append(li);
  }
  return sec;
}

// ---- pictures, text boxes -----------------------------------------------------------------------------------
function placeholder(ctx, kind, label) {
  ctx.unsupported[kind] = (ctx.unsupported[kind] || 0) + 1;
  const s = document.createElement('span');
  s.className = 'od-missing';
  s.textContent = label;
  return s;
}

function pictureNode(ctx, relId, linkId, alt, w, h) {
  const rel = relId ? ctx.model.rels[relId] : null;
  if (!rel) {
    if (linkId) return placeholder(ctx, 'picture', t('Picture on the web (not loaded)'));
    return null;
  }
  const url = ctx.model.images.get(rel.target);
  if (!url) return placeholder(ctx, 'picture', isUndrawable(rel.target) ? t('Picture in a format Vex cannot draw ({ext})', { ext: rel.target.split('.').pop().toUpperCase() }) : t('Picture not shown'));
  const img = document.createElement('img');
  img.src = url;
  img.alt = alt || '';
  img.loading = 'lazy';
  img.decoding = 'async';
  if (w > 0 && h > 0) { img.width = Math.round(w); img.height = Math.round(h); }
  return img;
}

function drawing(d, into, ctx) {
  const graphicData = all(d, 'graphicData')[0];
  const uri = graphicData ? graphicData.getAttribute('uri') || '' : '';
  if (/chart/i.test(uri)) { into.append(placeholder(ctx, 'chart', t('Chart (not shown)'))); return; }
  if (/diagram/i.test(uri)) { into.append(placeholder(ctx, 'diagram', t('Diagram (not shown)'))); return; }
  const docPr = all(d, 'docPr')[0];
  const alt = (docPr && (docPr.getAttribute('descr') || docPr.getAttribute('title'))) || '';
  const ext = all(d, 'extent')[0];
  const w = ext ? (+ext.getAttribute('cx') || 0) / EMU_PER_PX : 0, h = ext ? (+ext.getAttribute('cy') || 0) / EMU_PER_PX : 0;
  const blip = all(d, 'blip')[0];
  if (blip) {
    const node = pictureNode(ctx, blip.getAttributeNS(NS.r, 'embed'), blip.getAttributeNS(NS.r, 'link'), alt, w, h);
    if (node) into.append(node);
    return;
  }
  const box = all(d, 'txbxContent')[0];
  if (box) { textBox(box, into, ctx); return; }
  if (all(d, 'wsp').length) ctx.unsupported.shape++;
}

function pict(p, into, ctx) {
  const img = all(p, 'imagedata')[0];
  if (img) { const node = pictureNode(ctx, img.getAttributeNS(NS.r, 'id'), null, img.getAttributeNS(NS.o || 'urn:schemas-microsoft-com:office:office', 'title') || '', 0, 0); if (node) into.append(node); return; }
  const box = all(p, 'txbxContent')[0];
  if (box) textBox(box, into, ctx);
}

function textBox(box, into, ctx) {
  const div = document.createElement('span');
  div.className = 'od-txbx';
  const list = { stack: [] };
  for (const k of kids(box)) blockElement(k, div, ctx, list);
  into.append(div);
}

// ---- tables -------------------------------------------------------------------------------------------------
function table(tbl, ctx) {
  const el = document.createElement('table');
  el.className = 'od-table';
  const rows = kids(tbl, 'tr');
  const grid = [];        // grid[r][col] = { td, rs }
  const tbody = document.createElement('tbody');
  const thead = document.createElement('thead');
  let headRows = 0;
  rows.forEach((tr, ri) => {
    const trPr = kid(tr, 'trPr');
    const isHead = !!(trPr && kid(trPr, 'tblHeader')) && headRows === ri;
    if (isHead) headRows++;
    const rowEl = document.createElement('tr');
    grid[ri] = [];
    let col = 0;
    const cells = [];
    const collect = (parent) => { for (const c of kids(parent)) { if (c.localName === 'tc') cells.push(c); else if (c.localName === 'sdt') { const sc = kid(c, 'sdtContent'); if (sc) collect(sc); } else if (c.localName === 'ins' || c.localName === 'del') collect(c); } };
    collect(tr);
    for (const tc of cells) {
      const pr = kid(tc, 'tcPr');
      const span = +(wattr(kid(pr, 'gridSpan'), 'val') || 1);
      const vm = kid(pr, 'vMerge');
      const vmVal = vm ? (wattr(vm, 'val') || 'continue') : null;
      if (vmVal === 'continue') {
        // belongs to the cell above in the same grid column
        for (let r = ri - 1; r >= 0; r--) {
          const above = grid[r][col];
          if (above && above.td) { above.td.rowSpan = (above.td.rowSpan || 1) + 1; break; }
        }
        for (let k = 0; k < span; k++) grid[ri][col + k] = { td: null };
        col += span;
        continue;
      }
      const td = document.createElement(isHead ? 'th' : 'td');
      if (span > 1) td.colSpan = span;
      const fill = wattr(kid(pr, 'shd'), 'fill');
      if (fill && fill !== 'auto' && /^[0-9a-f]{6}$/i.test(fill)) shade(td, fill.toLowerCase());
      const list = { stack: [] };
      for (const k of kids(tc)) blockElement(k, td, ctx, list);
      if (!td.childNodes.length) td.append(document.createElement('br'));
      for (let k = 0; k < span; k++) grid[ri][col + k] = { td };
      col += span;
      rowEl.append(td);
    }
    (isHead ? thead : tbody).append(rowEl);
  });
  if (thead.childNodes.length) el.append(thead);
  el.append(tbody);
  const wrap = document.createElement('div');
  wrap.className = 'od-table-wrap';
  wrap.append(el);
  return wrap;
}

// ---- helpers the page uses --------------------------------------------------------------------------------------
// One comment as plain text (author line + paragraphs).
export function commentText(c) {
  return all(c.el, 'p').map((p) => all(p, 't').map((x) => x.textContent).join('')).filter(Boolean).join('\n');
}
