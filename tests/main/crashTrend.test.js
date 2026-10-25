// @vitest-environment jsdom
//
// T0-023: crashes per version, what is new in this release, pages killed
// together, and a killed tab reloaded where it was. The fixture has the shape and
// proportions of the owner's real crash-log.json (77 entries, 2.32.73 to 2.36.2:
// helper processes gone, pages killed in bursts, "did not finish starting"),
// with invented addresses.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const path = require('path');
const { trend, family, bursts, compareVersions } = require('../../src/main/crash-log.js');
window.escapeHtml = (v) => String(v == null ? '' : v);
const { MemoryPanel } = require('../../src/renderer/js/memory-panel.js');

const E = 'https://example.test/x';
const e = (at, kind, detail, version) => ({ at, kind, detail, version });
const T0 = Date.parse('2026-10-04T18:00:00Z');
const log = [
  ...Array.from({ length: 3 }, (_, i) => e(T0 - 90 * 86400000 + i, 'helper process gone', 'Utility Video Capture — crashed (exit -1073741819)', '2.34.0')),
  e(T0 - 80 * 86400000, 'page crashed', E + ' — oom (exit 0)', '2.34.0'),
  e(T0 - 40 * 86400000, 'Vex did not finish starting', '2 launches in a row', '2.35.2'),
  e(T0 - 40 * 86400000 + 5, 'Vex did not finish starting', '2 launches in a row', '2.35.2'),
  e(T0, 'page crashed', E + '/a — killed (exit 1)', '2.36.2'),
  e(T0 + 15, 'page crashed', E + '/b — killed (exit 1)', '2.36.2'),
  e(T0 + 28, 'page crashed', E + '/c — killed (exit 1)', '2.36.2'),
];

describe('family', () => {
  it('names a helper by the helper, a page by why it went, never by its address', () => {
    expect(family(log[0])).toBe('helper: Utility Video Capture');
    expect(family(log[3])).toBe('page: oom');
    expect(family(log.at(-1))).toBe('page: killed');
    expect(family(log[4])).toBe('Vex did not finish starting');
    expect(family({ kind: 'page crashed', detail: 'no reason here' })).toBe('page: crashed');
    for (const x of log) expect(family(x)).not.toContain('example.test');
  });
});

describe('trend', () => {
  const t = trend(log, '2.36.2');
  it('groups by version, newest first, with the families and counts', () => {
    expect(t.versions.map(v => v.version)).toEqual(['2.36.2', '2.35.2', '2.34.0']);
    expect(t.versions[0]).toMatchObject({ total: 3, families: { 'page: killed': 3 } });
    expect(t.versions[2].families).toEqual({ 'helper: Utility Video Capture': 3, 'page: oom': 1 });
    expect(t.total).toBe(9);
  });
  it('says what is new in this version and what got more frequent', () => {
    expect(t.newKinds).toEqual(['page: killed']);
    const t2 = trend([...log, e(T0 + 99999, 'Vex did not finish starting', 'x', '2.36.2'), e(T0 + 99998, 'Vex did not finish starting', 'x', '2.36.2'), e(T0 + 99997, 'Vex did not finish starting', 'x', '2.36.2')], '2.36.2');
    expect(t2.rising).toEqual(['Vex did not finish starting']);   // 3 here, 2 in 2.35.2
  });
  it('a version with no entries has nothing new and does not throw', () => {
    expect(trend(log, '2.37.0')).toMatchObject({ newKinds: [], rising: [] });
    expect(trend([], '1.0.0').versions).toEqual([]);
    expect(trend(null, '1.0.0').total).toBe(0);
  });
  it('compares versions as numbers, not text', () => {
    expect(compareVersions('2.36.2', '2.9.0')).toBeGreaterThan(0);
    expect(compareVersions('2.32.86', '2.33.0')).toBeLessThan(0);
    expect(trend([e(1, 'page crashed', 'a — killed (exit 1)', '2.9.0'), e(2, 'page crashed', 'a — killed (exit 1)', '2.10.0')], '2.10.0').versions.map(v => v.version)).toEqual(['2.10.0', '2.9.0']);
  });
});

describe('bursts', () => {
  it('three or more pages killed within five seconds are one event, not three bugs', () => {
    const b = bursts(log);
    expect(b).toEqual([{ at: T0, count: 3, family: 'page: killed', version: '2.36.2' }]);
  });
  it('two crashes, or crashes far apart, are not a burst', () => {
    expect(bursts([e(0, 'page crashed', 'a — killed (exit 1)', 'v'), e(10, 'page crashed', 'a — killed (exit 1)', 'v')])).toEqual([]);
    expect(bursts([e(0, 'page crashed', 'a — killed (exit 1)', 'v'), e(10000, 'page crashed', 'a — killed (exit 1)', 'v'), e(20000, 'page crashed', 'a — killed (exit 1)', 'v')])).toEqual([]);
  });
});

describe('the Health lines', () => {
  it('show the versions, what is new and the burst, and nothing when there is no log', () => {
    const lines = MemoryPanel.crashTrendLines(trend(log, '2.36.2'));
    expect(lines[0]).toBe('Crashes by version (9 kept):');
    expect(lines[1]).toMatch(/v2\.36\.2 \(this one\) — 3: page: killed 3×/);
    expect(lines.some(l => /New in v2\.36\.2, not seen in earlier versions: page: killed/.test(l))).toBe(true);
    expect(lines.some(l => /3 pages killed within seconds/.test(l))).toBe(true);
    expect(MemoryPanel.crashTrendLines(null)).toEqual([]);
    expect(MemoryPanel.crashTrendLines({ versions: [] })).toEqual([]);
  });
  it('are part of the Health view, with the DRM line', () => {
    const lines = MemoryPanel.healthLines({ uptimeMs: 60000, marks: {}, events: [], extensionErrors: [], update: null, crashTrend: trend(log, '2.36.2'), widevine: 'Widevine ready (version 4.10)' });
    expect(lines).toContain('DRM (Widevine): Widevine ready (version 4.10)');
    expect(lines.some(l => l.startsWith('Crashes by version'))).toBe(true);
  });
});

describe('a killed tab is reloaded where it was', () => {
  const web = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/webview.js'), 'utf8');
  const snap = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/tab-snapshots.js'), 'utf8');
  it('the sampler remembers the scroll of every tab it may read', () => {
    expect(snap).toContain('tab._lastScroll = { x: cap.scroll.x, y: cap.scroll.y, url: k }');
  });
  it('recovery puts it back once, only on the same address, only if the page is still at the top', () => {
    const block = web.slice(web.indexOf("onWebview('render-process-gone'"), web.indexOf("onWebview('new-window'"));
    expect(block).toContain("{ once: true }");
    expect(block).toContain('TabSnapshots.key(real) === was.url');
    expect(block).toMatch(/scrollY\|\|0\) < 20/);
    expect(block).toContain('loadURL(this.viewerAddress(real))');
  });
});
