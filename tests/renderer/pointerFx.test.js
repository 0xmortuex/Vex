// @vitest-environment jsdom
//
// A cursor of your own and a click effect (js/pointer-fx.js): both optional, both off until chosen.
// How they LOOK was checked in real Chromium; this pins down the rules around them.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const JS = '../../src/renderer/js/pointer-fx.js';
let VexCursor, VexClickFx, VexPointerFx, registered;

function load() {
  delete require.cache[require.resolve(JS)];
  registered = [];
  globalThis.VexSettingsGroups = { register: (d) => registered.push(d) };
  ({ VexCursor, VexClickFx, VexPointerFx } = require(JS));
}

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-reduce-motion');
  Element.prototype.animate = vi.fn(() => ({}));
  load();
});
// Each test loads a fresh copy of the module; the old copy's click listener must not outlive its test.
afterEach(() => { VexClickFx.save(null); delete globalThis.VexSettingsGroups; delete globalThis.VexI18nUI; delete globalThis.WebviewManager; delete globalThis._isTrustedStartPage; });

describe('the cursor', () => {
  it('is off until a style is chosen, and draws nothing', () => {
    expect(VexCursor.read()).toBeNull();
    expect(VexCursor.enabled()).toBe(false);
    expect(VexCursor.apply()).toBe(false);
    expect(document.getElementById('vex-cursor-css')).toBeNull();
  });
  it('draws the chosen one with its hotspot, and takes it away again', () => {
    VexCursor.save({ style: 'arrow', color: '#6366f1', size: 'medium' });
    const css = document.getElementById('vex-cursor-css').textContent;
    expect(css).toMatch(/cursor: url\("data:image\/svg\+xml,[^"]+"\) 5 3, auto !important/);   // the arrow's tip, not its middle
    VexCursor.save(null);
    expect(document.getElementById('vex-cursor-css')).toBeNull();
    expect(localStorage.getItem('vex.cursor')).toBeNull();
  });
  it('puts the hotspot of a round cursor in its middle, scaled to its size', () => {
    VexCursor.save({ style: 'ring', color: '#ef4444', size: 'large' });
    expect(document.getElementById('vex-cursor-css').textContent).toMatch(/\) 24 24, auto !important/);
    VexCursor.save({ style: 'dot', color: '#ef4444', size: 'small' });
    expect(document.getElementById('vex-cursor-css').textContent).toMatch(/\) 12 12, auto !important/);
  });
  it('draws every style as a picture of the size asked for, in the colour asked for', () => {
    for (const style of VexCursor.STYLES) {
      const img = VexCursor.image({ style, color: '#22c55e', size: 'medium' }, false);
      const svg = decodeURIComponent(img.url.replace('data:image/svg+xml,', ''));
      expect(svg).toContain('width="32" height="32"');
      expect(svg).toContain('#22c55e');
    }
  });
  it('swaps fill and outline over something you can click, so it can be told apart', () => {
    const c = { style: 'dot', color: '#6366f1', size: 'medium' };
    expect(VexCursor.image(c, false).url).not.toBe(VexCursor.image(c, true).url);
  });
  it('keeps the text cursor in a text box and leaves the edges you drag alone', () => {
    VexCursor.save({ style: 'star', color: '#f59e0b', size: 'medium' });
    const css = document.getElementById('vex-cursor-css').textContent;
    expect(css).toMatch(/cursor: text !important/);
    expect(css).toContain('textarea');
    expect(css).toContain('[class*="resize"]');
    expect(css).toContain('[draggable="true"]');
  });
  it('picks an outline that can be seen against the colour', () => {
    expect(VexCursor._outline('#ffffff')).toBe('#111111');
    expect(VexCursor._outline('#111111')).toBe('#ffffff');
  });
  it('refuses a style that does not exist, and ignores a damaged saved choice', () => {
    expect(() => VexCursor.save({ style: 'banana', color: '#ffffff', size: 'medium' })).toThrow(/no cursor called "banana"/);
    localStorage.setItem('vex.cursor', JSON.stringify({ style: 'banana' }));
    expect(VexCursor.read()).toBeNull();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem('vex.cursor', '{not json');
    expect(VexCursor.read()).toBeNull();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('a saved choice could not be read'), expect.any(String));   // said, not hidden
    err.mockRestore();
    localStorage.setItem('vex.cursor', JSON.stringify({ style: 'dot', color: 'red', size: 'huge' }));
    expect(VexCursor.read()).toEqual({ style: 'dot', color: '#6366f1', size: 'medium' });   // falls back to the defaults
  });
  it('is switched on and off by the feature switch', () => {
    expect(VexCursor.setEnabled(true)).toBe(true);
    expect(VexCursor.read().style).toBe('arrow');
    VexCursor.setEnabled(false);
    expect(VexCursor.enabled()).toBe(false);
  });
});

