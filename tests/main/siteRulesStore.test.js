// A3: a damaged site-rules.json is never silently dropped: kept aside, the .bak put back if valid, otherwise
// an empty list AND a note for the owner. The notes wait for the window and are not lost on a quit.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { loadSiteRules, siteRulesNote } = require('../../src/main/site-rules-store.js');
const { createAttentionNotes } = require('../../src/main/attention-notes.js');
const { atomicWriteSync } = require('../../src/main/file-store.js');
const SiteRules = require('../../src/main/site-rules.js');

let dir, file;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-sr-')); file = path.join(dir, 'site-rules.json'); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
const load = () => loadSiteRules({ file, clean: SiteRules.clean });
const corrupts = () => fs.readdirSync(dir).filter(n => n.includes('.corrupt-'));

describe('loadSiteRules', () => {
  it('no file: no rules and nothing to tell', () => {
    const r = load();
    expect(r).toEqual({ rules: {}, outcome: 'missing' });
    expect(siteRulesNote(r.outcome)).toBeNull();
  });

  it('a good file is used as it is', () => {
    atomicWriteSync(file, JSON.stringify({ 'a.example': { cookies: 'off' } }));
    const r = load();
    expect(r.outcome).toBe('ok');
    expect(Object.keys(r.rules)).toEqual(['a.example']);
    expect(corrupts()).toEqual([]);
  });

  it('a cut file with a good .bak: the damaged one is kept, the backup is put back, the owner is told', () => {
    atomicWriteSync(file, JSON.stringify({ 'a.example': { cookies: 'off' } }));
    atomicWriteSync(file, JSON.stringify({ 'a.example': { cookies: 'off' }, 'b.example': { cookies: 'off' } }));
    fs.writeFileSync(file, '{"a.exam');                         // the power went here
    const r = load();
    expect(r.outcome).toBe('restored');
    expect(Object.keys(r.rules)).toEqual(['a.example']);
    expect(fs.readFileSync(r.corruptCopy, 'utf8')).toBe('{"a.exam');
    expect(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')))).toEqual(['a.example']);   // the file is whole again
    expect(JSON.parse(fs.readFileSync(file + '.bak', 'utf8'))['a.example']).toBeDefined();   // and the backup was not overwritten by the damaged file
    expect(siteRulesNote('restored').title).toMatch(/restored/);
  });

  it('a cut file and no usable backup: starts empty, keeps the damaged file, says so, and never rewrites it', () => {
    fs.writeFileSync(file, '{"a.exam');
    const r = load();
    expect(r.outcome).toBe('lost');
    expect(r.rules).toEqual({});
    expect(fs.readFileSync(r.corruptCopy, 'utf8')).toBe('{"a.exam');
    expect(fs.readFileSync(file, 'utf8')).toBe('{"a.exam');
    expect(siteRulesNote('lost').title).toMatch(/could not be read/);
  });

  it('an empty (zero-byte) file counts as damaged, not as "no rules"', () => {
    fs.writeFileSync(file, '');
    expect(load().outcome).toBe('lost');
    expect(corrupts().length).toBe(1);
  });

  it('a file that parses but is not rules is treated as damaged when clean() refuses it', () => {
    fs.writeFileSync(file, '{"a":1}');
    const r = loadSiteRules({ file, clean: () => { throw new Error('not rules'); } });
    expect(r.outcome).toBe('lost');
    expect(r.corruptCopy && fs.existsSync(r.corruptCopy)).toBe(true);
  });
});

describe('attention notes', () => {
  const quiet = { warn() {}, error: vi.fn() };
  const mk = (send, f = path.join(dir, 'notes.json')) => createAttentionNotes({ file: f, send, log: quiet });

  it('waits for the window, sends once, and clears', () => {
    const sent = [];
    const n = mk((rows) => { sent.push(rows); return true; });
    n.post({ feature: 'site-rules', id: 'lost', title: 'T', body: 'B' });
    expect(sent).toEqual([]);
    expect(n.markReady()).toBe(1);
    expect(sent[0][0]).toMatchObject({ feature: 'site-rules', title: 'T' });
    expect(n.markReady()).toBe(0);
    n.post({ feature: 'site-rules', id: 'x', title: 'T2' });
    expect(sent).toHaveLength(2);
  });

  it('a note survives a quit before the window was ready (kept in a file)', () => {
    const first = mk(() => true);
    first.post({ feature: 'f', id: '1', title: 'T' });
    const second = mk(() => true);
    expect(second.waiting().map(r => r.title)).toEqual(['T']);
  });

  it('a window that refuses or throws keeps the note for the next try', () => {
    let mode = 'throw';
    const n = mk(() => { if (mode === 'throw') throw new Error('gone'); return mode === 'ok'; });
    n.markReady();
    n.post({ feature: 'f', id: '1', title: 'T' });
    expect(n.waiting()).toHaveLength(1);
    mode = 'no';
    expect(n.deliver()).toBe(0);
    mode = 'ok';
    expect(n.deliver()).toBe(1);
    expect(n.waiting()).toHaveLength(0);
  });

  it('the same feature and id replace each other, and a note needs a title', () => {
    const n = mk(() => true);
    n.post({ feature: 'f', id: '1', title: 'old' });
    n.post({ feature: 'f', id: '1', title: 'new' });
    expect(n.waiting().map(r => r.title)).toEqual(['new']);
    expect(() => n.post({ feature: 'f', title: '' })).toThrow(/title/);
  });
});
