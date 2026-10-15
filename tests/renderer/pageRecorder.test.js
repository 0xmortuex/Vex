// @vitest-environment jsdom
//
// The page recorder: what a recording becomes, that secrets are never written
// down, dry runs that change nothing, and that a SCHEDULED run does no click or
// typing without an approval that dies when the script is edited, pauses after
// three failures in a row and obeys the kill switch. A local stand-in page in
// jsdom; no network.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { AgentSafety } = require('../../src/renderer/js/agent-safety.js');
const { PageActions } = require('../../src/renderer/js/page-actions.js');
globalThis.PageActions = PageActions;
globalThis.AgentSafety = AgentSafety;

let tasks, tabs, closed, created, notifyCalls;
globalThis.Scheduler = {
  ACTIONS: {},
  getAllTasks: () => tasks,
  setEnabled: (id, on) => { const t = tasks.find(x => x.id === id); if (t) t.enabled = on; return t; },
  validate: () => [],
  createTask: (d) => { const t = { id: 'task_' + (tasks.length + 1), enabled: true, ...d }; tasks.push(t); return t; },
  _notify: (title, body) => notifyCalls.push([title, body]),
};
globalThis.ScheduleWords = require('../../src/renderer/js/schedule-words.js').ScheduleWords;

const { PageRecorder } = require('../../src/renderer/js/page-recorder.js');

const ORIGIN = 'https://app.example';     // the stand-in page's pretend origin
const guestEval = (code) => Promise.resolve((0, eval)(code));
const wv = { executeJavaScript: guestEval, addEventListener() {}, removeEventListener() {} };

function install(source, extra = {}) {
  const id = PageActions.add({ name: 'Report', origin: ORIGIN, source });
  const state = PageActions._load();
  const s = state.scripts.find(x => x.id === id);
  s.recorded = true; s.startUrl = ORIGIN + '/reports';
  Object.assign(s, extra);
  PageActions._save(state);
  return id;
}

beforeEach(() => {
  localStorage.clear();
  AgentSafety._listeners.clear();
  AgentSafety.onKill((why) => PageRecorder.onKill(why));   // as init() does on load
  PageRecorder._active.clear();
  tasks = []; tabs = []; closed = []; created = []; notifyCalls = [];
  window.VexTabPolicy = { canReadWebview: () => true };
  globalThis.vexConfirm = window.vexConfirm = vi.fn(async () => true);
  globalThis.vexPrompt = window.vexPrompt = vi.fn(async () => 'x');
  delete globalThis.Recall;
  globalThis.TabManager = {
    tabs,
    getActiveTab: () => tabs[0] || null,
    createTab: (url) => { const t = { id: 'bg' + (tabs.length + 1), url }; tabs.push(t); created.push(url); return t; },
    closeTab: (id) => { closed.push(id); },
  };
  globalThis.WebviewManager = { webviews: new Map(), getActiveWebview: () => null };
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 80, height: 20, right: 80, bottom: 20 });
  Element.prototype.scrollIntoView = () => {};
  PageActions._save({ enabled: true, scripts: [] });
});

function openTab(url = ORIGIN + '/reports') {
  const t = { id: 'tab1', url };
  tabs.length = 0; tabs.push(t);
  WebviewManager.webviews.set('tab1', wv);
  return t;
}

describe('a recording becomes a page action', () => {
  it('writes clicks, typing and scrolling in the page-actions language', () => {
    const built = PageRecorder.eventsToSource([
      { t: 'type', selector: '#q', value: 'rep', desc: { name: 'q' } },
      { t: 'type', selector: '#q', value: 'report', desc: { name: 'q' } },
      { t: 'click', text: 'Search', unique: true, selector: 'button:nth-of-type(1)' },
      { t: 'scroll', to: 'heading', text: 'Monthly totals' },
      { t: 'scroll', to: 'heading', text: 'Monthly totals' },
      { t: 'click', text: 'Download', unique: false, selector: '#dl' },
    ]);
    expect(built.source.split('\n')).toEqual([
      'type selector: #q = "report"',
      'click "Search"',
      'wait 600',
      'scroll to "Monthly totals"',
      'click selector: #dl',
    ]);
    const parsed = PageActions.parse(built.source);
    expect(parsed.errors).toEqual([]);
    expect(parsed.steps.length).toBe(5);
  });
  it('a password or code field is recorded as "ask me", with no value in the script', () => {
    const built = PageRecorder.eventsToSource([
      { t: 'type', selector: '#pw', value: 'hunter2', desc: { type: 'password', name: 'pw' } },
      { t: 'ask', selector: '#otp' },
      { t: 'type', selector: '#note', value: '482913', desc: { name: 'note' } },    // looks like a code
    ]);
    expect(built.source).toBe('ask selector: #pw\nask selector: #otp\nask selector: #note');
    expect(built.asks).toBe(3);
    expect(built.source).not.toContain('hunter2');
    expect(built.source).not.toContain('482913');
    expect(PageActions.parse(built.source).errors).toEqual([]);
  });
  it('escapes quotes in what was typed', () => {
    const built = PageRecorder.eventsToSource([{ t: 'type', selector: '#q', value: 'say "hi" \\ there', desc: {} }]);
    const step = PageActions.parse(built.source).steps[0];
    expect(step.text).toBe('say "hi" \\ there');
  });
  it('stops at the script size limit', () => {
    const ev = Array.from({ length: 80 }, (_, i) => ({ t: 'type', selector: '#f' + i, value: 'v', desc: {} }));
    const built = PageRecorder.eventsToSource(ev);
    expect(built.truncated).toBe(true);
    expect(PageActions.parse(built.source).errors).toEqual([]);
  });

  it('the guest recorder captures a click and typing, and never reads a secret field', async () => {
    document.body.innerHTML = '<input id="q" name="q" type="text"><input id="pw" type="password" name="pw"><button id="go">Search</button><h2>Totals</h2>';
    expect(await guestEval(PageRecorder.recorderCode({ trustedOnly: false }))).toBe('ok');
    const q = document.getElementById('q'); q.value = 'invoices'; q.dispatchEvent(new Event('change', { bubbles: true }));
    const pw = document.getElementById('pw'); pw.value = 'hunter2'; pw.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('go').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const events = await guestEval(PageRecorder.stopCode());
    expect(JSON.stringify(events)).not.toContain('hunter2');
    expect(events.find(e => e.t === 'type').value).toBe('invoices');
    expect(events.find(e => e.t === 'ask').selector).toBe('#pw');
    const click = events.find(e => e.t === 'click');
    expect(click.text).toBe('Search');
    expect(click.unique).toBe(true);
    expect(window.__vexRec).toBeUndefined();
    const built = PageRecorder.eventsToSource(events);
    expect(built.source).toContain('type selector: #q = "invoices"');
    expect(built.source).toContain('ask selector: #pw');
    expect(built.source).toContain('click "Search"');
  });
  it('real (untrusted) script-made events are ignored by default', async () => {
    document.body.innerHTML = '<button id="go">Go</button>';
    await guestEval(PageRecorder.recorderCode());
    document.getElementById('go').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(await guestEval(PageRecorder.stopCode())).toEqual([]);
  });
});

describe('dry run', () => {
  it('finds every element and changes nothing', async () => {
    document.body.innerHTML = '<input id="q"><button id="del">Delete all</button><h2>Totals</h2>';
    const hit = vi.fn();
    document.getElementById('del').addEventListener('click', hit);
    const id = install('type selector: #q = "x"\nclick "Delete all"\nclick "Missing"\nscroll to "Totals"\nhide selector: h2');
    const tab = openTab();
    const r = await PageRecorder.dryRun(id);
    expect(hit).not.toHaveBeenCalled();
    expect(document.getElementById('q').value).toBe('');
    expect(document.querySelector('h2').style.display).toBe('');
    expect(r.ok).toBe(false);
    expect(r.lines[0]).toMatch(/would type/);
    expect(r.lines[1]).toMatch(/would click "Delete all"/);
    expect(r.lines[2]).toMatch(/not found/);
    expect(PageRecorder.runs(id)[0]).toMatchObject({ mode: 'dry', ok: false });
    expect(tab.url).toContain(ORIGIN);
  });
});

