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
  // A panel that keeps itself current — the 2FA codes, a download's progress —
  // ticks on this, and every other panel opening stops it.
  let ticker = null;
  // Which drawing a body belongs to. Several panels fill themselves from
  // IndexedDB, and the search field re-opens the panel on every keystroke, so
  // an answer can arrive after its body has been cleared and refilled by a
  // later one — two sets of rows in one list, the stale ones underneath.
  // Each draw takes a number and stops if the number has moved on.
  let drawn = 0;
  let localAIFollowed = false;
  let historyFrom = 'phone';         // History shows this phone's visits or the computer's

  function openShell(name, title, { search, action } = {}) {
    drawn++;
    stopTicker();
    // Drawn again in place — a toggle flipped, a choice made at the bottom of
    // Appearance — keeps its place. Every redraw used to put you back at the
    // top, a long way from the row you had just changed. Typing in the search
    // field is the exception: new results start at the top.
    const redraw = !$('panel').hidden && stack[stack.length - 1] === name
      && document.activeElement !== $('panel-search-input');
    const keep = redraw ? $('panel-body').scrollTop : 0;
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
    // Coming back to the panel underneath — Save on "Add a login" returning
    // to Passwords — is going back to it, not forward again: left as a push,
    // Back from there walked into the form you had just saved. Only the one
    // underneath: a panel reached by another road keeps the road behind it.
    if (stack[stack.length - 2] === name) stack.pop();
    else if (stack[stack.length - 1] !== name) stack.push(name);
    if ($('panel').hidden) {
      $('panel').hidden = false;
      VexUI.cover(true);
    }
    if (keep > 0) holdScroll($('panel-body'), keep, drawn);
    return $('panel-body');
  }

  // The rows arrive after this returns — at once for most panels, after an
  // IndexedDB read for some — so the place is put back once there is enough
  // page under it, giving up after a third of a second or a newer drawing.
  function holdScroll(node, top, mine) {
    let tries = 0;
    const put = () => {
      if (mine !== drawn) return;
      node.scrollTop = top;
      if (node.scrollTop < top - 1 && ++tries < 10) setTimeout(put, 35);
    };
    requestAnimationFrame(put);
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
    stopTicker();
    // A draw still waiting on IndexedDB, or a tick still waiting on the
    // download queue, belongs to a panel that is no longer there.
    drawn++;
    if ($('panel').hidden) return;
    $('panel').hidden = true;
    $('panel-search').hidden = true;
    VexUI.cover(false);
  }

  // Which of the desktop's notes the editor last had open, for Back.
  let lastSyncedNote = null;

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
    syncedNotes: () => VexPanels.syncedNotes(),
    syncedNote: () => VexPanels.syncedNote(lastSyncedNote),
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
    computerTabs: () => VexPanels.computerTabs(),
    aiLab: () => VexLab.home(),
    labChat: () => VexLab.open('chat'),
    labImage: () => VexLab.open('image'),
    labAudio: () => VexLab.open('audio'),
    labPrompt: () => VexLab.open('prompt'),
    labAgent: () => VexLab.open('agent'),
    labGarden: () => VexLab.open('garden'),
    labActions: () => VexLab.open('actions'),
    labScrap: () => VexLab.open('scrapbook'),
    diagnostics: () => VexPanels.diagnostics(),
    backup: () => VexPanels.backup(),
    privacy: () => VexPanels.privacy(),
    // Two panels used to open under their parent's name, which left Back with
    // nothing to pop and closed the whole panel instead of stepping up one.
    storage: () => VexPanels.storage(),
    clearData: () => VexPanels.clearData(),
    customEngine: () => VexPanels.customEngine(),
    translation: () => VexPanels.translation(),
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
  function listRow(entry, options = {}) {
    const { onOpen, onRemove, sub, actions } = options;
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
      // Swiped aside does what the × does — the same Undo follows.
      VexGestures.dismiss(node, () => onRemove(entry));
    }
    if (entry.url) {
      VexGestures.longPress(node, () => VexSheets.link({ link: entry.url, forget: options.forget }));
    }
    return node;
  }

  const empty = text => el('div', 'list-empty', text);
  // Every removal from a list can be taken back for a few seconds — a swipe is
  // easier to do by accident than a tap on the ×, and both are one gesture.
  const undo = (message, restore) => VexUI.toast(message, 4500, { label: 'Undo', run: restore });
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

  function stopTicker() {
    clearInterval(ticker);
    ticker = null;
  }

  // ── The system download queue ───────────────────────────────────────────
  async function downloadQueue() {
    try {
      const status = await VexBridge.downloadStatus();
      return (status && status.downloads) || [];
    } catch { return []; }
  }

  // A row's place in the queue: by the queue's own id when the row has one,
  // otherwise the newest entry for the same address.
  function queued(live, entry) {
    if (entry.downloadId) return live.find(item => String(item.id) === String(entry.downloadId)) || null;
    if (!/^https?:/i.test(entry.url || '')) return null;
    return live.filter(item => item.url === entry.url)
      .sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
  }

  // DownloadManager's statuses: 1 pending, 2 running, 4 paused (waiting for a
  // network, usually), 8 done, 16 failed. Gone from the queue counts as done —
  // the file outlives the queue's memory of it.
  function downloadState(match) {
    if (!match || match.status === 8) return 'done';
    if (match.status === 16) return 'failed';
    return 'running';
  }

  function percent(match) {
    return match && match.total > 0 ? Math.min(100, Math.round((match.downloaded / match.total) * 100)) : 0;
  }

  function downloadNote(state, entry, match) {
    if (state === 'failed') return 'failed — tap to try the page again';
    if (state === 'done') return bytes(entry.size || (match && match.total));
    if (match && match.status === 4) return 'waiting for a connection';
    if (match && match.total > 0) return bytes(match.downloaded) + ' of ' + bytes(match.total);
    return 'downloading…';
  }

  /**
   * Where one row of the downloads list stands: { state, percent, note, stop,
   * match, why }. A row is either a file in Android's queue or a video stream
   * Vex is putting together itself, and the list draws both the same way.
   */
  function progressOf(entry, live) {
    if (entry.streamJob) {
      if (entry.streamDone) return { state: 'done', note: bytes(entry.size) };
      if (entry.streamFailed) return { state: 'failed', why: entry.streamFailed, note: 'failed — ' + entry.streamFailed };
      const job = VexDownloads.streamState(entry.streamJob);
      // Native forgets a job when Vex is killed; the half-written file went
      // with it.
      if (!job) return { state: 'failed', why: 'It stopped when Vex was closed', note: 'stopped when Vex closed' };
      if (job.state === 'done') return { state: 'done', note: bytes(job.bytes) };
      if (job.state !== 'running') return { state: 'failed', why: job.why || 'It did not finish', note: 'failed — ' + (job.why || 'it did not finish') };
      return {
        state: 'running',
        percent: job.total > 0 ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0,
        note: job.total > 0 ? job.done + ' of ' + job.total + ' pieces · ' + bytes(job.bytes) : 'reading the playlist…',
        stop: () => VexDownloads.cancelStream(entry.streamJob)
      };
    }
    const match = queued(live, entry);
    const state = downloadState(match);
    return {
      state, match,
      percent: percent(match),
      note: downloadNote(state, entry, match),
      stop: match ? () => VexBridge.cancelDownload(match.id) : null
    };
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
    /** The name of the panel showing, or '' when none is. */
    top() { return $('panel').hidden ? '' : (stack[stack.length - 1] || ''); },
    markOpen(name) { if (stack[stack.length - 1] !== name) stack.push(name); },

    // ── History ────────────────────────────────────────────────────────────
    async history(query = '') {
      const computer = typeof VexSync !== 'undefined' && VexSync.remoteHistory('', 1).length > 0;
      if (!computer) historyFrom = 'phone';
      const body = openShell('history', 'History', {
        search: { value: query, placeholder: 'Search history', onInput: value => this.history(value) },
        action: historyFrom === 'computer' ? null : {
          label: 'Clear',
          run: async () => { await VexHistory.clear(); this.history(); VexUI.toast('History cleared'); }
        }
      });
      const mine = drawn;
      // With Vex Sync on, the computer's history is here too, read-only: it is
      // the computer's, and clearing it is done there.
      if (computer) {
        const chips = el('div', 'panel-chips');
        for (const [id, label] of [['phone', 'On this phone'], ['computer', 'On your computer']]) {
          chips.appendChild(el('button', {
            class: 'chip' + (historyFrom === id ? ' on' : ''),
            onclick: () => { historyFrom = id; this.history(query); }
          }, label));
        }
        body.appendChild(chips);
      }
      if (historyFrom === 'computer') {
        const rows = VexSync.remoteHistory(query, 400);
        if (!rows.length) {
          body.appendChild(empty(query ? 'Nothing from your computer matches “' + query + '”.' : 'Nothing from your computer yet.'));
          return;
        }
        let lastDay = '';
        for (const entry of rows) {
          const day = dayName(entry.at);
          if (day !== lastDay) { lastDay = day; body.appendChild(heading(day)); }
          body.appendChild(listRow(entry, {
            sub: item => VexSearch.prettyHost(item.url) + (item.at ? ' · ' + when(item.at) : ''),
            onOpen: item => { close(); VexUI.openUrl(item.url); }
          }));
        }
        body.appendChild(el('div', 'field-note', 'Your computer’s history, as of the last sync. Clear it on the computer.'));
        return;
      }
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
          onRemove: async item => {
            await VexHistory.remove(item);
            this.history(query);
            undo('Removed from history', async () => { await VexHistory.restore(item); this.history(query); });
          },
          // Long-pressing a row in a list of where you have been is where
          // "I would rather this site were not here" belongs.
          forget: () => this.history(query)
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
          onOpen: item => { close(); VexUI.openUrl(item.url); },
          forget: () => this.recall(query)
        }));
      }
    },

    // ── What is open on the computer ───────────────────────────────────────
    computerTabs(query = '') {
      const body = openShell('computerTabs', 'Your computer', {
        search: { value: query, placeholder: 'Search its tabs', onInput: value => this.computerTabs(value) }
      });
      if (typeof VexSync === 'undefined' || !VexSync.state.enabled) {
        body.appendChild(empty('Sign in to Vex Sync (Settings › Sync) with the same account as your computer, '
          + 'and the tabs it has open show here, in their groups.'));
        return;
      }
      const needle = String(query || '').trim().toLowerCase();
      const groups = VexSync.remoteTabGroups()
        .map(group => Object.assign({}, group, {
          tabs: group.tabs.filter(tab => !needle || (tab.title + ' ' + tab.url).toLowerCase().includes(needle))
        }))
        .filter(group => group.tabs.length);
      if (!groups.length) {
        body.appendChild(empty(needle ? 'No tab on your computer matches “' + query + '”.'
          : 'Nothing open on your computer, as of the last sync.'));
        return;
      }
      const synced = VexSync.state.lastPullAt ? Date.parse(VexSync.state.lastPullAt) : 0;
      if (synced) body.appendChild(el('div', 'field-note', 'As of ' + when(synced) + '. Tap one to open it here.'));
      for (const group of groups) {
        const head = heading((group.name || (groups.length > 1 ? 'Not in a group' : 'Open tabs')) + ' · ' + group.tabs.length);
        if (group.color) {
          const dot = el('span', 'group-dot');
          dot.style.background = group.color;
          head.prepend(dot);
        }
        head.classList.add('tappable');
        head.onclick = () => VexSheets.choose(group.name || 'These tabs', [
          { id: 'all', label: 'Open all ' + group.tabs.length + ' here', note: 'Each in a new tab, in the background' }
        ], async () => {
          VexSheets.close();
          for (const tab of group.tabs.slice(0, 30)) await VexUI.openUrl(tab.url, { newTab: true, background: true });
          VexUI.toast('Opened ' + Math.min(30, group.tabs.length) + ' tabs');
        });
        body.appendChild(head);
        for (const tab of group.tabs) {
          body.appendChild(listRow(tab, {
            sub: item => (item.pinned ? 'Pinned · ' : '') + VexSearch.prettyHost(item.url),
            onOpen: item => { close(); VexUI.openUrl(item.url, { newTab: true }); }
          }));
        }
      }
    },

    // ── Bookmarks, in folders ──────────────────────────────────────────────
    bookmarks(query = '') {
      const body = openShell('bookmarks', 'Bookmarks', {
        search: { value: query, placeholder: 'Search bookmarks', onInput: value => this.bookmarks(value) },
        action: { label: 'Edit', run: () => this.bookmarksMenu() }
      });
      // Folders with nothing in them yet are shown too: a new folder that did
      // not appear until something was in it looked like it had not been made.
      const groups = VexCollections.bookmarks.grouped(query, { includeEmpty: !query });
      if (!groups.length) {
        body.appendChild(empty(query ? 'Nothing matches “' + query + '”.'
          : 'Tap the star on a page, or Bookmark in the menu, and it will be here.'));
        return;
      }
      for (const [folder, entries] of groups) {
        const head = heading(folder || 'Unsorted');
        // A folder could be made and never renamed or removed: both existed in
        // the model and nothing reached them. The heading is where to look.
        if (folder) {
          head.classList.add('tappable');
          head.onclick = () => this.folderActions(folder, query);
        }
        body.appendChild(head);
        if (!entries.length) {
          body.appendChild(el('div', 'field-note', 'Empty — move a bookmark here with its folder button, '
            + 'or choose this folder when you bookmark a page.'));
        }
        for (const entry of entries) {
          body.appendChild(listRow(entry, {
            sub: item => VexSearch.prettyHost(item.url),
            onOpen: item => { close(); VexUI.openUrl(item.url); },
            actions: [
              { icon: 'text', label: 'Rename', run: item => this.renameBookmark(item, query) },
              { icon: 'layers', label: 'Move to folder', run: item => this.pickFolder(item, query) }
            ],
            onRemove: async item => {
              await VexCollections.bookmarks.remove(item.url);
              VexSync.schedulePush();
              this.bookmarks(query);
              // One tap on an × is too easy a way to lose something you kept.
              VexUI.toast('Removed ' + (item.title || VexSearch.prettyHost(item.url)), 4500, {
                label: 'Undo',
                run: async () => {
                  await VexCollections.bookmarks.restore(item);
                  VexSync.schedulePush();
                  this.bookmarks(query);
                }
              });
            }
          }));
        }
      }
    },

    async renameBookmark(bookmark, query = '') {
      const name = await VexUI.prompt('Rename', 'What to call it', bookmark.title || '');
      if (name === null || !name.trim()) return;
      await VexCollections.bookmarks.update(bookmark.id, { title: name.trim() });
      VexSync.schedulePush();
      this.bookmarks(query);
    },

    folderActions(folder, query = '') {
      VexSheets.choose(folder, [
        { id: 'rename', label: 'Rename this folder' },
        { id: 'remove', label: 'Remove the folder', note: 'Its bookmarks move to Unsorted', danger: true }
      ], async choice => {
        VexSheets.close();
        if (choice === 'rename') {
          const name = await VexUI.prompt('Rename the folder', 'A name for it', folder);
          if (name === null || !name.trim()) return;
          await VexCollections.bookmarks.renameFolder(folder, name);
        } else if (choice === 'remove') {
          if (!(await VexUI.confirm('Remove the folder ' + folder + '? Its bookmarks stay, in Unsorted.'))) return;
          await VexCollections.bookmarks.removeFolder(folder);
        }
        VexSync.schedulePush();
        this.bookmarks(query);
      });
      return true;
    },

    /**
     * Choose a bookmark's folder. From the list it redraws the list; from a
     * page (`stay`: the star, the toast after bookmarking) it says where the
     * bookmark went and leaves you on the page.
     */
    pickFolder(bookmark, query = '', { stay = false } = {}) {
      if (!bookmark) return;
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
          if (stay) {
            const now = VexCollections.bookmarks.all().find(entry => entry.id === bookmark.id);
            VexUI.toast(now && now.folder ? 'In ' + now.folder : 'In Unsorted');
          } else this.bookmarks(query);
        });
      return true;
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
          if (!name || !name.trim()) return;
          const folder = await VexCollections.bookmarks.addFolder(name);
          // Made from the list while a page is open that is not kept yet: that
          // page is most likely why — offer to put it in.
          const tab = VexTabStore.active();
          if (folder && tab && tab.url && tab.url !== 'about:blank' && !tab.incognito
            && !VexCollections.bookmarks.has(tab.url)
            && await VexUI.confirm('Bookmark “' + (tab.title || VexSearch.prettyHost(tab.url)) + '” in ' + folder + '?', 'New folder')) {
            await VexCollections.bookmarks.add({ url: tab.url, title: tab.title, icon: tab.icon, folder });
            VexSync.schedulePush();
            VexUI.renderToolbar();
          }
          VexUI.toast('Folder “' + folder + '” made');
          this.bookmarks();
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
    async readingList(filter = 'unread') {
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
      // Which of them have a copy on the phone: those open with no signal.
      const mine = drawn;
      const copies = await VexTools.savedPages(500).catch(() => []);
      if (mine !== drawn) return;
      const offline = new Map();
      for (const page of copies) {
        const known = offline.get(page.url);
        if (!known || (page.at || 0) > (known.at || 0)) offline.set(page.url, page);
      }
      for (const entry of entries) {
        body.appendChild(listRow(entry, {
          sub: item => VexSearch.prettyHost(item.url) + ' · ' + when(item.at) + (item.read ? ' · read' : '')
            + (offline.has(item.url) ? ' · offline' : ''),
          onOpen: async item => {
            await VexCollections.reading.markRead(item.url, true);
            close();
            // With no connection, the copy it was saved with; otherwise the
            // page itself, which may have moved on.
            const copy = offline.get(item.url);
            if (copy && typeof navigator !== 'undefined' && navigator.onLine === false) {
              await VexTools.openSaved(copy);
              VexUI.toast('Offline — this is the copy saved with it');
              return;
            }
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
            VexUI.toast('Removed from the reading list', 4500, {
              label: 'Undo',
              run: async () => {
                await VexCollections.reading.restore(item);
                VexSync.schedulePush();
                this.readingList(filter);
              }
            });
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
          onRemove: async item => {
            // The document is read out first: it is the half worth undoing.
            const kept = await VexDB.get('pagehtml', item.id);
            await VexTools.deleteSaved(item.id);
            this.savedPages();
            undo('Deleted the saved copy', async () => {
              await VexDB.put('pages', item);
              if (kept) await VexDB.put('pagehtml', kept);
              this.savedPages();
            });
          }
        }));
      }
    },

    // ── Notes ──────────────────────────────────────────────────────────────
    /** Add one, or take them all with you. */
    notesMenu(query = '') {
      VexSheets.choose('Notes', [
        { id: 'add', label: 'Write a note' },
        { id: 'export', label: 'Export them all', note: 'As Markdown — a list of lines with their links' }
      ], async choice => {
        VexSheets.close();
        if (choice === 'add') {
          const tab = VexTabStore.active();
          const text = await VexUI.prompt('A note', tab && tab.url !== 'about:blank'
            ? 'About ' + VexSearch.prettyHost(tab.url) : 'Anything you want to keep');
          if (!text) return;
          await VexNotes.add({ url: tab ? tab.url : '', title: tab ? tab.title : '', text });
          this.notes(query);
        } else if (choice === 'export') {
          const text = await VexNotes.exportMarkdown();
          VexUI.downloadText('vex-notes.md', text, 'text/markdown');
        }
      });
      return true;
    },

    async notes(query = '') {
      const body = openShell('notes', 'Notes', {
        search: { value: query, placeholder: 'Search your notes', onInput: value => this.notes(value) },
        action: { label: 'Add', run: () => this.notesMenu(query) }
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
        remove.onclick = async event => {
          event.stopPropagation();
          await VexNotes.remove(note.id);
          this.notes(query);
          // A note is something you wrote; a trash icon is one tap.
          VexUI.toast('Note deleted', 4500, {
            label: 'Undo',
            run: async () => { await VexNotes.restore(note); this.notes(query); }
          });
        };
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
          onRemove: async () => {
            await VexRemind.remove(entry.id);
            this.reminders();
            // Put back as a reminder again — which asks Android for the alarm
            // again, the part that matters.
            undo('Reminder cancelled', async () => {
              await VexRemind.add({ url: entry.url, title: entry.title, note: entry.note, at: entry.at });
              this.reminders();
            });
          }
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
          // Run it first and look at what it did. An entry that opened another
          // panel is on top now, and Back should come here rather than to the
          // page; one that opened a sheet keeps it — returning anything but
          // true closed the sheet it had just opened, which is why "Rules for
          // one site" never appeared. Anything else acts on the page, which
          // this panel is covering, so the panel goes.
          run: () => {
            entry.run();
            if (stack[stack.length - 1] === 'library' && !VexSheets.isOpen()) close();
            return true;
          }
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
            // Lazily: each tab goes where it is going when you open it, rather
            // than a session of twenty starting twenty page loads at once.
            for (const tab of session.tabs) {
              await VexTabStore.create(tab.url, { background: true, lazy: true, title: tab.title });
            }
            VexUI.toast('Opened ' + session.tabs.length + ' tabs');
            VexUI.renderToolbar();
          },
          actions: [{
            icon: 'text', label: 'Rename',
            run: async () => {
              const name = await VexUI.prompt('Rename the session', 'A name for it', session.name);
              if (name === null || !name.trim()) return;
              await VexCollections.sessions.rename(session.id, name.trim());
              VexSync.schedulePush();
              this.sessions();
            }
          }],
          onRemove: async () => {
            await VexCollections.sessions.remove(session.id);
            VexSync.schedulePush();
            this.sessions();
            VexUI.toast('Deleted ' + session.name, 4500, {
              label: 'Undo',
              run: async () => {
                await VexCollections.sessions.restore(session);
                VexSync.schedulePush();
                this.sessions();
              }
            });
          }
        }));
      }
    },

    // ── Downloads ──────────────────────────────────────────────────────────
    /** The two things that header button can mean. */
    downloadsMenu() {
      VexSheets.choose('Downloads', [
        { id: 'folder', label: 'Open the Downloads folder', note: 'The phone’s own list of files' },
        { id: 'clear', label: 'Clear this list', note: 'The list only — the files stay where they are' }
      ], async choice => {
        VexSheets.close();
        if (choice === 'folder') {
          try { await VexBridge.openDownloadsFolder(); }
          catch (error) { VexUI.toast(error.message || 'Could not open it'); }
        } else if (choice === 'clear') {
          await VexDB.clear('downloads');
          this.downloads();
        }
      });
      return true;
    },

    async downloads() {
      const body = openShell('downloads', 'Downloads', {
        action: { label: 'Files', run: () => this.downloadsMenu() }
      });
      const mine = drawn;
      const rows = await VexDB.scan('downloads', { limit: 200 });
      const live = await downloadQueue();
      if (mine !== drawn) return;

      if (!rows.length) {
        body.appendChild(empty('Files you download land in the phone’s Downloads folder, and are listed here.'));
        return;
      }

      const line = (entry, now) => [VexSearch.prettyHost(entry.pageUrl || entry.url), now.note, when(entry.at)]
        .filter(Boolean).join(' · ');

      // The ones still arriving, and the parts of their rows that move.
      const following = [];
      for (const entry of rows) {
        const now = progressOf(entry, live);
        const node = listRow({ url: entry.pageUrl || entry.url, title: entry.filename || entry.url, icon: '' }, {
          sub: () => line(entry, now),
          // Still running: the one useful button is Stop, and it is a separate
          // button from Remove because they are different regrets.
          actions: now.state === 'running' && now.stop ? [{
            icon: 'close', label: 'Stop this download',
            run: async () => {
              try { await now.stop(); }
              catch (error) { VexUI.toast(error.message || 'Could not stop it'); return; }
              VexUI.toast('Stopped — the part that arrived is gone with it');
              this.downloads();
            }
          }] : null,
          onOpen: async () => {
            if (now.state === 'running') { VexUI.toast('Still downloading'); return; }
            if (now.state === 'failed') {
              if (now.why) VexUI.toast(now.why, 4000);
              close();
              VexUI.openUrl(entry.pageUrl || entry.url);
              return;
            }
            const downloadId = (now.match && now.match.id) || entry.downloadId || '';
            const localUri = (now.match && now.match.localUri) || entry.localUri || '';
            if (downloadId || localUri) {
              try { await VexBridge.openDownload({ downloadId, localUri }); return; }
              catch (error) { VexUI.toast(error.message || 'That file could not be opened'); return; }
            }
            // A local file we never learnt the place of, or one the queue has
            // since forgotten: the address is all there is.
            if (/^https?:/i.test(entry.url)) { close(); VexUI.openUrl(entry.url); }
            else VexUI.toast('It is in the Downloads folder');
          },
          onRemove: async () => {
            await VexDB.delete('downloads', entry.id);
            this.downloads();
            undo('Removed from the list — the file is still in Downloads', async () => {
              await VexDB.put('downloads', entry);
              this.downloads();
            });
          }
        });
        if (now.state === 'running') {
          const bar = el('div', 'progress-row');
          const fill = el('i');
          fill.style.width = now.percent + '%';
          bar.appendChild(fill);
          node.querySelector('.lines').appendChild(bar);
          following.push({ entry, fill, line: node.querySelector('.u') });
        }
        body.appendChild(node);
      }

      // "With live progress" has to mean the bar moves while you watch. The
      // queue is read once a second for as long as something is arriving; when
      // one finishes or fails the list is drawn again, because its buttons and
      // what a tap does change with it.
      if (!following.length) return;
      stopTicker();
      ticker = setInterval(async () => {
        const queue = await downloadQueue();
        if (mine !== drawn) return;
        for (const item of following) {
          // A stream that has just finished has its row rewritten in IndexedDB;
          // read the job, not the row this drawing started from.
          const now = progressOf(Object.assign({}, item.entry, { streamDone: false, streamFailed: '' }), queue);
          if (now.state !== 'running') { this.downloads(); return; }
          item.fill.style.width = now.percent + '%';
          item.line.textContent = line(item.entry, now);
        }
      }, 1000);
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
      const relock = () => { stopTicker(); this.passwords(); };

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
          // This list holds every login, so the page in front may not be the
          // one this login is for — and a password typed into the wrong site
          // is exactly what phishing is waiting for. Asked, plainly, first.
          const pageHost = VexSearch.prettyHost(tab.url);
          let anyHost = false;
          if (!VexVault.belongsOn(fresh, pageHost)) {
            anyHost = await VexUI.confirm('This login is for ' + fresh.host + ', and the page is '
              + (pageHost || 'not a website') + '. Type the password into it anyway?', 'A different site');
            if (!anyHost) return;
          }
          close();
          const said = await VexVault.fill(tab.id, fresh, { anyHost });
          VexUI.toast(said === 'filled' ? 'Filled — you press the button'
            : said === 'wrong-host' ? 'The page changed — nothing was filled'
            : 'No login form on this page');
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
            const options = VexVault.codeOptions(fresh);
            item.code.textContent = await VexVault.totp(fresh.secret, options);
            const left = VexVault.secondsLeft(options.period);
            item.ring.querySelector('.fill').setAttribute('stroke-dashoffset', String(56.5 * (1 - left / options.period)));
          } catch {
            item.code.textContent = 'bad secret';
          }
        }
      };
      tick();
      stopTicker();
      ticker = setInterval(tick, 1000);
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
        // Make one up, rather than reusing the one you always use. The length is
        // the one you last chose, and what it made is shown — a password you
        // cannot see is a password you cannot check against the site's rules.
        if (key === 'password') {
          const row = el('div', { class: 'field-actions' });
          const make = el('button', 'pill-btn small');
          make.textContent = 'Make one up';
          make.onclick = () => {
            const length = Number(VexStore.get('vex.passwordLength', 20)) || 20;
            input.value = VexVault.makePassword({ length });
            input.type = 'text';
            VexUI.toast(length + ' characters — copy it before you save');
          };
          row.appendChild(make);
          const longer = el('button', 'pill-btn small');
          longer.textContent = 'Length';
          longer.onclick = () => VexSheets.choose('How long',
            [12, 16, 20, 24, 32, 48].map(size => ({
              id: size, label: size + ' characters',
              selected: size === Number(VexStore.get('vex.passwordLength', 20))
            })), async size => {
              await VexStore.set('vex.passwordLength', Number(size));
              VexSheets.close();
              input.value = VexVault.makePassword({ length: Number(size) });
              input.type = 'text';
            });
          row.appendChild(longer);
          const copy = el('button', 'pill-btn small');
          copy.textContent = 'Copy';
          copy.onclick = () => { if (input.value) VexUI.copy(input.value); };
          row.appendChild(copy);
          field.appendChild(row);
        }
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
      const body = openShell('sync', 'Vex Sync');
      const state = VexSync.state;

      const status = el('div', 'status-line');
      status.appendChild(el('span', 'status-dot' + (state.enabled ? ' on' : state.lastError ? ' error' : '')));
      status.appendChild(document.createTextNode(state.enabled
        ? 'Signed in as ' + state.email + (state.lastPullAt ? ' · synced ' + when(Date.parse(state.lastPullAt)) : '')
        : state.lastError || 'Not signed in'));
      body.appendChild(status);
      if (state.enabled && state.lastError) body.appendChild(el('div', 'field-note', state.lastError));

      body.appendChild(el('div', 'field-note',
        'The same account as Vex on your computer, through the Sync Worker you deployed (SELF_HOSTING.md). '
        + 'Your bookmarks and your computer’s notes go both ways, and pages can be sent between devices. '
        + 'Everything is encrypted on the device with your recovery code; the worker never sees it. '
        + 'The rest of what your computer syncs — its tabs, settings, history — is left exactly as it is.'));

      const urlField = el('div', 'field stack');
      urlField.appendChild(el('label', { for: 'sync-url' }, 'Sync Worker URL'));
      const urlInput = el('input', {
        id: 'sync-url', type: 'url', value: VexSync.workerUrl(),
        placeholder: 'https://vex-sync.you.workers.dev',
        autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false'
      });
      if (state.enabled) urlInput.disabled = true;     // changing it signed in would split the account
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
          id: 'sync-email', type: 'text', inputmode: 'email', value: VexStore.get('vex.syncEmail', '') || '',
          autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false'
        });
        emailField.appendChild(emailInput);
        body.appendChild(emailField);

        body.appendChild(valueRow('Send me a code', 'Six digits, by email', '', async () => {
          try {
            await VexStore.set('vex.syncEmail', emailInput.value.trim());
            const answer = await VexSync.requestCode(emailInput.value.trim());
            VexUI.toast(answer.devCode ? 'This worker has no email set up — the code is ' + answer.devCode : 'Code sent — check your email', 6000);
          } catch (error) { VexUI.toast(error.message, 4500); }
        }));

        const codeField = el('div', 'field stack');
        codeField.appendChild(el('label', { for: 'sync-code' }, 'The code'));
        const codeInput = el('input', { id: 'sync-code', type: 'text', inputmode: 'numeric', placeholder: '000000', autocomplete: 'one-time-code' });
        codeField.appendChild(codeInput);
        body.appendChild(codeField);

        body.appendChild(valueRow('Sign in', 'Joins your account, or starts one if it has nothing yet', '', async () => {
          try {
            VexUI.toast('Signing in…', 1500);
            const answer = await VexSync.signIn(emailInput.value.trim(), codeInput.value.trim());
            if (answer.needsRecoveryCode) {
              const typed = await VexUI.prompt('Recovery code',
                'This account already syncs. Type the recovery code your computer showed you — '
                + 'Settings › Sync › Show recovery code on the desktop.');
              if (!typed) { await VexSync.abandon(); VexUI.toast('Not signed in — the recovery code is needed'); this.sync(); return; }
              const joined = await VexSync.join(typed);
              VexUI.toast(joined.pushError ? 'Signed in — but ' + joined.pushError : 'Signed in', joined.pushError ? 5000 : 2500);
            } else if (answer.created) {
              await VexUI.showRecoveryCode(answer.recoveryCode);
              VexUI.toast('Signed in — a new account');
            } else {
              VexUI.toast('Signed in');
            }
            VexStart.render();
            this.sync();
          } catch (error) {
            VexUI.toast(error.message, 5000);
            this.sync();
          }
        }));
        body.appendChild(el('div', 'field-note',
          'Already syncing on your computer? Sign in with the same email; you will be asked for its recovery code. '
          + 'A wrong code changes nothing, and leaves nothing behind in your device list.'));
        return;
      }

      body.appendChild(heading('This account'));
      body.appendChild(valueRow('Sync now', state.lastPushAt ? 'Last sent ' + when(Date.parse(state.lastPushAt)) : null, '', async () => {
        VexUI.toast('Syncing…', 1200);
        const result = await VexSync.syncNow();
        VexUI.toast(result.ok ? 'Up to date' : result.reason || 'It did not sync', 4500);
        this.sync();
      }));
      body.appendChild(valueRow('Notes from your computer',
        VexSyncedNotes.list().length + ' — read, edit and add', '', () => this.syncedNotes()));
      body.appendChild(valueRow('Show the recovery code', 'What another device needs to join', '', async () => {
        const code = await VexSync.recoveryCode().catch(() => '');
        if (code) await VexUI.showRecoveryCode(code);
        else VexUI.toast('There is no key on this phone');
      }));
      body.appendChild(valueRow('Devices', 'Which devices are on this account', '', async () => {
        try {
          const devices = await VexSync.devices();
          VexSheets.choose('Devices', devices.map(device => ({
            id: device.deviceId,
            label: (device.deviceName || device.deviceId) + (device.deviceId === state.deviceId ? ' (this phone)' : ''),
            note: device.lastSeenAt ? 'last seen ' + when(Date.parse(device.lastSeenAt)) : null
          })), async deviceId => {
            VexSheets.close();
            if (deviceId === state.deviceId) { VexUI.toast('Sign out below to take this phone off'); return; }
            if (await VexUI.confirm('Take that device off this account? It will be signed out.')) {
              try { await VexSync.forgetDevice(deviceId); VexUI.toast('Removed'); }
              catch (error) { VexUI.toast(error.message); }
            }
          });
        } catch (error) { VexUI.toast(error.message); }
      }));

      const remote = VexSync.remoteTabs();
      if (remote.length) {
        body.appendChild(valueRow('Open on your computer',
          remote.length + ' tabs' + (VexSync.remoteTabGroups().some(group => group.id) ? ', in their groups' : ''), '',
          () => this.computerTabs()));
      }

      body.appendChild(heading('Leaving'));
      body.appendChild(VexSheets.row({
        label: 'Sign out on this phone', note: 'Takes this phone off the account; your bookmarks stay here', danger: true,
        run: async () => {
          if (!(await VexUI.confirm('Sign this phone out of Vex Sync?'))) return true;
          await VexSync.signOut();
          this.sync();
          return true;
        }
      }));
      body.appendChild(VexSheets.row({
        label: 'Delete everything on the server', note: 'Every device is signed out; their own copies stay', danger: true,
        run: async () => {
          if (!(await VexUI.confirm('Delete the synced data for every device, and sign them all out?'))) return true;
          try { await VexSync.deleteEverything(); VexUI.toast('Deleted'); }
          catch (error) { VexUI.toast(error.message); }
          this.sync();
          return true;
        }
      }));
    },

    // ── The desktop's notes ────────────────────────────────────────────────
    syncedNotes(query = '') {
      const body = openShell('syncedNotes', 'Notes from your computer', {
        search: { value: query, placeholder: 'Search these notes', onInput: value => this.syncedNotes(value) },
        action: { label: 'New', run: async () => { const note = await VexSyncedNotes.create(); this.syncedNote(note.id); } }
      });
      const notes = VexSyncedNotes.sorted(query);
      if (!notes.length) {
        body.appendChild(empty(query ? 'Nothing matches “' + query + '”.'
          : VexSync.state.enabled
            ? 'Notes you write in Vex on your computer appear here, and what you write here appears there.'
            : 'Sign in to Vex Sync to see the notes from Vex on your computer.'));
        return;
      }
      for (const note of notes) {
        const row = el('div', 'list-row');
        const lines = el('div', 'lines');
        lines.appendChild(el('span', 't', (note.pinned ? '📌 ' : '') + VexSyncedNotes.label(note)));
        const preview = String(note.content || '').replace(/\s+/g, ' ').trim().slice(0, 90);
        lines.appendChild(el('span', 'u', [preview || null, note.updatedAt ? when(Date.parse(note.updatedAt)) : null].filter(Boolean).join(' · ')));
        row.appendChild(lines);
        row.onclick = () => this.syncedNote(note.id);
        const remove = el('button', { class: 'x', 'aria-label': 'Delete' });
        remove.appendChild(icon('trash'));
        remove.onclick = async event => {
          event.stopPropagation();
          const gone = await VexSyncedNotes.remove(note.id);
          this.syncedNotes(query);
          VexUI.toast('Deleted on every device', 4500, {
            label: 'Undo', run: async () => { await VexSyncedNotes.restore(gone); this.syncedNotes(query); }
          });
        };
        row.appendChild(remove);
        body.appendChild(row);
      }
    },

    syncedNote(id) {
      const note = VexSyncedNotes.get(id);
      if (!note) { this.syncedNotes(); return; }
      lastSyncedNote = id;
      const body = openShell('syncedNote', VexSyncedNotes.label(note), {
        action: {
          label: note.pinned ? 'Unpin' : 'Pin',
          run: async () => { await VexSyncedNotes.update(id, { pinned: !note.pinned }); this.syncedNote(id); }
        }
      });
      const title = el('input', { class: 'note-title', type: 'text', value: note.title || '', placeholder: 'Title' });
      const content = el('textarea', { class: 'note-body', placeholder: 'Write… Markdown works, and “- [ ] thing” is a checklist' });
      content.value = note.content || '';
      let timer = null;
      const saveSoon = () => {
        clearTimeout(timer);
        timer = setTimeout(() => VexSyncedNotes.update(id, { title: title.value, content: content.value }), 600);
      };
      title.oninput = saveSoon;
      content.oninput = saveSoon;
      // Saved on the way out too, whatever the timer was doing.
      const flush = () => { clearTimeout(timer); return VexSyncedNotes.update(id, { title: title.value, content: content.value }); };
      title.onblur = flush;
      content.onblur = flush;
      body.appendChild(title);
      body.appendChild(content);
      if (note.sourceUrl) {
        body.appendChild(listRow({ url: note.sourceUrl, title: note.sourceTitle || note.sourceUrl }, {
          sub: item => 'Clipped from ' + VexSearch.prettyHost(item.url),
          onOpen: item => { close(); VexUI.openUrl(item.url, { newTab: true }); }
        }));
      }
      body.appendChild(VexSheets.row({
        label: 'Delete this note', note: 'From every device', danger: true,
        run: async () => {
          await flush();
          const gone = await VexSyncedNotes.remove(id);
          this.syncedNotes();
          VexUI.toast('Deleted on every device', 4500, {
            label: 'Undo', run: async () => { await VexSyncedNotes.restore(gone); this.syncedNotes(); }
          });
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
          onRemove: async () => {
            const was = await VexPermissions.clearSite(host);
            this.permissions();
            undo('Forgot what ' + host + ' may use', async () => {
              await VexPermissions.restoreSite(host, was);
              this.permissions();
            });
          }
        }));
      }
    },

    // ── Settings ───────────────────────────────────────────────────────────
    async settings() {
      const body = openShell('settings', 'Settings');
      // Two answers below are awaited — history's size, and whether Vex is the
      // default — and a tap on Appearance meanwhile used to get the rest of
      // Settings appended underneath it.
      const mine = drawn;

      body.appendChild(heading('Look and feel'));
      body.appendChild(valueRow('Appearance', 'Theme, skin, typeface, toolbar', VexTheme.current().id, () => this.appearance()));
      body.appendChild(valueRow('Tabs', 'How tabs open, sleep and close', null, () => this.tabsSettings()));
      body.appendChild(valueRow('Menu', 'What is in it, and in what order', null, () => this.menuEditor()));
      body.appendChild(valueRow('Start page', 'The tiles and what they point at', null, () => this.quickAccess()));
      body.appendChild(valueRow('Everything Vex can do', 'The library, with search', String(VexLibrary.count()),
        () => this.library()));

      body.appendChild(heading('Search'));
      body.appendChild(valueRow('Search engine', null,
        (VexSearch.engines()[VexSearch.engineId()] || {}).name || '—',
        () => VexSheets.choose('Search engine',
          Object.entries(VexSearch.engines()).map(([id, engine]) => ({
            id, label: engine.name, note: id === 'custom' ? engine.url : '',
            selected: id === VexSearch.engineId()
          })).concat([{
            id: '__custom',
            label: VexSearch.custom() ? 'Change your own search…' : 'A search of your own…',
            note: 'SearXNG on a box in the hall, Kagi, anything with a %s in the URL'
          }]),
          async id => {
            if (id === '__custom') { VexSheets.close(); this.customEngine(); return; }
            await VexStore.set('vex.searchEngine', id);
            VexSheets.close();
            this.settings();
          })));
      body.appendChild(valueRow('Translation', 'On the phone, with nothing sent anywhere', null,
        () => this.translation()));
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
      const darkModes = [
        [false, 'Never', 'Sites look the way they were written'],
        ['theme', 'When Vex is dark', 'Which on Auto means when the phone is'],
        [true, 'Always', null]
      ];
      const darkNow = VexStore.get('vex.darkPages', false);
      body.appendChild(valueRow('Dark pages', 'Ask sites for their dark theme',
        (darkModes.find(mode => mode[0] === darkNow) || darkModes[0])[1],
        () => VexSheets.choose('Dark pages', darkModes.map(([id, label, note]) => ({
          id: String(id), label, note, selected: id === darkNow
        })), async picked => {
          const value = picked === 'true' ? true : picked === 'false' ? false : picked;
          await VexStore.set('vex.darkPages', value);
          VexSheets.close();
          const tab = VexTabStore.active();
          if (tab) await VexSiteRules.applyTo(tab);
          this.settings();
        })));
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
      body.appendChild(toggleRow('Scroll buttons',
        'Two arrows at the edge of the page while you scroll — a tap is a screenful, a long press goes to the top or the bottom',
        VexStore.get('vex.scrollButtons', false) === true, async value => {
          await VexStore.set('vex.scrollButtons', value);
          await VexBridge.setScrollButtons(value);
        }));

      body.appendChild(heading('Media'));
      body.appendChild(toggleRow('Let videos play on their own',
        'Off means a page has to wait for a tap before any video starts. One site at a time can be '
        + 'allowed from its own sheet — the music player, the next episode.',
        VexStore.get('vex.autoplay', false), async value => {
          await VexStore.set('vex.autoplay', value);
          const tab = VexTabStore.active();
          if (tab) await VexSiteRules.applyTo(tab);
        }));
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
      body.appendChild(toggleRow('Keep private tabs out of screenshots',
        'And out of the app switcher’s thumbnail, which is the one somebody else sees',
        VexStore.get('vex.hidePrivate', true) !== false, async value => {
          await VexStore.set('vex.hidePrivate', value);
          VexUI.applyPrivacyScreen();
        }));
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
      if (mine !== drawn) return;
      body.appendChild(valueRow('Storage', stats.visits.toLocaleString() + ' visits · '
        + stats.pages.toLocaleString() + ' pages searchable · ' + stats.saved + ' saved', null,
        () => this.storage()));

      const isDefault = await VexBridge.isDefaultBrowser().catch(() => false);
      if (mine !== drawn) return;
      body.appendChild(heading('Vex on this phone'));
      body.appendChild(valueRow('Make Vex the default browser',
        isDefault ? 'Vex is the default' : 'Opens Android settings', null,
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

    // ── Translation, on the phone ──────────────────────────────────────────
    async translation() {
      const body = openShell('translation', 'Translation');
      const mine = drawn;
      const languages = await VexTranslate.languages();
      if (mine !== drawn) return;

      body.appendChild(el('div', 'field-note',
        'Vex translates a page on the phone. Chrome and Samsung Internet both send it to a server; this '
        + 'does not, which means a page you would rather nobody else read, and a page translated on a '
        + 'train with no signal. Each language is a download of roughly thirty megabytes, kept until you '
        + 'delete it, and English is always there.'));

      body.appendChild(toggleRow('Translate on the phone',
        'Off sends the page to your own assistant instead, which needs a connection and a worker',
        VexStore.get('vex.translateOnDevice', true) !== false,
        value => VexStore.set('vex.translateOnDevice', value)));
      body.appendChild(toggleRow('Download models on Wi-Fi only',
        'A language pair is tens of megabytes',
        VexTranslate.wifiOnly(), value => VexStore.set('vex.translateWifiOnly', value)));

      const recent = VexStore.get('vex.translateTo', 'en');
      body.appendChild(valueRow('Translate into', 'What the menu offers first',
        (VexTools.LANGUAGES.find(pair => pair[0] === recent) || [, recent])[1],
        () => VexSheets.choose('Translate into',
          VexTools.LANGUAGES.map(([code, name]) => ({ id: code, label: name, selected: code === recent })),
          async code => { await VexStore.set('vex.translateTo', code); VexSheets.close(); this.translation(); })));

      const here = languages.filter(entry => entry.downloaded);
      body.appendChild(heading(here.length
        ? 'On this phone · ' + here.length + ' languages'
        : 'Nothing downloaded yet'));
      if (!here.length) {
        body.appendChild(el('div', 'field-note',
          'The first page you translate downloads what it needs. Nothing is fetched before then.'));
      }
      for (const entry of here) {
        body.appendChild(VexSheets.row({
          icon: 'check', label: entry.label || entry.language, note: entry.language,
          run: async () => {
            if (!(await VexUI.confirm('Delete the ' + (entry.label || entry.language) + ' model?'))) return true;
            await VexTranslate.deleteModel(entry.language);
            VexUI.toast('Deleted — it will download again when you need it');
            this.translation();
            return true;
          }
        }));
      }

      if (languages.length) {
        body.appendChild(heading('Everything it can translate'));
        body.appendChild(el('div', 'field-note',
          languages.map(entry => entry.label || entry.language).sort().join(', ') + '.'));
      } else {
        body.appendChild(el('div', 'field-note',
          'The list of languages comes from the phone, so it is empty in the development fallback.'));
      }
    },

    // ── A search engine of your own ────────────────────────────────────────
    customEngine() {
      const body = openShell('customEngine', 'Your own search');
      const mine = VexSearch.custom() || { name: '', url: '', suggest: '' };

      body.appendChild(el('div', 'field-note',
        'Put %s where what you type should go. For SearXNG on your own machine that is something like '
        + 'https://searx.home/search?q=%s — and if it offers an OpenSearch suggestions endpoint, give '
        + 'that too. Suggestions go out through Android rather than from the chrome, which refuses '
        + 'anything but https, because the letters you are typing are not going over plain http.'));

      const fields = {};
      for (const [key, label, placeholder] of [
        ['name', 'Name', 'What to call it'],
        ['url', 'Search URL', 'https://example.com/search?q=%s'],
        ['suggest', 'Suggestions URL (optional)', 'https://example.com/suggest?q=%s']
      ]) {
        const field = el('div', 'field stack');
        field.appendChild(el('label', { for: 'engine-' + key }, label));
        const input = el('input', {
          id: 'engine-' + key, type: 'text', value: mine[key] || '', placeholder,
          autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false'
        });
        fields[key] = input;
        field.appendChild(input);
        body.appendChild(field);
      }

      const save = el('button', { class: 'pill-btn', style: 'margin: 10px 16px; width: calc(100% - 32px)' },
        'Use this search');
      save.onclick = async () => {
        const next = {
          name: fields.name.value.trim(),
          url: fields.url.value.trim(),
          suggest: fields.suggest.value.trim()
        };
        const wrong = VexSearch.checkCustom(next);
        if (wrong) { VexUI.toast(wrong, 3600); return; }
        await VexStore.set('vex.customEngine', next);
        await VexStore.set('vex.searchEngine', 'custom');
        VexSearch.forgetSuggestions();
        VexUI.toast('The omnibox searches ' + next.name + ' now');
        this.settings();
      };
      body.appendChild(save);

      if (VexSearch.custom()) {
        body.appendChild(VexSheets.row({
          label: 'Forget it', note: 'The omnibox goes back to DuckDuckGo', danger: true,
          run: async () => {
            await VexStore.set('vex.customEngine', null);
            if (VexStore.get('vex.searchEngine', '') === 'custom') {
              await VexStore.set('vex.searchEngine', 'duckduckgo');
            }
            VexSearch.forgetSuggestions();
            this.settings();
            return true;
          }
        }));
      }
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
        VexStore.get('vex.historyDays', 365) >= VexDB.NEVER ? 'Never' : VexStore.get('vex.historyDays', 365) + ' days',
        () => VexSheets.choose('Forget history older than',
          [30, 90, 180, 365, VexDB.NEVER].map(days => ({
            id: days, label: days >= VexDB.NEVER ? 'Never' : days + ' days',
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
        'An app is not closed, it is left — so this happens every time Vex goes to the background, '
        + 'including when you take a phone call. The open tabs are never in it, for the same reason.',
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
    /**
     * Put a look on. Its colours and shapes go on at once; how that browser
     * arranges its bars is offered, not imposed, and what you had is kept so
     * going back to Vex can put it back.
     */
    async chooseLook(id) {
      const look = VexTheme.LOOKS[id];
      if (!look) return;
      const was = VexTheme.look();
      await VexTheme.setLook(id);
      const layoutNow = VexStore.get('vex.toolbarPosition', 'bottom');
      const buttonsNow = VexUI.buttonConfig();
      if (look.layout) {
        const same = layoutNow === look.layout
          && JSON.stringify(buttonsNow) === JSON.stringify(look.buttons);
        if (!same && await VexUI.offer(look.layoutNote + '. Arrange the toolbar like ' + look.label + ' too?',
          'Arrange it', look.label)) {
          // Keep what you had the first time a look moved it, not the last
          // look's arrangement, so "back to Vex" means back to yours.
          if (was === 'vex' || !VexStore.get('vex.lookSavedLayout', null)) {
            await VexStore.set('vex.lookSavedLayout', { position: layoutNow, buttons: buttonsNow });
          }
          await VexStore.set('vex.toolbarPosition', look.layout);
          await VexStore.set('vex.toolbarButtons', look.buttons);
          VexUI.applyToolbarPosition();
          VexUI.renderToolbar();
        }
      } else {
        const saved = VexStore.get('vex.lookSavedLayout', null);
        if (saved && saved.position && (saved.position !== layoutNow
          || JSON.stringify(saved.buttons) !== JSON.stringify(buttonsNow))
          && await VexUI.offer('Put the toolbar back the way you had it?', 'Put it back', 'Vex')) {
          await VexStore.set('vex.toolbarPosition', saved.position);
          await VexStore.set('vex.toolbarButtons', saved.buttons);
          VexUI.applyToolbarPosition();
          VexUI.renderToolbar();
        }
        await VexStore.set('vex.lookSavedLayout', null);
      }
      this.appearance();
    },

    appearance() {
      const body = openShell('appearance', 'Appearance');
      const preference = VexStore.get('vex.theme', 'auto');

      // ── Look: Vex, or dressed as another browser ───────────────────────
      body.appendChild(heading('Look'));
      const looks = el('div', 'look-grid');
      const lookNow = VexTheme.look();
      const dark = VexTheme.isDark();
      for (const [id, look] of Object.entries(VexTheme.LOOKS)) {
        const card = el('button', { class: 'look-card' + (id === lookNow ? ' on' : ''), 'data-look-id': id });
        // A drawing of its bar, in its own colours (or the theme's, for Vex).
        const palette = look.light ? (dark ? look.dark : look.light) : null;
        const mock = el('div', 'look-mock');
        mock.style.background = palette ? palette['--vex-bg-base'] : VexTheme.current().bg;
        mock.style.border = '1px solid ' + (palette ? palette['--vex-border-subtle'] : 'var(--vex-border-subtle)');
        const field = el('span', 'f');
        field.style.background = palette ? (id === 'safari' ? palette['--vex-bg-elevated'] : palette['--vex-bg-deep']) : 'var(--vex-bg-elevated)';
        field.style.borderRadius = id === 'chrome' ? '9px' : id === 'firefox' ? '4px' : id === 'safari' ? '6px' : id === 'samsung' ? '9px' : '9px';
        const button = () => {
          const dot = el('span', 'b');
          dot.style.background = palette ? (id === 'safari' ? palette['--vex-accent'] : palette['--vex-text-secondary']) : VexTheme.current().accent;
          return dot;
        };
        if (id === 'samsung' || id === 'safari') mock.append(button(), field, button());
        else mock.append(field, button(), button());
        card.appendChild(mock);
        card.appendChild(el('span', 'look-name', look.label));
        card.appendChild(el('span', 'look-note', look.note));
        card.onclick = () => this.chooseLook(id);
        looks.appendChild(card);
      }
      body.appendChild(looks);
      if (lookNow !== 'vex') {
        body.appendChild(valueRow('Colours', 'Its own, light or dark with your theme — or your theme’s',
          VexTheme.lookColors() === 'theme' ? 'Your theme’s' : VexTheme.LOOKS[lookNow].label + '’s',
          () => VexSheets.choose('Colours', [
            { id: 'look', label: VexTheme.LOOKS[lookNow].label + '’s own', note: 'Light or dark, following your theme (Auto: the phone)', selected: VexTheme.lookColors() === 'look' },
            { id: 'theme', label: 'Your theme’s', note: 'The look’s shapes in your theme’s colours', selected: VexTheme.lookColors() === 'theme' }
          ], async which => {
            await VexTheme.setLookColors(which);
            VexSheets.close();
            this.appearance();
          })));
      }

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
        card.appendChild(el('div', 'theme-name', theme.id === 'auto' ? 'Auto' : String(theme.label || theme.id).split(' — ')[0]));
        card.onclick = async () => { await VexTheme.set(theme.id); this.appearance(); };
        grid.appendChild(card);
      }
      body.appendChild(grid);
      body.appendChild(el('div', 'field-note',
        'Auto follows the system: Oxford in the light, Midnight in the dark. The rest are the same themes '
        + 'the desktop app ships, generated from the same token files.'
        + (lookNow !== 'vex' && VexTheme.lookColors() === 'look'
          ? ' With a browser look on, the theme decides light or dark; the look brings its own colours.' : '')));

      body.appendChild(heading('The toolbar'));
      const position = VexStore.get('vex.toolbarPosition', 'bottom');
      const LAYOUT_NAMES = { bottom: 'Bottom', top: 'Top', split: 'Split', stacked: 'Stacked' };
      body.appendChild(valueRow('Layout', 'Where the address bar and the buttons live',
        LAYOUT_NAMES[position] || 'Bottom',
        () => VexSheets.choose('Toolbar layout', [
          { id: 'bottom', label: 'Bottom', note: 'One bar, within reach of your thumb', selected: !['top', 'split', 'stacked'].includes(position) },
          { id: 'top', label: 'Top', note: 'One bar, where desktop browsers put it', selected: position === 'top' },
          { id: 'split', label: 'Split', note: 'Address at the top, buttons along the bottom — Samsung Internet', selected: position === 'split' },
          { id: 'stacked', label: 'Stacked', note: 'Address above the buttons, both at the bottom — Safari', selected: position === 'stacked' }
        ], async position => {
          await VexStore.set('vex.toolbarPosition', position);
          VexUI.applyToolbarPosition();
          VexSheets.close();
          this.appearance();
        })));
      body.appendChild(toggleRow('Show the status bar', 'Off gives the page the strip with the clock in it; swipe down from the top to see it',
        VexStore.get('vex.hideStatusBar', false) !== true, async value => {
          await VexStore.set('vex.hideStatusBar', !value);
          await VexBridge.setStatusBarHidden(!value);
          VexUI.scheduleBounds();
        }));
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
      const scale = Number(VexStore.get('vex.uiScale', 1));
      body.appendChild(valueRow('Interface size', 'Vex’s own buttons and labels, not the page',
        (VexTheme.UI_SCALES.find(pair => pair[0] === scale) || VexTheme.UI_SCALES[0])[1],
        () => VexSheets.choose('Interface size', VexTheme.UI_SCALES.map(([value, label]) => ({
          id: String(value), label, selected: value === scale
        })), async picked => {
          await VexTheme.setUiScale(Number(picked));
          VexSheets.close();
          this.appearance();
        })));

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
      body.appendChild(toggleRow('Open links in their apps',
        'A YouTube link in YouTube, a post in its app — when you tap it, from another site, and never from a private tab',
        VexStore.get('vex.openInApps', true) !== false, async value => {
          await VexStore.set('vex.openInApps', value);
          await VexBridge.setOpenInApps(value);
        }));
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

      body.appendChild(heading('Battery'));
      body.appendChild(valueRow('Let background tabs sleep', 'Their timers and animations stop; the page stays loaded',
        (() => { const minutes = Number(VexStore.get('vex.sleepTabs', 15)); return minutes ? 'after ' + minutes + ' min' : 'Never'; })(),
        () => VexSheets.choose('Sleep a tab you have left', [
          { id: 0, label: 'Never' }, { id: 5, label: 'After 5 minutes' },
          { id: 15, label: 'After 15 minutes' }, { id: 30, label: 'After half an hour' },
          { id: 120, label: 'After two hours' }
        ].map(option => Object.assign(option, { selected: option.id === Number(VexStore.get('vex.sleepTabs', 15)) })),
        async minutes => {
          await VexStore.set('vex.sleepTabs', Number(minutes));
          VexSheets.close();
          this.tabsSettings();
        })));
      body.appendChild(el('div', 'field-note',
        'A tab you are not looking at goes on running: its timers fire, its animations animate, a script '
        + 'that polls keeps polling. Sleeping one stops that and keeps the page loaded, so coming back to '
        + 'it is instant. Nothing sleeps while "keep playing in the background" is on, because pausing a '
        + 'tab silences what it is playing.'));
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
            { icon: 'up', label: 'Move up', run: async item => { await VexCollections.quick.move(item.url, -1); VexSync.schedulePush(); this.quickAccess(); } },
            { icon: 'down', label: 'Move down', run: async item => { await VexCollections.quick.move(item.url, 1); VexSync.schedulePush(); this.quickAccess(); } }
          ],
          onRemove: async item => {
            const index = VexCollections.quick.all().findIndex(other => other.url === item.url);
            await VexCollections.quick.remove(item.url);
            VexSync.schedulePush();
            this.quickAccess();
            undo('Tile removed', async () => {
              await VexCollections.quick.restore(item, index);
              VexSync.schedulePush();
              this.quickAccess();
            });
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
      const mine = drawn;
      const hasToken = await VexAI.hasToken();
      if (mine !== drawn) return;

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
      body.appendChild(valueRow('AI Lab',
        'Ask Image, Audio Scribe, Prompt Lab, Agent Skills, Tiny Garden, Mobile Actions, Scrapbook', '',
        () => VexLab.home()));
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
      if (mine !== drawn) return;
      body.appendChild(VexSheets.row({
        icon: 'history', label: stats.visits.toLocaleString() + ' visits',
        note: stats.pages.toLocaleString() + ' pages searchable · ' + stats.saved + ' saved offline',
        run: async () => { await this.storage(); return true; }
      }));

      body.appendChild(heading('The last problems'));
      const errors = await VexReport.all(40);
      if (mine !== drawn) return;
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
      const mine = drawn;
      // The model's download reports progress, and finishes, while this page
      // is open. Nothing was listening, so the row said "0 MB so far" until
      // you left and came back. Redrawn at most twice a second, and only
      // while this page is the one showing.
      if (!localAIFollowed) {
        localAIFollowed = true;
        let pending = null;
        VexLocalAI.onChange(() => {
          if (pending) return;
          pending = setTimeout(() => {
            pending = null;
            if (!$('panel').hidden && stack[stack.length - 1] === 'localai') this.localAI();
          }, 500);
        });
      }
      await VexLocalAI.refresh();
      if (mine !== drawn) return;
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
        'LiteRT-LM runs a model in Vex’s own process — no network, no account, and it keeps working with the '
        + 'aeroplane mode on. These are the Google AI Edge Gallery’s models, the same files: tap one to download '
        + 'it. Gemma 3 and FunctionGemma ask you to accept Google’s licence on Hugging Face once.'));
      body.appendChild(valueRow('AI Lab', 'What these models can do: chat, pictures, audio, agents, games', '',
        () => VexLab.home()));

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

      let family = '';
      for (const entry of VexLocalAI.MODELS) {
        if (entry.family !== family) { family = entry.family; body.appendChild(heading(family)); }
        const file = VexLocalAI.fileOf(entry);
        const here = !!file;
        const busy = state.downloading && state.downloading.name === entry.name;
        const llm = entry.kind === 'llm';
        const size = here ? ((Number(state.models[file]) || 0) / 1048576).toFixed(0) + ' MB on disk' : entry.size;
        const what = [entry.image ? 'images' : '', entry.audio ? 'audio' : '', entry.tasks.includes('agent') ? 'tools' : '']
          .filter(Boolean);
        body.appendChild(VexSheets.row({
          icon: busy ? 'sync' : here ? 'check' : 'download',
          label: entry.label + (llm && chosen === file && file ? ' · assistant' : ''),
          note: entry.note + (what.length ? ' Reads ' + what.join(' and ') + '.' : '')
            + ' · ' + size + (entry.ram ? ' · ' + entry.ram + ' GB RAM' : '') + (entry.gated && !here ? ' · licence' : ''),
          run: async () => {
            VexSheets.choose(entry.label, [
              !here && !busy ? { id: 'get', label: 'Download · ' + entry.size,
                note: entry.gated
                  ? (VexLocalAI.hfToken() ? 'With your Hugging Face token' : 'Needs the licence accepted and a Hugging Face token')
                  : 'Straight from ' + (entry.repo ? 'Hugging Face' : 'Google') + '; resumes if it drops' } : null,
              here && llm ? { id: 'use', label: 'Use it for the assistant', note: chosen === file ? 'Already in use' : '' } : null,
              { id: 'lab', label: 'Open in AI Lab', note: entry.tasks.map(task => (VexLab.FEATURES.find(item => item.id === task) || {}).label).filter(Boolean).join(', ') },
              entry.page ? { id: 'page', label: 'Open its page', note: entry.gated ? 'Accept the licence here' : '' } : null,
              { id: 'import', label: 'Import a file', note: 'One you already downloaded' },
              { id: 'url', label: 'Download from another link' },
              here ? { id: 'delete', label: 'Delete it from this phone', danger: true } : null
            ].filter(Boolean), async choice => {
              VexSheets.close();
              if (choice === 'get') {
                if (entry.gated && !VexLocalAI.hfToken()) {
                  const token = await VexUI.prompt('Hugging Face token',
                    'Accept the licence on the model’s page first (Open its page), then paste a read token from huggingface.co/settings/tokens. It stays on this phone.');
                  if (!token) return;
                  await VexLocalAI.setHfToken(token);
                }
                try { await VexLocalAI.downloadModel(entry); } catch (error) { VexUI.toast(error.message, 4000); }
                this.localAI();
              }
              if (choice === 'use') { await VexLocalAI.setModel(file); this.localAI(); }
              if (choice === 'lab') VexLab.open(entry.tasks[0]);
              if (choice === 'page') { VexPanels.close(); VexUI.openUrl(entry.page, { newTab: true }); }
              if (choice === 'import') {
                if (await VexLocalAI.importFile(entry.name)) VexUI.toast('Copying it in…');
              }
              if (choice === 'url') {
                const url = await VexUI.prompt('Download ' + entry.label, 'A direct link to the file');
                if (!url) return;
                const token = await VexUI.prompt('Access token', 'Only if the link needs one — leave empty otherwise');
                await VexLocalAI.download(entry.name, url, token || '');
                this.localAI();
              }
              if (choice === 'delete') {
                if (await VexUI.confirm('Delete ' + entry.label + '?')) { await VexLocalAI.remove(file); this.localAI(); }
              }
            });
            return true;
          }
        }));
      }

      // Files that are not in the catalogue: an older Vex's names, or a model
      // imported under its own name.
      const known = new Set(VexLocalAI.MODELS.map(entry => VexLocalAI.fileOf(entry)).filter(Boolean));
      const others = installed.filter(name => !known.has(name));
      if (others.length) {
        body.appendChild(heading('Other files on this phone'));
        for (const name of others) {
          body.appendChild(VexSheets.row({
            icon: 'check', label: name + (chosen === name ? ' · assistant' : ''),
            note: ((Number(state.models[name]) || 0) / 1048576).toFixed(0) + ' MB on disk',
            run: async () => {
              VexSheets.choose(name, [
                { id: 'use', label: 'Use it for the assistant' },
                { id: 'delete', label: 'Delete it from this phone', danger: true }
              ], async choice => {
                VexSheets.close();
                if (choice === 'use') { await VexLocalAI.setModel(name); this.localAI(); }
                if (choice === 'delete' && await VexUI.confirm('Delete ' + name + '?')) { await VexLocalAI.remove(name); this.localAI(); }
              });
              return true;
            }
          }));
        }
      }

      body.appendChild(valueRow('Hugging Face token',
        'For the models behind a licence. Kept on this phone; sent only to huggingface.co',
        VexLocalAI.hfToken() ? 'Set' : 'None', async () => {
          const token = await VexUI.prompt('Hugging Face token', 'A read token from huggingface.co/settings/tokens — empty to remove it',
            VexLocalAI.hfToken());
          if (token === null || token === undefined) return;
          await VexLocalAI.setHfToken(token);
          this.localAI();
        }));

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
      if (mine !== drawn) return;
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
