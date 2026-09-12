// @vitest-environment jsdom
//
// Engine behaviour: migration of v1 tasks, the fire-once claim, catch-up for
// runs missed while Vex was closed, the serialised run queue, per-run history
// and the background-tab cleanup that used to leak one tab per scheduled run.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Scheduler from '../../src/renderer/js/scheduler.js';

const DAY = 86400000;

// Let the serialised queue run to completion.
const settle = async () => {
  for (let i = 0; i < 50; i++) {
    if (!Scheduler._draining && !Scheduler._queue.length && !Scheduler._running.size) return;
    await new Promise(r => setTimeout(r, 0));
  }
  throw new Error('scheduler queue never drained');
};

let tabs;

beforeEach(() => {
  localStorage.clear();
  Scheduler._queue.length = 0;
  Scheduler._running.clear();
  Scheduler._controllers.clear();
  Scheduler._draining = false;
  window.showToast = vi.fn();
  tabs = [];
  globalThis.TabManager = {
    tabs,
    createTab: vi.fn((url) => { const t = { id: 'tab' + tabs.length, url }; tabs.push(t); return t; }),
    closeTab: vi.fn((id) => { const i = tabs.findIndex(t => t.id === id); if (i >= 0) tabs.splice(i, 1); }),
    sleepAllInactive: vi.fn(async () => { tabs.forEach((t, i) => { if (i > 0) t.sleeping = true; }); }),
  };
  globalThis.WebviewManager = { webviews: new Map() };
  globalThis.SessionManager = { saveCurrentSession: vi.fn(name => ({ id: 's1', name, tabs: [...tabs] })) };
});

afterEach(() => {
  delete globalThis.TabManager;
  delete globalThis.WebviewManager;
  delete globalThis.SessionManager;
  delete globalThis.AgentLoop;
  vi.restoreAllMocks();
});

describe('v1 task migration', () => {
  it('reads a pre-existing flat task as a v2 agent task and persists the upgrade', () => {
    localStorage.setItem('vex.schedules', JSON.stringify([{
      id: 'old1', enabled: true, name: 'Old task', frequency: 'weekly', time: '07:30',
      daysOfWeek: [1, 3], dayOfMonth: 1, customCron: '', startDate: '2026-01-01',
      prompt: 'Summarise the news', startingUrl: 'https://news.example', maxIterations: 9,
      runCount: 4, lastRunResult: 'success',
    }]));

    const [task] = Scheduler.getAllTasks();
    expect(task.v).toBe(2);
    expect(task.schedule).toMatchObject({ type: 'weekly', time: '07:30', daysOfWeek: [1, 3] });
    expect(task.action).toMatchObject({ type: 'agent', prompt: 'Summarise the news', startingUrl: 'https://news.example', maxIterations: 9 });
    expect(task.runCount).toBe(4);
    expect(task.catchUp).toBe(true);

    // The upgrade is written back, so the next read is already v2.
    expect(JSON.parse(localStorage.getItem('vex.schedules'))[0].v).toBe(2);
  });

  it('maps the old "custom" frequency onto cron', () => {
    localStorage.setItem('vex.schedules', JSON.stringify([
      { id: 'old2', enabled: true, name: 'c', frequency: 'custom', customCron: '0 9 * * 1', prompt: 'x' },
    ]));
    const [task] = Scheduler.getAllTasks();
    expect(task.schedule.type).toBe('cron');
    expect(Scheduler.nextOccurrence(task, Date.now())).toBeGreaterThan(Date.now());
  });
});

