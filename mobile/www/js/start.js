// === Vex Mobile — the start page ===
//
// Drawn by the chrome, not loaded as a page: it has to appear the instant a
// tab is empty, and it has to work with no network. Four things, in the order
// a phone user reaches for them: search, the four things you do most often,
// the sites you actually visit, and what you were in the middle of.
//
// "Most visited" counts history the way the desktop start page does — by host,
// weighted towards the last fortnight, so a site you read daily beats one you
// opened forty times in one night last year.

const VexStart = (() => {
  const { $, el, clear } = VexDom;
  const FORTNIGHT = 14 * 24 * 3600 * 1000;

  function topSites(limit = 8) {
    const scores = new Map();
    const now = Date.now();
    for (const entry of VexStore.get('vex.history', [])) {
      const host = VexSearch.prettyHost(entry.url);
      if (!host) continue;
      const age = Math.max(0, now - (entry.at || 0));
      const weight = age < FORTNIGHT ? 1 : 0.35;
      const seen = scores.get(host) || { host, url: entry.url, score: 0, icon: entry.icon || '' };
      seen.score += weight;
      if (!seen.icon && entry.icon) seen.icon = entry.icon;
      scores.set(host, seen);
    }
    return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }

  function tile(site) {
    const button = el('button', 'tile');
    const mark = el('span', 'tile-mark');
    if (site.icon) mark.appendChild(el('img', { src: site.icon, alt: '' }));
    else mark.textContent = (site.host[0] || '?').toUpperCase();
    button.appendChild(mark);
    button.appendChild(el('span', 'tile-label', site.host));
    button.onclick = () => VexUI.openUrl(site.url);
    VexGestures.longPress(button, () => VexSheets.link({ link: site.url }));
    return button;
  }

  function card(entry) {
    const button = el('button', 'rail-card');
    button.appendChild(el('span', 't', entry.title || VexSearch.prettyHost(entry.url)));
    button.appendChild(el('span', 'u', VexSearch.prettyHost(entry.url)));
    button.onclick = () => VexUI.openUrl(entry.url);
    VexGestures.longPress(button, () => VexSheets.link({ link: entry.url }));
    return button;
  }

  return {
    topSites,

    render() {
      const sub = $('start-sub');
      const blocked = Number(VexStore.get('vex.blockedTotal', 0));
      sub.textContent = blocked > 40
        ? blocked.toLocaleString() + ' trackers blocked so far'
        : 'A browser built just for you.';

      const sites = topSites();
      const tiles = clear($('start-tiles'));
      // A fresh install has nothing to show, and an empty grid reads as a bug.
      // Say what will fill it instead of hiding the section silently.
      $('start-top-wrap').hidden = false;
      $('start-top-wrap').firstElementChild.textContent = sites.length ? 'Most visited' : 'Nothing here yet';
      if (!sites.length) {
        tiles.hidden = true;
        let hint = document.getElementById('start-hint');
        if (!hint) {
          hint = el('p', { class: 'field-note', id: 'start-hint' });
          $('start-top-wrap').appendChild(hint);
        }
        hint.textContent = 'The sites you visit most will collect here, and the pages you were reading '
          + 'will be one tap away. Nothing about them leaves the phone.';
        return;
      }
      tiles.hidden = false;
      const hint = document.getElementById('start-hint');
      if (hint) hint.remove();
      for (const site of sites) tiles.appendChild(tile(site));

      // "Pick up where you left off": recent history, one row per host so the
      // rail is not four entries from the same site.
      const seen = new Set();
      const recent = [];
      for (const entry of VexStore.get('vex.history', [])) {
        const host = VexSearch.prettyHost(entry.url);
        if (!host || seen.has(host)) continue;
        seen.add(host);
        recent.push(entry);
        if (recent.length >= 8) break;
      }
      $('start-recent-wrap').hidden = recent.length < 2;
      const rail = clear($('start-recent'));
      for (const entry of recent) rail.appendChild(card(entry));

      const bookmarks = VexStore.get('vex.bookmarks', []).slice(0, 10);
      $('start-marks-wrap').hidden = bookmarks.length === 0;
      const marks = clear($('start-marks'));
      for (const entry of bookmarks) marks.appendChild(card(entry));
    },

    bind() {
      $('start-search').onclick = () => VexUI.openOmnibox('');
      $('start-private').onclick = () => VexUI.newTab({ incognito: true });
      $('start-history').onclick = () => VexPanels.history();
      $('start-bookmarks').onclick = () => VexPanels.bookmarks();
      $('start-ai').onclick = () => VexViews.openAI();
    }
  };
})();

if (typeof window !== 'undefined') window.VexStart = VexStart;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexStart };
