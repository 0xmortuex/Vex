// @vitest-environment jsdom
//
// What the Wallpaper Store says after Apply (js/wallpaper-store-ui.js): never "Applied" when the wallpaper is
// switched off or hardly shows, and the Settings section follows what is true now.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const flush = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

let V, state, UI;
const D = { id: 'aurora-polar', title: 'Polar veil', category: 'aurora', source: 'generated', dominant: '#123456', tags: [] };

beforeEach(async () => {
  document.body.innerHTML = '';
  delete window.VexWallpaperSync;
  state = { current: null, enabled: true, shade: { alpha: 0, shows: 1, textOk: true } };
  const listeners = new Set();
  V = {
    DEFAULTS: { dim: 0, blur: 0, auto: true }, FEATURE: 'wallpaper-store',
    list: () => [D], get: () => D, search: () => [D], categories: () => [], isFavourite: () => false, catalogueUrl: () => '',
    current: () => state.current, enabled: () => state.enabled,
    onChange: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    sourceOf: async () => ({ src: 'data:image/svg+xml;charset=utf-8,x' }),
    summarise: async () => ({ lightest: '#ffffff', darkest: '#000000', meanY: 0.3 }),
    thumbOf: async () => 'data:image/svg+xml;charset=utf-8,x',
    apply: vi.fn(async (id, draft) => { state.current = { id, title: D.title, ...draft }; for (const cb of [...listeners]) cb({ current: state.current }); return state.current; }),
    setEnabled: vi.fn((on) => { state.enabled = on; for (const cb of [...listeners]) cb({ current: state.current }); }),
    paintStartPages: vi.fn(async () => []),
    shade: vi.fn(async () => (state.enabled && state.current ? state.shade : null)),
    remove: vi.fn(async () => { state.current = null; }),
    stats: async () => ({ cacheBytes: 0, cacheMax: 1, mineFiles: 0 }),
  };
  window.VexWallpapers = V;
  window.IntersectionObserver = class { observe() {} disconnect() {} };
  window.WallpaperData = { categoryTitle: () => 'Aurora' };
  window.WallpaperPaint = { pageColours: () => ({ scrim: [255, 255, 255], inks: [[0, 0, 0]], accent: [0, 0, 0] }), plan: () => ({ scheme: 'dark', plate: [13, 17, 27], plateAlpha: 0.6, shade: 0, worst: 9, ok: true, inks: [[247, 249, 253], [224, 229, 239], [200, 208, 222]], accent: [200, 200, 255] }), rgbCss: () => 'rgb(0 0 0)' };
  window.showToast = vi.fn();
  window.VexSettingsGroups = {
    register: vi.fn(),
    dialog: () => {
      const overlay = document.createElement('div');
      overlay.innerHTML = '<div class="vexsr-card"></div>';
      document.body.append(overlay);
      const body = document.createElement('div');
      overlay.firstChild.append(body);
      return { overlay, body, close: () => overlay.remove() };
    },
    toggle: (label, on, fn) => { const l = document.createElement('label'); const i = document.createElement('input'); i.type = 'checkbox'; i.checked = on; i.addEventListener('change', () => fn(i.checked)); l.append(label, i); return l; },
    field: (label, node) => { const d = document.createElement('div'); d.append(label, node); return d; },
    note: (t) => { const p = document.createElement('p'); p.textContent = t; return p; },
  };
  window.VexSettingsGroup = window.VexSettingsGroups;
  vi.resetModules();
  UI = (await import(JS + 'wallpaper-store-ui.js')).VexWallpaperStore || window.VexWallpaperStore;
});

async function applyInStore() {
  UI.open();
  await flush();
  document.querySelector('.vws-card-item').click();
  await flush();
  [...document.querySelectorAll('.vws-actions button')].find(b => /^Apply/.test(b.textContent.trim())).click();
  await flush(20);
  return document.querySelector('.vws-status');
}