describe('the fire-once claim', () => {
  it('does not replay occurrences from before the task existed', () => {
    // The old engine had no claim at all: a "daily at 09:00" created in the
    // afternoon was immediately "6 hours overdue" and fired on the spot.
    const task = Scheduler.createTask({ name: 'Morning', schedule: { type: 'daily', time: '09:00' }, action: { type: 'reminder', message: 'hi' } });
    expect(task.lastOccurrence).not.toBeNull();
    Scheduler._checkDueTasks(Date.now());
    expect(Scheduler._queue).toHaveLength(0);
    expect(Scheduler.getHistory()).toHaveLength(0);
  });

  it('fires exactly once no matter how many polls see the same occurrence', async () => {
    const task = Scheduler.createTask({ name: 'Tick', schedule: { type: 'daily', time: '09:00' }, action: { type: 'reminder', message: 'hi' } });
    // Pretend the last claim was two days ago so today's 09:00 is owed.
    Scheduler.updateTask(task.id, { lastOccurrence: new Date(Date.now() - 2 * DAY).toISOString() });
    const now = new Date();
    now.setHours(9, 30, 0, 0);

    Scheduler._checkDueTasks(now.getTime());
    Scheduler._checkDueTasks(now.getTime() + 20000);
    Scheduler._checkDueTasks(now.getTime() + 40000);
    await settle();

    const runs = Scheduler.getHistory().filter(r => r.taskId === task.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('success');
    expect(Scheduler.getTask(task.id).runCount).toBe(1);
  });

  it('claims the occurrence before the run starts, so a crash cannot double-fire', () => {
    const task = Scheduler.createTask({ name: 'Claim', schedule: { type: 'daily', time: '09:00' }, action: { type: 'reminder', message: 'hi' } });
    Scheduler.updateTask(task.id, { lastOccurrence: new Date(Date.now() - 2 * DAY).toISOString() });
    const now = new Date();
    now.setHours(9, 30, 0, 0);

    Scheduler._checkDueTasks(now.getTime());
    // Queued but not yet executed — the claim must already be on disk.
    const stored = JSON.parse(localStorage.getItem('vex.schedules'))[0];
    const occ = new Date(stored.lastOccurrence);
    expect(occ.getHours()).toBe(9);
    expect(occ.getMinutes()).toBe(0);
    Scheduler._queue.length = 0;
  });
});

describe('catch-up for runs missed while Vex was closed', () => {
  const dailyTask = (overrides = {}) => Scheduler.createTask({
    name: 'Daily', schedule: { type: 'daily', time: '09:00' },
    action: { type: 'reminder', message: 'hi' }, ...overrides,
  });

  it('runs a recently missed occurrence as soon as the app is back', async () => {
    const task = dailyTask({ catchUpWindowMin: 720 });
    Scheduler.updateTask(task.id, { lastOccurrence: new Date(Date.now() - 3 * DAY).toISOString() });
    const now = new Date();
    now.setHours(11, 0, 0, 0);   // 2 hours after the 09:00 occurrence

    Scheduler._checkDueTasks(now.getTime());
    await settle();

    const [run] = Scheduler.getHistory();
    expect(run.status).toBe('success');
    expect(run.lateMs).toBeGreaterThan(60 * 60000);   // recorded as a late/caught-up run
  });

  it('records a too-late occurrence as skipped instead of running it or dropping it', async () => {
    const task = dailyTask({ catchUpWindowMin: 60 });
    Scheduler.updateTask(task.id, { lastOccurrence: new Date(Date.now() - 3 * DAY).toISOString() });
    const now = new Date();
    now.setHours(20, 0, 0, 0);   // 11 hours after 09:00, window is 1 hour

    Scheduler._checkDueTasks(now.getTime());
    await settle();

    const history = Scheduler.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('skipped');
    expect(history[0].error).toMatch(/Missed while Vex was closed/);
    expect(Scheduler.getTask(task.id).runCount).toBe(0);
    // And it is claimed, so it does not nag on every later poll.
    Scheduler._checkDueTasks(now.getTime() + 60000);
    await settle();
    expect(Scheduler.getHistory()).toHaveLength(1);
  });

  it('honours catch-up "skip" with only a short grace period', async () => {
    const task = dailyTask({ catchUp: false });
    Scheduler.updateTask(task.id, { lastOccurrence: new Date(Date.now() - 3 * DAY).toISOString() });
    const now = new Date();
    now.setHours(9, 0, 30, 0);   // 30s late — inside the grace window
    Scheduler._checkDueTasks(now.getTime());
    await settle();
    expect(Scheduler.getHistory()[0].status).toBe('success');

    const other = dailyTask({ catchUp: false, name: 'Strict' });
    Scheduler.updateTask(other.id, { lastOccurrence: new Date(Date.now() - 3 * DAY).toISOString() });
    const late = new Date();
    late.setHours(9, 10, 0, 0);  // 10 minutes late — outside it
    Scheduler._checkDueTasks(late.getTime());
    await settle();
    expect(Scheduler.getHistory().find(r => r.taskId === other.id).status).toBe('skipped');
  });

  it('catches up at most one run, never a burst of every missed occurrence', async () => {
    const task = Scheduler.createTask({
      name: 'Every 15', schedule: { type: 'interval', everyMinutes: 15, anchor: Date.now() - 5 * DAY },
      action: { type: 'reminder', message: 'hi' }, catchUpWindowMin: 1440,
    });
    Scheduler.updateTask(task.id, { lastOccurrence: new Date(Date.now() - DAY).toISOString() });
    Scheduler._checkDueTasks(Date.now());
    await settle();
    // A day of 15-minute slots is 96 occurrences; exactly one run is right.
    expect(Scheduler.getHistory().filter(r => r.taskId === task.id)).toHaveLength(1);
  });

  it('re-baselines when a paused task is resumed so it does not replay the pause', async () => {
    const task = Scheduler.createTask({
      name: 'Paused', schedule: { type: 'interval', everyMinutes: 5, anchor: Date.now() - DAY },
      action: { type: 'reminder', message: 'hi' },
    });
    Scheduler.setEnabled(task.id, false);
    Scheduler.updateTask(task.id, { lastOccurrence: new Date(Date.now() - DAY).toISOString() });
    Scheduler.setEnabled(task.id, true);
    Scheduler._checkDueTasks(Date.now());
    await settle();
    expect(Scheduler.getHistory()).toHaveLength(0);
  });

  it('re-baselines when the schedule itself is edited', () => {
    const task = Scheduler.createTask({
      name: 'Edited', schedule: { type: 'daily', time: '09:00' }, action: { type: 'reminder', message: 'hi' },
    });
    Scheduler.updateTask(task.id, { lastOccurrence: new Date(Date.now() - 5 * DAY).toISOString() });
    const after = Scheduler.updateTask(task.id, { schedule: { type: 'daily', time: '10:00' } });
    expect(Date.parse(after.lastOccurrence)).toBeGreaterThan(Date.now() - 2 * DAY);
  });
});

describe('persistence across a restart', () => {
  it('keeps tasks, their claim and their history in localStorage', async () => {
    const task = Scheduler.createTask({
      name: 'Survivor', schedule: { type: 'daily', time: '09:00' },
      action: { type: 'reminder', message: 'hi' },
    });
    Scheduler.updateTask(task.id, { lastOccurrence: new Date(Date.now() - 2 * DAY).toISOString() });
    const now = new Date();
    now.setHours(9, 5, 0, 0);
    Scheduler._checkDueTasks(now.getTime());
    await settle();

    // "Restart": everything the engine knows must come back off disk alone.
    const rawTasks = localStorage.getItem('vex.schedules');
    const rawHistory = localStorage.getItem('vex.scheduleHistory');
    Scheduler._queue.length = 0;
    Scheduler._running.clear();
    expect(JSON.parse(rawTasks)).toHaveLength(1);
    expect(JSON.parse(rawHistory)).toHaveLength(1);

    const restored = Scheduler.getTask(task.id);
    expect(restored.runCount).toBe(1);
    expect(restored.lastRunResult).toBe('success');
    expect(new Date(restored.lastOccurrence).getHours()).toBe(9);

    // And the restored claim prevents the same occurrence firing again.
    Scheduler._checkDueTasks(now.getTime() + 120000);
    await settle();
    expect(Scheduler.getHistory()).toHaveLength(1);
  });

  it('survives corrupt storage without throwing', () => {
    localStorage.setItem('vex.schedules', 'not json');
    localStorage.setItem('vex.scheduleHistory', '{"nope":1}');
    expect(Scheduler.getAllTasks()).toEqual([]);
    expect(Scheduler.getHistory()).toEqual([]);
  });
});

describe('the run queue', () => {
  it('runs every task that is due at the same moment instead of dropping all but one', async () => {
    const ids = [];
    for (let i = 0; i < 6; i++) {
      const t = Scheduler.createTask({
        name: 'Bulk ' + i, schedule: { type: 'daily', time: '09:00' },
        action: { type: 'reminder', message: 'hi ' + i },
      });
      Scheduler.updateTask(t.id, { lastOccurrence: new Date(Date.now() - 2 * DAY).toISOString() });
      ids.push(t.id);
    }
    const now = new Date();
    now.setHours(9, 1, 0, 0);
    Scheduler._checkDueTasks(now.getTime());
    await settle();

    const ran = new Set(Scheduler.getHistory().map(r => r.taskId));
    expect([...ran].sort()).toEqual([...ids].sort());
    expect(Scheduler.getHistory().every(r => r.status === 'success')).toBe(true);
  });

  it('never runs the same task twice concurrently', async () => {
    let concurrent = 0;
    let peak = 0;
    const original = Scheduler.ACTIONS.reminder.run;
    Scheduler.ACTIONS.reminder.run = async () => {
      concurrent++; peak = Math.max(peak, concurrent);
      await new Promise(r => setTimeout(r, 5));
      concurrent--;
      return 'ok';
    };
    try {
      const t = Scheduler.createTask({ name: 'Solo', schedule: { type: 'daily', time: '09:00' }, action: { type: 'reminder', message: 'x' } });
      const a = Scheduler.runTask(t, true);
      const b = Scheduler.runTask(t, true);
      await Promise.allSettled([a, b]);
      await settle();
      expect(peak).toBe(1);
    } finally {
      Scheduler.ACTIONS.reminder.run = original;
    }
  });
});

describe('actions', () => {
  it('reminder: succeeds and lands in history with a duration', async () => {
    const t = Scheduler.createTask({ name: 'Remind', schedule: { type: 'daily', time: '09:00' }, action: { type: 'reminder', message: 'Drink water' } });
    const run = await Scheduler.runTask(t, true);
    expect(run.status).toBe('success');
    expect(run.summary).toBe('Drink water');
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
    expect(run.manual).toBe(true);
    expect(Scheduler.getTaskHistory(t.id)).toHaveLength(1);
  });

  it('openUrls: opens each URL and normalises a bare hostname', async () => {
    const t = Scheduler.createTask({
      name: 'Open', schedule: { type: 'daily', time: '09:00' },
      action: { type: 'openUrls', urls: 'https://a.example\nb.example', background: true },
    });
    const run = await Scheduler.runTask(t, true);
    expect(run.status).toBe('success');
    expect(TabManager.createTab).toHaveBeenCalledTimes(2);
    expect(TabManager.createTab.mock.calls.map(c => c[0])).toEqual(['https://a.example/', 'https://b.example/']);
  });

  it('openUrls: refuses a non-web scheme at validation time', () => {
    const errors = Scheduler.validate({ name: 'x', schedule: { type: 'daily', time: '09:00' }, action: { type: 'openUrls', urls: 'file:///etc/passwd' } });
    expect(errors.join(' ')).toMatch(/http and https/);
  });

  it('reload: reports failure when nothing matched, rather than a silent success', async () => {
    const t = Scheduler.createTask({ name: 'Reload', schedule: { type: 'daily', time: '09:00' }, action: { type: 'reload', match: 'nothing-here' } });
    const run = await Scheduler.runTask(t, true);
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/No open tab matched/);
    expect(Scheduler.getTask(t.id).failCount).toBe(1);
  });

  it('reload: reloads the matching tabs', async () => {
    const reload = vi.fn();
    tabs.push({ id: 'x1', url: 'https://dash.example/overview' }, { id: 'x2', url: 'https://other.example/' });
    WebviewManager.webviews.set('x1', { reload });
    WebviewManager.webviews.set('x2', { reload: vi.fn() });
    const t = Scheduler.createTask({ name: 'Reload', schedule: { type: 'daily', time: '09:00' }, action: { type: 'reload', match: 'dash' } });
    const run = await Scheduler.runTask(t, true);
    expect(run.status).toBe('success');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(run.summary).toBe('Reloaded 1 tab');
  });

  it('saveSession: delegates to SessionManager', async () => {
    const t = Scheduler.createTask({ name: 'Snap', schedule: { type: 'daily', time: '09:00' }, action: { type: 'saveSession', sessionName: 'Evening' } });
    const run = await Scheduler.runTask(t, true);
    expect(run.status).toBe('success');
    expect(SessionManager.saveCurrentSession).toHaveBeenCalledOnce();
    expect(SessionManager.saveCurrentSession.mock.calls[0][0]).toMatch(/^Evening - /);
  });

  it('sleepTabs: reports how many tabs it suspended', async () => {
    tabs.push({ id: 'a', url: 'x' }, { id: 'b', url: 'y' }, { id: 'c', url: 'z' });
    const t = Scheduler.createTask({ name: 'Sleep', schedule: { type: 'daily', time: '09:00' }, action: { type: 'sleepTabs' } });
    const run = await Scheduler.runTask(t, true);
    expect(run.status).toBe('success');
    expect(run.summary).toBe('Put 2 tabs to sleep');
  });

  it('an action that throws is recorded as failed with its message', async () => {
    const t = Scheduler.createTask({ name: 'Boom', schedule: { type: 'daily', time: '09:00' }, action: { type: 'saveSession' } });
    SessionManager.saveCurrentSession = () => { throw new Error('disk on fire'); };
    const run = await Scheduler.runTask(t, true);
    expect(run.status).toBe('failed');
    expect(run.error).toBe('disk on fire');
    expect(Scheduler.getHistory()[0].error).toBe('disk on fire');
  });

  it('an unknown action type fails loudly instead of doing nothing', async () => {
    const t = Scheduler.createTask({ name: 'Weird', schedule: { type: 'daily', time: '09:00' }, action: { type: 'teleport' } });
    const run = await Scheduler.runTask(t, true);
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/Unknown action/);
  });
});

