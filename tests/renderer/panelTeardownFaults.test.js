// @vitest-environment jsdom
//
// Listeners that outlived the UI that created them, and panels that reported
// success for work that had not happened. Each of these was reproducible by
// driving the real app; the tests pin the behaviour rather than the mechanism
// wherever they can.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');

let toasts;
// Counts document-level listeners so a leak is measurable rather than inferred.
function trackDocumentListeners(type) {
  const realAdd = document.addEventListener.bind(document);
  const realRemove = document.removeEventListener.bind(document);
  const counter = { added: 0, removed: 0, get live() { return this.added - this.removed; } };
  document.addEventListener = (t, f, c) => { if (t === type) counter.added++; return realAdd(t, f, c); };
  document.removeEventListener = (t, f, c) => { if (t === type) counter.removed++; return realRemove(t, f, c); };
  counter.stop = () => { document.addEventListener = realAdd; document.removeEventListener = realRemove; };
  return counter;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  toasts = [];
  window.showToast = (message, type, duration) => toasts.push({ message, type, duration });
  window.vexConfirm = vi.fn(async () => true);
});
afterEach(() => { vi.restoreAllMocks(); });
const lastToast = () => toasts[toasts.length - 1] || {};

// ---------------------------------------------------------------------------
describe('shortcut editor: key capture is torn down with the panel', () => {
  beforeEach(() => {
    vi.resetModules();
    require('../../src/renderer/js/shortcuts-registry.js');
    require('../../src/renderer/js/shortcut-editor.js');
    global.ShortcutsRegistry = window.ShortcutsRegistry;
    ShortcutsRegistry.resetAll();
    // Only NON-system shortcuts with a registered handler render as rebindable
    // buttons; everything else is a locked row the editor never captures for.
    ShortcutsRegistry.register('ask-ai-bar', () => {});
    ShortcutsRegistry.register('bookmark', () => {});
  });

  function openPanel() {
    const host = document.createElement('div');
    host.id = 'shortcuts-editor-content';
    document.body.appendChild(host);
    window.ShortcutEditor.renderPanel(host);
    return host;
  }
  const press = (init) => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));

  it('a keystroke after the panel is closed is neither swallowed nor bound', () => {
    const host = openPanel();
    const btn = host.querySelector('button.shortcut-key');
    const id = btn.dataset.id;
    btn.click();
    host.remove();                       // the panel goes away mid-capture

    const event = new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);            // not swallowed
    expect(ShortcutsRegistry.getAllShortcuts()[id].isCustom).toBe(false);  // not bound
    expect(JSON.parse(localStorage.getItem('vex.userShortcuts') || '{}')).toEqual({});
  });

  it('unbinds its document listener when the capture ends any way at all', () => {
    const host = openPanel();
    const counter = trackDocumentListeners('keydown');
    try {
      const btn = host.querySelector('button.shortcut-key');
      btn.click();
      expect(counter.live).toBe(1);
      press({ key: 'Escape' });                    // cancelled
      expect(counter.live).toBe(0);

      host.querySelector('button.shortcut-key').click();
      window.dispatchEvent(new Event('blur'));     // window lost focus
      expect(counter.live).toBe(0);

      host.querySelector('button.shortcut-key').click();
      document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));  // clicked elsewhere
      expect(counter.live).toBe(0);
    } finally { counter.stop(); }
  });

  it('a second capture cancels the first instead of stacking listeners', () => {
    const host = openPanel();
    const counter = trackDocumentListeners('keydown');
    try {
      const buttons = host.querySelectorAll('button.shortcut-key');
      buttons[0].click();
      buttons[1].click();
      expect(counter.live).toBe(1);
      press({ key: 'Escape' });
      expect(counter.live).toBe(0);
    } finally { counter.stop(); }
  });

  it('says the binding is session-only when it could not be persisted', () => {
    const host = openPanel();
    const btn = host.querySelector('button.shortcut-key');
    btn.click();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    press({ key: 'j', ctrlKey: true, altKey: true });
    expect(lastToast().type).toBe('error');
    expect(lastToast().message).toMatch(/could not be saved/i);
  });
});

