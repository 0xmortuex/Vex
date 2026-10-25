// Markdown, rendered into DOM nodes (never into an HTML string).
//
// The interface has a Markdown renderer of its own (js/vex-markdown.js), written for short chat replies: it has no pictures, rules,
// nested lists or heading ids, and builds HTML strings. A whole document needs those, and a document is the one place where the text
// is somebody else's. So this one builds nodes with createElement and textContent only: the text of the document can never become
// markup, raw HTML in it is shown as the text it is, and a link or picture is let through only as http(s), mailto, a relative
// address (resolved against the document's own) or an image data: address.
//
//   renderMarkdown(text, { docUrl, allowImages, imageSrc(resolved) -> src | null, highlight(lang, code) -> html | null }) -> { root, headings }

const PUNCT = /[!-/:-@[-`{-~]/;

export function slugify(text) {
  const s = String(text).toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-');
  return s || 'section';
}

// An address from the document, or null when it must not be followed or loaded.
export function safeLink(raw, docUrl) {
  const s = String(raw || '').replace(/[\u0000-\u001f\u007f\s]+/g, '');
  if (!s) return null;
  if (s[0] === '#') return s;
  let u;
  try { u = new URL(s, docUrl || undefined); } catch { return null; }
  if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') return u.href;
  if (u.protocol === 'file:' && /^file:/i.test(String(docUrl || ''))) return u.href;
  return null;
}
export function safeImage(raw, docUrl) {
  const s = String(raw || '').trim();
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,[A-Za-z0-9+/=\s]+$/i.test(s)) return s.replace(/\s+/g, '');
  const u = safeLink(raw, docUrl);
  return u && /^(?:https?|file):/i.test(u) ? u : null;
}

const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };
const text = (s) => document.createTextNode(s);

// ---------------------------------------------------------------- inline
function findClose(s, from, open, close) {
  let depth = 1;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (c === '`') { const m = /^`+/.exec(s.slice(i)); const end = s.indexOf(m[0], i + m[0].length); if (end !== -1) { i = end + m[0].length - 1; continue; } }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return i;
  }
  return -1;
}

// "(url "title")" or "(<url> 'title')" starting at s[i] === '('. -> { url, title, end } or null
function parseDestination(s, i) {
  let j = i + 1;
  while (s[j] === ' ' || s[j] === '\n') j++;
  let url = '';
  if (s[j] === '<') {
    const end = s.indexOf('>', j);
    if (end === -1) return null;
    url = s.slice(j + 1, end); j = end + 1;
  } else {
    let depth = 0;
    const start = j;
    for (; j < s.length; j++) {
      const c = s[j];
      if (c === '\\') { j++; continue; }
      if (c === '(') depth++;
      else if (c === ')') { if (depth === 0) break; depth--; }
      else if (c === ' ' || c === '\n') break;
    }
    url = s.slice(start, j);
  }
  while (s[j] === ' ' || s[j] === '\n') j++;
  let title = '';
  if (s[j] === '"' || s[j] === "'" || s[j] === '(') {
    const q = s[j] === '(' ? ')' : s[j];
    const end = s.indexOf(q, j + 1);
    if (end === -1) return null;
    title = s.slice(j + 1, end); j = end + 1;
    while (s[j] === ' ' || s[j] === '\n') j++;
  }
  if (s[j] !== ')') return null;
  return { url: url.replace(/\\(.)/g, '$1'), title, end: j + 1 };
}

