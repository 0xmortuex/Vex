// === Vex Mobile — full-screen panels ===
//
// History, bookmarks, downloads and settings share one panel shell (#panel).
// Each renders into #panel-body and sets its own title and optional header
// action. Everything reads from VexStore, which is the same record shape the
// desktop app keeps ('vex.history' entries are { url, title, at }).

const VexPanels = (() => {
  const shell = () => document.getElementById('panel');
  const body = () => document.getElementById('panel-body');
  const titleEl = () => document.getElementById('panel-title');
  const actionEl = () => document.getElementById('panel-action');

  function escape(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function rows(entries, { onOpen, onRemove, emptyText }) {
    if (!entries.length) return '<div class="list-empty">' + escape(emptyText) + '</div>';
    return entries.map((entry, index) =>
      '<div class="list-row" data-index="' + index + '">'
      + '<div class="lines" data-open="' + index + '">'
      + '<span class="t">' + escape(entry.title || entry.url) + '</span>'
      + '<span class="u">' + escape(entry.sub || entry.url) + '</span>'
      + '</div>'
      + (onRemove ? '<button class="x" data-remove="' + index + '" aria-label="Remove">'
        + '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' : '')
      + '</div>').join('');
  }

  function wire(entries, { onOpen, onRemove }) {
    body().onclick = event => {
      const openTarget = event.target.closest('[data-open]');
      const removeTarget = event.target.closest('[data-remove]');
      if (removeTarget && onRemove) { onRemove(entries[Number(removeTarget.dataset.remove)]); return; }
      if (openTarget && onOpen) onOpen(entries[Number(openTarget.dataset.open)]);
    };
  }

  function open(title, html, { action } = {}) {
    titleEl().textContent = title;
    body().innerHTML = html;
    const button = actionEl();
    if (action) {
      button.hidden = false;
      button.textContent = action.label;
      button.onclick = action.run;
    } else { button.hidden = true; button.onclick = null; }
    shell().hidden = false;
    VexUI.cover(true);       // a native page would otherwise paint over the panel
  }

  function close() {
    if (shell().hidden) return;
    shell().hidden = true;
    body().onclick = null;
    VexUI.cover(false);
  }

  return {
    close,
    isOpen() { return !shell().hidden; },

    history() {
      const entries = VexStore.get('vex.history', []).map(entry => ({
        ...entry,
        sub: entry.url + (entry.at ? ' · ' + new Date(entry.at).toLocaleString() : '')
      }));
      open('History', rows(entries, { emptyText: 'Nothing here yet.', onRemove: true }), {
        action: {
          label: 'Clear',
          run: async () => { await VexStore.set('vex.history', []); VexPanels.history(); VexUI.toast('History cleared'); }
        }
      });
      wire(entries, {
        onOpen: entry => { close(); VexUI.openUrl(entry.url); },
        onRemove: async entry => {
          await VexStore.set('vex.history', VexStore.get('vex.history', []).filter(other => !(other.url === entry.url && other.at === entry.at)));
          VexPanels.history();
        }
      });
    },

    bookmarks() {
      const entries = VexStore.get('vex.bookmarks', []);
      open('Bookmarks', rows(entries, { emptyText: 'No bookmarks yet. Star a page to keep it.', onRemove: true }));
      wire(entries, {
        onOpen: entry => { close(); VexUI.openUrl(entry.url); },
        onRemove: async entry => {
          await VexStore.set('vex.bookmarks', VexStore.get('vex.bookmarks', []).filter(other => other.url !== entry.url));
          VexPanels.bookmarks();
        }
      });
    },

    downloads() {
      const entries = VexStore.get('vex.downloads', []).map(entry => ({
        title: entry.filename || entry.url,
        url: entry.url,
        sub: (entry.filename || '') + (entry.at ? ' · ' + new Date(entry.at).toLocaleString() : '')
      }));
      open('Downloads', rows(entries, { emptyText: 'No downloads yet.', onRemove: true }));
      wire(entries, {
        onOpen: entry => { close(); VexUI.openUrl(entry.url); },
        onRemove: async entry => {
          await VexStore.set('vex.downloads', VexStore.get('vex.downloads', []).filter(other => other.url !== entry.url));
          VexPanels.downloads();
        }
      });
    },

    settings() {
      const engines = Object.entries(VexSearch.ENGINES)
        .map(([id, engine]) => '<option value="' + id + '"' + (id === VexSearch.engineId() ? ' selected' : '') + '>' + escape(engine.name) + '</option>')
        .join('');
      const lists = VexStore.get('vex.blockLists', VexBlock.DEFAULT_LISTS).map((list, index) =>
        '<div class="sheet-row" data-list="' + index + '"><span class="row-label">' + escape(list.name) + '</span>'
        + '<span class="switch' + (list.on ? ' on' : '') + '"></span></div>').join('');
      const zoom = VexStore.get('vex.textZoom', 100);

      open('Settings',
        '<div class="list-head">Search</div>'
        + '<div class="field"><label for="set-engine">Search engine</label><select id="set-engine">' + engines + '</select></div>'
        + '<div class="list-head">Pages</div>'
        + '<div class="field"><label for="set-zoom">Text size</label><select id="set-zoom">'
        + [80, 90, 100, 115, 130, 150, 175, 200].map(value =>
          '<option value="' + value + '"' + (value === zoom ? ' selected' : '') + '>' + value + '%</option>').join('')
        + '</select></div>'
        + '<div class="sheet-row" id="set-dark"><span class="row-label">Dark pages<br><span class="row-note">Ask sites for their dark theme</span></span>'
        + '<span class="switch' + (VexStore.get('vex.darkPages', false) ? ' on' : '') + '"></span></div>'
        + '<div class="sheet-row" id="set-desktop"><span class="row-label">Desktop sites by default</span>'
        + '<span class="switch' + (VexStore.get('vex.desktopDefault', false) ? ' on' : '') + '"></span></div>'
        + '<div class="list-head">Blocking</div>'
        + '<div class="sheet-row" id="set-block"><span class="row-label">Block ads and trackers</span>'
        + '<span class="switch' + (VexBlock.enabled() ? ' on' : '') + '"></span></div>'
        + lists
        + '<div class="sheet-row" id="set-refresh"><span class="row-label">Update filter lists now<br>'
        + '<span class="row-note">Last updated ' + (VexStore.get('vex.blockRulesAt', 0) ? new Date(VexStore.get('vex.blockRulesAt', 0)).toLocaleDateString() : 'never') + '</span></span></div>'
        + '<div class="list-head">Privacy</div>'
        + '<div class="sheet-row" id="set-dnt"><span class="row-label">Send Do Not Track</span>'
        + '<span class="switch' + (VexStore.get('vex.dnt', true) ? ' on' : '') + '"></span></div>'
        + '<div class="sheet-row danger" id="set-clear"><span class="row-label">Clear cookies, cache and history</span></div>'
        + '<div class="list-head">About</div>'
        + '<div class="sheet-row"><span class="row-label">Vex for Android<br><span class="row-note">' + escape(VexUI.version) + ' · system WebView</span></span></div>');

      const toggle = (element, key, after) => {
        element.onclick = async () => {
          const next = !VexStore.get(key, key === 'vex.dnt');
          await VexStore.set(key, next);
          element.querySelector('.switch').classList.toggle('on', next);
          if (after) await after(next);
        };
      };

      document.getElementById('set-engine').onchange = event => VexStore.set('vex.searchEngine', event.target.value);
      document.getElementById('set-zoom').onchange = async event => {
        const percent = Number(event.target.value);
        await VexStore.set('vex.textZoom', percent);
        await VexBridge.setTextZoom(percent);
      };
      toggle(document.getElementById('set-dark'), 'vex.darkPages', async on => {
        const tab = VexTabStore.active();
        if (tab) await VexBridge.setDarkMode(tab.id, on);
      });
      toggle(document.getElementById('set-desktop'), 'vex.desktopDefault');
      toggle(document.getElementById('set-dnt'), 'vex.dnt');
      document.getElementById('set-block').onclick = async () => {
        const next = !VexBlock.enabled();
        await VexBlock.setEnabled(next);
        document.querySelector('#set-block .switch').classList.toggle('on', next);
      };
      document.getElementById('set-refresh').onclick = async () => {
        VexUI.toast('Updating filter lists…');
        const merged = await VexBlock.refresh();
        VexUI.toast(merged ? 'Filter lists updated' : 'Could not reach the lists');
        if (merged) VexPanels.settings();
      };
      document.getElementById('set-clear').onclick = async () => {
        await VexBridge.clearData({ cookies: true, cache: true, storage: true });
        await VexStore.set('vex.history', []);
        VexUI.toast('Cleared');
      };
      body().querySelectorAll('[data-list]').forEach(row => {
        row.onclick = async () => {
          const lists = VexStore.get('vex.blockLists', VexBlock.DEFAULT_LISTS).slice();
          const index = Number(row.dataset.list);
          lists[index] = { ...lists[index], on: !lists[index].on };
          await VexStore.set('vex.blockLists', lists);
          row.querySelector('.switch').classList.toggle('on', lists[index].on);
          await VexBlock.refresh();
        };
      });
    }
  };
})();

if (typeof window !== 'undefined') window.VexPanels = VexPanels;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPanels };
