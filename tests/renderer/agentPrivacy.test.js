// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
// annotations.js resolves window.CollectionStore, which index.html loads first.
import '../../src/renderer/js/collection-store.js';
import { Recall } from '../../src/renderer/js/recall.js';
import { Annotations } from '../../src/renderer/js/annotations.js';

const source = readFileSync('src/renderer/js/dom-extractor.js', 'utf8');
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('keeps private highlights on the page without adding them to saved annotations', async () => {
  const wv = { getURL: () => 'https://example.test', executeJavaScript: vi.fn(async () => 'Private selection') };
  vi.stubGlobal('WebviewManager', { getActiveWebview: () => wv });
  vi.stubGlobal('TabManager', { getActiveTab: () => ({ url: wv.getURL() }) });
  window.VexTabPolicy = { canReadWebview: () => false };
  Annotations.store = {};
  try {
    await Annotations.highlight('yellow');
    expect(wv.executeJavaScript).toHaveBeenCalledOnce();
    expect(Annotations.store).toEqual({});
  } finally { delete window.VexTabPolicy; }
});
it('Recall excludes private containers even when a normal tab has the same URL', async () => {
  const record = vi.fn(); window.vex = { recallIndex: record };
  const wv = { getURL: () => 'https://example.test', getAttribute: () => 'private:session', executeJavaScript: vi.fn() };
  await Recall.indexPage(wv, wv.getURL(), 'Private');
  expect(wv.executeJavaScript).not.toHaveBeenCalled();
  expect(record).not.toHaveBeenCalled();
});
it('Recall discards extracted text after a same-URL navigation', async () => {
  const record = vi.fn(); window.vex = { recallIndex: record };
  const wv = { getURL: () => 'https://example.test', getAttribute: () => 'persist:main', _navigationGeneration: 1,
    executeJavaScript: async () => { wv._navigationGeneration++; return 'page content '.repeat(30); } };
  await Recall.indexPage(wv, wv.getURL(), 'Previous');
  expect(record).not.toHaveBeenCalled();
});
it('excludes password and OTP field values from real extracted context', async () => {
  document.body.innerHTML = '<input type="password" value="secret"><input autocomplete="one-time-code" value="123456"><input value="search">';
  for (const input of document.querySelectorAll('input')) input.getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, bottom: 20 });
  const extractor = vm.runInNewContext(source + ';DOMExtractor', { window: {} });
  const result = await extractor.extractInteractiveElements({
    getURL: () => 'https://test.example',
    executeJavaScript: script => vm.runInNewContext(script, { document, location: { href: 'https://test.example' }, window: { innerHeight: 800 }, getComputedStyle }),
  });
  expect(result.elements.map(x => x.value)).toEqual([null, null, 'search']);
});
it('discards DOM context when a same-URL reload occurs during extraction', async () => {
  const extractor = vm.runInNewContext(source + ';DOMExtractor', { window: {} });
  const webview = { _navigationGeneration: 1, getURL: () => 'https://test.example', executeJavaScript: async () => {
    webview._navigationGeneration++;
    return { url: 'https://test.example', elements: ['stale'] };
  } };
  expect((await extractor.extractInteractiveElements(webview)).elements).toEqual([]);
});
it('does not report success when cancellation occurs while waiting for an AI finish decision', async () => {
  vi.resetModules();
  const controller = new AbortController();
  vi.stubGlobal('AIRouter', { callAI: async () => {
    controller.abort();
    return { result: JSON.stringify({ tool: 'finish', parameters: { summary: 'Done' } }) };
  } });
  const { AgentLoop } = await import('../../src/renderer/js/agent-loop.js');
  await expect(AgentLoop.startHeadless('goal', 'auto', { webview: {}, signal: controller.signal })).rejects.toThrow('cancelled');
});
it('cleans up readiness listeners and timers when a tab is disposed', async () => {
  vi.useFakeTimers();
  await import('../../src/renderer/js/lifecycle.js');
  const webview = new EventTarget();
  const pending = window.VexLifecycle.ready(webview);
  const assertion = expect(pending).rejects.toThrow('closed');
  await Promise.resolve();
  webview.dispatchEvent(new Event('vex-disposed'));
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
});
