// @vitest-environment jsdom
//
// T2-080: js/ai-memory.js facts carry source, scope, confidence and expiry; only the
// ones that apply here and have not expired are injected; the last injection is listed.
import { describe, it, expect, beforeEach } from 'vitest';

globalThis.vexId = (p) => p + Math.random().toString(36).slice(2, 8);
const { AIMemory: M } = require('../../src/renderer/js/ai-memory.js');

const DAY = 86400000;
beforeEach(() => {
  localStorage.clear();
  delete globalThis.TabManager; delete globalThis.ProjectSpaces;
  M.data = { enabled: true, includeCloud: false, facts: [] };
  M.lastInjection = null;
});

describe('old facts', () => {
  it('read as: typed by you, everywhere, never expires, 100 percent', () => {
    localStorage.setItem('vex.aiMemory', JSON.stringify({ enabled: true, facts: [{ id: 'm1', text: 'I live in Istanbul', at: 5 }] }));
    M.init();
    const f = M.get('m1');
    expect(f.source.kind).toBe('you');
    expect(f.scope).toEqual({ kind: 'global' });
    expect(f.expires).toBeNull();
    expect(f.confidence).toBe(1);
    expect(f.text).toBe('I live in Istanbul');
  });
  it('a new default never overrides what a fact already says', () => {
    const f = M.normalize({ id: 'a', text: 't', scope: { kind: 'site', value: 'GitHub.com' }, source: { kind: 'page', label: 'Docs' }, expires: 99, confidence: 0.5 });
    expect(f.scope).toEqual({ kind: 'site', value: 'github.com' });
    expect(f.source.kind).toBe('page');
    expect(f.expires).toBe(99);
    expect(f.confidence).toBe(0.5);
  });
});

describe('what is injected', () => {
  beforeEach(() => {
    M.add('Answer concisely');
    M.add('This repo uses pnpm', { scope: { kind: 'site', value: 'github.com' } });
    M.add('Project Alpha ships in May', { scope: { kind: 'project', value: 'p1', label: 'Alpha' } });
    M.add('Old plan', { expires: Date.now() - DAY });
  });
  it('global always, site only there, project only in it, expired never', () => {
    let m = M.historyMessage('local', { host: 'github.com', projectId: '' });
    expect(m.content).toMatch(/concisely/); expect(m.content).toMatch(/pnpm/);
    expect(m.content).not.toMatch(/Alpha/); expect(m.content).not.toMatch(/Old plan/);
    m = M.historyMessage('local', { host: 'gist.github.com', projectId: 'p1' });
    expect(m.content).toMatch(/pnpm/); expect(m.content).toMatch(/Alpha/);
    m = M.historyMessage('local', { host: 'example.com', projectId: '' });
    expect(m.content).not.toMatch(/pnpm/);
    expect(m.vexMemory).toBe(true);
  });
  it('lists the facts of the last request, and which were used', () => {
    M.historyMessage('local', { host: 'example.com', projectId: '' });
    expect(M.lastInjection.facts.map(f => f.text)).toEqual(['Answer concisely']);
    expect(M.get(M.lastInjection.facts[0].id).lastUsed).toBeGreaterThan(0);
  });
  it('lastUsed is saved at most once a minute', () => {
    M.historyMessage('local', { host: 'example.com' });
    const first = M.get(M.lastInjection.facts[0].id).lastUsed;
    M.data.facts.forEach(f => { if (f.lastUsed === first) f.lastUsed = first; });
    M.historyMessage('local', { host: 'example.com' });
    expect(M.get(M.lastInjection.facts[0].id).lastUsed).toBe(first);
  });
  it('nothing goes in when memory is off or the backend is the cloud without the tick', () => {
    M.data.enabled = false;
    expect(M.historyMessage('local', { host: 'x.com' })).toBeNull();
    M.data.enabled = true;
    expect(M.historyMessage('cloud', { host: 'x.com' })).toBeNull();
  });
  it('an expired fact is kept, not deleted', () => {
    expect(M.data.facts.some(f => f.text === 'Old plan')).toBe(true);
    expect(M.describe(M.data.facts.find(f => f.text === 'Old plan'))).toMatch(/expired/);
  });
});

describe('editing', () => {
  it('changes words, scope and expiry but keeps the source', () => {
    M.add('Use tabs', { source: { kind: 'chat' } });
    const f = M.list()[0];
    M.update(f.id, { text: 'Use spaces', scope: { kind: 'site', value: 'example.com' }, expires: Date.now() + DAY });
    expect(M.get(f.id).text).toBe('Use spaces');
    expect(M.get(f.id).scope.value).toBe('example.com');
    expect(M.get(f.id).source.kind).toBe('chat');
  });
  it('refuses empty words, a scope with no value and a duplicate', () => {
    M.add('One'); M.add('Two');
    const [two, one] = M.list();
    expect(() => M.update(one.id, { text: '  ' })).toThrow(/needs some words/);
    expect(() => M.update(one.id, { scope: { kind: 'site', value: '' } })).toThrow(/needs a site/);
    expect(() => M.update(one.id, { text: 'two' })).toThrow(/already says/);
    expect(two.text).toBe('Two');
  });
  it('forgetting removes it', () => {
    M.add('Gone soon');
    M.remove(M.list()[0].id);
    expect(M.list()).toHaveLength(0);
  });
  it('plain-text saving keeps the metadata of unchanged lines', () => {
    M.add('Keep me', { scope: { kind: 'site', value: 'a.com' } });
    M.setFromText('Keep me\nNew line');
    expect(M.list().find(f => f.text === 'Keep me').scope.value).toBe('a.com');
    expect(M.list().find(f => f.text === 'New line').scope.kind).toBe('global');
  });
});
