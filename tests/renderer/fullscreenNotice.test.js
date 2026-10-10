// @vitest-environment jsdom
//
// SE9: a page gone full screen covered the screen with nothing saying whose
// it was or how to leave. A notice names the site for a few seconds.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../../src/renderer/index.html'), 'utf8');

// jsdom has no popover API; the real one puts the notice in the top layer.
HTMLElement.prototype.showPopover = function () { this.__shown = true; };
HTMLElement.prototype.hidePopover = function () { this.__shown = false; };

const FN = require('../../src/renderer/js/fullscreen-notice.js');

function goFullscreen(el) {
  Object.defineProperty(document, 'fullscreenElement', { value: el, configurable: true });
  document.dispatchEvent(new Event('fullscreenchange'));
}

describe('full-screen notice', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { goFullscreen(null); vi.useRealTimers(); });

  it('names the site when its page goes full screen, then goes after a few seconds', () => {
    const wv = document.createElement('webview');
    wv.getURL = () => 'https://www.video.example/watch?v=1';
    document.body.appendChild(wv);
    goFullscreen(wv);
    expect(FN.open).toBe(true);
    expect(FN.bubble.__shown).toBe(true);
    expect(FN.bubble.textContent).toBe('video.example is full screen — press Esc to exit');
    expect(FN.bubble.getAttribute('popover')).toBe('manual');
    vi.advanceTimersByTime(FN.SHOW_MS + 10);
    expect(FN.open).toBe(false);
    expect(FN.bubble.__shown).toBe(false);
  });

  it('goes at once when the page leaves full screen', () => {
    const wv = document.createElement('webview');
    wv.getURL = () => 'https://game.example/';
    goFullscreen(wv);
    expect(FN.open).toBe(true);
    goFullscreen(null);
    expect(FN.open).toBe(false);
  });

  it('says nothing for Vex itself going full screen (F11)', () => {
    goFullscreen(document.documentElement);
    expect(FN.open).toBe(false);
  });

  it('is loaded by the window', () => {
    expect(html).toMatch(/<script src="js\/fullscreen-notice\.js"><\/script>/);
  });
});
