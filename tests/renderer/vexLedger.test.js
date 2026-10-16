// @vitest-environment jsdom
//
// js/vex-ledger.js: what Vex did by itself, why, and a plain-data undo token that
// survives the 10-second toast and a restart; Ctrl+K "Why did that happen?" lists
// the last 50 with Undo and Stop doing this (js/vex-ledger-ui.js).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

function boot() {
  globalThis.VexRegistry = fresh(JS + 'feature-registry.js').VexRegistry;
  globalThis.VexUsage = fresh(JS + 'vex-usage.js').VexUsage;
  globalThis.VexLedger = fresh(JS + 'vex-ledger.js').VexLedger;
}
const tick = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.VexProblems = globalThis.VexProblems = { note: vi.fn() };
  boot();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const line = (over = {}) => ({ feature: 'tab-auto-sleep', what: 'Slept 3 idle tabs', why: 'They were idle for 30 minutes', undo: { kind: 'wake', ids: [1, 2, 3] }, ...over });

describe('record()', () => {
  it('stores what, why and the token, newest first', () => {
    VexLedger.record(line());
    VexLedger.record(line({ what: 'Second' }));
    const rows = VexLedger.list();
    expect(rows.map(r => r.what)).toEqual(['Second', 'Slept 3 idle tabs']);
    expect(rows[1]).toMatchObject({ feature: 'tab-auto-sleep', undo: { kind: 'wake', ids: [1, 2, 3] }, undone: false });
  });

  it('refuses an incomplete line instead of keeping half of it', () => {
    expect(() => VexLedger.record(line({ why: '' }))).toThrow(/needs why/);
    expect(() => VexLedger.record(line({ what: ' ' }))).toThrow(/what it did/);
    expect(() => VexLedger.record(line({ feature: '' }))).toThrow(/the feature/);
    expect(() => VexLedger.record(line({ undo: { ids: [] } }))).toThrow(/needs a kind/);
    expect(VexLedger.list()).toEqual([]);
  });

  it('refuses a token too large to keep', () => {
    expect(() => VexLedger.record(line({ undo: { kind: 'big', blob: 'x'.repeat(5000) } }))).toThrow(/too large/);
  });

  it('keeps 200 and lists 50', () => {
    for (let i = 0; i < 230; i++) VexLedger.record(line({ what: 'n' + i }));
    expect(VexLedger._load().length).toBe(200);
    expect(VexLedger.list().length).toBe(50);
    expect(VexLedger.list()[0].what).toBe('n229');
  });

  it('note() reports a bad line and does not throw into the code that acted', () => {
    expect(VexLedger.note(line({ why: '' }))).toBeNull();
    expect(VexProblems.note).toHaveBeenCalledWith('Ledger', expect.any(String), expect.any(Error));
  });
});

describe('undo', () => {
  it('runs the registered handler with the token and marks the line undone', async () => {
    const handler = vi.fn();
    VexLedger.registerUndo('wake', handler);
    const e = VexLedger.record(line());
    await VexLedger.undo(e.id);
    expect(handler).toHaveBeenCalledWith({ kind: 'wake', ids: [1, 2, 3] }, expect.objectContaining({ id: e.id }));
    expect(VexLedger.get(e.id).undone).toBe(true);
    await expect(VexLedger.undo(e.id)).rejects.toThrow(/already undone/);
  });

  it('survives a restart: a fresh module reads the token from storage and the handler registered again', async () => {
    const e = VexLedger.record(line());
    boot();                                              // the next session
    const handler = vi.fn();
    VexLedger.registerUndo('wake', handler);
    expect(VexLedger.list()[0].id).toBe(e.id);
    expect(VexLedger.canUndo(VexLedger.list()[0])).toBe(true);
    await VexLedger.undo(e.id);
    expect(handler).toHaveBeenCalled();
    boot();
    expect(VexLedger.list()[0].undone).toBe(true);        // and that is remembered too
  });

  it('says so when no module knows how, rather than doing nothing', async () => {
    const e = VexLedger.record(line({ undo: { kind: 'gone' } }));
    await expect(VexLedger.undo(e.id)).rejects.toThrow(/nothing in this build knows how \(gone\)/);
    expect(VexLedger.get(e.id).undone).toBe(false);
  });

  it('leaves the line undoable when the handler throws', async () => {
    VexLedger.registerUndo('wake', () => { throw new Error('the tabs are closed'); });
    const e = VexLedger.record(line());
    await expect(VexLedger.undo(e.id)).rejects.toThrow('the tabs are closed');
    expect(VexLedger.canUndo(VexLedger.get(e.id))).toBe(true);
  });

  it('refuses a line that has no way back', async () => {
    const e = VexLedger.record(line({ undo: undefined }));
    expect(VexLedger.canUndo(e)).toBe(false);
    await expect(VexLedger.undo(e.id)).rejects.toThrow(/cannot be undone/);
  });
});

