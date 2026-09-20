// @vitest-environment jsdom
//
// Three tools that act outside the page: setting something to run again and
// again, downloading a file, and signing in with a saved login. The last one
// carries the rule that matters most — the model must never be handed a
// password, so it is the vault that fills the form and the agent is told only
// whether it worked.
import { describe, it, expect, vi, beforeEach } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/schedule-words.js');
globalThis.ScheduleWords = window.ScheduleWords;
// download_file checks the address with the agent's own checker, the same one
// that keeps it off file:// and the machines on this network.
globalThis.AgentTools = require('../../src/renderer/js/agent-tools.js').AgentTools;
const { AgentExecutor } = require('../../src/renderer/js/agent-executor.js');

let created;
beforeEach(() => {
  created = [];
  window.vex = {
    downloadsRetry: vi.fn(async () => ({ ok: true })),
    vaultGet: vi.fn(async () => [{ username: 'someone@example.com' }]),
  };
  globalThis.Scheduler = {
    createTask: vi.fn((data) => { const t = { id: 'task_1', ...data }; created.push(t); return t; }),
    getTask: (id) => created.find(t => t.id === id) || null,
    deleteTask: vi.fn(),
  };
  globalThis.TabManager = { tabs: [{ id: 1, url: 'https://site.example/login' }], activeTabId: 1, getActiveTab: () => TabManager.tabs[0] };
  globalThis.WebviewManager = { webviews: new Map([[1, { getURL: () => 'https://site.example/login' }]]), getActiveWebview: () => WebviewManager.webviews.get(1) };
  globalThis.PasswordVault = { autofill: vi.fn(async () => {}) };
});

describe('create_schedule', () => {
  it('turns plain words into a real scheduled task', async () => {
    const r = await AgentExecutor.executeTool('create_schedule', { name: 'Morning check', prompt: 'check the status page', when: 'every weekday at 8:30' }, {});
    expect(r.ok).toBe(true);
    expect(Scheduler.createTask).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Morning check',
      schedule: { type: 'weekly', time: '08:30', daysOfWeek: [1, 2, 3, 4, 5] },
      action: expect.objectContaining({ type: 'agent', prompt: 'check the status page' }),
    }));
    expect(r.result).toContain('every weekday at 08:30');
  });

  it('can be undone, like anything else the agent sets up', async () => {
    const r = await AgentExecutor.executeTool('create_schedule', { prompt: 'do the thing', when: 'every morning at 9' }, {});
    expect(r.undo).toMatchObject({ kind: 'schedule', id: 'task_1' });
  });

  it('refuses a "when" it cannot read rather than picking an hour', async () => {
    const r = await AgentExecutor.executeTool('create_schedule', { prompt: 'x', when: 'sometimes' }, {});
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toMatch(/what time/);
    expect(Scheduler.createTask).not.toHaveBeenCalled();
  });

  it('refuses a task with nothing to do', async () => {
    const r = await AgentExecutor.executeTool('create_schedule', { prompt: '  ', when: 'every morning at 9' }, {});
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toMatch(/needs the instruction/);
  });
});

describe('download_file', () => {
  it('starts the download and says where it will land', async () => {
    const r = await AgentExecutor.executeTool('download_file', { url: 'https://site.example/invoice.pdf' }, {});
    expect(window.vex.downloadsRetry).toHaveBeenCalledWith('https://site.example/invoice.pdf');
    expect(r.ok).toBe(true);
    expect(r.result).toMatch(/downloads list/);
  });

  it('will not be pointed at something that is not a web address', async () => {
    const r = await AgentExecutor.executeTool('download_file', { url: 'file:///C:/Windows/System32/config' }, {});
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toMatch(/Not a web address/);
    expect(window.vex.downloadsRetry).not.toHaveBeenCalled();
  });

  it('says so when the download would not start', async () => {
    window.vex.downloadsRetry = vi.fn(async () => ({ ok: false, error: 'blocked' }));
    expect(await AgentExecutor.executeTool('download_file', { url: 'https://site.example/x.zip' }, {}))
      .toMatchObject({ ok: false, error: 'blocked' });
  });
});

describe('sign_in', () => {
  it('has the vault fill the form, and never returns the password', async () => {
    const r = await AgentExecutor.executeTool('sign_in', {}, {});
    expect(PasswordVault.autofill).toHaveBeenCalled();
    expect(r.ok).toBe(true);
    expect(r.result).toContain('site.example');
    // The account and its secret stay between the vault and the page.
    expect(JSON.stringify(r)).not.toMatch(/someone@example\.com/i);
  });

  it('says plainly when there is no saved login for the site', async () => {
    window.vex.vaultGet = vi.fn(async () => []);
    const r = await AgentExecutor.executeTool('sign_in', {}, {});
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toMatch(/no saved login/);
    expect(PasswordVault.autofill).not.toHaveBeenCalled();
  });

  it('will not fill a login over plain http', async () => {
    WebviewManager.webviews.set(1, { getURL: () => 'http://site.example/login' });
    const r = await AgentExecutor.executeTool('sign_in', {}, {});
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toMatch(/https/);
    expect(PasswordVault.autofill).not.toHaveBeenCalled();
  });
});
