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
    document.body.appendChild(menu);
    TabManager._clampMenuToViewport(menu, e.clientX, e.clientY);
    TabManager._attachMenuDismissal(menu);
    return menu;
  },

  init(input, { onPasteAndGo }) {
    if (!input) throw new Error('[UrlBarMenu] the address bar is missing');
    if (typeof onPasteAndGo !== 'function') throw new Error('[UrlBarMenu] needs onPasteAndGo');
    input.addEventListener('contextmenu', (e) => { e.preventDefault(); this.open(e, input, onPasteAndGo); });
  },
};

if (typeof window !== 'undefined') window.UrlBarMenu = UrlBarMenu;
if (typeof module !== 'undefined' && module.exports) module.exports = { UrlBarMenu };
