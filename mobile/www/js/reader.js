// === Vex Mobile — reader ===
//
// Pull the article out of the page and render it in the chrome's own type, at
// a size you choose, in the theme you chose. The extraction runs inside the
// page (VexTabs.evaluate) because that is the only place with the DOM; what
// comes back is data, and it is treated as data — the text is inserted as
// text nodes, never as HTML, so a page cannot script the reader.
//
// The scoring is the well-known readability heuristic in miniature: score
// block candidates by paragraph text length and comma count, discount the
// usual furniture, take the best subtree.

const VexReader = (() => {
  const EXTRACT = `(function(){
  function score(node) {
    var text = node.innerText || '';
    if (text.length < 140) return -1;
    var value = text.length / 100 + (text.split(',').length - 1);
    var marker = ((node.className || '') + ' ' + (node.id || '')).toLowerCase();
    if (/comment|sidebar|footer|header|nav|menu|promo|advert|share|related|subscribe/.test(marker)) value -= 25;
    if (/article|content|post|story|entry|body|main/.test(marker)) value += 25;
    if (node.tagName === 'ARTICLE') value += 40;
    if (node.tagName === 'MAIN') value += 20;
    var links = node.querySelectorAll('a');
    var linkText = 0;
    for (var i = 0; i < links.length; i++) linkText += (links[i].innerText || '').length;
    if (text.length && linkText / text.length > 0.4) value -= 30;
    return value;
  }
  var best = null, bestScore = 0;
  var candidates = document.querySelectorAll('article, main, section, div, td');
  for (var i = 0; i < candidates.length; i++) {
    var value = score(candidates[i]);
    if (value > bestScore) { bestScore = value; best = candidates[i]; }
  }
  if (!best) best = document.body;
  var blocks = [];
  var nodes = best.querySelectorAll('h1, h2, h3, h4, p, li, blockquote, pre, figcaption, img');
  for (var j = 0; j < nodes.length && blocks.length < 400; j++) {
    var node = nodes[j];
    if (node.tagName === 'IMG') {
      var source = node.currentSrc || node.src || '';
      if (source && node.naturalWidth > 200) blocks.push({ type: 'img', src: source, alt: node.alt || '' });
      continue;
    }
    if (node.closest('nav, footer, aside')) continue;
    var text = (node.innerText || '').trim();
    if (!text || text.length < 2) continue;
    blocks.push({ type: node.tagName.toLowerCase(), text: text });
  }
  var byline = '';
  var author = document.querySelector('[rel=author], .byline, [itemprop=author], meta[name=author]');
  if (author) byline = (author.content || author.innerText || '').trim().slice(0, 120);
  var published = document.querySelector('time[datetime], meta[property="article:published_time"]');
  return JSON.stringify({
    ok: blocks.length > 2,
    title: (document.querySelector('h1') || {}).innerText || document.title || '',
    byline: byline,
    published: published ? (published.getAttribute('datetime') || published.content || '') : '',
    words: (best.innerText || '').split(/\\s+/).length,
    blocks: blocks
  });
})()`;

  // evaluate() hands back a JSON string, sometimes double-encoded by the
  // WebView. Unwrap either shape, and never trust what comes out.
  function parse(raw) {
    if (raw == null) return null;
    let value = raw;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (typeof value !== 'string') break;
      try { value = JSON.parse(value); } catch { return null; }
    }
    return value && typeof value === 'object' && Array.isArray(value.blocks) ? value : null;
  }

  return {
    EXTRACT,
    parse,

    async extract(tabId) {
      const { result } = await VexBridge.evaluate(tabId, EXTRACT);
      return parse(result);
    },

    // Page text for the assistant: the same extraction, flattened and capped
    // so a long page cannot blow up the request.
    async pageText(tabId, limit = 6000) {
      const article = await this.extract(tabId);
      if (!article) return '';
      const text = article.blocks
        .filter(block => block.text)
        .map(block => block.text)
        .join('\n');
      return (article.title ? article.title + '\n\n' : '') + text.slice(0, limit);
    },

    estimateMinutes(article) {
      const words = article && article.words ? article.words : 0;
      return Math.max(1, Math.round(words / 220));
    }
  };
})();

if (typeof window !== 'undefined') window.VexReader = VexReader;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexReader };
