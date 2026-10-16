// @vitest-environment jsdom
//
// T1-017: one next step per workspace, and the single "one next thing" card
// (js/next-step.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let N;
const NOW = new Date(2026, 9, 14, 14, 0).getTime();
const due = (text, group, label, over = {}) => ({ text, at: NOW + 3600000, hasTime: true, reason: { group, label }, ...over });

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<button id="workspace-btn"></button>';
  vi.resetModules();
  delete globalThis.WorkspaceManager; delete globalThis.FocusOS; delete globalThis.VexDueness;
  ({ VexNextStep: N } = fresh(JS + 'next-step.js'));
  globalThis.WorkspaceManager = { activeId: 'ws_work', getActive: () => ({ name: 'Work' }) };
});

describe('storage', () => {
  it('keeps one line per workspace, trimmed to one line', () => {
    N.set('ws_work', '  open the PR \n and fix the test ');
    expect(N.get('ws_work').text).toBe('open the PR and fix the test');
    expect(N.get('ws_dev')).toBe(null);
  });
  it('an empty line clears it, and a long one is refused', () => {
    N.set('ws_work', 'a step');
    N.set('ws_work', '   ');
    expect(N.get('ws_work')).toBe(null);
    expect(() => N.set('ws_work', 'x'.repeat(200))).toThrow(/one step/);
    expect(() => N.set('', 'x')).toThrow(/Which workspace/);
  });
  it('refuses to read a corrupt record instead of pretending it is empty', () => {
    localStorage.setItem(N.KEY, '{nope');
    expect(() => N.get('ws_work')).toThrow(/could not be read/);
  });
});

describe('pick()', () => {
  const step = { text: 'write the test' };
  it('lets an overdue item win over the next step', () => {
    expect(N.pick({ due: due('Pay rent', 0, 'Overdue 2 h'), step, now: NOW })).toMatchObject({ kind: 'due', text: 'Pay rent', why: 'Overdue 2 h' });
  });
  it('lets a timed item within 90 minutes win, but not one later today', () => {
    expect(N.pick({ due: due('Call', 1, 'Today 15:00', { at: NOW + 3600000 }), step, now: NOW }).kind).toBe('due');
    expect(N.pick({ due: due('Call', 1, 'Today 20:00', { at: NOW + 6 * 3600000 }), step, now: NOW }).kind).toBe('step');
  });
  it('shows the step when nothing presses, falls back to a due-today item, and is null with neither', () => {
    expect(N.pick({ due: null, step, now: NOW })).toMatchObject({ kind: 'step', text: 'write the test' });
    expect(N.pick({ due: due('File', 1, 'Due today', { hasTime: false }), step: null, now: NOW }).kind).toBe('due');
    expect(N.pick({ due: due('Later', 2, 'Fri'), step: null, now: NOW })).toBe(null);
    expect(N.pick({ now: NOW })).toBe(null);
  });
  it('says when a focus block ends', () => {
    const card = N.pick({ due: null, step, block: { goal: 'Ship it', end: new Date(2026, 9, 14, 16, 30).getTime() }, now: NOW });
    expect(card.block).toBe('Ship it until 16:30');
    expect(N.pick({ due: null, step, block: { goal: 'Old', end: NOW - 1 }, now: NOW }).block).toBeUndefined();
  });
});

describe('surfaces', () => {
  it('puts the active workspace step in the workspace button tooltip', () => {
    N.set('ws_work', 'fix the failing test');
    expect(document.getElementById('workspace-btn').title).toBe('Work. Next: fix the failing test');
    N.clear('ws_work');
    expect(document.getElementById('workspace-btn').hasAttribute('title')).toBe(false);
  });

  it('the brief section is a single card, and a hint when nothing is pressing', async () => {
    const sec = N.section();
    expect(sec.maxItems).toBe(1);
    const hint = await sec.build({ now: NOW });
    expect(hint.hint).toMatch(/Set my next step/);
    N.set('ws_work', 'send the invoice');
    const out = await sec.build({ now: NOW });
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ text: 'send the invoice', sub: 'Work', badge: 'Your next step' });
  });

  it('is null when switched off, and follows a workspace switch', async () => {
    N.setEnabled(false);
    expect(await N.section().build({ now: NOW })).toBe(null);
    N.setEnabled(true);
    N.set('ws_work', 'a');
    N.init();
    globalThis.WorkspaceManager.activeId = 'ws_dev';
    document.dispatchEvent(new CustomEvent('vex:workspace-switched', { detail: { id: 'ws_dev' } }));
    expect(document.getElementById('workspace-btn').hasAttribute('title')).toBe(false);
  });
});
