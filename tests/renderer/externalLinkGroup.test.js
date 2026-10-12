// @vitest-environment jsdom
//
// A link opened from another app (Outlook, Discord's desktop app) joined the
// group of whatever tab was in front (found 2026-10-10). Only a tab the link
// came from passes on its group.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The handler as app.js registers it, run against a stand-in TabManager.
function loadHandler() {
  const src = fs.readFileSync(path.resolve('src/renderer/js/app.js'), 'utf8');
  const m = src.match(/window\.vex\?\.onTabCreateFromExternal\?\.\(\(data\) => \{[\s\S]*?\n {2}\}\);/);
  if (!m) throw new Error('external-link handler not found in app.js');
  let handler = null;
  const vex = { onTabCreateFromExternal: (fn) => { handler = fn; }, tabCreatedForExtension: vi.fn() };
  // eslint-disable-next-line no-new-func
  new Function('window', 'TabManager', 'answerExtensionTab', m[0])({ vex }, globalThis.TabManager, vi.fn());
  return handler;
}

beforeEach(() => {
  const front = { id: 'front', groupId: 'work' };
  const opener = { id: 'opener', groupId: 'shop' };
  globalThis.TabManager = {
    getActiveTab: () => front,
    openerForPage: (id) => (id === 7 ? opener : null),
    createTab: vi.fn(() => ({ id: 'new' })),
  };
});

describe('a link opened in a new tab', () => {
  it('from another app joins no group', () => {
    loadHandler()({ url: 'https://outside.example/' });
    expect(TabManager.createTab.mock.calls[0][2]).toBeNull();
  });

  it('from a page of a tab joins that tab\'s group', () => {
    loadHandler()({ url: 'https://inside.example/', opener: 7 });
    expect(TabManager.createTab.mock.calls[0][2]).toBe('shop');
    expect(TabManager.createTab.mock.calls[0][3].openerTabId).toBe('opener');
  });
});
