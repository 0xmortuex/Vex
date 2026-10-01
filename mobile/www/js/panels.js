// === Vex Mobile — full-screen panels ===
//
// Everything that is a list or a settings tree shares one shell (#panel): a
// title, an optional search field, an optional header action, and a body. Each
// panel owns what goes in the body and what Back means — the stack is walked
// by VexPanels.back(), so Settings → Appearance → Back returns to Settings
// rather than dumping you on the page.

const VexPanels = (() => {
  const { $, el, icon, clear, favicon, when, bytes } = VexDom;
  let stack = [];
  let totpTimer = null;
  // Which drawing a body belongs to. Several panels fill themselves from
  // IndexedDB, and the search field re-opens the panel on every keystroke, so
  // an answer can arrive after its body has been cleared and refilled by a
  // later one — two sets of rows in one list, the stale ones underneath.
  // Each draw takes a number and stops if the number has moved on.
  let drawn = 0;

  function openShell(name, title, { search, action } = {}) {
    drawn++;
    stopTotp();
    $('panel-title').textContent = title;
    const searchWrap = $('panel-search');
    searchWrap.hidden = !search;
    if (search) {
      const input = $('panel-search-input');
      input.value = search.value || '';
      input.placeholder = search.placeholder || 'Search';
      input.oninput = () => search.onInput(input.value);
      if (search.focus) setTimeout(() => input.focus(), 50);
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

  /**
   * Open the panel for the assistant, which draws its own body.
   *
   * The assistant is not a panel like the others — it builds #panel-body itself
   * — but it has to enter through the same door, because this is the only place
   * that knows whether #panel is already open and therefore whether the page
   * needs covering again.
   */
  function openAIShell() {
    if ($('panel').hidden) {
      $('panel').hidden = false;
      VexUI.cover(true);
    }
    if (stack[stack.length - 1] !== 'ai') stack.push('ai');
  }

  function close() {
    stack = [];
    stopTotp();
    if ($('panel').hidden) return;
    $('panel').hidden = true;
    $('panel-search').hidden = true;
    VexUI.cover(false);
  }

  const REOPEN = {
    history: () => VexPanels.history(),
    recall: () => VexPanels.recall(),
    bookmarks: () => VexPanels.bookmarks(),
    reading: () => VexPanels.readingList(),
    saved: () => VexPanels.savedPages(),
    sessions: () => VexPanels.sessions(),
    downloads: () => VexPanels.downloads(),
    passwords: () => VexPanels.passwords(),
    sync: () => VexPanels.sync(),
    permissions: () => VexPanels.permissions(),
    notes: () => VexPanels.notes(),
    reminders: () => VexPanels.reminders(),
    library: () => VexPanels.library(),
    welcome: () => VexWelcome.show(0),
    settings: () => VexPanels.settings(),
    appearance: () => VexPanels.appearance(),
    toolbarButtons: () => VexPanels.toolbarButtons(),
    details: () => VexPanels.details(),
    tabsSettings: () => VexPanels.tabsSettings(),
    menuEditor: () => VexPanels.menuEditor(),
    quickAccess: () => VexPanels.quickAccess(),
    assistant: () => VexPanels.assistantSettings(),
    localai: () => VexPanels.localAI(),
    diagnostics: () => VexPanels.diagnostics(),
    backup: () => VexPanels.backup(),
    privacy: () => VexPanels.privacy(),
    // Two panels used to open under their parent's name, which left Back with
    // nothing to pop and closed the whole panel instead of stepping up one.
    storage: () => VexPanels.storage(),
    clearData: () => VexPanels.clearData(),
    addLogin: () => VexPanels.addLogin(),
    ai: () => VexViews.openAI()
  };

  function back() {
    stack.pop();
    const previous = stack.pop();
    const reopen = previous && REOPEN[previous];
    if (reopen) reopen(); else close();
  }

  // ── Shared row shapes ────────────────────────────────────────────────────
  function listRow(entry, { onOpen, onRemove, sub, actions } = {}) {
    const node = el('div', 'list-row');
    node.appendChild(favicon(entry));
    const lines = el('div', 'lines');
    lines.appendChild(el('span', 't', entry.title || VexSearch.prettyHost(entry.url) || entry.url));
    lines.appendChild(el('span', 'u', sub ? sub(entry) : entry.url));
    if (entry.extra) lines.appendChild(entry.extra);
    node.appendChild(lines);
    if (onOpen) node.onclick = () => onOpen(entry);
    if (actions) {
      const group = el('div', 'row-actions');
      for (const item of actions) {
        const button = el('button', { 'aria-label': item.label });
        button.appendChild(icon(item.icon));
        button.onclick = event => { event.stopPropagation(); item.run(entry); };
        group.appendChild(button);
      }
      node.appendChild(group);
    }
    if (onRemove) {
      const remove = el('button', { class: 'x', 'aria-label': 'Remove' });
      remove.appendChild(icon('close'));
      remove.onclick = event => { event.stopPropagation(); onRemove(entry); };
      node.appendChild(remove);
    }
    if (entry.url) VexGestures.longPress(node, () => VexSheets.link({ link: entry.url }));
    return node;
  }

  const empty = text => el('div', 'list-empty', text);
  const heading = text => el('div', 'list-head', text);

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

  function stopTotp() {
    clearInterval(totpTimer);
    totpTimer = null;
  }

  function dayName(at) {
    const day = new Date(at || 0).toDateString();
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    return day === today ? 'Today' : day === yesterday ? 'Yesterday' : day;
  }

  return {
    // Anything that wants the panel shell — the first-run flow does — goes
    // through here rather than opening #panel itself: the page-cover refcount
    // must be touched exactly once per open, and this is the only place that
    // knows whether it is already open.
    shell: openShell,
    openAIShell,
    close,
    back,
    isOpen() { return !$('panel').hidden; },
    markOpen(name) { if (stack[stack.length - 1] !== name) stack.push(name); },

    // ── History ────────────────────────────────────────────────────────────
    async history(query = '') {
      const body = openShell('history', 'History', {
        search: { value: query, placeholder: 'Search history', onInput: value => this.history(value) },
        action: {
          label: 'Clear',
          run: async () => { await VexHistory.clear(); this.history(); VexUI.toast('History cleared'); }
        }
      });
      const mine = drawn;
      const entries = await VexHistory.search(query, 400);
      if (mine !== drawn) return;
      if (!entries.length) {
        body.appendChild(empty(query ? 'Nothing matches “' + query + '”.' : 'Pages you visit show up here.'));
        return;
      }
      let lastDay = '';
      for (const entry of entries) {
        const day = dayName(entry.at);
        if (day !== lastDay) { lastDay = day; body.appendChild(heading(day)); }
        body.appendChild(listRow(entry, {
          sub: item => (item.host || VexSearch.prettyHost(item.url)) + ' · ' + when(item.at),
          onOpen: item => { close(); VexUI.openUrl(item.url); },
          onRemove: async item => { await VexHistory.remove(item); this.history(query); }
        }));
      }
    },

    // ── Recall: find a page by what it said ────────────────────────────────
    async recall(query = '') {
      const body = openShell('recall', 'Search what you read', {
        search: {
          value: query, placeholder: 'A word from the page', focus: !query,
          onInput: value => this.recall(value)
        }
      });
      const mine = drawn;
      if (!query.trim()) {
        const stats = await VexHistory.stats();
        if (mine !== drawn) return;
        body.appendChild(empty('Vex keeps the text of the pages you read, on the device, so you can find '
          + 'one by what it said rather than what it was called.\n\n'
          + stats.pages.toLocaleString() + ' pages are searchable.'));
        return;
      }
      const hits = await VexHistory.recall(query, 60);
      if (mine !== drawn) return;
      if (!hits.length) {
        body.appendChild(empty('No page you have read contains all of those words.'));
        return;
      }
      for (const hit of hits) {
        const snippet = el('span', 'recall-snippet', VexHistory.snippet(hit, query));
        body.appendChild(listRow(Object.assign({}, hit, { extra: snippet }), {
          sub: item => VexSearch.prettyHost(item.url) + ' · ' + when(item.at),
          onOpen: item => { close(); VexUI.openUrl(item.url); }
        }));
      }
    },

    // ── Bookmarks, in folders ──────────────────────────────────────────────
    bookmarks(query = '') {
      const body = openShell('bookmarks', 'Bookmarks', {
        search: { value: query, placeholder: 'Search bookmarks', onInput: value => this.bookmarks(value) },
        action: { label: 'Edit', run: () => this.bookmarksMenu() }
      });
      const groups = VexCollections.bookmarks.grouped(query);
      if (!groups.length) {
        body.appendChild(empty(query ? 'Nothing matches “' + query + '”.'
          : 'Star a page from the menu and it will be here.'));
        return;
      }
      for (const [folder, entries] of groups) {
        body.appendChild(heading(folder || 'Unsorted'));
        for (const entry of entries) {
          body.appendChild(listRow(entry, {
            sub: item => VexSearch.prettyHost(item.url),
            onOpen: item => { close(); VexUI.openUrl(item.url); },
            actions: [{
              icon: 'layers', label: 'Move to folder', run: item => this.pickFolder(item)
            }],
            onRemove: async item => {
              await VexCollections.bookmarks.remove(item.url);
              VexSync.schedulePush();
              this.bookmarks(query);
            }
          }));
        }
      }
    },

    pickFolder(bookmark) {
      const folders = VexCollections.bookmarks.folders();
      VexSheets.choose('Move to folder',
        [{ id: '', label: 'Unsorted', selected: !bookmark.folder }]
          .concat(folders.map(name => ({ id: name, label: name, selected: bookmark.folder === name })))
          .concat([{ id: '__new', label: 'New folder…' }]),
        async choice => {
          VexSheets.close();
          if (choice === '__new') {
            const name = await VexUI.prompt('New folder', 'Folder name');
            if (!name) return;
            await VexCollections.bookmarks.addFolder(name);
            await VexCollections.bookmarks.move(bookmark.id, name);
          } else {
            await VexCollections.bookmarks.move(bookmark.id, choice);
          }
          VexSync.schedulePush();
          this.bookmarks();
        });
    },

    bookmarksMenu() {
      VexSheets.choose('Bookmarks', [
        { id: 'folder', label: 'New folder' },
        { id: 'export', label: 'Export as an HTML file' },
        { id: 'import', label: 'Import from an HTML file' }
      ], async choice => {
        VexSheets.close();
        if (choice === 'folder') {
          const name = await VexUI.prompt('New folder', 'Folder name');
          if (name) { await VexCollections.bookmarks.addFolder(name); this.bookmarks(); }
        } else if (choice === 'export') {
          VexUI.downloadText('vex-bookmarks.html', VexCollections.bookmarks.exportHtml(), 'text/html');
        } else if (choice === 'import') {
          VexUI.pickTextFile(async text => {
            const added = await VexCollections.bookmarks.importHtml(text);
            VexUI.toast(added ? 'Imported ' + added + ' bookmarks' : 'Nothing new in that file');
            VexSync.schedulePush();
            this.bookmarks();
          });
        }
      });
    },

    // ── Reading list ───────────────────────────────────────────────────────
    readingList(filter = 'unread') {
      const body = openShell('reading', 'Reading list');
      const chips = el('div', 'panel-chips');
      for (const [id, label] of [['unread', 'Unread'], ['all', 'Everything']]) {
        chips.appendChild(el('button', {
          class: 'chip' + (filter === id ? ' on' : ''),
          onclick: () => this.readingList(id)
        }, label));
      }
      body.appendChild(chips);

      const entries = filter === 'unread' ? VexCollections.reading.unread() : VexCollections.reading.all();
      if (!entries.length) {
        body.appendChild(empty(filter === 'unread'
          ? 'Nothing waiting. Add a page from the menu, or long-press a link.'
          : 'Your reading list is empty.'));
        return;
      }
      for (const entry of entries) {
        body.appendChild(listRow(entry, {
          sub: item => VexSearch.prettyHost(item.url) + ' · ' + when(item.at) + (item.read ? ' · read' : ''),
          onOpen: async item => {
            await VexCollections.reading.markRead(item.url, true);
            close();
            VexUI.openUrl(item.url);
          },
          actions: [{
            icon: entry.read ? 'history' : 'check',
            label: entry.read ? 'Mark unread' : 'Mark read',
            run: async item => {
              await VexCollections.reading.markRead(item.url, !item.read);
              VexSync.schedulePush();
              this.readingList(filter);
            }
          }],
          onRemove: async item => {
            await VexCollections.reading.remove(item.url);
            VexSync.schedulePush();
            this.readingList(filter);
          }
        }));
      }
    },

    // ── Saved pages ────────────────────────────────────────────────────────
    async savedPages() {
      const body = openShell('saved', 'Saved pages');
      const mine = drawn;
      const pages = await VexTools.savedPages();
      if (mine !== drawn) return;
      if (!pages.length) {
        body.appendChild(empty('A saved page is the whole document, kept on the phone. It opens with no '
          + 'connection at all — the tunnel, the plane, the dead spot on the way home.'));
        return;
      }
      for (const page of pages) {
        body.appendChild(listRow(page, {
          sub: item => VexSearch.prettyHost(item.url) + ' · ' + bytes(item.size) + ' · ' + when(item.at),
          onOpen: async item => { close(); await VexTools.openSaved(item); },
          onRemove: async item => { await VexTools.deleteSaved(item.id); this.savedPages(); }
        }));
      }
    },

    // ── Notes ──────────────────────────────────────────────────────────────
    async notes(query = '') {
      const body = openShell('notes', 'Notes', {
        search: { value: query, placeholder: 'Search your notes', onInput: value => this.notes(value) },
        action: {
          label: 'Add',
          run: async () => {
            const tab = VexTabStore.active();
            const text = await VexUI.prompt('A note', tab && tab.url !== 'about:blank'
              ? 'About ' + VexSearch.prettyHost(tab.url) : 'Anything you want to keep');
            if (!text) return;
            await VexNotes.add({ url: tab ? tab.url : '', title: tab ? tab.title : '', text });
            this.notes(query);
          }
        }
      });
      const mine = drawn;
      const notes = await VexNotes.search(query);
      if (mine !== drawn) return;
      if (!notes.length) {
        body.appendChild(empty(query
          ? 'Nothing matches “' + query + '”.'
          : 'Select text on a page and choose "Keep as a note", or add one here. Notes stay on the phone.'));
        return;
      }
      for (const note of notes) {
        const row = el('div', 'list-row');
        row.appendChild(favicon({ url: note.url }));
        const lines = el('div', 'lines');
        lines.appendChild(el('span', 't', note.text.slice(0, 120)));
        lines.appendChild(el('span', 'u', [note.host, note.kind === 'quote' ? 'kept from the page' : null, when(note.at)]
          .filter(Boolean).join(' · ')));
        row.appendChild(lines);
        if (note.url) row.onclick = () => { close(); VexUI.openUrl(note.url); };
        const remove = el('button', { class: 'x', 'aria-label': 'Delete' });
        remove.appendChild(icon('trash'));
        remove.onclick = async event => { event.stopPropagation(); await VexNotes.remove(note.id); this.notes(query); };
        row.appendChild(remove);
        body.appendChild(row);
      }
    },

    // ── Reminders ──────────────────────────────────────────────────────────
    reminders() {
      const body = openShell('reminders', 'Reminders', {
        action: {
          label: 'Add',
          run: () => {
            const tab = VexTabStore.active();
            if (!tab || !tab.url || tab.url === 'about:blank') { VexUI.toast('Open a page first'); return; }
            this.addReminder(tab);
          }
        }
      });
      const pending = VexRemind.pending();
      if (!pending.length) {
        body.appendChild(empty('A reminder brings a page back — this evening, tomorrow, at the weekend. '
          + 'Android wakes for it whether or not Vex is running.'));
        return;
      }
      for (const entry of pending) {
        body.appendChild(listRow({ url: entry.url, title: entry.title, icon: '' }, {
          sub: () => VexRemind.describe(entry.at) + (entry.note ? ' · ' + entry.note : '')
            + (entry.exact === false ? ' · approximate' : ''),
          onOpen: () => { close(); VexUI.openUrl(entry.url); },
          onRemove: async () => { await VexRemind.remove(entry.id); this.reminders(); }
        }));
      }
    },

    addReminder(tab) {
      VexSheets.choose('Bring this back', VexRemind.PRESETS.map(preset => ({
        id: preset.id,
        label: preset.label,
        note: VexRemind.describe(preset.at ? preset.at() : Date.now() + preset.minutes * 60000)
      })), async choice => {
        VexSheets.close();
        const preset = VexRemind.PRESETS.find(entry => entry.id === choice);
        if (!preset) return;
        const at = preset.at ? preset.at() : Date.now() + preset.minutes * 60000;
        const note = await VexUI.prompt('What about it?', 'Optional — what you want to remember', '');
        if (note === null) return;
        const granted = await VexBridge.requestPermission('notifications');
        if (!granted) VexUI.toast('Android will not show the notification until Vex may notify you', 4000);
        await VexRemind.add({ url: tab.url, title: tab.title, note, at });
        VexUI.toast('Set for ' + VexRemind.describe(at), 3500, { label: 'Reminders', run: () => this.reminders() });
      }, VexSearch.prettyHost(tab.url));
    },

    // ── The library ────────────────────────────────────────────────────────
    library(query = '') {
      const body = openShell('library', 'Everything Vex can do', {
        search: {
          value: query, placeholder: 'What are you trying to do?',
          onInput: value => this.library(value)
        }
      });

      if (!query) {
        const ask = el('div', 'field stack');
        ask.appendChild(el('div', 'field-note',
          VexLibrary.count() + ' features, on named shelves. Or describe what you are trying to do and '
          + 'the assistant will name the ones for it.'));
        const askButton = el('button', { class: 'pill-btn', style: 'margin: 0 16px 8px; width: calc(100% - 32px)' },
          'Ask Vex what you don’t know');
        askButton.onclick = async () => {
          const question = await VexUI.prompt('Ask Vex', 'What are you trying to do?');
          if (!question) return;
          if (!(await VexAI.configured())) { VexUI.toast('Set up the assistant first (Settings → Assistant)'); return; }
          VexUI.toast('Asking…', 1500);
          try {
            await VexLibrary.ask(question);
            VexViews.openAI();
          } catch (error) { VexUI.toast(error.message, 4000); }
        };
        body.appendChild(askButton);
      }

      const matches = VexLibrary.search(query);
      if (!matches.length) {
        body.appendChild(empty('Nothing here matches “' + query + '”.'));
        return;
      }
      let shelf = '';
      for (const entry of matches) {
        if (entry.shelf !== shelf) { shelf = entry.shelf; body.appendChild(heading(shelf)); }
        body.appendChild(VexSheets.row({
          label: entry.name,
          note: entry.description,
          run: () => { close(); entry.run(); }
        }));
      }
    },

    // ── Sessions ───────────────────────────────────────────────────────────
    sessions() {
      const body = openShell('sessions', 'Sessions', {
        action: {
          label: 'Save now',
          run: async () => {
            const name = await VexUI.prompt('Save this session', 'A name for it',
              'Session ' + new Date().toLocaleDateString());
            if (name === null) return;
            try {
              await VexCollections.sessions.save(name, VexTabStore.normal());
              VexSync.schedulePush();
              VexUI.toast('Saved');
              this.sessions();
            } catch (error) { VexUI.toast(error.message); }
          }
        }
      });
      const sessions = VexCollections.sessions.all();
      if (!sessions.length) {
        body.appendChild(empty('A session is the tabs you have open, named and kept. Sessions travel to '
          + 'the desktop, so "everything I had open on the phone" opens on the PC.'));
        return;
      }
      for (const session of sessions) {
        body.appendChild(listRow({ url: '', title: session.name, icon: '' }, {
          sub: () => session.tabs.length + ' tabs · ' + when(Date.parse(session.createdAt)),
          onOpen: async () => {
            close();
            for (const tab of session.tabs) await VexTabStore.create(tab.url, { background: true });
            VexUI.toast('Opened ' + session.tabs.length + ' tabs');
            VexUI.renderToolbar();
          },
          onRemove: async () => {
            await VexCollections.sessions.remove(session.id);
            VexSync.schedulePush();
            this.sessions();
          }
        }));
      }
    },

    // ── Downloads ──────────────────────────────────────────────────────────
    async downloads() {
      const body = openShell('downloads', 'Downloads', {
        action: { label: 'Clear list', run: async () => { await VexDB.clear('downloads'); this.downloads(); } }
      });
      const mine = drawn;
      const rows = await VexDB.scan('downloads', { limit: 200 });
      let live = [];
      try {
        const status = await VexBridge.downloadStatus();
        live = (status && status.downloads) || [];
      } catch { live = []; }
      if (mine !== drawn) return;

      if (!rows.length && !live.length) {
        body.appendChild(empty('Files you download land in the phone’s Downloads folder, and are listed here.'));
        return;
      }

      for (const entry of rows) {
        const match = live.find(item => item.url === entry.url);
        const done = !match || match.status === 8;         // STATUS_SUCCESSFUL
        const failed = match && match.status === 16;       // STATUS_FAILED
        const node = listRow({ url: entry.url, title: entry.filename || entry.url, icon: '' }, {
          sub: () => [
            VexSearch.prettyHost(entry.url),
            failed ? 'failed' : done ? bytes(entry.size || (match && match.total)) : 'downloading…',
            when(entry.at)
          ].filter(Boolean).join(' · '),
          onOpen: async () => {
            if (match && match.localUri) { await VexBridge.openDownload(match.localUri); return; }
            close();
            VexUI.openUrl(entry.url);
          },
          onRemove: async () => { await VexDB.delete('downloads', entry.id); this.downloads(); }
        });
        if (match && !done && !failed && match.total > 0) {
          const bar = el('div', 'progress-row');
          const fill = el('i');
          fill.style.width = Math.round((match.downloaded / match.total) * 100) + '%';
          bar.appendChild(fill);
          node.querySelector('.lines').appendChild(bar);
        }
        body.appendChild(node);
      }
    },

    // ── Passwords and 2FA ──────────────────────────────────────────────────
    async passwords() {
      const body = openShell('passwords', 'Passwords and 2FA', {
        action: { label: 'Add', run: () => this.addLogin() }
      });

      if (VexVault.locked()) {
        const note = el('div', 'locked-note');
        note.textContent = 'Your logins are encrypted under a key that stays in the phone’s keystore. '
          + 'Unlock to see them.';
        body.appendChild(note);
        const unlock = el('button', { class: 'pill-btn', style: 'margin: 0 16px; width: calc(100% - 32px)' }, 'Unlock');
        unlock.onclick = async () => {
          if (await VexVault.unlock()) this.passwords();
          else VexUI.toast('Not unlocked');
        };
        body.appendChild(unlock);
        return;
      }

      const entries = VexVault.all();
      if (!entries.length) {
        body.appendChild(empty('Nothing saved yet. On a page with a login form, the menu offers '
          + '"Save this login" — what it saves is what is in the fields you can see.'));
        return;
      }

      // The vault locks itself five minutes after you unlocked it, and again
      // the moment Vex goes to the background. A panel left open has to honour
      // that: the codes it ticks and the password behind the copy button both
      // came out of the vault, so a phone put down on this screen must not go
      // on handing them out. Everything below re-reads the entry out of the
      // vault by id rather than trusting the copy it captured.
      const current = id => VexVault.all().find(row => row.id === id) || null;
      const relock = () => { stopTotp(); this.passwords(); };

      const codeNodes = [];
      for (const entry of entries) {
        const node = el('div', 'list-row');
        node.appendChild(el('span', 'favicon', (entry.host[0] || '?').toUpperCase()));
        const lines = el('div', 'lines');
        lines.appendChild(el('span', 't', entry.label || entry.host));
        lines.appendChild(el('span', 'u', entry.username || 'no username'));
        if (entry.secret) {
          const totp = el('div', 'totp');
          const code = el('span', 'totp-code', '······');
          const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          ring.setAttribute('class', 'totp-ring');
          ring.setAttribute('viewBox', '0 0 24 24');
          ring.innerHTML = '<circle class="track" cx="12" cy="12" r="9"/>'
            + '<circle class="fill" cx="12" cy="12" r="9" stroke-dasharray="56.5" stroke-dashoffset="0"/>';
          totp.appendChild(code);
          totp.appendChild(ring);
          lines.appendChild(totp);
          codeNodes.push({ entry, code, ring });
        }
        node.appendChild(lines);

        const actions = el('div', 'row-actions');
        const fill = el('button', { 'aria-label': 'Fill on this page' });
        fill.appendChild(icon('key'));
        fill.onclick = async () => {
          const tab = VexTabStore.active();
          if (!tab) return;
          if (VexVault.locked() && !(await VexVault.unlock('Fill this login'))) { relock(); return; }
          const fresh = current(entry.id);
          if (!fresh) { relock(); return; }
          close();
          const filled = await VexVault.fill(tab.id, fresh);
          VexUI.toast(filled ? 'Filled — you press the button' : 'No login form on this page');
        };
        actions.appendChild(fill);
        const copy = el('button', { 'aria-label': 'Copy password' });
        copy.appendChild(icon('copy'));
        copy.onclick = async () => {
          if (VexVault.locked() && !(await VexVault.unlock('Copy this password'))) { relock(); return; }
          const fresh = current(entry.id);
          if (!fresh) { relock(); return; }
          VexUI.copy(fresh.password);
        };
        actions.appendChild(copy);
        node.appendChild(actions);

        const remove = el('button', { class: 'x', 'aria-label': 'Delete' });
        remove.appendChild(icon('trash'));
        remove.onclick = async () => {
          if (!(await VexUI.confirm('Delete the login for ' + entry.host + '?'))) return;
          await VexVault.remove(entry.id);
          this.passwords();
        };
        node.appendChild(remove);
        body.appendChild(node);
      }

      // The codes tick over every second, and the ring empties as they age.
      const tick = async () => {
        // No biometric prompt here — a timer must never raise one. When the
        // lock has fallen the panel simply goes back to its locked face.
        if (VexVault.locked()) { relock(); return; }
        for (const item of codeNodes) {
          try {
            const fresh = current(item.entry.id);
            if (!fresh || !fresh.secret) { item.code.textContent = '······'; continue; }
            item.code.textContent = await VexVault.totp(fresh.secret);
            const left = VexVault.secondsLeft();
            item.ring.querySelector('.fill').setAttribute('stroke-dashoffset', String(56.5 * (1 - left / 30)));
          } catch {
            item.code.textContent = 'bad secret';
          }
        }
      };
      tick();
      stopTotp();
      totpTimer = setInterval(tick, 1000);
    },

    async addLogin(prefill = {}) {
      if (!(await VexVault.unlock('Add a login'))) { VexUI.toast('Not unlocked'); return; }
      const body = openShell('addLogin', 'Add a login');
      const fields = {};
      for (const [key, label, type] of [
        ['host', 'Site', 'text'], ['username', 'Username', 'text'],
        ['password', 'Password', 'password'], ['secret', '2FA secret (optional)', 'text']
      ]) {
        const field = el('div', 'field stack');
        field.appendChild(el('label', { for: 'login-' + key }, label));
        const input = el('input', {
          id: 'login-' + key, type, value: prefill[key] || '',
          autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false'
        });
        fields[key] = input;
        field.appendChild(input);
        body.appendChild(field);
      }
      body.appendChild(el('div', 'field-note',
        'A 2FA secret is the long code a site shows beside its QR image. Vex works the six digits out '
        + 'on the device; nothing is asked of anyone else.'));

      const save = el('button', { class: 'pill-btn', style: 'margin: 8px 16px; width: calc(100% - 32px)' }, 'Save');
      save.onclick = async () => {
        const host = fields.host.value.trim().replace(/^https?:\/\//, '').split('/')[0];
        if (!host) { VexUI.toast('Which site is it for?'); return; }
        await VexVault.save({
          host,
          username: fields.username.value.trim(),
          password: fields.password.value,
          secret: fields.secret.value.trim(),
          label: host
        });
        VexUI.toast('Saved');
        this.passwords();
      };
      body.appendChild(save);
    },

    // ── Sync ───────────────────────────────────────────────────────────────
    async sync() {
      const body = openShell('sync', 'Sync');
      const state = VexSync.state;

      const status = el('div', 'status-line');
      status.appendChild(el('span', 'status-dot' + (state.enabled ? ' on' : state.lastError ? ' error' : '')));
      status.appendChild(document.createTextNode(state.enabled
        ? 'Signed in as ' + state.email + (state.lastPushAt ? ' · last sent ' + when(Date.parse(state.lastPushAt)) : '')
        : state.lastError || 'Not signed in'));
      body.appendChild(status);

      body.appendChild(el('div', 'field-note',
        'Sync runs against a Cloudflare Worker you deploy yourself (SELF_HOSTING.md). Bookmarks, the '
        + 'reading list, sessions and your site rules travel, encrypted on the device with a key the '
        + 'worker never sees. History stays on the phone — it is too big for the 5 MB blob.'));

      const urlField = el('div', 'field stack');
      urlField.appendChild(el('label', { for: 'sync-url' }, 'Sync worker URL'));
      const urlInput = el('input', {
        id: 'sync-url', type: 'url', value: VexSync.workerUrl(),
        placeholder: 'https://your-sync.workers.dev',
        autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false'
      });
      urlInput.onchange = async () => {
        try { await VexSync.setWorkerUrl(urlInput.value); VexUI.toast('Saved'); }
        catch (error) { VexUI.toast(error.message); }
      };
      urlField.appendChild(urlInput);
      body.appendChild(urlField);

      if (!state.enabled) {
        body.appendChild(heading('Sign in'));
        const emailField = el('div', 'field stack');
        emailField.appendChild(el('label', { for: 'sync-email' }, 'Email'));
        const emailInput = el('input', {
          id: 'sync-email', type: 'text', inputmode: 'email', value: state.email || '',
          autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false'
        });
        emailField.appendChild(emailInput);
        body.appendChild(emailField);

        body.appendChild(valueRow('Send me a code', 'A six-digit code, by email', '', async () => {
          try {
            const answer = await VexSync.requestCode(emailInput.value.trim());
            VexUI.toast(answer.devCode ? 'Worker has no email set up — code: ' + answer.devCode : 'Code sent', 5000);
          } catch (error) { VexUI.toast(error.message, 4000); }
        }));

        const codeField = el('div', 'field stack');
        codeField.appendChild(el('label', { for: 'sync-code' }, 'The code'));
        const codeInput = el('input', { id: 'sync-code', type: 'text', inputmode: 'numeric', placeholder: '000000' });
        codeField.appendChild(codeInput);
        body.appendChild(codeField);

        body.appendChild(valueRow('Sign in', null, '', async () => {
          try {
            await VexSync.verifyCode(emailInput.value.trim(), codeInput.value.trim());
            if (!(await VexSync.hasKey())) {
              const code = await VexSync.createKey();
              await VexUI.showRecoveryCode(code);
            }
            await VexSync.syncNow();
            VexUI.toast('Signed in');
            this.sync();
          } catch (error) { VexUI.toast(error.message, 4000); }
        }));

        body.appendChild(heading('Already syncing elsewhere?'));
        body.appendChild(valueRow('Enter a recovery code', 'The code the first device showed you', '', async () => {
          const code = await VexUI.prompt('Recovery code', '8 groups of 4 characters');
          if (!code) return;
          try {
            await VexSync.useRecoveryCode(code);
            VexUI.toast('Key accepted — sign in with your email next');
          } catch (error) { VexUI.toast(error.message); }
        }));
        return;
      }

      body.appendChild(heading('This account'));
      body.appendChild(valueRow('Sync now', state.lastPullAt ? 'Last received ' + when(Date.parse(state.lastPullAt)) : null, '', async () => {
        VexUI.toast('Syncing…');
        const result = await VexSync.syncNow();
        VexUI.toast(result.ok ? 'Up to date' : result.reason, 4000);
        this.sync();
      }));
      body.appendChild(valueRow('Show the recovery code', 'What another device needs', '', async () => {
        await VexUI.showRecoveryCode(await VexSync.recoveryCode());
      }));
      body.appendChild(toggleRow('Sync history',
        'The last ' + VexSync.HISTORY_SLICE + ' pages, so the other device can find what you had open. '
        + 'It is the most personal thing that travels, and it is merged with what is already there '
        + 'rather than replacing it.',
        VexStore.get('vex.syncHistory', true) !== false,
        async value => { await VexStore.set('vex.syncHistory', value); }));
      body.appendChild(valueRow('Devices', 'Which machines are signed in', '', async () => {
        try {
          const devices = await VexSync.devices();
          VexSheets.choose('Devices', devices.map(device => ({
            id: device.deviceId,
            label: device.name || device.deviceId,
            note: device.lastSeen ? 'last seen ' + when(Date.parse(device.lastSeen)) : null
          })), async deviceId => {
            VexSheets.close();
            if (await VexUI.confirm('Sign that device out?')) {
              await VexSync.forgetDevice(deviceId);
              VexUI.toast('Removed');
            }
          });
        } catch (error) { VexUI.toast(error.message); }
      }));

      const remote = VexSync.remoteTabs();
      if (remote.length) {
        body.appendChild(heading('Open on your PC'));
        for (const tab of remote.slice(0, 20)) {
          body.appendChild(listRow(tab, {
            sub: item => VexSearch.prettyHost(item.url),
            onOpen: item => { close(); VexUI.openUrl(item.url, { newTab: true }); }
          }));
        }
      }

      body.appendChild(heading('Leaving'));
      body.appendChild(VexSheets.row({
        label: 'Sign out on this phone', danger: true,
        run: async () => { await VexSync.signOut(); this.sync(); return true; }
      }));
      body.appendChild(VexSheets.row({
        label: 'Delete everything on the server', danger: true,
        run: async () => {
          if (!(await VexUI.confirm('Delete the synced data for every device?'))) return true;
          try { await VexSync.deleteEverything(); VexUI.toast('Deleted'); }
          catch (error) { VexUI.toast(error.message); }
          this.sync();
          return true;
        }
      }));
    },

    // ── Site permissions, all of them ──────────────────────────────────────
    permissions() {
      const body = openShell('permissions', 'Site permissions');
      const sites = VexPermissions.sites();
      if (!sites.length) {
        body.appendChild(empty('Nothing has asked for the camera, the microphone or your location yet. '
          + 'When a site does, your answer is remembered here.'));
        return;
      }
      for (const host of sites) {
        body.appendChild(listRow({ url: 'https://' + host, title: host, icon: '' }, {
          sub: () => VexPermissions.describe(host),
          onOpen: () => VexSheets.permissions(host),
          onRemove: async () => { await VexPermissions.clearSite(host); this.permissions(); }
        }));
      }
    },

    // ── Settings ───────────────────────────────────────────────────────────
    async settings() {
      const body = openShell('settings', 'Settings');

      body.appendChild(heading('Look and feel'));
      body.appendChild(valueRow('Appearance', 'Theme, skin, typeface, toolbar', VexTheme.current().id, () => this.appearance()));
      body.appendChild(valueRow('Tabs', 'How tabs open, sleep and close', null, () => this.tabsSettings()));
      body.appendChild(valueRow('Menu', 'What is in it, and in what order', null, () => this.menuEditor()));
      body.appendChild(valueRow('Start page', 'The tiles and what they point at', null, () => this.quickAccess()));
      body.appendChild(valueRow('Everything Vex can do', 'The library, with search', String(VexLibrary.count()),
        () => this.library()));

      body.appendChild(heading('Search'));
      body.appendChild(valueRow('Search engine', null,
        (VexSearch.ENGINES[VexSearch.engineId()] || {}).name || '—',
        () => VexSheets.choose('Search engine',
          Object.entries(VexSearch.ENGINES).map(([id, engine]) => ({
            id, label: engine.name, selected: id === VexSearch.engineId()
          })),
          async id => { await VexStore.set('vex.searchEngine', id); VexSheets.close(); this.settings(); })));
      body.appendChild(toggleRow('Search suggestions',
        'What the engine thinks you are typing, as you type it. It sees the letters before you press '
        + 'go — never in a private tab, and never on something that is already an address.',
        VexSearch.suggestionsOn(), async value => {
          await VexStore.set('vex.searchSuggestions', value);
          VexSearch.forgetSuggestions();
        }));
      body.appendChild(valueRow('Homepage', 'What a new tab opens',
        VexStore.get('vex.homepage', '') || 'Start page', async () => {
          const value = await VexUI.prompt('Homepage', 'A URL, or leave it empty for the start page',
            VexStore.get('vex.homepage', ''));
          if (value === null) return;
          await VexStore.set('vex.homepage', value.trim());
          this.settings();
        }));

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
      body.appendChild(toggleRow('Pull down to refresh', null,
        VexStore.get('vex.pullToRefresh', true), async value => {
          await VexStore.set('vex.pullToRefresh', value);
          await VexBridge.setPullToRefresh(value);
        }));

      body.appendChild(heading('Media'));
      body.appendChild(toggleRow('Keep playing in the background', 'Sound continues when you leave Vex',
        VexMedia.backgroundAudio(), value => VexMedia.setBackgroundAudio(value)));
      body.appendChild(toggleRow('Video controls', 'A small bar while something is playing',
        VexStore.get('vex.mediaBar', true), value => VexStore.set('vex.mediaBar', value)));
      body.appendChild(toggleRow('Keep the screen on while reading', null,
        VexStore.get('vex.keepAwake', false), value => VexMedia.setKeepAwake(value)));

      body.appendChild(heading('Privacy and security'));
      body.appendChild(valueRow('Blocking and shield', VexBlock.enabled() ? 'On' : 'Off',
        VexShield.LEVELS[VexShield.level()].label, () => this.privacy()));
      body.appendChild(valueRow('Site permissions', null, null, () => this.permissions()));
      body.appendChild(valueRow('Passwords and 2FA', null,
        String((VexVault.knownHosts() || []).length || ''), () => this.passwords()));
      body.appendChild(valueRow('Your details', 'For sign-up and checkout forms',
        VexVault.hasProfile() ? 'Saved' : 'Not set', () => this.details()));
      body.appendChild(toggleRow('Lock private tabs', 'A fingerprint before they open',
        VexStore.get('vex.lockPrivate', false), async value => {
          if (value && !(await VexBridge.biometricsAvailable())) {
            VexUI.toast('This phone has no fingerprint or PIN set up');
            this.settings();
            return;
          }
          await VexStore.set('vex.lockPrivate', value);
        }));

      body.appendChild(heading('Your data'));
      body.appendChild(valueRow('Sync', VexSync.state.enabled ? VexSync.state.email : 'Off', null, () => this.sync()));
      body.appendChild(valueRow('Assistant', 'Your own worker',
        VexAI.workerUrl() ? 'Configured' : 'Not set', () => this.assistantSettings()));
      const stats = await VexHistory.stats();
      body.appendChild(valueRow('Storage', stats.visits.toLocaleString() + ' visits · '
        + stats.pages.toLocaleString() + ' pages searchable · ' + stats.saved + ' saved', null,
        () => this.storage()));

      body.appendChild(heading('Vex on this phone'));
      body.appendChild(valueRow('Make Vex the default browser',
        (await VexBridge.isDefaultBrowser()) ? 'Vex is the default' : 'Opens Android settings', null,
        () => VexBridge.openDefaultBrowserSettings()));
      body.appendChild(valueRow('Backup',
        'Everything in one encrypted file, for moving to another phone', '',
        () => this.backup()));
      body.appendChild(valueRow('Diagnostics',
        'What this phone is, what its WebView can do, and the last problems', '',
        () => this.diagnostics()));
      body.appendChild(VexSheets.row({
        label: 'Vex for Android',
        note: VexUI.version + ' · ' + (VexBridge.isNative ? 'system WebView' : 'development fallback')
      }));
    },

    // ── Storage ────────────────────────────────────────────────────────────
    async storage() {
      const body = openShell('storage', 'Storage');
      const mine = drawn;
      const stats = await VexHistory.stats();
      if (mine !== drawn) return;
      body.appendChild(heading('What is kept'));
      body.appendChild(valueRow('History', 'Every page you opened', stats.visits.toLocaleString(), () => this.history()));
      body.appendChild(valueRow('Searchable pages', 'The text behind Recall', stats.pages.toLocaleString(), () => this.recall()));
      body.appendChild(valueRow('Saved pages', 'Kept for offline', String(stats.saved), () => this.savedPages()));

      body.appendChild(heading('Keeping it small'));
      body.appendChild(toggleRow('Keep page text for Recall', 'Off means history only remembers titles',
        VexStore.get('vex.recall', true), value => VexStore.set('vex.recall', value)));
      body.appendChild(valueRow('Forget history older than', null,
        VexStore.get('vex.historyDays', 365) + ' days',
        () => VexSheets.choose('Forget history older than',
          [30, 90, 180, 365, 1000].map(days => ({
            id: days, label: days >= 1000 ? 'Never' : days + ' days',
            selected: days === VexStore.get('vex.historyDays', 365)
          })),
          async days => {
            await VexStore.set('vex.historyDays', days);
            VexSheets.close();
            await VexHistory.prune({ historyDays: days });
            this.storage();
          })));

      body.appendChild(heading('Clearing'));
      body.appendChild(valueRow('Clear browsing data', VexClear.describe(),
        VexClear.onExit() ? 'On exit' : '', () => this.clearData()));
    },

    // ── What goes, and when ────────────────────────────────────────────────
    async clearData() {
      const body = openShell('clearData', 'Clear browsing data');
      const mine = drawn;
      const counts = await VexClear.counts();
      if (mine !== drawn) return;

      body.appendChild(el('div', 'field-note',
        'Tick what should go. Your saved logins are not on this list: they are sealed by a key inside '
        + 'this phone’s Keystore and are removed one at a time, from the panel that shows them.'));

      const picked = VexClear.chosen();
      for (const item of VexClear.ITEMS) {
        const count = item.count(counts);
        body.appendChild(toggleRow(item.label,
          item.note + (count ? ' · ' + count.toLocaleString() : ''),
          picked[item.id],
          async value => { await VexClear.setChosen(item.id, value); }));
      }

      body.appendChild(heading('Every time you leave'));
      body.appendChild(toggleRow('Clear when I leave Vex',
        'The same list, minus the open tabs — coming back to an empty browser because you took a '
        + 'phone call is nobody’s idea of privacy',
        VexClear.onExit(), value => VexStore.set('vex.clearOnExit', value)));

      body.appendChild(VexSheets.row({
        label: 'Clear it now', danger: true,
        run: async () => {
          const chosen = VexClear.chosen();
          const names = VexClear.ITEMS.filter(item => chosen[item.id]).map(item => item.label.toLowerCase());
          if (!names.length) { VexUI.toast('Nothing is ticked'); return true; }
          if (!(await VexUI.confirm('Clear ' + names.join(', ') + '?'))) return true;
          const done = await VexClear.run();
          VexUI.toast(done.length ? 'Cleared ' + done.length + ' things' : 'Nothing to clear');
          VexUI.renderToolbar();
          this.clearData();
          return true;
        }
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
        card.onclick = async () => { await VexTheme.set(theme.id); this.appearance(); };
        grid.appendChild(card);
      }
      body.appendChild(grid);
      body.appendChild(el('div', 'field-note',
        'Auto follows the system: Oxford in the light, Midnight in the dark. The rest are the same themes '
        + 'the desktop app ships, generated from the same token file.'));

      body.appendChild(heading('The toolbar'));
      body.appendChild(valueRow('Position', 'Where the address bar lives',
        VexStore.get('vex.toolbarPosition', 'bottom') === 'top' ? 'Top' : 'Bottom',
        () => VexSheets.choose('Toolbar position', [
          { id: 'bottom', label: 'Bottom', note: 'Within reach of your thumb', selected: VexStore.get('vex.toolbarPosition', 'bottom') !== 'top' },
          { id: 'top', label: 'Top', note: 'Where desktop browsers put it', selected: VexStore.get('vex.toolbarPosition', 'bottom') === 'top' }
        ], async position => {
          await VexStore.set('vex.toolbarPosition', position);
          VexUI.applyToolbarPosition();
          VexSheets.close();
          this.appearance();
        })));
      body.appendChild(toggleRow('Hide it while you scroll', 'It comes back when you scroll up',
        VexStore.get('vex.autoHideToolbar', true), async value => {
          await VexStore.set('vex.autoHideToolbar', value);
          if (!value) document.body.classList.remove('toolbar-hidden');
        }));
      body.appendChild(toggleRow('Tint it to the page', 'Follow a site’s theme colour',
        VexStore.get('vex.tintToolbar', true), async value => {
          await VexStore.set('vex.tintToolbar', value);
          if (!value) VexTheme.tintFromPage(null);
          VexUI.renderToolbar();
        }));

      const tabBar = VexStore.get('vex.tabBar', 'auto');
      body.appendChild(valueRow('Tab bar', 'A row of tabs above the page, where there is room for one',
        tabBar === 'on' ? 'Always' : tabBar === 'off' ? 'Never' : 'When there is room',
        () => VexSheets.choose('Tab bar', [
          { id: 'auto', label: 'When there is room', note: 'A tablet, a split screen, a big phone turned sideways', selected: tabBar === 'auto' },
          { id: 'on', label: 'Always', note: 'Even on a phone, where it costs you a line of page', selected: tabBar === 'on' },
          { id: 'off', label: 'Never', note: 'The grid switcher only', selected: tabBar === 'off' }
        ], async choice => {
          await VexStore.set('vex.tabBar', choice);
          VexUI.renderTabStrip();
          VexSheets.close();
          this.appearance();
        })));

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

      body.appendChild(heading('Pages'));
      body.appendChild(toggleRow('Always allow pinch zoom', 'Even where the site forbids it',
        VexStore.get('vex.forceZoom', true), async value => {
          await VexStore.set('vex.forceZoom', value);
          const tab = VexTabStore.active();
          if (tab) await VexSiteRules.applyTo(tab);
        }));
      body.appendChild(valueRow('Contrast', 'For pages that are grey on grey',
        Math.round(Number(VexStore.get('vex.pageContrast', 1)) * 100) + '%',
        () => VexSheets.choose('Page contrast',
          [1, 1.15, 1.3, 1.5].map(value => ({
            id: value, label: Math.round(value * 100) + '%',
            selected: value === Number(VexStore.get('vex.pageContrast', 1))
          })),
          async value => {
            await VexStore.set('vex.pageContrast', value);
            VexSheets.close();
            const tab = VexTabStore.active();
            if (tab) await VexSiteRules.applyTo(tab);
            this.appearance();
          })));
      body.appendChild(valueRow('Night shade', 'Warms the page for reading in the dark',
        Number(VexStore.get('vex.nightShade', 0)) ? Math.round(Number(VexStore.get('vex.nightShade', 0)) * 100) + '%' : 'Off',
        () => VexSheets.choose('Night shade',
          [0, 0.2, 0.35, 0.5].map(value => ({
            id: value, label: value ? Math.round(value * 100) + '%' : 'Off',
            selected: value === Number(VexStore.get('vex.nightShade', 0))
          })),
          async value => {
            await VexStore.set('vex.nightShade', value);
            VexSheets.close();
            const tab = VexTabStore.active();
            if (tab) await VexSiteRules.applyTo(tab);
            this.appearance();
          })));

      body.appendChild(heading('Type'));
      const font = VexStore.get('vex.font', 'system');
      body.appendChild(valueRow('Interface font', null, (VexTheme.FONTS[font] || {}).label || 'System',
        () => VexSheets.choose('Interface font',
          Object.entries(VexTheme.FONTS).map(([id, entry]) => ({ id, label: entry.label, selected: id === font })),
          async id => { await VexTheme.setFont(id); VexSheets.close(); this.appearance(); })));
    },

    // ── Which buttons are on the toolbar ───────────────────────────────────
    toolbarButtons() {
      const body = openShell('toolbarButtons', 'Toolbar buttons', {
        action: {
          label: 'Reset',
          run: async () => { await VexStore.set('vex.toolbarButtons', null); VexUI.renderToolbar(); this.toolbarButtons(); }
        }
      });
      body.appendChild(el('div', 'field-note',
        'Up to three either side of the address bar. The pill in the middle is always there.'));

      const config = VexUI.buttonConfig();
      for (const side of ['left', 'right']) {
        body.appendChild(heading(side === 'left' ? 'Left of the address bar' : 'Right of it'));
        for (const [id, spec] of Object.entries(VexUI.BUTTONS)) {
          const on = config[side].includes(id);
          body.appendChild(toggleRow(spec.label, null, on, async value => {
            const next = {
              left: config.left.filter(entry => entry !== id),
              right: config.right.filter(entry => entry !== id)
            };
            if (value) {
              if (next[side].length >= 3) { VexUI.toast('Three a side is the limit'); this.toolbarButtons(); return; }
              next[side] = next[side].concat(id);
            }
            await VexStore.set('vex.toolbarButtons', next);
            VexUI.renderToolbar();
            this.toolbarButtons();
          }));
        }
      }
    },

    // ── Your details, for forms ────────────────────────────────────────────
    details() {
      const body = openShell('details', 'Your details');
      body.appendChild(el('div', 'field-note',
        'What Vex types into a sign-up or checkout form when you ask it to, from the menu. It stays on '
        + 'the phone, it is never sent anywhere, and card numbers are deliberately not here.'));
      const profile = VexVault.profile();
      const inputs = {};
      for (const [key, label] of VexVault.PROFILE_FIELDS) {
        const field = el('div', 'field stack');
        field.appendChild(el('label', { for: 'profile-' + key }, label));
        const input = el('input', { id: 'profile-' + key, type: 'text', value: profile[key] || '' });
        inputs[key] = input;
        field.appendChild(input);
        body.appendChild(field);
      }
      const save = el('button', { class: 'pill-btn', style: 'margin: 10px 16px; width: calc(100% - 32px)' }, 'Save');
      save.onclick = async () => {
        const next = {};
        for (const [key] of VexVault.PROFILE_FIELDS) next[key] = inputs[key].value;
        await VexVault.saveProfile(next);
        VexUI.toast('Saved');
      };
      body.appendChild(save);
      if (VexVault.hasProfile()) {
        body.appendChild(VexSheets.row({
          label: 'Forget these details', danger: true,
          run: async () => { await VexVault.saveProfile({}); this.details(); return true; }
        }));
      }
    },

    // ── Tabs ───────────────────────────────────────────────────────────────
    tabsSettings() {
      const body = openShell('tabsSettings', 'Tabs');
      body.appendChild(toggleRow('Open links in a new tab', 'Instead of replacing this page',
        VexStore.get('vex.linksInNewTab', false), value => VexStore.set('vex.linksInNewTab', value)));
      body.appendChild(toggleRow('Restore tabs when Vex starts', null,
        VexStore.get('vex.restoreTabs', true), value => VexStore.set('vex.restoreTabs', value)));
      body.appendChild(valueRow('Close old tabs', 'Tabs you have not touched',
        (() => { const days = VexStore.get('vex.closeTabsAfter', 0); return days ? 'after ' + days + ' days' : 'Never'; })(),
        () => VexSheets.choose('Close tabs you have not opened', [
          { id: 0, label: 'Never' }, { id: 7, label: 'After a week' },
          { id: 30, label: 'After a month' }, { id: 90, label: 'After three months' }
        ].map(option => Object.assign(option, { selected: option.id === VexStore.get('vex.closeTabsAfter', 0) })),
        async days => {
          await VexStore.set('vex.closeTabsAfter', days);
          VexSheets.close();
          this.tabsSettings();
        })));
      body.appendChild(toggleRow('Confirm before closing them all', null,
        VexStore.get('vex.confirmCloseAll', true), value => VexStore.set('vex.confirmCloseAll', value)));
      body.appendChild(el('div', 'field-note',
        'Android already freezes tabs you are not looking at, so Vex does not need the desktop’s '
        + 'sleep timer. Closing old tabs is the phone version of that.'));
    },

    // ── The menu, rearranged ───────────────────────────────────────────────
    menuEditor() {
      const body = openShell('menuEditor', 'Menu', {
        action: {
          label: 'Reset',
          run: async () => {
            await VexStore.set('vex.menuOrder', VexSheets.DEFAULT_ORDER.slice());
            await VexStore.set('vex.menuHidden', []);
            this.menuEditor();
          }
        }
      });
      body.appendChild(el('div', 'field-note',
        'Everything in the menu, in the order it appears. Move what you use to the top, switch off what '
        + 'you never touch.'));

      const order = VexSheets.menuOrder();
      const hidden = VexSheets.hidden();
      for (let index = 0; index < order.length; index++) {
        const id = order[index];
        const action = VexSheets.ACTIONS[id];
        if (!action) continue;
        const node = el('div', 'list-row');
        node.appendChild((() => { const wrap = el('span', 'row-icon'); wrap.appendChild(icon(action.icon)); return wrap; })());
        const lines = el('div', 'lines');
        lines.appendChild(el('span', 't', action.label));
        node.appendChild(lines);

        const actions = el('div', 'row-actions');
        for (const [direction, iconName, label] of [[-1, 'up', 'Move up'], [1, 'down', 'Move down']]) {
          const button = el('button', { 'aria-label': label });
          button.appendChild(icon(iconName));
          button.onclick = async () => {
            const next = order.slice();
            const target = index + direction;
            if (target < 0 || target >= next.length) return;
            [next[index], next[target]] = [next[target], next[index]];
            await VexStore.set('vex.menuOrder', next);
            this.menuEditor();
          };
          actions.appendChild(button);
        }
        node.appendChild(actions);

        const knob = el('span', 'switch' + (hidden.has(id) ? '' : ' on'));
        knob.onclick = async () => {
          const next = new Set(hidden);
          if (next.has(id)) next.delete(id); else next.add(id);
          await VexStore.set('vex.menuHidden', [...next]);
          this.menuEditor();
        };
        node.appendChild(knob);
        body.appendChild(node);
      }
    },

    // ── The start page's tiles ─────────────────────────────────────────────
    quickAccess() {
      const body = openShell('quickAccess', 'Start page', {
        action: {
          label: 'Add',
          run: async () => {
            const url = await VexUI.prompt('Add a tile', 'Address');
            if (!url) return;
            await VexCollections.quick.add({ url: VexSearch.toUrl(url), title: '' });
            VexSync.schedulePush();
            this.quickAccess();
          }
        }
      });

      const pinned = VexCollections.quick.all();
      body.appendChild(el('div', 'field-note', pinned.length
        ? 'Your tiles, in the order they appear. An empty list goes back to showing the sites you visit most.'
        : 'The start page shows the sites you visit most. Pin a tile and the grid becomes yours instead, '
          + 'and stops rearranging itself.'));

      if (!pinned.length) {
        body.appendChild(heading('Most visited right now'));
        for (const site of VexHistory.topSites(8)) {
          body.appendChild(listRow({ url: site.url, title: site.host, icon: site.icon }, {
            sub: () => 'Tap to pin it',
            onOpen: async () => {
              await VexCollections.quick.add({ url: site.url, title: site.host, icon: site.icon });
              VexSync.schedulePush();
              this.quickAccess();
            }
          }));
        }
        return;
      }

      for (const entry of pinned) {
        body.appendChild(listRow(entry, {
          sub: item => item.url,
          actions: [
            { icon: 'up', label: 'Move up', run: async item => { await VexCollections.quick.move(item.url, -1); this.quickAccess(); } },
            { icon: 'down', label: 'Move down', run: async item => { await VexCollections.quick.move(item.url, 1); this.quickAccess(); } }
          ],
          onRemove: async item => {
            await VexCollections.quick.remove(item.url);
            VexSync.schedulePush();
            this.quickAccess();
          }
        }));
      }
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
        fetchedAt ? 'Last updated ' + when(fetchedAt) : 'Never updated — the built-in list is in use', '',
        async () => {
          VexUI.toast('Updating filter lists…');
          const merged = await VexBlock.refresh();
          VexUI.toast(merged ? 'Filter lists updated' : 'Could not reach the lists');
          this.privacy();
        }));
      const blocked = Number(VexStore.get('vex.blockedTotal', 0));
      if (blocked) {
        body.appendChild(heading('What has been blocked'));
        body.appendChild(el('div', 'field-note', blocked.toLocaleString() + ' requests, since you installed Vex.'));
        const worst = VexBlock.worstSites(8);
        for (const site of worst) {
          body.appendChild(VexSheets.row({
            label: site.host,
            value: site.count.toLocaleString(),
            run: () => { VexSheets.site(site.host); return true; }
          }));
        }
      }

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
      body.appendChild(toggleRow('Block pop-ups', 'A page can still open a window you tapped for',
        VexStore.get('vex.blockPopups', true), value => VexStore.set('vex.blockPopups', value)));

      body.appendChild(heading('Sites'));
      body.appendChild(valueRow('Site permissions', 'Camera, microphone, location', null, () => this.permissions()));
      body.appendChild(toggleRow('Keep page text for Recall', 'Searchable, on the device only',
        VexStore.get('vex.recall', true), value => VexStore.set('vex.recall', value)));
    },

    // ── Assistant settings ─────────────────────────────────────────────────
    async assistantSettings() {
      const body = openShell('assistant', 'Assistant');
      const hasToken = await VexAI.hasToken();

      body.appendChild(el('div', 'field-note',
        'Vex AI talks to a Cloudflare Worker you deploy yourself (SELF_HOSTING.md in the repo). Nothing '
        + 'here points at anyone else’s backend, and the token is kept in the Android Keystore rather '
        + 'than in a settings file.'));

      const urlField = el('div', 'field stack');
      urlField.appendChild(el('label', { for: 'ai-url' }, 'Worker URL'));
      const urlInput = el('input', {
        id: 'ai-url', type: 'url', placeholder: 'https://your-worker.workers.dev',
        value: VexAI.workerUrl(), autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false'
      });
      urlInput.onchange = async () => {
        try { await VexAI.setWorkerUrl(urlInput.value); VexUI.toast('Saved'); }
        catch (error) { VexUI.toast(error.message); }
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
        } catch (error) { VexUI.toast(error.message); }
      };
      tokenField.appendChild(tokenInput);
      body.appendChild(tokenField);

      if (hasToken) {
        body.appendChild(VexSheets.row({
          label: 'Forget the token', danger: true,
          run: async () => { await VexAI.setToken(''); this.assistantSettings(); return true; }
        }));
      }

      body.appendChild(heading('What it remembers'));
      const memory = VexAI.memory();
      if (!memory.length) {
        body.appendChild(el('div', 'field-note',
          'Nothing yet. Tell it something worth keeping — "I read in Turkish", "I prefer short answers" — '
          + 'and it goes with every question from then on.'));
      }
      for (const fact of memory) {
        body.appendChild(VexSheets.row({
          label: fact,
          run: async () => {
            if (await VexUI.confirm('Forget that?')) { await VexAI.forget(fact); this.assistantSettings(); }
            return true;
          }
        }));
      }
      body.appendChild(valueRow('Remember something', null, '', async () => {
        const fact = await VexUI.prompt('Remember this', 'One line the assistant should always know');
        if (!fact) return;
        await VexAI.remember(fact);
        this.assistantSettings();
      }));

      body.appendChild(heading('Checks'));
      body.appendChild(valueRow('Test the connection', null, '', async () => {
        VexUI.toast('Asking the worker…');
        try {
          await VexAI.ask('Reply with the single word: ready.', { context: null });
          VexUI.toast('The worker answered');
        } catch (error) { VexUI.toast(error.message, 4000); }
      }));
      body.appendChild(el('div', 'field-note',
        'Private tabs never send page text to the worker, and a question is always sent with the page you '
        + 'were on when you asked it — not the one you have since moved to.'));

      body.appendChild(heading('On this phone'));
      const localMode = VexLocalAI.mode();
      body.appendChild(valueRow('On-device AI',
        'A model that runs inside Vex, and Gemini Nano where the phone has it',
        localMode === 'off' ? 'Off' : localMode === 'only' ? 'On-device only' : 'Preferred',
        () => this.localAI()));
    },

    /**
     * One file with everything in it, for moving to another phone.
     *
     * The passphrase is asked for twice — once to make the file, once to open it
     * — and never stored: there is nowhere to store it that would not defeat the
     * point. What the backup cannot carry is said before it is made rather than
     * discovered afterwards.
     */
    async backup() {
      const body = openShell('backup', 'Backup');
      const withHistory = VexStore.get('vex.backupHistory', false) === true;
      const mine = drawn;
      const counts = await VexBackup.summary({ history: withHistory });
      if (mine !== drawn) return;

      body.appendChild(el('div', 'field-note',
        'One file, encrypted with a passphrase you choose, holding every setting, your bookmarks and '
        + 'folders, the reading list, sessions, quick access, tab groups, site rules, permissions and '
        + 'notes. It cannot carry your saved logins — those are sealed by a key inside this phone’s '
        + 'Keystore and cannot leave it, which is the point of the vault — and it does not carry saved '
        + 'pages, because a backup you cannot email is not much of a backup.'));

      body.appendChild(VexSheets.row({
        icon: 'info', label: 'What is in it',
        note: counts.settings + ' settings · ' + counts.bookmarks + ' bookmarks · '
          + counts.reading + ' to read · ' + counts.sessions + ' sessions · '
          + counts.rules + ' site rules · ' + counts.notes + ' notes'
          + (withHistory ? ' · ' + counts.history + ' visits' : '')
      }));

      body.appendChild(toggleRow('Include history',
        'The last ' + VexBackup.HISTORY_CAP.toLocaleString() + ' pages you visited. It makes the file '
        + 'much bigger, and it is the most personal thing in it.',
        withHistory, async value => {
          await VexStore.set('vex.backupHistory', value);
          this.backup();
        }));

      body.appendChild(valueRow('Make a backup', 'Saved to your Downloads folder', '', async () => {
        const passphrase = await VexUI.prompt('A passphrase for this file',
          'Eight characters or more. There is no way to recover the file without it — not by Vex, not '
          + 'by anyone.');
        if (!passphrase) return;
        VexUI.toast('Writing…');
        try {
          const text = await VexBackup.write(passphrase, { history: withHistory });
          const stamp = new Date().toISOString().slice(0, 10);
          VexUI.downloadText('vex-backup-' + stamp + '.vexbak', text, 'application/json');
        } catch (error) {
          VexUI.toast(error.message, 4500);
        }
      }));

      body.appendChild(heading('Putting one back'));
      body.appendChild(el('div', 'field-note',
        'A restore replaces what is here — settings, bookmarks, the lot — rather than merging, because '
        + 'a merge leaves you with neither phone’s arrangement. Notes and history are added to what you '
        + 'already have.'));
      body.appendChild(valueRow('Restore from a file', null, '', () => {
        VexUI.pickTextFile(async text => {
          let envelope;
          try { envelope = JSON.parse(text); }
          catch { VexUI.toast('That file is not a Vex backup'); return; }
          const passphrase = await VexUI.prompt('The passphrase for this file', '');
          if (!passphrase) return;
          VexUI.toast('Opening…');
          let data;
          try { data = await VexBackup.decrypt(envelope, passphrase); }
          catch (error) { VexUI.toast(error.message, 5000); return; }

          const inside = Object.keys(data.settings || {}).length;
          const ok = await VexUI.confirm(
            'This backup was made ' + VexDom.when(envelope.at) + ' and holds ' + inside + ' settings, '
            + ((data.settings || {})['vex.bookmarks'] || []).length + ' bookmarks and '
            + (data.notes || []).length + ' notes. Replace what is on this phone?', 'Restore');
          if (!ok) return;
          const applied = await VexBackup.restore(data);
          await VexUI.offer('Restored ' + applied.settings + ' settings, ' + applied.notes + ' notes and '
            + applied.history + ' visits. Vex has to restart to pick all of it up.', 'Restart now', 'Done');
          location.reload();
        }, '.vexbak,application/json,.json');
      }));
    },

    /**
     * What this phone is, and what has gone wrong on it.
     *
     * Vex has no crash reporter and is not getting one, so this is where a
     * problem goes instead: the last hundred failures, on the device, with one
     * button that copies the lot as text for pasting into a bug report. The
     * WebView's feature list is here because half of what Vex does is
     * conditional on it, and when one of those things silently does nothing this
     * is the page that says why.
     */
    async diagnostics() {
      const body = openShell('diagnostics', 'Diagnostics');
      const mine = drawn;
      const device = await VexReport.device();
      if (mine !== drawn) return;
      const features = device.webviewFeatures || {};

      body.appendChild(heading('This phone'));
      body.appendChild(VexSheets.row({
        icon: 'info', label: device.device || 'Unknown device',
        note: 'Android ' + (device.android || '?') + ' · API ' + (device.sdk || '?')
          + (device.abi ? ' · ' + device.abi : '')
      }));
      body.appendChild(VexSheets.row({
        icon: 'globe', label: 'WebView',
        note: (device.webview || 'unknown') + ' ' + (device.webviewVersion || '')
      }));
      if (Number(device.freeBytes) > 0) {
        body.appendChild(VexSheets.row({
          icon: 'save', label: 'Free space',
          note: (Number(device.freeBytes) / 1073741824).toFixed(1) + ' GB'
        }));
      }

      body.appendChild(heading('What this WebView can do'));
      const FEATURES = [
        ['multiProfile', 'Separate cookie jar for private tabs',
          'Without it, private tabs still leave no history, but they share cookies with the rest.'],
        ['documentStartScript', 'The fingerprint shield, before page scripts',
          'Without it the shield runs at page start, which a fast tracker can beat.'],
        ['algorithmicDarkening', 'Dark mode for pages that have none',
          'Without it, "dark pages" does nothing on sites with no dark theme of their own.']
      ];
      for (const [key, label, why] of FEATURES) {
        body.appendChild(VexSheets.row({
          icon: features[key] ? 'check' : 'close',
          label, note: features[key] ? 'Yes' : 'No — ' + why
        }));
      }

      body.appendChild(heading('Storage'));
      const stats = await VexHistory.stats();
      body.appendChild(VexSheets.row({
        icon: 'history', label: stats.visits.toLocaleString() + ' visits',
        note: stats.pages.toLocaleString() + ' pages searchable · ' + stats.saved + ' saved offline',
        run: async () => { await this.storage(); return true; }
      }));

      body.appendChild(heading('The last problems'));
      const errors = await VexReport.all(40);
      if (!errors.length) {
        body.appendChild(el('div', 'field-note',
          'Nothing has gone wrong since this was last cleared. Errors are kept on the phone and sent '
          + 'nowhere: there is no crash reporter in Vex.'));
      }
      for (const entry of errors) {
        body.appendChild(VexSheets.row({
          icon: entry.kind === 'note' ? 'info' : 'warning',
          label: entry.message || 'Something failed',
          note: VexDom.when(entry.at) + (entry.where ? ' · ' + entry.where : ''),
          run: async () => { await VexUI.offer(entry.message + (entry.where ? '\n\n' + entry.where : ''), 'Copy', 'Problem')
            && VexUI.copy(entry.message + ' ' + entry.where); return true; }
        }));
      }

      body.appendChild(heading('For a bug report'));
      body.appendChild(valueRow('Copy all of this as text',
        'The phone, the WebView, what it can do, and the last twenty problems', '', async () => {
          await VexUI.copy(await VexReport.asText());
          VexUI.toast('Copied');
        }));
      if (errors.length) {
        body.appendChild(VexSheets.row({
          icon: 'close', label: 'Clear the list', danger: true,
          run: async () => { await VexReport.clear(); this.diagnostics(); return true; }
        }));
      }
    },

    /**
     * The on-device page. Two backends with nothing in common except that
     * neither sends your reading anywhere: a model you put on the phone, and
     * Gemini Nano, whose weights belong to the system.
     */
    async localAI() {
      const body = openShell('localai', 'On-device AI');
      await VexLocalAI.refresh();
      const state = VexLocalAI.state;
      const installed = VexLocalAI.installed();
      const chosen = VexLocalAI.chosenModel();

      if (!state.supported) {
        body.appendChild(el('div', 'field-note',
          'This phone cannot run a model inside Vex: the engine ships for 64-bit ARM only. '
          + 'Gemini Nano below may still work.'));
      }

      body.appendChild(heading('A model of your own'));
      body.appendChild(el('div', 'field-note',
        'LiteRT-LM runs a .litertlm model in Vex’s own process — no network, no account, and it keeps '
        + 'working with the aeroplane mode on. The models worth running are Gemma’s, which are behind a '
        + 'licence you accept in a browser; Vex is a browser, so: open the model’s page, accept, download '
        + 'the .litertlm, then tap Import. Vex offers to import any .litertlm it downloads.'));

      const mode = VexLocalAI.mode();
      body.appendChild(valueRow('Use it',
        mode === 'only'
          ? 'Nothing is sent to the worker, and a failure here is a failure'
          : mode === 'prefer'
            ? 'Asks the model first, falls back to your worker'
            : 'Off — every question goes to your worker',
        mode === 'off' ? 'Off' : mode === 'only' ? 'On-device only' : 'Prefer on-device',
        () => VexSheets.choose('On-device AI', [
          { id: 'off', label: 'Off', note: 'The worker answers everything', selected: mode === 'off' },
          { id: 'prefer', label: 'Prefer on-device', note: 'Chat, summaries, translation and explanations stay here', selected: mode === 'prefer' },
          { id: 'only', label: 'On-device only', note: 'Nothing leaves the phone, even when the model cannot cope', selected: mode === 'only' }
        ], async choice => {
          await VexLocalAI.setMode(choice);
          VexSheets.close();
          this.localAI();
        })));

      if (state.downloading) {
        const { received, total } = state.downloading;
        const mb = bytes => (bytes / 1048576).toFixed(0) + ' MB';
        body.appendChild(VexSheets.row({
          icon: 'download', label: 'Downloading ' + state.downloading.name,
          note: total > 0
            ? mb(received) + ' of ' + mb(total) + ' · ' + Math.floor(100 * received / total) + '%'
            : mb(received) + ' so far',
          value: 'Stop',
          run: async () => { await VexLocalAI.cancelDownload(); this.localAI(); return true; }
        }));
      }

      for (const entry of VexLocalAI.MODELS) {
        const here = installed.includes(entry.name);
        const size = here ? ((Number(state.models[entry.name]) || 0) / 1048576).toFixed(0) + ' MB on disk' : entry.size;
        body.appendChild(VexSheets.row({
          icon: here ? 'check' : 'download',
          label: entry.label + (chosen === entry.name ? ' · in use' : ''),
          note: entry.note + ' · ' + size,
          run: async () => {
            VexSheets.choose(entry.label, [
              here ? { id: 'use', label: 'Use this model', note: chosen === entry.name ? 'Already chosen' : '' } : null,
              { id: 'page', label: here ? 'Open its page' : 'Open its page to download it',
                note: 'Accept the licence, download the .litertlm, then come back and import' },
              { id: 'import', label: 'Import a .litertlm file', note: 'From your downloads' },
              { id: 'url', label: 'Download from a URL', note: 'A direct link; resumes if it drops' },
              here ? { id: 'delete', label: 'Delete it from this phone', danger: true } : null
            ].filter(Boolean), async choice => {
              VexSheets.close();
              if (choice === 'use') { await VexLocalAI.setModel(entry.name); this.localAI(); }
              if (choice === 'page') { VexPanels.close(); VexUI.openUrl(entry.page, { newTab: true }); }
              if (choice === 'import') {
                if (await VexLocalAI.importFile(entry.name)) VexUI.toast('Copying it in…');
              }
              if (choice === 'url') {
                const url = await VexUI.prompt('Download ' + entry.label, 'A direct link to the .litertlm file');
                if (!url) return;
                const token = await VexUI.prompt('Access token', 'Only if the link needs one — leave empty otherwise');
                await VexLocalAI.download(entry.name, url, token || '');
                this.localAI();
              }
              if (choice === 'delete') {
                if (await VexUI.confirm('Delete ' + entry.label + '?')) { await VexLocalAI.remove(entry.name); this.localAI(); }
              }
            });
            return true;
          }
        }));
      }

      const backend = VexLocalAI.chosenBackend();
      const backendSpec = VexLocalAI.BACKENDS.find(entry => entry.id === backend);
      body.appendChild(valueRow('Run it on', backendSpec ? backendSpec.note : '',
        backendSpec ? backendSpec.label : backend,
        () => VexSheets.choose('Run the model on', VexLocalAI.BACKENDS.map(entry => ({
          id: entry.id, label: entry.label, note: entry.note, selected: entry.id === backend
        })), async choice => {
          await VexLocalAI.setBackend(choice);
          VexSheets.close();
          this.localAI();
        })));

      if (state.loaded) {
        body.appendChild(VexSheets.row({
          icon: 'close', label: 'Unload it from memory',
          note: state.model + ' on the ' + state.backend.toUpperCase() + ' · frees a gigabyte or two of RAM',
          run: async () => { await VexLocalAI.unload(); this.localAI(); return true; }
        }));
      } else if (chosen && installed.includes(chosen)) {
        body.appendChild(valueRow('Load it now',
          'Takes a few seconds; the first load after a download takes longest', '', async () => {
            VexUI.toast('Loading ' + chosen + '…');
            const ok = await VexLocalAI.load();
            VexUI.toast(ok ? 'Ready' : (VexLocalAI.state.lastError || 'It would not load'), 4000);
            this.localAI();
          }));
      }

      if (state.lastError) body.appendChild(el('div', 'field-note', state.lastError));

      body.appendChild(heading('Gemini Nano'));
      const nano = await VexLocalAI.refreshNano();
      body.appendChild(el('div', 'field-note',
        nano === 'available'
          ? 'This phone has Nano, and it is ready. Nothing to download, nothing stored by Vex: the weights '
            + 'belong to Android. It does three things — summarise, proofread, rewrite — and it is quick.'
          : nano === 'downloadable'
            ? 'This phone has Nano, but Android has not fetched the weights yet. It is a one-off, and shared '
              + 'with every other app that uses them.'
            : nano === 'downloading'
              ? 'Android is fetching Nano’s weights now.'
              : 'This phone has no Gemini Nano. It needs AICore — a Galaxy S25 or a Pixel 9 and up have it.'));

      if (nano === 'downloadable') {
        body.appendChild(valueRow('Get Nano ready', null, '', async () => {
          VexUI.toast('Asking Android for Nano…');
          try { await VexLocalAI.nanoDownload(); VexUI.toast('Nano is ready'); }
          catch (error) { VexUI.toast(error.message, 4000); }
          this.localAI();
        }));
      }

      if (nano === 'available') {
        body.appendChild(toggleRow('Summarise with Nano',
          'Page summaries answered on the phone, instantly, instead of by your worker',
          VexLocalAI.nanoMode(), async value => { await VexLocalAI.setNano(value); }));
        body.appendChild(valueRow('Try it', 'Summarise the page you are on', '', async () => {
          const tab = VexTabStore.active();
          if (!tab || !tab.url || tab.url === 'about:blank') { VexUI.toast('Open a page first'); return; }
          VexUI.toast('Asking Nano…');
          try {
            const text = await VexReader.pageText(tab.id, 4000);
            const summary = await VexLocalAI.nanoSummarize(text, 3);
            await VexUI.confirm(summary || 'Nano had nothing to say about this page');
          } catch (error) { VexUI.toast(error.message, 4000); }
        }));
      }
    }
  };
})();

if (typeof window !== 'undefined') window.VexPanels = VexPanels;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPanels };
