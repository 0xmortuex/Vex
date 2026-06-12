// @vitest-environment jsdom
//
// Unit coverage for the developer/power-tools pack (v2.6.0):
//   - JsonApiViewer: header parsing + JSON tree rendering
//   - PageMonitor: HTML→text stripping, stable hashing, add/dedupe over storage

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { JsonApiViewer } = require('../../src/renderer/js/devtools-pack.js');
const { PageMonitor, LinkRot } = require('../../src/renderer/js/web-monitor.js');

beforeEach(() => {
  localStorage.clear();
  PageMonitor.watches = [];
  clearInterval(PageMonitor._timer);
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

describe('PageMonitor', () => {
  it('strips scripts/styles/tags/entities down to readable text', () => {
    const txt = PageMonitor._strip('<style>.x{}</style><div>Hello&nbsp; <script>bad()</script><b>world</b></div>');
    expect(txt).toBe('Hello world');
  });

  it('hash is stable for equal text and differs for changed text', () => {
    expect(PageMonitor._hash('abc')).toBe(PageMonitor._hash('abc'));
    expect(PageMonitor._hash('abc')).not.toBe(PageMonitor._hash('abd'));
  });

  it('add() stores a watch, persists, and refuses duplicates', async () => {
    globalThis.window.vex = { apiRequest: vi.fn(async () => ({ ok: true, body: '<p>baseline</p>' })) };
    await PageMonitor.add('https://ex.com/stock', 'Stock');
    expect(PageMonitor.watches).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('vex.watches'))).toHaveLength(1);
    // baseline established from the initial fetch
    expect(PageMonitor.watches[0].lastHash).not.toBeNull();

    await PageMonitor.add('https://ex.com/stock', 'Stock again');
    expect(PageMonitor.watches).toHaveLength(1); // deduped
  });

  it('_check flags a change when the stripped content hash moves', async () => {
    const w = { id: 'w1', url: 'https://ex.com', title: 'X', intervalMin: 30, lastHash: null, lastChecked: 0, changed: false };
    PageMonitor.watches = [w];
    globalThis.window.vex = { apiRequest: vi.fn(async () => ({ ok: true, body: '<p>one</p>' })) };
    await PageMonitor._check(w, true);            // sets baseline
    expect(w.changed).toBe(false);
    globalThis.window.vex.apiRequest = vi.fn(async () => ({ ok: true, body: '<p>two</p>' }));
    await PageMonitor._check(w, true);            // content changed
    expect(w.changed).toBe(true);
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
