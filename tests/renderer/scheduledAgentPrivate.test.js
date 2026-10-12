// @vitest-environment jsdom
//
// A scheduled AI task runs unattended, steered by text it reads. Its page
// reads (read_url) were limited to the public internet, but its own tab was
// not: `navigate` took it to http://127.0.0.1/ or the router and
// `extract_text` read it back, and an agent-made schedule could start on such
// a page (found 2026-10-11, release check of v19.1.7). The page a schedule
// the person made starts on is theirs to read.

import { describe, it, expect, beforeEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/private-address.js');
const { AgentExecutor } = require('../../src/renderer/js/agent-executor.js');

function tab(url) {
  let here = url;
  const loaded = new Set();
  return {
    isConnected: true,
    getURL: () => here,
    isLoading: () => false,
    loadURL: vi.fn((u) => { here = u; setTimeout(() => loaded.forEach(f => f()), 0); }),
    executeJavaScript: () => Promise.resolve('Router status'),
    addEventListener: (type, f) => { if (type === 'did-finish-load') loaded.add(f); },
    removeEventListener: (type, f) => { loaded.delete(f); },
    go: (u) => { here = u; },
  };
}

beforeEach(() => {
  globalThis.WebviewManager = { getActiveWebview: () => null, webviews: new Map() };
  globalThis.TabManager = { tabs: [], activeTabId: null };
  delete window.VexTabPolicy;
  window.vexGuestEval = (wv, code) => wv.executeJavaScript(code);
});

describe('a scheduled run and this computer or the home network', () => {
  it('does not navigate its tab to a private address', async () => {
    const wv = tab('https://news.example/');
    for (const url of ['http://127.0.0.1:8080/', 'http://192.168.1.1/', 'http://[::ffff:127.0.0.1]/', 'http://router/']) {
      const r = await AgentExecutor.executeTool('navigate', { url }, { webview: wv, scheduled: true, startUrl: 'https://news.example/' });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/this computer or the local network/);
    }
    expect(wv.loadURL).not.toHaveBeenCalled();
  });

  it('does not read a private page it landed on (a redirect, going back)', async () => {
    const wv = tab('https://news.example/');
    wv.go('http://192.168.1.1/status');
    const r = await AgentExecutor.executeTool('extract_text', {}, { webview: wv, scheduled: true, startUrl: 'https://news.example/' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/this computer or the local network/);
  });

  it('still reads the page its own schedule starts on, and public pages', async () => {
    const wv = tab('http://192.168.1.1/status');
    const own = await AgentExecutor.executeTool('extract_text', {}, { webview: wv, scheduled: true, startUrl: 'http://192.168.1.1/status' });
    expect(own.error || '').not.toMatch(/local network/);
    const pub = await AgentExecutor.executeTool('navigate', { url: 'https://news.example/' }, { webview: wv, scheduled: true, startUrl: 'http://192.168.1.1/status' });
    expect(pub.ok).toBe(true);
  });

  it('an interactive run is not changed by this', async () => {
    const wv = tab('https://news.example/');
    const r = await AgentExecutor.executeTool('navigate', { url: 'http://127.0.0.1:8080/' }, { webview: wv });
    expect(r.ok).toBe(true);
  });
});

describe('create_schedule made by the agent', () => {
  it('refuses a starting page on this computer or the home network', async () => {
    const created = [];
    globalThis.Scheduler = { createTask: (t) => { created.push(t); return { id: 't1', name: t.name }; } };
    globalThis.ScheduleWords = { parse: () => ({ type: 'daily', time: '09:00' }), describe: () => 'every day at 09:00' };
    const r = await AgentExecutor.executeTool('create_schedule', { when: 'every day at 9am', prompt: 'save the status', startingUrl: 'http://192.168.1.1/' }, {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/this computer or the local network/);
    expect(created).toEqual([]);
    const ok = await AgentExecutor.executeTool('create_schedule', { when: 'every day at 9am', prompt: 'check the news', startingUrl: 'https://news.example/' }, {});
    expect(ok.ok).toBe(true);
    delete globalThis.Scheduler; delete globalThis.ScheduleWords;
  });
});
