// === Vex Mobile — bottom sheets ===
//
// One element, four sheets: the menu, the site sheet (tap the icon in the URL
// pill), the long-press menu on a link or image, and a generic picker. Only
// one can be up at a time, and a phone's bottom sheet is the mobile answer to
// the desktop's right-click menu — the same choices, where your thumb is.
//
// The menu is not a fixed list. Samsung lets you rearrange yours, so this one
// is built from vex.menuOrder / vex.menuHidden, which the settings screen
// edits. ACTIONS is the catalogue; the order is yours.

const VexSheets = (() => {
  const { $, el, icon, clear } = VexDom;
  let open = false;

  function shell() { return $('sheet'); }

  function reset(title, subtitle) {
    const titleEl = $('sheet-title');
    const subEl = $('sheet-sub');
    titleEl.hidden = !title;
    titleEl.textContent = title || '';
    subEl.hidden = !subtitle;
    subEl.textContent = subtitle || '';
    clear($('sheet-quick')).hidden = true;
    clear($('sheet-list'));
  }

  // The page is a native view drawn ABOVE every pixel of this WebView, so a
  // sheet that does not hide it is drawn underneath it: a menu you cannot see
  // and a scrim you cannot tap. Every other full-screen overlay in the chrome
  // refcounts the same cover; this one was missing it.
  function show() {
    if (open) return;
    shell().hidden = false;
    open = true;
    VexUI.cover(true);
  }

  function close() {
    if (!open) return;
    shell().hidden = true;
    open = false;
    VexUI.cover(false);
  }

  // A row: icon, label, optional note, and either a switch or a value.
  function row({ icon: iconName, label, note, toggle, value, danger, run, reserveIcon }) {
    const node = el('div', 'sheet-row' + (danger ? ' danger' : ''));
    if (iconName) {
      const wrap = el('span', 'row-icon');
      wrap.appendChild(icon(iconName));
      node.appendChild(wrap);
    } else if (reserveIcon) {
      // A group where only one row is ticked keeps the column, so the labels
      // stay in a line instead of the chosen one stepping to the right.
      node.appendChild(el('span', 'row-icon'));
    }
    const text = el('span', 'row-label');
    text.appendChild(document.createTextNode(label));
    if (note) text.appendChild(el('span', 'row-note', note));
    node.appendChild(text);
    if (toggle !== undefined) node.appendChild(el('span', 'switch' + (toggle ? ' on' : '')));
    else if (value) node.appendChild(el('span', 'row-value', value));
    if (run) {
      // Exactly `true` keeps the sheet up, and it means one thing: this row
      // replaced the sheet's contents. Anything else — including the promise
      // an async handler returns, which is truthy — closes it.
      node.onclick = async () => {
        const keep = await run(node);
        if (keep !== true) close();
      };
    }
    return node;
  }

  function quick(buttons) {
    const bar = $('sheet-quick');
    bar.hidden = false;
    for (const button of buttons) {
      const node = el('button', 'quick' + (button.on ? ' on' : ''));
      node.setAttribute('aria-label', button.label);
      node.appendChild(icon(button.icon));
      node.onclick = async () => {
        const keep = await button.run(node);
        if (keep !== true) close();
      };
      bar.appendChild(node);
    }
  }

  // ── The menu's catalogue ─────────────────────────────────────────────────
  // id, icon, label, when it applies, and what it does. The order and what is
  // hidden come from settings; everything else is here.
  const ACTIONS = {
    'new-tab': { icon: 'plus', label: 'New tab', run: () => VexUI.newTab() },
    'new-private': { icon: 'private', label: 'New private tab', run: () => VexUI.newTab({ incognito: true }) },
    assistant: {
      icon: 'sparkle', label: 'Ask the assistant',
      note: tab => (tab ? 'About ' + VexSearch.prettyHost(tab.url) : 'Chat'),
      run: () => VexViews.openAI()
    },
    reader: { icon: 'book', label: 'Reader', needsPage: true, run: () => VexViews.openReader() },
    'read-aloud': {
      icon: 'speaker', label: 'Read aloud', needsPage: true,
      note: () => (VexSpeak.state.loaded
        ? (VexSpeak.state.speaking ? 'Pause' : 'Carry on')
        : 'The article, in the phone’s voice'),
      run: () => VexUI.readAloud()
    },
    'read-voice': {
      icon: 'speaker', label: 'Reading voice and speed',
      note: () => {
        const rate = VexSpeak.rate();
        return (rate === 1 ? 'Normal speed' : rate + '× speed');
      },
      run: () => VexUI.speakSettings()
    },
    translate: { icon: 'translate', label: 'Translate page', needsPage: true, run: () => VexUI.translatePage() },
    find: { icon: 'find', label: 'Find in page', needsPage: true, run: () => VexUI.openFind() },
    site: {
      icon: 'shield', label: 'This site', needsPage: true,
      note: tab => VexSiteRules.describe(VexSearch.prettyHost(tab.url)),
      run: tab => VexSheets.site(VexSearch.prettyHost(tab.url))
    },
    bookmarks: { icon: 'star', label: 'Bookmarks', run: () => VexPanels.bookmarks() },
    'reading-list': {
      icon: 'list', label: 'Reading list',
      note: () => { const count = VexCollections.reading.unread().length; return count ? count + ' unread' : null; },
      run: () => VexPanels.readingList()
    },
    'add-reading': {
      icon: 'list', label: 'Add to reading list', needsPage: true,
      run: async tab => {
        await VexCollections.reading.add({ url: tab.url, title: tab.title, icon: tab.icon });
        VexUI.toast('Saved for later');
        VexSync.schedulePush();
      }
    },
    history: { icon: 'history', label: 'History', run: () => VexPanels.history() },
    recall: { icon: 'search', label: 'Search what you read', run: () => VexPanels.recall() },
    downloads: { icon: 'download', label: 'Downloads', run: () => VexPanels.downloads() },
    'saved-pages': { icon: 'save', label: 'Saved pages', run: () => VexPanels.savedPages() },
    'save-page': {
      icon: 'save', label: 'Save page for offline', needsPage: true,
      run: async tab => {
        VexUI.toast('Saving…', 1200);
        try {
          await VexTools.savePage(tab);
          VexUI.toast('Saved — it opens with no connection', 3000, { label: 'Open', run: () => VexPanels.savedPages() });
        } catch (error) { VexUI.toast(error.message); }
      }
    },
    sessions: { icon: 'layers', label: 'Sessions', run: () => VexPanels.sessions() },
    notes: {
      icon: 'text', label: 'Notes',
      note: () => { const count = VexStore.get('vex.noteCount', 0); return count ? count + ' kept' : null; },
      run: () => VexPanels.notes()
    },
    'remind-me': {
      icon: 'history', label: 'Remind me about this', needsPage: true,
      run: tab => VexPanels.addReminder(tab)
    },
    reminders: { icon: 'history', label: 'Reminders', run: () => VexPanels.reminders() },
    agent: {
      icon: 'sparkle', label: 'Let the assistant do it',
      note: 'Close tabs, search, fill things in',
      run: () => VexViews.openAI('agent')
    },
    library: { icon: 'grid', label: 'Everything Vex can do', run: () => VexPanels.library() },
    passwords: { icon: 'key', label: 'Passwords and 2FA', run: () => VexPanels.passwords() },
    fill: {
      icon: 'key', label: 'Fill a saved login', needsPage: true,
      when: tab => VexVault.hasFor(VexSearch.prettyHost(tab.url)),
      run: tab => VexUI.offerAutofill(tab, { manual: true })
    },
    'fill-details': {
      icon: 'text', label: 'Fill in my details', needsPage: true,
      when: () => VexVault.hasProfile(),
      run: async tab => {
        const filled = await VexVault.fillProfile(tab.id);
        VexUI.toast(filled ? 'Filled ' + filled + ' fields' : 'Nothing on this page matched');
      }
    },
    'save-login': {
      icon: 'key', label: 'Save this login', needsPage: true,
      run: tab => VexUI.saveLoginFromPage(tab)
    },
    print: { icon: 'print', label: 'Print or save as PDF', needsPage: true, run: tab => VexBridge.print(tab.id) },
    capture: {
      icon: 'camera', label: 'Screenshot the page', needsPage: true,
      run: async tab => {
        try { await VexTools.capture(tab, { full: true }); }
        catch (error) { VexUI.toast(error.message); }
      }
    },
    'qr-share': { icon: 'qr', label: 'Show as QR code', needsPage: true, run: tab => VexUI.showQr(tab.url, tab.title) },
    'add-home': {
      icon: 'home', label: 'Add to home screen', needsPage: true,
      run: async tab => {
        try { await VexTools.addToHomeScreen(tab); VexUI.toast('Ask your launcher to place it'); }
        catch (error) { VexUI.toast(error.message); }
      }
    },
    desktop: {
      icon: 'desktop', label: 'Desktop site', needsPage: true,
      toggle: tab => !!tab.desktopMode,
      run: async (tab, node) => {
        const host = VexSearch.prettyHost(tab.url);
        const next = !tab.desktopMode;
        node.querySelector('.switch').classList.toggle('on', next);
        await VexSiteRules.set(host, 'desktop', next ? true : null);
        await VexBridge.setDesktopMode(tab.id, next);
        tab.desktopMode = next;
        return true;
      }
    },
    copy: { icon: 'copy', label: 'Copy link', needsPage: true, run: tab => VexUI.copy(tab.url) },
    share: { icon: 'share', label: 'Share', needsPage: true, run: tab => VexBridge.share(tab.url, tab.title) },
    reopen: { icon: 'history', label: 'Reopen closed tab', run: () => VexUI.reopenClosed() },
    settings: { icon: 'settings', label: 'Settings', run: () => VexPanels.settings() }
  };

  const DEFAULT_ORDER = [
    'new-tab', 'new-private', 'assistant', 'agent', 'reader', 'read-aloud', 'translate', 'find', 'site',
    'add-reading', 'reading-list', 'bookmarks', 'history', 'recall', 'downloads',
    'save-page', 'saved-pages', 'notes', 'remind-me', 'reminders', 'sessions',
    'fill', 'fill-details', 'save-login', 'passwords',
    'print', 'capture', 'qr-share', 'add-home', 'desktop', 'copy', 'share',
    'reopen', 'read-voice', 'library', 'settings'
  ];

  function menuOrder() {
    const stored = VexStore.get('vex.menuOrder', null);
    const order = Array.isArray(stored) && stored.length
      ? stored.filter(entry => ACTIONS[entry])
      : DEFAULT_ORDER.slice();
    // Anything added in a later version appears at the end rather than being
    // invisible to someone who once rearranged their menu.
    for (const entry of DEFAULT_ORDER) if (!order.includes(entry)) order.push(entry);
    return order;
  }

  function hidden() {
    const stored = VexStore.get('vex.menuHidden', []);
    return new Set(Array.isArray(stored) ? stored : []);
  }

  return {
    ACTIONS, DEFAULT_ORDER, menuOrder, hidden,
    close,
    isOpen() { return open; },

    // ── The main menu ──────────────────────────────────────────────────────
    menu() {
      const tab = VexTabStore.active();
      const live = !!(tab && tab.url && tab.url !== 'about:blank');
      const host = live ? VexSearch.prettyHost(tab.url) : '';
      const starred = live && VexCollections.bookmarks.has(tab.url);
      reset(null, live ? host : null);

      quick([
        { icon: 'forward', label: 'Forward', run: () => { if (tab) VexBridge.forward(tab.id); } },
        { icon: 'reload', label: 'Reload', run: () => { if (tab) VexBridge.reload(tab.id); } },
        { icon: 'star', label: starred ? 'Remove bookmark' : 'Bookmark', on: starred, run: () => VexUI.toggleBookmark() },
        { icon: 'share', label: 'Share', run: () => { if (live) VexBridge.share(tab.url, tab.title); } }
      ]);

      const list = $('sheet-list');
      const skip = hidden();
      for (const id of menuOrder()) {
        if (skip.has(id)) continue;
        const action = ACTIONS[id];
        if (!action) continue;
        if (action.needsPage && !live) continue;
        if (action.when && !action.when(tab)) continue;
        list.appendChild(row({
          icon: action.icon,
          label: action.label,
          note: typeof action.note === 'function' ? action.note(tab) : action.note,
          toggle: action.toggle ? action.toggle(tab) : undefined,
          run: node => action.run(tab, node)
        }));
      }
      show();
      return true;
    },

    // ── One site ───────────────────────────────────────────────────────────
    site(host) {
      if (!host) return;
      const rules = VexSiteRules.for(host);
      const tab = VexTabStore.active();
      reset(host, VexSiteRules.describe(host));

      const list = $('sheet-list');
      const flip = async (key, next) => {
        await VexSiteRules.set(host, key, next);
        if (tab) await VexSiteRules.applyTo(tab);
        VexSync.schedulePush();
        return true;
      };
      const toggleRow = (config, key, after) => row(Object.assign({}, config, {
        run: async node => {
          const current = VexSiteRules.for(host)[key];
          const next = config.tristate ? (current !== true ? true : null) : !current;
          node.querySelector('.switch').classList.toggle('on', next === true);
          await flip(key, next);
          if (after && tab) await after();
          return true;
        }
      }));

      list.appendChild(toggleRow(
        { icon: 'shield', label: 'Block ads and trackers', toggle: rules.blocking },
        'blocking', () => VexBridge.reload(tab.id)));
      list.appendChild(toggleRow(
        { icon: 'text', label: 'JavaScript', note: 'Takes effect on reload', toggle: rules.scripts },
        'scripts', () => VexBridge.reload(tab.id)));
      list.appendChild(toggleRow({ icon: 'image', label: 'Images', toggle: rules.images }, 'images'));
      list.appendChild(toggleRow(
        { icon: 'desktop', label: 'Desktop site', toggle: rules.desktop === true, tristate: true }, 'desktop'));
      list.appendChild(toggleRow(
        { icon: 'palette', label: 'Force dark', toggle: rules.dark === true, tristate: true }, 'dark'));
      list.appendChild(toggleRow({
        icon: 'video', label: 'Let it play on its own',
        note: 'Vex asks for a tap before any video starts. Some sites are the reason you went.',
        toggle: rules.autoplay === true, tristate: true
      }, 'autoplay'));

      list.appendChild(row({
        icon: 'text', label: 'Text size', value: Math.round(rules.zoom * 100) + '%',
        run: async node => {
          const steps = [0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];
          const current = VexSiteRules.for(host).zoom;
          const next = steps[(steps.indexOf(current) + 1) % steps.length] || 1;
          node.querySelector('.row-value').textContent = Math.round(next * 100) + '%';
          await VexSiteRules.set(host, 'zoom', next);
          if (tab) await VexBridge.setZoom(tab.id, next);
          return true;
        }
      }));

      list.appendChild(row({
        icon: 'lock-closed', label: 'Permissions',
        note: VexPermissions.describe(host),
        run: () => VexSheets.permissions(host)
      }));

      list.appendChild(row({
        icon: 'trash', label: 'Clear this site’s data', note: 'Cookies and storage for ' + host,
        run: async () => {
          await VexBridge.clearSiteData(host, 'https://' + host);
          if (tab) await VexBridge.reload(tab.id);
          VexUI.toast('Cleared ' + host);
        }
      }));

      if (VexSiteRules.customised(host).length) {
        list.appendChild(row({
          icon: 'trash', label: 'Reset this site', danger: true,
          run: async () => {
            await VexSiteRules.reset(host);
            if (tab) { await VexSiteRules.applyTo(tab); await VexBridge.reload(tab.id); }
            VexUI.toast('Reset ' + host);
          }
        }));
      }
      show();
      return true;
    },

    // ── What one site may ask for ──────────────────────────────────────────
    permissions(host) {
      reset(host, 'What this site may use');
      const list = $('sheet-list');
      for (const [id, entry] of Object.entries(VexPermissions.KINDS)) {
        const state = VexPermissions.get(host, id);
        list.appendChild(row({
          icon: entry.icon,
          label: entry.label,
          note: state === 'allow' ? 'Allowed' : state === 'block' ? 'Blocked' : 'Ask every time',
          value: state === 'allow' ? 'Allow' : state === 'block' ? 'Block' : 'Ask',
          run: async node => {
            const next = state === 'ask' ? 'allow' : state === 'allow' ? 'block' : 'ask';
            await VexPermissions.set(host, id, next);
            if (next === 'allow') await VexBridge.requestPermission(id);
            VexSheets.permissions(host);
            return true;
          }
        }));
      }
      show();
      return true;
    },

    // ── Long-press on a link or an image ───────────────────────────────────
    link({ link, image }) {
      const target = link || image;
      if (!target) return;
      reset(link ? 'Link' : 'Image', target);
      const list = $('sheet-list');
      const tab = VexTabStore.active();

      if (link) {
        list.appendChild(row({ icon: 'plus', label: 'Open in new tab', run: () => VexUI.openUrl(link, { newTab: true, background: true }) }));
        list.appendChild(row({ icon: 'private', label: 'Open in private tab', run: () => VexUI.openUrl(link, { newTab: true, incognito: true }) }));
        list.appendChild(row({ icon: 'list', label: 'Add to reading list', run: async () => {
          await VexCollections.reading.add({ url: link, title: link });
          VexUI.toast('Saved for later');
        } }));
        list.appendChild(row({ icon: 'copy', label: 'Copy link', run: () => VexUI.copy(link) }));
        list.appendChild(row({ icon: 'share', label: 'Share link', run: () => VexBridge.share(link, link) }));
        list.appendChild(row({ icon: 'qr', label: 'Show as QR code', run: () => VexUI.showQr(link, 'Link') }));
        list.appendChild(row({ icon: 'download', label: 'Download link', run: () => tab && VexBridge.download(tab.id, link) }));
      }
      if (image) {
        list.appendChild(row({ icon: 'image', label: 'Open image', run: () => VexUI.openUrl(image, { newTab: true }) }));
        list.appendChild(row({ icon: 'download', label: 'Save image', run: () => tab && VexBridge.download(tab.id, image) }));
        list.appendChild(row({ icon: 'copy', label: 'Copy image address', run: () => VexUI.copy(image) }));
      }
      show();
      return true;
    },

    // ── A generic picker ───────────────────────────────────────────────────
    choose(title, options, onPick, subtitle) {
      reset(title, subtitle);
      const list = $('sheet-list');
      for (const option of options) {
        list.appendChild(row({
          icon: option.selected ? 'check' : null,
          reserveIcon: true,
          label: option.label,
          note: option.note,
          run: () => onPick(option.id)
        }));
      }
      show();
      return true;
    },

    row
  };
})();

if (typeof window !== 'undefined') window.VexSheets = VexSheets;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSheets };
