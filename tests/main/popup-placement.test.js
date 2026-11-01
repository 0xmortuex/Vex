import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { placePopup, popupArea } = require('../../src/main/popup-placement.js');
const root = path.resolve(__dirname, '../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

const SCREEN = { x: 0, y: 0, width: 1920, height: 1040 };
const btn = (left, right, top = 40, bottom = 70) => ({ left, right, top, bottom });
const inside = (p, a) => p.x >= a.x && p.y >= a.y && p.x + p.w <= a.x + a.width && p.y + p.h <= a.y + a.height;

describe('placePopup', () => {
  it('centres the popup under its button', () => {
    expect(placePopup({ anchor: btn(900, 940), size: { w: 300, h: 400 }, area: SCREEN })).toEqual({ x: 770, y: 70, w: 300, h: 400 });
  });

  it('keeps the popup inside when the button is at the far right (the Dark Reader report)', () => {
    const p = placePopup({ anchor: btn(1760, 1800), size: { w: 350, h: 580 }, area: SCREEN });
    expect(p.x + p.w).toBe(1920);
    expect(p.x).toBe(1570);
    expect(inside(p, SCREEN)).toBe(true);
  });

  it('keeps the popup inside at the left edge too', () => {
    const p = placePopup({ anchor: btn(0, 30), size: { w: 350, h: 200 }, area: SCREEN });
    expect(p.x).toBe(0);
  });

  it('flips above the button when there is no room below', () => {
    const p = placePopup({ anchor: btn(900, 940, 960, 990), size: { w: 300, h: 400 }, area: SCREEN });
    expect(p.y).toBe(560);
    expect(inside(p, SCREEN)).toBe(true);
  });

  it('sits as low as the area allows when it fits neither below nor above', () => {
    const p = placePopup({ anchor: btn(900, 940, 300, 330), size: { w: 300, h: 800 }, area: { x: 0, y: 0, width: 1920, height: 600 } });
    expect(p.y).toBe(0);
    expect(p.h).toBe(600);
  });

  it('makes a popup that is bigger than the window smaller than it', () => {
    const area = { x: 100, y: 50, width: 320, height: 240 };
    const p = placePopup({ anchor: btn(200, 230, 50, 80), size: { w: 800, h: 600 }, area });
    expect(p).toEqual({ x: 100, y: 50,w: 320, h: 240 });
    expect(inside(p, area)).toBe(true);
  });

  it('honours a window that is not at the screen origin', () => {
    const area = { x: -1920, y: 0, width: 1920, height: 1040 };
    const p = placePopup({ anchor: btn(-60, -20), size: { w: 350, h: 300 }, area });
    expect(p.x + p.w).toBe(0);
    expect(inside(p, area)).toBe(true);
  });

  it('keeps the 25px minimum and 800x600 maximum sizes it is given', () => {
    expect(placePopup({ anchor: btn(900, 940), size: { w: 25, h: 25 }, area: SCREEN })).toMatchObject({ w: 25, h: 25 });
    expect(placePopup({ anchor: btn(900, 940), size: { w: 800, h: 600 }, area: SCREEN })).toMatchObject({ w: 800, h: 600 });
  });

  it('is inside the area for every button position along the toolbar', () => {
    for (let left = 0; left <= 1900; left += 50) {
      for (const [w, h] of [[25, 25], [246, 117], [350, 580], [800, 600], [1000, 2000]]) {
        const p = placePopup({ anchor: btn(left, left + 30), size: { w, h }, area: SCREEN });
        expect(inside(p, SCREEN)).toBe(true);
      }
    }
  });

  it('throws on numbers that are not numbers', () => {
    expect(() => placePopup({ anchor: btn(NaN, 3), size: { w: 1, h: 1 }, area: SCREEN })).toThrow(TypeError);
    expect(() => placePopup({ anchor: btn(1, 3), size: { w: 1, h: 1 }, area: { x: 0, y: 0, width: 0, height: 5 } })).toThrow(RangeError);
  });
});

describe('popupArea', () => {
  it('cuts the window to the screen', () => {
    expect(popupArea({ x: -8, y: -8, width: 1936, height: 1056 }, SCREEN)).toEqual({ x: 0, y: 0, width: 1920, height: 1040 });
    expect(popupArea({ x: 100, y: 100, width: 800, height: 600 }, SCREEN)).toEqual({ x: 100, y: 100, width: 800, height: 600 });
  });
  it('uses the screen when there is no window or it is off screen', () => {
    expect(popupArea(null, SCREEN)).toEqual(SCREEN);
    expect(popupArea({ x: 5000, y: 0, width: 500, height: 500 }, SCREEN)).toEqual(SCREEN);
  });
});

describe('wiring', () => {
  const main = read('src/main.js');
  const handler = main.slice(main.indexOf("ipcMain.handle('extensions:open-popup'"));
  it('every position the popup takes goes through the placement', () => {
    expect(main).toMatch(/placePopup, popupArea \} = require\('\.\/main\/popup-placement'\)/);
    expect(handler.slice(0, handler.indexOf('\n});\n'))).not.toMatch(/Math\.max\(0, x \+|getPosition\(\)/);
    expect(handler.slice(0, handler.indexOf('\n});\n'))).toMatch(/_placePopupWindow\(win, anchor, w, h\);\n\s*win\.show\(\)/);
  });
  it('the window is under its button before the page loads (Stylus focuses it while loading, and its load does not finish)', () => {
    const body = handler.slice(0, handler.indexOf('\n});\n'));
    expect(body.indexOf('_placePopupWindow(win, anchor, 360, 480)')).toBeGreaterThan(0);
    expect(body.indexOf('_placePopupWindow(win, anchor, 360, 480)')).toBeLessThan(body.indexOf('await win.loadURL(popupUrl)'));
  });
  it('the toolbar menu and Settings send the whole button, not just its left edge', () => {
    for (const f of ['src/renderer/js/extensions-menu.js', 'src/renderer/js/extensions-settings.js']) {
      expect(read(f)).toMatch(/right: Math\.max\(0, Math\.round\(window\.screenX/);
      expect(read(f)).toMatch(/top: Math\.max\(0, Math\.round\(window\.screenY/);
    }
    expect(read('src/main/ipc-schemas.js')).toMatch(/right: optional\(coordinate\), top: optional\(coordinate\)/);
  });
});