describe('the agent action hands its background tab back', () => {
  const stubAgent = (impl) => {
    globalThis.AgentLoop = { startHeadless: impl };
    window.VexLifecycle = { ready: async () => {}, run: async fn => fn() };
    WebviewManager.webviews.set('tab0', { addEventListener() {}, removeEventListener() {} });
  };

  it('closes the tab after a successful run', async () => {
    stubAgent(async () => ({ summary: 'done' }));
    const t = Scheduler.createTask({ name: 'Agent', schedule: { type: 'daily', time: '09:00' }, action: { type: 'agent', prompt: 'do it' } });
    const run = await Scheduler.runTask(t, true);
    expect(run.status).toBe('success');
    expect(TabManager.createTab).toHaveBeenCalledOnce();
    expect(TabManager.closeTab).toHaveBeenCalledOnce();
    expect(tabs).toHaveLength(0);   // the leak regression: one tab per run, forever
  });

  it('closes the tab after a failed run too', async () => {
    stubAgent(async () => { throw new Error('no AI configured'); });
    const t = Scheduler.createTask({ name: 'Agent', schedule: { type: 'daily', time: '09:00' }, action: { type: 'agent', prompt: 'do it' } });
    const run = await Scheduler.runTask(t, true);
    expect(run.status).toBe('failed');
    expect(run.error).toBe('no AI configured');
    expect(tabs).toHaveLength(0);
  });

  it('does not leak a tab per run over many runs', async () => {
    stubAgent(async () => ({ summary: 'done' }));
    const t = Scheduler.createTask({ name: 'Agent', schedule: { type: 'daily', time: '09:00' }, action: { type: 'agent', prompt: 'do it' } });
    for (let i = 0; i < 5; i++) {
      WebviewManager.webviews.set('tab0', { addEventListener() {}, removeEventListener() {} });
      await Scheduler.runTask(t, true);
    }
    expect(tabs).toHaveLength(0);
  });
});

