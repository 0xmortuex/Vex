// Sanitized markdown renderer for chrome UI (AI panel responses, digests).
//
// Security model: ALL input is HTML-escaped before any markdown transform
// runs, and every transform only emits tags this file writes itself — raw
// HTML in the source can never reach the DOM. Links are restricted to
// http(s) and rendered with class="vex-md-link" so the consumer can
// intercept clicks (a plain <a> click inside the chrome document would
// navigate the whole app window).
//
// Supported: fenced code blocks, inline code, headings (#–####), bold,
// italic, links, bare-URL autolinks, ordered/unordered lists, blockquotes,
// pipe tables, paragraphs with <br> line breaks.
(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const SAFE_HREF = /^https?:\/\//i;

  // Placeholder sentinels — control chars that never occur in real text
  // (they're stripped from the input up front), so stashed HTML can't
  // collide with user content.
  const INLINE_PH = '\u0000';
  const BLOCK_PH = '\u0001';
  const INLINE_PH_RE = /\u0000(\d+)\u0000/g;
  const BLOCK_PH_RE = /^\s*\u0001(\d+)\u0001\s*$/;
  const SENTINEL_RE = /[\u0000\u0001]/g;

  // Inline transforms. `keep` protects finished HTML (code spans, anchors)
  // from later transforms via sentinel-wrapped indexes.
  function renderInline(text) {
    const stash = [];
    const keep = (html) => INLINE_PH + (stash.push(html) - 1) + INLINE_PH;

    let out = text;

    // Inline code first — its content is literal.
    out = out.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code class="vex-md-code">${code}</code>`));

    // [text](url) — http(s) only; anything else stays literal text.
    out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, label, href) => {
      if (!SAFE_HREF.test(href)) return m;
      return keep(`<a href="${href}" class="vex-md-link" rel="noopener">${label}</a>`);
    });

    // Bare-URL autolink. Input is already escaped, so `&` appears as `&amp;`
    // — kept as-is in the href, which the HTML parser decodes back to `&`.
    out = out.replace(/(^|[\s(])(https?:\/\/[^\s<>()]+[^\s<>().,;:!?])/g,
      (_, pre, url) => pre + keep(`<a href="${url}" class="vex-md-link" rel="noopener">${url}</a>`));

    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

    return out.replace(INLINE_PH_RE, (_, i) => stash[+i]);
  }

  function render(src) {
    if (src == null) return '';
    src = String(src).replace(/\r\n?/g, '\n').replace(SENTINEL_RE, '');

    // 1. Pull fenced code blocks out before escaping/parsing anything else.
    const blocks = [];
    src = src.replace(/```([\w+-]*)[ \t]*\n?([\s\S]*?)```/g, (_, lang, code) => {
      const html = `<pre class="vex-md-pre"><code${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`;
      return BLOCK_PH + (blocks.push(html) - 1) + BLOCK_PH;
    });

    // 2. Escape everything that isn't a protected block.
    src = escapeHtml(src);

    // 3. Line-oriented block parsing.
    const lines = src.split('\n');
    const out = [];
    let i = 0;

    const isUl = (l) => /^\s*[-*•]\s+/.test(l);
    const isOl = (l) => /^\s*\d+[.)]\s+/.test(l);
    const isQuote = (l) => /^\s*&gt;\s?/.test(l);
    const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
    const isTableSep = (l) => /^\s*\|[\s|:-]+\|\s*$/.test(l);
    const isBlank = (l) => !l.trim();
    const isHeading = (l) => /^#{1,4}\s+/.test(l);

    while (i < lines.length) {
      const line = lines[i];

      if (isBlank(line)) { i++; continue; }

      const ph = line.match(BLOCK_PH_RE);
      if (ph) {
        out.push(blocks[+ph[1]]);
        i++;
        continue;
      }

      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        const level = h[1].length;
        out.push(`<h${level} class="vex-md-h vex-md-h${level}">${renderInline(h[2].trim())}</h${level}>`);
        i++;
        continue;
      }

      if (isUl(line) || isOl(line)) {
        const ordered = isOl(line);
        const test = ordered ? isOl : isUl;
        const strip = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*•]\s+/;
        const items = [];
        while (i < lines.length && test(lines[i])) {
          items.push(`<li>${renderInline(lines[i].replace(strip, ''))}</li>`);
          i++;
        }
        const tag = ordered ? 'ol' : 'ul';
        out.push(`<${tag} class="vex-md-list">${items.join('')}</${tag}>`);
        continue;
      }

      if (isQuote(line)) {
        const quoted = [];
        while (i < lines.length && isQuote(lines[i])) {
          quoted.push(renderInline(lines[i].replace(/^\s*&gt;\s?/, '')));
          i++;
        }
        out.push(`<blockquote class="vex-md-quote">${quoted.join('<br>')}</blockquote>`);
        continue;
      }

      if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => renderInline(c.trim()));
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && isTableRow(lines[i])) {
          rows.push(cells(lines[i]));
          i++;
        }
        out.push(
          `<div class="vex-md-table-wrap"><table class="vex-md-table">` +
          `<thead><tr>${head.map(c => `<th>${c}</th>`).join('')}</tr></thead>` +
          `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>` +
          `</table></div>`
        );
        continue;
      }

      // Paragraph: consecutive plain lines joined with <br>.
      const para = [];
      while (
        i < lines.length && !isBlank(lines[i]) && !BLOCK_PH_RE.test(lines[i]) &&
        !isUl(lines[i]) && !isOl(lines[i]) && !isQuote(lines[i]) && !isHeading(lines[i]) &&
        !(isTableRow(lines[i]) && i + 1 < lines.length && isTableSep(lines[i + 1]))
      ) {
        para.push(renderInline(lines[i]));
        i++;
      }
      out.push(`<p class="vex-md-p">${para.join('<br>')}</p>`);
    }

    return out.join('');
  }

  const VexMarkdown = { render };

  if (typeof window !== 'undefined') {
    window.VexMarkdown = VexMarkdown;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VexMarkdown, render };
  }
})();
