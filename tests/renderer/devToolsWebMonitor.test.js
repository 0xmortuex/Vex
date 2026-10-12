// @vitest-environment jsdom
//
// Unit coverage for the developer/power-tools pack (v2.6.0):
//   - JsonApiViewer: header parsing + JSON tree rendering
//   - LinkRot (PageMonitor was merged into PageWatch: tests/renderer/pageWatch.test.js)

import { describe, it, expect, beforeEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js'); // installs window.escapeHtml (loaded first in index.html)
const { JsonApiViewer } = require('../../src/renderer/js/devtools-pack.js');
const { LinkRot } = require('../../src/renderer/js/web-monitor.js');

beforeEach(() => {
  localStorage.clear();
  globalThis.window.showToast = vi.fn();
  globalThis.TabManager = { getActiveTab: () => null, createTab: vi.fn() };
});

describe('JsonApiViewer.parseHeaders', () => {
  it('parses "Key: Value" lines into an object, ignoring blanks/garbage', () => {
    const h = JsonApiViewer.parseHeaders('Authorization: Bearer abc\nContent-Type: application/json\n\nnocolon');
    expect(h).toEqual({ Authorization: 'Bearer abc', 'Content-Type': 'application/json' });
  });
  it('keeps colons in the value (e.g. URLs, times)', () => {
    const h = JsonApiViewer.parseHeaders('X-Url: https://x.com/a:b');
    expect(h['X-Url']).toBe('https://x.com/a:b');
  });
});

describe('JsonApiViewer.renderValue', () => {
  it('renders primitives, escapes HTML, and makes objects/arrays collapsible', () => {
    expect(JsonApiViewer.renderValue(null)).toContain('null');
    expect(JsonApiViewer.renderValue('a<b>')).toContain('&lt;b&gt;');
    const obj = JsonApiViewer.renderValue({ a: [1, 2], b: 'x' });
    expect(obj).toContain('<details');
    expect(obj).toContain('{2}');   // 2 keys
    expect(obj).toContain('[2]');   // array length
  });
});

describe('LinkRot', () => {
  it('opens a Wayback save URL for the page', () => {
    LinkRot.saveToWayback('https://ex.com/a');
    expect(globalThis.TabManager.createTab).toHaveBeenCalledWith('https://web.archive.org/save/https://ex.com/a', true);
  });
  it('ignores non-http URLs', () => {
    LinkRot.viewArchived('vex://start');
    expect(globalThis.TabManager.createTab).not.toHaveBeenCalled();
  });
});
