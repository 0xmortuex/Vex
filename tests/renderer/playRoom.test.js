// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const { VexPlayRoom: R } = require('../../src/renderer/js/play-room');
beforeEach(() => {
  document.body.textContent = ''; localStorage.clear();
  delete globalThis.VexPlayfulness;
  window.VexMedals = { addXp: vi.fn() };
  globalThis.VexFun = { open: ({ onClose }) => {
    const root = document.createElement('div'), body = document.createElement('div'); root.append(body); document.body.append(root);
    return { root, body, close: () => { onClose(); root.remove(); } };
  } };
  R._win = null;
});
afterEach(() => { R._win?.close(); vi.restoreAllMocks(); vi.useRealTimers(); });
const click = text => [...document.querySelectorAll('button')].find(b => b.textContent === text).click();

describe('play rewards share profile XP', () => {
  it('gives a souvenir and 5 XP once per activity per local day, with no repeated-claim bonus', () => {
    expect(R.complete('memory')).toBe(true);
    expect(R.complete('memory')).toBe(false);
    expect(window.VexMedals.addXp).toHaveBeenCalledExactlyOnceWith('play-room-memory', 5);
    expect(R.read().souvenirs.memory).toBe(true);
    expect(R.complete('not-an-activity')).toBe(false);
  });
  it('allows a new reward tomorrow without removing past souvenirs', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 17, 12));
    R.complete('memory'); vi.setSystemTime(new Date(2026, 9, 18, 12));
    expect(R.complete('memory')).toBe(true); expect(R.read().souvenirs.memory).toBe(true);
    expect(window.VexMedals.addXp).toHaveBeenCalledTimes(2);
  });
  it('shuffles without losing or duplicating any input items', () => {
    expect(R.shuffled([1, 2, 3, 4], () => 0).sort()).toEqual([1, 2, 3, 4]);
  });
});

describe('playful activities', () => {
  it('finishes an eight-pair memory game with a real matched board', () => {
    vi.spyOn(R, 'shuffled').mockImplementation(v => v);
    R.open(); document.querySelectorAll('.pr-card')[0].click();
    [...document.querySelectorAll('.pr-memory button')].forEach(b => b.click());
    expect(document.querySelectorAll('.pr-memory button:disabled')).toHaveLength(16);
    expect(document.querySelector('.pr-status').textContent).toContain('+5');
    expect(R.read().souvenirs.memory).toBe(true);
  });
  it('keeps mismatched tiles visible briefly and cancels their timer on leaving', () => {
    vi.useFakeTimers(); vi.spyOn(R, 'shuffled').mockImplementation(v => v);
    R.open(); document.querySelectorAll('.pr-card')[0].click();
    const buttons = document.querySelectorAll('.pr-memory button'); buttons[0].click(); buttons[2].click();
    expect(buttons[0].textContent).not.toBe('?');
    click('Back to play room'); vi.runAllTimers();
    expect(document.querySelectorAll('.pr-card')).toHaveLength(6);
  });
  it('makes pattern completion depend on reproducing all five rounds', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    R.open(); document.querySelectorAll('.pr-card')[1].click();
    for (let round = 1; round <= 5; round++) {
      click('Hide pattern and try');
      for (let i = 0; i < round + 1; i++) document.querySelector('.pr-pattern button').click();
    }
    expect(R.read().souvenirs.pattern).toBe(true);
  });
  it('requires an idea, saves it as text, and bounds the keepsake history', () => {
    R.open(); document.querySelectorAll('.pr-card')[3].click(); click('Keep my idea');
    expect(R.read().souvenirs.imagination).toBeUndefined();
    for (let i = 0; i < 12; i++) { document.querySelector('textarea').value = '<script>cat</script> ' + i; click('Keep my idea'); }
    expect(R.read().notes).toHaveLength(10); expect(document.querySelector('.pr-notes script')).toBeNull();
    expect(window.VexMedals.addXp).toHaveBeenCalledTimes(1);
  });
  it('has a keyboard drawing grid and does not reward a blank canvas', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillStyle: '', fillRect: vi.fn() });
    R.open(); document.querySelectorAll('.pr-card')[2].click(); click('Keep this postcard');
    expect(R.read().souvenirs.postcard).toBeUndefined();
    document.querySelector('.pr-pixels button').click(); click('Keep this postcard');
    expect(R.read().souvenirs.postcard).toBe(true); expect(R.read().pixels).toHaveLength(144);
  });
  it('does not open when explicitly quiet, and closes if Game mode starts', () => {
    globalThis.VexPlayfulness = { chosen: () => 'off', autoOffReason: () => '' };
    window.showToast = vi.fn(); R.open(); expect(R._win).toBeNull();
    VexPlayfulness.chosen = () => 'calm'; R.open(); expect(R._win).not.toBeNull();
    VexPlayfulness.autoOffReason = () => 'Game mode is on'; document.dispatchEvent(new Event('vex:game-mode'));
    expect(R._win).toBeNull();
  });
  it('pops a complete bubble sheet and can start a fresh sheet without duplicate XP', () => {
    R.open(); document.querySelector('[data-activity="bubbles"]').click();
    [...document.querySelectorAll('.pr-bubbles button')].forEach(b => b.click());
    expect(R.read().souvenirs.bubbles).toBe(true);
    expect(document.querySelectorAll('.pr-bubbles button:disabled')).toHaveLength(36);
    click('A fresh sheet'); [...document.querySelectorAll('.pr-bubbles button')].forEach(b => b.click());
    expect(window.VexMedals.addXp).toHaveBeenCalledTimes(1);
  });
  it('creates a silly adventure from three actual choices', () => {
    R.open(); document.querySelector('[data-activity="choices"]').click();
    for (let i = 0; i < 3; i++) document.querySelector('.pr-choices button').click();
    expect(document.querySelector('.pr-adventure').textContent).toContain('Your absurd adventure:');
    expect(R.read().souvenirs.choices).toBe(true);
  });
});
