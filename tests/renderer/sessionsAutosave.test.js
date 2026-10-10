// @vitest-environment jsdom
//
// Settings › "Auto-save session every 10 minutes" added a new session each
// time, with a toast, to the same list of 50 as the sessions you name, so
// after about eight hours every named session had been pushed out (found
// 2026-10-09). An autosave now keeps one slot of its own, replaced each time,
// silently, and never counts against your 50.
import { describe, it, expect, beforeEach, vi } from 'vitest';

let SessionManager;
beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  let n = 0;
  globalThis.vexId = (p) => p + (++n);
  window.VexTabPolicy = { isPrivateWindow: false, snapshot: (t) => t.map(x => ({ ...x })) };
  globalThis.TabManager = { tabs: [{ id: 't1', url: 'https://example.com/' }], groups: [], activeTabId: 't1' };
  window.showToast = vi.fn();
  ({ SessionManager } = await import('../../src/renderer/js/sessions.js?' + Math.random()));
  SessionManager.sessions = [];
  SessionManager.renderList = () => {};
});
const saved = () => JSON.parse(localStorage.getItem('vex.sessions'));
const autosave = () => SessionManager.saveCurrentSession('Auto-saved ' + Date.now(), null, { auto: true });

describe('auto-saved sessions', () => {
  it('a day of autosaves keeps the session you named, in one slot, without a toast', () => {
    SessionManager.saveCurrentSession('Work research');
    expect(window.showToast).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 6 * 24; i++) autosave();
    const names = saved().map(s => s.name);
    expect(names).toContain('Work research');
    expect(saved().filter(s => s.auto)).toHaveLength(1);
    expect(saved()).toHaveLength(2);
    expect(window.showToast).toHaveBeenCalledTimes(1);
  });

  it('50 named sessions and the autosave are all kept; a 51st named one drops the oldest named', () => {
    for (let i = 0; i < 50; i++) SessionManager.saveCurrentSession('Named ' + i);
    autosave();
    expect(saved()).toHaveLength(51);
    SessionManager.saveCurrentSession('Named 50');
    const names = saved().map(s => s.name);
    expect(names).toHaveLength(51);
    expect(names).not.toContain('Named 0');
    expect(names).toContain('Named 1');
    expect(saved().filter(s => s.auto)).toHaveLength(1);
  });

  it('an autosave you rename is yours: the next autosave does not replace it', () => {
    const first = autosave();
    SessionManager.renameSession(first.id, 'Before the trip');
    autosave();
    expect(saved().map(s => s.name)).toContain('Before the trip');
    expect(saved().filter(s => s.auto)).toHaveLength(1);
  });

  it('the setting asks for an autosave', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/js/app.js'), 'utf8');
    expect(src).toMatch(/SessionManager\.saveCurrentSession\('Auto-saved ' \+ new Date\(\)\.toLocaleString\(\), null, \{ auto: true \}\)/);
  });
});