describe('scheduled runs never write without a stored approval', () => {
  function tabFactory() {
    return { tabs };
  }
  const inPage = (html) => { document.body.innerHTML = html; };

  it('a read-only script (scroll, wait) runs unattended', async () => {
    inPage('<h2>Totals</h2>');
    const id = install('scroll bottom\nwait 10');
    // the background tab the runner opens gets the stand-in page's webview
    WebviewManager.webviews.set('bg1', wv);
    const msg = await PageRecorder.runScheduled(id, {});
    expect(created).toEqual([ORIGIN + '/reports']);
    expect(closed).toEqual(['bg1']);
    expect(msg).toMatch(/2 steps done/);
    expect(PageRecorder.runs(id)[0]).toMatchObject({ mode: 'scheduled', ok: true });
  });

  it('a script that clicks is refused until approved, before any tab is opened', async () => {
    inPage('<button id="dl">Download report</button>');
    const dl = vi.fn(); document.getElementById('dl').addEventListener('click', dl);
    const id = install('click "Download report"');
    WebviewManager.webviews.set('bg1', wv);
    await expect(PageRecorder.runScheduled(id, {})).rejects.toThrow(/not approved/);
    expect(created).toEqual([]);
    expect(dl).not.toHaveBeenCalled();
    // approve exactly this text
    expect(await PageRecorder.approveUnattended(id)).toBe(true);
    await PageRecorder.runScheduled(id, {});
    expect(dl).toHaveBeenCalledTimes(1);
  });

  it('editing the script drops the approval', async () => {
    inPage('<button id="dl">Download report</button><button id="x">Remove</button>');
    const id = install('click "Download report"');
    WebviewManager.webviews.set('bg1', wv); WebviewManager.webviews.set('bg2', wv);
    await PageRecorder.approveUnattended(id);
    await PageRecorder.runScheduled(id, {});
    PageActions.update(id, { source: 'click "Remove"' });
    expect(PageActions.scripts().find(s => s.id === id).scheduleApproval).toBe('');
    const x = vi.fn(); document.getElementById('x').addEventListener('click', x);
    await expect(PageRecorder.runScheduled(id, {})).rejects.toThrow(/not approved/);
    expect(x).not.toHaveBeenCalled();
  });

  it('an approval written for other text does not carry over (fingerprint)', async () => {
    inPage('<button id="x">Remove</button>');
    const id = install('click "Remove"', { scheduleApproval: PageRecorder.fingerprint('click "Download report"') });
    WebviewManager.webviews.set('bg1', wv);
    await expect(PageRecorder.runScheduled(id, {})).rejects.toThrow(/not approved/);
  });

  it('a script with an "ask me" step never runs unattended, and cannot be approved', async () => {
    inPage('<input id="pw" type="password">');
    const id = install('ask selector: #pw');
    WebviewManager.webviews.set('bg1', wv);
    await expect(PageRecorder.runScheduled(id, {})).rejects.toThrow(/ask me/);
    await expect(PageRecorder.approveUnattended(id)).rejects.toThrow(/ask me/);
    expect(() => PageRecorder.createSchedule(id, 'every monday at 9')).toThrow(/ask me/);
  });

  it('does not run in a private window or when page actions are off', async () => {
    inPage('<h2>T</h2>');
    const id = install('scroll bottom');
    WebviewManager.webviews.set('bg1', wv);
    PageActions._save({ ...PageActions._load(), enabled: false });
    await expect(PageRecorder.runScheduled(id, {})).rejects.toThrow(/turned off/);
    PageActions._save({ ...PageActions._load(), enabled: true });
    window.VexTabPolicy = { canReadWebview: () => true, isPrivateWindow: true };
    await expect(PageRecorder.runScheduled(id, {})).rejects.toThrow();
    expect(created).toEqual([]);
  });

  it('three failures in a row pause the schedule and notify; a fourth run does nothing', async () => {
    inPage('<p>no such button</p>');
    const id = install('click "Ghost"', {});
    const s0 = PageActions._load(); s0.scripts[0].scheduleApproval = PageRecorder.fingerprint('click "Ghost"'); PageActions._save(s0);
    tasks.push({ id: 't1', enabled: true, action: { type: 'pageScript', scriptId: id } });
    for (let i = 1; i <= 3; i++) {
      WebviewManager.webviews.set('bg' + i, wv);
      await expect(PageRecorder.runScheduled(id, {})).rejects.toThrow(/not found/);
    }
    expect(PageRecorder.state(id)).toMatchObject({ fails: 3, paused: true });
    expect(tasks[0].enabled).toBe(false);
    expect(notifyCalls.length).toBe(1);
    expect(notifyCalls[0][0]).toMatch(/paused/);
    const before = created.length;
    await expect(PageRecorder.runScheduled(id, {})).rejects.toThrow(/paused/);
    expect(created.length).toBe(before);
    PageRecorder.resume(id);
    expect(tasks[0].enabled).toBe(true);
    expect(PageRecorder.state(id).paused).toBe(false);
  });

  it('a success in between resets the count', async () => {
    inPage('<p>x</p>');
    const id = install('scroll bottom');
    PageRecorder.recordOutcome(id, false, 'a');
    PageRecorder.recordOutcome(id, false, 'b');
    PageRecorder.recordOutcome(id, true);
    PageRecorder.recordOutcome(id, false, 'c');
    expect(PageRecorder.state(id)).toMatchObject({ fails: 1, paused: false });
    expect(notifyCalls).toEqual([]);
  });

  it('the kill switch holds scheduled runs and their tasks', async () => {
    inPage('<h2>T</h2>');
    const id = install('scroll bottom');
    WebviewManager.webviews.set('bg1', wv);
    tasks.push({ id: 't1', enabled: true, action: { type: 'pageScript', scriptId: id } });
    AgentSafety.kill('test');
    expect(PageRecorder.killed()).toBe(true);
    expect(tasks[0].enabled).toBe(false);
    await expect(PageRecorder.runScheduled(id, {})).rejects.toThrow(/kill switch/);
    expect(created).toEqual([]);
    PageRecorder.rearm();
    expect(PageRecorder.killed()).toBe(false);
  });

  it('refuses a site on the exclude list', async () => {
    globalThis.Recall = { isExcluded: () => true };
    inPage('<h2>T</h2>');
    const id = install('scroll bottom');
    WebviewManager.webviews.set('bg1', wv);
    await expect(PageRecorder.runScheduled(id, {})).rejects.toThrow(/exclude list/);
    expect(created).toEqual([]);
  });
});

describe('scheduling and registration', () => {
  it('registers a scheduler action that needs a recorded script', () => {
    const a = Scheduler.ACTIONS.pageScript;
    expect(a).toBeTruthy();
    expect(a.validate({ type: 'pageScript' })[0]).toMatch(/Settings/);
    const id = install('scroll bottom');
    expect(a.validate({ type: 'pageScript', scriptId: id })).toEqual([]);
    expect(a.summary({ scriptId: id })).toContain('Report');
  });
  it('turns plain words into a scheduler task for the script', () => {
    const id = install('scroll bottom');
    const t = PageRecorder.createSchedule(id, 'every monday at 9');
    expect(t.action).toEqual({ type: 'pageScript', scriptId: id });
    expect(t.schedule).toMatchObject({ type: 'weekly', time: '09:00', daysOfWeek: [1] });
  });
  it('the run log is capped and clearable', () => {
    for (let i = 0; i < PageRecorder.MAX_RUNS + 3; i++) PageRecorder._logRun({ scriptId: 's', mode: 'manual', ok: true, lines: [] });
    expect(PageRecorder.runs().length).toBe(PageRecorder.MAX_RUNS);
    PageRecorder.clearRuns();
    expect(PageRecorder.runs()).toEqual([]);
  });
});
