// src/main/agent-audit.js and src/main/agent-policy-ipc.js: the append-only audit log (redaction, rotation,
// clearing) and the channels that wrap the policy. An in-memory fs and a fake clock; no disk, no real time.
import { describe, it, expect } from 'vitest';
const { createAgentAudit, buildEntry, cleanClientName, mcpCaller, RESULTS } = require('../../src/main/agent-audit.js');
const { createAgentControl, registerAgentControlIpc } = require('../../src/main/agent-policy-ipc.js');
const { createMemFs, memAtomicWriteSync } = require('./_memfs.js');
const nodePath = require('path');
const POLICY_FILE = nodePath.join('/profile', 'agent-policy.json');

const T0 = Date.UTC(2026, 10, 7, 12, 0, 0);
const FILE = '/profile/agent-audit.jsonl';

function makeAudit(over = {}) {
  const fs = createMemFs();
  let t = T0;
  const audit = createAgentAudit({ fs, file: FILE, now: () => t, ...over });
  return { fs, audit, tick: (ms) => { t += ms; } };
}
const call = (over = {}) => ({ caller: 'mcp:Claude', tool: 'read_page_text', url: 'https://example.com/a', decision: 'allow', result: 'ok', ...over });

describe('what a line holds', () => {
  it('is exactly time, caller, tool, host, decision and result', () => {
    const { audit } = makeAudit();
    const e = audit.record(call());
    expect(e).toEqual({ t: '2026-11-07T12:00:00.000Z', caller: 'mcp:Claude', tool: 'read_page_text', host: 'example.com', decision: 'allow', result: 'ok' });
    expect(Object.keys(e)).toEqual(['t', 'caller', 'tool', 'host', 'decision', 'result']);
  });

  it('redaction: a path, a query, a token or page text in the input never reaches the file', () => {
    const { fs, audit } = makeAudit();
    audit.record(call({ url: 'https://user:hunter2@example.com/private/diary?token=SECRET123#frag' }));
    audit.record(call({ url: undefined, host: 'example.com/leaked-path?q=SECRET123' }));
    audit.record(call({ page: 'The quick brown fox SECRET123', query: 'my password SECRET123', body: 'SECRET123' }));
    const text = fs.files.get(FILE);
    for (const word of ['SECRET123', 'hunter2', 'diary', 'leaked-path', 'fox', 'frag', 'token']) expect(text.includes(word), word).toBe(false);
    const lines = text.trim().split('\n').map(l => JSON.parse(l));
    expect(lines).toHaveLength(3);
    expect(lines[0].host).toBe('example.com');
    expect(lines[1].host).toBe('');
    for (const l of lines) expect(Object.keys(l)).toEqual(['t', 'caller', 'tool', 'host', 'decision', 'result']);
  });

  it('refuses a result, decision, tool or caller that is not in the fixed sets (no free text gets in)', () => {
    const { fs, audit } = makeAudit();
    expect(() => audit.record(call({ result: 'the page said SECRET123' }))).toThrow(/result code/);
    expect(() => audit.record(call({ decision: 'maybe' }))).toThrow(/decision/);
    expect(() => audit.record(call({ tool: 'Read Page' }))).toThrow(/tool name/);
    expect(() => audit.record(call({ caller: 'someone else' }))).toThrow(/caller/);
    expect(() => audit.record(call({ caller: 'mcp:' + 'x'.repeat(60) }))).toThrow(/caller/);
    expect(fs.files.has(FILE)).toBe(false);
  });

  it('a client name is cut down to letters, digits and . _ - and 40 characters', () => {
    expect(cleanClientName('Claude Desktop 1.2')).toBe('Claude Desktop 1.2');
    expect(cleanClientName('evil\n{"x":1}<script>')).toBe('evilx1script');
    expect(cleanClientName('')).toBe('unnamed client');
    expect(cleanClientName(undefined)).toBe('unnamed client');
    expect(cleanClientName('@@@')).toBe('unnamed client');
    expect(cleanClientName('a'.repeat(100))).toHaveLength(40);
    expect(mcpCaller('Claude')).toBe('mcp:Claude');
    expect(() => buildEntry(call({ caller: mcpCaller('line\nbreak') }), T0)).not.toThrow();
  });

  it('every result code the schema allows is one the log accepts', () => {
    const { audit } = makeAudit();
    for (const result of RESULTS) expect(() => audit.record(call({ result }))).not.toThrow();
  });
});

