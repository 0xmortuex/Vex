// Finding words in text the viewer drew. Matching is forgiving the way a person types: capitals do not matter, and in Turkish the
// letters with marks match the plain ones (isparta finds Isparta, İsparta and Ispartalı; sasirdi finds şaşırdı) unless "Aa"
// (match case) is on. Matches are shown with the page's custom highlights, so the document is not changed to show them.

const FOLD = { 'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'İ': 'i', 'I': 'i', 'ö': 'o', 'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u', 'â': 'a', 'Â': 'a', 'î': 'i', 'Î': 'i', 'û': 'u', 'Û': 'u' };
// One character in, one character out, so positions in the folded text are positions in the original.
export function fold(text, matchCase) {
  if (matchCase) return text;
  let out = '';
  for (const ch of text) {
    const f = FOLD[ch];
    if (f) { out += f; continue; }
    const lower = ch.toLowerCase();
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
}

const BLOCK = /^(P|DIV|LI|TD|TH|TR|H[1-6]|BLOCKQUOTE|PRE|SECTION|ARTICLE|TABLE|UL|OL|BR|HR|FIGURE|FIGCAPTION|DD|DT)$/;

// The text of an element with a virtual line break between blocks, and where each text node sits in it.
export function textIndex(root) {
  const segs = [];
  let text = '';
  let lastBlock = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (!p || p.closest('style, script, [aria-hidden="true"], .od-nofind')) return NodeFilter.FILTER_REJECT;
      return node.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    let b = n.parentElement;
    while (b && b !== root && !BLOCK.test(b.tagName)) b = b.parentElement;
    if (lastBlock !== null && b !== lastBlock) text += '\n';
    lastBlock = b;
    segs.push({ node: n, start: text.length });
    text += n.nodeValue;
  }
  return { text, segs };
}

function locate(index, offset, atEnd) {
  const { segs } = index;
  let lo = 0, hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].start <= offset) lo = mid; else hi = mid - 1;
  }
  const s = segs[lo];
  let o = offset - s.start;
  if (atEnd && o === 0 && lo > 0) { const p = segs[lo - 1]; return { node: p.node, offset: p.node.nodeValue.length }; }
  o = Math.min(o, s.node.nodeValue.length);
  return { node: s.node, offset: o };
}

// -> Range[] ; opts { matchCase, whole }
export function findRanges(root, query, opts = {}, limit = 5000) {
  const q = fold(String(query || ''), opts.matchCase);
  if (!q.trim()) return [];
  const index = textIndex(root);
  if (!index.segs.length) return [];
  const hay = fold(index.text, opts.matchCase);
  const ranges = [];
  let from = 0;
  const wordChar = /[\p{L}\p{N}_]/u;
  while (ranges.length < limit) {
    const at = hay.indexOf(q, from);
    if (at < 0) break;
    from = at + Math.max(1, q.length);
    if (opts.whole) {
      const before = at > 0 ? hay[at - 1] : '', after = hay[at + q.length] || '';
      if ((before && wordChar.test(before)) || (after && wordChar.test(after))) continue;
    }
    const a = locate(index, at, false), b = locate(index, at + q.length, true);
    const r = document.createRange();
    try { r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset); } catch { continue; }
    ranges.push(r);
  }
  return ranges;
}

// Plain text positions (no virtual breaks) of every match in a string; used for the places the DOM does not hold (a book's other chapters).
export function findOffsets(text, query, opts = {}, limit = 2000) {
  const q = fold(String(query || ''), opts.matchCase);
  if (!q.trim()) return [];
  const hay = fold(text, opts.matchCase);
  const out = [];
  let from = 0;
  const wordChar = /[\p{L}\p{N}_]/u;
  while (out.length < limit) {
    const at = hay.indexOf(q, from);
    if (at < 0) break;
    from = at + Math.max(1, q.length);
    if (opts.whole) {
      const before = at > 0 ? hay[at - 1] : '', after = hay[at + q.length] || '';
      if ((before && wordChar.test(before)) || (after && wordChar.test(after))) continue;
    }
    out.push(at);
  }
  return out;
}

// ---- highlights ----------------------------------------------------------------------------------
const supported = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
export function paintFind(ranges, current) {
  if (!supported) return;
  CSS.highlights.set('od-find', new Highlight(...ranges));
  if (current) CSS.highlights.set('od-find-current', new Highlight(current)); else CSS.highlights.delete('od-find-current');
}
export function clearFind() { if (supported) { CSS.highlights.delete('od-find'); CSS.highlights.delete('od-find-current'); } }

// Brings a range into view inside its scroller, a third of the way down so there is context above it.
export function revealRange(range, scroller) {
  const rect = range.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) {
    const parent = range.startContainer.parentElement;
    if (parent) parent.scrollIntoView({ block: 'center' });
    return;
  }
  const box = scroller.getBoundingClientRect();
  scroller.scrollTo({ top: scroller.scrollTop + (rect.top - box.top) - box.height / 3, left: Math.max(0, scroller.scrollLeft + (rect.left - box.left) - box.width / 3), behavior: 'auto' });
}

// A small find controller for views that draw into one element: it owns the list of ranges and the "n of m" position.
export function createTextFinder(getRoot, getScroller) {
  let ranges = [];
  let pos = -1;
  const show = () => { paintFind(ranges, ranges[pos]); if (ranges[pos]) revealRange(ranges[pos], getScroller()); };
  return {
    run(query, opts) {
      const root = getRoot();
      ranges = root ? findRanges(root, query, opts) : [];
      pos = ranges.length ? 0 : -1;
      show();
      return { count: ranges.length, index: pos };
    },
    step(dir) {
      if (!ranges.length) return { count: 0, index: -1 };
      pos = (pos + dir + ranges.length) % ranges.length;
      show();
      return { count: ranges.length, index: pos };
    },
    clear() { ranges = []; pos = -1; clearFind(); },
  };
}
