// === Vex Tab Personalities ==================================================
//
// Two quiet touches in the tab strip, both OFF until switched on in
// Settings > Living Vex:
//
//   * when a tab finishes loading, its favicon does one tiny, site-flavoured
//     move (a video site pops, a code site ticks, mail nudges, ...). Once. 0.7s.
//   * a site you open most days gets a faint glow behind its favicon.
//
// No layout: the moves are transform / filter on the favicon only, never size,
// margin, padding, border or position, so a tab is the same box in every
// browser look (Classic, Glass, Chrome, Firefox, Safari, XP, ...). A test
// holds living.css to that list.
//
// The visit history is local (vex.living.visits): per host, the last 14 days it
// was opened on. It never leaves the device and is capped at 200 hosts.

const TabPersonality = (() => {
  const VISITS_KEY = 'vex.living.visits';
  const MAX_HOSTS = 200, KEEP_DAYS = 14, WINDOW_DAYS = 7, DAILY_MIN = 5;

  // Host -> flavour. Suffix match, so "m.youtube.com" is youtube.com.
  const KINDS = Object.freeze({
    video: ['youtube.com', 'twitch.tv', 'netflix.com', 'vimeo.com', 'primevideo.com', 'disneyplus.com'],
    code: ['github.com', 'gitlab.com', 'stackoverflow.com', 'npmjs.com', 'codepen.io', 'developer.mozilla.org'],
    social: ['x.com', 'twitter.com', 'reddit.com', 'instagram.com', 'facebook.com', 'discord.com', 'mastodon.social'],
    mail: ['mail.google.com', 'outlook.live.com', 'outlook.office.com', 'proton.me', 'mail.yahoo.com'],
    music: ['spotify.com', 'soundcloud.com', 'music.youtube.com', 'bandcamp.com'],
    news: ['bbc.com', 'nytimes.com', 'theguardian.com', 'news.ycombinator.com', 'reuters.com', 'cnn.com'],
    shop: ['amazon.com', 'ebay.com', 'etsy.com', 'aliexpress.com', 'trendyol.com'],
    docs: ['docs.google.com', 'notion.so', 'wikipedia.org', 'drive.google.com'],
    search: ['google.com', 'duckduckgo.com', 'bing.com', 'startpage.com', 'brave.com']
  });
  const KIND_NAMES = Object.freeze(Object.keys(KINDS).concat('default'));

  function hostOf(url) {
    try {
      const u = new URL(String(url || ''));
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return u.hostname.replace(/^www\./, '').toLowerCase();
    } catch { return ''; }
  }

  function kindFor(host) {
    if (!host) return 'default';
    for (const [kind, list] of Object.entries(KINDS)) {
      if (list.some(d => host === d || host.endsWith('.' + d))) return kind;
    }
    return 'default';
  }

  // Local calendar day, 'YYYY-MM-DD'.
  function dayKey(d) {
    const x = d instanceof Date ? d : new Date(d);
    const p = (n) => String(n).padStart(2, '0');
    return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate());
  }
  function daysAgo(day, n) {
    const [y, m, d] = day.split('-').map(Number);
    return dayKey(new Date(y, m - 1, d - n));
  }

  // visits: { host: [day, ...] } (newest last). Returns a NEW object.
  function recordVisit(visits, host, day) {
    const out = { ...(visits || {}) };
    if (!host) return out;
    const cutoff = daysAgo(day, KEEP_DAYS - 1);
    const days = (out[host] || []).filter(d => d >= cutoff && d !== day);
    days.push(day);
    out[host] = days.sort();
    const hosts = Object.keys(out);
    if (hosts.length > MAX_HOSTS) {
      hosts.sort((a, b) => out[a][out[a].length - 1].localeCompare(out[b][out[b].length - 1]));
      for (const h of hosts.slice(0, hosts.length - MAX_HOSTS)) delete out[h];
    }
    return out;
  }

  // How many of the last 7 days (today included) the host was opened on.
  function recentDays(visits, host, today) {
    const list = (visits && visits[host]) || [];
    const from = daysAgo(today, WINDOW_DAYS - 1);
    return list.filter(d => d >= from && d <= today).length;
  }
  const isDaily = (visits, host, today) => recentDays(visits, host, today) >= DAILY_MIN;

  // Pure decision: what, if anything, to play when a tab finishes loading.
  function decide({ settings, env, url, wasLoading }) {
    if (!wasLoading) return null;                    // only loading -> done
    const host = hostOf(url);
    if (!host) return null;                          // start page, about:, file:
    if (!settings.tabPersonality) return null;
    if (VexLivingRef().quietReason(env)) return null;
    return { host, kind: kindFor(host) };
  }

  function VexLivingRef() {
    if (typeof VexLiving !== 'undefined') return VexLiving;
    return require('./living-core.js').VexLiving;
  }

  // ---- DOM side -------------------------------------------------------------
  const _was = new Map();          // tab id -> was loading
  let _visits = null;
  let _installed = false;
  let _glowSig = '';
  let _frameCount = 0;

  function _load(storage) {
    try { const v = JSON.parse((storage || localStorage).getItem(VISITS_KEY) || 'null'); return v && typeof v === 'object' ? v : {}; }
    catch { return {}; }
  }
  function _save(storage) {
    try { (storage || localStorage).setItem(VISITS_KEY, JSON.stringify(_visits)); return true; } catch { return false; }
  }

  function _els(id) {
    const safe = String(id).replace(/["\\]/g, '');
    return document.querySelectorAll('.top-tab[data-tab-id="' + safe + '"], .tab-item[data-tab-id="' + safe + '"], .pinned-tab[data-tab-id="' + safe + '"]');
  }

  function play(id, kind) {
    for (const el of _els(id)) {
      for (const k of KIND_NAMES) el.classList.remove('vex-tp-' + k);
      void el.offsetWidth;                        // restart the animation if one is running
      el.classList.add('vex-tp', 'vex-tp-' + kind);
      _frameCount++;
      const done = () => { for (const k of KIND_NAMES) el.classList.remove('vex-tp-' + k); el.classList.remove('vex-tp'); el.removeEventListener('animationend', done); };
      el.addEventListener('animationend', done);
      setTimeout(done, 1200);                     // reduced motion / no animation: never stick
    }
  }

  // The daily glow is a generated stylesheet keyed by tab id, so it survives
  // every re-render of the strip without hooking tab creation.
  function refreshGlow(storage) {
    if (typeof document === 'undefined' || typeof TabManager === 'undefined') return;
    const settings = VexLivingRef().read(storage);
    let sel = [];
    if (settings.tabDailyGlow && settings.animations) {
      const today = dayKey(new Date());
      _visits = _visits || _load(storage);
      for (const t of (TabManager.tabs || [])) {
        const h = hostOf(t.url);
        if (h && isDaily(_visits, h, today)) {
          const id = String(t.id).replace(/["\\]/g, '');
          sel.push('.top-tab[data-tab-id="' + id + '"]', '.tab-item[data-tab-id="' + id + '"]', '.pinned-tab[data-tab-id="' + id + '"]');
        }
      }
    }
    const sig = sel.join(',');
    if (sig === _glowSig) return;
    _glowSig = sig;
    let style = document.getElementById('vex-tp-glow');
    if (!sig) { if (style) style.remove(); return; }
    if (!style) { style = document.createElement('style'); style.id = 'vex-tp-glow'; document.head.appendChild(style); }
    style.textContent = sel.map(s => s + ' :is(.tab-favicon,.tab-favicon-placeholder)').join(',\n')
      + '{filter:drop-shadow(0 0 3px var(--vex-accent,#d4a574));}';
  }

  function onUpdate(id, data, tab, storage) {
    if (!data || data.loading === undefined) return null;
    const wasLoading = _was.get(id) === true;
    _was.set(id, !!data.loading);
    const settings = VexLivingRef().read(storage);
    const env = VexLivingRef().readEnv({ storage });
    const url = tab ? tab.url : (data.url || '');
    const d = decide({ settings, env, url, wasLoading });
    const host = hostOf(url);
    if (host && wasLoading && !data.loading) {     // a finished load counts as a visit, whether or not it animates
      if (settings.tabDailyGlow || settings.tabPersonality) {
        _visits = recordVisit(_visits || _load(storage), host, dayKey(new Date()));
        _save(storage);
        refreshGlow(storage);
      }
    }
    if (d) play(id, d.kind);
    return d;
  }

  // Wraps TabManager.updateTab once. The wrapper runs the original first, so
  // a failure here can never stop a tab from updating; ours is reported.
  function install(manager) {
    const tm = manager || (typeof TabManager !== 'undefined' ? TabManager : null);
    if (_installed || !tm || typeof tm.updateTab !== 'function') return false;
    _installed = true;
    const orig = tm.updateTab.bind(tm);
    tm.updateTab = function (id, data) {
      const r = orig(id, data);
      try { onUpdate(id, data, (tm.tabs || []).find(t => t.id === id)); }
      catch (err) { if (typeof VexProblems !== 'undefined') VexProblems.note('Tab personality', 'Could not animate a tab', err); else console.error('[TabPersonality]', err); }
      return r;
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('vex:living-changed', () => refreshGlow());
      document.addEventListener('vex:tab-closed', (e) => { if (e.detail) _was.delete(e.detail.tabId); });
    }
    refreshGlow();
    return true;
  }

  function snapshot() {
    return { id: 'tab-personality', installed: _installed, trackedTabs: _was.size, hosts: _visits ? Object.keys(_visits).length : 0, played: _frameCount, glowRules: _glowSig ? _glowSig.split(',').length : 0 };
  }

  return { KINDS, KIND_NAMES, hostOf, kindFor, dayKey, daysAgo, recordVisit, recentDays, isDaily, decide, install, onUpdate, play, refreshGlow, snapshot, DAILY_MIN, MAX_HOSTS, _reset() { _was.clear(); _visits = null; _installed = false; _glowSig = ''; _frameCount = 0; } };
})();

if (typeof window !== 'undefined') {
  window.TabPersonality = TabPersonality;
  if (typeof VexLiving !== 'undefined') {
    VexLiving.registerSettings([
      { key: 'tabPersonality', label: 'Tab personalities: a tiny move when a tab finishes loading', type: 'toggle' },
      { key: 'tabDailyGlow', label: 'Faint glow on sites you open most days', type: 'toggle' }
    ]);
    VexLiving.ensureStyles();
    document.addEventListener('DOMContentLoaded', () => TabPersonality.install());
    if (document.readyState !== 'loading') TabPersonality.install();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { TabPersonality };
