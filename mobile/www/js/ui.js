// === Vex Mobile — chrome ===
//
// The toolbar, omnibox, tab switcher, find bar, dialogs, toasts and the video
// bar, plus the two jobs no desktop chrome has to do:
//
//   1. Telling native where the page goes. The page is an Android WebView laid
//      over #content, so every layout change — rotation, keyboard, find bar,
//      the toolbar moving to the top — has to be pushed down with setBounds or
//      the page and the chrome drift apart.
//   2. Hiding the page. A native view always paints above this WebView's HTML,
//      so anything drawn over the content rect asks for the page to be hidden
//      first. cover() refcounts that: closing one of two overlays must not
//      uncover the page underneath the other.

const VexUI = (() => {
  const { $, el, icon, clear, favicon, highlight, when } = VexDom;
  let boundsTimer = null, findTimer = null, omniTimer = null, mediaTimer = null;
  let tabGridScope = 'normal';
  let tabQuery = '';
  let coverDepth = 0;
  let toolbarHidden = false;
  let scrollAccumulator = 0;
  let privateUnlockedAt = 0;

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

  function applyToolbarPosition() {
    const position = VexStore.get('vex.toolbarPosition', 'bottom');
    document.body.dataset.toolbar = position === 'top' ? 'top' : 'bottom';
    showToolbar();
    scheduleBounds();
  }

  function showToolbar() {
    if (!toolbarHidden) return;
    toolbarHidden = false;
    document.body.classList.remove('toolbar-hidden');
    scheduleBounds();
  }

  function hideToolbar() {
    if (toolbarHidden) return;
    if (!VexStore.get('vex.autoHideToolbar', true)) return;
    if (!$('findbar').hidden || !$('omnibox').hidden) return;
    toolbarHidden = true;
    document.body.classList.add('toolbar-hidden');
    scheduleBounds();
  }

  // The page's own scrolling arrives from native (the chrome cannot see it).
  function onPageScroll(data) {
    if (!VexStore.get('vex.autoHideToolbar', true)) return;
    if (data.atTop) { scrollAccumulator = 0; showToolbar(); return; }
    scrollAccumulator = (scrollAccumulator > 0) === (data.dy > 0) ? scrollAccumulator + data.dy : data.dy;
    if (scrollAccumulator > 90) hideToolbar();
    else if (scrollAccumulator < -60) showToolbar();
  }

  function setStartVisible(on) {
    const start = $('start');
    if (on === !start.hidden) return;
    if (on) VexStart.render();
    start.hidden = !on;
    cover(on);
    if (on) showToolbar();
  }

  // ── Toolbar ──────────────────────────────────────────────────────────────
  // Which buttons sit either side of the address pill. Samsung lets you pick
  // yours; so does this, and the defaults are the four a browser needs.
  const BUTTONS = {
    back: { icon: 'back', label: 'Back', run: tab => tab && VexBridge.back(tab.id), enabled: tab => !!(tab && tab.canGoBack) },
    forward: { icon: 'forward', label: 'Forward', run: tab => tab && VexBridge.forward(tab.id), enabled: tab => !!(tab && tab.canGoForward) },
    reload: { icon: 'reload', label: 'Reload', run: tab => tab && VexBridge.reload(tab.id) },
    home: { icon: 'home', label: 'Home', run: () => goHome() },
    tabs: { icon: null, label: 'Tabs', run: () => openTabGrid(), counter: true },
    bookmarks: { icon: 'star', label: 'Bookmarks', run: () => VexPanels.bookmarks() },
    reading: { icon: 'list', label: 'Reading list', run: () => VexPanels.readingList() },
    menu: { icon: 'menu', label: 'Menu', run: () => VexSheets.menu() },
    search: { icon: 'search', label: 'Search', run: () => openOmnibox('') },
    share: { icon: 'share', label: 'Share', run: tab => tab && VexBridge.share(tab.url, tab.title) }
  };
  const DEFAULT_BUTTONS = { left: ['back'], right: ['tabs', 'menu'] };

  function buttonConfig() {
    const stored = VexStore.get('vex.toolbarButtons', null);
    if (!stored || !Array.isArray(stored.left) || !Array.isArray(stored.right)) return DEFAULT_BUTTONS;
    const clean = side => stored[side].filter(id => BUTTONS[id]).slice(0, 3);
    const left = clean('left'), right = clean('right');
    return { left, right: right.length ? right : ['menu'] };
  }

  function renderToolbarButtons() {
    const config = buttonConfig();
    const tab = VexTabStore.active();
    for (const side of ['left', 'right']) {
      const slot = clear($('tb-' + side));
      for (const id of config[side]) {
        const spec = BUTTONS[id];
        if (!spec) continue;
        // Stable ids (tb-back, tb-tabs, tb-menu…) so the rest of the chrome —
        // and the smoke run — can still point at a button by name.
        const button = el('button', {
          class: 'tb-btn' + (spec.counter ? ' tb-tabs' : ''),
          'aria-label': spec.label,
          id: 'tb-' + id
        });
        if (spec.counter) {
          button.appendChild(el('span', { id: 'tb-tabcount' }, String(VexTabStore.all().length || 0)));
          VexGestures.longPress(button, () => newTab());
        } else {
          button.appendChild(icon(spec.icon));
        }
        if (spec.enabled) button.disabled = !spec.enabled(tab);
        button.onclick = () => spec.run(VexTabStore.active());
        if (id === 'back') VexGestures.longPress(button, () => VexPanels.history());
        slot.appendChild(button);
      }
    }
  }

  async function goHome() {
    const homepage = String(VexStore.get('vex.homepage', '') || '').trim();
    const tab = VexTabStore.active();
    if (!tab) { await newTab(); return; }
    if (homepage) await VexTabStore.navigate(tab.id, VexSearch.toUrl(homepage));
    else { await VexTabStore.navigate(tab.id, 'about:blank'); VexTabStore.update(tab.id, { url: 'about:blank', loading: false }); }
    renderToolbar();
  }

  function renderToolbar() {
    renderToolbarButtons();
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

    document.body.classList.toggle('private', !!(tab && tab.incognito));

    const blocked = tab ? tab.blocked : 0;
    $('tb-shield').hidden = !blocked;
    $('tb-shield-count').textContent = String(blocked);

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

  // ── Dialogs ──────────────────────────────────────────────────────────────
  function dialog({ title, message, input, code, okLabel = 'OK', cancelLabel = 'Cancel', hideCancel }) {
    return new Promise(resolve => {
      $('dialog-title').textContent = title || 'Vex';
      const messageEl = $('dialog-message');
      messageEl.hidden = !message;
      messageEl.textContent = message || '';
      const inputEl = $('dialog-input');
      inputEl.hidden = input === undefined;
      inputEl.value = input || '';
      const codeEl = $('dialog-code');
      codeEl.hidden = !code;
      codeEl.textContent = code || '';
      $('dialog-ok').textContent = okLabel;
      const cancel = $('dialog-cancel');
      cancel.hidden = !!hideCancel;
      cancel.textContent = cancelLabel;
      $('dialog').hidden = false;

      const finish = value => {
        $('dialog').hidden = true;
        $('dialog-ok').onclick = null;
        cancel.onclick = null;
        $('dialog-scrim').onclick = null;
        resolve(value);
      };
      $('dialog-ok').onclick = () => finish(input !== undefined ? inputEl.value : true);
      cancel.onclick = () => finish(null);
      $('dialog-scrim').onclick = () => finish(null);
      if (input !== undefined) setTimeout(() => { inputEl.focus(); inputEl.select(); }, 60);
    });
  }

  // ── Omnibox ──────────────────────────────────────────────────────────────
  function openOmnibox(prefill) {
    const box = $('omnibox');
    const input = $('omni-input');
    if (box.hidden) { box.hidden = false; cover(true); }
    showToolbar();
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
    try {
      const clip = (await navigator.clipboard.readText()).trim();
      if (clip && clip.length < 400) {
        chips.appendChild(el('button', {
          class: 'chip',
          onclick: () => { closeOmnibox(); openUrl(clip); }
        }, (VexSearch.isSearch(clip) ? 'Search “' : 'Go to ') + clip.slice(0, 28) + (VexSearch.isSearch(clip) ? '”' : '')));
      }
    } catch { /* no clipboard permission: the chip is a convenience */ }
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

  async function renderSuggestions(text) {
    const list = clear($('omni-results'));
    const rows = VexSearch.suggest(text);
    for (const row of rows) list.appendChild(suggestionRow(row, text));

    // Recall: pages whose text contains what you typed, under the ordinary
    // suggestions, because it is a slower and less certain kind of answer.
    const query = String(text || '').trim();
    if (query.length >= 3) {
      const hits = await VexHistory.recall(query, 4);
      const known = new Set(rows.map(row => row.url));
      const fresh = hits.filter(hit => !known.has(hit.url));
      if (fresh.length) {
        list.appendChild(el('li', 'list-head', 'From pages you read'));
        for (const hit of fresh) {
          list.appendChild(suggestionRow({
            kind: 'recall', title: hit.title || VexSearch.prettyHost(hit.url),
            url: hit.url, snippet: VexHistory.snippet(hit, query)
          }, text));
        }
      }
    }
  }

  function suggestionRow(row, text) {
    const item = el('li', 'omni-row');
    item.setAttribute('role', 'option');
    const kind = el('span', 'kind');
    if (row.icon) kind.appendChild(el('img', { src: row.icon, alt: '' }));
    else kind.appendChild(icon(row.kind === 'search' ? 'search'
      : row.kind === 'bookmark' ? 'star' : row.kind === 'recall' ? 'book' : 'history'));
    item.appendChild(kind);
    const lines = el('div', 'lines');
    const title = el('span', 't');
    if (row.kind === 'search') title.textContent = 'Search for “' + row.title + '”';
    else title.appendChild(highlight(row.title, text));
    lines.appendChild(title);
    lines.appendChild(el('span', 'u', row.snippet || row.url));
    item.appendChild(lines);
    item.onclick = () => { closeOmnibox(); openUrl(row.url); };
    return item;
  }

  // ── Tab switcher ─────────────────────────────────────────────────────────
  async function openTabGrid() {
    const active = VexTabStore.active();
    if (active) {
      try {
        const shot = await VexBridge.snapshot(active.id);
        if (shot && shot.dataUrl) active.snapshot = shot.dataUrl;
      } catch { /* a tab that never painted has no snapshot */ }
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
    VexCollections.groups.prune(VexTabStore.all().map(tab => tab.id));
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
      const group = VexCollections.groups.of(tab.id);
      const card = el('div', 'tabcard' + (tab.id === VexTabStore.activeId() ? ' active' : ''));
      if (group) card.style.borderColor = group.color;
      const shot = el('div', 'tabcard-shot');
      if (tab.snapshot) shot.style.backgroundImage = 'url("' + tab.snapshot + '")';
      card.appendChild(shot);

      const bar = el('div', 'tabcard-bar');
      bar.appendChild(favicon(tab, 'tabcard-icon'));
      bar.appendChild(el('span', 'tabcard-title', (group ? group.name + ' · ' : '')
        + (tab.title || VexSearch.prettyHost(tab.url) || 'New tab')));
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
    const group = VexCollections.groups.of(tab.id);
    VexSheets.choose(tab.title || VexSearch.prettyHost(tab.url) || 'Tab', [
      { id: 'group', label: group ? 'Move to another group' : 'Put in a group' },
      group ? { id: 'ungroup', label: 'Take out of ' + group.name } : null,
      { id: 'bookmark', label: 'Bookmark this tab' },
      { id: 'reading', label: 'Add to reading list' },
      { id: 'close-others', label: 'Close other tabs' },
      { id: 'copy', label: 'Copy link' },
      { id: 'qr', label: 'Show as QR code' },
      { id: 'share', label: 'Share' }
    ].filter(Boolean), async choice => {
      VexSheets.close();
      if (choice === 'group') {
        const groups = VexCollections.groups.all();
        VexSheets.choose('Group', groups.map(entry => ({ id: entry.id, label: entry.name }))
          .concat([{ id: '__new', label: 'New group…' }]), async target => {
          VexSheets.close();
          if (target === '__new') {
            const name = await prompt('New group', 'A name for it');
            if (!name) return;
            await VexCollections.groups.create(name, [tab.id]);
          } else {
            await VexCollections.groups.addTab(target, tab.id);
          }
          renderTabGrid();
        });
      } else if (choice === 'ungroup') {
        await VexCollections.groups.removeTab(tab.id);
        renderTabGrid();
      } else if (choice === 'close-others') {
        for (const other of VexTabStore.all()) {
          if (other.id !== tab.id && other.incognito === tab.incognito) await VexTabStore.close(other.id);
        }
        renderTabGrid();
      } else if (choice === 'bookmark') {
        await VexCollections.bookmarks.add({ url: tab.url, title: tab.title, icon: tab.icon });
        VexSync.schedulePush();
        toast('Bookmarked');
      } else if (choice === 'reading') {
        await VexCollections.reading.add({ url: tab.url, title: tab.title, icon: tab.icon });
        VexSync.schedulePush();
        toast('Saved for later');
      } else if (choice === 'copy') copy(tab.url);
      else if (choice === 'qr') showQr(tab.url, tab.title);
      else if (choice === 'share') VexBridge.share(tab.url, tab.title);
    });
  }

  // ── Find ─────────────────────────────────────────────────────────────────
  function openFind() {
    showToolbar();
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

  // ── QR ───────────────────────────────────────────────────────────────────
  function showQr(url, title) {
    const canvas = VexTools.drawQr(url, 250);
    if (!canvas) { toast('Could not draw that'); return; }
    clear($('qrshare-canvas')).appendChild(canvas);
    $('qrshare-title').textContent = title ? 'Scan to open' : 'Scan to open';
    $('qrshare-url').textContent = url;
    $('qrshare').hidden = false;
    cover(true);
  }

  function closeQr() {
    if ($('qrshare').hidden) return;
    $('qrshare').hidden = true;
    cover(false);
  }

  async function openScanner() {
    $('scan').hidden = false;
    cover(true);
    try {
      await VexTools.startScan(text => {
        closeScanner();
        // A QR code is usually a URL; when it is a 2FA enrolment it belongs in
        // the vault instead, and when it is neither it becomes a search.
        const otp = VexVault.parseOtpAuth(text);
        if (otp) {
          VexPanels.addLogin({ host: otp.issuer || otp.account, username: otp.account, secret: otp.secret });
          return;
        }
        closeOmnibox();
        openUrl(text);
      });
    } catch (error) {
      closeScanner();
      toast(error.message, 3500);
    }
  }

  function closeScanner() {
    VexTools.stopScan();
    if ($('scan').hidden) return;
    $('scan').hidden = true;
    cover(false);
  }

  // ── The video bar ────────────────────────────────────────────────────────
  async function refreshMediaBar() {
    if (!VexStore.get('vex.mediaBar', true)) { $('mediabar').hidden = true; return; }
    const tab = VexTabStore.active();
    if (!tab || !tab.url || tab.url === 'about:blank' || !$('omnibox').hidden) { $('mediabar').hidden = true; return; }
    const state = await VexMedia.state(tab.id);
    const show = !!state.playing;
    $('mediabar').hidden = !show;
    if (show) {
      $('media-label').textContent = state.duration
        ? Math.floor(state.current / 60) + ':' + String(state.current % 60).padStart(2, '0')
          + ' / ' + Math.floor(state.duration / 60) + ':' + String(state.duration % 60).padStart(2, '0')
        : 'Playing';
    }
  }

  // ── Actions the sheets and panels call ───────────────────────────────────
  async function openUrl(input, options = {}) {
    const url = VexSearch.toUrl(input);
    if (!url) return;
    const tab = VexTabStore.active();
    const newTab = options.newTab || (!tab) || (VexStore.get('vex.linksInNewTab', false) && options.fromLink);
    if (newTab) {
      await VexTabStore.create(url, { incognito: options.incognito, background: options.background });
      if (options.background) toast('Opened in a new tab');
    } else {
      await VexTabStore.navigate(tab.id, url);
    }
    renderToolbar();
  }

  async function newTab(options = {}) {
    if (options.incognito && !(await unlockPrivate())) return;
    const homepage = String(VexStore.get('vex.homepage', '') || '').trim();
    if (homepage && !options.blank) {
      await VexTabStore.create(VexSearch.toUrl(homepage), options);
      renderToolbar();
      return;
    }
    await VexTabStore.create('about:blank', options);
    renderToolbar();
    openOmnibox('');
  }

  // Samsung calls it Secret mode, and locks it behind a fingerprint. So does
  // this, when you ask it to — and it stays unlocked for a few minutes so that
  // switching tabs is not a fingerprint every time.
  async function unlockPrivate() {
    if (!VexStore.get('vex.lockPrivate', false)) return true;
    if (Date.now() - privateUnlockedAt < 3 * 60 * 1000) return true;
    const check = await VexBridge.authenticate('Private tabs', 'Unlock to open private browsing');
    if (!check.ok) { toast('Not unlocked'); return false; }
    privateUnlockedAt = Date.now();
    return true;
  }

  async function copy(text) {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); toast('Copied'); }
    catch { toast('Could not copy'); }
  }

  async function toggleBookmark() {
    const tab = VexTabStore.active();
    if (!tab || !tab.url || tab.url === 'about:blank') { toast('Nothing to bookmark yet'); return; }
    if (VexCollections.bookmarks.has(tab.url)) {
      await VexCollections.bookmarks.remove(tab.url);
      toast('Bookmark removed');
    } else {
      await VexCollections.bookmarks.add({ url: tab.url, title: tab.title, icon: tab.icon });
      toast('Bookmarked', 3000, { label: 'Folder', run: () => VexPanels.pickFolder(VexCollections.bookmarks.get(tab.url)) });
    }
    VexSync.schedulePush();
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

  // ── Translation ──────────────────────────────────────────────────────────
  async function translatePage() {
    const tab = VexTabStore.active();
    if (!tab) return;
    const recent = VexStore.get('vex.translateTo', 'en');
    VexSheets.choose('Translate this page into',
      VexTools.LANGUAGES.map(([code, name]) => ({ id: code, label: name, selected: code === recent })),
      async language => {
        VexSheets.close();
        await VexStore.set('vex.translateTo', language);
        toast('Translating…', 1500);
        try {
          const result = await VexTools.translate(tab, language);
          if (result.via === 'web') {
            toast('No assistant configured — using the web translator', 3000);
            openUrl(result.url);
            return;
          }
          VexViews.openAI();
        } catch (error) { toast(error.message, 3500); }
      }, 'Through your own assistant, when one is set up');
  }

  // ── Logins ───────────────────────────────────────────────────────────────
  // Offered, never automatic: the sheet appears, and filling is a tap.
  async function offerAutofill(tab, { manual = false } = {}) {
    const host = VexSearch.prettyHost(tab.url);
    if (!manual && !VexVault.hasFor(host)) return;
    if (!manual && !(await VexVault.pageHasLoginForm(tab.id))) return;
    if (!(await VexVault.unlock('Fill a saved login'))) return;
    const matches = VexVault.forHost(host);
    if (!matches.length) { if (manual) toast('Nothing saved for ' + host); return; }
    VexSheets.choose('Fill a login', matches.map(entry => ({
      id: entry.id, label: entry.username || entry.host, note: entry.host
    })), async entryId => {
      VexSheets.close();
      const entry = matches.find(candidate => candidate.id === entryId);
      const filled = await VexVault.fill(tab.id, entry);
      toast(filled ? 'Filled — you press the button' : 'No login form on this page');
      if (entry.secret) {
        const code = await VexVault.totp(entry.secret);
        toast('2FA code ' + code, 6000, { label: 'Copy', run: () => copy(code) });
      }
    }, host);
  }

  async function saveLoginFromPage(tab) {
    const fields = await VexVault.readFields(tab.id);
    if (!fields) { toast('No login form on this page'); return; }
    await VexPanels.addLogin({
      host: VexSearch.prettyHost(tab.url),
      username: fields.username || '',
      password: fields.password || ''
    });
  }

  // ── Files, in and out ────────────────────────────────────────────────────
  function downloadText(filename, text, mimeType = 'text/plain') {
    const blob = new Blob([text], { type: mimeType });
    const link = el('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.appendChild(link);
    link.click();
    setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 2000);
    toast('Saved to Downloads');
  }

  function pickTextFile(onText) {
    const input = el('input', { type: 'file', accept: '.html,.htm,text/html', style: 'display:none' });
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { onText(String(reader.result || '')); input.remove(); };
      reader.readAsText(file);
    };
    document.body.appendChild(input);
    input.click();
  }

  return {
    version: '0.3.0',

    BUTTONS, DEFAULT_BUTTONS, buttonConfig, goHome,
    toast, cover, pushBounds, scheduleBounds, applyToolbarPosition, onPageScroll,
    renderToolbar, renderProgress, renderTabGrid, renderSuggestions, refreshMediaBar,
    openOmnibox, closeOmnibox, openTabGrid, closeTabGrid, openFind, closeFind,
    openUrl, newTab, copy, toggleBookmark, reopenClosed, setStartVisible,
    showQr, closeQr, openScanner, closeScanner, translatePage,
    offerAutofill, saveLoginFromPage, downloadText, pickTextFile, unlockPrivate,

    prompt(title, message, value = '') { return dialog({ title, message, input: value }); },
    confirm(message, title = 'Vex') { return dialog({ title, message, okLabel: 'Yes', cancelLabel: 'No' }).then(Boolean); },
    showRecoveryCode(code) {
      return dialog({
        title: 'Your recovery code',
        message: 'Write this down. It is the key your synced data is encrypted with — the worker never '
          + 'sees it, and without it another device cannot read anything.',
        code, okLabel: 'I have written it down', hideCancel: true
      });
    },

    bind() {
      $('tb-url').onclick = () => openOmnibox();

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
      VexGestures.longPress($('tb-url'), () => {
        const tab = VexTabStore.active();
        if (tab && tab.url && tab.url !== 'about:blank') copy(tab.url);
      });

      // Omnibox
      $('omni-cancel').onclick = closeOmnibox;
      $('omni-voice').onclick = async () => {
        const spoken = await VexTools.dictate();
        if (!spoken) { toast('Did not catch that'); return; }
        $('omni-input').value = spoken;
        renderSuggestions(spoken);
      };
      $('omni-scan').onclick = () => openScanner();
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
      $('tg-private').onclick = async () => {
        if (!(await unlockPrivate())) return;
        tabGridScope = 'private';
        renderTabGrid();
      };
      $('tg-search').addEventListener('input', event => { tabQuery = event.target.value; renderTabGrid(); });
      $('tg-new').onclick = async () => {
        closeTabGrid();
        await newTab({ incognito: tabGridScope === 'private' });
      };
      $('tg-done').onclick = closeTabGrid;
      $('tg-close-all').onclick = async () => {
        const scope = tabGridScope === 'private';
        const closing = VexTabStore.all().filter(tab => !!tab.incognito === scope)
          .map(tab => ({ url: tab.url, title: tab.title }));
        if (!closing.length) return;
        if (VexStore.get('vex.confirmCloseAll', true)
          && !(await VexUI.confirm('Close all ' + closing.length + ' tabs?'))) return;
        await VexTabStore.closeAll(scope);
        renderTabGrid();
        renderToolbar();
        if (!scope) {
          toast('Closed ' + closing.length + ' tabs', 4500, {
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

      // Sheets, QR, scanner
      $('sheet-scrim').onclick = () => VexSheets.close();
      $('qrshare-scrim').onclick = closeQr;
      $('qrshare-close').onclick = closeQr;
      $('scan-cancel').onclick = closeScanner;

      // Media bar
      $('media-playpause').onclick = async () => {
        const tab = VexTabStore.active();
        if (!tab) return;
        const state = await VexMedia.state(tab.id);
        if (state.playing) await VexMedia.pause(tab.id); else await VexMedia.play(tab.id);
        refreshMediaBar();
      };
      $('media-back10').onclick = () => { const tab = VexTabStore.active(); if (tab) VexMedia.seek(tab.id, -10); };
      $('media-fwd10').onclick = () => { const tab = VexTabStore.active(); if (tab) VexMedia.seek(tab.id, 10); };
      $('media-pop').onclick = async () => {
        const tab = VexTabStore.active();
        if (!tab) return;
        try { await VexMedia.popOut(tab.id); }
        catch (error) { toast(error.message); }
      };
      $('media-close').onclick = () => { $('mediabar').hidden = true; };

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
      applyToolbarPosition();

      window.addEventListener('resize', scheduleBounds);
      window.addEventListener('orientationchange', scheduleBounds);
      if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleBounds);

      VexTabStore.onChange(() => { renderToolbar(); renderProgress(); });

      clearInterval(mediaTimer);
      mediaTimer = setInterval(refreshMediaBar, 4000);
    },

    // Android's back gesture, innermost thing first.
    async handleBack() {
      if (!$('dialog').hidden) { $('dialog-cancel').click(); return true; }
      if (!$('scan').hidden) { closeScanner(); return true; }
      if (!$('qrshare').hidden) { closeQr(); return true; }
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
