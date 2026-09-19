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
