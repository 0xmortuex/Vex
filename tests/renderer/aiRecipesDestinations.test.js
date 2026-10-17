// @vitest-environment jsdom
//
// T3-065 (Wave 6): an armed AI recipe can deliver its answer beyond a note: to the Clips inbox (which the Inbox and
// Search everything read) or as a notification a minute later. Each has an Undo, and a destination that cannot take
// the answer makes the run a failed history line, not a silent loss.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
globalThis.VexIcons = require('../../src/renderer/js/vex-icons.js').VexIcons;
const { AiRecipes: AR } = require('../../src/renderer/js/ai-judgement.js');

let fired, ledger, clips, made;
const flush = () => new Promise(r => setTimeout(r, 0));
function seed(extra = {}) {
  const recipe = { id: 'rc_1', name: 'Monday digest', skillId: 'sk_bullets', source: 'https://news.example.com/', repeat: 'weekly', reminderId: 'r1', at: Date.now() + 1000, runs: 0, lastRunAt: 0, armed: true, backend: 'local', ...extra };
  localStorage.setItem('vex.aiRecipes', JSON.stringify({ enabled: true, recipes: [recipe] }));
}

beforeEach(() => {
  localStorage.clear();
  window.showToast = vi.fn();
  clips = []; made = [];
  globalThis.VexSkills = { skills: [{ id: 'sk_bullets', name: 'Bullets', prompt: 'Summarize in 5 bullets.' }], findVariables: () => [] };
  globalThis.AIRouter = { callOn: vi.fn(async () => ({ result: 'one\ntwo\nthree', backend: 'local', model: 'llama' })), callAI: vi.fn() };
  ledger = { note: vi.fn() };
  globalThis.VexLedger = ledger;
  globalThis.VexQuickReminder = { create: vi.fn(async (msg, when, extra) => { const r = { id: 'rem' + (made.length + 1), msg, when, extra }; made.push(r); return r; }), remove: vi.fn(async () => ({ ok: true })) };
  window.vex = {
    pageWatchRender: vi.fn(async () => ({ ok: true, text: 'The page text goes here.', title: 'News', finalUrl: 'https://news.example.com/' })),
    clipsInboxAdd: vi.fn(async (text) => { clips.push(text); return { ok: true, id: 'cl_' + clips.length, count: clips.length }; }),
    clipsInboxRemove: vi.fn(async () => ({ ok: true })),
    reminders: { onClicked: vi.fn(), onFired: vi.fn((cb) => { fired = cb; }) },
  };
  AR._busy = false; AR._started = false; AR._lastFired = null;
  delete globalThis.VexJobs; delete window.GameMode; delete window.BatteryMode;
});
afterEach(() => { for (const k of ['VexSkills', 'AIRouter', 'VexLedger', 'VexQuickReminder']) delete globalThis[k]; delete window.vex; });

describe('the destinations', () => {
  it('arming accepts the four and names them when it refuses another', async () => {
    seed({ armed: false });
    for (const dest of ['history', 'note', 'clips', 'reminder']) {
      await AR.arm('rc_1', true, { dest });
      expect(AR.recipes()[0].dest).toBe(dest);
    }
    await expect(AR.arm('rc_1', true, { dest: 'email' })).rejects.toThrow(/history only, or saved as a note, or kept in the Clips inbox, or shown as a notification/);
  });

  it('the Clips inbox gets the answer with what changed, and the ledger line undoes it', async () => {
    seed({ dest: 'clips' });
    AR.start();
    fired({ id: 'r1', message: 'Run recipe: Monday digest', at: 1 });
    await flush(); await flush();
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatch(/^Monday digest - .*\nFirst run\.\n\none\ntwo\nthree$/);
    const h = AR.recipes()[0].history[0];
    expect(h).toMatchObject({ ok: true, dest: 'clips', delivered: 'kept the answer in the Clips inbox' });
    expect(ledger.note).toHaveBeenCalledWith(expect.objectContaining({ what: expect.stringMatching(/kept the answer in the Clips inbox/), undo: { kind: 'recipe-clip-remove', clipId: 'cl_1' } }));
    await AR.removeClip('cl_1');
    expect(window.vex.clipsInboxRemove).toHaveBeenCalledWith('cl_1');
  });

  it('a notification is a reminder a minute later with the start of the answer and the page, and the ledger line undoes it', async () => {
    seed({ dest: 'reminder' });
    AR.start();
    fired({ id: 'r1', message: 'Run recipe: Monday digest', at: 1 });
    await flush(); await flush();
    expect(made).toHaveLength(1);
    expect(made[0].msg).toBe('Monday digest: one two three');
    expect(made[0].extra).toEqual({ url: 'https://news.example.com/' });
    const dt = made[0].when.getTime() - Date.now();
    expect(dt).toBeGreaterThan(50000); expect(dt).toBeLessThanOrEqual(60000);
    expect(ledger.note).toHaveBeenCalledWith(expect.objectContaining({ undo: { kind: 'recipe-reminder-remove', reminderId: 'rem1' } }));
    await AR.removeReminder('rem1');
    expect(VexQuickReminder.remove).toHaveBeenCalledWith('rem1');
  });

  it('a destination that cannot take the answer makes the run a failed history line, not a silent loss', async () => {
    seed({ dest: 'clips' });
    window.vex.clipsInboxAdd = vi.fn(async () => ({ ok: false }));
    window.VexProblems = { note: vi.fn() };
    AR.start();
    fired({ id: 'r1', message: 'Run recipe: Monday digest', at: 1 });
    await flush(); await flush();
    const h = AR.recipes()[0].history[0];
    expect(h.ok).toBe(false);
    expect(h.error).toMatch(/did not take the answer/);
    expect(window.VexProblems.note).toHaveBeenCalled();
    delete window.VexProblems;
  });

  it('history only still delivers nothing', async () => {
    seed({ dest: 'history' });
    AR.start();
    fired({ id: 'r1', message: 'Run recipe: Monday digest', at: 1 });
    await flush(); await flush();
    expect(clips).toHaveLength(0); expect(made).toHaveLength(0);
    expect(ledger.note.mock.calls[0][0].undo).toBeUndefined();
  });
});
