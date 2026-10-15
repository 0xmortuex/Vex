// @vitest-environment node
//
// Telling Game Control Center which tab was busy: the writer in main uses GCC's
// own Black Box library (src/main/pcbb/pcbb.cjs, exported unchanged) in a
// throwaway folder. What is pinned: it is OFF until switched on, it never
// creates the folder, at most one line a minute, host names only, and nothing
// from a private or Tor tab beyond one anonymous total.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const pcbb = require('../../src/main/pcbb/pcbb.cjs');
const { createPcbbLink, MIN_GAP_MS } = require('../../src/main/pcbb-link.js');
const { tabCostNewState, tabCostStep, tabCostSnapshot, tabCostToEvent, tabCostLinkPayload } = require('../../src/renderer/js/tab-cost.js');

let root, dir;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-pcbb-link-')); dir = path.join(root, 'PCBlackBox'); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const linkAt = (t) => {
  const clock = { t };
  const link = createPcbbLink({ pcbb, env: { PCBB_DIR: dir }, now: () => clock.t });
  return { link, clock };
};
const line = (over = {}) => ({
  windowMs: 300000, spanMs: 240000, totalCpuSec: 60.5, cpuMeasured: true, verdict: 'notable',
  top: [{ kind: 'site', name: 'youtube.com', cpuPct: 31.4, cpuShare: 0.61, memMB: 640, tabs: 2 }],
  ...over,
});
const lines = () => fs.readdirSync(dir).filter(f => /^events-.*\.ndjson$/.test(f))
  .flatMap(f => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)));

describe('the switch and the folder', () => {
  it('writes nothing until it is switched on', () => {
    fs.mkdirSync(dir);
    const { link } = linkAt(Date.parse('2026-10-15T10:00:00Z'));
    expect(link.write(line())).toEqual({ written: false, reason: 'off' });
    expect(lines()).toHaveLength(0);
  });

  it('never creates the folder: without it, nothing is written and nothing is made', () => {
    const { link } = linkAt(Date.parse('2026-10-15T10:00:00Z'));
    link.setEnabled(true);
    expect(link.write(line())).toEqual({ written: false, reason: 'no-folder' });
    expect(fs.existsSync(dir)).toBe(false);
    expect(link.state()).toMatchObject({ enabled: true, folderFound: false });
  });

  it('writes a perf.tabcost line from vex through the library when the folder exists', () => {
    fs.mkdirSync(dir);
    const { link } = linkAt(Date.parse('2026-10-15T10:00:00Z'));
    link.setEnabled(true);
    const r = link.write(line());
    expect(r.written).toBe(true);
    const [e] = lines();
    expect(e).toMatchObject({ v: 1, src: 'vex', kind: 'perf.tabcost', t: '2026-10-15T10:00:00.000Z' });
    expect(e.data.top[0]).toMatchObject({ kind: 'site', name: 'youtube.com' });
    // the library's own reader sees it as a known kind
    expect(pcbb.queryEvents(dir, { kinds: ['perf.tabcost'] }).events).toHaveLength(1);
  });

  it('switching off stops it again', () => {
    fs.mkdirSync(dir);
    const { link } = linkAt(Date.parse('2026-10-15T10:00:00Z'));
    link.setEnabled(true);
    link.setEnabled(false);
    expect(link.write(line()).reason).toBe('off');
  });

  it('an invalid line is an explicit error, not a silent skip', () => {
    fs.mkdirSync(dir);
    const { link } = linkAt(Date.parse('2026-10-15T10:00:00Z'));
    link.setEnabled(true);
    expect(() => link.write({ verdict: 'nonsense' })).toThrow(/not written/);
    expect(() => link.write(null)).toThrow(TypeError);
  });
});

describe('rate limit', () => {
  it('at most one line a minute, whatever the caller asks', () => {
    fs.mkdirSync(dir);
    const { link, clock } = linkAt(Date.parse('2026-10-15T10:00:00Z'));
    link.setEnabled(true);
    expect(link.write(line()).written).toBe(true);
    clock.t += 5000;
    expect(link.write(line())).toEqual({ written: false, reason: 'too-soon' });
    clock.t += MIN_GAP_MS;
    expect(link.write(line()).written).toBe(true);
    expect(lines()).toHaveLength(2);
  });
});

describe('what a line can hold', () => {
  it('names hosts only and nothing of a private or Tor tab, end to end', () => {
    // One ordinary tab on a site, one private tab whose title and address are the secret.
    const st = tabCostNewState(0);
    const ctx = {
      tabs: new Map([
        [1, { id: 'a', private: false, title: 'Inbox (3) - private mail', host: 'mail.example.com', active: true }],
        [2, { id: 'b', private: true }],
        [3, { id: 'c', private: false, title: 'Secret account page', host: '' }],
      ]),
      panels: new Map(),
    };
    const frame = (cum) => ({ procs: [
      { pid: 10, type: 'Tab', cum: cum * 0.6, memKB: 1024, contents: [{ id: 1, kind: 'webview', url: 'https://mail.example.com/inbox?token=abc', title: 'Inbox', net: { bytes: 0, requests: 0, unsized: 0 } }] },
      { pid: 11, type: 'Tab', cum: cum * 0.3, memKB: 1024, contents: [{ id: 2, kind: 'webview', url: 'https://bank.example.org/account/12345', title: 'My bank', net: { bytes: 0, requests: 0, unsized: 0 } }] },
      { pid: 12, type: 'Tab', cum: cum * 0.1, memKB: 1024, contents: [{ id: 3, kind: 'webview', url: 'about:blank', title: 'Secret account page', net: { bytes: 0, requests: 0, unsized: 0 } }] },
    ], workers: [] });
    for (let i = 0; i < 6; i++) tabCostStep(st, frame(i * 5), ctx, i * 5000);
    const event = tabCostToEvent(tabCostSnapshot(st, { now: 25000 }));
    const payload = tabCostLinkPayload(event);

    fs.mkdirSync(dir);
    const { link } = linkAt(Date.parse('2026-10-15T10:00:00Z'));
    link.setEnabled(true);
    expect(link.write(payload).written).toBe(true);

    const raw = fs.readdirSync(dir).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
    for (const secret of ['bank.example.org', 'My bank', '12345', 'token=abc', 'Inbox', 'Secret account page', 'https://', 'private mail']) {
      expect(raw, secret).not.toContain(secret);
    }
    const [e] = lines();
    expect(e.data.top.find(r => r.name === 'mail.example.com')).toBeTruthy();
    const priv = e.data.top.find(r => r.kind === 'private');
    expect(priv).toBeTruthy();
    expect(priv.name).toBeUndefined();
    expect(priv.tabs).toBe(0);
    // the title-only tab is never named
    expect(e.data.top.every(r => r.kind !== 'site' || r.name === 'mail.example.com')).toBe(true);
  });
});
