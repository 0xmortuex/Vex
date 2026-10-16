// @vitest-environment jsdom
//
// js/autoscroll.js (T3-042): middle-click autoscroll, in the page. Never on a link.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { recordWindowListeners } from '../helpers/trustedEvents.js';

const { VexAutoscroll, vexAutoscrollInstall } = require('../../src/renderer/js/autoscroll.js');

let frames, rec;
beforeEach(() => {
  rec = recordWindowListeners();
  document.body.innerHTML = '';
  document.documentElement.style.cursor = '';
  delete window.__vexAutoscroll;
  frames = [];
  window.requestAnimationFrame = vi.fn((fn) => { frames.push(fn); return frames.length; });
  window.cancelAnimationFrame = vi.fn();
  window.scrollBy = vi.fn();
  // jsdom has no layout: the page is made scrollable by saying so.
  // (jsdom has no doctype, so the page is in quirks mode and document.scrollingElement is the body: both get a size.)
  for (const el of [document.documentElement, document.body]) {
    Object.defineProperty(el, 'scrollHeight', { value: 5000, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 800, configurable: true });
  }
  localStorage.clear();
});
afterEach(() => { if (window.__vexAutoscroll) window.__vexAutoscroll.off(); rec.restore(); });

// jsdom marks every dispatched event untrusted and the handler wants real ones, so the page script's own listeners are called directly (tests/helpers/trustedEvents.js).
function mouse(type, init = {}, target = document.body) {
  return rec.fire(type, target, { clientX: 200, clientY: 300, ...init });
}
const tick = () => { const f = frames.shift(); if (f) f(); };

describe('installing', () => {
  it('installs once per page', () => {
    expect(vexAutoscrollInstall()).toBe('installed');
    expect(vexAutoscrollInstall()).toBe('already');
  });
  it('off() takes it away', () => {
    vexAutoscrollInstall();
    window.__vexAutoscroll.off();
    expect(window.__vexAutoscroll).toBeUndefined();
    mouse('mousedown', { button: 1 });
    expect(document.getElementById('vex-autoscroll-mark')).toBe(null);
  });
});

describe('middle button on empty page', () => {
  it('shows the mark, takes the default, and scrolls toward the pointer', () => {
    vexAutoscrollInstall();
    const down = mouse('mousedown', { button: 1 });
    expect(down.defaultPrevented).toBe(true);
    expect(document.getElementById('vex-autoscroll-mark')).not.toBe(null);
    expect(document.documentElement.style.cursor).toBe('all-scroll');
    // Pointer 100 px below the mark: down, at (100 - 14) * 0.18 = 15.48 px a frame.
    mouse('mousemove', { clientX: 200, clientY: 400 });
    tick();
    expect(window.scrollBy).toHaveBeenCalledTimes(1);
    const [vx, vy] = window.scrollBy.mock.calls[0];
    expect(vx).toBe(0);
    expect(vy).toBeCloseTo(15.48, 1);
  });

  it('scrolls nothing inside the dead zone, and up when the pointer goes above', () => {
    vexAutoscrollInstall();
    mouse('mousedown', { button: 1 });
    mouse('mousemove', { clientX: 205, clientY: 308 });
    tick();
    expect(window.scrollBy).not.toHaveBeenCalled();
    mouse('mousemove', { clientX: 200, clientY: 200 });
    tick();
    expect(window.scrollBy.mock.calls[0][1]).toBeLessThan(0);
  });

  it('is at its fastest no more than 48 px a frame', () => {
    vexAutoscrollInstall();
    mouse('mousedown', { button: 1 });
    mouse('mousemove', { clientX: 200, clientY: 3000 });
    tick();
    expect(window.scrollBy.mock.calls[0][1]).toBe(48);
  });

  it('stops on a click, a key, the wheel, and when the button is let go after a drag', () => {
    vexAutoscrollInstall();
    for (const stop of [
      () => mouse('mousedown', { button: 0 }),
      () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })),
      () => window.dispatchEvent(new WheelEvent('wheel')),
      () => { mouse('mousemove', { clientX: 200, clientY: 360 }); mouse('mouseup', { button: 1 }); },
    ]) {
      mouse('mousedown', { button: 1 });
      expect(document.getElementById('vex-autoscroll-mark')).not.toBe(null);
      stop();
      expect(document.getElementById('vex-autoscroll-mark')).toBe(null);
      expect(document.documentElement.style.cursor).toBe('');
    }
  });

  it('keeps going when the button is let go without a drag (click mode)', () => {
    vexAutoscrollInstall();
    mouse('mousedown', { button: 1 });
    mouse('mouseup', { button: 1 });
    expect(document.getElementById('vex-autoscroll-mark')).not.toBe(null);
  });
});

