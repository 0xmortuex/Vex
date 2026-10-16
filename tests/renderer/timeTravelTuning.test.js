// @vitest-environment node
// Time travel's collector and the tuning advisor's action runner (renderer
// side), and how both are wired through IPC.
import { describe, it, expect, vi } from 'vitest';

const fs = require('fs');
const path = require('path');
const { VexTimeTravel } = require('../../src/renderer/js/time-travel.js');
const { VexTuning, tuningRunAction, TUNING_ACTION_KINDS } = require('../../src/renderer/js/tuning-advisor-ui.js');
const { hashText } = require('../../src/main/state-journal.js');
const { ACTION_KINDS } = require('../../src/main/tuning-advisor.js');
const schemas = require('../../src/main/ipc-schemas.js');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

describe('time travel collector', () => {
  const policy = { canShareTab: (t) => !t.private, isRouted: (p) => /route-/.test(p || '') };
  it('uses the same hash as main', () => {
    for (const s of ['', 'a', 'hello world', 'ünïcode ✓']) expect(VexTimeTravel.hashText(s)).toBe(hashText(s));
  });

  it('leaves out private tabs and sends note text only for notes main does not hold', () => {
    const sent = new Map([['n1', hashText('same')]]);
    const raw = VexTimeTravel.buildRaw({
      tabs: [{ id: 't1', url: 'https://a.example/', title: 'A', groupId: 'g1' }, { id: 't2', url: 'https://p.example/', private: true }],
      activeTabId: 't1', groups: [{ id: 'g1', name: 'Work' }],
      workspace: { id: 'w', name: 'Home' },
      notes: [{ id: 'n1', title: 'One', content: 'same' }, { id: 'n2', title: 'Two', content: 'fresh' }],
      reminders: [{ message: 'call', at: 123 }, { message: 'bad', at: 'x' }],
      focus: { on: true }, policy, sent,
    });
    expect(raw.tabs.map(t => t.url)).toEqual(['https://a.example/']);
    expect(raw.tabs[0]).toMatchObject({ active: true, groupName: 'Work' });
    expect('content' in raw.notes[0]).toBe(false);
    expect(raw.notes[1].content).toBe('fresh');
    expect(raw.reminders).toEqual([{ title: 'call', due: 123 }]);
  });

  it('force sends a note whose text main already holds', () => {
    const sent = new Map([['n1', hashText('x')]]);
    const raw = VexTimeTravel.buildRaw({ tabs: [], notes: [{ id: 'n1', title: 't', content: 'x' }], sent, force: ['n1'], policy });
    expect(raw.notes[0].content).toBe('x');
  });

  it('the signature ignores note text but not a change of tabs', () => {
    const a = VexTimeTravel.buildRaw({ tabs: [{ id: '1', url: 'https://a.example/' }], notes: [], policy });
    const b = VexTimeTravel.buildRaw({ tabs: [{ id: '1', url: 'https://a.example/' }, { id: '2', url: 'https://b.example/' }], notes: [], policy });
    expect(VexTimeTravel.signature(a)).not.toBe(VexTimeTravel.signature(b));
    expect(VexTimeTravel.signature(a)).toBe(VexTimeTravel.signature(a));
  });

  it('describes a diff in plain words', () => {
    const lines = VexTimeTravel.describeDiff({
      tabs: { added: [{}], removed: [{}, {}] }, notes: { added: [], removed: [], changed: [{}] },
      workspace: { from: { name: 'Work' }, to: { name: 'Home' } }, focus: { from: true, to: false },
    });
    expect(lines).toEqual([
      '2 tabs were open then and are not now', '1 tab is open now that was not then', '1 note has changed since',
      'You were in Work then.', 'Focus mode was on.',
    ]);
  });

  it('reopen opens only the tabs not open now and never closes anything', () => {
    const made = [];
    const tm = { tabs: [{ url: 'https://open.example/' }], createTab: (u, a, g, o) => { made.push([u, o.partition]); return { id: 'new' + made.length }; }, switchTab: vi.fn(), persistTabs: vi.fn() };
    const n = VexTimeTravel.reopenTabs({ tabs: [{ u: 'https://open.example/' }, { u: 'https://gone.example/', p: 1 }] }, { tabManager: tm, policy: { canRestore: () => true } });
    expect(n).toBe(1);
    expect(made).toEqual([['https://gone.example/', undefined]]);
  });
});