describe('append-only, rotation, clearing', () => {
  it('appends one line per call, never rewriting what is there', () => {
    const { fs, audit, tick } = makeAudit();
    audit.record(call({ tool: 'list_tabs', url: undefined }));
    const first = fs.files.get(FILE);
    tick(1000);
    audit.record(call({ tool: 'open_url', decision: 'ask-allowed' }));
    const both = fs.files.get(FILE);
    expect(both.startsWith(first)).toBe(true);
    expect(both.trim().split('\n')).toHaveLength(2);
  });

  it('rotates to .1 past the size limit and keeps listing the newest first-in-last-out', () => {
    const { fs, audit, tick } = makeAudit({ maxBytes: 400 });
    for (let i = 0; i < 12; i++) { tick(1000); audit.record(call({ tool: 'list_tabs', url: undefined })); }
    expect(fs.files.has(FILE + '.1')).toBe(true);
    expect(Buffer.byteLength(fs.files.get(FILE))).toBeLessThan(400 + 200);
    const { entries } = audit.list(1000);
    // Both files together never hold more than the newest calls, in time order.
    const times = entries.map(e => e.t);
    expect([...times].sort()).toEqual(times);
    expect(times[times.length - 1]).toBe(new Date(T0 + 12000).toISOString());
  });

  it('the older file is replaced, not grown, at the next rotation', () => {
    const { fs, audit, tick } = makeAudit({ maxBytes: 200 });
    for (let i = 0; i < 40; i++) { tick(1000); audit.record(call({ tool: 'list_tabs', url: undefined })); }
    const total = audit.list(1000).total;
    expect(total).toBeLessThan(40);
    expect(Buffer.byteLength(fs.files.get(FILE + '.1'))).toBeLessThan(200 + 200);
  });

  it('lists the newest N, counts a cut line instead of hiding it', () => {
    const { fs, audit, tick } = makeAudit();
    for (let i = 0; i < 5; i++) { tick(1000); audit.record(call({ tool: 'list_tabs', url: undefined })); }
    fs.appendFileSync(FILE, '{"t":"2026-11-07T12:00:09.000Z","caller":"mcp:Cl\n');
    const r = audit.list(3);
    expect(r.entries.length + r.unreadable).toBe(3);
    expect(r.unreadable).toBe(1);
    expect(r.total).toBe(6);
  });

  it('clear removes both files; export returns every line', () => {
    const { fs, audit } = makeAudit({ maxBytes: 150 });
    for (let i = 0; i < 6; i++) audit.record(call({ tool: 'list_tabs', url: undefined }));
    expect(audit.exportText().trim().split('\n').length).toBe(audit.list(1000).total);
    audit.clear();
    expect(fs.files.has(FILE)).toBe(false);
    expect(fs.files.has(FILE + '.1')).toBe(false);
    expect(audit.list(10)).toEqual({ entries: [], unreadable: 0, total: 0 });
  });

  it('assertWritable throws when the log cannot be written, so a call is not run unlogged', () => {
    const fs = createMemFs();
    fs.appendFileSync = () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); };
    const audit = createAgentAudit({ fs, file: FILE, now: () => T0 });
    expect(() => audit.assertWritable()).toThrow(/disk full/);
    expect(() => audit.record(call())).toThrow(/disk full/);
  });
});

