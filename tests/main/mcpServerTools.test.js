// src/main/mcp-server-ipc.js: what the four tools do with the window, the policy, the person and the log,
// and the switch (confirm, sealed token shown once, rotate, autostart). Every outside thing is a fake:
// the window bridge, the approval box, the sealed store, the http module, the file system, the clock.
import { describe, it, expect, vi } from 'vitest';
const { EventEmitter } = require('events');
const nodePath = require('path');
const { createEvoMcp, registerEvoMcpIpc } = require('../../src/main/mcp-server-ipc.js');
const { createAgentControl } = require('../../src/main/agent-policy-ipc.js');
const { tokenOk } = require('../../src/main/mcp-server.js');
const { createMemFs, memAtomicWriteSync } = require('./_memfs.js');

const T0 = Date.UTC(2026, 10, 7, 12, 0, 0);
const DIR = '/profile';

function fakeHttp() {
  const made = [];
  return {
    made,
    createServer(handler) {
      const s = new EventEmitter();
      s.handler = handler;
      s.listen = (port, host) => { s.listenArgs = [port, host]; setImmediate(() => { s.port = port || 41000 + made.indexOf(s); s.emit('listening'); }); };
      s.address = () => ({ port: s.port });
      s.close = (cb) => { s.closed = true; if (cb) cb(); };
      s.closeAllConnections = () => {};
      made.push(s);
      return s;
    },
  };
}

function build({ bridge = {}, approveAnswer = 'allow', confirmAnswer = true, memory = {}, tokens = ['T'.repeat(43), 'U'.repeat(43), 'V'.repeat(43)] } = {}) {
  const fs = createMemFs(memory);
  const logs = [];
  const control = createAgentControl({ fs, dir: DIR, now: () => T0, atomicWriteSync: memAtomicWriteSync, log: (m) => logs.push(m), offsetMinutes: 0 });
  const http = fakeHttp();
  const sealed = new Map();
  const secretStore = { read: vi.fn(async (f) => (sealed.has(f) ? sealed.get(f) : null)), write: vi.fn(async (f, v) => { sealed.set(f, v); }) };
  const calls = { bridge: [], approve: [], confirm: [], opened: [] };
  const evo = createEvoMcp({
    fs, dir: DIR, secretStore, atomicWriteSync: memAtomicWriteSync, http, control, version: '1.2.3', now: () => T0, log: (m) => logs.push(m),
    randomToken: () => tokens.shift(),
    confirm: async (o) => { calls.confirm.push(o); return confirmAnswer; },
    approve: async (o) => { calls.approve.push(o); if (typeof approveAnswer === 'function') return approveAnswer(o); return approveAnswer; },
    callBridge: async (method, arg) => { calls.bridge.push([method, arg]); const fn = bridge[method]; if (!fn) return { ok: false, code: 'unavailable' }; return fn(arg); },
    openTab: (url) => { calls.opened.push(url); },
  });
  const run = (name, args, ctx = {}) => evo.handleTool(name, args, { client: 'Claude', isStale: () => false, ...ctx });
  const lines = () => control.audit.list(100).entries.map(e => [e.caller, e.tool, e.host, e.decision, e.result]);
  return { fs, control, http, secretStore, sealed, calls, evo, run, lines, logs };
}

const tabsBridge = (tabs) => ({ listTabs: async () => ({ ok: true, tabs }) });