describe('the click effect', () => {
  const down = (o = {}) => document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 40, clientY: 50, ...o }));
  const live = () => (document.getElementById('vex-clickfx-layer') || { childElementCount: 0 }).childElementCount;

  it('is off until switched on, and does nothing on a click', () => {
    expect(VexClickFx.read()).toBeNull();
    expect(VexClickFx.apply()).toBe(false);
    down();
    expect(live()).toBe(0);
  });
  it('draws a burst where you click once it is on', () => {
    VexClickFx.save({ effect: 'fireflies', color: 'theme' });
    down();
    expect(live()).toBe(9);
    const first = document.getElementById('vex-clickfx-layer').firstElementChild;
    expect(first.style.pointerEvents).toBe('none');
    expect(first.style.left).not.toBe('');
  });
  it('draws each effect, and the layer never takes a click', () => {
    for (const [effect, count] of [['fireflies', 9], ['ripple', 2], ['confetti', 14], ['shockwave', 2]]) {
      document.body.innerHTML = '';
      expect(VexClickFx.burst(10, 10, { effect, color: 'rainbow' }, effect)).toBe(count);
    }
    expect(document.getElementById('vex-clickfx-layer').style.pointerEvents).toBe('none');
    expect(document.getElementById('vex-clickfx-layer').getAttribute('aria-hidden')).toBe('true');
  });
  it('"Surprise me" picks one of the four, and not "surprise" itself', () => {
    const seen = new Set();
    for (let i = 0; i < 80; i++) { document.body.innerHTML = ''; seen.add(VexClickFx.burst(5, 5, { effect: 'surprise', color: 'theme' })); }
    expect([...seen].every(n => [9, 2, 14].includes(n))).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
  });
  it('is at most one burst every 70 ms, and only for the main button', () => {
    VexClickFx.save({ effect: 'ripple', color: 'theme' });
    down(); down(); down();
    expect(live()).toBe(2);                         // one burst
    VexClickFx._last = 0;
    down({ button: 2 });
    expect(live()).toBe(2);                         // a right click adds nothing
  });
  it('stays still when Reduce motion is on, in a hidden window and while Game mode holds the interface still', () => {
    VexClickFx.save({ effect: 'ripple', color: 'theme' });
    document.documentElement.setAttribute('data-reduce-motion', '');
    down();
    expect(live()).toBe(0);
    document.documentElement.removeAttribute('data-reduce-motion');
    document.body.classList.add('game-still');
    down();
    expect(live()).toBe(0);
    document.body.classList.remove('game-still');
    VexClickFx._last = 0;
    down();
    expect(live()).toBe(2);
  });
  it('never holds more than 60 shapes at once', () => {
    VexClickFx.save({ effect: 'confetti', color: 'theme' });
    for (let i = 0; i < 12; i++) { VexClickFx._last = 0; down(); }
    expect(live()).toBeLessThanOrEqual(60 + 14);
    expect(VexClickFx.burst(1, 1, { effect: 'confetti', color: 'theme' }, 'confetti')).toBe(0);   // over the cap: nothing more is drawn
  });
  it('stops listening and removes its layer when switched off', () => {
    VexClickFx.save({ effect: 'ripple', color: 'theme' });
    down();
    expect(live()).toBe(2);
    VexClickFx.save(null);
    expect(document.getElementById('vex-clickfx-layer')).toBeNull();
    VexClickFx._last = 0;
    down();
    expect(live()).toBe(0);
  });
  it('removes each shape when its animation ends, and has no animation to wait for where there is none', () => {
    const el = document.createElement('span'); document.body.appendChild(el);
    let a;
    Element.prototype.animate = vi.fn(() => (a = {}));
    VexClickFx._go(el, [{ opacity: 1 }, { opacity: 0 }], 100);
    a.onfinish();
    expect(el.isConnected).toBe(false);
    const el2 = document.createElement('span'); document.body.appendChild(el2);
    delete Element.prototype.animate;
    VexClickFx._go(el2, [], 100);
    expect(el2.isConnected).toBe(false);
  });
  it('refuses an effect that does not exist', () => {
    expect(() => VexClickFx.save({ effect: 'lasers', color: 'theme' })).toThrow(/no click effect called "lasers"/);
    localStorage.setItem('vex.clickFx', JSON.stringify({ effect: 'lasers' }));
    expect(VexClickFx.read()).toBeNull();
  });
  it('keeps a colour that is a colour, and falls back to the theme for one that is not', () => {
    localStorage.setItem('vex.clickFx', JSON.stringify({ effect: 'ripple', color: '#ABCDEF' }));
    expect(VexClickFx.read().color).toBe('#ABCDEF');
    localStorage.setItem('vex.clickFx', JSON.stringify({ effect: 'ripple', color: 'javascript:alert(1)' }));
    expect(VexClickFx.read().color).toBe('theme');
  });
  it('is switched on and off by the feature switch', () => {
    expect(VexClickFx.setEnabled(true)).toBe(true);
    expect(VexClickFx.read()).toEqual({ effect: 'fireflies', color: 'theme' });
    VexClickFx.setEnabled(false);
    expect(VexClickFx.enabled()).toBe(false);
  });
});