function inline(parent, s, ctx) {
  let buf = '';
  const flush = () => { if (buf) { parent.appendChild(text(buf)); buf = ''; } };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      if (s[i + 1] === '\n') { flush(); parent.appendChild(el('br')); i += 2; continue; }
      if (i + 1 < s.length && PUNCT.test(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }
      buf += c; i++; continue;
    }
    if (c === '`') {
      const run = /^`+/.exec(s.slice(i))[0];
      const end = s.indexOf(run, i + run.length);
      if (end !== -1 && s[end + run.length] !== '`') {
        flush();
        const code = el('code');
        let inner = s.slice(i + run.length, end).replace(/\n/g, ' ');
        if (inner.length > 2 && inner.startsWith(' ') && inner.endsWith(' ') && inner.trim()) inner = inner.slice(1, -1);
        code.textContent = inner;
        parent.appendChild(code);
        i = end + run.length; continue;
      }
      buf += run; i += run.length; continue;
    }
    if (c === '!' && s[i + 1] === '[') {
      const close = findClose(s, i + 2, '[', ']');
      if (close !== -1 && s[close + 1] === '(') {
        const dest = parseDestination(s, close + 1);
        if (dest) { flush(); parent.appendChild(image(s.slice(i + 2, close), dest.url, dest.title, ctx)); i = dest.end; continue; }
      }
    }
    if (c === '[') {
      const close = findClose(s, i + 1, '[', ']');
      if (close !== -1) {
        let url = null, title = '', end = close + 1;
        if (s[close + 1] === '(') {
          const dest = parseDestination(s, close + 1);
          if (dest) { url = dest.url; title = dest.title; end = dest.end; }
        } else {
          const ref = /^\[([^\]]*)\]/.exec(s.slice(close + 1));
          const label = (ref && ref[1] ? ref[1] : s.slice(i + 1, close)).toLowerCase().replace(/\s+/g, ' ').trim();
          const def = ctx.refs.get(label);
          if (def) { url = def.url; title = def.title; end = ref ? close + 1 + ref[0].length : close + 1; }
        }
        if (url !== null) {
          flush();
          parent.appendChild(link(s.slice(i + 1, close), url, title, ctx));
          i = end; continue;
        }
      }
    }
    if (c === '<') {
      const m = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(s.slice(i));
      if (m) { flush(); parent.appendChild(link(m[1], m[1], '', ctx, true)); i += m[0].length; continue; }
    }
    if (c === 'h' && (s.startsWith('http://', i) || s.startsWith('https://', i)) && (i === 0 || /[\s(*_~]/.test(s[i - 1]))) {
      const m = /^https?:\/\/[^\s<>]+/.exec(s.slice(i));
      let url = m[0].replace(/[.,;:!?*_~]+$/, '');
      while (url.endsWith(')') && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) url = url.slice(0, -1);
      flush(); parent.appendChild(link(url, url, '', ctx, true)); i += url.length; continue;
    }
    if (c === '*' || c === '_' || c === '~') {
      const run = /^[*_~]+/.exec(s.slice(i))[0];
      const k = c === '~' ? (run.length >= 2 ? 2 : 0) : Math.min(run.length, 3);
      const after = s[i + k] || ' ';
      const before = i > 0 ? s[i - 1] : ' ';
      const canOpen = k > 0 && !/\s/.test(after) && (c !== '_' || !/[\p{L}\p{N}]/u.test(before));
      if (canOpen) {
        // the closing run: same character, not preceded by white space, and for _ not followed by a letter
        let j = i + k, found = -1;
        while (j < s.length) {
          if (s[j] === '\\') { j += 2; continue; }
          if (s[j] === '`') { const m = /^`+/.exec(s.slice(j)); const e = s.indexOf(m[0], j + m[0].length); j = e === -1 ? j + m[0].length : e + m[0].length; continue; }
          if (s[j] === c) {
            const r = /^[*_~]+/.exec(s.slice(j))[0];
            if (r[0] === c && r.length >= k && !/\s/.test(s[j - 1] || ' ') && (c !== '_' || !/[\p{L}\p{N}]/u.test(s[j + k] || ' '))) { found = j; break; }
            j += r.length; continue;
          }
          j++;
        }
        if (found !== -1) {
          flush();
          const innerText = s.slice(i + k, found);
          let node;
          if (c === '~') node = el('del');
          else if (k === 3) { node = el('em'); const strong = el('strong'); inline(strong, innerText, ctx); node.appendChild(strong); parent.appendChild(node); i = found + k; continue; }
          else node = el(k === 2 ? 'strong' : 'em');
          inline(node, innerText, ctx);
          parent.appendChild(node);
          i = found + k; continue;
        }
      }
      buf += run; i += run.length; continue;
    }
    if (c === ' ' && s[i + 1] === ' ' && /^ {2,}\n/.test(s.slice(i))) { flush(); parent.appendChild(el('br')); i += s.slice(i).indexOf('\n') + 1; continue; }
    buf += c; i++;
  }
  flush();
}

function link(label, url, title, ctx, plain) {
  const href = safeLink(url, ctx.docUrl);
  if (!href) { const s = el('span', 'md-unsafe'); inline(s, label, ctx); s.title = url ? ctx.t('Link not followed') + ': ' + url.slice(0, 80) : ''; return s; }
  const a = el('a');
  a.setAttribute('href', href);
  a.setAttribute('rel', 'noopener noreferrer');
  if (title) a.title = title;
  if (plain) a.textContent = label; else inline(a, label, ctx);
  return a;
}

function image(alt, url, title, ctx) {
  const resolved = ctx.allowImages ? safeImage(url, ctx.docUrl) : null;
  const src = resolved && ctx.imageSrc ? ctx.imageSrc(resolved) : null;
  const plainAlt = alt.replace(/[*_`[\]\\]/g, '');
  if (!src) {
    const s = el('span', 'md-image-off');
    s.textContent = plainAlt || url;
    s.title = resolved || !ctx.allowImages ? '' : ctx.t('Picture not loaded');
    s.dataset.src = url;
    return s;
  }
  const img = el('img');
  img.alt = plainAlt;
  if (title) img.title = title;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.setAttribute('referrerpolicy', 'no-referrer');
  img.src = src;
  return img;
}

// ---------------------------------------------------------------- blocks
const FENCE = /^( {0,3})(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const ATX = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const LIST = /^( {0,3})([-+*]|\d{1,9}[.)])( +|$)/;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const REFDEF = /^ {0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?(?:\s+["'(]([^"')]*)["')])?\s*$/;

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '`') inCode = !inCode;
    if (c === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

const startsBlock = (line) => FENCE.test(line) || ATX.test(line) || HR.test(line) || /^ {0,3}>/.test(line) || /^ {0,3}(?:[-+*]|1[.)])( +\S)/.test(line);

function parseBlocks(parent, lines, ctx, depth) {
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }
    // an HTML comment is not shown (as in any renderer); other HTML is shown as the text it is, below
    if (/^\s*<!--/.test(line)) {
      let j = i;
      while (j < n && !lines[j].includes('-->')) j++;
      i = j + 1; continue;
    }
    let m = FENCE.exec(line);
    if (m) {
      const fence = m[2], lang = m[3];
      const body = [];
      let j = i + 1;
      while (j < n && !(new RegExp('^ {0,3}' + fence[0] + '{' + fence.length + ',}\\s*$').test(lines[j]))) { body.push(lines[j].slice(Math.min(m[1].length, (/^ */.exec(lines[j]) || [''])[0].length))); j++; }
      parent.appendChild(codeBlock(body.join('\n'), lang, ctx));
      i = j + 1; continue;
    }
    if ((m = ATX.exec(line))) {
      const h = el('h' + m[1].length);
      inline(h, (m[2] || '').trim(), ctx);
      addHeading(h, m[1].length, ctx);
      parent.appendChild(h); i++; continue;
    }
    if (HR.test(line)) { parent.appendChild(el('hr')); i++; continue; }
    if (/^ {0,3}>/.test(line)) {
      const inner = [];
      let j = i;
      while (j < n && (/^ {0,3}>/.test(lines[j]) || (inner.length && !/^\s*$/.test(lines[j]) && !startsBlock(lines[j])))) { inner.push(lines[j].replace(/^ {0,3}> ?/, '')); j++; }
      const bq = el('blockquote');
      if (depth < 12) parseBlocks(bq, inner, ctx, depth + 1);
      parent.appendChild(bq); i = j; continue;
    }
    if ((m = LIST.exec(line))) { i = parseList(parent, lines, i, ctx, depth); continue; }
    if (i + 1 < n && line.includes('|') && TABLE_SEP.test(lines[i + 1]) && splitRow(line).length === splitRow(lines[i + 1]).length) {
      i = parseTable(parent, lines, i, ctx); continue;
    }
    if (/^ {4}|^\t/.test(line)) {
      const body = [];
      let j = i;
      while (j < n && (/^ {4}|^\t/.test(lines[j]) || /^\s*$/.test(lines[j]))) { body.push(lines[j].replace(/^ {4}|^\t/, '')); j++; }
      while (body.length && /^\s*$/.test(body[body.length - 1])) body.pop();
      parent.appendChild(codeBlock(body.join('\n'), '', ctx));
      i = j; continue;
    }
    // a paragraph, or a setext heading
    const para = [line.replace(/^\s+/, '')];
    let j = i + 1;
    let setext = 0;
    while (j < n && !/^\s*$/.test(lines[j])) {
      if (/^ {0,3}=+\s*$/.test(lines[j])) { setext = 1; j++; break; }
      if (/^ {0,3}-+\s*$/.test(lines[j]) && !HR.test(lines[j]) || (/^ {0,3}-{1,}\s*$/.test(lines[j]) && para.length)) { setext = 2; j++; break; }
      if (startsBlock(lines[j]) || (lines[j].includes('|') && j + 1 < n && TABLE_SEP.test(lines[j + 1]))) break;
      para.push(lines[j].replace(/^\s+/, '')); j++;
    }
    const raw = para.join('\n');
    if (!setext && (m = REFDEF.exec(raw)) && para.length === 1) { i = j; continue; }
    if (setext) { const h = el('h' + setext); inline(h, raw.trim(), ctx); addHeading(h, setext, ctx); parent.appendChild(h); }
    else { const p = el('p'); inline(p, raw.trimEnd(), ctx); parent.appendChild(p); }
    i = j;
  }
}