describe('list_tabs', () => {
  it('returns id, title and site name only, and leaves out sensitive pages and blocked sites', async () => {
    const t = build({ bridge: tabsBridge([
      { id: 1, title: 'News', url: 'https://news.example/a/b?page=2#frag' },
      { id: 2, title: 'My bank', url: 'https://bank.example/accounts' },
      { id: 3, title: 'Sign in', url: 'https://app.example/login' },
      { id: 4, title: 'Blocked one', url: 'https://www.blocked.example/page' },
      { id: 5, title: 'New tab', url: 'about:blank' },
      { id: 6, title: 'Docs', url: 'https://docs.example/' },
    ]) });
    t.control.set({ ...t.control.get(), denyHosts: ['blocked.example'] });
    const r = await t.run('list_tabs', {});
    expect(r.isError).toBe(false);
    const out = JSON.parse(r.text);
    expect(out.tabs).toEqual([{ id: 1, title: 'News', host: 'news.example' }, { id: 6, title: 'Docs', host: 'docs.example' }]);
    expect(r.text).not.toContain('page=2');
    expect(r.text).not.toContain('/a/b');
    expect(t.lines()).toEqual([['mcp:Claude', 'list_tabs', '', 'allow', 'ok']]);
  });

  it('when the window cannot answer, says so and logs unavailable', async () => {
    const t = build();
    const r = await t.run('list_tabs', {});
    expect(r.isError).toBe(true);
    expect(t.lines()).toEqual([['mcp:Claude', 'list_tabs', '', 'allow', 'unavailable']]);
  });

  it('asks first when the person set the tool to ask', async () => {
    const t = build({ bridge: tabsBridge([]), approveAnswer: 'block' });
    t.control.set({ ...t.control.get(), tools: { mcp: { list_tabs: 'ask' }, agent: {} } });
    const r = await t.run('list_tabs', {});
    expect(r.isError).toBe(true);
    expect(t.calls.approve).toHaveLength(1);
    expect(t.calls.bridge).toHaveLength(0);
    expect(t.lines()).toEqual([['mcp:Claude', 'list_tabs', '', 'ask-blocked', 'denied-user']]);
  });
});

describe('read_page_text', () => {
  const page = (over = {}) => ({
    tabInfo: async () => ({ ok: true, tab: { id: 7, title: 'Article', url: 'https://news.example/story' } }),
    readText: async () => ({ ok: true, title: 'Article', url: 'https://news.example/story?utm=1', text: 'word '.repeat(300) }),
    ...over,
  });

  it('reads a normal page, cuts to maxChars, strips the query from the address it returns', async () => {
    const t = build({ bridge: page() });
    const r = await t.run('read_page_text', { tabId: null, maxChars: 500 });
    expect(r.isError).toBe(false);
    const out = JSON.parse(r.text);
    expect(out.text).toHaveLength(500);
    expect(out.truncated).toBe(true);
    expect(out.url).toBe('https://news.example/story');
    expect(t.calls.bridge.map(c => c[0])).toEqual(['tabInfo', 'readText']);
    expect(t.calls.bridge[1][1]).toEqual({ tabId: 7, expectedUrl: 'https://news.example/story', maxChars: 500 });
    // The log has the host and a code; never the words that were read.
    expect(t.lines()).toEqual([['mcp:Claude', 'read_page_text', 'news.example', 'allow', 'ok']]);
    expect(t.fs.files.get(nodePath.join(DIR, 'agent-audit.jsonl'))).not.toContain('word');
  });

  it.each([
    ['private', 'denied-private'],
    ['sensitive', 'denied-sensitive'],
    ['asleep', 'unavailable'],
    ['no-tab', 'error'],
    ['changed', 'error'],
    ['unavailable', 'unavailable'],
  ])('a private / routed / unreadable tab: the window says %s, logged as %s, and no text is returned', async (code, result) => {
    const t = build({ bridge: page({ tabInfo: async () => ({ ok: false, code }) }) });
    const r = await t.run('read_page_text', { tabId: 3, maxChars: 500 });
    expect(r.isError).toBe(true);
    expect(t.lines()[0][4]).toBe(result);
    expect(t.calls.bridge.map(c => c[0])).toEqual(['tabInfo']);
  });

  it.each([
    'https://bank.example/overview',
    'https://accounts.example/home',
    'https://shop.example/checkout',
    'https://app.example/login',
    'https://app.example/page?token=abc',
    'https://mail.google.com/mail/u/0/',
    'https://hospital.example/patient',
  ])('refuses the sensitive page %s without reading it', async (url) => {
    const readText = vi.fn();
    const t = build({ bridge: page({ tabInfo: async () => ({ ok: true, tab: { id: 7, title: 'x', url } }), readText }) });
    const r = await t.run('read_page_text', { tabId: null, maxChars: 500 });
    expect(r.isError).toBe(true);
    expect(readText).not.toHaveBeenCalled();
    expect(t.lines()[0].slice(3)).toEqual(['deny', 'denied-sensitive']);
  });

  it('refuses a page that is not a web page', async () => {
    const readText = vi.fn();
    const t = build({ bridge: page({ tabInfo: async () => ({ ok: true, tab: { id: 7, title: 'x', url: 'file:///C:/secret.txt' } }), readText }) });
    expect((await t.run('read_page_text', { tabId: null, maxChars: 500 })).isError).toBe(true);
    expect(readText).not.toHaveBeenCalled();
  });

  it('refuses a site on the person\'s blocked list, sub-domains included, before reading', async () => {
    const readText = vi.fn();
    const t = build({ bridge: page({ tabInfo: async () => ({ ok: true, tab: { id: 7, title: 'x', url: 'https://sub.blocked.example/a' } }), readText }) });
    t.control.set({ ...t.control.get(), denyHosts: ['blocked.example'] });
    const r = await t.run('read_page_text', { tabId: null, maxChars: 500 });
    expect(r.isError).toBe(true);
    expect(readText).not.toHaveBeenCalled();
    expect(t.lines()).toEqual([['mcp:Claude', 'read_page_text', 'sub.blocked.example', 'deny', 'denied-host']]);
  });

  it('a page with a password or card field is refused by the window and nothing is returned', async () => {
    const t = build({ bridge: page({ readText: async () => ({ ok: false, code: 'sensitive' }) }) });
    const r = await t.run('read_page_text', { tabId: null, maxChars: 500 });
    expect(r.isError).toBe(true);
    expect(r.text).not.toContain('word');
    expect(t.lines()[0].slice(3)).toEqual(['allow', 'denied-sensitive']);
  });

  it('judges the address again after the read: a page that moved to a blocked or sensitive address is dropped', async () => {
    const moved = build({ bridge: page({ readText: async () => ({ ok: true, title: 't', url: 'https://bank.example/login', text: 'secret words' }) }) });
    const r1 = await moved.run('read_page_text', { tabId: null, maxChars: 500 });
    expect(r1.isError).toBe(true);
    expect(r1.text).not.toContain('secret words');
    const blocked = build({ bridge: page({ readText: async () => ({ ok: true, title: 't', url: 'https://x.blocked.example/', text: 'secret words' }) }) });
    blocked.control.set({ ...blocked.control.get(), denyHosts: ['blocked.example'] });
    const r2 = await blocked.run('read_page_text', { tabId: null, maxChars: 500 });
    expect(r2.isError).toBe(true);
    expect(r2.text).not.toContain('secret words');
  });
});

