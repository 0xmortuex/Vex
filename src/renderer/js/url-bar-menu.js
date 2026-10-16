// === The address bar's right-click menu ======================================
//
// Right-clicking the address bar did nothing at all: no Paste, no Paste and
// go, no Select all (found 2026-10-10). The menu is the tab menu's look
// (.tab-context-menu, js/tabs.js), with what every browser offers there.
const UrlBarMenu = {
  // [{ label, action }] for the bar as it is now.
  items(input, onPasteAndGo) {
    const start = input.selectionStart, end = input.selectionEnd;
    const selected = start != null && end != null && end > start ? input.value.slice(start, end) : '';
    const replace = (text) => {
      input.focus();
      input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');
      input.dispatchEvent(new InputEvent('input', { inputType: text ? 'insertFromPaste' : 'deleteByCut', bubbles: true }));
    };
    const read = async () => {
      const text = (await navigator.clipboard.readText()) || '';
      if (!text.trim()) throw new Error('The clipboard is empty');
      return text;
    };
    const items = [];
    if (selected) {
      items.push({ label: 'Cut', action: async () => { await navigator.clipboard.writeText(selected); replace(''); } });
      items.push({ label: 'Copy', action: () => navigator.clipboard.writeText(selected) });
    }
    items.push({ label: 'Paste', action: async () => replace((await read()).replace(/\s*\n\s*/g, ' ')) });
    items.push({ label: 'Paste and go', action: async () => onPasteAndGo((await read()).trim()) });
    items.push({ label: 'Select all', action: () => { input.focus(); input.select(); } });
    // The page's address without what identifies you, or as a Markdown link (js/tabs-nav.js).
    const tab = typeof TabManager !== 'undefined' && TabManager.getActiveTab ? TabManager.getActiveTab() : null;
    if (tab && /^https?:\/\//i.test(tab.url || '') && typeof VexTabsNav !== 'undefined' && VexTabsNav.on('cleanCopy')) {
      items.push({ label: 'Copy clean link', action: () => VexTabsNav.copyLink(tab, 'clean') });
      items.push({ label: 'Copy as Markdown link', action: () => VexTabsNav.copyLink(tab, 'markdown') });
    }
    return items;
  },

  open(e, input, onPasteAndGo) {
    document.querySelectorAll('.tab-context-menu, .tab-group-context-menu, .context-menu-overlay').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'tab-context-menu url-bar-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Address bar');
    for (const item of this.items(input, onPasteAndGo)) {
      const el = document.createElement('div');
      el.className = 'tab-context-item';
      el.setAttribute('role', 'menuitem');
      el.textContent = item.label;
      // mousedown keeps the bar's selection, which Cut and Copy act on.
      el.addEventListener('mousedown', (ev) => ev.preventDefault());
      el.addEventListener('click', () => {
        TabManager._dismissMenu(menu);
        Promise.resolve().then(item.action).catch(err => window.showToast?.(item.label + ' did not work: ' + ((err && err.message) || err), 'error'));
      });
      menu.appendChild(el);
    }
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    document.body.appendChild(menu);
    TabManager._clampMenuToViewport(menu, e.clientX, e.clientY);
    // The tab menu's keys too: arrows, Home, End, Enter, and Escape back to
    // the bar (js/tabs.js).
    TabManager._attachMenuDismissal(menu, { keys: true });
    return menu;
  },

  init(input, { onPasteAndGo }) {
    if (!input) throw new Error('[UrlBarMenu] the address bar is missing');
    if (typeof onPasteAndGo !== 'function') throw new Error('[UrlBarMenu] needs onPasteAndGo');
    input.addEventListener('contextmenu', (e) => { e.preventDefault(); this.open(e, input, onPasteAndGo); });
    // The menu key and Shift+F10 open it under the bar with focus on its
    // first row; focus stayed in the bar, where the arrows did nothing
    // (release check, 2026-10-12).
    input.addEventListener('keydown', (e) => {
      if (!(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) || e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault();
      const r = input.getBoundingClientRect();
      const menu = this.open({ clientX: Math.round(r.left + 12), clientY: Math.round(r.bottom - 4) }, input, onPasteAndGo);
      TabManager._menuFromKeyboard(menu);
    });
  },
};

if (typeof window !== 'undefined') window.UrlBarMenu = UrlBarMenu;
if (typeof module !== 'undefined' && module.exports) module.exports = { UrlBarMenu };
