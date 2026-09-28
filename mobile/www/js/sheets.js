// === Vex Mobile — bottom sheets ===
//
// Three sheets share one element: the menu, the site sheet (tap the icon in
// the URL pill) and the long-press menu on a link or image. They share it
// because only one can ever be up, and because a phone's bottom sheet is the
// mobile answer to the desktop's right-click menu — the same choices, in the
// place your thumb already is.

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

  function show() {
    if (!open) { shell().hidden = false; open = true; }
  }

  function close() {
    if (!open) return;
    shell().hidden = true;
    open = false;
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
      const node = el('button', 'quick' + (button.on ? ' on' : ''), null);
      node.setAttribute('aria-label', button.label);
      node.appendChild(icon(button.icon));
      node.onclick = async () => {
        const keep = await button.run(node);
        if (keep !== true) close();
      };
      bar.appendChild(node);
    }
  }

  return {
    close,
    isOpen() { return open; },

    // ── The main menu ──────────────────────────────────────────────────────
    async menu() {
      const tab = VexTabStore.active();
      const url = tab ? tab.url : '';
      const live = !!(url && url !== 'about:blank');
      const host = live ? VexSearch.prettyHost(url) : '';
      const starred = live && VexStore.get('vex.bookmarks', []).some(entry => entry.url === url);
      reset(null, live ? host : null);

      quick([
        { icon: 'forward', label: 'Forward', run: () => { if (tab) VexBridge.forward(tab.id); } },
        { icon: 'reload', label: 'Reload', run: () => { if (tab) VexBridge.reload(tab.id); } },
        { icon: 'star', label: starred ? 'Remove bookmark' : 'Bookmark', on: starred, run: () => VexUI.toggleBookmark() },
        { icon: 'share', label: 'Share', run: () => { if (live) VexBridge.share(url, tab.title); } }
      ]);

      const list = $('sheet-list');
      const rows = [
        { icon: 'plus', label: 'New tab', run: () => VexUI.newTab() },
        { icon: 'private', label: 'New private tab', run: () => VexUI.newTab({ incognito: true }) },
        { icon: 'sparkle', label: 'Ask the assistant', note: live ? 'About ' + host : 'Chat', run: () => VexViews.openAI() },
        { icon: 'book', label: 'Reader', note: live ? null : 'Open a page first', run: () => live && VexViews.openReader() },
        { icon: 'find', label: 'Find in page', run: () => VexUI.openFind() },
        { icon: 'shield', label: 'This site', note: live ? VexSiteRules.describe(host) : null, run: () => live && VexSheets.site(host) },
        { icon: 'star', label: 'Bookmarks', run: () => VexPanels.bookmarks() },
        { icon: 'history', label: 'History', run: () => VexPanels.history() },
        { icon: 'download', label: 'Downloads', run: () => VexPanels.downloads() },
        { icon: 'print', label: 'Print or save as PDF', run: () => { if (tab) VexBridge.print(tab.id); } },
        { icon: 'copy', label: 'Copy link', run: () => VexUI.copy(url) },
        { icon: 'history', label: 'Reopen closed tab', run: () => VexUI.reopenClosed() },
        { icon: 'settings', label: 'Settings', run: () => VexPanels.settings() }
      ];
      for (const entry of rows) list.appendChild(row(entry));
      show();
      return true;
    },

    // ── One site's rules ───────────────────────────────────────────────────
    site(host) {
      if (!host) return;
      const rules = VexSiteRules.for(host);
      const tab = VexTabStore.active();
      reset(host, VexSiteRules.describe(host));

      const list = $('sheet-list');
      const flip = async (key, next) => {
        await VexSiteRules.set(host, key, next);
        if (tab) await VexSiteRules.applyTo(tab);
        return true;                            // keep the sheet up
      };

      list.appendChild(row({
        icon: 'shield', label: 'Block ads and trackers', toggle: rules.blocking,
        run: async node => {
          const next = !VexSiteRules.for(host).blocking;
          node.querySelector('.switch').classList.toggle('on', next);
          await flip('blocking', next);
          if (tab) await VexBridge.reload(tab.id);
          return true;
        }
      }));
      list.appendChild(row({
        icon: 'text', label: 'JavaScript', note: 'Takes effect on reload', toggle: rules.scripts,
        run: async node => {
          const next = !VexSiteRules.for(host).scripts;
          node.querySelector('.switch').classList.toggle('on', next);
          await flip('scripts', next);
          if (tab) await VexBridge.reload(tab.id);
          return true;
        }
      }));
      list.appendChild(row({
        icon: 'image', label: 'Images', toggle: rules.images,
        run: async node => {
          const next = !VexSiteRules.for(host).images;
          node.querySelector('.switch').classList.toggle('on', next);
          return flip('images', next);
        }
      }));
      list.appendChild(row({
        icon: 'desktop', label: 'Desktop site', toggle: rules.desktop === true,
        run: async node => {
          const next = VexSiteRules.for(host).desktop !== true ? true : null;
          node.querySelector('.switch').classList.toggle('on', next === true);
          return flip('desktop', next);
        }
      }));
      list.appendChild(row({
        icon: 'palette', label: 'Force dark', toggle: rules.dark === true,
        run: async node => {
          const next = VexSiteRules.for(host).dark !== true ? true : null;
          node.querySelector('.switch').classList.toggle('on', next === true);
          return flip('dark', next);
        }
      }));
      list.appendChild(row({
        icon: 'text', label: 'Text size', value: Math.round(rules.zoom * 100) + '%',
        run: async node => {
          const steps = [0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75];
          const current = VexSiteRules.for(host).zoom;
          const next = steps[(steps.indexOf(current) + 1) % steps.length] || 1;
          node.querySelector('.row-value').textContent = Math.round(next * 100) + '%';
          await VexSiteRules.set(host, 'zoom', next);
          if (tab) await VexBridge.setZoom(tab.id, next);
          return true;
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
        list.appendChild(row({ icon: 'copy', label: 'Copy link', run: () => VexUI.copy(link) }));
        list.appendChild(row({ icon: 'share', label: 'Share link', run: () => VexBridge.share(link, link) }));
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

    // ── A generic picker, for settings that are a list of choices ──────────
    choose(title, options, onPick) {
      reset(title, null);
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
