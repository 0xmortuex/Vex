// An .epub read for reading: the package (title, author, chapters in order), the table of contents, and one chapter at a time as
// safe DOM.
//
// A chapter is rebuilt, never pasted in: only reading tags are kept (paragraphs, headings, lists, tables, emphasis, links,
// pictures), scripts, forms, frames, objects and every event attribute are dropped, a picture is only ever a part of the book
// itself (a blob), a link is kept only if it is http, https or mailto or points to another place in the book, and the book's
// stylesheet is applied only in the "original" tone, rewritten to apply to the chapter alone with no address in it.

import { NS, parseXml, parseRels, kids, kid, all, attr, resolvePath, dirOf, imageMime, isUndrawable, safeHref } from './xml.js';
import { t } from './strings.js';

const XHTML = 'http://www.w3.org/1999/xhtml';

export async function loadEpub(pkg) {
  if (!pkg.has('META-INF/container.xml')) throw Object.assign(new Error('This is not an EPUB: it has no container description'), { code: 'corrupt' });
  const container = parseXml(await pkg.text('META-INF/container.xml'), 'The container');
  const root = all(container, 'rootfile')[0];
  const opfPath = root && root.getAttribute('full-path');
  if (!opfPath || !pkg.has(opfPath)) throw Object.assign(new Error('The book\'s package file is missing'), { code: 'corrupt' });
  const base = dirOf(opfPath);
  const opf = parseXml(await pkg.text(opfPath), 'The book package');
  const manifest = new Map();
  for (const it of all(all(opf, 'manifest')[0], 'item')) {
    manifest.set(it.getAttribute('id'), { id: it.getAttribute('id'), path: resolvePath(base, decodeURI(it.getAttribute('href') || '')), type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || '' });
  }
  const spineEl = all(opf, 'spine')[0];
  const chapters = [];
  for (const ref of all(spineEl, 'itemref')) {
    const item = manifest.get(ref.getAttribute('idref'));
    if (item && pkg.has(item.path) && /html|xml/i.test(item.type)) chapters.push({ id: item.id, path: item.path, title: '' });
  }
  if (!chapters.length) throw Object.assign(new Error('This book has no chapters to read'), { code: 'corrupt' });
  const meta = (name) => { const e = all(opf, name)[0]; return e ? e.textContent.trim() : ''; };
  const model = {
    pkg, base, opfPath, manifest, chapters, title: meta('title'), author: all(opf, 'creator').map((e) => e.textContent.trim()).filter(Boolean).join(', '), language: meta('language'),
    toc: [], images: new Map(), texts: new Map(), css: new Map(), macros: false, id: meta('identifier'),
  };
  // contents: the EPUB 3 navigation document, else the EPUB 2 NCX
  const navItem = [...manifest.values()].find((m) => /\bnav\b/.test(m.props));
  const ncxItem = [...manifest.values()].find((m) => /ncx/i.test(m.type) || /\.ncx$/i.test(m.path));
  try {
    if (navItem && pkg.has(navItem.path)) model.toc = readNav(await pkg.text(navItem.path), navItem.path);
    if (!model.toc.length && ncxItem && pkg.has(ncxItem.path)) model.toc = readNcx(await pkg.text(ncxItem.path), ncxItem.path);
  } catch (err) { console.warn('[Document viewer] the book\'s contents could not be read, the chapters are listed instead:', err.message); model.toc = []; }
  const index = new Map(chapters.map((c, i) => [c.path, i]));
  model.toc = model.toc.filter((e) => index.has(e.path));
  for (const e of model.toc) { e.chapter = index.get(e.path); if (!e.anchor && !chapters[e.chapter].title) chapters[e.chapter].title = e.title; }
  chapters.forEach((c, i) => { if (!c.title) c.title = t('Chapter {n}', { n: i + 1 }); });
  if (!model.toc.length) model.toc = chapters.map((c, i) => ({ title: c.title, path: c.path, anchor: '', level: 0, chapter: i }));
  model.index = index;
  return model;
}