describe('the store after Apply', () => {
  it('says plainly when it is shown and fully visible', async () => {
    const s = await applyInStore();
    expect(s.textContent).toMatch(/^Applied: Polar veil\. Open a New Tab to see it\./);
    expect(s.querySelector('button')).toBeNull();
  });
  it('pressing Apply while the master switch is off turns it on, so the picture is not saved and unseen', async () => {
    state.enabled = false;
    const s = await applyInStore();
    expect(V.setEnabled).toHaveBeenCalledWith(true);
    expect(state.enabled).toBe(true);
    expect(s.textContent).toMatch(/^Applied: Polar veil/);
    expect(s.textContent).not.toMatch(/switched off/);
  });
  it('says how little shows when the readable shade hides most of it, and "Show more of it" turns the shade down', async () => {
    state.shade = { alpha: 0.98, shows: 0.02, textOk: true };
    const s = await applyInStore();
    expect(s.textContent).toMatch(/But only 2% of the picture shows/);
    const more = [...s.querySelectorAll('button')].find(b => /Show more of it/.test(b.textContent));
    state.shade = { alpha: 0.4, shows: 0.6, textOk: false };
    more.click();
    await flush(20);
    expect(V.apply).toHaveBeenLastCalledWith('aurora-polar', expect.objectContaining({ auto: false, dim: 0.4 }));
    expect(document.querySelector('.vws-status').textContent).toMatch(/hard to read/);
  });
  it('an apply that fails is shown as an error, not as Applied', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    V.apply.mockRejectedValueOnce(new Error('The New Tab page could not show the wallpaper: boom'));
    const s = await applyInStore();
    expect(s.textContent).not.toMatch(/Applied/);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/boom/), 'error');
    expect(err).toHaveBeenCalled();
  });
});

// "Match Vex to this wallpaper" (js/wallpaper-sync.js), stubbed: what the store shows and when it asks.
function stubSync(on = []) {
  const IDS = ['newtab', 'tabs', 'toolbar', 'sidebar', 'accent', 'rest'];
  const sync = {
    AREAS: IDS.map(id => ({ id, label: 'Area ' + id, hint: 'Hint ' + id })), AREA_IDS: IDS,
    on: [...on],
    areasFor: vi.fn(() => sync.on),
    canUndo: () => sync.on.length > 0,
    setAreas: vi.fn(async (id, areas) => { sync.on = [...areas]; return null; }),
    undo: vi.fn(async () => { sync.on = []; return true; }),
  };
  window.VexWallpaperSync = sync;
  return sync;
}