describe('open_url: only after the person says yes, every time', () => {
  const URL1 = 'https://example.com/path?q=1';

  it('shows the person the client, the site and the whole address, and opens it only on Allow once', async () => {
    const t = build({ approveAnswer: 'allow' });
    const r = await t.run('open_url', { url: URL1 });
    expect(r.isError).toBe(false);
    expect(t.calls.approve).toEqual([{ client: 'Claude', tool: 'open_url', host: 'example.com', detail: URL1 }]);
    expect(t.calls.opened).toEqual([URL1]);
    expect(t.lines()).toEqual([['mcp:Claude', 'open_url', 'example.com', 'ask-allowed', 'ok']]);
  });

  it('asks again on every call (no memory of an earlier yes)', async () => {
    const t = build({ approveAnswer: 'allow' });
    await t.run('open_url', { url: URL1 });
    await t.run('open_url', { url: URL1 });
    expect(t.calls.approve).toHaveLength(2);
    expect(t.calls.opened).toHaveLength(2);
  });

  it.each(['block', 'busy', 'maybe', null, true, 'ALLOW', 'allow '])('anything but exactly "allow" (%j) opens nothing', async (answer) => {
    const t = build({ approveAnswer: answer });
    const r = await t.run('open_url', { url: URL1 });
    expect(r.isError).toBe(true);
    expect(t.calls.opened).toEqual([]);
    expect(t.lines()[0][3]).toBe('ask-blocked');
  });

  it('busy is logged as busy; a no is logged as denied-user', async () => {
    const busy = build({ approveAnswer: 'busy' });
    await busy.run('open_url', { url: URL1 });
    expect(busy.lines()[0][4]).toBe('busy');
    const no = build({ approveAnswer: 'block' });
    await no.run('open_url', { url: URL1 });
    expect(no.lines()[0][4]).toBe('denied-user');
  });

  it('an approval box that fails counts as no', async () => {
    const t = build({ approveAnswer: () => { throw new Error('dialog crashed'); } });
    const r = await t.run('open_url', { url: URL1 });
    expect(r.isError).toBe(true);
    expect(t.calls.opened).toEqual([]);
  });

  it('an answer that comes after the request timed out does not open anything', async () => {
    let stale = false;
    const t = build({ approveAnswer: () => { stale = true; return 'allow'; } });
    const r = await t.run('open_url', { url: URL1 }, { isStale: () => stale });
    expect(r.isError).toBe(true);
    expect(t.calls.opened).toEqual([]);
    expect(t.lines()[0].slice(3)).toEqual(['ask-blocked', 'unavailable']);
  });

  it('set to block in the policy, it never even asks', async () => {
    const t = build({ approveAnswer: 'allow' });
    t.control.set({ ...t.control.get(), tools: { mcp: { open_url: 'deny' }, agent: {} } });
    const r = await t.run('open_url', { url: URL1 });
    expect(r.isError).toBe(true);
    expect(t.calls.approve).toHaveLength(0);
    expect(t.calls.opened).toEqual([]);
    expect(t.lines()[0].slice(3)).toEqual(['deny', 'denied-policy']);
  });

  it('a policy that tries to allow it without asking still asks', async () => {
    const t = build({ approveAnswer: 'block' });
    t.control.set({ ...t.control.get(), tools: { mcp: { open_url: 'allow' }, agent: {} } });
    await t.run('open_url', { url: URL1 });
    expect(t.calls.approve).toHaveLength(1);
    expect(t.calls.opened).toEqual([]);
  });

  it('an address on a blocked site is refused without asking', async () => {
    const t = build({ approveAnswer: 'allow' });
    t.control.set({ ...t.control.get(), denyHosts: ['example.com'] });
    const r = await t.run('open_url', { url: 'https://www.example.com/' });
    expect(r.isError).toBe(true);
    expect(t.calls.approve).toHaveLength(0);
    expect(t.lines()[0].slice(3)).toEqual(['deny', 'denied-host']);
  });

  it('if the tab cannot be opened it says so and logs an error', async () => {
    const t = build({ approveAnswer: 'allow' });
    const evo2 = createEvoMcp({ fs: t.fs, dir: DIR, secretStore: t.secretStore, atomicWriteSync: memAtomicWriteSync, http: fakeHttp(), control: t.control, confirm: async () => true, approve: async () => 'allow', callBridge: async () => ({ ok: false }), openTab: () => { throw new Error('no window'); }, log: () => {} });
    const r = await evo2.handleTool('open_url', { url: URL1 }, { client: 'Claude', isStale: () => false });
    expect(r.isError).toBe(true);
    expect(t.lines()[0].slice(3)).toEqual(['ask-allowed', 'error']);
  });
});

