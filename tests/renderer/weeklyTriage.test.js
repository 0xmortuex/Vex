// @vitest-environment jsdom
//
// T2-071: one weekly triage list over read-later, clips and downloads (js/weekly-triage.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const NOW = new Date(2026, 9, 14, 10, 0, 0).getTime();
const DAY = 86400000;
const notes = () => JSON.parse(localStorage.getItem('vex.notes') || '[]');

let T, srcs, readLater, removeClip, dl;
beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  globalThis.VexPlanKit = fresh(JS + 'plan-kit.js').VexPlanKit;
  globalThis.OpenTasks = fresh(JS + 'open-tasks.js').OpenTasks;
  ({ VexTriage: T } = fresh(JS + 'weekly-triage.js'));
  readLater = [
    { id: 'a', url: 'https://a.test/long', title: 'A long read', at: NOW - 20 * DAY },
    { id: 'b', url: 'https://b.test/', title: 'Read already', at: NOW - 3 * DAY, read: true },
    { id: 'c', url: 'https://c.test/', title: 'New one', at: NOW - 1 * DAY },
  ];
  dl = [
    { id: 'd1', filename: 'report.pdf', path: 'C:\\Downloads\\report.pdf', state: 'completed', startedAt: new Date(NOW - 5 * DAY).toISOString() },
    { id: 'd2', filename: 'gone.zip', path: 'C:\\Downloads\\gone.zip', state: 'completed', missing: true, startedAt: new Date(NOW - 5 * DAY).toISOString() },
    { id: 'd3', filename: 'secret.bin', path: 'C:\\x', state: 'completed', ephemeral: true, startedAt: new Date(NOW - 5 * DAY).toISOString() },
    { id: 'd4', filename: 'old.iso', path: 'C:\\old.iso', state: 'completed', startedAt: new Date(NOW - 90 * DAY).toISOString() },
    { id: 'd5', filename: 'part.crdownload', path: 'C:\\p', state: 'progressing', startedAt: new Date(NOW).toISOString() },
  ];
  srcs = {
    readLater: () => readLater,
    clips: async () => [{ id: 'k1', text: 'remember to rename the repo', at: NOW - 2 * DAY }],
    downloads: () => dl,
  };
  removeClip = vi.fn(async () => ({ ok: true }));
  window.vex = { clipsInboxRemove: removeClip };
  globalThis.ReadLater = { items: readLater, removeWithUndo: vi.fn((match) => readLater.filter(match).length) };
  globalThis.DownloadsPanel = { downloads: dl, _deleteFile: vi.fn(async (id) => { dl.find(x => x.id === id).missing = true; }) };
  globalThis.vexConfirm = vi.fn(async () => true);
});

describe('collect() and rank()', () => {
  it('reads three stores, skipping what is read, missing, private, too old or unfinished', async () => {
    const { items, errors } = await T.collect(NOW, srcs);
    expect(items.map(i => i.id).sort()).toEqual(['cp:k1', 'dl:d1', 'rl:a', 'rl:c']);
    expect(errors).toEqual([]);
  });
  it('lists the oldest first and leaves out what was triaged', async () => {
    const { items } = await T.collect(NOW, srcs);
    expect(T.rank(items, {}).map(i => i.id)).toEqual(['rl:a', 'dl:d1', 'cp:k1', 'rl:c']);
    expect(T.rank(items, { 'rl:a': 1 }).map(i => i.id)).toEqual(['dl:d1', 'cp:k1', 'rl:c']);
  });
  it('names a store that cannot be read and still answers from the others', async () => {
    const { items, errors } = await T.collect(NOW, { ...srcs, clips: async () => { throw new Error('the capture inbox did not answer'); } });
    expect(items.some(i => i.source === 'read-later')).toBe(true);
    expect(errors).toEqual(['clips: the capture inbox did not answer']);
  });
});

