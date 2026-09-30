// === Vex Mobile — the start page ===
//
// Drawn by the chrome, not loaded as a page: it has to appear the instant a
// tab is empty, and it has to work with no network at all.
//
// The tiles are yours if you want them to be. With nothing pinned they are the
// sites you actually visit, weighted towards the last fortnight; pin one and
// the grid stops rearranging itself under you — which is the thing people
// dislike about most "most visited" grids.

const VexStart = (() => {
  const { $, el, clear } = VexDom;

  function tile(site) {
    const button = el('button', 'tile');
    const mark = el('span', 'tile-mark');
    if (site.icon) mark.appendChild(el('img', { src: site.icon, alt: '' }));
    else mark.textContent = ((site.title || site.host || VexSearch.prettyHost(site.url))[0] || '?').toUpperCase();
    button.appendChild(mark);
    button.appendChild(el('span', 'tile-label', site.host || site.title || VexSearch.prettyHost(site.url)));
    button.onclick = () => VexUI.openUrl(site.url);
    VexGestures.longPress(button, () => tileActions(site));
    return button;
  }

  function tileActions(site) {
    const pinned = VexCollections.quick.all().some(entry => entry.url === site.url);
    VexSheets.choose(site.host || VexSearch.prettyHost(site.url), [
      pinned
        ? { id: 'unpin', label: 'Remove this tile' }
        : { id: 'pin', label: 'Pin this tile', note: 'The grid becomes yours to arrange' },
      { id: 'new-tab', label: 'Open in a new tab' },
      { id: 'private', label: 'Open in a private tab' },
      { id: 'copy', label: 'Copy link' },
      { id: 'forget', label: 'Forget this site', note: 'Drops it from history' }
    ], async choice => {
      VexSheets.close();
      if (choice === 'pin') await VexCollections.quick.add({ url: site.url, title: site.host, icon: site.icon });
      else if (choice === 'unpin') await VexCollections.quick.remove(site.url);
      else if (choice === 'new-tab') VexUI.openUrl(site.url, { newTab: true });
      else if (choice === 'private') VexUI.openUrl(site.url, { newTab: true, incognito: true });
      else if (choice === 'copy') VexUI.copy(site.url);
      else if (choice === 'forget') {
        await VexHistory.removeSite(site.host || VexSearch.prettyHost(site.url));
        VexUI.toast('Forgotten');
      }
      VexSync.schedulePush();
      render();
    });
  }

  function card(entry, { badge } = {}) {
    const button = el('button', 'rail-card');
    button.appendChild(el('span', 't', entry.title || VexSearch.prettyHost(entry.url)));
    button.appendChild(el('span', 'u', badge || VexSearch.prettyHost(entry.url)));
    button.onclick = () => VexUI.openUrl(entry.url);
    VexGestures.longPress(button, () => VexSheets.link({ link: entry.url }));
    return button;
  }

  function section(wrapId, railId, entries, render) {
    const wrap = $(wrapId);
    wrap.hidden = entries.length === 0;
    const rail = clear($(railId));
    for (const entry of entries) rail.appendChild(render(entry));
  }

  function render() {
    const blocked = Number(VexStore.get('vex.blockedTotal', 0));
    $('start-sub').textContent = blocked > 40
      ? blocked.toLocaleString() + ' trackers blocked so far'
      : 'A browser built just for you.';

    // Tiles: pinned if you have pinned any, otherwise the ones you use.
    const pinned = VexCollections.quick.all();
    const sites = pinned.length
      ? pinned.map(entry => ({ url: entry.url, host: entry.title || VexSearch.prettyHost(entry.url), icon: entry.icon }))
      : VexHistory.topSites(8);
    const wrap = $('start-top-wrap');
    const tiles = clear($('start-tiles'));
    wrap.hidden = false;
    wrap.firstElementChild.textContent = pinned.length ? 'Your sites' : sites.length ? 'Most visited' : 'Nothing here yet';
    const hint = document.getElementById('start-hint');
    if (!sites.length) {
      tiles.hidden = true;
      if (!hint) {
        const note = el('p', { class: 'field-note', id: 'start-hint' });
        note.textContent = 'The sites you visit most will collect here, and the pages you were reading will '
          + 'be one tap away. Nothing about them leaves the phone.';
        wrap.appendChild(note);
      }
    } else {
      tiles.hidden = false;
      if (hint) hint.remove();
      for (const site of sites) tiles.appendChild(tile(site));
    }

    // Reading list first — it is a promise you made to yourself — then where
    // you left off, then bookmarks, then what is open on the PC.
    const unread = VexCollections.reading.unread().slice(0, 8);
    section('start-reading-wrap', 'start-reading', unread, entry => card(entry, { badge: 'Saved for later' }));

    const seen = new Set();
    const recent = [];
    for (const entry of VexHistory.recent(120)) {
      const host = entry.host || VexSearch.prettyHost(entry.url);
      if (!host || seen.has(host)) continue;
      seen.add(host);
      recent.push(entry);
      if (recent.length >= 8) break;
    }
    section('start-recent-wrap', 'start-recent', recent.length >= 2 ? recent : [], entry => card(entry));

    section('start-marks-wrap', 'start-marks', VexCollections.bookmarks.all().slice(0, 10), entry => card(entry));

    const remote = VexSync.remoteTabs().slice(0, 8);
    section('start-remote-wrap', 'start-remote', remote, entry => card(entry, { badge: 'Open on your PC' }));
  }

  return {
    render,

    bind() {
      $('start-search').onclick = () => VexUI.openOmnibox('');
      $('start-private').onclick = () => VexUI.newTab({ incognito: true });
      $('start-history').onclick = () => VexPanels.history();
      $('start-bookmarks').onclick = () => VexPanels.bookmarks();
      $('start-ai').onclick = () => VexViews.openAI();
      $('start-scan').onclick = () => VexUI.openScanner();
      $('start-reading-btn').onclick = () => VexPanels.readingList();
    }
  };
})();

if (typeof window !== 'undefined') window.VexStart = VexStart;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexStart };
