// The cosmetic-filter preload is on the default session, which Vex's own
// window runs in. There it watched every class and id change of Vex's own page
// and asked main about each batch (9-15 ms per panel or Ctrl+K redraw). The
// two handlers now answer "nothing to do" for Vex's own pages and behave as
// before for every other.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const enginePath = require.resolve('../../src/adblocker-engine.js');
const electronPath = require.resolve('electron');

let handlers, engine, blocker;
beforeEach(() => {
  handlers = {};
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: { ipcMain } };
  delete require.cache[enginePath];
  engine = require('../../src/adblocker-engine.js');
  blocker = { onInjectCosmeticFilters: vi.fn(async () => {}), onIsMutationObserverEnabled: vi.fn(() => true) };
  engine._setEngineForTests({ blocker });
});

const own = (event) => String(event.url).startsWith('file:///vex/renderer/');
const INJECT = '@ghostery/adblocker/inject-cosmetic-filters';
const OBSERVE = '@ghostery/adblocker/is-mutation-observer-enabled';

describe('cosmetic filtering and Vex\'s own pages', () => {
  it('asks the engine nothing for Vex\'s own page and starts no mutation observer there', async () => {
    engine.enableCosmeticFiltering(() => true, own);
    const ev = { url: 'file:///vex/renderer/index.html', sender: {}, frameId: 0, processId: 1 };
    await handlers[INJECT](ev, ev.url, { type: 'features', classes: ['ad'] });
    expect(blocker.onInjectCosmeticFilters).not.toHaveBeenCalled();
    expect(handlers[OBSERVE](ev)).toBe(false);
    expect(blocker.onIsMutationObserverEnabled).not.toHaveBeenCalled();
  });

  it('serves a website exactly as before', async () => {
    engine.enableCosmeticFiltering(() => true, own);
    const ev = { url: 'https://example.com/', sender: { insertCSS() {}, executeJavaScript() {} }, frameId: 0, processId: 1 };
    await handlers[INJECT](ev, ev.url, { type: 'features', classes: ['ad'] });
    expect(blocker.onInjectCosmeticFilters).toHaveBeenCalledTimes(1);
    expect(handlers[OBSERVE](ev)).toBe(true);
  });

  it('with no page test given, nothing changes', async () => {
    engine.enableCosmeticFiltering(() => true);
    const ev = { url: 'file:///vex/renderer/index.html', sender: { insertCSS() {}, executeJavaScript() {} }, frameId: 0, processId: 1 };
    await handlers[INJECT](ev, ev.url, {});
    expect(blocker.onInjectCosmeticFilters).toHaveBeenCalledTimes(1);
    expect(handlers[OBSERVE](ev)).toBe(true);
  });
});