describe('pressure() and tabDebt()', () => {
  it('says intake outpaces triage when this week brought in more than was sorted', () => {
    const items = [1, 2, 3, 4, 5].map(i => ({ at: NOW - i * 3600000 }));
    expect(T.pressure(items, [NOW - 1000], NOW)).toEqual({ intake: 5, triaged: 1, outpaces: true });
    expect(T.pressure(items, [1, 2, 3, 4, 5].map(i => NOW - i), NOW).outpaces).toBe(false);
    expect(T.pressure([{ at: NOW - 30 * DAY }], [], NOW).intake).toBe(0);
  });
  it('counts only web tabs that have a last-used time older than a week', () => {
    const tabs = [
      { url: 'https://a.test/', _lastActive: NOW - 9 * DAY }, { url: 'https://b.test/', _lastActive: NOW - 1 * DAY },
      { url: 'https://c.test/' },                                            // no stamp: unknown, not counted
      { url: 'https://d.test/', pinned: true, _lastActive: NOW - 20 * DAY },
      { url: 'vex://start', _lastActive: NOW - 20 * DAY }, { url: 'https://e.test/', _lastActive: NOW - 20 * DAY },
    ];
    expect(T.tabDebt(tabs, NOW)).toBe(2);
    expect(T.tabDebt(tabs, NOW, t => t.url !== 'https://e.test/')).toBe(1);
  });
});

describe('act()', () => {
  const get = async (id) => (await T.collect(NOW, srcs)).items.find(i => i.id === id);

  it('Keep leaves the item where it is and records it as sorted', async () => {
    await T.act(await get('rl:a'), 'keep', NOW);
    expect(readLater).toHaveLength(3);
    expect(T.done()['rl:a']).toBe(NOW);
    expect(T.log()).toEqual([NOW]);
  });
  it('Note makes a note from each kind of item and keeps the original', async () => {
    await T.act(await get('rl:a'), 'note', NOW);
    await T.act(await get('cp:k1'), 'note', NOW);
    await T.act(await get('dl:d1'), 'note', NOW);
    const n = notes();
    expect(n).toHaveLength(3);
    expect(n.map(x => x.content).join('|')).toContain('https://a.test/long');
    expect(n.map(x => x.content).join('|')).toContain('remember to rename the repo');
    expect(n.map(x => x.content).join('|')).toContain('report.pdf');
    expect(readLater).toHaveLength(3);
  });
  it('Delete removes a read-later item or a clip, with the store own undo for read-later', async () => {
    await T.act(await get('rl:c'), 'delete', NOW);
    expect(ReadLater.removeWithUndo).toHaveBeenCalledTimes(1);
    await T.act(await get('cp:k1'), 'delete', NOW);
    expect(removeClip).toHaveBeenCalledWith('k1');
  });
  it('Delete on a download asks once, then sends the file to the Recycle Bin through the panel', async () => {
    await T.act(await get('dl:d1'), 'delete', NOW);
    expect(vexConfirm).toHaveBeenCalledTimes(1);
    expect(DownloadsPanel._deleteFile).toHaveBeenCalledWith('d1');
    expect(T.done()['dl:d1']).toBe(NOW);
  });
  it('a "no" to the confirmation changes nothing', async () => {
    vexConfirm.mockResolvedValueOnce(false);
    expect(await T.act(await get('dl:d1'), 'delete', NOW)).toBe(false);
    expect(DownloadsPanel._deleteFile).not.toHaveBeenCalled();
    expect(T.done()['dl:d1']).toBeUndefined();
  });
  it('refuses an unknown action and a clip the inbox would not remove', async () => {
    await expect(T.act(await get('rl:a'), 'archive', NOW)).rejects.toThrow(/Keep, Note or Delete/);
    removeClip.mockResolvedValueOnce({ ok: false, error: 'locked' });
    await expect(T.act(await get('cp:k1'), 'delete', NOW)).rejects.toThrow(/locked/);
    expect(T.done()['cp:k1']).toBeUndefined();
  });
  it('remembers 500 at most', () => {
    for (let i = 0; i < 510; i++) T._record('x' + i, NOW + i);
    expect(Object.keys(T.done())).toHaveLength(500);
    expect(T.log()).toHaveLength(300);
  });
});

describe('brief module', () => {
  it('shows the count and the pressure line with a Sort now action', async () => {
    const m = T.briefModule();
    T.collect = async () => ({ items: [{ id: 'rl:a', at: Date.now() - 1000 }, { id: 'rl:b', at: Date.now() - 1000 }, { id: 'rl:c', at: Date.now() - 1000 }, { id: 'rl:d', at: Date.now() - 1000 }], errors: [] });
    const out = await m.build();
    expect(out.lines[0].text).toMatch(/4 items wait/);
    expect(out.lines[0].detail).toMatch(/Intake outpaces triage/);
    expect(out.lines[0].actions[0].label).toBe('Sort now');
  });
});