describe('tuning actions never run without a yes', () => {
  const env = () => {
    const e = {
      sleepTab: vi.fn(async () => true), wakeTab: vi.fn(),
      batteryModeEnabled: vi.fn(() => false), setBatteryMode: vi.fn(),
      reduceMotionOn: vi.fn(() => false), setReduceMotion: vi.fn(),
      recallEnabled: vi.fn(() => true), setRecall: vi.fn(),
    };
    return e;
  };
  const actions = [
    { kind: 'sleep-tab', tabIds: ['a', 'b'], label: 'x.example' },
    { kind: 'battery-mode-on' }, { kind: 'reduce-motion-on' }, { kind: 'recall-off', label: 'Recall' },
  ];

  it('the renderer and main agree on the closed list', () => {
    expect([...TUNING_ACTION_KINDS].sort()).toEqual([...ACTION_KINDS].sort());
  });

  for (const action of actions) {
    it('declining changes nothing: ' + action.kind, async () => {
      const e = env();
      const confirm = vi.fn(async () => false);
      const r = await tuningRunAction(action, { confirm, env: e });
      expect(r.applied).toBe(false);
      expect(confirm).toHaveBeenCalledTimes(1);
      for (const fn of ['sleepTab', 'setBatteryMode', 'setReduceMotion', 'setRecall']) expect(e[fn]).not.toHaveBeenCalled();
    });
  }

  it('accepting applies through the existing API and undo puts it back', async () => {
    const e = env();
    const confirm = async () => true;
    const sleep = await tuningRunAction(actions[0], { confirm, env: e });
    expect(e.sleepTab.mock.calls.map(c => c[0])).toEqual(['a', 'b']);
    await sleep.undo();
    expect(e.wakeTab.mock.calls.map(c => c[0])).toEqual(['a', 'b']);
    const bat = await tuningRunAction(actions[1], { confirm, env: e });
    expect(e.setBatteryMode).toHaveBeenLastCalledWith(true);
    await bat.undo();
    expect(e.setBatteryMode).toHaveBeenLastCalledWith(false);
    const rec = await tuningRunAction(actions[3], { confirm, env: e });
    expect(e.setRecall).toHaveBeenLastCalledWith(false);
    await rec.undo();
    expect(e.setRecall).toHaveBeenLastCalledWith(true);
  });

  it('only tabs that really slept are woken by the undo', async () => {
    const e = env();
    e.sleepTab = vi.fn(async (id) => id === 'a');
    const r = await tuningRunAction(actions[0], { confirm: async () => true, env: e });
    expect(r.count).toBe(1);
    await r.undo();
    expect(e.wakeTab.mock.calls.map(c => c[0])).toEqual(['a']);
  });

  it('refuses an action outside the list and a missing confirmation', async () => {
    await expect(tuningRunAction({ kind: 'kill-process', pid: 4 }, { confirm: async () => true, env: env() })).rejects.toThrow(/Unknown tuning action/);
    await expect(tuningRunAction(actions[1], { env: env() })).rejects.toThrow(/confirmation/);
  });

  it('builds metrics from a TabCost snapshot without leaking a private row', () => {
    const m = VexTuning.toMetrics({ rows: [
      { key: 's', kind: 'site', label: 'a.example', host: 'a.example', cpuPct: 2, memMB: 100, tabList: [{ id: 't', title: 'x', active: false, audible: false }] },
      { key: 'p', kind: 'private', label: 'Private and Tor tabs', cpuPct: 1, memMB: 50, tabList: [{ id: 'secret' }] },
    ] }, [{ name: 'j', runs: 1, totalMs: 5, maxMs: 5, spanMs: 100 }]);
    expect(m.rows[1].tabList).toEqual([]);
    expect(m.totals.memMB).toBe(150);
  });
});

describe('wiring', () => {
  const channels = ['journal:push', 'journal:list', 'journal:at', 'journal:diff', 'journal:note-versions', 'journal:note-version',
    'journal:stats', 'journal:configure', 'journal:forget', 'tuning:advise', 'tuning:history', 'tuning:forget'];
  it('every channel has a schema, a preload entry, a handler, a UI-only entry, and is private-window-disabled', () => {
    const preload = read('src/preload.js');
    const main = read('src/main.js');
    const policy = read('src/main/ipc-policy.js');
    for (const c of channels) {
      expect(schemas.schemas.has(c), c + ' schema').toBe(true);
      expect(preload).toContain("'" + c + "'");
      expect(main).toContain("ipcMain.handle('" + c + "'");
      expect(policy).toContain("'" + c + "'");
    }
    expect(policy).toMatch(/\|journal:\|tuning:[|)]/);   // the list continues past it as later features add theirs
  });

  it('schemas reject oversized or malformed payloads', () => {
    expect(() => schemas.validate('journal:push', [{ tabs: new Array(401).fill({}) }])).toThrow();
    expect(() => schemas.validate('journal:push', ['x'])).toThrow();
    expect(() => schemas.validate('journal:at', [-1])).toThrow();
    expect(() => schemas.validate('journal:configure', [{ retentionDays: 0 }])).toThrow();
    expect(() => schemas.validate('journal:configure', [{ retentionDays: 30, enabled: true }])).not.toThrow();
    expect(() => schemas.validate('tuning:advise', [{ rows: [], jobs: [] }])).not.toThrow();
  });

  it('the panels use VexIcons and the Vex dialogs, not emoji or native confirm', () => {
    for (const f of ['src/renderer/js/time-travel.js', 'src/renderer/js/tuning-advisor-ui.js']) {
      const s = read(f);
      expect(s).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
      expect(s).not.toMatch(/(?<!await )(?<![\w.])confirm\(|(?<![\w.])prompt\(|window\.(?:confirm|prompt)\(/);
      expect(s).toMatch(/vexConfirm/);
    }
  });
});
