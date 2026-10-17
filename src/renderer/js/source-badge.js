// === Source quality badge (T3-115) ==================================================
//
// "How solid is this page as a source?" in a handful of plain flags, on request. Every flag
// is a fact about the page you can check yourself, never a verdict:
//
//   domain     government or education / organisation / company / a blog or social platform
//   age        how old the page says it is (or "no date found")
//   author     whether a byline or author tag is there
//   https      whether the page came over an encrypted connection
//   outside links   how many links to other sites the article has, and whether it has a
//                   references or sources section
//   opinion    whether the address or tags say opinion, column, editorial or blog
//
// The whole thing is labelled ROUGH: a missing byline does not make a page wrong and a .edu
// address does not make one right. It reads the page you have open, in your window; nothing
// is looked up, nothing is sent, nothing is stored. Not built: matching a journal against a
// list of predatory publishers (it needs a maintained list and an online source for it).
//
//   VexSourceBadge.assess(facts, now)      pure -> { flags:[{id, label, tone}], rough:true }
//   VexSourceBadge.domainKind(host)        pure
//   vexSourcePageLib()                     runs INSIDE the page (injected as source)
function vexSourcePageLib() {
  var out = { title: document.title || '', date: '', author: false, outLinks: 0, refs: false, opinionTag: false };
  function meta(n) { var e = document.querySelector('meta[property="' + n + '"],meta[name="' + n + '"]'); return e ? (e.getAttribute('content') || '') : ''; }
  out.date = meta('article:published_time') || meta('datePublished') || meta('date') || meta('DC.date.issued') || meta('og:article:published_time') || '';
  if (!out.date) {
    var t = document.querySelector('time[datetime]');
    if (t) out.date = t.getAttribute('datetime') || '';
  }
  if (!out.date) {
    var ld = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < ld.length && !out.date; i++) {
      var m = /"datePublished"\s*:\s*"([^"]+)"/.exec(ld[i].textContent || '');
      if (m) out.date = m[1];
    }
  }
  out.author = !!(meta('author') || meta('article:author') || meta('DC.creator') || document.querySelector('[rel="author"],[itemprop="author"],.byline,.author,[class*="byline"]'));
  var root = document.querySelector('article,main,[role="main"]') || document.body;
  var host = location.hostname.replace(/^www\./, '');
  var links = root ? root.querySelectorAll('a[href^="http"]') : [];
  var seen = {};
  for (var j = 0; j < links.length; j++) {
    try { var h = new URL(links[j].href).hostname.replace(/^www\./, ''); if (h && h !== host && !seen[h]) seen[h] = 1; } catch (e) { /* vex-allow-empty-catch: a href that is not a URL is not an outside link */ }
  }
  out.outLinks = Object.keys(seen).length;
  var heads = document.querySelectorAll('h1,h2,h3,h4');
  for (var k = 0; k < heads.length; k++) if (/^\s*(references|sources|bibliography|citations|notes|kaynak(?:lar|ça)?)\s*$/i.test(heads[k].textContent || '')) { out.refs = true; break; }
  if (!out.refs && document.querySelector('.references,#references,.footnotes,[role="doc-endnotes"],[role="doc-bibliography"]')) out.refs = true;
  out.opinionTag = /opinion|editorial|column|commentary|op-ed/i.test(meta('article:section') + ' ' + meta('og:type') + ' ' + meta('section'));
  return out;
}

