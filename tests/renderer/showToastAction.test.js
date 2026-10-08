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
const showToast = new Function(src.slice(start, end) + '\nreturn showToast;')();

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
