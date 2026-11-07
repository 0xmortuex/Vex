// src/main/agent-policy.js: the one rulebook the in-app agent and an outside MCP client are held to.
// Pure logic; no files, no real clock.
import { describe, it, expect } from 'vitest';
const P = require('../../src/main/agent-policy.js');

describe('parseHost', () => {
  it.each([
    ['example.com', 'example.com'],
    ['  Example.COM ', 'example.com'],
    ['*.example.com', 'example.com'],
    ['www.example.com', 'example.com'],
    ['https://sub.example.com/a/b?q=1', 'sub.example.com'],
    ['example.com.', 'example.com'],
  ])('%s -> %s', (input, expected) => { expect(P.parseHost(input)).toBe(expected); });

  it.each(['', '   ', 'not a host', 'a b.com', 'exa_mple.com', '-bad.com', 'http://', '..', null, undefined])('rejects %j', (input) => {
    expect(P.parseHost(input)).toBeNull();
  });
});

describe('hostMatches', () => {
  const list = ['example.com'];
  it('covers the host and its sub-domains', () => {
    expect(P.hostMatches(list, 'example.com')).toBe(true);
    expect(P.hostMatches(list, 'www.example.com')).toBe(true);
    expect(P.hostMatches(list, 'a.b.example.com')).toBe(true);
    expect(P.hostMatches(list, 'EXAMPLE.com.')).toBe(true);
  });
  it('never covers a look-alike', () => {
    expect(P.hostMatches(list, 'badexample.com')).toBe(false);
    expect(P.hostMatches(list, 'example.com.evil.com')).toBe(false);
    expect(P.hostMatches(list, 'example.org')).toBe(false);
  });
  it('an empty host matches nothing', () => {
    expect(P.hostMatches(list, '')).toBe(false);
    expect(P.hostMatches([], 'example.com')).toBe(false);
  });
});

describe('normalizePolicy', () => {
  it('garbage becomes the default policy', () => {
    for (const junk of [null, undefined, 5, 'x', [], { tools: 5, denyHosts: 'a', budget: [] }]) {
      expect(P.normalizePolicy(junk)).toEqual(P.defaultPolicy());
    }
  });
  it('the default policy is the most restrictive: open_url asks, an outside client has a daily limit', () => {
    const d = P.defaultPolicy();
    expect(d.tools.mcp).toEqual({ list_tabs: 'allow', read_page_text: 'allow', open_url: 'ask', search_history: 'allow' });
    expect(d.budget.mcp).toBe(200);
    expect(d.denyHosts).toEqual([]);
  });
  it('open_url can never be allow, whatever the saved file says', () => {
    const p = P.normalizePolicy({ tools: { mcp: { open_url: 'allow' } } });
    expect(p.tools.mcp.open_url).toBe('ask');
    expect(P.normalizePolicy({ tools: { mcp: { open_url: 'deny' } } }).tools.mcp.open_url).toBe('deny');
  });
  it('drops an MCP tool Vex does not offer and a decision that is not one', () => {
    const p = P.normalizePolicy({ tools: { mcp: { type_text: 'allow', list_tabs: 'maybe', read_page_text: 'deny' } } });
    expect(p.tools.mcp).toEqual({ list_tabs: 'allow', read_page_text: 'deny', open_url: 'ask', search_history: 'allow' });
  });
  it('keeps valid in-app agent rules and drops malformed ones', () => {
    const p = P.normalizePolicy({ tools: { agent: { click: 'ask', 'Bad Name': 'deny', type_text: 'nope', download_file: 'deny' } } });
    expect(p.tools.agent).toEqual({ click: 'ask', download_file: 'deny' });
  });
  it('cleans, sorts and de-duplicates the blocked sites', () => {
    const p = P.normalizePolicy({ denyHosts: ['B.com', 'https://a.com/x', 'a.com', 'not a host', {}, '*.b.com'] });
    expect(p.denyHosts).toEqual(['a.com', 'b.com']);
  });
  it('a budget must be a whole number from 0 up; anything else keeps the default', () => {
    expect(P.normalizePolicy({ budget: { mcp: 10, agent: 3 } }).budget).toEqual({ mcp: 10, agent: 3 });
    expect(P.normalizePolicy({ budget: { mcp: -1, agent: 1.5 } }).budget).toEqual({ mcp: 200, agent: 0 });
    expect(P.normalizePolicy({ budget: { mcp: 'many' } }).budget.mcp).toBe(200);
    expect(P.normalizePolicy({ budget: { mcp: 100001 } }).budget.mcp).toBe(200);
  });
});

