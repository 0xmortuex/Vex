// @vitest-environment jsdom
//
// The touch shortcuts. Both of these are easy to get subtly wrong in a way
// nobody notices until it is annoying: a swipe that also counts as a tap, and a
// long press that also counts as a tap.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexGestures } = require('../../mobile/www/js/gestures.js');

// jsdom has no Touch constructor, so a touch is the two numbers these read.
function touch(target, type, x, y) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const list = [{ clientX: x, clientY: y }];
  event.touches = type === 'touchend' ? [] : list;
  event.changedTouches = list;
  target.dispatchEvent(event);
  return event;
}

let node;
beforeEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '<button id="pill">pill</button>';
  node = document.getElementById('pill');
});

describe('swiping', () => {
  function wire() {
    const seen = [];
    VexGestures.swipe(node, {
      left: () => seen.push('left'), right: () => seen.push('right'),
      up: () => seen.push('up'), down: () => seen.push('down')
    });
    return seen;
  }

  it('reads the four directions', () => {
    const seen = wire();
    touch(node, 'touchstart', 200, 200); touch(node, 'touchend', 100, 205);
    touch(node, 'touchstart', 200, 200); touch(node, 'touchend', 300, 195);
    touch(node, 'touchstart', 200, 200); touch(node, 'touchend', 205, 100);
    touch(node, 'touchstart', 200, 200); touch(node, 'touchend', 195, 300);
    expect(seen).toEqual(['left', 'right', 'up', 'down']);
  });

  it('ignores a drag that is too short, or too diagonal', () => {
    const seen = wire();
    touch(node, 'touchstart', 200, 200); touch(node, 'touchend', 170, 200);   // 30px
    touch(node, 'touchstart', 200, 200); touch(node, 'touchend', 100, 260);   // 60px across
    expect(seen).toEqual([]);
  });

  it('ignores a second finger', () => {
    const seen = wire();
    const start = new Event('touchstart', { bubbles: true });
    start.touches = [{ clientX: 200, clientY: 200 }, { clientX: 100, clientY: 100 }];
    start.changedTouches = start.touches;
    node.dispatchEvent(start);
    touch(node, 'touchend', 100, 200);
    expect(seen).toEqual([]);
  });
});

describe('pressing and holding', () => {
  it('fires once the hold is long enough, and swallows the click that follows', async () => {
    const held = vi.fn();
    VexGestures.longPress(node, held, 20);
    touch(node, 'touchstart', 50, 50);
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(held).toHaveBeenCalledTimes(1);

    // The browser synthesises a click on touchend whatever happened in between.
    // Preventing the default is what stops it — without this, holding a tab card
    // opened its menu and switched to the tab.
    const end = touch(node, 'touchend', 50, 50);
    expect(end.defaultPrevented).toBe(true);
  });

  it('lets an ordinary tap through untouched', async () => {
    const held = vi.fn();
    VexGestures.longPress(node, held, 50);
    touch(node, 'touchstart', 50, 50);
    const end = touch(node, 'touchend', 50, 50);
    expect(held).not.toHaveBeenCalled();
    expect(end.defaultPrevented).toBe(false);
  });

  it('gives up when the finger moves', async () => {
    const held = vi.fn();
    VexGestures.longPress(node, held, 20);
    touch(node, 'touchstart', 50, 50);
    touch(node, 'touchmove', 90, 50);
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(held).not.toHaveBeenCalled();
    expect(touch(node, 'touchend', 90, 50).defaultPrevented).toBe(false);
  });

  it('does not swallow the click of the next tap', async () => {
    const held = vi.fn();
    VexGestures.longPress(node, held, 20);
    touch(node, 'touchstart', 50, 50);
    await new Promise(resolve => setTimeout(resolve, 40));
    touch(node, 'touchend', 50, 50);

    touch(node, 'touchstart', 50, 50);
    expect(touch(node, 'touchend', 50, 50).defaultPrevented).toBe(false);
    expect(held).toHaveBeenCalledTimes(1);
  });

  it('forgets a hold that the system cancelled', async () => {
    const held = vi.fn();
    VexGestures.longPress(node, held, 20);
    touch(node, 'touchstart', 50, 50);
    await new Promise(resolve => setTimeout(resolve, 40));
    node.dispatchEvent(new Event('touchcancel', { bubbles: true }));
    expect(touch(node, 'touchend', 50, 50).defaultPrevented).toBe(false);
  });
});
