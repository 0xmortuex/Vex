// === Vex Mobile — full-screen panels ===
//
// History, bookmarks, downloads and the settings tree share one shell
// (#panel): a title, an optional search field, an optional header action, and
// a body. Each panel owns what goes in the body and what Back means.
//
// Records are the desktop app's shapes — 'vex.history' entries are
// { url, title, at, icon } — so a future sync can carry them across without
// a translation layer.

const VexPanels = (() => {
  const { $, el, icon, clear, favicon, when, bytes } = VexDom;
  let stack = [];          // panel names, so Back walks settings → appearance

  function openShell(name, title, { search, action } = {}) {
    $('panel-title').textContent = title;
    const searchWrap = $('panel-search');
    searchWrap.hidden = !search;
    if (search) {
      const input = $('panel-search-input');
      input.value = search.value || '';
      input.placeholder = search.placeholder || 'Search';
      input.oninput = () => search.onInput(input.value);
    }
    const actionButton = $('panel-action');
    actionButton.hidden = !action;
    if (action) {
      actionButton.textContent = action.label;
      actionButton.onclick = action.run;
    }
    clear($('panel-body'));
    if (stack[stack.length - 1] !== name) stack.push(name);
    if ($('panel').hidden) {
      $('panel').hidden = false;
      VexUI.cover(true);
    }
    return $('panel-body');
  }

  function close() {
    stack = [];
    if ($('panel').hidden) return;
    $('panel').hidden = true;
    $('panel-search').hidden = true;
    VexUI.cover(false);
  }

  // Back inside the panel: settings → appearance → back returns to settings.
  function back() {
    stack.pop();
    const previous = stack.pop();
    if (!previous) { close(); return; }
    const reopen = {
      history: () => VexPanels.history(),
      bookmarks: () => VexPanels.bookmarks(),
      downloads: () => VexPanels.downloads(),
      settings: () => VexPanels.settings(),
      appearance: () => VexPanels.appearance(),
      assistant: () => VexPanels.assistantSettings(),
      privacy: () => VexPanels.privacy(),
      ai: () => VexViews.openAI()
    }[previous];
    if (reopen) reopen(); else close();
  }

  function listRow(entry, { onOpen, onRemove, sub }) {
    const node = el('div', 'list-row');
    node.appendChild(favicon(entry));
    const lines = el('div', 'lines');
    lines.appendChild(el('span', 't', entry.title || VexSearch.prettyHost(entry.url) || entry.url));
    lines.appendChild(el('span', 'u', sub ? sub(entry) : entry.url));
    node.appendChild(lines);
    node.onclick = () => onOpen(entry);
    if (onRemove) {
      const remove = el('button', { class: 'x', 'aria-label': 'Remove' });
      remove.appendChild(icon('close'));
      remove.onclick = event => { event.stopPropagation(); onRemove(entry); };
      node.appendChild(remove);
    }
    VexGestures.longPress(node, () => VexSheets.link({ link: entry.url }));
    return node;
  }

  function empty(text) {
    return el('div', 'list-empty', text);
  }

  function toggleRow(label, note, value, onFlip) {
    return VexSheets.row({ label, note, toggle: value, run: async node => {
      const next = !node.querySelector('.switch').classList.contains('on');
      node.querySelector('.switch').classList.toggle('on', next);
      await onFlip(next);
      return true;
    } });
  }

  function valueRow(label, note, value, run) {
    return VexSheets.row({ label, note, value, run: async () => { await run(); return true; } });
  }

  function heading(text) { return el('div', 'list-head', text); }

  return {
    close,
    back,
    isOpen() { return !$('panel').hidden; },
    markOpen(name) { if (stack[stack.length - 1] !== name) stack.push(name); },

    // ── History ────────────────────────────────────────────────────────────
    history(query = '') {
      const all = VexStore.get('vex.history', []);
      const needle = query.trim().toLowerCase();
      const entries = needle
        ? all.filter(entry => (entry.url + ' ' + (entry.title || '')).toLowerCase().includes(needle))
        : all;

      const body = openShell('history', 'History', {
        search: { value: query, placeholder: 'Search history', onInput: value => this.history(value) },
        action: {
          label: 'Clear',
          run: async () => { await VexStore.set('vex.history', []); this.history(); VexUI.toast('History cleared'); }
        }
      });

      if (!entries.length) {
        body.appendChild(empty(needle ? 'Nothing matches “' + query + '”.' : 'Pages you visit show up here.'));
        return;
      }

      let lastDay = '';
      for (const entry of entries.slice(0, 500)) {
        const day = new Date(entry.at || 0).toDateString();
        if (day !== lastDay) {
          lastDay = day;
          const today = new Date().toDateString();
          const yesterday = new Date(Date.now() - 86400000).toDateString();
          body.appendChild(heading(day === today ? 'Today' : day === yesterday ? 'Yesterday' : day));
        }
        body.appendChild(listRow(entry, {
          sub: item => VexSearch.prettyHost(item.url) + ' · ' + when(item.at),
          onOpen: item => { close(); VexUI.openUrl(item.url); },
          onRemove: async item => {
            await VexStore.set('vex.history', VexStore.get('vex.history', [])
              .filter(other => !(other.url === item.url && other.at === item.at)));
            this.history(query);
          }
        }));
      }
    },

    // ── Bookmarks ──────────────────────────────────────────────────────────
    bookmarks(query = '') {
      const all = VexStore.get('vex.bookmarks', []);
      const needle = query.trim().toLowerCase();
      const entries = needle
        ? all.filter(entry => (entry.url + ' ' + (entry.title || '')).toLowerCase().includes(needle))
        : all;

      const body = openShell('bookmarks', 'Bookmarks', {
        search: { value: query, placeholder: 'Search bookmarks', onInput: value => this.bookmarks(value) }
      });
      if (!entries.length) {
        body.appendChild(empty(needle ? 'Nothing matches “' + query + '”.'
          : 'Star a page from the menu and it will be here.'));
        return;
      }
      for (const entry of entries) {
        body.appendChild(listRow(entry, {
          sub: item => VexSearch.prettyHost(item.url),
          onOpen: item => { close(); VexUI.openUrl(item.url); },
          onRemove: async item => {
            await VexStore.set('vex.bookmarks', VexStore.get('vex.bookmarks', []).filter(other => other.url !== item.url));
            this.bookmarks(query);
          }
        }));
      }
    },

    // ── Downloads ──────────────────────────────────────────────────────────
    downloads() {
      const entries = VexStore.get('vex.downloads', []);
      const body = openShell('downloads', 'Downloads', {
        action: entries.length ? {
          label: 'Clear',
          run: async () => { await VexStore.set('vex.downloads', []); this.downloads(); }
        } : null
      });
      if (!entries.length) {
        body.appendChild(empty('Files you download land in the phone’s Downloads folder, and are listed here.'));
        return;
      }
      for (const entry of entries) {
        body.appendChild(listRow({ url: entry.url, title: entry.filename || entry.url }, {
          sub: () => [VexSearch.prettyHost(entry.url), bytes(entry.size), when(entry.at)].filter(Boolean).join(' · '),
          onOpen: () => { close(); VexUI.openUrl(entry.url); },
          onRemove: async () => {
            await VexStore.set('vex.downloads', VexStore.get('vex.downloads', [])
              .filter(other => !(other.url === entry.url && other.at === entry.at)));
            this.downloads();
          }
        }));
      }
    },

    // ── Settings ───────────────────────────────────────────────────────────
    settings() {
      const body = openShell('settings', 'Settings');

      body.appendChild(heading('Look'));
      body.appendChild(valueRow('Appearance', 'Theme, skin, typeface',
        VexTheme.current().id, () => this.appearance()));

      body.appendChild(heading('Search'));
      body.appendChild(valueRow('Search engine', null,
        (VexSearch.ENGINES[VexSearch.engineId()] || {}).name || '—',
        () => VexSheets.choose('Search engine',
          Object.entries(VexSearch.ENGINES).map(([id, engine]) => ({
            id, label: engine.name, selected: id === VexSearch.engineId()
          })),
          async id => { await VexStore.set('vex.searchEngine', id); VexSheets.close(); this.settings(); })));

      body.appendChild(heading('Pages'));
      body.appendChild(valueRow('Text size', null, VexStore.get('vex.textZoom', 100) + '%',
        () => VexSheets.choose('Text size',
          [80, 90, 100, 115, 130, 150, 175, 200].map(value => ({
            id: value, label: value + '%', selected: value === VexStore.get('vex.textZoom', 100)
          })),
          async value => {
            await VexStore.set('vex.textZoom', value);
            await VexBridge.setTextZoom(value);
            VexSheets.close();
            this.settings();
          })));
      body.appendChild(toggleRow('Dark pages', 'Ask sites for their dark theme',
        VexStore.get('vex.darkPages', false), async value => {
          await VexStore.set('vex.darkPages', value);
          const tab = VexTabStore.active();
          if (tab) await VexSiteRules.applyTo(tab);
        }));
      body.appendChild(toggleRow('Desktop sites by default', null,
        VexStore.get('vex.desktopDefault', false), value => VexStore.set('vex.desktopDefault', value)));
      body.appendChild(toggleRow('Data saver', 'Skip images on every site',
        VexStore.get('vex.dataSaver', false), async value => {
          await VexStore.set('vex.dataSaver', value);
          const tab = VexTabStore.active();
          if (tab) await VexSiteRules.applyTo(tab);
        }));

      body.appendChild(heading('Privacy'));
      body.appendChild(valueRow('Blocking and shield', VexBlock.enabled() ? 'On' : 'Off',
        VexShield.LEVELS[VexShield.level()].label, () => this.privacy()));

      body.appendChild(heading('Assistant'));
      body.appendChild(valueRow('Vex AI', 'Your own worker',
        VexAI.workerUrl() ? 'Configured' : 'Not set', () => this.assistantSettings()));

      body.appendChild(heading('Data'));
      body.appendChild(VexSheets.row({
        label: 'Clear cookies, cache and history', danger: true,
        run: async () => {
          await VexBridge.clearData({ cookies: true, cache: true, storage: true });
          await VexStore.set('vex.history', []);
          VexUI.toast('Cleared');
          return true;
        }
      }));

      body.appendChild(heading('About'));
      body.appendChild(VexSheets.row({
        label: 'Vex for Android',
        note: VexUI.version + ' · ' + (VexBridge.isNative ? 'system WebView' : 'development fallback')
      }));
    },

    // ── Appearance ─────────────────────────────────────────────────────────
    appearance() {
      const body = openShell('appearance', 'Appearance');
      const preference = VexStore.get('vex.theme', 'auto');

      body.appendChild(heading('Theme'));
      const grid = el('div', 'theme-grid');
      const cards = [{ id: 'auto', label: 'Auto', accent: VexTheme.current().accent, bg: VexTheme.current().bg }]
        .concat(VexTheme.themes());
      for (const theme of cards) {
        const card = el('button', 'theme-card' + (preference === theme.id ? ' on' : ''));
        const swatch = el('div', 'theme-swatch');
        swatch.style.background = theme.bg;
        const dot = el('i');
        dot.style.background = theme.accent;
        swatch.appendChild(dot);
        card.appendChild(swatch);
        card.appendChild(el('div', 'theme-name', theme.id === 'auto' ? 'Auto' : theme.id));
        card.onclick = async () => {
          await VexTheme.set(theme.id);
          this.appearance();
        };
        grid.appendChild(card);
      }
      body.appendChild(grid);
      body.appendChild(el('div', 'field-note',
        'Auto follows the system: Oxford in the light, Midnight in the dark. The rest are the same '
        + 'themes the desktop app ships, generated from the same token file.'));

      body.appendChild(heading('Skin'));
      const skin = VexStore.get('vex.skin', 'none');
      body.appendChild(valueRow('Texture', 'Drawn in the theme’s own ink',
        (VexTheme.SKINS[skin] || VexTheme.SKINS.none).label,
        () => VexSheets.choose('Texture',
          Object.entries(VexTheme.SKINS).map(([id, entry]) => ({ id, label: entry.label, selected: id === skin })),
          async id => { await VexTheme.setSkin(id); VexSheets.close(); this.appearance(); })));
      if (skin !== 'none') {
        const strength = Number(VexStore.get('vex.skinStrength', 0.05));
        body.appendChild(valueRow('Strength', null, Math.round(strength * 100) + '%', async () => {
          const steps = [0.03, 0.05, 0.08, 0.12, 0.18];
          const next = steps[(steps.indexOf(strength) + 1) % steps.length] || 0.05;
          await VexTheme.setSkin(skin, next);
          this.appearance();
        }));
      }
      body.appendChild(valueRow('Corners', null, VexStore.get('vex.corner', 'soft'),
        () => VexSheets.choose('Corners',
          Object.keys(VexTheme.CORNERS).map(id => ({ id, label: id, selected: id === VexStore.get('vex.corner', 'soft') })),
          async id => { await VexStore.set('vex.corner', id); VexTheme.apply(); VexSheets.close(); this.appearance(); })));
      body.appendChild(valueRow('Shadow', null, VexStore.get('vex.shadow', 'soft'),
        () => VexSheets.choose('Shadow',
          Object.keys(VexTheme.SHADOWS).map(id => ({ id, label: id, selected: id === VexStore.get('vex.shadow', 'soft') })),
          async id => { await VexStore.set('vex.shadow', id); VexTheme.apply(); VexSheets.close(); this.appearance(); })));

      body.appendChild(heading('Type'));
      const font = VexStore.get('vex.font', 'system');
      body.appendChild(valueRow('Interface font', null, (VexTheme.FONTS[font] || {}).label || 'System',
        () => VexSheets.choose('Interface font',
          Object.entries(VexTheme.FONTS).map(([id, entry]) => ({ id, label: entry.label, selected: id === font })),
          async id => { await VexTheme.setFont(id); VexSheets.close(); this.appearance(); })));
      body.appendChild(toggleRow('Tint the toolbar to the page', 'Follow a site’s theme colour',
        VexStore.get('vex.tintToolbar', true), async value => {
          await VexStore.set('vex.tintToolbar', value);
          if (!value) VexTheme.tintFromPage(null);
          VexUI.renderToolbar();
        }));
    },

    // ── Privacy ────────────────────────────────────────────────────────────
    privacy() {
      const body = openShell('privacy', 'Privacy');

      body.appendChild(heading('Blocking'));
      body.appendChild(toggleRow('Block ads and trackers', null, VexBlock.enabled(),
        value => VexBlock.setEnabled(value)));
      const lists = VexStore.get('vex.blockLists', VexBlock.DEFAULT_LISTS);
      for (let index = 0; index < lists.length; index++) {
        const list = lists[index];
        body.appendChild(toggleRow(list.name, null, list.on, async value => {
          const next = VexStore.get('vex.blockLists', VexBlock.DEFAULT_LISTS).slice();
          next[index] = Object.assign({}, next[index], { on: value });
          await VexStore.set('vex.blockLists', next);
          VexUI.toast('Updating filter lists…');
          const merged = await VexBlock.refresh();
          VexUI.toast(merged ? 'Filter lists updated' : 'Could not reach the lists');
        }));
      }
      const fetchedAt = VexStore.get('vex.blockRulesAt', 0);
      body.appendChild(valueRow('Update filter lists now',
        fetchedAt ? 'Last updated ' + when(fetchedAt) : 'Never updated — the built-in list is in use',
        '', async () => {
          VexUI.toast('Updating filter lists…');
          const merged = await VexBlock.refresh();
          VexUI.toast(merged ? 'Filter lists updated' : 'Could not reach the lists');
          this.privacy();
        }));
      const blocked = Number(VexStore.get('vex.blockedTotal', 0));
      if (blocked) body.appendChild(el('div', 'field-note', blocked.toLocaleString() + ' requests blocked so far.'));

      body.appendChild(heading('Fingerprinting'));
      const level = VexShield.level();
      for (const [id, entry] of Object.entries(VexShield.LEVELS)) {
        body.appendChild(VexSheets.row({
          icon: id === level ? 'check' : null,
          reserveIcon: true,
          label: entry.label,
          note: entry.note,
          run: async () => {
            const result = await VexShield.setLevel(id);
            this.privacy();
            if (id !== 'off' && !result.early) {
              VexUI.toast('This WebView cannot run it before the page — see PORTING.md', 3200);
            }
            return true;
          }
        }));
      }

      body.appendChild(heading('Connections'));
      body.appendChild(toggleRow('HTTPS only', 'Upgrade http:// links', VexStore.get('vex.httpsOnly', true),
        async value => {
          await VexStore.set('vex.httpsOnly', value);
          await VexBridge.setPrivacy({ httpsOnly: value, doNotTrack: VexStore.get('vex.dnt', true) });
        }));
      body.appendChild(toggleRow('Send Do Not Track and GPC', null, VexStore.get('vex.dnt', true),
        async value => {
          await VexStore.set('vex.dnt', value);
          await VexBridge.setPrivacy({ httpsOnly: VexStore.get('vex.httpsOnly', true), doNotTrack: value });
        }));
    },

    // ── Assistant settings ─────────────────────────────────────────────────
    async assistantSettings() {
      const body = openShell('assistant', 'Assistant');
      const hasToken = await VexAI.hasToken();

      body.appendChild(el('div', 'field-note',
        'Vex AI talks to a Cloudflare Worker you deploy yourself (SELF_HOSTING.md in the repo). '
        + 'Nothing here points at anyone else’s backend, and the token is kept in the Android '
        + 'Keystore rather than in a settings file.'));

      const urlField = el('div', 'field stack');
      urlField.appendChild(el('label', { for: 'ai-url' }, 'Worker URL'));
      const urlInput = el('input', {
        id: 'ai-url', type: 'url', placeholder: 'https://your-worker.workers.dev',
        value: VexAI.workerUrl(), autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false'
      });
      urlInput.onchange = async () => {
        try { await VexAI.setWorkerUrl(urlInput.value); VexUI.toast('Saved'); }
        catch (err) { VexUI.toast(err.message); }
      };
      urlField.appendChild(urlInput);
      body.appendChild(urlField);

      const tokenField = el('div', 'field stack');
      tokenField.appendChild(el('label', { for: 'ai-token' }, hasToken ? 'Access token (stored)' : 'Access token'));
      const tokenInput = el('input', {
        id: 'ai-token', type: 'password', placeholder: hasToken ? '•••••••• — type to replace' : 'Paste your token',
        autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false'
      });
      tokenInput.onchange = async () => {
        try {
          await VexAI.setToken(tokenInput.value);
          tokenInput.value = '';
          VexUI.toast(hasToken ? 'Token replaced' : 'Token stored');
          this.assistantSettings();
        } catch (err) { VexUI.toast(err.message); }
      };
      tokenField.appendChild(tokenInput);
      body.appendChild(tokenField);

      if (hasToken) {
        body.appendChild(VexSheets.row({
          label: 'Forget the token', danger: true,
          run: async () => { await VexAI.setToken(''); this.assistantSettings(); return true; }
        }));
      }

      body.appendChild(heading('Checks'));
      body.appendChild(valueRow('Test the connection', null, '', async () => {
        VexUI.toast('Asking the worker…');
        try {
          await VexAI.ask('Reply with the single word: ready.', { context: null });
          VexUI.toast('The worker answered');
        } catch (err) {
          VexUI.toast(err.message, 4000);
        }
      }));
      body.appendChild(el('div', 'field-note',
        'Private tabs never send page text to the worker, and a question is always sent with the page '
        + 'you were on when you asked it — not the one you have since moved to.'));
    }
  };
})();

if (typeof window !== 'undefined') window.VexPanels = VexPanels;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPanels };
