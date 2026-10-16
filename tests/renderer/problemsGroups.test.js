// @vitest-environment jsdom
//
// T0-008: the quiet-problems log grouped by message, with the first and last
// version, the count and a repro stub to copy.

import { describe, it, expect, vi, beforeEach } from 'vitest';

let VexProblems;
beforeEach(async () => {
  localStorage.clear();
  delete window.__vexProblemsWired;
  vi.resetModules();
  ({ VexProblems } = await import('../../src/renderer/js/problems.js?' + Math.random()));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('grouped problems', () => {
  it('groups different details of one message into one row with the total count', () => {
    VexProblems.setVersion('1.0.0');
    VexProblems.note('Sync', 'Could not reach the server', 'HTTP 500');
    VexProblems.note('Sync', 'Could not reach the server', 'HTTP 500');
    VexProblems.note('Sync', 'Could not reach the server', 'timeout');
    VexProblems.note('AI', 'Other thing', '');
    const g = VexProblems.groups();
    expect(g).toHaveLength(2);
    const sync = g.find(x => x.area === 'Sync');
    expect(sync.count).toBe(3);
    expect(sync.details.sort()).toEqual(['HTTP 500', 'timeout']);
    expect(sync.firstVersion).toBe('1.0.0');
  });

  it('keeps the version it was first seen in while the last version moves on', () => {
    VexProblems.setVersion('1.0.0');
    VexProblems.note('Sync', 'Could not reach the server', 'x');
    VexProblems.setVersion('1.1.0');
    VexProblems.note('Sync', 'Could not reach the server', 'x');
    const [g] = VexProblems.groups();
    expect(g.firstVersion).toBe('1.0.0');
    expect(g.lastVersion).toBe('1.1.0');
    expect(g.count).toBe(2);
    expect(VexProblems.groupLine(g)).toContain('Vex 1.0.0 to 1.1.0');
  });

  it('writes a repro stub with count, versions and details', () => {
    VexProblems.setVersion('2.0.0');
    VexProblems.note('Tabs', 'Tab did not load', 'ERR_X');
    const stub = VexProblems.reproStub(VexProblems.groups()[0]);
    expect(stub).toContain('### Tabs: Tab did not load');
    expect(stub).toContain('Seen 1 time');
    expect(stub).toContain('(Vex 2.0.0)');
    expect(stub).toContain('ERR_X');
  });

  it('reads entries saved before first-seen existed', () => {
    localStorage.setItem(VexProblems.KEY, JSON.stringify([{ at: 5, area: 'A', message: 'm', detail: 'd', n: 2, v: '0.9' }]));
    const [g] = VexProblems.groups();
    expect(g).toMatchObject({ count: 2, firstVersion: '0.9', lastVersion: '0.9' });
  });
});
