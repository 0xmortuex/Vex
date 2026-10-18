// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../src/renderer/js/collection-store.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  window.escapeHtml = (s) => String(s);
  globalThis.vexId = (p) => p + '_test';
  globalThis.vexPrompt = vi.fn(async () => '');
  delete window.VexMedals;
});

describe('bookmarking only saves web pages', () => {
  it('refuses the New Tab page (vex://start) without asking for a folder or saving it', async () => {
    const { Bookmarks } = await import('../../src/renderer/js/bookmarks.js');
    Bookmarks.init();
    await Bookmarks.toggle('vex://start', 'New Tab');
    expect(Bookmarks.items).toEqual([]);
    expect(globalThis.vexPrompt).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith('Only web pages can be bookmarked', 'info');
    expect(localStorage.getItem('vex.bookmarks')).toBeNull();
  });

  it('refuses file: and about: pages too', async () => {
    const { Bookmarks } = await import('../../src/renderer/js/bookmarks.js');
    Bookmarks.init();
    for (const u of ['file:///C:/start.html', 'about:blank']) await Bookmarks.toggle(u, 't');
    expect(Bookmarks.items).toEqual([]);
  });

  it('saves a web page and checks the medals at once', async () => {
    const { Bookmarks } = await import('../../src/renderer/js/bookmarks.js');
    window.VexMedals = { runChecks: vi.fn() };
    Bookmarks.init();
    await Bookmarks.toggle('https://a.test/', 'A');
    expect(Bookmarks.items.map(b => b.url)).toEqual(['https://a.test/']);
    expect(JSON.parse(localStorage.getItem('vex.bookmarks')).length).toBe(1);
    expect(window.VexMedals.runChecks).toHaveBeenCalledTimes(1);
  });
});

describe('the Now Playing bar', () => {
  it('drops the row of a tab that was closed while playing', () => {
    const { NowPlaying } = require('../../src/renderer/js/tab-ai-media.js');
    globalThis.TabManager = { tabs: [{ id: 'm1', title: 'Chess' }], switchTab() {} };
    globalThis.WebviewManager = { webviews: new Map() };
    NowPlaying.playing.clear();
    NowPlaying.playing.set('m1', 'Chess');
    NowPlaying._render();
    expect(document.getElementById('vex-nowplaying')).not.toBeNull();
    globalThis.TabManager.tabs = [];
    document.dispatchEvent(new CustomEvent('vex:tab-closed', { detail: { tabId: 'm1' } }));
    expect(NowPlaying.playing.size).toBe(0);
    expect(document.getElementById('vex-nowplaying')).toBeNull();
  });

  it('has a button that hides one row and leaves the others', () => {
    const { NowPlaying } = require('../../src/renderer/js/tab-ai-media.js');
    globalThis.TabManager = { tabs: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], switchTab() {} };
    globalThis.WebviewManager = { webviews: new Map() };
    NowPlaying.playing.clear();
    NowPlaying.playing.set('a', 'A');
    NowPlaying.playing.set('b', 'B');
    NowPlaying._render();
    document.querySelector('#vex-nowplaying [data-dismiss]').click();
    expect([...NowPlaying.playing.keys()]).toEqual(['b']);
    expect(document.querySelectorAll('#vex-nowplaying [data-dismiss]').length).toBe(1);
  });
});