describe('validation', () => {
  it('rejects the schedules the old UI let you save into a dead state', () => {
    // A one-off whose time has already passed used to save happily and never run.
    expect(Scheduler.validate({
      name: 'Past', schedule: { type: 'once', date: '2020-01-01', time: '09:00' },
      action: { type: 'reminder', message: 'x' },
    }).join(' ')).toMatch(/already passed/);

    // Weekly with no day selected used to save and never run.
    expect(Scheduler.validate({
      name: 'No days', schedule: { type: 'weekly', time: '09:00', daysOfWeek: [] },
      action: { type: 'reminder', message: 'x' },
    }).join(' ')).toMatch(/at least one day/);

    expect(Scheduler.validate({
      name: 'Bad cron', schedule: { type: 'cron', cron: '99 * * *' },
      action: { type: 'reminder', message: 'x' },
    }).join(' ')).toMatch(/five valid fields/);

    expect(Scheduler.validate({
      name: '', schedule: { type: 'daily', time: '09:00' }, action: { type: 'reminder', message: 'x' },
    }).join(' ')).toMatch(/name/);

    expect(Scheduler.validate({
      name: 'ok', schedule: { type: 'daily', time: '09:00' }, action: { type: 'agent', prompt: '' },
    }).join(' ')).toMatch(/prompt/);
  });

  it('accepts a well-formed task', () => {
    expect(Scheduler.validate({
      name: 'Fine', schedule: { type: 'weekly', time: '09:00', daysOfWeek: [1] },
      action: { type: 'reminder', message: 'hello' },
    })).toEqual([]);
  });
});