describe('Stop doing this', () => {
  it('switches the feature off through the registry and marks its lines', async () => {
    VexRegistry.define({ id: 'tab-auto-sleep', title: 'Sleep idle tabs' });
    let on = true;
    VexUsage.register({ id: 'tab-auto-sleep', title: 'x', isEnabled: () => on, disable: () => { on = false; }, enable: () => { on = true; } });
    const a = VexLedger.record(line());
    const b = VexLedger.record(line({ what: 'again' }));
    expect(VexLedger.canStop(a)).toBe(true);
    await VexLedger.stopDoing(a.id);
    expect(on).toBe(false);
    expect(VexLedger.get(b.id).stopped).toBe(true);
    expect(VexLedger.canStop(VexLedger.get(b.id))).toBe(false);
    expect(VexUsage._load().off['tab-auto-sleep']).toBeGreaterThan(0);          // saved: it stays off after a restart
  });

  it('cannot stop a feature with no manifest or no switch', async () => {
    const a = VexLedger.record(line({ feature: 'nothing' }));
    expect(VexLedger.canStop(a)).toBe(false);
    await expect(VexLedger.stopDoing(a.id)).rejects.toThrow(/not a feature that can be switched off/);
    VexRegistry.define({ id: 'core', title: 'Core', killSwitch: 'none' });
    expect(VexLedger.canStop(VexLedger.record(line({ feature: 'core' })))).toBe(false);
  });

  it('uses the stop token of an action whose feature has no switch in the registry', async () => {
    const stop = vi.fn();
    VexLedger.registerStop('no-autostart', stop);
    const e = VexLedger.record(line({ feature: 'focus-os', stop: { kind: 'no-autostart', goalId: 'g1' } }));
    expect(VexLedger.canStop(e)).toBe(true);
    await VexLedger.stopDoing(e.id);
    expect(stop).toHaveBeenCalledWith({ kind: 'no-autostart', goalId: 'g1' }, expect.anything());
  });
});

describe('the Ctrl+K list', () => {
  function ui() {
    globalThis.VexIcons = undefined;
    window.vexConfirm = globalThis.vexConfirm = vi.fn(async () => true);
    window.showToast = vi.fn();
    globalThis.VexLedgerUI = fresh(JS + 'vex-ledger-ui.js').VexLedgerUI;
    return VexLedgerUI;
  }

  it('lists the last lines with the reason, and Undo only where there is one', async () => {
    const U = ui();
    VexLedger.registerUndo('wake', vi.fn());
    VexLedger.record(line());
    VexLedger.record(line({ what: 'No way back', undo: undefined }));
    U.open();
    const rows = document.querySelectorAll('#vex-ledger .vex-tn-rec');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('No way back');
    expect(rows[0].textContent).not.toContain('Undo');
    expect(rows[1].textContent).toContain('They were idle for 30 minutes');
    expect([...rows[1].querySelectorAll('button')].map(b => b.textContent)).toContain('Undo');
  });

  it('Undo runs the handler, repaints, and says what happened', async () => {
    const U = ui();
    const handler = vi.fn();
    VexLedger.registerUndo('wake', handler);
    VexLedger.record(line());
    U.open();
    [...document.querySelectorAll('#vex-ledger button')].find(b => b.textContent === 'Undo').click();
    await tick(); await tick();
    expect(handler).toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('Undone'));
    expect(document.querySelector('#vex-ledger').textContent).toContain('undone');
  });

  it('shows the error when an undo cannot be done', async () => {
    const U = ui();
    VexLedger.record(line({ undo: { kind: 'unknown' } }));
    U.open();
    [...document.querySelectorAll('#vex-ledger button')].find(b => b.textContent === 'Undo').click();
    await tick(); await tick();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/nothing in this build knows how/), 'error', 6000);
  });

  it('says what the list is for when it is empty, and closes on Escape', () => {
    const U = ui();
    U.open();
    expect(document.querySelector('#vex-ledger').textContent).toMatch(/Nothing yet/);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('vex-ledger')).toBeNull();
  });

  it('forgets the list after a confirm', async () => {
    const U = ui();
    VexLedger.record(line());
    U.open();
    [...document.querySelectorAll('#vex-ledger button')].find(b => /Forget/.test(b.textContent)).click();
    await tick(); await tick();
    expect(vexConfirm).toHaveBeenCalled();
    expect(VexLedger.list()).toEqual([]);
  });
});