function addHeading(h, level, ctx) {
  const label = h.textContent.trim();
  let id = slugify(label);
  const seen = ctx.ids.get(id) || 0;
  ctx.ids.set(id, seen + 1);
  if (seen) id += '-' + seen;
  h.id = id;
  ctx.headings.push({ level, id, text: label });
}

function codeBlock(code, lang, ctx) {
  const wrap = el('div', 'md-code');
  const pre = el('pre');
  const c = el('code');
  const html = ctx.highlight && lang ? ctx.highlight(lang, code) : null;
  if (html) c.innerHTML = html; else c.textContent = code;
  if (lang) { wrap.dataset.lang = lang.slice(0, 20); c.className = 'language-' + lang.replace(/[^\w+-]/g, '').slice(0, 20); }
  pre.appendChild(c);
  wrap.appendChild(pre);
  wrap.dataset.code = '1';
  return wrap;
}

function parseList(parent, lines, start, ctx, depth) {
  const first = LIST.exec(lines[start]);
  const ordered = /\d/.test(first[2][0]);
  const list = el(ordered ? 'ol' : 'ul');
  if (ordered && Number(first[2].replace(/\D/g, '')) !== 1) list.start = Number(first[2].replace(/\D/g, ''));
  const bullet = first[2].replace(/\d+/, '');
  let i = start;
  const n = lines.length;
  let loose = false;
  while (i < n) {
    const m = LIST.exec(lines[i]);
    if (!m || /\d/.test(m[2][0]) !== ordered || m[2].replace(/\d+/, '') !== bullet) break;
    if (HR.test(lines[i])) break;
    const contentIndent = m[1].length + m[2].length + Math.max(1, Math.min(4, m[3].length));
    const item = [lines[i].slice(Math.min(lines[i].length, contentIndent))];
    let j = i + 1;
    let blankBefore = false;
    while (j < n) {
      const l = lines[j];
      if (/^\s*$/.test(l)) {
        // a blank line stays in the item only if the next line is indented into it
        let k = j; while (k < n && /^\s*$/.test(lines[k])) k++;
        if (k < n && (/^ {2,}|^\t/.test(lines[k])) && (lines[k].length - lines[k].trimStart().length) >= Math.min(contentIndent, 2)) { for (let b = j; b < k; b++) item.push(''); blankBefore = true; j = k; continue; }
        break;
      }
      const indent = l.length - l.trimStart().length;
      if (indent >= contentIndent || indent >= 2 && !LIST.test(l) ) { item.push(l.slice(Math.min(indent, contentIndent))); j++; continue; }
      if (indent >= 2 && LIST.test(l)) { item.push(l.slice(Math.min(indent, contentIndent))); j++; continue; }
      if (!blankBefore && !startsBlock(l) && !LIST.test(l)) { item.push(l.trim()); j++; continue; }       // lazy continuation
      break;
    }
    if (blankBefore) loose = true;
    const li = el('li');
    let body = item;
    // a task list item
    const task = /^\[([ xX])\]\s+/.exec(body[0]);
    if (task) {
      const box = el('input'); box.type = 'checkbox'; box.disabled = true; box.checked = task[1] !== ' ';
      box.setAttribute('aria-label', ctx.t(box.checked ? 'Done' : 'Not done'));
      li.className = 'md-task'; li.appendChild(box);
      body = [body[0].slice(task[0].length), ...body.slice(1)];
    }
    if (depth < 12) parseBlocks(li, body, ctx, depth + 1);
    // a tight list shows its paragraphs without the gap
    if (!loose) for (const p of Array.from(li.children)) if (p.tagName === 'P') { while (p.firstChild) li.insertBefore(p.firstChild, p); p.remove(); }
    list.appendChild(li);
    i = j;
    while (i < n && /^\s*$/.test(lines[i]) && i + 1 < n && LIST.test(lines[i + 1]) && !HR.test(lines[i + 1])) { loose = true; i++; }
  }
  if (loose) list.className = 'md-loose';
  parent.appendChild(list);
  return i;
}

function parseTable(parent, lines, start, ctx) {
  const head = splitRow(lines[start]);
  const aligns = splitRow(lines[start + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : /^:-/.test(c) ? 'left' : ''));
  const wrap = el('div', 'md-table');
  const table = el('table');
  const thead = el('thead'), tr = el('tr');
  head.forEach((h, c) => { const th = el('th'); th.scope = 'col'; if (aligns[c]) th.style.textAlign = aligns[c]; inline(th, h, ctx); tr.appendChild(th); });
  thead.appendChild(tr); table.appendChild(thead);
  const tbody = el('tbody');
  let i = start + 2;
  while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) {
    const cells = splitRow(lines[i]);
    const row = el('tr');
    for (let c = 0; c < head.length; c++) { const td = el('td'); if (aligns[c]) td.style.textAlign = aligns[c]; inline(td, cells[c] || '', ctx); row.appendChild(td); }
    tbody.appendChild(row); i++;
  }
  table.appendChild(tbody); wrap.appendChild(table); parent.appendChild(wrap);
  return i;
}

export function renderMarkdown(source, opts) {
  const o = opts || {};
  const ctx = { t: o.t || ((s) => s), docUrl: o.docUrl || '', allowImages: o.allowImages !== false, imageSrc: o.imageSrc || null, highlight: o.highlight || null, refs: new Map(), ids: new Map(), headings: [] };
  const lines = String(source).replace(/\r\n?/g, '\n').replace(/^﻿/, '').split('\n');
  // link reference definitions are collected first, so a [text][ref] above its definition still works
  for (const l of lines) { const m = REFDEF.exec(l); if (m) ctx.refs.set(m[1].toLowerCase().replace(/\s+/g, ' ').trim(), { url: m[2], title: m[3] || '' }); }
  // front matter
  let body = lines;
  if (lines[0] === '---') { const end = lines.indexOf('---', 1); if (end > 0 && lines.slice(1, end).every((l) => /^[\w.-]+\s*:|^\s|^$/.test(l))) body = lines.slice(end + 1); }
  const root = el('div', 'md-body');
  parseBlocks(root, body, ctx, 0);
  return { root, headings: ctx.headings };
}