describe('the policy service and its channels', () => {
  function make({ policyText, isPrivate = false } = {}) {
    const fs = createMemFs(policyText === undefined ? {} : { [POLICY_FILE]: policyText });
    const logs = [];
    const control = createAgentControl({ fs, dir: '/profile', now: () => T0, atomicWriteSync: memAtomicWriteSync, log: (m) => logs.push(m), offsetMinutes: 0 });
    const handlers = new Map();
    const ipcMain = { handle: (name, fn) => handlers.set(name, fn) };
    const exported = [];
    registerAgentControlIpc({ ipcMain, control, isPrivate: () => isPrivate, chooseExportFile: async () => '/out/log.txt', writeFile: async (f, t) => { exported.push([f, t]); } });
    const invoke = (name, ...args) => handlers.get(name)({ sender: {} }, ...args);
    return { fs, control, handlers, invoke, logs, exported };
  }

  it('registers exactly the seven channels', () => {
    const { handlers } = make();
    expect([...handlers.keys()].sort()).toEqual(['agentaudit:clear', 'agentaudit:export', 'agentaudit:list', 'agentaudit:record', 'agentpolicy:check', 'agentpolicy:get', 'agentpolicy:set']);
  });

  it('starts from the default policy and saves a changed one (cleaned) to the profile', async () => {
    const { invoke, fs } = make();
    const got = await invoke('agentpolicy:get');
    expect(got.ok).toBe(true);
    expect(got.policy.tools.mcp.open_url).toBe('ask');
    const saved = await invoke('agentpolicy:set', { tools: { mcp: { open_url: 'allow', list_tabs: 'deny' }, agent: { click: 'ask' } }, denyHosts: ['Bank.example'], budget: { mcp: 5 } });
    expect(saved.ok).toBe(true);
    expect(saved.policy.tools.mcp.open_url).toBe('ask');
    expect(saved.policy.denyHosts).toEqual(['bank.example']);
    expect(JSON.parse(fs.files.get(POLICY_FILE)).tools.mcp.list_tabs).toBe('deny');
  });

  it('a damaged policy file gives the default policy and says so, never a looser one', async () => {
    const { invoke, logs } = make({ policyText: '{"tools": {"mcp": {"open_url": "allow"' });
    const got = await invoke('agentpolicy:get');
    expect(got.policy.tools.mcp.open_url).toBe('ask');
    expect(logs.join(' ')).toMatch(/damaged/);
  });

  it('check answers for the in-app agent, counts it, and writes a denied call to the log with a code', async () => {
    const { invoke, control } = make();
    await invoke('agentpolicy:set', { tools: { mcp: {}, agent: { download_file: 'deny' } }, denyHosts: ['blocked.example'], budget: { agent: 2 } });
    expect(await invoke('agentpolicy:check', { tool: 'navigate', url: 'https://example.com/x' })).toEqual({ ok: true, decision: 'allow', reason: 'tool-allow' });
    expect((await invoke('agentpolicy:check', { tool: 'download_file', url: 'https://example.com/f.zip' })).decision).toBe('deny');
    expect((await invoke('agentpolicy:check', { tool: 'navigate', url: 'https://www.blocked.example/' })).reason).toBe('host-denied');
    const lines = control.audit.list(10).entries;
    expect(lines.map(l => [l.caller, l.tool, l.host, l.decision, l.result])).toEqual([
      ['in-app agent', 'download_file', 'example.com', 'deny', 'denied-policy'],
      ['in-app agent', 'navigate', 'www.blocked.example', 'deny', 'denied-host'],
    ]);
    // Two allowed-or-asked checks used up the budget of 2 (the denied ones did not count).
    expect(await invoke('agentpolicy:check', { tool: 'navigate', url: 'https://example.com/' })).toMatchObject({ decision: 'allow' });
    expect(await invoke('agentpolicy:check', { tool: 'navigate', url: 'https://example.com/' })).toMatchObject({ decision: 'deny', reason: 'budget' });
  });

  it('a call from a private window is checked but never written to the log', async () => {
    const { invoke, control } = make({ isPrivate: true });
    await invoke('agentpolicy:set', { tools: { mcp: {}, agent: { click: 'deny' } }, denyHosts: [], budget: {} });
    expect((await invoke('agentpolicy:check', { tool: 'click', url: 'https://example.com/' })).decision).toBe('deny');
    const rec = await invoke('agentaudit:record', { tool: 'navigate', url: 'https://example.com/', decision: 'allow', result: 'ok' });
    expect(rec.ok).toBe(false);
    expect(control.audit.list(10).total).toBe(0);
  });

  it('record writes the agent caller only; a window cannot choose the caller', async () => {
    const { invoke, control } = make();
    const r = await invoke('agentaudit:record', { tool: 'navigate', url: 'https://example.com/p?q=1', decision: 'ask-allowed', result: 'ok', caller: 'mcp:Claude' });
    expect(r.ok).toBe(true);
    expect(control.audit.list(5).entries[0]).toMatchObject({ caller: 'in-app agent', host: 'example.com', decision: 'ask-allowed', result: 'ok' });
  });

  it('a bad check request fails closed (an error, never an allow)', async () => {
    const { invoke } = make();
    const r = await invoke('agentpolicy:check', { tool: 'Not A Tool' });
    expect(r.ok).toBe(false);
    expect(r.decision).toBeUndefined();
  });

  it('list, export and clear work on the same log', async () => {
    const { invoke, exported } = make();
    await invoke('agentaudit:record', { tool: 'navigate', decision: 'allow', result: 'ok' });
    expect((await invoke('agentaudit:list', 50)).entries).toHaveLength(1);
    expect(await invoke('agentaudit:export')).toEqual({ ok: true, canceled: false, file: '/out/log.txt' });
    expect(exported[0][1]).toContain('"tool":"navigate"');
    expect((await invoke('agentaudit:clear')).ok).toBe(true);
    expect((await invoke('agentaudit:list')).total).toBe(0);
  });
});