const VexSourceBadge = {
  PREF: 'vex.sourceBadge.enabled',
  BLOG_HOSTS: ['blogspot.', 'wordpress.com', 'medium.com', 'substack.com', 'wixsite.com', 'tumblr.com', 'weebly.com', 'blogger.com', 'ghost.io', 'wattpad.com'],
  SOCIAL_HOSTS: ['facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'tiktok.com', 'reddit.com', 'quora.com', 'youtube.com', 'linkedin.com', 'pinterest.com', 'eksisozluk.com'],
  WIKI_HOSTS: ['wikipedia.org', 'wikihow.com', 'fandom.com'],

  _flag: null,
  _f() { return this._flag || (this._flag = VexStudyKit.flag(this.PREF)); },
  enabled() { return this._f().enabled(); },
  setEnabled(on) { this._f().set(on); },

  domainKind(host) {
    const h = String(host || '').toLowerCase().replace(/^www\./, '');
    if (!h) return { id: 'unknown', label: 'No web address', tone: 'info' };
    if (/(^|\.)(gov|mil|int)$/.test(h) || /\.gov\.[a-z]{2}$/.test(h) || /\.(k12|bel|pol)\.tr$/.test(h)) return { id: 'gov', label: 'Government or public body address', tone: 'good' };
    if (/\.edu$/.test(h) || /\.edu\.[a-z]{2}$/.test(h) || /\.ac\.[a-z]{2}$/.test(h)) return { id: 'edu', label: 'University or school address', tone: 'good' };
    if (this.WIKI_HOSTS.some(x => h === x || h.endsWith('.' + x))) return { id: 'wiki', label: 'Open wiki: anyone can edit it', tone: 'warn' };
    if (this.SOCIAL_HOSTS.some(x => h === x || h.endsWith('.' + x))) return { id: 'social', label: 'Social platform: posts by anyone', tone: 'warn' };
    if (this.BLOG_HOSTS.some(x => h.includes(x))) return { id: 'blog', label: 'Blog platform: written by whoever owns the blog', tone: 'warn' };
    if (/\.org(\.[a-z]{2})?$/.test(h)) return { id: 'org', label: 'Organisation address (.org): anyone can register one', tone: 'info' };
    return { id: 'com', label: 'Company or general address', tone: 'info' };
  },

  _years(dateStr, now) {
    if (!dateStr) return null;
    const t = Date.parse(dateStr);
    if (!Number.isFinite(t) || t > now + 86400000 * 2) return null;
    return (now - t) / (365.25 * 86400000);
  },

  assess(f, now = Date.now()) {
    const facts = f || {};
    let host = '', https = false, path = '';
    try { const u = new URL(String(facts.url || '')); host = u.hostname; https = u.protocol === 'https:'; path = u.pathname; } catch { /* vex-allow-empty-catch: not a web address, so only the "no address" flag is shown */ }
    const flags = [];
    flags.push(this.domainKind(host));
    if (host) flags.push(https ? { id: 'https', label: 'Encrypted connection (https)', tone: 'good' } : { id: 'https', label: 'Not encrypted (http)', tone: 'warn' });
    const yrs = this._years(facts.date, now);
    if (yrs == null) flags.push({ id: 'age', label: 'No publication date found on the page', tone: 'warn' });
    else if (yrs < 1) flags.push({ id: 'age', label: 'Published within the last year', tone: 'good' });
    else flags.push({ id: 'age', label: 'Published about ' + Math.round(yrs) + ' year' + VexPlural.s(Math.round(yrs)) + ' ago' + (yrs > 5 ? ' (old for fast-changing topics)' : ''), tone: yrs > 5 ? 'warn' : 'info' });
    flags.push(facts.author ? { id: 'author', label: 'A byline or author is named', tone: 'good' } : { id: 'author', label: 'No author found on the page', tone: 'warn' });
    const out = Number(facts.outLinks) || 0;
    if (facts.refs || out >= 3) flags.push({ id: 'cites', label: (facts.refs ? 'Has a references or sources section' : 'Links to ' + out + ' other sites') + (facts.refs && out ? ' and links to ' + out + ' other sites' : ''), tone: 'good' });
    else flags.push({ id: 'cites', label: out ? 'Links to only ' + out + ' other site' + VexPlural.s(out) + ', no references section' : 'No references and no links to other sites', tone: 'warn' });
    if (facts.opinionTag || /\/(opinion|op-ed|editorial|column|columns|commentary|blog|blogs|views)(\/|$)/i.test(path)) flags.push({ id: 'opinion', label: 'Marked as opinion, column or blog', tone: 'warn' });
    return { flags, rough: true, host };
  },

  async inspect(webview) {
    if (!webview || typeof webview.executeJavaScript !== 'function') throw new Error('Open a web page first');
    const url = String((webview.getURL && webview.getURL()) || '');
    if (!/^https?:\/\//i.test(url)) throw new Error('This is not a web page, so there is nothing to assess');
    const facts = await webview.executeJavaScript('(' + vexSourcePageLib.toString() + ')()');
    return { facts: { ...facts, url }, result: this.assess({ ...facts, url }) };
  },

  async open(webview) {
    if (typeof VexUsage !== 'undefined') VexUsage.touch('source-badge');
    const wv = webview || (typeof WebviewManager !== 'undefined' ? WebviewManager.getActiveWebview() : null);
    const { facts, result } = await this.inspect(wv);
    const K = VexStudyKit, G = VexSettingsGroups;
    const { body } = G.dialog({ id: 'vex-source-badge', title: 'Source check (rough)', sub: (facts.title || result.host) + '. Flags to judge by, not a verdict.' });
    const colour = { good: '#22c55e', warn: '#eab308', info: '#94a3b8' };
    for (const f of result.flags) body.appendChild(K.el('div', { style: 'margin:6px 0;padding-left:8px;border-left:3px solid ' + colour[f.tone], text: f.label }));
    body.appendChild(G.note('Rough: a missing byline does not make a page wrong, and a .edu address does not make one right. Checked on this computer; nothing was sent.'));
    return result;
  },

  group(el) {
    const G = VexSettingsGroups;
    el.appendChild(G.note('On request, a handful of plain flags about the page you have open: what kind of address, how old, an author, https, outside links, opinion. Labelled rough; nothing is looked up.'));
    el.appendChild(G.button('Check the current page', VexStudyKit.guard(() => this.open()), { primary: true }));
  },
};

if (typeof window !== 'undefined') { window.VexSourceBadge = VexSourceBadge; window.vexSourcePageLib = vexSourcePageLib; }
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSourceBadge, vexSourcePageLib };
