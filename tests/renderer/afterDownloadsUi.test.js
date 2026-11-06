// @vitest-environment jsdom
// The Downloads panel row and the countdown over the window (js/after-downloads-ui.js), against a fake bridge.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let UI;
let vex;
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="panel"><div id="downloads-list"></div></div>';
  vex = {
    afterDlGet: vi.fn(async () => ({ armed: false })),
    afterDlArm: vi.fn(async (a) => ({ armed: true, action: a, phase: 'waiting' })),
    afterDlDisarm: vi.fn(async () => ({ armed: false })),
    afterDlCancel: vi.fn(async () => ({ armed: false })),
  };
  window.vex = vex;
  window.showToast = vi.fn();
  delete require.cache[require.resolve('../../src/renderer/js/after-downloads-ui.js')];
  UI = require('../../src/renderer/js/after-downloads-ui.js').AfterDownloadsUI;
  UI._rows.clear();
});
afterEach(() => { UI._hideCountdown(); });

describe('the choice row', () => {
  it('starts on Do nothing, and arming is an explicit change of the choice', async () => {
    UI.mount(document.getElementById('panel'));
    await flush();
    const sel = document.getElementById('after-dl-choice');
    expect(sel.value).toBe('nothing');
    expect([...sel.options].map(o => o.value)).toEqual(['nothing', 'sleep', 'shutdown']);
    expect(vex.afterDlArm).not.toHaveBeenCalled();
    sel.value = 'shutdown';
    sel.dispatchEvent(new Event('change'));
    await flush();
    expect(vex.afterDlArm).toHaveBeenCalledWith('shutdown');
    expect(document.querySelector('.after-dl-status').textContent).toMatch(/shut down when all downloads have finished.*12 hours/);
    sel.value = 'nothing';
    sel.dispatchEvent(new Event('change'));
    await flush();
    expect(vex.afterDlDisarm).toHaveBeenCalled();
    expect(document.querySelector('.after-dl-status').textContent).toBe('');
  });
  it('mounts once per panel', () => {
    const panel = document.getElementById('panel');
    UI.mount(panel); UI.mount(panel);
    expect(panel.querySelectorAll('.after-dl-row')).toHaveLength(1);
  });
  it('shows the reason and resets to Do nothing when main refuses', async () => {
    vex.afterDlArm = vi.fn(async () => { throw new Error("Error invoking remote method 'afterdl:arm': Error: only on Windows"); });
    UI.mount(document.getElementById('panel'));
    await flush();
    const sel = document.getElementById('after-dl-choice');
    sel.value = 'sleep'; sel.dispatchEvent(new Event('change'));
    await flush(); await flush();
    expect(window.showToast.mock.calls[0][0]).toMatch(/only on Windows/);
    expect(sel.value).toBe('nothing');
  });
});

describe('the countdown', () => {
  it('shows a big Cancel and a live count; Cancel tells main and removes it', async () => {
    vi.useFakeTimers();
    try {
      UI.onEvent({ kind: 'countdown', action: 'sleep', seconds: 60, fireAt: Date.now() + 60000 });
      const box = document.querySelector('.after-dl-overlay');
      expect(box.getAttribute('role')).toBe('alertdialog');
      expect(box.textContent).toMatch(/Sleeping in 60 seconds/);
      vi.advanceTimersByTime(10000);
      expect(box.textContent).toMatch(/Sleeping in 50 seconds/);
      const cancel = box.querySelector('button');
      expect(cancel.textContent).toBe('Cancel');
      expect(document.activeElement).toBe(cancel);
      cancel.click();
      expect(vex.afterDlCancel).toHaveBeenCalled();
      expect(document.querySelector('.after-dl-overlay')).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it('Escape also cancels', () => {
    UI.onEvent({ kind: 'countdown', action: 'shutdown', seconds: 60, fireAt: Date.now() + 60000 });
    document.querySelector('.after-dl-overlay').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(vex.afterDlCancel).toHaveBeenCalled();
  });
  it('a new download (restarted), a block, or the end removes the overlay and explains', () => {
    for (const [ev, toast] of [[{ kind: 'restarted', action: 'sleep' }, /wait begins again/], [{ kind: 'blocked', action: 'sleep', why: 'x' }, /did not finish/], [{ kind: 'disarmed', why: 'cancelled', action: 'sleep' }, /Cancelled/]]) {
      window.showToast.mockClear();
      UI.onEvent({ kind: 'countdown', action: 'sleep', seconds: 60, fireAt: Date.now() + 60000 });
      UI.onEvent(ev);
      expect(document.querySelector('.after-dl-overlay')).toBeNull();
      expect(window.showToast.mock.calls[0][0]).toMatch(toast);
    }
  });
  it('ignores garbage events', () => {
    UI.onEvent(null); UI.onEvent({}); UI.onEvent({ kind: 5 });
    expect(document.querySelector('.after-dl-overlay')).toBeNull();
  });
});