describe('where it does not start', () => {
  it('not on a link: a middle click there opens it in a new tab as before', () => {
    document.body.innerHTML = '<a href="https://x.example/"><span id="in">a link</span></a>';
    vexAutoscrollInstall();
    const e = mouse('mousedown', { button: 1 }, document.getElementById('in'));
    expect(e.defaultPrevented).toBe(false);
    expect(document.getElementById('vex-autoscroll-mark')).toBe(null);
  });

  it('not in a text box, a button, a video or an embedded frame', () => {
    document.body.innerHTML = '<textarea id="t"></textarea><button id="b">b</button><video id="v"></video><iframe id="f"></iframe><div id="e" contenteditable="true"></div>';
    vexAutoscrollInstall();
    for (const id of ['t', 'b', 'v', 'f', 'e']) {
      const e = mouse('mousedown', { button: 1 }, document.getElementById(id));
      expect(e.defaultPrevented, id).toBe(false);
    }
    expect(document.getElementById('vex-autoscroll-mark')).toBe(null);
  });

  it('not with the other buttons, with a script-made event, or on a page that cannot scroll', () => {
    vexAutoscrollInstall();
    expect(mouse('mousedown', { button: 0 }).defaultPrevented).toBe(false);
    expect(mouse('mousedown', { button: 2 }).defaultPrevented).toBe(false);
    const fake = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true });
    document.body.dispatchEvent(fake);
    expect(fake.defaultPrevented).toBe(false);
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 800, configurable: true });
    expect(mouse('mousedown', { button: 1 }).defaultPrevented).toBe(false);
  });

  it('scrolls the box under the pointer when it scrolls, not the page', () => {
    document.body.innerHTML = '<div id="box" style="overflow-y:auto"><p id="p">text</p></div>';
    const box = document.getElementById('box');
    Object.defineProperty(box, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(box, 'clientHeight', { value: 300, configurable: true });
    box.scrollBy = vi.fn();
    vexAutoscrollInstall();
    mouse('mousedown', { button: 1 }, document.getElementById('p'));
    mouse('mousemove', { clientX: 200, clientY: 380 });
    tick();
    expect(box.scrollBy).toHaveBeenCalled();
    expect(window.scrollBy).not.toHaveBeenCalled();
  });
});

describe('the Vex side', () => {
  it('is on unless switched off', () => {
    expect(VexAutoscroll.enabled()).toBe(true);
    localStorage.setItem('vex.autoscroll', '0');
    expect(VexAutoscroll.enabled()).toBe(false);
  });

  it('puts the script into a settled web tab, and into nothing when off or not a web page', async () => {
    const wv = { isConnected: true };
    globalThis.TabManager = { tabs: [{ id: 'a', url: 'https://x.example/' }, { id: 'b', url: 'vex://settings' }] };
    globalThis.WebviewManager = { webviews: new Map([['a', wv], ['b', wv]]) };
    window.vexGuestEval = vi.fn(async () => 'installed');
    expect(await VexAutoscroll.install('a')).toBe('installed');
    expect(window.vexGuestEval.mock.calls[0][1]).toContain('__vexAutoscroll');
    expect(await VexAutoscroll.install('b')).toBe(null);
    VexAutoscroll.setEnabled(false);
    window.vexGuestEval.mockClear();
    expect(await VexAutoscroll.install('a')).toBe(null);
    expect(window.vexGuestEval).not.toHaveBeenCalled();
  });
});
