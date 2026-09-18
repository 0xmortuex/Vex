// === Where a link really goes, and what it carries =========================
//
// Three small things a browser should do and most do not:
//
//   Say where a link actually goes. A shortened or wrapped link shows the
//   wrapper, not the destination, and that is the whole mechanism behind a
//   pasted link that is not what it claims.
//
//   Not carry the tracker when you share. Copy a link from almost any site and
//   you copy its campaign tags too — and send the person you share it with a
//   token that ties them to you.
//
//   Notice a lookalike address. paypa1.com, github-support.co, and the
//   punycode ones that are not even in the same alphabet. Nothing in Vex
//   looked at this before.
//
// Public: LinkSafety.unwrap(url), .strip(url), .describe(url), .lookalike(host).
const LinkSafety = {
  // Parameters that identify a person or a campaign rather than a page. The
  // key is only removed when the URL still works without it — which is every
  // one of these: they are read by analytics, never by the page.
  TRACKING: /^(utm_[a-z_]+|fbclid|gclid|gclsrc|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|_ga|_gl|igshid|yclid|twclid|ttclid|li_fat_id|s_cid|ref_src|ref_url|mkt_tok|oly_anon_id|oly_enc_id|_hsenc|_hsmi|vero_id|vero_conv|wickedid|hsa_[a-z]+|epik|s_kwcid|cmpid|campaign_id|ad_id|adset_id|pk_campaign|pk_kwd|piwik_[a-z]+|matomo_[a-z]+|spm|scm|share_source|share_medium|si|feature|_branch_match_id|irclickid|sourceid|trk|trkCampaign|guccounter|guce_referrer|guce_referrer_sig)$/i,

  // Wrappers that carry the real address in a parameter. Unwrapping is done
  // locally — no request is made, so nothing is told that you looked.
  WRAPPERS: [
    { host: /^(www\.)?google\.[a-z.]+$/i, path: /^\/url$/, params: ['q', 'url'] },
    { host: /^l\.facebook\.com$/i, path: /^\/l\.php$/, params: ['u'] },
    { host: /^(www\.)?duckduckgo\.com$/i, path: /^\/l\/?$/, params: ['uddg'] },
    { host: /^out\.reddit\.com$/i, path: /.*/, params: ['url'] },
    { host: /^(www\.)?youtube\.com$/i, path: /^\/redirect$/, params: ['q'] },
    { host: /^steamcommunity\.com$/i, path: /^\/linkfilter\/?$/, params: ['url'] },
    { host: /^(www\.)?bing\.com$/i, path: /^\/ck\/a$/, params: ['u'] },
    { host: /^(www\.)?linkedin\.com$/i, path: /^\/redir\/redirect$/, params: ['url'] },
    { host: /^href\.li$/i, path: /.*/, params: [] },            // href.li/?<url>
  ],

  // The sites people are sent to a fake of. Only well-known ones: a list that
  // is too eager would warn about every small site with a similar name.
  GUARDED: [
    'google.com', 'youtube.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'amazon.com',
    'paypal.com', 'apple.com', 'microsoft.com', 'live.com', 'outlook.com', 'netflix.com', 'spotify.com',
    'github.com', 'gitlab.com', 'discord.com', 'discordapp.com', 'steampowered.com', 'steamcommunity.com',
    'roblox.com', 'binance.com', 'coinbase.com', 'metamask.io', 'whatsapp.com', 'telegram.org',
    'reddit.com', 'twitch.tv', 'epicgames.com', 'ea.com', 'battle.net', 'riotgames.com',
  ],

  _url(u) { try { return new URL(String(u)); } catch { return null; } },

  // Follow the wrappers until the real address falls out. Bounded, because a
  // wrapper can wrap a wrapper.
  unwrap(url, depth = 0) {
    const u = this._url(url);
    if (!u || depth > 4) return String(url || '');
    for (const w of this.WRAPPERS) {
      if (!w.host.test(u.hostname) || !w.path.test(u.pathname)) continue;
      let inner = null;
      for (const p of w.params) { const v = u.searchParams.get(p); if (v) { inner = v; break; } }
      // href.li puts the address after a bare "?" with no name at all.
      if (!inner && !w.params.length && u.search.length > 1) inner = decodeURIComponent(u.search.slice(1));
      if (inner && /^https?:\/\//i.test(inner)) return this.unwrap(inner, depth + 1);
    }
    return u.href;
  },

  // The same link without what identifies you. Order is kept, so the result is
  // still recognisably the link the user copied.
  strip(url) {
    const u = this._url(url);
    if (!u || !/^https?:$/.test(u.protocol)) return String(url || '');
    let removed = 0;
    for (const key of [...u.searchParams.keys()]) {
      if (this.TRACKING.test(key)) { u.searchParams.delete(key); removed++; }
    }
    // A '?' left with nothing after it is noise.
    let out = u.href;
    if (!u.searchParams.toString()) out = out.replace(/\?(?=#|$)/, '');
    return removed ? out : u.href;
  },

  // Both, which is what "copy this link" should mean.
  clean(url) { return this.strip(this.unwrap(url)); },

  // Is this host pretending to be one of the guarded ones?
  // → { host, looksLike, why } or null
  lookalike(host) {
    const h = String(host || '').toLowerCase().replace(/^www\./, '');
    if (!h || this.GUARDED.includes(h)) return null;

    // 1. Not even in this alphabet. A punycode host that decodes to something
    //    a person reads as Latin is the classic one.
    if (/(^|\.)xn--/.test(h)) return { host: h, looksLike: null, why: 'This address is written in another alphabet, which can be made to look exactly like a familiar name.' };

    const bare = h.replace(/\.[a-z.]+$/, '');            // drop the ending
    for (const guarded of this.GUARDED) {
      const gBare = guarded.replace(/\.[a-z.]+$/, '');
      if (bare === gBare) {
        // 2. The right name, the wrong ending: paypal.com vs paypal.security.
        if (h !== guarded) return { host: h, looksLike: guarded, why: `The name matches ${guarded}, but the ending does not.` };
        continue;
      }
      // 3. A character swapped for one that looks like it.
      const folded = bare.replace(/[013456789]/g, (d) => ({ 0: 'o', 1: 'l', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 8: 'b', 9: 'g' })[d]).replace(/[-_.]/g, '');
      if (folded === gBare.replace(/[-_.]/g, '')) return { host: h, looksLike: guarded, why: `This reads as ${guarded} with characters swapped for ones that look the same.` };
      // 4. The real name with something bolted on: github-support.co,
      //    secure-paypal.net. Only for names long enough not to collide.
      if (gBare.length >= 5 && new RegExp(`(^|[-.])${gBare}([-.]|$)`).test(bare) && !h.endsWith('.' + guarded)) {
        return { host: h, looksLike: guarded, why: `This contains ${gBare} but is not ${guarded}.` };
      }
    }
    return null;
  },

  // Everything worth saying about a link before it is followed.
  describe(url) {
    const raw = String(url || '');
    const real = this.unwrap(raw);
    const clean = this.strip(real);
    const u = this._url(real);
    return {
      url: raw,
      real,
      clean,
      wrapped: real !== raw,
      tracked: clean !== real,
      host: u ? u.hostname : '',
      insecure: !!u && u.protocol === 'http:',
      lookalike: u ? this.lookalike(u.hostname) : null,
    };
  },
};

// A bar across the top of the page, once per host per session. It does not
// block: Vex is not sure enough to stand in the way, and a browser that cries
// wolf is a browser whose warnings are clicked away without reading.
LinkSafety._warned = new Set();
LinkSafety.warnOnce = function (warn, webview) {
  if (!warn || this._warned.has(warn.host)) return false;
  this._warned.add(warn.host);
  document.querySelector('.lookalike-warn')?.remove();
  const bar = document.createElement('div');
  bar.className = 'lookalike-warn';
  bar.innerHTML = '<div class="lw-text"><strong></strong><span></span></div><div class="lw-actions"><button class="lw-btn lw-leave">Go back</button><button class="lw-btn">Stay</button></div>';
  bar.querySelector('strong').textContent = warn.looksLike ? `This is not ${warn.looksLike}` : 'This address is not what it looks like';
  bar.querySelector('span').textContent = `You are on ${warn.host}. ${warn.why} Check it before signing in or paying.`;
  bar.querySelector('.lw-leave').addEventListener('click', () => {
    bar.remove();
    try { if (webview && webview.canGoBack && webview.canGoBack()) webview.goBack(); else if (typeof TabManager !== 'undefined') TabManager.closeTab(TabManager.activeTabId); } catch {}
  });
  bar.querySelectorAll('.lw-btn')[1].addEventListener('click', () => bar.remove());
  document.body.appendChild(bar);
  VexProblems?.note('Link safety', 'Visited a lookalike address: ' + warn.host, warn.why);
  return true;
};

if (typeof window !== 'undefined') window.LinkSafety = LinkSafety;
if (typeof module !== 'undefined' && module.exports) module.exports = { LinkSafety };