export function releaseEpub(model) { for (const u of model.images.values()) if (u) URL.revokeObjectURL(u); model.images.clear(); }

function splitHref(h, fromPath) {
  const s = String(h || '');
  const i = s.indexOf('#');
  const file = i < 0 ? s : s.slice(0, i);
  let anchor = i < 0 ? '' : s.slice(i + 1);
  try { anchor = decodeURIComponent(anchor); } catch { anchor = String(h || '').slice(i + 1); }
  let path;
  try { path = file ? resolvePath(dirOf(fromPath), decodeURI(file)) : fromPath; } catch { path = file ? resolvePath(dirOf(fromPath), file) : fromPath; }
  return { path, anchor };
}

function readNav(text, navPath) {
  const doc = parseXml(text, 'The contents');
  const nav = all(doc, 'nav').find((n) => /toc/.test(n.getAttributeNS(NS.epub || 'http://www.idpf.org/2007/ops', 'type') || n.getAttribute('epub:type') || '')) || all(doc, 'nav')[0];
  const out = [];
  const walk = (ol, level) => {
    for (const li of kids(ol, 'li')) {
      const a = kid(li, 'a') || kid(li, 'span');
      if (a) {
        const label = a.textContent.replace(/\s+/g, ' ').trim();
        const href = a.getAttribute('href');
        if (href && label) { const { path, anchor } = splitHref(href, navPath); out.push({ title: label, path, anchor, level }); }
      }
      const sub = kid(li, 'ol');
      if (sub) walk(sub, level + 1);
    }
  };
  const ol = nav && kid(nav, 'ol');
  if (ol) walk(ol, 0);
  return out;
}

function readNcx(text, ncxPath) {
  const doc = parseXml(text, 'The contents');
  const out = [];
  const walk = (parent, level) => {
    for (const np of kids(parent, 'navPoint')) {
      const label = (all(kid(np, 'navLabel'), 'text')[0] || {}).textContent;
      const content = kid(np, 'content');
      if (content && label) { const { path, anchor } = splitHref(content.getAttribute('src'), ncxPath); out.push({ title: label.replace(/\s+/g, ' ').trim(), path, anchor, level }); }
      walk(np, level + 1);
    }
  };
  walk(all(doc, 'navMap')[0], 0);
  return out;
}

// ---- a chapter ----------------------------------------------------------------------------------------------------
const KEEP = new Set(['p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'blockquote', 'pre', 'code', 'em', 'strong', 'b', 'i', 'u', 's', 'strike', 'sub', 'sup', 'small', 'big',
  'br', 'hr', 'a', 'img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col', 'figure', 'figcaption', 'cite', 'q', 'abbr', 'section', 'article', 'aside', 'nav', 'header', 'footer', 'center', 'mark', 'ins', 'del', 'ruby', 'rt', 'rp', 'tt', 'kbd', 'samp', 'var', 'address', 'main']);
const SKIP = new Set(['script', 'style', 'link', 'meta', 'title', 'head', 'object', 'embed', 'iframe', 'frame', 'form', 'input', 'button', 'select', 'textarea', 'audio', 'video', 'canvas', 'applet', 'noscript', 'template']);
const STYLE_OK = new Set(['text-align', 'font-weight', 'font-style', 'text-decoration', 'text-indent', 'vertical-align']);

function parseChapter(text) {
  let doc = new DOMParser().parseFromString(text, 'application/xhtml+xml');
  if (doc.getElementsByTagName('parsererror').length) doc = new DOMParser().parseFromString(text, 'text/html');
  return doc;
}