describe('the Settings groups', () => {
  it('registers a group for each, in the app\'s settings registry', () => {
    expect(registered.map(r => r.id)).toEqual(['custom-cursor', 'click-effect']);
    expect(registered.map(r => r.title)).toEqual(['Mouse cursor', 'Click effect']);
  });
  it('draws the cursor choices, and only shows colour and size once a style is chosen', () => {
    globalThis.VexSettingsGroup = {
      note: (t) => Object.assign(document.createElement('p'), { textContent: t }),
      field: (label, control) => { const d = document.createElement('div'); d.dataset.field = label; d.appendChild(control); return d; },
      toggle: (label, on, fn) => { const d = document.createElement('div'); d.dataset.toggle = label; d.fn = fn; return d; },
    };
    const body = document.createElement('div');
    VexCursor.render(body);
    expect([...body.querySelectorAll('[data-field]')].map(d => d.dataset.field)).toEqual(['Cursor style']);
    VexCursor.save({ style: 'ring', color: '#6366f1', size: 'medium' });
    body.textContent = ''; VexCursor.render(body);
    expect([...body.querySelectorAll('[data-field]')].map(d => d.dataset.field)).toEqual(['Cursor style', 'Cursor colour', 'Cursor size']);
    expect(body.querySelectorAll('button[aria-pressed]')).toHaveLength(8);
    expect(body.querySelector('button[aria-pressed="true"]').getAttribute('aria-label')).toBe('#6366f1');
    delete globalThis.VexSettingsGroup;
  });
  it('picking a style from the list turns it on and picking Off turns it off', () => {
    globalThis.VexSettingsGroup = { note: () => document.createElement('p'), field: (l, c) => c, toggle: () => document.createElement('div') };
    const body = document.createElement('div');
    VexCursor.render(body);
    const sel = body.querySelector('select');
    sel.value = 'cross'; sel.dispatchEvent(new Event('change'));
    expect(VexCursor.read().style).toBe('cross');
    const again = body.querySelector('select');
    again.value = ''; again.dispatchEvent(new Event('change'));
    expect(VexCursor.read()).toBeNull();
    delete globalThis.VexSettingsGroup;
  });
  it('says in its own words what it does not reach', () => {
    globalThis.VexSettingsGroup = { note: (t) => Object.assign(document.createElement('p'), { textContent: t }), field: (l, c) => c, toggle: () => document.createElement('div') };
    const body = document.createElement('div');
    VexCursor.render(body);
    expect(body.textContent).toMatch(/A website keeps its own cursors/);
    const b2 = document.createElement('div');
    VexClickFx.render(b2);
    expect(b2.textContent).toMatch(/A website shows none/);
    delete globalThis.VexSettingsGroup;
  });
  it('is Turkish when Vex is set to Turkish', () => {
    localStorage.setItem('vex.lang', JSON.stringify('tr'));
    globalThis.VexI18nUI = require('../../src/renderer/js/i18n-ui.js').VexI18nUI;
    globalThis.VexSettingsGroup = { note: (t) => Object.assign(document.createElement('p'), { textContent: t }), field: (l, c) => { const d = document.createElement('div'); d.dataset.field = l; d.appendChild(c); return d; }, toggle: () => document.createElement('div') };
    const body = document.createElement('div');
    VexCursor.render(body);
    expect(body.querySelector('[data-field]').dataset.field).toBe('İmleç stili');
    expect([...body.querySelectorAll('option')].map(o => o.textContent)).toEqual(['Kapalı (normal imleç)', 'Ok', 'Nokta', 'Halka', 'Artı işareti', 'Yıldız']);
    delete globalThis.VexSettingsGroup;
  });
});

