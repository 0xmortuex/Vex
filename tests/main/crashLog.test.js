// src/main/crash-log.js — crashes kept past the launch they happened in, so
// the crash that made you restart Vex is still in Health afterwards.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCrashLog, KEEP, WEEK_MS } = require('../../src/main/crash-log.js');

let dir, clock;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-crash-')); clock = 1_700_000_000_000; });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
const log = (version = '2.32.37') => createCrashLog({ dir, fs, version, now: () => clock });

describe('the crash log', () => {
  it('keeps a crash for the next launch, with the version it happened under', () => {
    log('2.32.36').add('page crashed', 'https://x.example — oom (exit 5)');
    clock += 60000;
    expect(log().recent()).toEqual([{ at: 1_700_000_000_000, kind: 'page crashed', detail: 'https://x.example — oom (exit 5)', version: '2.32.36' }]);
  });

  it('shows the last week, and keeps at most the newest ' + KEEP, () => {
    const l = log();
    l.add('page hung', 'old');
    clock += WEEK_MS + 1;
    l.add('page hung', 'new');
    expect(l.recent().map(e => e.detail)).toEqual(['new']);
    for (let i = 0; i < KEEP + 20; i++) l.add('page hung', 'n' + i);
    expect(l.all()).toHaveLength(KEEP);
    expect(l.all().at(-1).detail).toBe('n' + (KEEP + 19));
  });

  it('starts again from an unreadable file rather than failing', () => {
    fs.writeFileSync(path.join(dir, 'crash-log.json'), '{not json');
    expect(log().recent()).toEqual([]);
    expect(log().add('page crashed', 'x')).toBe(true);
    expect(log().all()).toHaveLength(1);
  });
});

describe('whose crash it was (scope)', () => {
  const { scopeOf, SCOPES } = require('../../src/main/crash-log.js');
  it('is kept on the entry when given, and left off when not (old callers are unchanged)', () => {
    const l = log();
    l.add('page hung', 'https://discord.com', 'site');
    l.add('helper process gone', 'GPU — crashed (exit 1)');
    expect(l.all()[0].scope).toBe('site');
    expect('scope' in l.all()[1]).toBe(false);
  });
  it('refuses a scope it does not know instead of storing it', () => {
    expect(() => log().add('page hung', 'x', 'nonsense')).toThrow(/vex, site or extension/);
    expect(SCOPES).toEqual(['vex', 'site', 'extension']);
  });
  it.each([
    [{ type: 'window', url: 'file:///C:/app/index.html' }, 'vex'],
    [{ type: 'window', url: '' }, 'vex'],
    [{ type: 'webview', url: 'https://discord.com/app' }, 'site'],
    [{ type: 'webview', url: '' }, 'site'],
    [{ type: 'window', url: 'https://example.com/' }, 'site'],
    [{ type: 'backgroundPage', url: '' }, 'extension'],
    [{ type: 'backgroundPage', url: 'chrome-extension://abc/background.html' }, 'extension'],
    [{ type: 'window', url: 'chrome-extension://abc/popup.html' }, 'extension'],
    [undefined, 'vex'],
  ])('scopeOf %j -> %s', (input, want) => { expect(scopeOf(input)).toBe(want); });
});

describe('a crash repeating in a loop is one entry with a count', () => {
  const { DEDUPE_MS } = require('../../src/main/crash-log.js');
  it('collapses identical crashes inside the window and counts them', () => {
    const l = log();
    for (let i = 0; i < 23; i++) { l.add('helper process gone', 'Utility Video Capture — crashed (exit -1073741205)'); clock += 60; }
    const all = l.all();
    expect(all).toHaveLength(1);
    expect(all[0].count).toBe(23);
    expect(all[0].at).toBe(1_700_000_000_000);
    expect(all[0].lastAt).toBe(1_700_000_000_000 + 22 * 60);
  });
  it('leaves a single crash in the stored shape (no count field)', () => {
    const l = log();
    l.add('page hung', 'x');
    expect(l.all()[0]).toEqual({ at: 1_700_000_000_000, kind: 'page hung', detail: 'x', version: '2.32.37' });
  });
  it('starts a new entry after the window, and for a different detail, version or scope', () => {
    const l = log();
    l.add('page hung', 'x');
    clock += DEDUPE_MS + 1;
    l.add('page hung', 'x');
    l.add('page hung', 'y');
    l.add('page hung', 'y', 'site');
    log('2.99.0').add('page hung', 'y', 'site');
    expect(l.all()).toHaveLength(5);
  });
  it('collapses past an interleaved different crash, and keeps old counted entries readable', () => {
    const l = log();
    l.add('helper process gone', 'A'); clock += 10;
    l.add('page hung', 'B'); clock += 10;
    l.add('helper process gone', 'A');
    expect(l.all().map(e => [e.detail, e.count || 1])).toEqual([['A', 2], ['B', 1]]);
  });
});
