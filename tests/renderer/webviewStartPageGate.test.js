// Security: the VEX_CMD console channel (navigate the tab, open chrome panels)
// must only be honoured when the emitting guest is the trusted Vex start page.
// _isTrustedStartPage is the gate. It is deliberately STRICTER than isStartPage()
// — which matches any URL containing "start.html" — so a hostile page at
// https://evil.com/start.html (or .../renderer/start.html) cannot drive the
// browser chrome.

import { describe, it, expect } from 'vitest';

async function load() {
  const mod = await import('../../src/renderer/js/webview.js');
  return mod._isTrustedStartPage;
}

describe('_isTrustedStartPage — accepts the real start page', () => {
  it('accepts canonical vex://start (with and without trailing slash)', async () => {
    const f = await load();
    expect(f('vex://start')).toBe(true);
    expect(f('vex://start/')).toBe(true);
  });

  it('accepts the file:// start page at /renderer/start.html', async () => {
    const f = await load();
    expect(f('file:///C:/Claude%20code%20free/vex/src/renderer/start.html')).toBe(true);
    expect(f('file:///home/user/vex/src/renderer/start.html')).toBe(true);
  });

  it('accepts the file:// start page even with a ?theme= query', async () => {
    const f = await load();
    // startUrlWithTheme appends ?theme=… to the file:// start page; the query
    // is not part of pathname, so the match still holds.
    expect(f('file:///x/renderer/start.html?theme=oxford')).toBe(true);
  });
});

describe('_isTrustedStartPage — rejects everything else', () => {
  it('rejects a remote page that merely contains start.html', async () => {
    const f = await load();
    expect(f('https://evil.com/start.html')).toBe(false);
    expect(f('https://evil.com/renderer/start.html')).toBe(false);
    expect(f('https://evil.com/?x=start.html')).toBe(false);
  });

  it('rejects other schemes and ordinary pages', async () => {
    const f = await load();
    expect(f('http://example.com/')).toBe(false);
    expect(f('https://example.com/')).toBe(false);
    expect(f('data:text/html,<h1>hi</h1>')).toBe(false);
  });

  it('rejects a vex:// host that is not "start"', async () => {
    const f = await load();
    expect(f('vex://settings')).toBe(false);
    expect(f('vex://start.evil')).toBe(false);
  });

  it('rejects a file:// path that is not the start page', async () => {
    const f = await load();
    expect(f('file:///x/renderer/index.html')).toBe(false);
    expect(f('file:///x/elsewhere/start.html.evil')).toBe(false);
  });

  it('rejects empty, null, and non-string input', async () => {
    const f = await load();
    expect(f('')).toBe(false);
    expect(f(null)).toBe(false);
    expect(f(undefined)).toBe(false);
    expect(f(42)).toBe(false);
    expect(f('not a url')).toBe(false);
  });
});
