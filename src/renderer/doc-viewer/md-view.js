// The rendered Markdown page: the document as a readable article, a table of contents, code blocks you can copy, pictures that load as the
// document's own (through the tab's session), and a search that marks hits with the page's highlight registry (no markup is changed).

import { el, button } from './ui.js';
import { t } from './strings.js';
import { renderMarkdown } from './markdown.js';
import { highlightLines, HIGHLIGHT_LANGS } from './highlight.js';

const LANG_ALIAS = { javascript: 'js', node: 'js', jsx: 'js', typescript: 'ts', tsx: 'ts', python: 'py', python3: 'py', shell: 'sh', bash: 'sh', zsh: 'sh', console: 'sh', yml: 'yaml', jsonc: 'json', json5: 'json', 'c++': 'c', cpp: 'c', h: 'c', csharp: 'java', cs: 'java', kotlin: 'java', kt: 'java', swift: 'java', golang: 'go', rust: 'rs', ruby: 'rb', powershell: 'ps', ps1: 'ps', htm: 'html', svg: 'xml', markdown: 'md', text: 'plain', txt: 'plain', patch: 'diff' };

function codeHtml(lang, code) {
  const l = LANG_ALIAS[lang.toLowerCase()] || lang.toLowerCase();
  if (!HIGHLIGHT_LANGS.includes(l) || l === 'plain') return null;
  return highlightLines(l, code.split('\n'), '').html.join('\n');
}

export class MdView {
  // ctx: { host, text, docUrl, images, toc, setStatus, copy(text, what), navigate(url) }
  constructor(ctx) {
    this.ctx = ctx;
    this.images = ctx.images !== false;
    this.toc = ctx.toc !== false;
    this.ranges = [];
    this.hitIdx = -1;
    this.supportsNav = true;
  }

  async mount() {
    const { root, headings } = renderMarkdown(this.ctx.text, {
      docUrl: this.ctx.docUrl, allowImages: this.images, t,
      imageSrc: (resolved) => (resolved.startsWith('data:') ? resolved : '/res?d=' + encodeURIComponent(this.ctx.docUrl) + '&u=' + encodeURIComponent(resolved)),
      highlight: codeHtml,
    });
    this.headings = headings;
    const wrap = el('div', { class: 'dv-md-wrap' + (this.toc && headings.length > 1 ? ' dv-has-toc' : '') });
    const nav = el('nav', { class: 'dv-toc', 'aria-label': t('Contents') });
    nav.append(el('div', { class: 'dv-toc-title', text: t('Contents') }));
    const list = el('ul', { class: 'dv-toc-list' });
    const min = Math.min(...headings.map((h) => h.level), 6);
    for (const h of headings) {
      const a = el('a', { href: '#' + h.id, class: 'dv-toc-link', 'data-id': h.id, text: h.text });
      const li = el('li', { class: 'dv-toc-item' });
      li.style.setProperty('--lv', h.level - min);
      li.append(a);
      list.append(li);
    }
    nav.append(list);
    const scroller = el('div', { class: 'dv-md', tabindex: '0', role: 'article', 'aria-label': t('Rendered document') });
    const page = el('div', { class: 'dv-md-page' });
    page.append(root);
    scroller.append(page);
    wrap.append(nav, scroller);
    this.wrap = wrap; this.scroller = scroller; this.root = root; this.nav = nav;
    this.byId = new Map([...root.querySelectorAll('[id]')].map((n) => [n.id, n]));
    this.ctx.host.replaceChildren(wrap);
    this.decorateCode();
    scroller.addEventListener('click', (e) => this.onClick(e));
    nav.addEventListener('click', (e) => this.onClick(e));
    scroller.addEventListener('scroll', () => this.markCurrentHeading(), { passive: true });
    if (this.ctx.hash) this.scrollToId(decodeURIComponent(this.ctx.hash));
    this.markCurrentHeading();
    this.ctx.onHeadings && this.ctx.onHeadings(headings.length);
  }

  destroy() { this.clearHighlights(); }
  focus() { this.scroller.focus(); }

  decorateCode() {
    for (const block of this.root.querySelectorAll('.md-code')) {
      const b = button({ icon: 'copy', label: 'Copy code', cls: 'dv-mini dv-code-copy', onClick: () => this.ctx.copy(block.querySelector('code').textContent, 'code') });
      block.append(b);
    }
  }

  onClick(e) {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (href.startsWith('#')) { e.preventDefault(); this.scrollToId(decodeURIComponent(href.slice(1))); return; }
    if (/^file:/i.test(href)) { e.preventDefault(); this.ctx.navigate(href); }
  }

  scrollToId(id) {
    const target = this.byId.get(id) || this.byId.get(id.toLowerCase());
    if (!target) return;
    this.scroller.scrollTop = target.offsetTop - 16;
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }

  markCurrentHeading() {
    if (!this.headings.length) return;
    const y = this.scroller.scrollTop + 24;
    let current = this.headings[0].id;
    for (const h of this.headings) {
      const node = this.byId.get(h.id);
      if (node && node.offsetTop <= y) current = h.id; else break;
    }
    for (const link of this.nav.querySelectorAll('.dv-toc-link')) {
      if (link.dataset.id === current) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
    }
  }

  setToc(on) { this.toc = !!on; this.wrap.classList.toggle('dv-has-toc', this.toc && this.headings.length > 1); }

  // ---- search with the highlight registry
  clearHighlights() {
    if (typeof CSS !== 'undefined' && CSS.highlights) { CSS.highlights.delete('dv-hit'); CSS.highlights.delete('dv-current'); }
  }

  async search(query, cs) {
    this.clearHighlights();
    this.ranges = []; this.hitIdx = -1;
    if (!query) return { count: 0 };
    if (!CSS.highlights) throw new Error(t('This window cannot mark search results in a page'));
    const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT);
    const needle = cs ? query : query.toLowerCase();
    for (let n = walker.nextNode(); n && this.ranges.length < 5000; n = walker.nextNode()) {
      const text = cs ? n.data : n.data.toLowerCase();
      if (text.length !== n.data.length) continue;
      for (let at = text.indexOf(needle); at !== -1 && this.ranges.length < 5000; at = text.indexOf(needle, at + needle.length)) {
        const r = document.createRange();
        r.setStart(n, at); r.setEnd(n, at + needle.length);
        this.ranges.push(r);
      }
    }
    CSS.highlights.set('dv-hit', new Highlight(...this.ranges));
    if (this.ranges.length) this.go(0);
    return { count: this.ranges.length, capped: this.ranges.length >= 5000 };
  }

  go(index) {
    if (!this.ranges.length) return;
    const n = this.ranges.length;
    this.hitIdx = ((index % n) + n) % n;
    const r = this.ranges[this.hitIdx];
    CSS.highlights.set('dv-current', new Highlight(r));
    const node = r.startContainer.parentElement;
    node.scrollIntoView({ block: 'center' });
    return this.hitIdx;
  }
  next() { return this.go(this.hitIdx + 1); }
  prev() { return this.go(this.hitIdx - 1); }
  hitState() { return { index: this.hitIdx, count: this.ranges.length }; }
}
