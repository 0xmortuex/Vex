// @vitest-environment jsdom
//
// The Chrome-extension manager and the toolbar extensions menu. These cover the
// states the extension audit turned up: an extension that is installed and
// switched on but that Electron refused to load must NOT look identical to a
// working one, and manifest icons must survive the trip from an on-disk Windows
// path to an <img src>.
import { describe, it, expect } from 'vitest';

require('../../src/renderer/js/vex-icons.js'); // installs window.VexIcons (loaded first in index.html)
const { ExtensionsSettings } = require('../../src/renderer/js/extensions-settings.js');
const { ExtensionsMenu } = require('../../src/renderer/js/extensions-menu.js');

function ext(overrides) {
  return { folder: 'f-1', name: 'Test', version: '1.0', enabled: true, loaded: true, error: null, ...overrides };
}

describe('ExtensionsSettings._statusOf', () => {
  it('reports a healthy extension as on', () => {
    expect(ExtensionsSettings._statusOf(ext())).toEqual({ label: 'On', tone: 'ok' });
  });

  it('distinguishes "enabled but Electron refused it" from a working extension', () => {
    expect(ExtensionsSettings._statusOf(ext({ loaded: false }))).toEqual({ label: 'Not loaded', tone: 'bad' });
    expect(ExtensionsSettings._statusOf(ext({ loaded: false, error: "Required value 'name' is missing" })))
      .toEqual({ label: 'Failed to load', tone: 'bad' });
  });

  it('shows a disabled extension as disabled even when it also has an error', () => {
    expect(ExtensionsSettings._statusOf(ext({ enabled: false }))).toEqual({ label: 'Disabled', tone: 'off' });
    expect(ExtensionsSettings._statusOf(ext({ enabled: false, error: 'boom', loaded: false })))
      .toEqual({ label: 'Disabled', tone: 'off' });
  });
});

describe('icon file URLs', () => {
  for (const [name, fn] of [['settings', ExtensionsSettings._fileUrl], ['menu', ExtensionsMenu._fileUrl.bind(ExtensionsMenu)]]) {
    it(`${name}: turns a Windows path into a file:// URL`, () => {
      expect(fn('C:\\Users\\USER\\ext\\icon.png')).toBe('file:///C:/Users/USER/ext/icon.png');
    });

    it(`${name}: escapes spaces so the image actually resolves`, () => {
      expect(fn('C:\\Program Files\\ext\\icon 2.png')).toBe('file:///C:/Program%20Files/ext/icon%202.png');
    });

    it(`${name}: returns null when the extension declares no icon`, () => {
      expect(fn(null)).toBeNull();
      expect(fn('')).toBeNull();
      expect(fn(undefined)).toBeNull();
    });

    it(`${name}: does not double the leading slashes on a POSIX path`, () => {
      expect(fn('/home/u/ext/icon.png')).toBe('file:///home/u/ext/icon.png');
    });
  }
});

describe('ExtensionsMenu._rowSubtitle', () => {
  it('offers the popup when the extension has one', () => {
    expect(ExtensionsMenu._rowSubtitle({ hasPopup: true, hasOptions: true })).toBe('Open popup');
  });

  it('falls back to the options page', () => {
    expect(ExtensionsMenu._rowSubtitle({ hasPopup: false, hasOptions: true })).toBe('Open options page');
  });

  it('says so when the extension has neither', () => {
    expect(ExtensionsMenu._rowSubtitle({ hasPopup: false, hasOptions: false })).toBe('No popup or options page');
  });
});

describe('ExtensionsMenu._loadExtensionRows', () => {
  function openMenu() {
    const menu = document.createElement('div');
    menu.className = 'ext-menu';
    const existing = document.createElement('button');
    existing.className = 'ext-menu-item';
    existing.textContent = 'built-in tool';
    menu.appendChild(existing);
    document.body.appendChild(menu);
    ExtensionsMenu._menu = menu;
    return menu;
  }

  it('lists only extensions that are enabled AND loaded', async () => {
    window.vex = { extensionsList: async () => [
      { folder: 'a', name: 'Works', enabled: true, loaded: true, hasPopup: true, iconPath: null },
      { folder: 'b', name: 'Off', enabled: false, loaded: false, hasPopup: true, iconPath: null },
      { folder: 'c', name: 'Broken', enabled: true, loaded: false, hasPopup: true, iconPath: null }
    ] };
    const menu = openMenu();
    await ExtensionsMenu._loadExtensionRows(menu, document.createElement('button'));
    const labels = [...menu.querySelectorAll('.ext-menu-label')].map(n => n.textContent);
    expect(labels).toEqual(['Works']);
    // Extensions sit above the built-in tools, with a separator between.
    expect(menu.firstChild.querySelector('.ext-menu-label').textContent).toBe('Works');
    expect(menu.querySelectorAll('.ext-menu-sep').length).toBe(1);
    ExtensionsMenu._menu = null;
  });

  it('adds nothing when no extension is usable', async () => {
    window.vex = { extensionsList: async () => [{ folder: 'b', name: 'Off', enabled: false, loaded: true }] };
    const menu = openMenu();
    await ExtensionsMenu._loadExtensionRows(menu, document.createElement('button'));
    expect(menu.querySelectorAll('.ext-menu-label').length).toBe(0);
    expect(menu.querySelectorAll('.ext-menu-sep').length).toBe(0);
    ExtensionsMenu._menu = null;
  });

  it('does not touch a menu the user already closed', async () => {
    window.vex = { extensionsList: async () => [{ folder: 'a', name: 'Works', enabled: true, loaded: true }] };
    const menu = openMenu();
    ExtensionsMenu._menu = null;                       // closed while the list was in flight
    await ExtensionsMenu._loadExtensionRows(menu, document.createElement('button'));
    expect(menu.querySelectorAll('.ext-menu-label').length).toBe(0);
  });

  it('survives the list call failing instead of breaking the whole menu', async () => {
    window.vex = { extensionsList: async () => { throw new Error('ipc down'); } };
    const menu = openMenu();
    await expect(ExtensionsMenu._loadExtensionRows(menu, document.createElement('button'))).resolves.toBeUndefined();
    expect(menu.querySelectorAll('.ext-menu-item').length).toBe(1);   // the built-in tool remains
    ExtensionsMenu._menu = null;
  });
});
