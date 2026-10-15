// @vitest-environment jsdom
//
// Ask across my tabs (js/ask-tabs.js): local model only, off until switched on,
// and a private, Tor, bank or excluded tab is never read.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let A;
const tab = (id, url, extra = {}) => ({ id, url, title: 'T' + id, ...extra });

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  window.showToast = vi.fn();
  window.VexTabPolicy = { isPrivateWindow: false, canShareTab: (t) => !t.partition || String(t.partition).startsWith('persist:') };
  globalThis.TabManager = { tabs: [] };
  await import('../../src/renderer/js/resume-workday.js');
  await import('../../src/renderer/js/ask-tabs.js');
  A = window.VexAskTabs;
});

afterEach(() => {
  delete globalThis.TabManager; delete globalThis.AIRouter; delete globalThis.MultiTabContext;
  vi.restoreAllMocks();
});

describe('which tabs are read', () => {
  it('leaves out private, bank, excluded, sleeping and Vex pages, with a reason', () => {
    window.VexWorkflow.setPref('askTabsExclude', ['secret.test']);
    const tabs = [
      tab(1, 'https://docs.test/a'),
      tab(2, 'https://mail.test/', { partition: 'private-x' }),
      tab(3, 'https://www.paypal.com/myaccount'),
      tab(4, 'https://app.secret.test/x'),
      tab(5, 'https://slow.test/', { sleeping: true }),
      tab(6, 'vex://start'),
      tab(7, 'https://mybank.example/login'),
    ];
    const p = A.plan(tabs);
    expect(p.use.map(t => t.id)).toEqual([1]);
    expect(p.left.map(l => l.tab.id)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(p.left.find(l => l.tab.id === 4).why).toMatch(/exclude/);
  });

  it('caps the number of tabs read', () => {
    const tabs = Array.from({ length: 20 }, (_, i) => tab(i + 1, 'https://s' + i + '.test/'));
    const p = A.plan(tabs);
    expect(p.use).toHaveLength(A.MAX_TABS);
    expect(p.left).toHaveLength(20 - A.MAX_TABS);
  });
});

describe('asking', () => {
  beforeEach(() => {
    globalThis.TabManager.tabs = [tab(1, 'https://docs.test/a'), tab(2, 'https://other.test/')];
  });

  it('refuses while it is off', async () => {
    globalThis.AIRouter = { ollamaUp: async () => true, callOn: vi.fn() };
    await expect(A.ask('what?')).rejects.toThrow(/off/);
    expect(AIRouter.callOn).not.toHaveBeenCalled();
  });

  it('with no local model it says so and never reads a tab or goes to the cloud', async () => {
    window.VexWorkflow.setPref('askTabs', true);
    const extract = vi.fn();
    globalThis.AIRouter = { ollamaUp: async () => false, callOn: vi.fn() };
    globalThis.MultiTabContext = { extractContextFromTabs: extract };
    await expect(A.ask('what?')).rejects.toThrow(/never sent to the cloud/);
    expect(extract).not.toHaveBeenCalled();
    expect(AIRouter.callOn).not.toHaveBeenCalled();
  });

  it('asks the local backend only, and maps [n] back to the tab', async () => {
    window.VexWorkflow.setPref('askTabs', true);
    globalThis.AIRouter = {
      ollamaUp: async () => true,
      callOn: vi.fn(async () => ({ result: JSON.stringify({ reply: 'It is 5 [1] and blue [2].' }) })),
    };
    globalThis.MultiTabContext = {
      extractContextFromTabs: async (tabs) => tabs.map(t => ({ tabId: t.id, title: t.title, url: t.url, text: 'text of ' + t.id })),
    };
    const r = await A.ask('how many?');
    expect(AIRouter.callOn.mock.calls[0][0]).toBe('local');
    expect(r.answer).toBe('It is 5 [1] and blue [2].');
    expect(r.sources.map(s => s.tab.id)).toEqual([1, 2]);
    const node = A.answerNode(r.answer, r.sources, () => {});
    expect(node.querySelectorAll('button')).toHaveLength(2);
  });
});
