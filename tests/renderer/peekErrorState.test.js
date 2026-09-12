// @vitest-environment jsdom
//
// Peek regression: a preview that failed to load showed an empty white frame
// with no hint of why, and no way forward. It now renders an explicit failure
// state carrying the Chromium error description, plus a retry.
//
// Verified against the real app with an unresolvable host: the overlay showed
// "ERR_NAME_NOT_RESOLVED (-105)".

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VexPeek } from '../../src/renderer/js/peek.js';

beforeEach(() => {
  document.body.innerHTML = '';
  document.getElementById('vex-peek')?.remove();
  VexPeek._els = null;
  VexPeek._url = '';
  globalThis.window.VexTabPolicy = { partitionFor: (p) => p || 'persist:main' };
  globalThis.window.showToast = vi.fn();
});

function fire(type, detail) {
  const ev = new Event(type);
  Object.assign(ev, detail);
  VexPeek._els.wv.dispatchEvent(ev);
}

const errorBox = () => document.querySelector('#vex-peek .peek-error');

describe('VexPeek failure states', () => {
  it('opens with a live guest and no error box', () => {
    VexPeek.open('https://example.test/');
    expect(document.querySelectorAll('#vex-peek webview')).toHaveLength(1);
    expect(errorBox()).toBeNull();
  });

  it('replaces the guest with a readable error on a main-frame load failure', () => {
    VexPeek.open('https://example.test/');
    fire('did-fail-load', { isMainFrame: true, errorCode: -105, errorDescription: 'ERR_NAME_NOT_RESOLVED' });

    const box = errorBox();
    expect(box).toBeTruthy();
    expect(box.querySelector('.peek-error-detail').textContent).toBe('ERR_NAME_NOT_RESOLVED (-105)');
    expect(box.querySelector('.peek-error-retry')).toBeTruthy();
    expect(document.querySelectorAll('#vex-peek webview')).toHaveLength(0);
  });

  it('ignores sub-resource failures', () => {
    VexPeek.open('https://example.test/');
    fire('did-fail-load', { isMainFrame: false, errorCode: -105, errorDescription: 'ERR_NAME_NOT_RESOLVED' });
    expect(errorBox()).toBeNull();
  });

  it('ignores ERR_ABORTED, which just means the user navigated away', () => {
    VexPeek.open('https://example.test/');
    fire('did-fail-load', { isMainFrame: true, errorCode: -3, errorDescription: 'ERR_ABORTED' });
    expect(errorBox()).toBeNull();
  });

  it('reports a crashed preview process', () => {
    VexPeek.open('https://example.test/');
    fire('crashed', {});
    expect(errorBox().querySelector('.peek-error-detail').textContent)
      .toBe('The preview process stopped responding');
  });

  it('retry rebuilds the guest', () => {
    VexPeek.open('https://example.test/');
    fire('did-fail-load', { isMainFrame: true, errorCode: -105, errorDescription: 'ERR_NAME_NOT_RESOLVED' });
    errorBox().querySelector('.peek-error-retry').click();

    expect(errorBox()).toBeNull();
    expect(document.querySelectorAll('#vex-peek webview')).toHaveLength(1);
  });

  it('carries no emoji', () => {
    VexPeek.open('https://example.test/');
    fire('did-fail-load', { isMainFrame: true, errorCode: -105, errorDescription: 'ERR_NAME_NOT_RESOLVED' });
    expect(document.getElementById('vex-peek').textContent)
      .not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u);
  });
});