// Renders chapter `index` into `host`. opts: { tone: 'theme'|'sepia'|'original' }.  -> { text, anchors }
export async function renderChapter(model, index, host, opts = {}) {
  const ch = model.chapters[index];
  const doc = parseChapter(await model.pkg.text(ch.path));
  const body = doc.body || all(doc, 'body')[0];
  host.textContent = '';
  const wrap = document.createElement('div');
  wrap.className = 'od-epub';
  host.append(wrap);
  if (!body) throw Object.assign(new Error('This chapter has no text'), { code: 'corrupt' });
  const need = new Set();
  const pending = [];
  const ctx = { model, path: ch.path, pending, need };
  for (const node of Array.from(body.childNodes)) copy(node, wrap, ctx);
  if (pending.length) {
    const want = [...new Set(pending.map((p) => p.path))].filter((p) => !model.images.has(p));
    if (want.length) {
      const parts = await model.pkg.bytes(want);
      for (const p of want) model.images.set(p, parts[p] ? URL.createObjectURL(new Blob([parts[p]], { type: imageMime(p) })) : null);
    }
    for (const p of pending) {
      const url = model.images.get(p.path);
      if (url) p.img.src = url;
      else p.img.replaceWith(document.createTextNode(p.img.alt ? '[' + p.img.alt + ']' : '[' + t('Picture not shown') + ']'));
    }
  }
  const text = wrap.textContent;
  if (opts.tone === 'original') {
    const css = await chapterCss(model, doc, ch.path);
    if (css) { const st = document.createElement('style'); st.textContent = css; wrap.prepend(st); }
  }
  return { text, root: wrap };
}

function copy(node, into, ctx) {
  if (node.nodeType === 3) { into.append(document.createTextNode(node.nodeValue)); return; }
  if (node.nodeType !== 1) return;
  let name = node.localName.toLowerCase();
  if (SKIP.has(name)) return;
  if (name === 'svg') {
    const image = node.getElementsByTagNameNS('*', 'image')[0];
    if (image) addImage(image.getAttribute('xlink:href') || image.getAttribute('href'), '', into, ctx);
    return;
  }
  if (name === 'img') { addImage(node.getAttribute('src'), node.getAttribute('alt') || '', into, ctx, node); return; }
  if (!KEEP.has(name)) { for (const c of Array.from(node.childNodes)) copy(c, into, ctx); return; }
  const out = document.createElement(name === 'center' ? 'div' : name);
  if (name === 'center') out.style.textAlign = 'center';
  const id = node.getAttribute('id') || node.getAttribute('name');
  if (id && /^[\w.:-]{1,200}$/.test(id)) out.id = 'ep-' + id;
  if (name === 'a') {
    const href = node.getAttribute('href');
    if (href != null) {
      const ext = safeHref(href);
      if (ext) { out.href = ext; out.target = '_blank'; out.rel = 'noopener noreferrer'; }
      else if (!/^[a-z][a-z0-9+.-]*:/i.test(href.trim())) {
        const { path, anchor } = splitHref(href, ctx.path);
        if (ctx.model.index.has(path)) { out.href = '#'; out.dataset.chapter = String(ctx.model.index.get(path)); if (anchor) out.dataset.anchor = anchor; }
      }
    }
  }
  if (name === 'td' || name === 'th') { for (const k of ['colspan', 'rowspan']) { const v = parseInt(node.getAttribute(k), 10); if (v > 1 && v < 100) out[k === 'colspan' ? 'colSpan' : 'rowSpan'] = v; } }
  const lang = node.getAttribute('lang') || node.getAttribute('xml:lang');
  if (lang && /^[a-zA-Z-]{2,12}$/.test(lang)) out.lang = lang;
  const style = node.getAttribute('style');
  if (style) for (const decl of style.split(';')) {
    const [prop, ...rest] = decl.split(':');
    const p = (prop || '').trim().toLowerCase(), v = rest.join(':').trim();
    if (STYLE_OK.has(p) && v && !/url\(|expression|javascript/i.test(v)) out.style.setProperty(p, v);
  }
  into.append(out);
  for (const c of Array.from(node.childNodes)) copy(c, out, ctx);
}

function addImage(src, alt, into, ctx, node) {
  const s = String(src || '').trim();
  if (!s || /^[a-z][a-z0-9+.-]*:/i.test(s)) {
    // data: pictures are the book's own bytes, but a remote address is never fetched
    if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(s) && s.length < 4 * 1024 * 1024) { const img = document.createElement('img'); img.src = s; img.alt = alt; into.append(img); return; }
    into.append(document.createTextNode(alt ? '[' + alt + ']' : '[' + t('Picture on the web (not loaded)') + ']'));
    return;
  }
  const { path } = splitHref(s, ctx.path);
  if (!ctx.model.pkg.has(path) || !imageMime(path) || isUndrawable(path)) { into.append(document.createTextNode(alt ? '[' + alt + ']' : '[' + t('Picture not shown') + ']')); return; }
  const img = document.createElement('img');
  img.alt = alt;
  img.decoding = 'async';
  img.loading = 'lazy';
  if (node) {
    const w = parseInt(node.getAttribute('width'), 10), h = parseInt(node.getAttribute('height'), 10);
    if (w > 0 && w < 5000 && h > 0 && h < 5000) { img.width = w; img.height = h; }
  }
  into.append(img);
  ctx.pending.push({ img, path });
}

