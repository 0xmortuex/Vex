// The ad blocker's page preload runs in every page of a session, including an
// extension's popup, options and background pages and Vex's Picture-in-Picture
// player. Refusing it there raised "Untrusted IPC sender" in all of them
// (2026-09-29); it is now told there is nothing to hide. A website's frame that
// is nobody's tab is still refused.
import { describe, it, expect } from 'vitest';
const { installIpcPolicy } = require('../../src/main/ipc-policy.js');

function setup({ ui = false, owner = null } = {}) {
  const handlers = new Map();
  const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn), on: () => {} };
  const security = { isUiFrame: () => ui, owner: () => owner, isAuxiliary: () => false, ownsTarget: () => true };
  installIpcPolicy(ipcMain, security);
  let reached = 0;
  ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', () => { reached++; return 'filters'; });
  ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', () => { reached++; return true; });
  const call = (ch, url, ...args) => handlers.get(ch)({ sender: {}, senderFrame: { url } }, ...args);
  return { call, reached: () => reached };
}

describe('the ad blocker preload outside a tab', () => {
  it('an extension page or the PiP player is told there is nothing to do', async () => {
    const { call, reached } = setup();
    expect(await call('@ghostery/adblocker/inject-cosmetic-filters', 'chrome-extension://abc/popup.html', 'chrome-extension://abc/popup.html')).toBeUndefined();
    expect(await call('@ghostery/adblocker/is-mutation-observer-enabled', 'file:///C:/vex/src/renderer/pip-player.html')).toBe(false);
    expect(reached()).toBe(0);
  });

  it("a tab's page still reaches the ad blocker", async () => {
    const { call, reached } = setup({ owner: { id: 1 } });
    expect(await call('@ghostery/adblocker/inject-cosmetic-filters', 'https://example.com/', 'https://example.com/')).toBe('filters');
    expect(reached()).toBe(1);
  });

  it('a website frame that is nobody\u2019s tab is still refused', async () => {
    const { call } = setup();
    await expect(call('@ghostery/adblocker/inject-cosmetic-filters', 'https://evil.example/', 'x')).rejects.toThrow('Untrusted IPC sender');
  });
});
