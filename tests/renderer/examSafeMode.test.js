// @vitest-environment jsdom
// T2-063: exam-day pack and exam safe mode (js/exam-safe-mode.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
let M;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  ({ VexExamSafeMode: M } = fresh(JS + 'exam-safe-mode.js'));
  globalThis.VexExamSafeMode = M;
  window.showToast = vi.fn();
});

describe('packs', () => {
  const pack = (o = {}) => ({ title: 'Physics', entryDoc: 'ID card', hall: 'Hall B', leaveAt: new Date(2026, 11, 18, 7, 30).getTime(), pages: ['https://exam.example/start'], checklist: ['Pens', 'Water'], minutes: 90, ...o });
  it('cleans a pack and refuses a bad page address', () => {
    expect(M.cleanPack(pack())).toMatchObject({ title: 'Physics', minutes: 90, checklist: [{ text: 'Pens', done: false }, { text: 'Water', done: false }] });
    expect(() => M.cleanPack(pack({ pages: ['ftp://x'] }))).toThrow(/http/);
    expect(() => M.cleanPack(pack({ pages: ['nonsense'] }))).toThrow(/web address/);
    expect(() => M.cleanPack(pack({ title: ' ' }))).toThrow(/title/);
  });
  it('ticks the checklist and writes the card text', () => {
    const p = M.addPack(pack());
    M.tick(p.id, 0, true);
    const got = M.pack(p.id);
    expect(M.progress(got)).toEqual({ done: 1, total: 2 });
    const text = M.cardText(got, 0);
    expect(text).toContain('Where: Hall B');
    expect(text).toContain('[x] Pens');
    expect(text).toContain('[ ] Water');
  });
});

describe('exam mode', () => {
  it('holds sync and updates while on, and releases them when it ends', () => {
    expect(M.holds('sync')).toBe(false);
    M.activate(null);
    expect(M.active()).toBe(true);
    expect(M.holds('sync')).toBe(true);
    expect(M.holds('updates')).toBe(true);
    expect(M.holds('other')).toBe(false);
    expect(document.getElementById('vex-exam-bar')).not.toBeNull();
    expect(M.deactivate('ended')).toBe(true);
    expect(M.active()).toBe(false);
    expect(document.getElementById('vex-exam-bar')).toBeNull();
  });
  it('ends by itself when its time is up', () => {
    M.activate(null, Date.now() - 3 * 3600e3);          // started three hours ago, lasts two
    M._c = null;
    expect(M.active()).toBe(false);
    expect(JSON.parse(localStorage.getItem('vex.examMode')).active).toBeNull();
  });
  it('stops close and reload keys only for an online exam', () => {
    const p = M.addPack({ title: 'Online', online: true, minutes: 60 });
    M.activate(p.id);
    const e = new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, cancelable: true });
    document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    M.deactivate();
    const e2 = new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, cancelable: true });
    document.dispatchEvent(e2);
    expect(e2.defaultPrevented).toBe(false);
  });
  it('tells AttentionState it is quiet, and is not used while switched off', () => {
    const { AttentionState } = fresh(JS + 'attention-state.js');
    globalThis.AttentionState = AttentionState;
    expect(AttentionState.get().sources.map(s => s.id)).not.toContain('exam');
    M.activate(null);
    M._c = null;
    expect(AttentionState.get()).toMatchObject({ quiet: true, reason: 'exam' });
    M.setEnabled(false);
    expect(M.active()).toBe(false);
  });
  it('refuses to start twice, and to delete a pack in use', () => {
    const p = M.addPack({ title: 'x', minutes: 30 });
    M.activate(p.id);
    expect(() => M.activate(p.id)).toThrow(/already on/);
    expect(() => M.removePack(p.id)).toThrow(/in use/);
  });
});
