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

  // Where the address bar and the buttons go:
  //   bottom   one bar at the bottom (Vex's own, Firefox's, Chrome's option)
  //   top      one bar at the top
  //   split    address at the top, buttons along the bottom (Samsung Internet)
  //   stacked  address above the buttons, both at the bottom (Safari)
  const LAYOUTS = ['bottom', 'top', 'split', 'stacked'];

  function applyToolbarPosition() {
    const stored = VexStore.get('vex.toolbarPosition', 'bottom');
    const position = LAYOUTS.includes(stored) ? stored : 'bottom';
    document.body.dataset.toolbar = position;
    // The button slots keep their ids wherever they are, so everything that
    // draws or finds a button is unaffected by which bar it is on.
    const separate = position === 'split' || position === 'stacked';
    const navbar = $('navbar');
    const left = $('tb-left'), right = $('tb-right'), pill = $('tb-url');
    if (navbar && left && right && pill) {
      if (separate) {
        if (left.parentElement !== navbar) navbar.append(left, right);
      } else if (left.parentElement !== pill.parentElement) {
        pill.before(left);
        pill.after(right);
      }
      navbar.hidden = !separate;
    }
    showToolbar();
    scheduleBounds();
  }

  function showToolbar() {
    if (fullscreen) return;              // a video full screen keeps the chrome away
    if (!toolbarHidden) return;
    toolbarHidden = false;
    document.body.classList.remove('toolbar-hidden');
    scheduleBounds();
  }

  // A page that went full screen — a video, usually — gets the whole display.
  // This used to be a class toggled from app.js, behind showToolbar's back, so
  // toolbarHidden ended up lying about the toolbar and auto-hide stopped
  // working for the rest of the session. It also comes back to where it was
  // rather than always coming back up.
  let fullscreen = false;
  let toolbarBeforeFullscreen = false;

  function setFullscreen(on) {
    on = !!on;
    if (on === fullscreen) return;
    if (on) {
      toolbarBeforeFullscreen = toolbarHidden;
      toolbarHidden = true;
    } else {
      toolbarHidden = toolbarBeforeFullscreen;
    }
    fullscreen = on;
    document.body.classList.toggle('toolbar-hidden', toolbarHidden);
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
    if (on === !start.hidden) {
      // Still showing, but drawn for the other side of the private line.
      if (on && VexStart.stale()) VexStart.render();
      return;
    }
    if (on) VexStart.render();
    start.hidden = !on;
    cover(on);
    if (on) showToolbar();
  }

  function startVisible() { return !$('start').hidden; }

  /**
   * Long-press Back (or Forward): where this tab has been, so a page five
   * steps ago is one tap rather than five. Nearest first, the way the button
   * would take you; the whole history is the last row.
   */
  async function tabHistory(direction) {
    const tab = VexTabStore.active();
    const list = tab && !tab.lazy ? await VexBridge.navList(tab.id).catch(() => null) : null;
    const entries = (list && list.entries) || [];
    const current = list ? list.current : -1;
    const rows = [];
    if (current >= 0) {
      for (let index = current + direction; index >= 0 && index < entries.length; index += direction) {
        const entry = entries[index] || {};
        if (!entry.url || entry.url === 'about:blank') continue;
        rows.push({
          id: String(index - current),
          label: entry.title || VexSearch.prettyHost(entry.url),
          note: VexSearch.prettyHost(entry.url)
        });
        if (rows.length >= 15) break;
      }
    }
    // Nothing in this tab to go to: the button's old long press, all history.
    if (!rows.length) { VexPanels.history(); return; }
    rows.push({ id: 'all', label: 'All history', note: 'Every page, in every tab' });
    VexSheets.choose(direction < 0 ? 'Back to' : 'Forward to', rows, choice => {
      VexSheets.close();
      if (choice === 'all') { VexPanels.history(); return; }
      VexBridge.go(tab.id, Number(choice));
    });
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
    // The star bookmarks the page in front, as a star does everywhere else; it
    // opened the list, so on a phone with it in the bottom bar (the Samsung and
    // Safari looks) there was no way to bookmark anything from it. The list is
    // a long-press away, and what the star does with no page open.
    bookmarks: {
      icon: 'star', label: 'Bookmark this page', run: tab => starPage(tab),
      on: tab => !!(tab && tab.url && VexCollections.bookmarks.has(tab.url))
    },
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

  // The buttons are rebuilt only when which buttons they are changes. Anything
  // else — a tab opening, a page starting to load — updates them in place.
  //
  // This is not only cheaper: renderToolbar() runs on every state change, and a
  // rebuild between your finger going down and coming up loses the tap, because
  // the element the touch started on is no longer in the document.
  let builtButtons = '';

  function renderToolbarButtons() {
    const config = buttonConfig();
    // The look is part of it: Samsung's menu is ≡, Chrome's ⋮, Safari's ….
    const menuIcon = VexTheme.menuIcon ? VexTheme.menuIcon() : 'menu';
    const signature = config.left.join(',') + '|' + config.right.join(',') + '|' + menuIcon;
    const tab = VexTabStore.active();

    if (signature !== builtButtons) {
      builtButtons = signature;
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
            button.appendChild(el('span', { id: 'tb-tabcount' }, '0'));
            VexGestures.longPress(button, () => newTab());
          } else {
            button.appendChild(icon(id === 'menu' ? menuIcon : spec.icon));
          }
          button.onclick = () => spec.run(VexTabStore.active());
          if (id === 'bookmarks') VexGestures.longPress(button, () => VexPanels.bookmarks());
          if (id === 'back') VexGestures.longPress(button, () => tabHistory(-1));
          if (id === 'forward') VexGestures.longPress(button, () => tabHistory(1));
          slot.appendChild(button);
        }
      }
    }

    for (const side of ['left', 'right']) {
      for (const id of config[side]) {
        const spec = BUTTONS[id];
        const button = $('tb-' + id);
        if (!spec || !button) continue;
        if (spec.enabled) button.disabled = !spec.enabled(tab);
        if (spec.on) {
          const on = !startVisible() && spec.on(tab);
          button.classList.toggle('on', on);
          button.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        if (spec.counter) {
          // The side you are on, not both: the number on the toolbar has to be
          // the number of cards the switcher will show you, and a normal tab
          // should not be counting how many private ones are open.
          const count = String(VexTabStore.count(!!(tab && tab.incognito)) || 0);
          const label = $('tb-tabcount');
          if (label && label.textContent !== count) label.textContent = count;
        }
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

  // ── The tab bar ───────────────────────────────────────────────────────────
  // A phone has no room for it; a tablet, a split screen and a big phone in
  // landscape do, which is exactly where Samsung Internet shows one. "auto"
  // decides by how wide the window is right now, so it appears and goes away
  // with a fold or a split rather than needing a restart.
  const TAB_BAR_WIDTH = 600;

  function tabBarWanted() {
    const setting = VexStore.get('vex.tabBar', 'auto');
    if (setting === 'off') return false;
    if (setting === 'on') return true;
    return window.innerWidth >= TAB_BAR_WIDTH;
  }

  let builtStrip = '';

  function renderTabStrip() {
    const strip = $('tabstrip');
    const wanted = tabBarWanted();
    if (strip.hidden !== !wanted) {
      strip.hidden = !wanted;
      scheduleBounds();                      // the content rect just changed size
    }
    if (!wanted) { builtStrip = ''; return; }

    const active = VexTabStore.activeId();
    const tabs = VexTabStore.active() && VexTabStore.active().incognito
      ? VexTabStore.private()
      : VexTabStore.normal();
    // Same lesson as the toolbar: rebuilding under a finger loses the tap, so
    // only rebuild when the row actually changes.
    const signature = tabs.map(tab => tab.id + ':' + (tab.title || tab.url) + ':' + (tab.icon ? '1' : '0')).join('|')
      + '#' + active;
    if (signature === builtStrip) return;
    builtStrip = signature;

    const list = clear($('tabstrip-list'));
    for (const tab of tabs) {
      const chip = el('button', {
        class: 'tabstrip-tab' + (tab.id === active ? ' active' : ''),
        'aria-label': tab.title || VexSearch.prettyHost(tab.url) || 'New tab',
        'aria-current': tab.id === active ? 'true' : 'false'
      });
      chip.appendChild(favicon(tab, 'tabstrip-icon'));
      chip.appendChild(el('span', 'tabstrip-title',
        tab.title || VexSearch.prettyHost(tab.url) || 'New tab'));
      const close = el('button', { class: 'tabstrip-x', 'aria-label': 'Close tab' });
      close.appendChild(icon('close'));
      close.onclick = async event => {
        event.stopPropagation();
        await closeTabWithUndo(tab);
      };
      chip.appendChild(close);
      chip.onclick = () => { if (tab.id !== VexTabStore.activeId()) VexTabStore.activate(tab.id); };
      VexGestures.longPress(chip, () => tabActions(tab));
      list.appendChild(chip);
    }
  }

  let lastPill = null;

  function renderToolbar() {
    renderToolbarButtons();
    renderTabStrip();
    const tab = VexTabStore.active();
    const url = tab ? (tab.loading && tab.pendingUrl ? tab.pendingUrl : tab.url) : '';
    const live = !!(url && url !== 'about:blank');
    const text = $('tb-url-text');
    // Redrawn only when what it shows changes: this runs on every progress
    // tick of a load, and a fresh <img> each time re-decodes the favicon a
    // dozen times a second.
    const pillSignature = live
      ? [VexSearch.prettyHost(url) || url, tab.incognito ? 'p' : '', tab.icon || '', url.startsWith('https://') ? 's' : ''].join('|')
      : '';
    const pillChanged = pillSignature !== lastPill;
    lastPill = pillSignature;
    const iconSlot = pillChanged ? clear($('tb-icon')) : $('tb-icon');

    if (!pillChanged) {
      // Nothing in the pill has changed.
    } else if (!live) {
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

    // The reader icon, when the page has an article in it.
    $('tb-reader').hidden = !(live && tab && tab.readable && !tab.loading);

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
  // There is one dialog element and several things that can want it at once —
  // two tabs asking for a permission, the agent's confirmation arriving while a
  // prompt is up. Without a queue the second overwrites the first's buttons and
  // the first promise is never settled, which strands whatever was awaiting it.
  let dialogQueue = Promise.resolve();

  function dialog(options) {
    const next = dialogQueue.then(() => showDialog(options), () => showDialog(options));
    dialogQueue = next.then(() => {}, () => {});
    return next;
  }

  /**
   * A recovery code, to be written down: its dashed groups laid out as a grid
   * that is never wider than the dialog — four to a row where they fit, two
   * where they do not, one at the largest text sizes — and never split inside
   * a group. It was one long line in a <pre>, which cannot wrap, and ran off
   * the edge of a phone. The text itself is still the canonical dashed form
   * (each group carries its dash), and Copy copies exactly that.
   */
  function renderCode(box, code) {
    const groups = code.split('-');
    const grid = el('div', { class: 'rc-grid', role: 'text', 'aria-label': code.split('').join(' ') });
    groups.forEach((group, index) => {
      const cell = el('span', 'rc-group');
      cell.appendChild(document.createTextNode(group));
      if (index < groups.length - 1) cell.appendChild(el('span', { class: 'rc-dash', 'aria-hidden': 'true' }, '-'));
      grid.appendChild(cell);
    });
    // Laid out as a grid, a selection of it copies as eight lines with no
    // dashes. Whatever way it is copied — this button, or Android's own Copy
    // on a long-press selection — what lands on the clipboard is the code.
    grid.addEventListener('copy', event => {
      if (!event.clipboardData) return;
      event.preventDefault();
      event.clipboardData.setData('text/plain', code);
    });
    box.appendChild(grid);
    const copyButton = el('button', { class: 'chip rc-copy', type: 'button' });
    copyButton.appendChild(icon('copy'));
    copyButton.appendChild(document.createTextNode('Copy'));
    copyButton.onclick = () => copy(code);
    box.appendChild(copyButton);
  }

  function showDialog({ title, message, input, code, okLabel = 'OK', cancelLabel = 'Cancel', hideCancel }) {
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
      clear(codeEl);
      if (code) renderCode(codeEl, String(code));
      $('dialog-ok').textContent = okLabel;
      const cancel = $('dialog-cancel');
      cancel.hidden = !!hideCancel;
      cancel.textContent = cancelLabel;
      $('dialog').hidden = false;
      // Like every other overlay: the native page view is drawn above this
      // WebView, so a dialog that does not hide the page is a dialog nobody can
      // see — and this is the one that asks whether a site may use the camera.
      cover(true);

      const finish = value => {
        $('dialog').hidden = true;
        cover(false);
        $('dialog-ok').onclick = null;
        cancel.onclick = null;
        $('dialog-scrim').onclick = null;
        inputEl.onkeydown = null;
        resolve(value);
      };
      $('dialog-ok').onclick = () => finish(input !== undefined ? inputEl.value : true);
      cancel.onclick = () => finish(null);
      $('dialog-scrim').onclick = () => finish(null);
      // The keyboard's Enter is the OK button, the way it is everywhere else.
      inputEl.onkeydown = event => {
        if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); $('dialog-ok').click(); }
      };
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

  // Also reached from the home-screen widget's microphone, which opens the
  // omnibox and then starts listening — the same two steps, one tap earlier.
  async function dictateIntoOmnibox() {
    const spoken = await VexTools.dictate();
    if (!spoken) { toast('Did not catch that'); return; }
    $('omni-input').value = spoken;
    renderSuggestions(spoken);
  }

  function closeOmnibox() {
    if ($('omnibox').hidden) return;
    // Nothing a slow query answers belongs in a closed omnibox.
    suggestFor = '';
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
    for (const [id, engine] of Object.entries(VexSearch.engines())) {
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

  // Which keystroke a set of suggestions belongs to. Typing is faster than a
  // phone's network, so an answer that arrives after you have typed two more
  // letters is about a question you are no longer asking.
  let suggestFor = '';

  async function renderSuggestions(text) {
    const list = clear($('omni-results'));
    const typed = String(text || '').trim();
    suggestFor = typed;

    // A tab you already have open beats opening it again. Only this side of
    // the private line: a normal tab's omnibox does not list private ones.
    const here = VexTabStore.active();
    if (typed.length >= 2) {
      const needle = typed.toLowerCase();
      const open = (here && here.incognito ? VexTabStore.private() : VexTabStore.normal())
        .filter(tab => tab !== here && tab.url && tab.url !== 'about:blank'
          && ((tab.title || '') + ' ' + tab.url).toLowerCase().includes(needle))
        .sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0))
        .slice(0, 2);
      for (const tab of open) {
        list.appendChild(suggestionRow({
          kind: 'tab', title: tab.title || VexSearch.prettyHost(tab.url), url: tab.url, tabId: tab.id,
          snippet: 'Switch to this tab · ' + VexSearch.prettyHost(tab.url)
        }, text));
      }
    }

    const rows = VexSearch.suggest(text);
    for (const row of rows) list.appendChild(suggestionRow(row, text));

    // "Find it on this page" — one journey instead of opening the menu and then
    // the find bar. Only with a page to search, and only when what was typed is
    // not already an address, since nobody searches a page for a URL.
    const page = VexTabStore.active();
    if (typed.length >= 2 && VexSearch.isSearch(typed)
      && page && page.url && page.url !== 'about:blank' && !startVisible()) {
      list.appendChild(suggestionRow({
        kind: 'find', title: typed, url: '',
        snippet: 'Find it on ' + (VexSearch.prettyHost(page.url) || 'this page')
      }, text));
    }
    if (typed) {
      VexSearch.remoteSuggest(typed).then(answers => {
        if (suggestFor !== typed) return;                    // you have typed on
        if (!answers.length) return;
        const already = new Set(rows.map(row => (row.title || '').toLowerCase()));
        already.add(typed.toLowerCase());
        const fresh = answers.filter(answer => !already.has(answer.toLowerCase())).slice(0, 6);
        if (!fresh.length) return;
        // Below the local rows: what you have been to beats what a stranger
        // thinks you meant.
        const results = $('omni-results');
        if (!results) return;
        for (const answer of fresh) {
          results.appendChild(suggestionRow({
            kind: 'suggest', title: answer, url: VexSearch.searchUrl(answer)
          }, text));
        }
      });
    }

    // Recall: pages whose text contains what you typed, under the ordinary
    // suggestions, because it is a slower and less certain kind of answer.
    const query = String(text || '').trim();
    if (query.length >= 3) {
      const hits = await VexHistory.recall(query, 4);
      // Reading the page text out of IndexedDB takes long enough that two more
      // letters, or a closed omnibox, are both likely by the time it answers.
      if (suggestFor !== query) return;
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
    else kind.appendChild(icon(row.kind === 'search' || row.kind === 'suggest' ? 'search'
      : row.kind === 'find' ? 'find'
      : row.kind === 'tab' ? 'tabs'
      : row.kind === 'bookmark' ? 'star' : row.kind === 'recall' ? 'book' : 'history'));
    item.appendChild(kind);
    const lines = el('div', 'lines');
    const title = el('span', 't');
    if (row.kind === 'search') title.textContent = 'Search for “' + row.title + '”';
    else if (row.kind === 'find') title.textContent = 'Find “' + row.title + '” on this page';
    else title.appendChild(highlight(row.title, text));
    lines.appendChild(title);
    // A suggestion's second line would be the search URL, which tells nobody
    // anything; the engine's name is the useful thing to say.
    if (row.kind === 'suggest') {
      const engine = VexSearch.engines()[VexSearch.engineId()];
      lines.appendChild(el('span', 'u', engine ? engine.name : 'Search'));
    } else {
      lines.appendChild(el('span', 'u', row.snippet || (row.remote ? 'On your computer · ' : '') + row.url));
    }
    item.appendChild(lines);

    // Put it in the box instead of going there. Every other browser has this
    // arrow and it is the difference between a suggestion you can refine and
    // one you can only accept.
    if (row.kind === 'suggest' || row.kind === 'search') {
      const fill = el('button', { class: 'omni-fill', 'aria-label': 'Put “' + row.title + '” in the address bar' });
      fill.appendChild(icon('arrow-up-left'));
      fill.onclick = event => {
        event.stopPropagation();
        const input = $('omni-input');
        input.value = row.title;
        input.focus();
        renderSuggestions(row.title);
      };
      item.appendChild(fill);
    }

    item.onclick = () => {
      closeOmnibox();
      if (row.kind === 'find') { findOnPage(row.title); return; }
      if (row.kind === 'tab' && VexTabStore.get(row.tabId)) { VexTabStore.activate(row.tabId); return; }
      openUrl(row.url);
    };
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
    applyPrivacyScreen();
  }

  // A private tab in front means no screenshot and nothing in the recents
  // thumbnail — the thumbnail being the one that shows itself to whoever picks
  // up the phone without unlocking anything. The switcher's private side counts
  // too: that grid is a wall of private pages.
  let screenBlocked = false;

  function applyPrivacyScreen() {
    if (VexStore.get('vex.hidePrivate', true) === false) {
      if (screenBlocked) { screenBlocked = false; VexBridge.setScreenshotsBlocked(false); }
      return;
    }
    const active = VexTabStore.active();
    const want = !!(active && active.incognito)
      || (!$('tabgrid').hidden && tabGridScope === 'private');
    if (want === screenBlocked) return;
    screenBlocked = want;
    VexBridge.setScreenshotsBlocked(want);
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
      const card = el('div', 'tabcard' + (tab.id === VexTabStore.activeId() ? ' active' : '')
        + (tab.asleep || tab.lazy ? ' asleep' : ''));
      if (group) card.style.borderColor = group.color;
      const shot = el('div', 'tabcard-shot');
      if (tab.snapshot) shot.style.backgroundImage = 'url("' + tab.snapshot + '")';
      card.appendChild(shot);

      const bar = el('div', 'tabcard-bar');
      bar.appendChild(favicon(tab, 'tabcard-icon'));
      bar.appendChild(el('span', 'tabcard-title', (group ? group.name + ' · ' : '')
        + (tab.title || VexSearch.prettyHost(tab.url) || 'New tab')));
      // Asleep is worth saying: it explains why the card looks faded, and that
      // nothing is lost — tapping it is instant.
      if (tab.lazy) bar.appendChild(el('span', 'tabcard-asleep', 'not loaded'));
      else if (tab.asleep) bar.appendChild(el('span', 'tabcard-asleep', 'asleep'));
      const close = el('button', { class: 'tabcard-x', 'aria-label': 'Close tab' });
      close.appendChild(icon('close'));
      close.onclick = async event => {
        event.stopPropagation();
        await closeTabWithUndo(tab);
      };
      bar.appendChild(close);
      card.appendChild(bar);

      card.onclick = async () => { closeTabGrid(); await VexTabStore.activate(tab.id); };
      VexGestures.longPress(card, () => tabActions(tab));
      // Thrown aside, it closes — with the same Undo the × offers.
      VexGestures.dismiss(card, () => closeTabWithUndo(tab));
      list.appendChild(card);
    }
  }

  function tabActions(tab) {
    const group = VexCollections.groups.of(tab.id);
    const live = !!(tab.url && tab.url !== 'about:blank');
    VexSheets.choose(tab.title || VexSearch.prettyHost(tab.url) || 'Tab', [
      { id: 'group', label: group ? 'Move to another group' : 'Put in a group' },
      group ? { id: 'ungroup', label: 'Take out of ' + group.name } : null,
      group ? { id: 'group-edit', label: group.name, note: 'Rename it, recolour it, or close the lot' } : null,
      // A blank tab has no address to bookmark, copy, draw or share.
      live ? { id: 'bookmark', label: 'Bookmark this tab' } : null,
      live ? { id: 'reading', label: 'Add to reading list' } : null,
      { id: 'close-others', label: 'Close other tabs' },
      live ? { id: 'copy', label: 'Copy link' } : null,
      live ? { id: 'qr', label: 'Show as QR code' } : null,
      live ? { id: 'share', label: 'Share' } : null
    ].filter(Boolean), async choice => {
      if (choice === 'group') {
        // This row replaces the sheet's contents with the group picker rather
        // than acting, so it has to return exactly true: anything else — and an
        // async handler's promise is anything else — closes the sheet, which
        // took the picker with it and left tab groups impossible to make.
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
        return true;
      }
      if (choice === 'group-edit') { groupActions(group); return true; }
      VexSheets.close();
      if (choice === 'ungroup') {
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

  /**
   * What you can do to a whole group. Reached from the long-press that put the
   * tab in it, which is where someone looks — and until this existed, a group
   * could be made and never renamed, recoloured or closed, because nothing in
   * the chrome reached those three.
   */
  function groupActions(group) {
    if (!group) return true;
    const inside = group.tabIds.filter(id => VexTabStore.get(id)).length;
    VexSheets.choose(group.name, [
      { id: 'rename', label: 'Rename it' },
      { id: 'colour', label: 'Change its colour' },
      { id: 'close', label: 'Close all ' + inside + (inside === 1 ? ' tab in it' : ' tabs in it'), danger: true }
    ], async choice => {
      if (choice === 'colour') {
        VexSheets.choose(group.name, VexCollections.groups.COLORS().map(colour => ({
          id: colour, label: colour.toUpperCase(), selected: colour === group.color
        })), async colour => {
          await VexCollections.groups.recolour(group.id, colour);
          VexSheets.close();
          renderTabGrid();
        });
        return true;
      }
      VexSheets.close();
      if (choice === 'rename') {
        const name = await prompt('Rename the group', 'A name for it', group.name);
        if (name) { await VexCollections.groups.rename(group.id, name); renderTabGrid(); }
      } else if (choice === 'close') {
        if (!(await confirm('Close ' + inside + (inside === 1 ? ' tab' : ' tabs') + ' in ' + group.name + '?'))) return;
        for (const id of group.tabIds.slice()) {
          const tab = VexTabStore.get(id);
          if (tab) await VexTabStore.close(id);
        }
        await VexCollections.groups.remove(group.id);
        renderTabGrid();
        renderToolbar();
        toast('Closed ' + group.name);
      }
    });
    return true;
  }

  // ── Find ─────────────────────────────────────────────────────────────────
  function openFind() {
    showToolbar();
    $('findbar').hidden = false;
    scheduleBounds();
    setTimeout(() => $('find-input').focus(), 40);
  }

  // Open the find bar with something already in it and the first match found —
  // which is what "find this on the page" means, rather than opening an empty box.
  function findOnPage(text) {
    const needle = String(text || '').trim();
    if (!needle) { openFind(); return; }
    openFind();
    const input = $('find-input');
    input.value = needle;
    const tab = VexTabStore.active();
    if (tab) VexBridge.find(tab.id, needle);
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
    $('qrshare-title').textContent = 'Scan to open';
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
          // The whole otpauth:// address goes in, so the code's digits, period
          // and algorithm are kept with its secret.
          VexPanels.addLogin({ host: otp.issuer || otp.account, username: otp.account, secret: text });
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
  // Hidden by hand, and left hidden until the page's media changes. Without
  // this the poller four seconds later decides a video is playing and brings the
  // bar straight back, which makes its close button look broken.
  let mediaDismissedFor = '';

  function setMediaBar(hidden) {
    const bar = $('mediabar');
    if (bar.hidden === hidden) return;
    bar.hidden = hidden;
    scheduleBounds();        // it is a flex item: the page moves to make room
  }

  async function refreshMediaBar() {
    if (!VexStore.get('vex.mediaBar', true)) { setMediaBar(true); return; }
    const tab = VexTabStore.active();
    if (!tab || !tab.url || tab.url === 'about:blank' || !$('omnibox').hidden) { setMediaBar(true); return; }
    // Dismissed for this page: it comes back when you go somewhere else.
    if (mediaDismissedFor && mediaDismissedFor === tab.url) { setMediaBar(true); return; }
    const state = await VexMedia.state(tab.id);
    const show = !!state.playing;
    setMediaBar(!show);
    if (show) {
      $('media-label').textContent = state.duration
        ? Math.floor(state.current / 60) + ':' + String(state.current % 60).padStart(2, '0')
          + ' / ' + Math.floor(state.duration / 60) + ':' + String(state.duration % 60).padStart(2, '0')
        : 'Playing';
    }
  }

  // ── Reading aloud ────────────────────────────────────────────────────────
  // The bar is drawn from VexSpeak's state and nothing else, so it cannot
  // disagree with what the engine is doing.
  function renderSpeakBar() {
    const bar = $('speakbar');
    const speak = VexSpeak.state;
    if (bar.hidden !== !speak.loaded) {
      bar.hidden = !speak.loaded;
      scheduleBounds();        // it is a flex item: the page moves to make room
    }
    if (!speak.loaded) return;
    $('speak-toggle').querySelector('use')
      .setAttribute('href', speak.speaking ? '#i-pause' : '#i-play');
    $('speak-toggle').setAttribute('aria-label', speak.speaking ? 'Pause' : 'Carry on');
    const total = speak.parts.length;
    $('speak-label').textContent = speak.speaking
      ? (speak.index + 1) + ' / ' + total
      : (speak.index > 0 ? 'Paused · ' + (speak.index + 1) + ' / ' + total : 'Read it again');
    const rate = VexSpeak.rate();
    $('speak-rate').textContent = (rate === 1 ? '1' : String(rate)) + '×';
  }

  async function readAloud() {
    // Already reading this page: the menu entry is a pause, not a restart.
    if (VexSpeak.state.loaded && VexSpeak.state.url === (VexTabStore.active() || {}).url) {
      await VexSpeak.toggle();
      return;
    }
    if (VexSpeak.state.loaded) await VexSpeak.stop();
    await VexSpeak.readPage();
  }

  // Voice and speed, in a sheet rather than a settings page: both are things
  // you change while listening, not things you set up once.
  function speakSettings() {
    const voices = VexSpeak.state.voices;
    VexSheets.choose('Reading voice', [{ id: '', label: 'The phone’s default', selected: !VexSpeak.voice() }]
      .concat(voices.map(entry => ({
        id: entry.name,
        label: entry.label || entry.name,
        note: entry.language || '',
        selected: entry.name === VexSpeak.voice()
      }))), async name => {
      await VexSpeak.setVoice(name);
      VexSheets.close();
      renderSpeakBar();
    });
    return true;
  }

  /**
   * Speed, brightness and sound for whatever is playing.
   *
   * All three existed in js/media.js and nothing in the chrome reached any of
   * them — the bar had play, ten seconds either way, pop out and dismiss. The
   * brightness is the one worth having: a site's own player caps how bright a
   * dark scene can get, and a CSS filter on the element does not care.
   */
  async function videoActions() {
    const tab = VexTabStore.active();
    if (!tab) return true;
    const state = await VexMedia.state(tab.id);
    VexSheets.choose('Video', [
      { id: 'speed', label: 'Speed', note: videoSpeed + '×' },
      { id: 'brightness', label: 'Brightness', note: Math.round(videoBrightness * 100) + '%' },
      { id: 'mute', label: state.muted ? 'Turn the sound on' : 'Mute it' },
      { id: 'pop', label: 'Pop it out', note: 'A small window over whatever you do next' },
      { id: 'download', label: 'Download it', note: 'The file, or the stream it is playing from' }
    ], async choice => {
      if (choice === 'speed') {
        VexSheets.choose('Speed', [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(rate => ({
          id: String(rate), label: rate + '×', selected: rate === videoSpeed
        })), async picked => {
          videoSpeed = Number(picked);
          await VexMedia.speed(tab.id, videoSpeed);
          VexSheets.close();
          refreshMediaBar();
        });
        return true;
      }
      if (choice === 'brightness') {
        VexSheets.choose('Brightness', [0.75, 1, 1.25, 1.5, 2, 2.5].map(amount => ({
          id: String(amount), label: Math.round(amount * 100) + '%', selected: amount === videoBrightness
        })), async picked => {
          videoBrightness = Number(picked);
          await VexMedia.brightness(tab.id, videoBrightness);
          VexSheets.close();
        });
        return true;
      }
      VexSheets.close();
      if (choice === 'mute') await VexMedia.mute(tab.id, !state.muted);
      else if (choice === 'pop') {
        try { await VexMedia.popOut(tab.id); } catch (error) { toast(error.message); }
      } else if (choice === 'download') await VexMedia.download(tab);
    });
    return true;
  }

  // Remembered for the session rather than stored: a speed you chose for one
  // video is not a setting you want applied to every video for ever.
  let videoSpeed = 1;
  let videoBrightness = 1;

  // ── Actions the sheets and panels call ───────────────────────────────────
  async function openUrl(input, options = {}) {
    const url = VexSearch.toUrl(input);
    if (!url) return;
    // Every road into a private tab passes the lock — "open in private tab"
    // on a link went straight past it, and the switcher then opened on the
    // private side because that was the tab in front.
    if (options.incognito && !(await unlockPrivate())) return;
    const tab = VexTabStore.active();
    const newTab = options.newTab || (!tab) || (VexStore.get('vex.linksInNewTab', false) && options.fromLink);
    if (newTab) {
      await VexTabStore.create(url, {
        incognito: options.incognito, background: options.background,
        fromApp: !!options.fromApp, opener: options.opener || (options.fromLink && tab ? tab.id : undefined)
      });
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
    // Already in a private tab you unlocked since you last came back to Vex:
    // a link opened from it is not a new way in.
    const active = VexTabStore.active();
    if (active && active.incognito && privateUnlockedAt) return true;
    const check = await VexBridge.authenticate('Private tabs', 'Unlock to open private browsing');
    if (!check.ok) { toast('Not unlocked'); return false; }
    privateUnlockedAt = Date.now();
    return true;
  }

  /**
   * Leaving Vex asks for the fingerprint again.
   *
   * The three minutes above are so that switching tabs is not a fingerprint
   * every time — not so that handing the phone to somebody opens private
   * browsing. The vault relocks when Vex goes to the background; this is the
   * same rule for the same reason.
   */
  /**
   * Coming back to Vex with a private tab in front asks again before showing
   * it. The lock relocked when you left; without this the page was simply
   * there on return, which is the one moment the lock exists for — the phone
   * handed to someone else, Vex opened from the recents list.
   */
  async function guardPrivateOnReturn() {
    if (!VexStore.get('vex.lockPrivate', false)) return true;
    const active = VexTabStore.active();
    const privateGrid = !$('tabgrid').hidden && tabGridScope === 'private';
    if (!(active && active.incognito) && !privateGrid) return true;
    cover(true);
    let ok = false;
    try { ok = await unlockPrivate(); } finally { cover(false); }
    if (ok) return true;
    if (privateGrid) { tabGridScope = 'normal'; renderTabGrid(); }
    if (active && active.incognito) {
      const normal = VexTabStore.normal()
        .sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0))[0];
      if (normal) await VexTabStore.activate(normal.id);
      else await VexTabStore.create('about:blank');
      renderToolbar();
    }
    applyPrivacyScreen();
    return false;
  }

  function relockPrivate() {
    privateUnlockedAt = 0;
    // And the private side of the switcher is not where somebody else comes back
    // to, either.
    if (tabGridScope === 'private') {
      tabGridScope = 'normal';
      if (!$('tabgrid').hidden) renderTabGrid();
      applyPrivacyScreen();
    }
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
      toast('Bookmarked', 4000, { label: 'Folder', run: () => VexPanels.pickFolder(VexCollections.bookmarks.get(tab.url), '', { stay: true }) });
    }
    VexSync.schedulePush();
    renderToolbar();
  }

  /**
   * The toolbar's star. On a page it is not yet keeping, it keeps it, and the
   * toast offers a folder. On one it already keeps, it says where and offers
   * to move or remove it. With no page in front it is the list.
   */
  async function starPage(tab) {
    if (!tab || !tab.url || tab.url === 'about:blank' || startVisible()) { VexPanels.bookmarks(); return; }
    const kept = VexCollections.bookmarks.get(tab.url);
    if (!kept) { await toggleBookmark(); return; }
    VexSheets.choose(kept.title || VexSearch.prettyHost(kept.url), [
      { id: 'folder', label: 'Move to folder', note: kept.folder ? 'In ' + kept.folder : 'In Unsorted' },
      { id: 'list', label: 'All bookmarks' },
      { id: 'remove', label: 'Remove the bookmark', danger: true }
    ], async choice => {
      VexSheets.close();
      if (choice === 'folder') VexPanels.pickFolder(kept, '', { stay: true });
      if (choice === 'list') VexPanels.bookmarks();
      if (choice === 'remove') {
        await VexCollections.bookmarks.remove(kept.url);
        VexSync.schedulePush();
        renderToolbar();
        toast('Bookmark removed', 4500, {
          label: 'Undo',
          run: async () => { await VexCollections.bookmarks.restore(kept); VexSync.schedulePush(); renderToolbar(); }
        });
      }
    }, 'Bookmarked');
  }

  /**
   * Close one tab and offer it back. Shutting a tab is one tap and the regret is
   * immediate, so the offer belongs in the toast rather than three taps away in
   * a menu. Nothing is offered for a private tab: those are never written to the
   * closed list, which is the point of them.
   */
  async function closeTabWithUndo(tab) {
    if (!tab) return;
    const name = tab.title || VexSearch.prettyHost(tab.url) || 'that tab';
    const worth = !tab.incognito && tab.url && tab.url !== 'about:blank';
    await VexTabStore.close(tab.id);
    renderTabGrid();
    renderToolbar();
    if (worth) toast('Closed ' + name, 4500, { label: 'Undo', run: () => reopenClosed() });
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
    // Already translated: the menu entry is the way back.
    if (VexTranslate.showing(tab.id)) {
      await VexTranslate.original(tab);
      toast('Showing the original');
      return;
    }
    const recent = VexStore.get('vex.translateTo', 'en');
    const onDevice = VexStore.get('vex.translateOnDevice', true) !== false;
    VexSheets.choose('Translate this page into',
      VexTools.LANGUAGES.map(([code, name]) => ({ id: code, label: name, selected: code === recent })),
      async language => {
        VexSheets.close();
        await VexStore.set('vex.translateTo', language);
        toast('Translating…', 1500);

        // On the phone first: it rewrites the page where it stands, it works
        // with no connection once the pair is downloaded, and nothing leaves.
        if (onDevice && VexBridge.isNative) {
          let result = await VexTranslate.page(tab, language);
          // Not on Wi-Fi and the pair is not here: ask, once, rather than
          // sending the page to a server the person chose not to use.
          if (!result.ok && result.needsWifi
            && await dialog({
              title: 'Translate', okLabel: 'Download now', cancelLabel: 'Not now',
              message: result.why + ' Download it now over mobile data? It is about 30 MB.'
            })) {
            toast('Downloading the language pair…', 3000);
            result = await VexTranslate.page(tab, language, { mobileData: true });
          }
          if (result.ok) {
            toast('Translated ' + result.nodes + ' pieces of text, on the phone', 4000,
              { label: 'Original', run: () => VexTranslate.original(tab) });
            return;
          }
          // "Already in that language" is an answer, not a reason to send the
          // page to a worker.
          if (/already in that language/i.test(result.why)) { toast(result.why, 3000); return; }
          toast(result.why, 4500);
        }

        try {
          const result = await VexTools.translate(tab, language);
          if (result.via === 'web') {
            toast('No assistant configured — using the web translator', 3000);
            openUrl(result.url);
            return;
          }
          VexViews.openAI();
        } catch (error) { toast(error.message, 3500); }
      }, onDevice ? 'On the phone, with nothing sent anywhere' : 'Through your own assistant');
  }

  /**
   * Everything about one site, gone: its visits, the text of its pages in the
   * Recall index, its cookies and its storage. Four stores and a WebView call,
   * which is why it is one offer rather than four.
   *
   * `after` is what to redraw — the panel this was asked from.
   */
  async function forgetSite(host, after) {
    if (!host) return;
    if (!(await confirm('Forget everything Vex knows about ' + host + '? '
      + 'Its visits, its page text, its cookies and its storage.'))) return;
    const gone = await VexHistory.forgetSite(host);
    await VexBridge.clearSiteData(host, 'https://' + host);
    toast('Forgot ' + host + ' · ' + gone.visits + ' visits, ' + gone.pages + ' pages of text', 4000);
    if (typeof after === 'function') after();
  }

  // ── Logins ───────────────────────────────────────────────────────────────
  // Offered, never automatic — and the offer itself costs nothing. Landing on
  // a page you have a login for must not put a fingerprint prompt in your way;
  // it shows a line you can ignore, and only a tap on it opens the vault.
  async function offerAutofill(tab, { manual = false } = {}) {
    const host = VexSearch.prettyHost(tab.url);
    if (!manual && !VexVault.hasFor(host)) return;
    if (!manual && !(await VexVault.pageHasLoginForm(tab.id))) return;
    if (!manual && VexVault.locked()) {
      toast('Saved login for ' + host, 6000, {
        label: 'Fill it',
        run: () => offerAutofill(tab, { manual: true })
      });
      return;
    }
    if (!(await VexVault.unlock('Fill a saved login'))) return;
    const matches = VexVault.forHost(host);
    if (!matches.length) { if (manual) toast('Nothing saved for ' + host); return; }
    VexSheets.choose('Fill a login', matches.map(entry => ({
      id: entry.id, label: entry.username || entry.host, note: entry.host
    })), async entryId => {
      VexSheets.close();
      const entry = matches.find(candidate => candidate.id === entryId);
      const said = await VexVault.fill(tab.id, entry);
      if (said === 'wrong-host') { toast('The page changed — nothing was filled'); return; }
      toast(said === 'filled' ? 'Filled — you press the button' : 'No login form on this page');
      if (entry.secret) {
        const code = await VexVault.totp(entry.secret, VexVault.codeOptions(entry));
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
  /**
   * Save text the chrome made — a backup, an export — as a file in Downloads.
   *
   * On a phone the bytes go to native: an <a download> in the chrome's own
   * WebView has no download handler behind it, so Backup, the bookmarks export
   * and the notes export all said "Saved to Downloads" and saved nothing. The
   * link is the development fallback, where a desktop browser does handle it.
   */
  async function downloadText(filename, text, mimeType = 'text/plain') {
    if (VexBridge.isNative) {
      try {
        const saved = await VexBridge.writeToDownloads(filename, mimeType, utf8Base64(text));
        const localUri = (saved && saved.localUri) || '';
        toast('Saved ' + filename + ' to Downloads', 4500, localUri ? {
          label: 'Open',
          run: () => VexBridge.openDownload({ localUri }).catch(error => toast(error.message || 'Nothing opens that'))
        } : undefined);
        return true;
      } catch (error) {
        toast((error && error.message) || 'It could not be saved', 4500);
        return false;
      }
    }
    const blob = new Blob([text], { type: mimeType });
    const link = el('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.appendChild(link);
    link.click();
    setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 2000);
    toast('Saved to Downloads');
    return true;
  }

  // btoa takes Latin-1 only, and a backup is full of everything else — and
  // String.fromCharCode(...bytes) on a few megabytes overflows the stack — so
  // the bytes are encoded in slices.
  function utf8Base64(text) {
    const bytes = new TextEncoder().encode(String(text));
    let binary = '';
    for (let at = 0; at < bytes.length; at += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(at, at + 0x8000));
    }
    return btoa(binary);
  }

  function pickTextFile(onText, accept = '.html,.htm,text/html') {
    const input = el('input', { type: 'file', accept, style: 'display:none' });
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

    BUTTONS, DEFAULT_BUTTONS, LAYOUTS, buttonConfig, goHome,
    toast, cover, pushBounds, scheduleBounds, applyToolbarPosition, onPageScroll, setFullscreen,
    applyPrivacyScreen,
    renderToolbar, renderProgress, renderTabGrid, renderTabStrip, renderSuggestions, refreshMediaBar,
    renderSpeakBar, readAloud, speakSettings,
    openOmnibox, closeOmnibox, dictateIntoOmnibox, openTabGrid, closeTabGrid, openFind, closeFind, findOnPage,
    openUrl, newTab, copy, toggleBookmark, starPage, reopenClosed, closeTabWithUndo, setStartVisible, startVisible,
    showQr, closeQr, openScanner, closeScanner, translatePage, tabHistory,
    offerAutofill, saveLoginFromPage, downloadText, pickTextFile, unlockPrivate, relockPrivate, guardPrivateOnReturn, forgetSite,

    prompt(title, message, value = '') { return dialog({ title, message, input: value }); },
    confirm(message, title = 'Vex') { return dialog({ title, message, okLabel: 'Yes', cancelLabel: 'No' }).then(Boolean); },
    // Something to read, with one thing you might do about it: a result to copy,
    // a piece of text to keep. Yes/No is the wrong pair of words for that.
    offer(message, okLabel, title = 'Vex') {
      return dialog({ title, message, okLabel, cancelLabel: 'Close' }).then(Boolean);
    },
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
      $('tb-reader').addEventListener('click', event => {
        event.stopPropagation();
        VexViews.openReader();
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
      $('omni-voice').onclick = () => dictateIntoOmnibox();
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
      $('tg-normal').onclick = () => { tabGridScope = 'normal'; renderTabGrid(); applyPrivacyScreen(); };
      $('tg-private').onclick = async () => {
        if (!(await unlockPrivate())) return;
        tabGridScope = 'private';
        renderTabGrid();
        applyPrivacyScreen();
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
      $('media-label').onclick = () => videoActions();
      $('media-close').onclick = () => {
        const tab = VexTabStore.active();
        mediaDismissedFor = tab ? tab.url : '';
        setMediaBar(true);
      };

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
      $('reader-type').onclick = () => VexViews.readerLook();
      $('reader-speak').onclick = () => VexViews.speakArticle();
      $('reader-body').addEventListener('scroll', () => VexViews.onReaderScroll(), { passive: true });

      // Panels
      $('panel-back').onclick = () => VexPanels.back();

      VexStart.bind();
      applyToolbarPosition();

      $('tabstrip-new').onclick = () => newTab();

      window.addEventListener('resize', () => { scheduleBounds(); renderTabStrip(); });
      window.addEventListener('orientationchange', () => { scheduleBounds(); renderTabStrip(); });
      if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleBounds);

      VexTabStore.onChange(() => { renderToolbar(); renderProgress(); applyPrivacyScreen(); });

      // Reading aloud: the bar's buttons, and a redraw whenever the engine
      // moves on a line.
      $('speak-toggle').onclick = () => VexSpeak.toggle();
      $('speak-prev').onclick = () => VexSpeak.skip(-1);
      $('speak-next').onclick = () => VexSpeak.skip(1);
      $('speak-rate').onclick = () => VexSpeak.cycleRate();
      $('speak-close').onclick = () => VexSpeak.stop();
      VexSpeak.onChange(renderSpeakBar);

      clearInterval(mediaTimer);
      mediaTimer = setInterval(refreshMediaBar, 4000);
    },

    // Android's back gesture, innermost thing first.
    async handleBack() {
      if (!$('dialog').hidden) { $('dialog-cancel').click(); return true; }
      if (!$('scan').hidden) { closeScanner(); return true; }
      // A PDF is read over everything else, so Back closes it before anything
      // underneath — and before the page that never navigated anywhere.
      if (typeof VexPdf !== 'undefined' && VexPdf.isOpen()) return VexPdf.back();
      if (!$('qrshare').hidden) { closeQr(); return true; }
      if (!$('omnibox').hidden) { closeOmnibox(); return true; }
      if (VexSheets.isOpen()) { VexSheets.close(); return true; }
      if (VexViews.readerOpen()) { VexViews.closeReader(); return true; }
      if (VexPanels.isOpen()) { VexPanels.back(); return true; }
      if (!$('tabgrid').hidden) { closeTabGrid(); return true; }
      if (!$('findbar').hidden) { closeFind(); return true; }
      const tab = VexTabStore.active();
      if (tab && tab.canGoBack) { await VexBridge.back(tab.id); return true; }
      // Out of history. Any tab used to be closed here, and since a restored
      // tab starts with no history at all, Back closed the tabs you had kept
      // open. Now only a tab that came from somewhere goes back there.
      if (tab && tab.openerId && VexTabStore.get(tab.openerId)) {
        const opener = tab.openerId;
        await VexTabStore.close(tab.id);
        await VexTabStore.activate(opener);
        return true;
      }
      if (tab && tab.fromApp && VexTabStore.all().length > 1) {
        // Back to the app that sent the link, without the tab it left behind.
        await VexTabStore.close(tab.id);
        return false;
      }
      return false;      // let Android put the app in the background
    }
  };
})();

if (typeof window !== 'undefined') window.VexUI = VexUI;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexUI };
