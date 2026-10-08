// @vitest-environment jsdom
//
// app.js showToast, the one toast system, with a button (the Undo of
// js/vex-undo.js): it counts as expired when it runs out or is pushed out,
// holds still under the keyboard's focus, and a full stack of toasts with
// buttons never hangs the window (a dropped one has to leave the count).
import { beforeEach, describe, expect, it, vi } from 'vitest';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/app.js'), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('  function showToast(message, type, duration, opts) {');
const end = src.indexOf('\n  window.showToast = showToast;', start);
// The placement watchers (MutationObservers) are stand-ins the tests call by
// hand: real ones outlive the test window and fire into its teardown.
const observers = [];
class FakeObserver { constructor(cb) { this.cb = cb; observers.push(this); } observe(target) { this.target = target; } disconnect() {} }
const [showToast, placeToastsForTest] = new Function('MutationObserver', src.slice(start, end) + '\nreturn [showToast, placeToasts];')(FakeObserver);

beforeEach(() => { document.body.innerHTML = ''; vi.useFakeTimers(); });

describe('a toast with a button', () => {
  it('shows the message and the button, and pressing it runs the action once', () => {
    const run = vi.fn(), onExpire = vi.fn();
    const t = showToast('Deleted “A”', 'undo', 10000, { action: { label: 'Undo', title: 'Undo (Ctrl+Z)', run }, onExpire });
    const btn = t.el.querySelector('.toast-action');
    expect(t.el.querySelector('.toast-text').textContent).toBe('Deleted “A”');
    expect(btn.textContent).toBe('Undo');
    expect(btn.title).toBe('Undo (Ctrl+Z)');
    btn.click(); btn.click();
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(20000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('runs out after its time and says so once', () => {
    const onExpire = vi.fn();
    showToast('x', 'undo', 10000, { action: { label: 'Undo', run: () => {} }, onExpire });
    vi.advanceTimersByTime(9900);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onExpire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(400);
    expect(document.querySelectorAll('#toast-container .toast-item')).toHaveLength(0);
  });

  it('holds still while the keyboard is on it, and Escape lets it go', () => {
    const onExpire = vi.fn();
    const t = showToast('x', 'undo', 10000, { action: { label: 'Undo', run: () => {} }, onExpire });
    const btn = t.el.querySelector('.toast-action');
    btn.focus();
    vi.advanceTimersByTime(60000);
    expect(onExpire).not.toHaveBeenCalled();
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('a hover holds it at most 15 s (the pointer can leave onto a page unseen)', () => {
    const onExpire = vi.fn();
    const t = showToast('x', 'undo', 10000, { action: { label: 'Undo', run: () => {} }, onExpire });
    vi.advanceTimersByTime(1000);
    t.el.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(15000 + 8900);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('a fifth toast pushes out the oldest — a plain one first — without hanging', () => {
    const expired = [];
    for (let i = 0; i < 4; i++) showToast('undo ' + i, 'undo', 10000, { action: { label: 'Undo', run: () => {} }, onExpire: () => expired.push(i) });
    showToast('fifth', 'undo', 10000, { action: { label: 'Undo', run: () => {} }, onExpire: () => {} });
    expect(expired).toEqual([0]);
    const live = () => [...document.querySelectorAll('#toast-container .toast-item')].filter(t => !t.dataset.leaving).map(t => t.textContent);
    expect(live()).toEqual(['undo 1Undo', 'undo 2Undo', 'undo 3Undo', 'fifthUndo']);
    showToast('plain', 'info', 3000);
    expect(expired).toEqual([0, 1]);
    showToast('another', 'undo', 10000, { action: { label: 'Undo', run: () => {} }, onExpire: () => {} });
    // The plain one goes before any with a button.
    expect(expired).toEqual([0, 1]);
    expect(live()).not.toContain('plain');
  });

  it('two toasts with buttons and the same words are both shown; plain duplicates are not', () => {
    showToast('same', 'undo', 10000, { action: { label: 'Undo', run: () => {} } });
    showToast('same', 'undo', 10000, { action: { label: 'Undo', run: () => {} } });
    showToast('plain', 'info');
    expect(showToast('plain', 'info')).toBe(null);
    expect(document.querySelectorAll('#toast-container .toast-item')).toHaveLength(3);
  });
});

// A toast sat on the site panel's "Site settings" link in a narrow window
// (final review, 2026-10-09): the stack keeps clear of [data-avoid-toasts].
describe('toasts and an open panel', () => {
  const rect = (el, r) => { el.getBoundingClientRect = () => ({ ...r, right: r.left + r.width, bottom: r.top + r.height }); el.getClientRects = () => [1]; };
  const flush = () => Promise.resolve().then(() => {});
  it('move beside the panel when there is room, and the panel ends above them when there is not', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    const panel = document.createElement('div');
    panel.setAttribute('data-avoid-toasts', '');
    document.body.appendChild(panel);
    rect(panel, { left: 800, top: 80, width: 392, height: 700 });
    showToast('first', 'info', 5000);
    const c = document.getElementById('toast-container');
    rect(c, { left: 820, top: 700, width: 360, height: 60 });
    placeToastsForTest();
    expect(c.style.right).toBe('408px');                   // 1200 - 800 + 8: left of the panel
    expect(panel.classList.contains('toast-capped')).toBe(false);
    // Narrow: the panel spans the window, so it gives the stack its bottom.
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
    rect(panel, { left: 8, top: 80, width: 384, height: 700 });
    rect(c, { left: 20, top: 700, width: 360, height: 60 });
    placeToastsForTest();
    expect(c.style.right).toBe('');
    expect(panel.classList.contains('toast-capped')).toBe(true);
    expect(panel.style.getPropertyValue('--toast-cap')).toBe('612px'); // 700 - 8 - 80 (never below 96: its head and foot)
    // The toasts gone: the panel has its height back.
    vi.advanceTimersByTime(6000);
    await flush();
    observers.filter(o => o.target === c).forEach(o => o.cb([]));   // the stack's watcher
    expect(panel.classList.contains('toast-capped')).toBe(false);
  });
});