describe('one-off tasks', () => {
  it('disables itself after its scheduled run so it stops polling forever', async () => {
    const soon = new Date(Date.now() - 30000);
    const pad = n => String(n).padStart(2, '0');
    const t = Scheduler.createTask({
      name: 'Once', action: { type: 'reminder', message: 'x' },
      schedule: {
        type: 'once',
        date: `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}`,
        time: `${pad(soon.getHours())}:${pad(soon.getMinutes())}`,
      },
    });
    // createTask claims the past occurrence, so clear the claim to simulate the
    // app having been closed when the moment arrived.
    Scheduler.updateTask(t.id, { lastOccurrence: null });
    Scheduler._checkDueTasks(Date.now());
    await settle();
    const after = Scheduler.getTask(t.id);
    expect(after.runCount).toBe(1);
    expect(after.enabled).toBe(false);
    expect(Scheduler.describeNextRun(after)).toBe('Paused');
  });
});

describe('history', () => {
  it('caps growth and keeps the newest runs', async () => {
    const t = Scheduler.createTask({ name: 'Spam', schedule: { type: 'daily', time: '09:00' }, action: { type: 'reminder', message: 'x' } });
    const filler = Array.from({ length: Scheduler.MAX_HISTORY + 10 }, (_, i) => ({ id: 'old' + i, taskId: t.id, taskName: 'Spam', status: 'success', startedAt: new Date().toISOString(), durationMs: 1 }));
    localStorage.setItem('vex.scheduleHistory', JSON.stringify(filler));
    await Scheduler.runTask(t, true);
    const history = Scheduler.getHistory();
    expect(history).toHaveLength(Scheduler.MAX_HISTORY);
    expect(history[0].id).not.toMatch(/^old/);
  });

  it('filters per task', async () => {
    const a = Scheduler.createTask({ name: 'A', schedule: { type: 'daily', time: '09:00' }, action: { type: 'reminder', message: 'x' } });
    const b = Scheduler.createTask({ name: 'B', schedule: { type: 'daily', time: '09:00' }, action: { type: 'reminder', message: 'y' } });
    await Scheduler.runTask(a, true);
    await Scheduler.runTask(b, true);
    await Scheduler.runTask(a, true);
    expect(Scheduler.getTaskHistory(a.id)).toHaveLength(2);
    expect(Scheduler.getTaskHistory(b.id)).toHaveLength(1);
  });
});
