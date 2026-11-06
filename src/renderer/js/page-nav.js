// === Next page / previous page with one key =================================================================
//
// Search results, forum threads, documentation chapters, galleries: they all have a "next" somewhere, drawn a
// hundred ways. One key (Alt+PageDown, and Alt+PageUp for the way back; rebindable in Settings > Shortcuts, also
// Ctrl+K) finds it and goes there. The page is asked, in this order:
//   1. <link rel="next|prev"> in the head, or <a rel="next|prev">  (what the site itself says)
//   2. a link whose words are Next, Previous, Older, Newer, Sonraki, Önceki, İleri, Geri, » › « ‹ ... (or whose
//      class says so), preferring one inside a pagination block
//   3. numbered pagination: the link after the current number
// The address found is checked (http or https, not the page itself) and opened in this tab like a typed address.
// If nothing is found, it says so; it never guesses an address by adding 1 to a number in the URL.
//
// findAdjacentPage() is written to be self-contained: it is sent to the page as source text (Function.toString)
// and run there, and the tests run the very same function against synthetic documents. Do not make it use
// anything outside itself.
function findAdjacentPage(doc, dir, here) {
  var forward = dir === 'next';
  var hasLayout = !!(doc.documentElement && doc.documentElement.getClientRects && doc.documentElement.getClientRects().length);

  function fold(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').toLowerCase();
  }
  function words(s) { return fold(s).replace(/[\s ]+/g, ' ').trim(); }
  function same(a, b) { return a.split('#')[0] === b.split('#')[0]; }
  function resolve(href) {
    if (!href || /^\s*(javascript|mailto|tel|data):/i.test(href)) return '';
    try {
      var u = new URL(href, here);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      var out = u.href;
      if (same(out, here)) return '';
      return out;
    } catch (e) { return ''; }
  }
  function shown(el) {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    if (!hasLayout) return true;
    return el.getClientRects().length > 0;
  }
  function found(el, how, label) {
    var href = resolve(el.getAttribute('href'));
    return href ? { href: href, how: how, label: String(label || '').trim().slice(0, 60) } : null;
  }

  // 1. what the site says
  var relWord = forward ? 'next' : 'prev';
  var rels = doc.querySelectorAll('link[rel][href], a[rel][href], area[rel][href]');
  var pick = null;
  for (var i = 0; i < rels.length; i++) {
    var toks = fold(rels[i].getAttribute('rel')).split(/\s+/);
    if (toks.indexOf(relWord) === -1 && (forward || toks.indexOf('previous') === -1)) continue;
    var r = found(rels[i], 'rel', rels[i].textContent || relWord);
    if (!r) continue;
    // <link> first (it is the site's own statement); an <a> only if there is none.
    if (rels[i].tagName === 'LINK') return r;
    if (!pick) pick = r;
  }
  if (pick) return pick;

  // 2. the words on the link
  var BASE = forward
    ? ['next', 'older', 'forward', 'sonraki', 'ileri', 'daha eski', 'devam']
    : ['previous', 'prev', 'newer', 'onceki', 'geri', 'daha yeni'];
  var TAIL = ['', 'page', 'pages', 'post', 'posts', 'entry', 'entries', 'result', 'results', 'sayfa', 'yazi', 'yazilar', 'sonuc', 'sonuclar'];
  var ARROWS = forward ? '»›>→▶▸❯→' : '«‹<←◀◂❮←';
  var arrowRe = new RegExp('^[' + ARROWS.replace(/[\]\\^-]/g, '\\$&') + '\\s]+$');
  var anyArrow = /[»›>→▶▸❯«‹<←◀◂❮]+/g;
  function wordsMatch(raw) {
    var w = words(raw);
    if (!w) return false;
    if (arrowRe.test(w)) return true;
    w = w.replace(anyArrow, ' ').replace(/\d+/g, ' ').replace(/[.:…–—-]+/g, ' ').replace(/\s+/g, ' ').trim();
    for (var b = 0; b < BASE.length; b++) for (var t = 0; t < TAIL.length; t++) {
      if (w === (BASE[b] + (TAIL[t] ? ' ' + TAIL[t] : ''))) return true;
    }
    return false;
  }
  var classWord = forward ? /(^|[^a-z0-9])(next|pagination-next|page-next|next-page|nextpage)([^a-z0-9]|$)/ : /(^|[^a-z0-9])(prev|previous|pagination-prev|page-prev|prev-page|prevpage|pagination-previous)([^a-z0-9]|$)/;
  var carousel = /slick|swiper|carousel|slider|owl|flickity|splide|glide|lightbox|fancybox|story|video/;
  var inPagination = /pagin|pager|page-nav|nav-links|paging|sayfa|results-nav|navigation/;
  function containerScore(el) {
    var n = el.parentElement;
    for (var d = 0; n && d < 5; d++, n = n.parentElement) {
      var tag = (n.tagName || '').toLowerCase();
      var info = fold((n.className && n.className.baseVal === undefined ? n.className : '') + ' ' + (n.id || '') + ' ' + (n.getAttribute('aria-label') || '') + ' ' + (n.getAttribute('role') || ''));
      if (inPagination.test(info)) return 2;
      if (tag === 'nav') return 1;
    }
    return 0;
  }
  var anchors = doc.querySelectorAll('a[href]');
  var best = null, bestScore = -1;
  for (var k = 0; k < anchors.length; k++) {
    var a = anchors[k];
    if (!shown(a)) continue;
    var img = a.querySelector('img[alt]');
    var labels = [a.textContent, a.getAttribute('aria-label'), a.getAttribute('title'), img ? img.getAttribute('alt') : ''];
    var viaWords = false;
    for (var l = 0; l < labels.length; l++) if (labels[l] && String(labels[l]).length < 40 && wordsMatch(labels[l])) { viaWords = true; break; }
    var cls = fold((a.getAttribute('class') || '') + ' ' + (a.id || ''));
    var viaClass = !viaWords && classWord.test(cls) && !carousel.test(cls + ' ' + fold((a.parentElement && a.parentElement.getAttribute('class')) || ''));
    if (!viaWords && !viaClass) continue;
    var score = (viaWords ? 4 : 2) + containerScore(a);
    if (score > bestScore) {
      var r2 = found(a, viaWords ? 'text' : 'class', (a.textContent || '').trim() || a.getAttribute('aria-label') || relWord);
      if (r2) { best = r2; bestScore = score; }
    }
  }
  if (best) return best;

  // 3. numbered pagination: the link after (or before) the current number
  function num(el) {
    var t = (el.textContent || '').trim();
    if (/^\d{1,5}$/.test(t)) return parseInt(t, 10);
    var lab = el.getAttribute && (el.getAttribute('aria-label') || '');
    var m = /^(?:go to |page |sayfa |git: )?(?:page|sayfa)?\s*(\d{1,5})$/.exec(words(lab));
    return m ? parseInt(m[1], 10) : null;
  }
  function numericItems(root) {
    var out = [];
    var els = root.querySelectorAll('a, span, strong, b, em, button, li');
    for (var q = 0; q < els.length; q++) {
      var e = els[q];
      if (e.tagName === 'LI' && e.querySelector('a, span, strong, b, em, button')) continue;
      if (e.querySelector && e.querySelector('a, span, strong, b, em, button') && e.tagName !== 'A') continue;
      var v = num(e);
      if (v !== null && (e.tagName === 'A' ? shown(e) : true)) out.push({ el: e, n: v });
    }
    return out;
  }
  var ANCHOR_NUMS = [];
  for (var z = 0; z < anchors.length; z++) { var nv = num(anchors[z]); if (nv !== null && shown(anchors[z])) ANCHOR_NUMS.push(anchors[z]); }
  var seen = [];
  for (var y = 0; y < ANCHOR_NUMS.length; y++) {
    var node = ANCHOR_NUMS[y].parentElement;
    for (var up = 0; node && up < 5; up++, node = node.parentElement) {
      var items = numericItems(node);
      var linked = items.filter(function (it) { return it.el.tagName === 'A'; });
      if (linked.length < 2 || items.length < 3) continue;
      if (seen.indexOf(node) !== -1) break;
      seen.push(node);
      // the current one: marked, or the one that is not a link, or the one the address names
      var cur = null;
      for (var c = 0; c < items.length && !cur; c++) {
        var el = items[c].el, host = el.closest ? el.closest('li') : null;
        var mark = fold((el.getAttribute('class') || '') + ' ' + (host ? host.getAttribute('class') || '' : ''));
        if (el.getAttribute('aria-current') === 'page' || el.getAttribute('aria-current') === 'true' || (host && host.getAttribute('aria-current')) || /(^|[^a-z])(current|active|selected)([^a-z]|$)/.test(mark)) cur = items[c];
      }
      if (!cur) {
        var plain = items.filter(function (it) { return it.el.tagName !== 'A' && !(it.el.closest && it.el.closest('a[href]')); });
        if (plain.length === 1) cur = plain[0];
      }
      if (!cur) {
        var qn = /[?&](?:page|p|pg|pagina|sayfa|paged)=(\d{1,5})(?:&|#|$)/i.exec(here) || /\/(?:page|sayfa|p)\/(\d{1,5})(?:\/|$|\?|#)/i.exec(here);
        if (qn) for (var d2 = 0; d2 < items.length && !cur; d2++) if (items[d2].n === parseInt(qn[1], 10)) cur = items[d2];
      }
      if (!cur) break;
      var want = cur.n + (forward ? 1 : -1);
      var target = null;
      for (var f = 0; f < linked.length; f++) if (linked[f].n === want) { target = linked[f]; break; }
      if (!target) break;
      var rn = found(target.el, 'numbered', String(want));
      if (rn) return rn;
      break;
    }
  }
  return null;
}