// ---- the book's own stylesheet, made safe and local to the chapter --------------------------------------------------------
const CSS_OK = /^(color|background-color|background|font|font-family|font-size|font-style|font-weight|font-variant|line-height|text-align|text-indent|text-decoration|text-transform|letter-spacing|word-spacing|margin(-[a-z]+)?|padding(-[a-z]+)?|border(-[a-z-]+)?|list-style(-[a-z]+)?|vertical-align|white-space|width|max-width|height|float|clear|page-break-[a-z]+|display|hyphens)$/;
async function chapterCss(model, doc, chapterPath) {
  const sheets = [];
  for (const link of Array.from(doc.getElementsByTagName('link'))) {
    if (!/stylesheet/i.test(link.getAttribute('rel') || '')) continue;
    const { path } = splitHref(link.getAttribute('href') || '', chapterPath);
    if (model.pkg.has(path)) sheets.push(path);
  }
  const chunks = [];
  for (const path of sheets) {
    if (!model.css.has(path)) model.css.set(path, scopeCss(await model.pkg.text(path)));
    chunks.push(model.css.get(path));
  }
  for (const st of Array.from(doc.getElementsByTagName('style'))) chunks.push(scopeCss(st.textContent || ''));
  return chunks.join('\n');
}

export function scopeCss(text) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(String(text).replace(/@import[^;]*;/gi, ''));
  const out = [];
  for (const rule of Array.from(sheet.cssRules)) {
    if (rule.type !== 1) continue;            // style rules only: no @font-face, @import, @media
    const selectors = rule.selectorText.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const cleaned = s.replace(/^(html|body)\b\s*/i, '').replace(/::?(before|after)\b/g, '$&');
      return '.od-epub' + (cleaned ? ' ' + cleaned : '');
    });
    const decls = [];
    for (let i = 0; i < rule.style.length; i++) {
      const prop = rule.style[i];
      const value = rule.style.getPropertyValue(prop);
      if (CSS_OK.test(prop) && !/url\(|expression|javascript|@import/i.test(value)) decls.push(prop + ': ' + value);
    }
    if (decls.length) out.push(selectors.join(', ') + ' { ' + decls.join('; ') + ' }');
  }
  return out.join('\n');
}

// ---- text for search -------------------------------------------------------------------------------------------------------
export async function chapterText(model, index) {
  if (model.texts.has(index)) return model.texts.get(index);
  const doc = parseChapter(await model.pkg.text(model.chapters[index].path));
  const body = doc.body || all(doc, 'body')[0];
  let text = '';
  if (body) { const walker = (n) => { if (n.nodeType === 3) text += n.nodeValue; else if (n.nodeType === 1 && !SKIP.has(n.localName.toLowerCase())) for (const c of n.childNodes) walker(c); }; walker(body); }
  model.texts.set(index, text);
  return text;
}
