import { describe, it, expect } from 'vitest';
const { createKeepOnTop } = require('../../src/main/keep-on-top.js');

function setup() {
  const st = { game: false, full: false, top: false };
  const win = { isDestroyed: () => false, isFullScreen: () => st.full, setAlwaysOnTop: (v) => { st.top = v; } };
  return { st, k: createKeepOnTop({ getWindow: () => win, fullscreenGame: () => st.game }) };
}

describe('keep on top', () => {
  it('sets the window level and reports it', () => {
    const { st, k } = setup();
    expect(k.set(true)).toEqual({ wanted: true, active: true, held: false });
    expect(st.top).toBe(true);
    expect(k.set(false).active).toBe(false);
    expect(st.top).toBe(false);
  });
  it('lets go while a full-screen game has the screen and comes back after', () => {
    const { st, k } = setup();
    k.set(true);
    st.game = true;
    expect(k.recheck()).toEqual({ wanted: true, active: false, held: true });
    expect(st.top).toBe(false);
    st.game = false;
    expect(k.recheck().active).toBe(true);
    expect(st.top).toBe(true);
  });
  it('is not put on over a game or when Vex is full screen', () => {
    const a = setup(); a.st.game = true;
    expect(a.k.set(true).held).toBe(true);
    expect(a.st.top).toBe(false);
    const b = setup(); b.st.full = true;
    expect(b.k.set(true).active).toBe(false);
  });
  it('refuses a value that is not true or false', () => {
    expect(() => setup().k.set('yes')).toThrow();
  });
});