describe('search_history', () => {
  it('returns titles and bare addresses, drops sensitive pages and blocked sites, honours the limit', async () => {
    const items = [
      { title: 'A', url: 'https://a.example/x?session=1#h' },
      { title: 'Bank', url: 'https://bank.example/' },
      { title: 'B', url: 'https://b.example/y' },
      { title: 'Blocked', url: 'https://blocked.example/z' },
      { title: 'C', url: 'https://c.example/' },
    ];
    const t = build({ bridge: { searchHistory: async () => ({ ok: true, items }) } });
    t.control.set({ ...t.control.get(), denyHosts: ['blocked.example'] });
    const r = await t.run('search_history', { query: 'example', limit: 2 });
    expect(JSON.parse(r.text).items).toEqual([{ title: 'B', url: 'https://b.example/y' }, { title: 'C', url: 'https://c.example/' }]);
    expect(r.text).not.toContain('session=1');
    // The search words never reach the log.
    expect(t.fs.files.get(nodePath.join(DIR, 'agent-audit.jsonl'))).not.toContain('example');
    expect(t.lines()).toEqual([['mcp:Claude', 'search_history', '', 'allow', 'ok']]);
  });
});

describe('policy, budget and a log that must be writable', () => {
  it('a tool Vex does not offer is denied if it ever reaches here', async () => {
    const t = build();
    const r = await t.run('type_text', { text: 'x' });
    expect(r.isError).toBe(true);
    expect(t.lines()[0].slice(3)).toEqual(['deny', 'denied-policy']);
  });

  it('the daily budget stops calls, and is logged as denied-budget', async () => {
    const t = build({ bridge: tabsBridge([]) });
    t.control.set({ ...t.control.get(), budget: { mcp: 2, agent: 0 } });
    expect((await t.run('list_tabs', {})).isError).toBe(false);
    expect((await t.run('list_tabs', {})).isError).toBe(false);
    const third = await t.run('list_tabs', {});
    expect(third.isError).toBe(true);
    expect(t.lines()[2].slice(3)).toEqual(['deny', 'denied-budget']);
  });

  it('fails closed when the activity log cannot be written: nothing is asked, read or opened', async () => {
    const t = build({ approveAnswer: 'allow', bridge: tabsBridge([]) });
    t.fs.appendFileSync = () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); };
    const r = await t.run('open_url', { url: 'https://example.com/' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/activity log/);
    expect(t.calls.approve).toHaveLength(0);
    expect(t.calls.opened).toEqual([]);
    expect((await t.run('list_tabs', {})).isError).toBe(true);
    expect(t.calls.bridge).toHaveLength(0);
  });

  it('the client name in the log is cleaned', async () => {
    const t = build({ bridge: tabsBridge([]) });
    await t.run('list_tabs', {}, { client: 'Evil\n{"x":1} client' });
    expect(t.lines()[0][0]).toBe('mcp:Evilx1 client');
  });
});

