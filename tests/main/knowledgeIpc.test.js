// src/main/knowledge-ipc.js: the kb:* channels end to end on a temp folder, and
// their contracts (payload schemas, UI-only, unavailable in a private window).
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { register } = require('../../src/main/knowledge-ipc.js');
const { validate } = require('../../src/main/ipc-schemas.js');
const policy = require('../../src/main/ipc-policy.js');

function harness({ recall = {}, archive = null, archiveDir = '', isHeld = () => '', embedder = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-kb-'));
  const handlers = new Map();
  const ipcMain = { handle: (c, fn) => handlers.set(c, fn) };
  const log = { error: vi.fn() };
  const api = register({
    ipcMain, userData: dir, fs, log, isHeld, embedder, archive, archiveDir,
    atomicWrite: async (file, bytes) => { await fs.promises.writeFile(file, bytes); },
    recallGet: (url) => recall[url] || null,
  });
  const call = (channel, ...args) => handlers.get(channel)({}, ...args);
  return { dir, api, call, handlers, log };
}

describe('kb channels', () => {
  it('registers exactly the channels the preload and schemas name', () => {
    const { handlers } = harness();
    const preload = fs.readFileSync('src/preload.js', 'utf8');
    const used = [...preload.matchAll(/ipcRenderer\.invoke\('(kb:[^']+)'/g)].map(m => m[1]).sort();
    expect([...handlers.keys()].sort()).toEqual(used);
  });

  it('plans, takes items, searches, and forgets', async () => {
    const h = harness();
    const entries = [{ id: 'note:1', kind: 'note', h: 'h1' }, { id: 'bookmark:2', kind: 'bookmark', h: 'h2' }];
    const plan = await h.call('kb:plan', entries, ['note', 'bookmark']);
    expect(plan.need.sort()).toEqual(['bookmark:2', 'note:1']);
    const put = await h.call('kb:put', [
      { id: 'note:1', kind: 'note', title: 'Sourdough', text: 'The starter needs feeding daily and the loaf rose.', at: Date.now(), h: 'h1' },
      { id: 'bookmark:2', kind: 'bookmark', title: 'GPU', url: 'https://example.com/gpu', text: '', at: Date.now(), h: 'h2' },
      { id: 'bookmark:3', kind: 'bookmark', title: 'Secret', url: 'https://example.com/x', text: 'private tab page', partition: 'private-77', h: 'h3' },
    ]);
    expect(put.accepted).toBe(2);
    expect(put.refused).toEqual([{ id: 'bookmark:3', reason: expect.stringMatching(/private/) }]);
    expect((await h.call('kb:plan', entries, ['note', 'bookmark'])).need).toEqual([]);
    const res = await h.call('kb:search', 'how often do I feed the starter');
    expect(res.hits[0].id).toBe('note:1');
    expect(res.mode).toBe('keywords');
    const st = await h.call('kb:status', {});
    expect(st.items).toBe(2);
    expect(st.state).toBe('keywords');
    await h.api.flush();
    expect(JSON.parse(fs.readFileSync(path.join(h.dir, 'knowledge.json'), 'utf8')).items).toHaveLength(2);
    // A deleted note leaves with the next plan.
    const gone = await h.call('kb:plan', [entries[1]], ['note', 'bookmark']);
    expect(gone.removed).toBe(1);
    expect((await h.call('kb:search', 'starter')).hits).toHaveLength(0);
    await h.call('kb:forget');
    expect((await h.call('kb:status', {})).items).toBe(0);
  });

  it('uses what Recall already read for a bookmark with no text of its own', async () => {
    const h = harness({ recall: { 'https://example.com/gpu': { text: 'Graphics driver update notes: the nvidia driver fixes vram leaks. '.repeat(3) } } });
    await h.call('kb:put', [{ id: 'bookmark:2', kind: 'bookmark', title: 'Release notes', url: 'https://example.com/gpu', text: '', at: Date.now() }]);
    expect((await h.call('kb:search', 'vram leaks')).hits[0].id).toBe('bookmark:2');
  });

  it('keeps an item out, and lets it back in', async () => {
    const h = harness();
    const it = { id: 'note:1', kind: 'note', title: 'Diary', text: 'private thoughts about the move', at: Date.now() };
    await h.call('kb:put', [it]);
    await h.call('kb:keep-out', 'note:1', true);
    expect((await h.call('kb:search', 'thoughts')).hits).toHaveLength(0);
    expect((await h.call('kb:put', [it])).refused).toHaveLength(1);
    await h.call('kb:forget');
    expect((await h.call('kb:put', [it])).refused).toHaveLength(1);   // survives Forget
    expect((await h.call('kb:keep-out-clear')).released).toBe(1);
    expect((await h.call('kb:put', [it])).accepted).toBe(1);
  });

  it('indexes archived pages from main, a few at a time', async () => {
    const adir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-kb-arch-'));
    fs.writeFileSync(path.join(adir, 'aaaaaaaaaaaaaaaa.txt'), 'A saved article about sourdough starters and feeding schedules.');
    const archive = { list: async () => [{ id: 'aaaaaaaaaaaaaaaa', url: 'https://bread.example/a', title: 'Starter guide', at: 1000, bytes: 10 }, { id: 'bbbbbbbbbbbbbbbb', url: 'https://bank.example/accounts', title: 'x', at: 1, bytes: 1 }] };
    const h = harness({ archive, archiveDir: adir });
    const r = await h.call('kb:sync-archive', {});
    expect(r.accepted).toBe(1);                 // the bank page is refused by rule
    expect((await h.call('kb:search', 'feeding schedules')).hits[0].kind).toBe('archive');
  });

  it('says a plain sentence instead of throwing when Ollama is down', async () => {
    const embedder = { installed: async () => { throw new Error('Ollama is not running. Start Ollama to build the meaning index.'); }, embed: vi.fn() };
    const h = harness({ embedder });
    await h.call('kb:put', [{ id: 'note:1', kind: 'note', title: 'Bread', text: 'sourdough starter and yeast baking', at: Date.now() }]);
    const step = await h.call('kb:step', { model: 'nomic-embed-text' });
    expect(step.ok).toBe(false);
    expect(step.state).toBe('ollama-down');
    const search = await h.call('kb:search', 'starter', { model: 'nomic-embed-text' });
    expect(search.hits[0].id).toBe('note:1');
    expect(embedder.embed).not.toHaveBeenCalled();
  });

  it('waits in Game mode', async () => {
    const embedder = { installed: async () => ['nomic-embed-text:latest'], embed: vi.fn(async () => [1, 0, 0]) };
    const h = harness({ embedder, isHeld: () => 'a game is running' });
    await h.call('kb:put', [{ id: 'note:1', kind: 'note', title: 'Bread', text: 'sourdough starter and yeast baking', at: Date.now() }]);
    const step = await h.call('kb:step', { model: 'nomic-embed-text' });
    expect(step.state).toBe('held');
    expect(embedder.embed).not.toHaveBeenCalled();
    expect((await h.call('kb:step', { model: 'nomic-embed-text', manual: true })).embedded).toBe(1);
  });

  it('rebuilds from a damaged file instead of failing', async () => {
    const h = harness();
    fs.writeFileSync(path.join(h.dir, 'knowledge.json'), '{not json');
    const st = await h.call('kb:status', {});
    expect(st.items).toBe(0);
    expect(h.log.error).toHaveBeenCalled();
  });
});

describe('contracts', () => {
  it('validates payloads', () => {
    expect(() => validate('kb:plan', [[{ id: 'note:1', kind: 'note', h: 'a' }], ['note']])).not.toThrow();
    expect(() => validate('kb:plan', [[{ id: 'x', kind: 'clipboard', h: 'a' }]])).toThrow();
    expect(() => validate('kb:put', [[{ id: 'note:1', kind: 'note', title: 'T', text: 'x', at: 1 }], { excluded: ['a.example'] }])).not.toThrow();
    expect(() => validate('kb:put', [[{ id: 'note:1', kind: 'note', text: 5 }]])).toThrow();
    expect(() => validate('kb:search', ['what did I read', { limit: 10, since: 0, model: 'nomic-embed-text' }])).not.toThrow();
    expect(() => validate('kb:search', [{}])).toThrow();
    expect(() => validate('kb:forget', ['extra'])).toThrow();
    expect(() => validate('kb:keep-out', ['note:1', true])).not.toThrow();
  });
  it('is UI-only and unavailable in a private window', () => {
    for (const c of ['kb:plan', 'kb:put', 'kb:sync-archive', 'kb:status', 'kb:step', 'kb:search', 'kb:context', 'kb:related', 'kb:related-page', 'kb:keep-out', 'kb:keep-out-clear', 'kb:forget']) {
      expect(policy.UI_ONLY_CHANNELS.has(c), c).toBe(true);
    }
    const src = fs.readFileSync('src/main/ipc-policy.js', 'utf8');
    const m = src.match(/const PRIVATE_DISABLED = (\/.*\/);/);
    expect(m).toBeTruthy();
    const re = eval(m[1]);
    expect(re.test('kb:search')).toBe(true);
    expect(re.test('kb:put')).toBe(true);
  });
});