describe('Match Vex to this wallpaper: easy to find, and never by itself', () => {
  it('sits right under the picture and its readability line, with the big button in view', async () => {
    stubSync();
    UI.open();
    await flush();
    document.querySelector('.vws-card-item').click();
    await flush();
    const kids = [...document.querySelector('.vws-panel').children].map(n => n.className.split(' ')[0]);
    expect(kids.slice(0, 3)).toEqual(['vws-preview', 'vws-read', 'vws-match']);
    expect(kids.indexOf('vws-match')).toBeLessThan(kids.indexOf('vws-actions'));
    const big = document.querySelector('.vws-match-all');
    expect(big.textContent.trim()).toBe('Match Vex to this wallpaper');
    expect(big.classList.contains('btn-primary')).toBe(true);
  });
  it('the six switches are tucked behind "Choose the parts" until some are on', async () => {
    stubSync();
    UI.open();
    await flush();
    document.querySelector('.vws-card-item').click();
    await flush();
    const list = document.querySelector('.vws-match-list');
    const parts = document.querySelector('.vws-match-compact [aria-controls]');
    expect(list.hidden).toBe(true);
    expect(parts.getAttribute('aria-expanded')).toBe('false');
    parts.click();
    expect(list.hidden).toBe(false);
    expect(parts.getAttribute('aria-expanded')).toBe('true');
    expect(list.querySelectorAll('input[type=checkbox]').length).toBe(6);
  });
  it('a wallpaper that is partly matched opens its switches', async () => {
    stubSync(['tabs']);
    UI.open();
    await flush();
    document.querySelector('.vws-card-item').click();
    await flush();
    expect(document.querySelector('.vws-match-list').hidden).toBe(false);
    expect(document.querySelectorAll('.vws-match-list input:checked').length).toBe(1);
  });
  it('the big button matches every part, on a click only', async () => {
    const sync = stubSync();
    UI.open();
    await flush();
    document.querySelector('.vws-card-item').click();
    await flush();
    expect(sync.setAreas).not.toHaveBeenCalled();
    document.querySelector('.vws-match-all').click();
    await flush();
    expect(sync.setAreas).toHaveBeenCalledWith('aurora-polar', sync.AREA_IDS);
  });
  it('right after Apply the status offers "Match Vex to it" and "Not now"; nothing is matched by itself', async () => {
    const sync = stubSync();
    const s = await applyInStore();
    expect(s.textContent).toMatch(/^Applied: Polar veil\./);
    const labels = [...s.querySelectorAll('button')].map(b => b.textContent.trim());
    expect(labels).toEqual(['Match Vex to it', 'Not now']);
    expect(sync.setAreas).not.toHaveBeenCalled();
    [...s.querySelectorAll('button')][0].click();
    await flush(20);
    expect(sync.setAreas).toHaveBeenCalledWith('aurora-polar', sync.AREA_IDS);
    expect(document.querySelector('.vws-status').textContent).toMatch(/^Vex now matches Polar veil/);
  });
  it('"Not now" drops the offer and keeps the sentence', async () => {
    const sync = stubSync();
    const s = await applyInStore();
    [...s.querySelectorAll('button')][1].click();
    await flush(5);
    const after = document.querySelector('.vws-status');
    expect(after.querySelector('button')).toBeNull();
    expect(after.textContent).toMatch(/^Applied: Polar veil/);
    expect(sync.setAreas).not.toHaveBeenCalled();
  });
  it('no offer when the wallpaper already matches everywhere', async () => {
    stubSync(['newtab', 'tabs', 'toolbar', 'sidebar', 'accent', 'rest']);
    const s = await applyInStore();
    expect(s.querySelector('button')).toBeNull();
  });
  it('the offer also comes with the heavy-shade question', async () => {
    stubSync();
    state.shade = { alpha: 0.98, shows: 0.02, textOk: true };
    const s = await applyInStore();
    expect([...s.querySelectorAll('button')].map(b => b.textContent.trim())).toEqual(['Show more of it', 'Match Vex to it', 'Not now']);
  });
});

describe('Settings > Wallpapers', () => {
  it('says about "Match Vex" at the top, and shows the big button before the switches', async () => {
    stubSync();
    await V.apply('aurora-polar', { dim: 0, blur: 0, auto: true });
    const body = document.createElement('div');
    document.body.append(body);
    UI.renderSettings(body);
    expect(body.firstChild.textContent).toMatch(/Match Vex to this wallpaper/);
    const big = body.querySelector('.vws-match-all');
    const list = body.querySelector('.vws-match-list');
    expect(big.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(list.hidden).toBe(false);
  });
  it('with no wallpaper on, it points to the store', () => {
    stubSync();
    const body = document.createElement('div');
    document.body.append(body);
    UI.renderSettings(body);
    expect(body.firstChild.textContent).toMatch(/Choose a wallpaper in the store/);
  });

  it('shows the wallpaper that is on now and follows a change made later (the store applies on top of it)', async () => {
    const body = document.createElement('div');
    document.body.append(body);
    UI.renderSettings(body);
    expect(body.querySelector('.vws-now').textContent).toBe('No wallpaper');
    await V.apply('aurora-polar', { dim: 0, blur: 0, auto: true });
    expect(body.querySelector('.vws-now').textContent).toBe('Polar veil');
    V.setEnabled(false);
    expect(body.querySelector('input[type=checkbox]').checked).toBe(false);
  });
  it('stops listening once its section is gone', async () => {
    const body = document.createElement('div');
    document.body.append(body);
    UI.renderSettings(body);
    body.remove();
    await V.apply('aurora-polar', {});
    expect(body.querySelector('.vws-now').textContent).toBe('No wallpaper');   // a removed section is not drawn again
    expect(body.dataset.vwsLive).toBeUndefined();
  });
});
