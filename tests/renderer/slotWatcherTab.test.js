// @vitest-environment jsdom
// T3-092 (Wave 6): the slot watcher can look at a booking page that is open in a tab (signed in by the person).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
globalThis.VexTr = require(JS + 'vex-tr.js').VexTr;
const { VexSlotWatcher: SW } = require(JS + 'slot-watcher.js');
const { VexSlotTab: ST } = require(JS + 'slot-watcher-tab.js');

let watches, toasts, wv, jobs;

function setup({ tabText = 'Randevu yok', tabUrl = 'https://randevu.example.gov/slots' } = {}) {
  localStorage.clear();
  ST._lines = new Map();
  ST._job = null;
  toasts = [];
  jobs = [];
  window.showToast = (...a) => toasts.push(a);
  watches = [{ id: 'w1', url: 'https://randevu.example.gov/slots', title: 'Passport', source: 'slot-watcher', paused: false }];
  globalThis.PageWatch = { list: () => watches };
  globalThis.VexJobs = { every: vi.fn((name, ms, fn, opts) => { jobs.push({ name, ms, fn, opts }); return { stop() {} }; }) };
  localStorage.setItem(SW.KEY, JSON.stringify({ on: true, pages: { w1: { label: 'Passport', available: ['müsait'], none: ['randevu yok'], toldAt: 0 } } }));
  wv = { text: tabText, executeJavaScript: vi.fn(async () => wv.text) };
  globalThis.TabManager = { tabs: [{ id: 't1', url: tabUrl }], getActiveTab: () => ({ id: 't1', url: tabUrl }), createTab: vi.fn() };
  globalThis.WebviewManager = { webviews: new Map([['t1', wv]]) };
  delete globalThis.VexTabPolicy;
}

describe('looking at an open tab', () => {
  beforeEach(() => setup({ tabText: 'Randevu yok\nGiris yapildi' }));

  it('first look is a baseline; a change to an open slot is told once; nothing is clicked or reloaded', async () => {
    expect((await ST.look('w1')).state).toBe('baseline');
    expect(toasts).toHaveLength(0);
    expect((await ST.look('w1')).state).toBe('quiet');
    wv.text = 'Giris yapildi\nMüsait randevu: 14 Kasim';
    const r = await ST.look('w1');
    expect(r.state).toBe('open');
    expect(toasts.some(t => /a slot may be open/.test(t[0]))).toBe(true);
    const n = toasts.length;
    wv.text = 'Giris yapildi\nMüsait randevu: 15 Kasim';
    await ST.look('w1');
    expect(toasts.length).toBe(n);                         // told once within the quiet period
    expect(SW.state().pages.w1.toldAt).toBeGreaterThan(0);
    for (const call of wv.executeJavaScript.mock.calls) expect(call[0]).toMatch(/innerText/);
    expect(wv.executeJavaScript.mock.calls.every(c => !/click|reload|location|submit|scroll/i.test(c[0]))).toBe(true);
  });

  it('the "none" message going away is also an open slot', async () => {
    await ST.look('w1');
    wv.text = 'Giris yapildi\nBir sey degisti';
    expect((await ST.look('w1')).state).toBe('open');
  });

  it('says so when no tab is open on the page, and a tab on another page is not read', async () => {
    setup({ tabUrl: 'https://other.example.com/' });
    expect((await ST.look('w1')).state).toBe('no-tab');
    expect(wv.executeJavaScript).not.toHaveBeenCalled();
  });

  it('never reads a private, Tor or routed tab', async () => {
    globalThis.VexTabPolicy = { canReadWebview: () => false };
    await expect(ST.look('w1')).rejects.toThrow(/private, Tor or routed/);
    expect(wv.executeJavaScript).not.toHaveBeenCalled();
  });

  it('refuses when the slot watcher is off or the page is not in it', async () => {
    await expect(ST.look('nope')).rejects.toThrow(/not in the slot watcher/);
    localStorage.setItem(SW.KEY, JSON.stringify({ on: false, pages: {} }));
    await expect(ST.look('w1')).rejects.toThrow(/switched off/);
  });
});

describe('keeping a tab under watch', () => {
  beforeEach(() => setup());

  it('looks every 15 minutes, through VexJobs, only for the pages kept under watch', async () => {
    expect(await ST.lookAll()).toBe(0);
    ST.setKeep('w1', true);
    expect(VexJobs.every).toHaveBeenCalledWith('slot-watcher-tab', 15 * 60000, expect.any(Function), { feature: 'slot-watcher' });
    expect(await ST.lookAll()).toBe(1);
    expect(wv.executeJavaScript).toHaveBeenCalledTimes(1);
    watches[0].paused = true;
    expect(await ST.lookAll()).toBe(1 - 1);
    watches[0].paused = false;
    ST.setKeep('w1', false);
    expect(await ST.lookAll()).toBe(0);
    expect(ST.keep()).toEqual({});
  });

  it('a problem reading one tab is reported and does not stop the rest', async () => {
    ST.setKeep('w1', true);
    window.VexProblems = { note: vi.fn() };
    wv.executeJavaScript.mockRejectedValueOnce(new Error('the page went away'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await ST.lookAll()).toBe(0);
    expect(VexProblems.note).toHaveBeenCalledWith('Slot watcher', expect.stringMatching(/Passport/), expect.any(Error));
    spy.mockRestore();
    delete window.VexProblems;
  });

  it('keeping a tab says the watcher is off, and keeps nothing, while the watcher is switched off', async () => {
    localStorage.setItem(SW.KEY, JSON.stringify({ on: false, pages: { w1: { label: 'Passport', available: ['müsait'], none: ['randevu yok'], toldAt: 0 } } }));
    const keepCmd = ST.commands().find(c => c.id === 'slottab:keep');
    await keepCmd.action();
    expect(ST.keep()).toEqual({});
    expect(toasts.some(t => /Vex will read this tab/.test(t[0]))).toBe(false);   // it must not claim to read
    expect(toasts.some(t => /switched off/.test(t[0]) && t[1] === 'error')).toBe(true);
  });

  it('the commands act on the page open in the active tab', async () => {
    const cmds = ST.commands();
    expect(cmds.map(c => c.id)).toEqual(['slottab:look', 'slottab:keep']);
    await cmds[1].action();
    expect(ST.keep()).toEqual({ w1: true });
    await cmds[1].action();
    expect(ST.keep()).toEqual({});
    await cmds[0].action();
    expect(toasts.some(t => /Looked at the tab/.test(t[0]))).toBe(true);
    globalThis.TabManager.getActiveTab = () => ({ id: 't9', url: 'https://unrelated.example/' });
    await cmds[0].action();
    expect(toasts.some(t => /not one of the pages/.test(t[0]) && t[1] === 'error')).toBe(true);
  });
});
