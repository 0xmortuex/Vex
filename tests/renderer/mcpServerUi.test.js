// @vitest-environment jsdom
//
// js/mcp-server-ui.js: the window's side of "Vex as an MCP server". VexMcpBridge is what main asks for the
// tabs and history an outside AI tool may see. It must hand over only what every other feature that shares
// tabs may hand over (VexTabPolicy), and nothing at all from a private window.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { VexMcpBridge, McpServerUI } = require('../../src/renderer/js/mcp-server-ui.js');

const tab = (id, over = {}) => ({ id, title: 'Tab ' + id, url: 'https://site' + id + '.example/page', partition: 'persist:main', ...over });
let tabs;

beforeEach(() => {
  tabs = [tab(1), tab(2, { partition: 'tor-1' }), tab(3, { sleeping: true }), tab(4)];
  globalThis.TabManager = { tabs, activeTabId: 1 };
  globalThis.WebviewManager = { webviews: new Map([[1, { id: 'wv1' }], [4, { id: 'wv4' }]]) };
  window.VexTabPolicy = {
    isPrivateWindow: false,
    canShareTab: (t) => !String(t.partition).startsWith('tor'),
    canReadWebview: () => true,
  };
  window.vexGuestEval = vi.fn(async () => JSON.stringify({ title: 'T', url: 'https://site1.example/page', text: 'hello world' }));
  globalThis.AgentTools = { searchHistory: vi.fn(() => [{ title: 'H', url: 'https://h.example/a?q=1' }]) };
  window.VexProblems = { note: vi.fn() };
});

describe('listTabs', () => {
  it('lists the tabs the policy lets any feature share, and none of the others', async () => {
    const r = await VexMcpBridge.listTabs();
    expect(r.ok).toBe(true);
    expect(r.tabs.map(t => t.id)).toEqual([1, 3, 4]);
    expect(Object.keys(r.tabs[0]).sort()).toEqual(['id', 'title', 'url']);
  });
  it('lists nothing in a private window', async () => {
    window.VexTabPolicy.isPrivateWindow = true;
    expect((await VexMcpBridge.listTabs()).tabs).toEqual([]);
  });
  it('lists nothing when there is no tab policy at all', async () => {
    delete window.VexTabPolicy;
    expect((await VexMcpBridge.listTabs()).tabs).toEqual([]);
  });
  it('says so when the tab manager is not there', async () => {
    delete globalThis.TabManager;
    expect(await VexMcpBridge.listTabs()).toEqual({ ok: false, code: 'unavailable' });
  });
});

describe('tabInfo', () => {
  it('the active tab when none is named; a named tab otherwise', async () => {
    expect((await VexMcpBridge.tabInfo({ tabId: null })).tab.id).toBe(1);
    expect((await VexMcpBridge.tabInfo({ tabId: 4 })).tab.id).toBe(4);
  });
  it('a Tor or private tab is private; an unknown id is no-tab', async () => {
    expect(await VexMcpBridge.tabInfo({ tabId: 2 })).toEqual({ ok: false, code: 'private' });
    expect(await VexMcpBridge.tabInfo({ tabId: 99 })).toEqual({ ok: false, code: 'no-tab' });
  });
  it('in a private window every tab is private', async () => {
    window.VexTabPolicy.isPrivateWindow = true;
    expect(await VexMcpBridge.tabInfo({ tabId: 1 })).toEqual({ ok: false, code: 'private' });
  });
});

describe('readText', () => {
  const ask = (over = {}) => VexMcpBridge.readText({ tabId: 1, expectedUrl: 'https://site1.example/page', maxChars: 500, ...over });

  it('reads the page main looked at', async () => {
    const r = await ask();
    expect(r).toEqual({ ok: true, title: 'T', url: 'https://site1.example/page', text: 'hello world' });
    const script = window.vexGuestEval.mock.calls[0][1];
    expect(script).toContain('input[type="password"]');
    expect(script).toContain('slice(0, 501)');
  });
  it('refuses when the page has moved since main looked', async () => {
    expect(await ask({ expectedUrl: 'https://elsewhere.example/' })).toEqual({ ok: false, code: 'changed' });
    expect(window.vexGuestEval).not.toHaveBeenCalled();
  });
  it('refuses a sleeping tab and a tab that has no page', async () => {
    expect((await ask({ tabId: 3, expectedUrl: tabs[2].url })).code).toBe('asleep');
    globalThis.WebviewManager.webviews.delete(1);
    expect((await ask()).code).toBe('asleep');
  });
  it('refuses a tab the policy will not share, and a page the policy will not let be read', async () => {
    expect((await ask({ tabId: 2, expectedUrl: tabs[1].url })).code).toBe('private');
    window.VexTabPolicy.canReadWebview = () => false;
    expect((await ask()).code).toBe('private');
    expect(window.vexGuestEval).not.toHaveBeenCalled();
  });
  it('a page with a password or card field gives no text', async () => {
    window.vexGuestEval.mockResolvedValue(JSON.stringify({ sensitive: true }));
    expect(await ask()).toEqual({ ok: false, code: 'sensitive' });
  });
  it('an unreadable answer is reported, not swallowed', async () => {
    window.vexGuestEval.mockResolvedValue('not json');
    expect(await ask()).toEqual({ ok: false, code: 'unavailable' });
    expect(window.VexProblems.note).toHaveBeenCalledTimes(1);
    window.vexGuestEval.mockResolvedValue(JSON.stringify({ error: 'boom' }));
    expect((await ask()).code).toBe('unavailable');
  });
  it('the size is bounded', async () => {
    await ask({ maxChars: 999999 });
    expect(window.vexGuestEval.mock.calls[0][1]).toContain('slice(0, ' + (VexMcpBridge.MAX_TEXT + 1) + ')');
  });
});

describe('searchHistory', () => {
  it('asks the same history search the agent uses, and nothing in a private window', async () => {
    const r = await VexMcpBridge.searchHistory({ query: 'cats', limit: 5 });
    expect(r).toEqual({ ok: true, items: [{ title: 'H', url: 'https://h.example/a?q=1' }] });
    expect(globalThis.AgentTools.searchHistory).toHaveBeenCalledWith('cats', 15);
    window.VexTabPolicy.isPrivateWindow = true;
    expect(await VexMcpBridge.searchHistory({ query: 'cats', limit: 5 })).toEqual({ ok: false, code: 'private' });
  });
});

describe('the connection snippets', () => {
  it('carry the address and the token, and the Claude Desktop one is valid JSON that keeps the token out of the arguments', () => {
    const s = McpServerUI.snippets('http://127.0.0.1:41000/mcp', 'TOKEN123');
    expect(s.code).toContain('claude mcp add --transport http vex http://127.0.0.1:41000/mcp');
    expect(s.code).toContain('Authorization: Bearer TOKEN123');
    const cfg = JSON.parse(s.desktop);
    expect(cfg.mcpServers.vex.command).toBe('npx');
    expect(cfg.mcpServers.vex.args).toContain('http://127.0.0.1:41000/mcp');
    expect(cfg.mcpServers.vex.args.join(' ')).not.toContain('TOKEN123');
    expect(cfg.mcpServers.vex.env.VEX_AUTH).toBe('Bearer TOKEN123');
  });
});
