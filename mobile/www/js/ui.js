// === Vex Mobile — chrome ===
//
// The toolbar, omnibox, tab switcher, find bar and toasts, plus the two jobs
// no desktop chrome has to do:
//
//   1. Telling native where the page goes. The page is an Android WebView laid
//      over #content, so every layout change — rotation, keyboard, find bar —
//      has to be pushed down with setBounds or the page and the chrome drift.
//   2. Hiding the page. A native view always paints above this WebView's HTML,
//      so anything drawn over the content rect asks for the page to be hidden
//      first. cover() refcounts that: closing one of two overlays must not
//      uncover the page underneath the other.

const VexUI = (() => {
  const { $, el, icon, clear, favicon, highlight } = VexDom;
  let boundsTimer = null, findTimer = null, omniTimer = null;
  let tabGridScope = 'normal';
  let tabQuery = '';
  let coverDepth = 0;

  // ── Geometry ─────────────────────────────────────────────────────────────
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

  function cover(on) {
    coverDepth = Math.max(0, coverDepth + (on ? 1 : -1));
    VexBridge.setVisible(coverDepth === 0);
  }

  function setStartVisible(on) {
    const start = $('start');
    if (on === !start.hidden) return;
    if (on) VexStart.render();
    start.hidden = !on;
    cover(on);
  }

  // ── Toolbar ──────────────────────────────────────────────────────────────
  function renderToolbar() {
    const tab = VexTabStore.active();
    const url = tab ? (tab.loading && tab.pendingUrl ? tab.pendingUrl : tab.url) : '';
    const live = !!(url && url !== 'about:blank');
    const text = $('tb-url-text');
    const iconSlot = clear($('tb-icon'));

    if (!live) {
      text.className = 'urlpill-text muted';
      text.textContent = 'Search or type a URL';
      iconSlot.className = 'urlpill-icon';
      iconSlot.appendChild(icon('search'));
    } else {
      text.className = 'urlpill-text';
      clear(text).appendChild(el('span', 'host', VexSearch.prettyHost(url) || url));
      if (tab.incognito) {
        iconSlot.className = 'urlpill-icon lock';
        iconSlot.appendChild(icon('private'));
      } else if (tab.icon) {
        iconSlot.className = 'urlpill-icon';
        iconSlot.appendChild(el('img', { src: tab.icon, alt: '' }));
      } else {
        const secure = url.startsWith('https://');
        iconSlot.className = 'urlpill-icon ' + (secure ? 'lock' : 'insecure');
        iconSlot.appendChild(icon(secure ? 'lock' : 'unlock'));
      }
    }

    $('tb-back').disabled = !(tab && tab.canGoBack);
    $('tb-tabcount').textContent = String(VexTabStore.all().length || 0);
    document.body.classList.toggle('private', !!(tab && tab.incognito));

    const blocked = tab ? tab.blocked : 0;
    $('tb-shield').hidden = !blocked;
    $('tb-shield-count').textContent = String(blocked);

    // A page's theme colour tints the toolbar, when the setting is on and the
    // colour is readable against the theme (VexTheme decides that).
    if (!VexStore.get('vex.tintToolbar', true) || !live || (tab && tab.incognito)) VexTheme.tintFromPage(null);
    else VexTheme.tintFromPage(tab ? tab.themeColor : null);

    const going = tab && tab.loading && tab.pendingUrl && tab.pendingUrl !== 'about:blank';
    setStartVisible(!tab || (!going && !live));
  }

  function renderProgress() {
    const tab = VexTabStore.active();
    const bar = $('progress');
    const fill = bar.firstElementChild;
    if (!tab || !tab.loading) { bar.classList.add('done'); fill.style.width = '100%'; return; }
    bar.classList.remove('done');
    fill.style.width = Math.max(6, tab.progress || 6) + '%';
  }

  // ── Omnibox ──────────────────────────────────────────────────────────────
  function openOmnibox(prefill) {
    const box = $('omnibox');
    const input = $('omni-input');
    if (box.hidden) { box.hidden = false; cover(true); }
    const tab = VexTabStore.active();
    input.value = prefill != null ? prefill : (tab && tab.url && tab.url !== 'about:blank' ? tab.url : '');
    renderChips();
    renderSuggestions(input.value);
    setTimeout(() => { input.focus(); input.select(); }, 40);
  }

  function closeOmnibox() {
    if ($('omnibox').hidden) return;
    $('omnibox').hidden = true;
    $('omni-input').blur();
    cover(false);
  }

  async function renderChips() {
    const chips = clear($('omni-chips'));
    // Paste and go, when the clipboard holds something loadable.
    try {
      const clip = (await navigator.clipboard.readText()).trim();
      if (clip && clip.length < 400) {
        chips.appendChild(el('button', {
          class: 'chip',
          onclick: () => { closeOmnibox(); openUrl(clip); }
        }, (VexSearch.isSearch(clip) ? 'Search “' : 'Go to ') + clip.slice(0, 28) + (VexSearch.isSearch(clip) ? '”' : '')));
      }
    } catch {
      // No clipboard permission: the chip is a convenience, not a feature.
    }
    for (const [id, engine] of Object.entries(VexSearch.ENGINES)) {
      if (id === VexSearch.engineId()) continue;
      chips.appendChild(el('button', {
        class: 'chip',
        onclick: () => {
          const value = $('omni-input').value.trim();
          if (!value) return;
          closeOmnibox();
          openUrl(VexSearch.searchUrl(value, id));
        }
      }, engine.name));
    }
  }

  function renderSuggestions(text) {
    const list = clear($('omni-results'));
    for (const row of VexSearch.suggest(text)) {
      const item = el('li', 'omni-row');
      item.setAttribute('role', 'option');
      const kind = el('span', 'kind');
      if (row.icon) kind.appendChild(el('img', { src: row.icon, alt: '' }));
      else kind.appendChild(icon(row.kind === 'search' ? 'search' : row.kind === 'bookmark' ? 'star' : 'history'));
      item.appendChild(kind);
      const lines = el('div', 'lines');
      const title = el('span', 't');
      if (row.kind === 'search') title.textContent = 'Search for “' + row.title + '”';
      else title.appendChild(highlight(row.title, text));
      lines.appendChild(title);
      lines.appendChild(el('span', 'u', row.url));
      item.appendChild(lines);
      item.onclick = () => { closeOmnibox(); openUrl(row.url); };
      list.appendChild(item);
    }
  }

  // ── Tab switcher ─────────────────────────────────────────────────────────
  async function openTabGrid() {
    const active = VexTabStore.active();
    if (active) {
      try {
        const shot = await VexBridge.snapshot(active.id);
        if (shot && shot.dataUrl) active.snapshot = shot.dataUrl;
      } catch { /* a tab that never painted has no snapshot; the card copes */ }
    }
    tabGridScope = active && active.incognito ? 'private' : 'normal';
    tabQuery = '';
    $('tg-search').value = '';
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
    const list = clear($('tabgrid-list'));

    const needle = tabQuery.trim().toLowerCase();
    const tabs = (isPrivate ? VexTabStore.private() : VexTabStore.normal())
      .filter(tab => !needle || ((tab.title || '') + ' ' + tab.url).toLowerCase().includes(needle));

    if (!tabs.length) {
      list.appendChild(el('div', 'tabgrid-empty', needle
        ? 'No tab matches “' + tabQuery + '”.'
        : isPrivate
          ? 'No private tabs. Pages opened here leave no history behind, and on a recent WebView they get their own cookie jar too.'
          : 'No tabs open.'));
      return;
    }

    for (const tab of tabs) {
      const card = el('div', 'tabcard' + (tab.id === VexTabStore.activeId() ? ' active' : ''));
      const shot = el('div', 'tabcard-shot');
      if (tab.snapshot) shot.style.backgroundImage = 'url("' + tab.snapshot + '")';
      card.appendChild(shot);

      const bar = el('div', 'tabcard-bar');
      bar.appendChild(favicon(tab, 'tabcard-icon'));
      bar.appendChild(el('span', 'tabcard-title', tab.title || VexSearch.prettyHost(tab.url) || 'New tab'));
      const close = el('button', { class: 'tabcard-x', 'aria-label': 'Close tab' });
      close.appendChild(icon('close'));
      close.onclick = async event => {
        event.stopPropagation();
        await VexTabStore.close(tab.id);
        renderTabGrid();
        renderToolbar();
      };
      bar.appendChild(close);
      card.appendChild(bar);

      card.onclick = async () => { closeTabGrid(); await VexTabStore.activate(tab.id); };
      VexGestures.longPress(card, () => tabActions(tab));
      list.appendChild(card);
    }
  }

  function tabActions(tab) {
    VexSheets.choose(tab.title || VexSearch.prettyHost(tab.url) || 'Tab', [
      { id: 'close-others', label: 'Close other tabs' },
      { id: 'bookmark', label: 'Bookmark this tab' },
      { id: 'copy', label: 'Copy link' },
      { id: 'share', label: 'Share' }
    ], async choice => {
      VexSheets.close();
      if (choice === 'close-others') {
        for (const other of VexTabStore.all()) {
          if (other.id !== tab.id && other.incognito === tab.incognito) await VexTabStore.close(other.id);
        }
        renderTabGrid();
      } else if (choice === 'bookmark') {
        await VexStore.push('vex.bookmarks', { url: tab.url, title: tab.title || tab.url, at: Date.now(), icon: tab.icon || '' }, 2000);
        toast('Bookmarked');
      } else if (choice === 'copy') copy(tab.url);
      else if (choice === 'share') VexBridge.share(tab.url, tab.title);
    });
  }

  // ── Find ─────────────────────────────────────────────────────────────────
  function openFind() {
    $('findbar').hidden = false;
    scheduleBounds();
    setTimeout(() => $('find-input').focus(), 40);
  }

  function closeFind() {
    if ($('findbar').hidden) return;
    const tab = VexTabStore.active();
    $('findbar').hidden = true;
    $('find-input').value = '';
    $('find-count').textContent = '';
    if (tab) VexBridge.clearFind(tab.id);
    scheduleBounds();
  }

  // ── Toasts ───────────────────────────────────────────────────────────────
  function toast(message, ms = 2400, action) {
    const node = el('div', 'toast');
    node.appendChild(document.createTextNode(message));
    if (action) {
      const button = el('button', null, action.label);
      button.onclick = () => { node.remove(); action.run(); };
      node.appendChild(button);
    }
    $('toasts').appendChild(node);
    setTimeout(() => node.remove(), ms);
  }

  // ── Actions the sheets and panels call ───────────────────────────────────
  async function openUrl(input, options = {}) {
    const url = VexSearch.toUrl(input);
    if (!url) return;
    const tab = VexTabStore.active();
    if (!tab || options.newTab) {
      await VexTabStore.create(url, { incognito: options.incognito, background: options.background });
      if (options.background) toast('Opened in a new tab');
    } else {
      await VexTabStore.navigate(tab.id, url);
    }
    renderToolbar();
  }

  async function newTab(options = {}) {
    await VexTabStore.create('about:blank', options);
    renderToolbar();
    openOmnibox('');
  }

  async function copy(text) {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); toast('Copied'); }
    catch { toast('Could not copy'); }
  }

  async function toggleBookmark() {
    const tab = VexTabStore.active();
    if (!tab || !tab.url || tab.url === 'about:blank') { toast('Nothing to bookmark yet'); return; }
    const bookmarks = VexStore.get('vex.bookmarks', []);
    const exists = bookmarks.some(entry => entry.url === tab.url);
    if (exists) {
      await VexStore.set('vex.bookmarks', bookmarks.filter(entry => entry.url !== tab.url));
      toast('Bookmark removed');
    } else {
      await VexStore.push('vex.bookmarks', {
        url: tab.url, title: tab.title || tab.url, at: Date.now(), icon: tab.icon || ''
      }, 2000);
      toast('Bookmarked');
    }
  }

  async function reopenClosed() {
    const closed = VexStore.get('vex.closedTabs', []);
    if (!closed.length) { toast('Nothing to reopen'); return; }
    const [last, ...rest] = closed;
    await VexStore.set('vex.closedTabs', rest);
    await VexTabStore.create(last.url);
    renderToolbar();
  }

  function cycleTab(step) {
    const tabs = VexTabStore.all();
    if (tabs.length < 2) return;
    const index = tabs.findIndex(tab => tab.id === VexTabStore.activeId());
    const next = tabs[(index + step + tabs.length) % tabs.length];
    VexTabStore.activate(next.id);
    toast(next.title || VexSearch.prettyHost(next.url) || 'New tab', 1100);
  }

  return {
    version: '0.2.0',

    toast, cover, pushBounds, scheduleBounds,
    renderToolbar, renderProgress, renderTabGrid, renderSuggestions,
    openOmnibox, closeOmnibox, openTabGrid, closeTabGrid, openFind, closeFind,
    openUrl, newTab, copy, toggleBookmark, reopenClosed, setStartVisible,

    bind() {
      $('tb-back').onclick = () => { const tab = VexTabStore.active(); if (tab) VexBridge.back(tab.id); };
      $('tb-url').onclick = () => openOmnibox();
      $('tb-tabs').onclick = () => openTabGrid();
      $('tb-menu').onclick = () => VexSheets.menu();

      // The icon in the pill is the site sheet, the way the padlock is on the
      // desktop: it is where "this one site" lives.
      $('tb-icon').addEventListener('click', event => {
        const tab = VexTabStore.active();
        if (!tab || !tab.url || tab.url === 'about:blank') return;
        event.stopPropagation();
        VexSheets.site(VexSearch.prettyHost(tab.url));
      });
      $('tb-shield').addEventListener('click', event => {
        const tab = VexTabStore.active();
        if (!tab) return;
        event.stopPropagation();
        VexSheets.site(VexSearch.prettyHost(tab.url));
      });

      VexGestures.swipe($('tb-url'), {
        left: () => cycleTab(1),
        right: () => cycleTab(-1),
        up: () => openTabGrid(),
        down: () => { const tab = VexTabStore.active(); if (tab) VexBridge.reload(tab.id); }
      });
      VexGestures.longPress($('tb-tabs'), () => newTab());
      VexGestures.longPress($('tb-back'), () => VexPanels.history());
      VexGestures.longPress($('tb-url'), () => {
        const tab = VexTabStore.active();
        if (tab && tab.url && tab.url !== 'about:blank') copy(tab.url);
      });

      // Omnibox
      $('omni-cancel').onclick = closeOmnibox;
      $('omni-input').addEventListener('input', event => {
        clearTimeout(omniTimer);
        const value = event.target.value;
        omniTimer = setTimeout(() => renderSuggestions(value), 70);
      });
      $('omni-input').addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        const value = $('omni-input').value.trim();
        if (!value) return;
        closeOmnibox();
        openUrl(value);
      });

      // Tab switcher
      $('tg-normal').onclick = () => { tabGridScope = 'normal'; renderTabGrid(); };
      $('tg-private').onclick = () => { tabGridScope = 'private'; renderTabGrid(); };
      $('tg-search').addEventListener('input', event => { tabQuery = event.target.value; renderTabGrid(); });
      $('tg-new').onclick = async () => {
        closeTabGrid();
        await newTab({ incognito: tabGridScope === 'private' });
      };
      $('tg-done').onclick = closeTabGrid;
      $('tg-close-all').onclick = async () => {
        const scope = tabGridScope === 'private';
        const closing = VexTabStore.all().filter(tab => !!tab.incognito === scope).map(tab => ({ url: tab.url, title: tab.title }));
        await VexTabStore.closeAll(scope);
        renderTabGrid();
        renderToolbar();
        if (closing.length && !scope) {
          toast('Closed ' + closing.length + ' tabs', 4000, {
            label: 'Undo',
            run: async () => {
              for (const entry of closing.reverse()) {
                if (entry.url && entry.url !== 'about:blank') await VexTabStore.create(entry.url, { background: true });
              }
              renderToolbar();
            }
          });
        }
      };

      // Sheets
      $('sheet-scrim').onclick = () => VexSheets.close();

      // Find
      $('find-input').addEventListener('input', event => {
        clearTimeout(findTimer);
        const text = event.target.value;
        const tab = VexTabStore.active();
        findTimer = setTimeout(() => { if (tab) VexBridge.find(tab.id, text); }, 150);
      });
      $('find-next').onclick = () => { const tab = VexTabStore.active(); if (tab) VexBridge.findNext(tab.id, true); };
      $('find-prev').onclick = () => { const tab = VexTabStore.active(); if (tab) VexBridge.findNext(tab.id, false); };
      $('find-close').onclick = closeFind;

      // Reader
      $('reader-close').onclick = () => VexViews.closeReader();
      $('reader-bigger').onclick = () => VexViews.stepReaderSize(1);
      $('reader-smaller').onclick = () => VexViews.stepReaderSize(-1);
      $('reader-ai').onclick = () => { VexViews.closeReader(); VexViews.summarisePage(); };

      // Panels
      $('panel-back').onclick = () => VexPanels.back();

      VexStart.bind();

      window.addEventListener('resize', scheduleBounds);
      window.addEventListener('orientationchange', scheduleBounds);
      if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleBounds);

      VexTabStore.onChange(() => { renderToolbar(); renderProgress(); });
    },

    // Android's back gesture, innermost thing first.
    async handleBack() {
      if (!$('omnibox').hidden) { closeOmnibox(); return true; }
      if (VexSheets.isOpen()) { VexSheets.close(); return true; }
      if (VexViews.readerOpen()) { VexViews.closeReader(); return true; }
      if (VexPanels.isOpen()) { VexPanels.back(); return true; }
      if (!$('tabgrid').hidden) { closeTabGrid(); return true; }
      if (!$('findbar').hidden) { closeFind(); return true; }
      const tab = VexTabStore.active();
      if (tab && tab.canGoBack) { await VexBridge.back(tab.id); return true; }
      if (tab && VexTabStore.all().length > 1) { await VexTabStore.close(tab.id); return true; }
      return false;      // let Android put the app in the background
    }
  };
})();

if (typeof window !== 'undefined') window.VexUI = VexUI;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexUI };
