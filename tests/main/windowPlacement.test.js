import { describe, it, expect } from 'vitest';
const { clamp, createPlacementStore, createWindowPlacement } = require('../../src/main/window-placement.js');

const main = { x: 0, y: 0, width: 1920, height: 1040 };
const second = { x: 1920, y: 0, width: 1280, height: 1000 };

describe('clamp', () => {
  it('leaves a window fully on a screen alone', () => {
    expect(clamp({ x: 100, y: 100, width: 1000, height: 700 }, [main, second]).changed).toBe(false);
  });
  it('brings back a window left on a removed monitor', () => {
    const r = clamp({ x: 2500, y: 100, width: 1000, height: 700 }, [main]);
    expect(r.changed).toBe(true);
    expect(r.bounds).toEqual({ x: 920, y: 100, width: 1000, height: 700 });
  });
  it('brings back a window far off every screen', () => {
    expect(clamp({ x: -5000, y: -4000, width: 1000, height: 700 }, [main]).bounds).toEqual({ x: 0, y: 0, width: 1000, height: 700 });
  });
  it('shrinks a window bigger than the screen', () => {
    expect(clamp({ x: 0, y: 0, width: 5000, height: 5000 }, [main]).bounds).toEqual(main);
  });
  it('picks the screen it overlaps most', () => {
    expect(clamp({ x: 1800, y: 0, width: 1000, height: 700 }, [main, second]).bounds.x).toBe(1920);
  });
  it('raises an error for unusable input', () => {
    expect(() => clamp({ x: NaN, y: 0, width: 1, height: 1 }, [main])).toThrow();
    expect(() => clamp({ x: 0, y: 0, width: 800, height: 600 }, [])).toThrow();
  });
});

describe('store', () => {
  const fsOf = (files) => ({
    readFileSync: (f) => { if (!(f in files)) { const e = new Error('no'); e.code = 'ENOENT'; throw e; } return files[f]; },
    writeFileSync: (f, d) => { files[f] = d; },
  });
  it('round-trips and says null when nothing was saved', () => {
    const s = createPlacementStore({ fs: fsOf({}), file: 'w.json' });
    expect(s.load()).toBeNull();
    s.save({ x: 1, y: 2, width: 900, height: 700 });
    expect(s.load()).toEqual({ x: 1, y: 2, width: 900, height: 700 });
  });
  it('reports a damaged file instead of ignoring it', () => {
    expect(() => createPlacementStore({ fs: fsOf({ 'w.json': '{oops' }), file: 'w.json' }).load()).toThrow();
    expect(() => createPlacementStore({ fs: fsOf({ 'w.json': '{"x":1}' }), file: 'w.json' }).load()).toThrow();
  });
});

describe('live window', () => {
  function win(b, extra = {}) {
    const w = { b, isDestroyed: () => false, isMinimized: () => false, isMaximized: () => false, isFullScreen: () => false, ...extra,
      getBounds: () => w.b, setBounds: (n) => { w.b = n; } };
    return w;
  }
  it('is moved back when the screens change, and not when maximised', () => {
    const w = win({ x: 2500, y: 0, width: 1000, height: 700 });
    expect(createWindowPlacement({ win: w, getWorkAreas: () => [main], store: { save() {} } }).settle()).toBe(true);
    expect(w.b.x).toBe(920);
    const m = win({ x: 9000, y: 0, width: 1000, height: 700 }, { isMaximized: () => true });
    expect(createWindowPlacement({ win: m, getWorkAreas: () => [main], store: { save() {} } }).settle()).toBe(false);
  });
  it('saves after a pause, once', () => {
    const saved = []; let fire;
    const w = win({ x: 10, y: 10, width: 900, height: 700 });
    const p = createWindowPlacement({ win: w, getWorkAreas: () => [main], store: { save: (b) => saved.push(b) },
      setTimeoutFn: (f) => { fire = f; return 1; }, clearTimeoutFn: () => {} });
    p.saveSoon(); p.saveSoon();
    fire();
    expect(saved).toEqual([{ x: 10, y: 10, width: 900, height: 700 }]);
  });
});
