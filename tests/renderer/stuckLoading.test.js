// A page that kept a request open after it had drawn left the spinner over it and the toolbar on Stop for good, and pressing Stop did nothing:
// Vex's loading state ended only on the page's own "stopped" event (owner, 2026-10-25). Stop now ends it itself, and a watchdog clears a missed one.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/js/webview.js'), 'utf8').replace(/\r\n/g, '\n');

describe('Stop', () => {
  const at = src.indexOf('  stop(tabId = TabManager.activeTabId) {');
  const body = src.slice(at, src.indexOf('\n  },', at));
  it('ends Vex\'s own loading state at once, whether or not the page sends its stopped event', () => {
    expect(at).toBeGreaterThan(-1);
    const stopCall = body.indexOf('wv.stop()');
    const cleared = body.indexOf('TabManager.updateTab(tabId, { loading: false })');
    expect(stopCall).toBeGreaterThan(-1);
    expect(cleared).toBeGreaterThan(stopCall);
    expect(body).toContain("classList.remove('wv-loading')");
  });
});

describe('the loading watchdog', () => {
  const at = src.indexOf("onWebview('did-start-loading', () => {");
  const block = src.slice(src.indexOf('let loadWatch = null;'), at + 900);
  it('asks the page again whether it is still loading, and clears the state when it says no', () => {
    expect(at).toBeGreaterThan(-1);
    expect(block).toContain('webview.isLoading()');
    expect(block).toContain('clearLoading()');
    expect(block).toMatch(/setTimeout\(\(\) => ask\(0\), 8000\)/);
  });
  it('keeps the spinner for a page that really is still loading, but only for a bounded time', () => {
    expect(block).toMatch(/round < 40/);
  });
  it('the page\'s own stopped event goes through the same clearing, and cancels the watch', () => {
    expect(src).toContain("onWebview('did-stop-loading', () => { clearLoading(); });");
    expect(block).toContain('clearTimeout(loadWatch)');
  });
});