const VexPageNav = {
  finder: findAdjacentPage,

  // The page-side call, as source text: the finder, the direction, the page's own address.
  script(dir) {
    if (dir !== 'next' && dir !== 'prev') throw new Error('The direction is next or prev');
    return '(' + findAdjacentPage.toString() + ')(document,' + JSON.stringify(dir) + ',location.href)';
  },

  // What the page answered, kept only if it is a plain web address (the page is not trusted).
  accept(answer) {
    if (!answer || typeof answer !== 'object' || typeof answer.href !== 'string' || answer.href.length > 8192) return null;
    let u;
    try { u = new URL(answer.href); } catch { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return { href: u.href, how: ['rel', 'text', 'class', 'numbered'].includes(answer.how) ? answer.how : 'text', label: String(answer.label || '').slice(0, 60) };
  },

  async go(dir) {
    if (typeof NavLock !== 'undefined' && NavLock.blocked()) { window.showToast?.('Not available while a side panel is open'); return false; }
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.getActiveWebview() : null;
    if (!wv || !wv._attached) { window.showToast?.('There is no page open'); return false; }
    let answer;
    try { answer = await wv.executeJavaScript(this.script(dir), true); }
    catch (err) {
      window.VexProblems?.note('Next page', 'the page could not be searched for a ' + dir + ' link', err);
      window.showToast?.('This page could not be searched for a next page', 'error');
      return false;
    }
    const hit = this.accept(answer);
    if (!hit) { window.showToast?.(dir === 'next' ? 'No next page found' : 'No previous page found'); return false; }
    WebviewManager.navigate(hit.href);
    return true;
  },

  init() {
    if (this._started) return this;
    this._started = true;
    if (typeof VexExtras !== 'undefined') {
      VexExtras.registerCommand({ id: 'page-next', label: 'Go to the next page', icon: 'arrow-right', hint: 'The next page of search results, a thread, a chapter or a gallery', keywords: 'next page pagination older sonraki sayfa ileri results forum chapter', action: () => this.go('next') });
      VexExtras.registerCommand({ id: 'page-prev', label: 'Go to the previous page', icon: 'arrow-left', hint: 'The previous page of search results, a thread, a chapter or a gallery', keywords: 'previous page pagination newer onceki sayfa geri results forum chapter', action: () => this.go('prev') });
    }
    return this;
  },
};

if (typeof window !== 'undefined') {
  window.VexPageNav = VexPageNav;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => VexPageNav.init(), { once: true });
    else VexPageNav.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPageNav, findAdjacentPage };
