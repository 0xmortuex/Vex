// @vitest-environment jsdom
//
// js/os-hook-ui.js: the window reports exactly two events (exam mode armed, a CI run went red) to main and
// never anything else; a private window reports nothing. The program itself is started by main only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { OsHookUI } = require('../../src/renderer/js/os-hook-ui.js');

let bridge;
beforeEach(() => {
  bridge = { osHookEvent: vi.fn(async () => ({ ok: true })) };
  window.vex = bridge;
  window.VexTabPolicy = { isPrivateWindow: false };
  window.VexProblems = { note: vi.fn() };
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('the events that start in this window', () => {
  it('exam mode armed is reported; exam mode off is not', async () => {
    document.dispatchEvent(new CustomEvent('vex:exam-mode', { detail: { on: true } }));
    document.dispatchEvent(new CustomEvent('vex:exam-mode', { detail: { on: false } }));
    document.dispatchEvent(new CustomEvent('vex:exam-mode', { detail: {} }));
    document.dispatchEvent(new CustomEvent('vex:exam-mode'));
    await flush();
    expect(bridge.osHookEvent.mock.calls).toEqual([[{ event: 'exam-armed' }]]);
  });

  it('a CI failure is reported as ci-red, with nothing about the run in it', async () => {
    document.dispatchEvent(new CustomEvent('vex:ci-failure', { detail: { id: 'secret-card-id', repo: 'me/private-repo' } }));
    await flush();
    expect(bridge.osHookEvent.mock.calls).toEqual([[{ event: 'ci-red' }]]);
  });

  it('a private window reports nothing', async () => {
    window.VexTabPolicy.isPrivateWindow = true;
    document.dispatchEvent(new CustomEvent('vex:exam-mode', { detail: { on: true } }));
    document.dispatchEvent(new CustomEvent('vex:ci-failure'));
    await flush();
    expect(bridge.osHookEvent).not.toHaveBeenCalled();
  });

  it('a build without the bridge reports nothing and says nothing', async () => {
    window.vex = {};
    expect(() => OsHookUI.report('ci-red')).not.toThrow();
  });

  it('main refusing or failing is reported, not swallowed', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    bridge.osHookEvent.mockResolvedValue({ ok: false, error: 'No' });
    OsHookUI.report('ci-red');
    await flush();
    expect(window.VexProblems.note).toHaveBeenCalledTimes(1);
    bridge.osHookEvent.mockRejectedValue(new Error('gone'));
    OsHookUI.report('exam-armed');
    await flush();
    expect(window.VexProblems.note).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });
});