describe('the switch, the sealed token and autostart', () => {
  it('is off until switched on; asks first; a no changes nothing', async () => {
    const t = build({ confirmAnswer: false });
    expect(await t.evo.status()).toMatchObject({ enabled: false, running: false, hasToken: false, url: null });
    const r = await t.evo.setEnabled(true);
    expect(r.canceled).toBe(true);
    expect(t.http.made).toHaveLength(0);
    expect(t.sealed.size).toBe(0);
    expect(t.calls.confirm).toHaveLength(1);
  });

  it('switching on makes the token once, seals it, listens on 127.0.0.1, remembers the port, and shows the token only this once', async () => {
    const t = build();
    const r = await t.evo.setEnabled(true);
    expect(r.running).toBe(true);
    expect(r.token).toBe('T'.repeat(43));
    expect(r.url).toBe('http://127.0.0.1:41000/mcp');
    expect(t.http.made[0].listenArgs).toEqual([0, '127.0.0.1']);
    expect(t.sealed.get(nodePath.join(DIR, 'mcp-server-token.enc'))).toBe('T'.repeat(43));
    expect(JSON.parse(t.fs.files.get(nodePath.join(DIR, 'mcp-server.json')))).toEqual({ enabled: true, port: 41000 });
    // Never in the config file, never in the audit log, never in the status.
    expect(t.fs.files.get(nodePath.join(DIR, 'mcp-server.json'))).not.toContain('TTTT');
    const st = await t.evo.status();
    expect(JSON.stringify(st)).not.toContain('TTTT');
    expect(st.token).toBeUndefined();
    // The server accepts that token and no other.
    expect(tokenOk('Bearer ' + 'T'.repeat(43), 'T'.repeat(43))).toBe(true);
  });

  it('switching off stops the listener; switching on again keeps the same token and does not show it again', async () => {
    const t = build();
    await t.evo.setEnabled(true);
    const off = await t.evo.setEnabled(false);
    expect(off.running).toBe(false);
    expect(t.http.made[0].closed).toBe(true);
    expect(JSON.parse(t.fs.files.get(nodePath.join(DIR, 'mcp-server.json'))).enabled).toBe(false);
    const again = await t.evo.setEnabled(true);
    expect(again.running).toBe(true);
    expect(again.token).toBeUndefined();
    expect(t.secretStore.write).toHaveBeenCalledTimes(1);
    expect(t.http.made[1].listenArgs).toEqual([41000, '127.0.0.1']);
  });

  it('rotating asks first, replaces the sealed token, and shows the new one once', async () => {
    const t = build();
    await t.evo.setEnabled(true);
    const r = await t.evo.rotate();
    expect(r.token).toBe('U'.repeat(43));
    expect(t.sealed.get(nodePath.join(DIR, 'mcp-server-token.enc'))).toBe('U'.repeat(43));
    expect(t.calls.confirm).toHaveLength(2);
  });

  it('a rotate that is not confirmed keeps the old token', async () => {
    const t = build();
    await t.evo.setEnabled(true);
    // The same object cannot change its answer, so a second instance on the same files stands in.
    const evo2 = createEvoMcp({ fs: t.fs, dir: DIR, secretStore: t.secretStore, atomicWriteSync: memAtomicWriteSync, http: fakeHttp(), control: t.control, confirm: async () => false, approve: async () => 'block', callBridge: async () => ({ ok: false }), openTab: () => {}, log: () => {} });
    const r = await evo2.rotate();
    expect(r.canceled).toBe(true);
    expect(r.token).toBeUndefined();
    expect(t.sealed.get(nodePath.join(DIR, 'mcp-server-token.enc'))).toBe('T'.repeat(43));
  });

  it('a start that fails leaves it off and no token behind', async () => {
    const t = build();
    t.http.createServer = () => { const s = new EventEmitter(); s.listen = () => setImmediate(() => s.emit('error', Object.assign(new Error('no way'), { code: 'EACCES' }))); return s; };
    await expect(t.evo.setEnabled(true)).rejects.toThrow(/no way/);
    expect(t.sealed.size).toBe(0);
    const st = await t.evo.status();
    expect(st.running).toBe(false);
    expect(st.hasToken).toBe(false);
    expect(st.error).toMatch(/no way/);
  });

  it('will not start if the log cannot be written', async () => {
    const t = build();
    t.fs.appendFileSync = () => { throw new Error('disk full'); };
    await expect(t.evo.setEnabled(true)).rejects.toThrow(/disk full/);
    expect(t.http.made).toHaveLength(0);
  });

  it('autostart: does nothing when it was left off', async () => {
    const t = build();
    expect(await t.evo.autostart()).toBe(false);
    expect(t.http.made).toHaveLength(0);
  });

  it('autostart: starts again, on the remembered port, only if it was left on and the token is there', async () => {
    const first = build();
    await first.evo.setEnabled(true);
    const t = build({ memory: Object.fromEntries(first.fs.files) });
    t.sealed.set(nodePath.join(DIR, 'mcp-server-token.enc'), 'T'.repeat(43));
    expect(await t.evo.autostart()).toBe(true);
    expect(t.http.made[0].listenArgs).toEqual([41000, '127.0.0.1']);
    expect(t.calls.confirm).toHaveLength(0);
  });

  it('autostart: a missing token means it does not start, and says why', async () => {
    const first = build();
    await first.evo.setEnabled(true);
    const t = build({ memory: Object.fromEntries(first.fs.files) });
    expect(await t.evo.autostart()).toBe(false);
    expect(t.http.made).toHaveLength(0);
    expect((await t.evo.status()).error).toMatch(/token/);
  });

  it('a damaged switch file means off, and it says so', async () => {
    const t = build({ memory: { [nodePath.join(DIR, 'mcp-server.json')]: '{"enabled": tru' } });
    expect((await t.evo.status()).enabled).toBe(false);
    expect(t.logs.join(' ')).toMatch(/damaged/);
  });

  it('shutdown stops the listener (Vex quitting)', async () => {
    const t = build();
    await t.evo.setEnabled(true);
    await t.evo.shutdown();
    expect(t.http.made[0].closed).toBe(true);
  });
});

describe('the channels', () => {
  it('registers three channels that take nothing but a boolean from the window', async () => {
    const handlers = new Map();
    const evo = { status: vi.fn(async () => ({ running: false })), setEnabled: vi.fn(async (on) => ({ running: on })), rotate: vi.fn(async () => ({ token: 'x' })) };
    registerEvoMcpIpc({ ipcMain: { handle: (n, f) => handlers.set(n, f) }, evo });
    expect([...handlers.keys()].sort()).toEqual(['evomcp:rotate-token', 'evomcp:set-enabled', 'evomcp:status']);
    expect(await handlers.get('evomcp:set-enabled')({}, 'yes')).toEqual({ ok: true, running: false });
    expect(await handlers.get('evomcp:set-enabled')({}, true)).toEqual({ ok: true, running: true });
    evo.status.mockRejectedValueOnce(new Error('broken'));
    expect(await handlers.get('evomcp:status')({})).toEqual({ ok: false, error: 'broken' });
  });
});