// ---------------------------------------------------------------------------
describe("What's New: the Escape handler does not outlive the modal", () => {
  it('unbinds however the modal is closed, and does not accumulate', async () => {
    vi.resetModules();
    window.vex = {
      getAppVersion: async () => '9.9.9',
      getReleaseNotes: async () => ({ version: 'v9.9.9', name: 'Vex 9.9.9', body: '- a change' }),
      getReleaseList: async () => ([{ version: 'v9.9.9', name: 'Vex 9.9.9', body: '- a change' }]),
      openExternal: () => {},
    };
    localStorage.setItem('vex.lastSeenVersion', '9.9.9');
    require('../../src/renderer/js/update-log.js');
    const counter = trackDocumentListeners('keydown');
    try {
      for (let i = 0; i < 3; i++) {
        await window.VexWhatsNew.open();
        expect(document.querySelector('.whatsnew-ov')).toBeTruthy();
        document.querySelector('.whatsnew-btn').click();   // "Got it", not Escape
        expect(document.querySelector('.whatsnew-ov')).toBeNull();
      }
      expect(counter.live).toBe(0);
    } finally { counter.stop(); }
  });
});

// ---------------------------------------------------------------------------
describe('screen picker: the Escape handler does not outlive the chooser', () => {
  it('unbinds when a source is chosen and when the picker is cancelled', () => {
    vi.resetModules();
    let openHandler;
    const chosen = [];
    window.vex = {
      onScreenPickerOpen: (cb) => { openHandler = cb; },
      chooseScreenSource: (...args) => chosen.push(args),
    };
    require('../../src/renderer/js/screen-picker.js');
    const counter = trackDocumentListeners('keydown');
    try {
      const payload = { id: 'req1', sources: [{ id: 'screen:0', name: 'Screen 1', isScreen: true }] };
      openHandler(payload);
      expect(counter.live).toBe(1);
      document.querySelector('.scrpick-item').click();     // picked a source
      expect(chosen[0][1]).toBe('screen:0');
      expect(counter.live).toBe(0);

      openHandler({ ...payload, id: 'req2' });
      document.querySelector('.scrpick-cancel').click();   // cancelled
      expect(counter.live).toBe(0);
      expect(document.querySelector('.scrpick-ov')).toBeNull();
    } finally { counter.stop(); }
  });
});

// ---------------------------------------------------------------------------
describe('layout editor: reordering the rail redraws Settings → Sidebar Buttons', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = `
      <div id="icon-sidebar">
        <button class="sidebar-icon" data-panel="start" title="Start Page"><svg></svg></button>
        <button class="sidebar-icon" data-panel="notes" title="Notes"><svg></svg></button>
        <button class="sidebar-icon" data-panel="downloads" title="Downloads"><svg></svg></button>
        <div class="sidebar-spacer"></div>
      </div>
      <div id="sidebar-manager-list"></div>`;
  });

  const listedNames = () => Array.from(document.querySelectorAll('#sidebar-manager-list > div'))
    .map(row => row.children[1].textContent);

  it('the settings list matches the rail immediately after a drag', () => {
    const { SidebarManager } = require('../../src/renderer/js/sidebar.js');
    global.SidebarManager = SidebarManager;
    const { LayoutEditor } = require('../../src/renderer/js/layout-editor.js');
    SidebarManager.renderSidebarManager();
    expect(listedNames()).toEqual(['Start Page', 'Notes', 'Downloads']);

    const rail = document.getElementById('icon-sidebar');
    const buttons = SidebarManager._topButtons();
    rail.insertBefore(buttons[1], buttons[0]);      // what a drop does to the DOM
    LayoutEditor._persistOrder(rail);

    expect(JSON.parse(localStorage.getItem('vex.sidebarOrder'))).toEqual(['notes', 'start', 'downloads']);
    // This is the bug: the order was written, but the Settings list kept showing
    // the pre-drag order until Settings was reopened.
    expect(listedNames()).toEqual(['Notes', 'Start Page', 'Downloads']);
    delete global.SidebarManager;
  });

  it('warns when the new order could not be persisted', () => {
    const { SidebarManager } = require('../../src/renderer/js/sidebar.js');
    global.SidebarManager = SidebarManager;
    const { LayoutEditor } = require('../../src/renderer/js/layout-editor.js');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    LayoutEditor._persistOrder(document.getElementById('icon-sidebar'));
    expect(lastToast().type).toBe('error');
    expect(lastToast().message).toMatch(/could not be saved/i);
    delete global.SidebarManager;
  });
});