describe('the New Tab page', () => {
  it('is handed the choice as code that sets its own storage and tells it to redraw', () => {
    VexCursor.save({ style: 'dot', color: '#06b6d4', size: 'small' });
    VexClickFx.save({ effect: 'confetti', color: 'rainbow' });
    const js = VexPointerFx.startPageJs();
    expect(js).toContain('vex-pointer-fx');
    // run it as the page would, against a copy of storage
    const kept = {};
    const fake = { setItem: (k, v) => { kept[k] = v; }, removeItem: (k) => { delete kept[k]; } };
    const events = [];
    new Function('localStorage', 'window', 'console', 'Event', 'return ' + js)(fake, { dispatchEvent: (e) => events.push(e.type) }, console, function (t) { this.type = t; });
    expect(JSON.parse(kept['vex.cursor'])).toEqual({ style: 'dot', color: '#06b6d4', size: 'small' });
    expect(JSON.parse(kept['vex.clickFx'])).toEqual({ effect: 'confetti', color: 'rainbow' });
    expect(events).toEqual(['vex-pointer-fx']);
  });
  it('is handed an off choice as removal, so a page does not keep an old cursor', () => {
    const js = VexPointerFx.startPageJs();
    const kept = { 'vex.cursor': 'x', 'vex.clickFx': 'y' };
    const fake = { setItem: (k, v) => { kept[k] = v; }, removeItem: (k) => { delete kept[k]; } };
    new Function('localStorage', 'window', 'console', 'Event', 'return ' + js)(fake, { dispatchEvent() {} }, console, function () {});
    expect(kept).toEqual({});
  });
  it('is sent only to Vex\'s own New Tab pages', () => {
    const own = { getURL: () => 'file:///app/renderer/start.html', executeJavaScript: vi.fn(async () => true) };
    const other = { getURL: () => 'https://example.com/', executeJavaScript: vi.fn(async () => true) };
    globalThis.WebviewManager = { webviews: new Map([[1, own], [2, other]]) };
    globalThis._isTrustedStartPage = (u) => /start\.html$/.test(u);
    VexPointerFx.paintStartPages();
    expect(own.executeJavaScript).toHaveBeenCalledTimes(1);
    expect(other.executeJavaScript).not.toHaveBeenCalled();
  });
  it('says so in the console when a page cannot be reached', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await VexPointerFx.paintStartPage({ executeJavaScript: async () => { throw new Error('gone'); } });
    expect(err).toHaveBeenCalledWith(expect.stringContaining('could not reach a New Tab page'), 'gone');
    err.mockRestore();
  });
});