describe('decide: the allow / ask / deny table', () => {
  const policy = P.defaultPolicy();
  const d = (over) => P.decide(policy, { caller: 'mcp', tool: 'list_tabs', host: '', used: 0, ...over });

  it('the three read tools are allowed, open_url asks', () => {
    expect(d({ tool: 'list_tabs' })).toEqual({ decision: 'allow', reason: 'tool-allow' });
    expect(d({ tool: 'read_page_text', host: 'example.com' }).decision).toBe('allow');
    expect(d({ tool: 'search_history' }).decision).toBe('allow');
    expect(d({ tool: 'open_url', host: 'example.com' })).toEqual({ decision: 'ask', reason: 'tool-ask' });
  });
  it('an MCP tool Vex does not offer is denied, including anything that would type, click or read secrets', () => {
    for (const tool of ['type_text', 'click', 'read_cookies', 'read_vault', 'read_clipboard', 'download_file', 'read_file', 'constructor', '__proto__', 'toString']) {
      expect(d({ tool }), tool).toEqual({ decision: 'deny', reason: 'unknown-tool' });
    }
  });
  it('a badly formed tool name or an unknown caller is denied', () => {
    expect(d({ tool: 'List Tabs' }).decision).toBe('deny');
    expect(d({ tool: 5 }).decision).toBe('deny');
    expect(d({ caller: 'someone' })).toEqual({ decision: 'deny', reason: 'unknown-caller' });
    expect(d({ caller: undefined }).decision).toBe('deny');
  });
  it('a blocked site is denied for every tool and caller, sub-domains included, before anything else', () => {
    const blocked = P.normalizePolicy({ denyHosts: ['bank.example'], tools: { mcp: { read_page_text: 'allow' } } });
    expect(P.decide(blocked, { caller: 'mcp', tool: 'read_page_text', host: 'www.bank.example' })).toEqual({ decision: 'deny', reason: 'host-denied' });
    expect(P.decide(blocked, { caller: 'mcp', tool: 'open_url', host: 'bank.example' }).reason).toBe('host-denied');
    expect(P.decide(blocked, { caller: 'agent', tool: 'navigate', host: 'a.bank.example' }).reason).toBe('host-denied');
    expect(P.decide(blocked, { caller: 'agent', tool: 'navigate', host: 'bank.example.org' }).decision).toBe('allow');
  });
  it('a tool set to block is denied; set to ask it asks', () => {
    const p = P.normalizePolicy({ tools: { mcp: { search_history: 'deny', read_page_text: 'ask' } } });
    expect(P.decide(p, { caller: 'mcp', tool: 'search_history' })).toEqual({ decision: 'deny', reason: 'tool-denied' });
    expect(P.decide(p, { caller: 'mcp', tool: 'read_page_text' }).decision).toBe('ask');
  });
  it('the daily budget: the last allowed call is number limit, the next is denied', () => {
    const p = P.normalizePolicy({ budget: { mcp: 3 } });
    expect(P.decide(p, { caller: 'mcp', tool: 'list_tabs', used: 2 }).decision).toBe('allow');
    expect(P.decide(p, { caller: 'mcp', tool: 'list_tabs', used: 3 })).toEqual({ decision: 'deny', reason: 'budget' });
    expect(P.decide(p, { caller: 'mcp', tool: 'list_tabs', used: NaN }).decision).toBe('deny');
    expect(P.decide(p, { caller: 'mcp', tool: 'list_tabs', used: -1 }).decision).toBe('deny');
  });
  it('a budget of 0 is no limit', () => {
    const p = P.normalizePolicy({ budget: { mcp: 0 } });
    expect(P.decide(p, { caller: 'mcp', tool: 'list_tabs', used: 999999 }).decision).toBe('allow');
  });
  it('the in-app agent keeps working as before until a rule says otherwise', () => {
    expect(P.decide(policy, { caller: 'agent', tool: 'navigate', host: 'example.com', used: 5000 }).decision).toBe('allow');
    expect(P.decide(policy, { caller: 'agent', tool: 'any_new_tool' }).decision).toBe('allow');
    const strict = P.normalizePolicy({ tools: { agent: { download_file: 'deny', click: 'ask' } } });
    expect(P.decide(strict, { caller: 'agent', tool: 'download_file' }).decision).toBe('deny');
    expect(P.decide(strict, { caller: 'agent', tool: 'click' }).decision).toBe('ask');
    expect(P.decide(strict, { caller: 'agent', tool: 'navigate' }).decision).toBe('allow');
  });
  it('a corrupt policy passed straight in is treated as the default, never as a looser one', () => {
    expect(P.decide({ tools: { mcp: { open_url: 'allow' } } }, { caller: 'mcp', tool: 'open_url' }).decision).toBe('ask');
    expect(P.decide('garbage', { caller: 'mcp', tool: 'type_text' }).decision).toBe('deny');
  });
});

describe('the daily budget counter (fake clock)', () => {
  const T0 = Date.UTC(2026, 10, 7, 12, 0, 0);
  it('counts per caller and starts again the next day', () => {
    let t = T0;
    const b = P.createBudget({ now: () => t, offsetMinutes: 0 });
    expect(b.used('mcp')).toBe(0);
    b.take('mcp'); b.take('mcp'); b.take('agent');
    expect(b.used('mcp')).toBe(2);
    expect(b.used('agent')).toBe(1);
    t = T0 + 3 * 3600 * 1000;           // still the same day (15:00)
    expect(b.used('mcp')).toBe(2);
    t = T0 + 13 * 3600 * 1000;          // 01:00 the next day
    expect(b.used('mcp')).toBe(0);
    expect(b.used('agent')).toBe(0);
  });
  it('an unknown caller is never counted', () => {
    const b = P.createBudget({ now: () => T0, offsetMinutes: 0 });
    b.take('nobody');
    expect(b.used('nobody')).toBe(0);
  });
  it('dayKey follows the time zone offset it is given', () => {
    const late = Date.UTC(2026, 10, 7, 23, 30, 0);
    expect(P.dayKey(late, 0)).not.toBe(P.dayKey(late, -120));   // 02:30 the next day in UTC+2
    expect(P.dayKey(late, 0)).toBe(P.dayKey(late - 1000, 0));
  });
});
