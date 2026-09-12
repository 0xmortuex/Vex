// @vitest-environment jsdom
//
// The extension catalogue is advice, so it has to stay honest: every entry says
// what actually happens under Electron's partial extension support, and points
// at the publisher's own release page over https.

import { describe, it, expect } from 'vitest';

const { VexExtensionCatalog } = require('../../src/renderer/js/extension-catalog.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons;
globalThis.VexExtensionCatalog = VexExtensionCatalog;
const { ExtensionsSettings } = require('../../src/renderer/js/extensions-settings.js');
window.escapeHtml = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;');

describe('extension catalogue', () => {
  it('describes each extension and where it really comes from', () => {
    expect(VexExtensionCatalog.ENTRIES.length).toBeGreaterThanOrEqual(4);
    for (const e of VexExtensionCatalog.ENTRIES) {
      expect(e.id, 'id').toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(e.name && e.what && e.works, e.id).toBeTruthy();
      expect(e.source, e.id).toMatch(/^https:\/\//);
      expect('caveat' in e, e.id).toBe(true);   // stated, even when null
    }
  });

  it('says plainly that a blocker cannot block here', () => {
    const ublock = VexExtensionCatalog.get('ublock-origin');
    expect(ublock.works).toMatch(/cannot block/i);
    expect(VexExtensionCatalog.UNSUPPORTED.join(' ')).toMatch(/Blocking requests/);
  });

  it('lists the limits a user would otherwise blame on themselves', () => {
    const text = VexExtensionCatalog.UNSUPPORTED.join(' ').toLowerCase();
    for (const missing of ['contextmenus', 'commands', 'storage.sync', 'tabs.create', 'tor']) {
      expect(text, missing).toContain(missing);
    }
  });

  it('has unique ids and no emoji', () => {
    const ids = VexExtensionCatalog.ENTRIES.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const all = JSON.stringify(VexExtensionCatalog.ENTRIES) + VexExtensionCatalog.UNSUPPORTED.join('');
    expect(all).not.toMatch(/\p{Extended_Pictographic}/u);
  });
  it('marks the ones Electron can only partly run', () => {
    for (const e of VexExtensionCatalog.ENTRIES) expect(typeof e.limited, e.id).toBe('boolean');
    expect(VexExtensionCatalog.get('ublock-origin').limited).toBe(true);
    expect(VexExtensionCatalog.get('dark-reader').limited).toBe(false);
  });
});

// The manager is where this advice is actually read, so it must show every
// entry — a catalogue nobody sees is the same as no catalogue.
describe('the extensions manager shows the catalogue', () => {
  it('lists every suggestion with its link and its real behaviour', async () => {
    window.vex = { extensionsList: async () => [] };
    const host = document.createElement('div');
    document.body.appendChild(host);
    await ExtensionsSettings.render(host);

    for (const e of VexExtensionCatalog.ENTRIES) {
      expect(host.textContent, e.id).toContain(e.name);
      expect(host.querySelector(`[data-open="${e.source}"]`), e.id).toBeTruthy();
    }
    // uBlock's limit is the one people hit; it has to be on screen, not implied.
    expect(host.textContent).toMatch(/CANNOT block requests/);
    expect(host.querySelectorAll('.ext-suggest-limited').length).toBe(
      VexExtensionCatalog.ENTRIES.filter(e => e.limited).length);
    // And the "can't do" list is the catalogue's, not a second hand-written copy.
    for (const line of VexExtensionCatalog.UNSUPPORTED) {
      expect(host.textContent).toContain(line.split(' (')[0].split(' —')[0]);
    }
  });
});
