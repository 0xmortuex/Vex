// === Vex Mobile — chrome ===
//
// Everything you see and touch that is not a web page: the toolbar, omnibox,
// tab switcher, menu sheet, find bar and toasts. It owns two jobs the desktop
// chrome never has to do:
//
//   1. Telling native where the page goes. The page is a real Android WebView
//      laid over #content, so every layout change (rotation, keyboard, find
//      bar) has to be pushed down with setBounds or the page and the chrome
//      drift apart.
//   2. Hiding the page. Anything drawn over the content rect (tab grid,
//      sheets, panels) must call VexBridge.setVisible(false) first, because a
//      native view always paints above this WebView's HTML.

const VexUI = (() => {
  const $ = id => document.getElementById(id);
  let boundsTimer = null, findTimer = null, omniTimer = null;
  let tabGridScope = 'normal';

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // ── The content rect ─────────────────────────────────────────────────────
  function pushBounds() {
    const rect = $('content').getBoundingClientRect();
    VexBridge.setBounds({
      x: Math.round(rect.left), y: Math.round(rect.top),
      width: Math.round(rect.width), height: Math.round(rect.height)
    });
  }
  function scheduleBounds() {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(pushBounds, 60);
  }

  // Overlays that cover the page: keep a count so closing one of two does not
  // reveal the page underneath the other.
  let coverDepth = 0;
  function cover(on) {
    coverDepth = Math.max(0, coverDepth + (on ? 1 : -1));
    VexBridge.setVisible(coverDepth === 0);
  }

  // The start page is chrome HTML, so showing it means hiding the native page
  // layer. Both sides of that move live here; nothing else touches #start.
  function setStartVisible(on) {
    const start = $('start');
    if (on === !start.hidden) return;
    start.hidden = !on;
    cover(on);
  }

  // ── Toolbar ──────────────────────────────────────────────────────────────
  function renderToolbar() {
    const tab = VexTabStore.active();
    const url = tab ? (tab.loading && tab.pendingUrl ? tab.pendingUrl : tab.url) : '';
    const text = $('tb-url-text');
    const lock = $('tb-lock');

    if (!url || url === 'about:blank') {
      text.textContent = 'Search or type a URL';
      text.className = 'urlpill-text muted';
    } else {
      const host = VexSearch.prettyHost(url);
      text.innerHTML = '';
      text.className = 'urlpill-text';
      text.appendChild(element('span', 'host', host || url));
    }

    lock.className = 'urlpill-lock'
      + (tab && tab.incognito ? ' private' : url.startsWith('https://') ? ' secure' : url.startsWith('http://') ? ' insecure' : '');

    $('tb-back').disabled = !(tab && tab.canGoBack);
    $('tb-tabcount').textContent = String(VexTabStore.all().length || 0);
    document.body.classList.toggle('private', !!(tab && tab.incognito));

    const shield = $('tb-shield');
    const blocked = tab ? tab.blocked : 0;
    shield.hidden = !blocked;
    shield.textContent = String(blocked);

    // No tab, or a blank one: show the start page instead of a white hole.
    // A tab that is on its way somewhere counts as not blank, so the start
    // page gets out of the way as soon as a load begins.
    const going = tab && tab.loading && tab.pendingUrl && tab.pendingUrl !== 'about:blank';
    const blank = !tab || (!going && (!tab.url || tab.url === 'about:blank'));
    setStartVisible(blank);
  }

  function renderProgress() {
    const tab = VexTabStore.active();
    const bar = $('progress');
    const fill = bar.firstElementChild;
    if (!tab || !tab.loading) { bar.classList.add('done'); fill.style.width = '100%'; return; }
    bar.classList.remove('done');
    fill.style.width = Math.max(5, tab.progress || 5) + '%';
  }

  // ── Omnibox ──────────────────────────────────────────────────────────────
  function openOmnibox(prefill) {
    const box = $('omnibox');
    const input = $('omni-input');
    box.hidden = false;
    cover(true);
    const tab = VexTabStore.active();
    input.value = prefill != null ? prefill : (tab && tab.url && tab.url !== 'about:blank' ? tab.url : '');
    renderSuggestions(input.value);
    setTimeout(() => { input.focus(); input.select(); }, 30);
  }

  function closeOmnibox() {
    if ($('omnibox').hidden) return;
    $('omnibox').hidden = true;
    $('omni-input').blur();
    cover(false);
  }

  function renderSuggestions(text) {
    const list = $('omni-results');
    list.innerHTML = '';
    for (const row of VexSearch.suggest(text)) {
      const item = element('li', 'omni-row');
      item.setAttribute('role', 'option');
      item.appendChild(element('span', 'kind', row.kind === 'search' ? '⌕' : row.kind === 'bookmark' ? '★' : '↺'));
      const lines = element('div', 'lines');
      lines.appendChild(element('span', 't', row.kind === 'search' ? 'Search for “' + row.title + '”' : row.title));
      lines.appendChild(element('span', 'u', row.url));
      item.appendChild(lines);
      item.onclick = () => { closeOmnibox(); VexUI.openUrl(row.url); };
      list.appendChild(item);
    }
  }

  // ── Tab switcher ─────────────────────────────────────────────────────────
  async function openTabGrid() {
    const active = VexTabStore.active();
    if (active) {
      // Snapshot the page we are leaving so its card is not a blank rectangle.
      try {
        const shot = await VexBridge.snapshot(active.id);
        if (shot && shot.dataUrl) active.snapshot = shot.dataUrl;
      } catch {}
    }
    tabGridScope = active && active.incognito ? 'private' : 'normal';
    $('tabgrid').hidden = false;
    cover(true);
    renderTabGrid();
  }

  function closeTabGrid() {
    if ($('tabgrid').hidden) return;
    $('tabgrid').hidden = true;
    cover(false);
  }

  function renderTabGrid() {
    const isPrivate = tabGridScope === 'private';
    $('tg-normal').setAttribute('aria-pressed', String(!isPrivate));
    $('tg-private').setAttribute('aria-pressed', String(isPrivate));
    const list = $('tabgrid-list');
    list.innerHTML = '';
    const tabs = isPrivate ? VexTabStore.private() : VexTabStore.normal();
    if (!tabs.length) {
      const empty = element('div', 'tabgrid-empty', isPrivate
        ? 'No private tabs. Pages opened here leave no history, cookies or cache behind.'
        : 'No tabs open.');
      list.appendChild(empty);
      return;
    }
    for (const tab of tabs) {
      const card = element('div', 'tabcard' + (tab.id === VexTabStore.activeId() ? ' active' : ''));
      const shot = element('div', 'tabcard-shot');
      if (tab.snapshot) shot.style.backgroundImage = 'url("' + tab.snapshot + '")';
      shot.onclick = async () => { closeTabGrid(); await VexTabStore.activate(tab.id); };
      const bar = element('div', 'tabcard-bar');
      bar.appendChild(element('span', 'tabcard-title', tab.title || VexSearch.prettyHost(tab.url) || 'New tab'));
      const close = element('button', 'tabcard-x');
      close.setAttribute('aria-label', 'Close tab');
      close.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      close.onclick = async event => { event.stopPropagation(); await VexTabStore.close(tab.id); renderTabGrid(); };
      bar.appendChild(close);
      card.appendChild(shot);
      card.appendChild(bar);
      list.appendChild(card);
    }
  }

  // ── Menu sheet ───────────────────────────────────────────────────────────
  const MENU = [
    { id: 'new-tab', label: 'New tab' },
    { id: 'new-private', label: 'New private tab' },
    { id: 'find', label: 'Find in page' },
    { id: 'desktop', label: 'Desktop site', toggle: tab => tab && tab.desktopMode },
    { id: 'block-site', label: 'Blocking on this site', toggle: tab => tab && !VexBlock.siteAllowed(VexSearch.prettyHost(tab.url)) },
    { id: 'bookmarks', label: 'Bookmarks' },
    { id: 'history', label: 'History' },
    { id: 'downloads', label: 'Downloads' },
    { id: 'copy', label: 'Copy link' },
    { id: 'reopen', label: 'Reopen closed tab' },
    { id: 'settings', label: 'Settings' }
  ];

  function openSheet() {
    const tab = VexTabStore.active();
    const list = $('sheet-list');
    list.innerHTML = '';
    for (const item of MENU) {
      const row = element('div', 'sheet-row');
      row.appendChild(element('span', 'row-label', item.label));
      if (item.toggle) {
        const knob = element('span', 'switch' + (item.toggle(tab) ? ' on' : ''));
        row.appendChild(knob);
      }
      row.onclick = () => runMenu(item.id);
      list.appendChild(row);
    }
    const starred = tab && VexStore.get('vex.bookmarks', []).some(entry => entry.url === tab.url);
    $('m-star').classList.toggle('on', !!starred);
    $('sheet').hidden = false;
  }

  function closeSheet() { $('sheet').hidden = true; }

  async function runMenu(id) {
    const tab = VexTabStore.active();
    closeSheet();
    switch (id) {
      case 'new-tab': await VexTabStore.create('about:blank'); openOmnibox(''); break;
      case 'new-private': await VexTabStore.create('about:blank', { incognito: true }); openOmnibox(''); break;
      case 'find': openFind(); break;
      case 'desktop':
        if (!tab) break;
        tab.desktopMode = !tab.desktopMode;
        await VexBridge.setDesktopMode(tab.id, tab.desktopMode);
        VexUI.toast(tab.desktopMode ? 'Desktop site' : 'Mobile site');
        break;
      case 'block-site': {
        if (!tab) break;
        const host = VexSearch.prettyHost(tab.url);
        const allowed = VexBlock.siteAllowed(host);
        await VexBlock.setSiteAllowed(host, !allowed);
        VexUI.toast(allowed ? 'Blocking on for ' + host : 'Blocking off for ' + host);
        await VexBridge.reload(tab.id);
        break;
      }
      case 'bookmarks': VexPanels.bookmarks(); break;
      case 'history': VexPanels.history(); break;
      case 'downloads': VexPanels.downloads(); break;
      case 'settings': VexPanels.settings(); break;
      case 'copy':
        if (tab && tab.url) {
          try { await navigator.clipboard.writeText(tab.url); VexUI.toast('Link copied'); }
          catch { VexUI.toast('Could not copy'); }
        }
        break;
      case 'reopen': {
        const closed = VexStore.get('vex.closedTabs', []);
        if (!closed.length) { VexUI.toast('Nothing to reopen'); break; }
        const [last, ...rest] = closed;
        await VexStore.set('vex.closedTabs', rest);
        await VexTabStore.create(last.url);
        break;
      }
    }
  }

  // ── Find in page ─────────────────────────────────────────────────────────
  function openFind() {
    $('findbar').hidden = false;
    scheduleBounds();
    setTimeout(() => $('find-input').focus(), 30);
  }
  function closeFind() {
    const tab = VexTabStore.active();
    $('findbar').hidden = true;
    $('find-input').value = '';
    $('find-count').textContent = '';
    if (tab) VexBridge.clearFind(tab.id);
    scheduleBounds();
  }

  // ── Toasts ───────────────────────────────────────────────────────────────
  function toast(message, ms = 2200) {
    const node = element('div', 'toast', message);
    $('toasts').appendChild(node);
    setTimeout(() => node.remove(), ms);
  }

  // ── Start page tiles ─────────────────────────────────────────────────────
  function renderStartTiles() {
    const tiles = $('start-tiles');
    tiles.innerHTML = '';
    const top = topSites().slice(0, 8);
    for (const site of top) {
      const tile = element('button', 'tile');
      const mark = element('div', 'tile-mark', (VexSearch.prettyHost(site.url)[0] || '?').toUpperCase());
      tile.appendChild(mark);
      tile.appendChild(element('span', 'tile-label', VexSearch.prettyHost(site.url)));
      tile.onclick = () => VexUI.openUrl(site.url);
      tiles.appendChild(tile);
    }
  }

  // Most-visited, counted from history — same idea as the desktop start page.
  function topSites() {
    const counts = new Map();
    for (const entry of VexStore.get('vex.history', [])) {
      const host = VexSearch.prettyHost(entry.url);
      if (!host) continue;
      const seen = counts.get(host) || { url: 'https://' + host + '/', hits: 0 };
      seen.hits++;
      counts.set(host, seen);
    }
    return [...counts.values()].sort((a, b) => b.hits - a.hits);
  }

  return {
    version: '0.1.0',
    toast,
    pushBounds,
    scheduleBounds,
    renderToolbar,
    renderStartTiles,
    openOmnibox,
    closeOmnibox,
    openTabGrid,
    closeTabGrid,
    openSheet,
    closeSheet,
    openFind,
    closeFind,
    cover,

    // The one way a URL gets loaded from the chrome.
    async openUrl(input, opts = {}) {
      const url = VexSearch.toUrl(input);
      if (!url) return;
      const tab = VexTabStore.active();
      if (!tab || opts.newTab) await VexTabStore.create(url, { incognito: opts.incognito });
      else await VexTabStore.navigate(tab.id, url);
      renderToolbar();
    },

    // Wire every control once, at boot.
    bind() {
      $('tb-back').onclick = () => { const tab = VexTabStore.active(); if (tab) VexBridge.back(tab.id); };
      $('tb-url').onclick = () => openOmnibox();
      $('tb-tabs').onclick = () => openTabGrid();
      $('tb-menu').onclick = () => openSheet();

      VexGestures.swipe($('tb-url'), {
        left: () => cycleTab(1),
        right: () => cycleTab(-1),
        up: () => openTabGrid(),
        down: () => { const tab = VexTabStore.active(); if (tab) VexBridge.reload(tab.id); }
      });
      VexGestures.longPress($('tb-tabs'), () => VexTabStore.create('about:blank').then(() => openOmnibox('')));
      VexGestures.longPress($('tb-back'), () => VexPanels.history());

      // Omnibox
      $('omni-cancel').onclick = closeOmnibox;
      $('omni-clear').onclick = () => { $('omni-input').value = ''; renderSuggestions(''); $('omni-input').focus(); };
      $('omni-input').addEventListener('input', event => {
        clearTimeout(omniTimer);
        const value = event.target.value;
        omniTimer = setTimeout(() => renderSuggestions(value), 80);
      });
      $('omni-input').addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        const value = $('omni-input').value.trim();
        if (!value) return;
        closeOmnibox();
        VexUI.openUrl(value);
      });

      // Tab grid
      $('tg-normal').onclick = () => { tabGridScope = 'normal'; renderTabGrid(); };
      $('tg-private').onclick = () => { tabGridScope = 'private'; renderTabGrid(); };
      $('tg-new').onclick = async () => {
        closeTabGrid();
        await VexTabStore.create('about:blank', { incognito: tabGridScope === 'private' });
        openOmnibox('');
      };
      $('tg-done').onclick = closeTabGrid;
      $('tg-close-all').onclick = async () => {
        await VexTabStore.closeAll(tabGridScope === 'private');
        renderTabGrid();
      };

      // Menu sheet
      $('sheet').querySelector('.sheet-scrim').onclick = closeSheet;
      $('m-forward').onclick = () => { const tab = VexTabStore.active(); if (tab) VexBridge.forward(tab.id); closeSheet(); };
      $('m-reload').onclick = () => { const tab = VexTabStore.active(); if (tab) VexBridge.reload(tab.id); closeSheet(); };
      $('m-share').onclick = () => { const tab = VexTabStore.active(); if (tab) VexBridge.share(tab.url, tab.title); closeSheet(); };
      $('m-star').onclick = async () => {
        const tab = VexTabStore.active();
        // A blank tab has nothing to save. Say so and close — leaving the sheet
        // open with nothing happening reads as a dead button.
        if (!tab || !tab.url || tab.url === 'about:blank') {
          closeSheet();
          toast('Nothing to bookmark yet');
          return;
        }
        const bookmarks = VexStore.get('vex.bookmarks', []);
        const exists = bookmarks.some(entry => entry.url === tab.url);
        if (exists) await VexStore.set('vex.bookmarks', bookmarks.filter(entry => entry.url !== tab.url));
        else await VexStore.push('vex.bookmarks', { url: tab.url, title: tab.title || tab.url, at: Date.now() }, 2000);
        toast(exists ? 'Bookmark removed' : 'Bookmarked');
        closeSheet();
      };

      // Find bar
      $('find-input').addEventListener('input', event => {
        clearTimeout(findTimer);
        const text = event.target.value;
        const tab = VexTabStore.active();
        findTimer = setTimeout(() => { if (tab) VexBridge.find(tab.id, text); }, 150);
      });
      $('find-next').onclick = () => { const tab = VexTabStore.active(); if (tab) VexBridge.findNext(tab.id, true); };
      $('find-prev').onclick = () => { const tab = VexTabStore.active(); if (tab) VexBridge.findNext(tab.id, false); };
      $('find-close').onclick = closeFind;

      // Panels
      $('panel-back').onclick = () => VexPanels.close();

      // Layout changes: the native page follows the content rect.
      window.addEventListener('resize', scheduleBounds);
      window.addEventListener('orientationchange', scheduleBounds);
      if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleBounds);

      VexTabStore.onChange(() => { renderToolbar(); renderProgress(); });
    },

    // Android's back gesture / button, routed from the App plugin.
    async handleBack() {
      if (!$('omnibox').hidden) { closeOmnibox(); return true; }
      if (VexPanels.isOpen()) { VexPanels.close(); return true; }
      if (!$('sheet').hidden) { closeSheet(); return true; }
      if (!$('tabgrid').hidden) { closeTabGrid(); return true; }
      if (!$('findbar').hidden) { closeFind(); return true; }
      const tab = VexTabStore.active();
      if (tab && tab.canGoBack) { await VexBridge.back(tab.id); return true; }
      if (tab && VexTabStore.all().length > 1) { await VexTabStore.close(tab.id); return true; }
      return false;    // let Android put the app in the background
    },

    renderTabGrid,
    renderSuggestions,
    renderProgress,
    setStartVisible
  };

  function cycleTab(step) {
    const tabs = VexTabStore.all();
    if (tabs.length < 2) return;
    const index = tabs.findIndex(tab => tab.id === VexTabStore.activeId());
    const next = tabs[(index + step + tabs.length) % tabs.length];
    VexTabStore.activate(next.id);
    toast(next.title || VexSearch.prettyHost(next.url) || 'New tab', 1100);
  }
})();

if (typeof window !== 'undefined') window.VexUI = VexUI;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexUI };
