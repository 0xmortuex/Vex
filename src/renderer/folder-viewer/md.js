// A small, safe Markdown reader for the preview pane: headings, paragraphs, lists, quotes, rules and code, with bold, italic, code and links
// inside the lines. It builds elements with textContent only (never innerHTML), a link is shown as text with its address beside it and is
// not followable, and a picture is shown as its description. This is a preview, not a reader: the Markdown viewer of Vex takes a
// whole .md file in a tab.

import { el } from './ui.js';

const INLINE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\*\*([^*]+?)\*\*|__([^_]+?)__|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])|!?\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g;

export function inline(text, parent) {
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) parent.append(text.slice(last, m.index));
    if (m[2] != null) parent.append(el('code', { text: m[2] }));
    else if (m[3] != null || m[4] != null) parent.append(el('strong', { text: m[3] ?? m[4] }));
    else if (m[5] != null || m[6] != null) parent.append(el('em', { text: m[5] ?? m[6] }));
    else {
      const label = m[7] || m[8] || '';
      if (m[0].startsWith('!')) parent.append(el('span', { class: 'md-img', text: label }));
      else parent.append(el('span', { class: 'md-link', text: label }), m[8] && m[8] !== label ? el('span', { class: 'md-url', text: ' (' + m[8] + ')' }) : '');
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parent.append(text.slice(last));
  return parent;
}

export function renderMarkdown(source) {
  const root = el('div', { class: 'md' });
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = /^\s{0,3}(```+|~~~+)/.exec(line);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      root.append(el('pre', { class: 'md-code' }, el('code', { text: body.join('\n') })));
      continue;
    }
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) { root.append(inline(h[2], el('h' + h[1].length, { class: 'md-h' }))); i++; continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { root.append(el('hr')); i++; continue; }
    if (/^\s{0,3}>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) body.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
      root.append(inline(body.join(' '), el('blockquote')));
      continue;
    }
    const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      const ordered = /\d/.test(li[1]);
      const list = el(ordered ? 'ol' : 'ul');
      while (i < lines.length) {
        const m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (!m) break;
        list.append(inline(m[2], el('li')));
        i++;
      }
      root.append(list);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^\s{0,3}(#{1,6}\s|```|~~~|>)/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) para.push(lines[i++].trim());
    if (!para.length) { para.push(lines[i++].trim()); }   // a line none of the rules above took is plain text, never a loop
    root.append(inline(para.join(' '), el('p')));
  }
  return root;
}
