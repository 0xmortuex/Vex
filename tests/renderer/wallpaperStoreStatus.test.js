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
  it('does not claim success while the master switch is off, and one click turns it on', async () => {
    state.enabled = false;
    const s = await applyInStore();
    expect(s.textContent).toMatch(/switched off/);
    expect(s.textContent).not.toMatch(/^Applied/);
    const turnOn = [...s.querySelectorAll('button')].find(b => /Turn on/.test(b.textContent));
    expect(turnOn).toBeTruthy();
    turnOn.click();
    await flush(20);
    expect(V.setEnabled).toHaveBeenCalledWith(true);
    expect(V.paintStartPages).toHaveBeenCalled();
    expect(document.querySelector('.vws-status').textContent).toMatch(/^Applied: Polar veil/);
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

describe('Settings > Wallpapers', () => {
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
