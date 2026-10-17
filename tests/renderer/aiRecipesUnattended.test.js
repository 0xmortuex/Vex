// @vitest-environment jsdom
//
// Wave 5, T3-065: an ARMED AI recipe runs by itself when its reminder fires (local model by default,
// through the sensitivity gate on Auto), keeps a history with a diff, delivers to a note, and a
// recipe that was never armed still only opens and waits.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
globalThis.VexIcons = require('../../src/renderer/js/vex-icons.js').VexIcons;
const { AiRecipes: AR } = require('../../src/renderer/js/ai-judgement.js');
const { VexSensitivity } = require('../../src/renderer/js/ai-sensitivity.js');

let fired, notes, ledger, callOn, callAI;

function seed(extra = {}) {
  const recipe = { id: 'rc_1', name: 'Monday digest', skillId: 'sk_bullets', source: 'https://news.example.com/', repeat: 'weekly', reminderId: 'r1', at: Date.now() + 1000, runs: 0, lastRunAt: 0, ...extra };
  localStorage.setItem('vex.aiRecipes', JSON.stringify({ enabled: true, recipes: [recipe] }));
  return recipe;
}
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  window.showToast = vi.fn();
  notes = [];
  globalThis.NotesPanel = {
    notes,
    createNote() { notes.unshift({ id: 'note_' + notes.length, title: '', content: '' }); },
    _fillEditor() {}, save() {}, render() {},
  };
  globalThis.VexSkills = { skills: [{ id: 'sk_bullets', name: 'Bullets', prompt: 'Summarize in 5 bullets.' }], findVariables: () => [] };
  callOn = vi.fn(async () => ({ result: 'one\ntwo\nthree', backend: 'local', model: 'llama' }));
  callAI = vi.fn(async () => ({ result: 'cloud text', backend: 'cloud', model: '' }));
  globalThis.AIRouter = { callOn, callAI };
  ledger = { note: vi.fn() };
  globalThis.VexLedger = ledger;
  window.vex = {
    pageWatchRender: vi.fn(async () => ({ ok: true, text: 'The page text goes here.', title: 'News', finalUrl: 'https://news.example.com/' })),
    reminders: { onClicked: vi.fn(), onFired: vi.fn((cb) => { fired = cb; }) },
  };
  AR._busy = false; AR._started = false; AR._lastFired = null;
  delete globalThis.VexJobs;
  delete window.GameMode; delete window.BatteryMode;
});
afterEach(() => { for (const k of ['NotesPanel', 'VexSkills', 'AIRouter', 'VexLedger']) delete globalThis[k]; delete window.vex; });

describe('arming', () => {
  it('is off by default and refuses a recipe with no time', async () => {
    const r = seed();
    expect(AR.isArmed(r)).toBe(false);
    seed({ reminderId: null });
    await expect(AR.arm('rc_1', true)).rejects.toThrow(/Give the recipe a time first/);
    seed();
    await expect(AR.arm('rc_1', true, { dest: 'email' })).rejects.toThrow(/history or to a note/);
    await expect(AR.arm('rc_1', true, { backend: 'cloud' })).rejects.toThrow(/local model or on Auto/);
  });
  it('arms and disarms, with a ledger line each time', async () => {
    seed();
    await AR.arm('rc_1', true, { dest: 'note' });
    expect(AR.recipes()[0]).toMatchObject({ armed: true, dest: 'note', backend: 'local' });
    await AR.arm('rc_1', false);
    expect(AR.recipes()[0].armed).toBe(false);
    expect(ledger.note).toHaveBeenCalledTimes(2);
  });
});

describe('what runs when a reminder fires', () => {
  it('does nothing for a recipe that was never armed', async () => {
    seed();
    AR.start();
    fired({ id: 'r1', message: 'Run recipe: Monday digest', at: 1 });
    await flush();
    expect(callOn).not.toHaveBeenCalled();
    expect(window.vex.pageWatchRender).not.toHaveBeenCalled();
  });
  it('runs an armed recipe on the local model, reading the page, and keeps a history line', async () => {
    seed({ armed: true, dest: 'history', backend: 'local' });
    AR.start();
    fired({ id: 'r1', message: 'Run recipe: Monday digest', at: 1 });
    await flush(); await flush();
    expect(window.vex.pageWatchRender).toHaveBeenCalledWith({ url: 'https://news.example.com/' });
    expect(callOn).toHaveBeenCalledWith('local', 'aiRecipe', expect.objectContaining({ message: 'Summarize in 5 bullets.', pageContext: expect.objectContaining({ text: 'The page text goes here.' }) }));
    expect(callAI).not.toHaveBeenCalled();
    const r = AR.recipes()[0];
    expect(r.history).toHaveLength(1);
    expect(r.history[0]).toMatchObject({ ok: true, backend: 'local', cloud: false, first: true, dest: 'history' });
    expect(r.history[0].text).toBeUndefined();
    expect(r.lastText).toBe('one\ntwo\nthree');
    expect(ledger.note).toHaveBeenCalledWith(expect.objectContaining({ feature: 'ai-recipes', what: expect.stringMatching(/by itself/) }));
  });
  it('the same firing is not run twice', async () => {
    seed({ armed: true });
    AR.start();
    const p = { id: 'r1', message: 'Run recipe: Monday digest', at: 5 };
    fired(p); fired(p);
    await flush(); await flush();
    expect(callOn).toHaveBeenCalledTimes(1);
  });
  it('on Auto it goes through AIRouter.callAI, where the sensitivity gate sits, and a background feature is never asked', async () => {
    seed({ armed: true, backend: 'auto' });
    const e = await AR.runUnattended('rc_1', 'test');
    expect(callAI).toHaveBeenCalledWith('aiRecipe', expect.any(Object));
    expect(e.cloud).toBe(true);
    expect(VexSensitivity.BACKGROUND).toContain('aiRecipe');
    const d = VexSensitivity.decide('aiRecipe', { message: 'x', dataClass: 'mail', pageContext: { url: 'https://mail.google.com/', text: 'hi' } });
    expect(d.verdict).toBe('refuse');
  });
  it('a held-back run (game or battery) is a history line, not a silent skip', async () => {
    seed({ armed: true });
    window.GameMode = { holdingAi: () => true };
    const e = await AR.runUnattended('rc_1', 't');
    expect(e.ok).toBe(false);
    expect(e.error).toMatch(/a game is running/);
    expect(callOn).not.toHaveBeenCalled();
    expect(AR.history('rc_1')).toHaveLength(1);
  });
  it('a failure is recorded with its reason and a problem note, and a skill that asks questions is refused', async () => {
    seed({ armed: true });
    callOn.mockRejectedValueOnce(new Error('Ollama is not running'));
    globalThis.VexProblems = { note: vi.fn() };
    const e = await AR.runUnattended('rc_1', 't');
    expect(e).toMatchObject({ ok: false, error: 'Ollama is not running' });
    expect(VexProblems.note).toHaveBeenCalled();
    VexSkills.findVariables = () => [{ name: 'ask' }];
    const e2 = await AR.runUnattended('rc_1', 't');
    expect(e2.error).toMatch(/cannot be answered while you are away/);
    delete globalThis.VexProblems;
  });
  it('waits for a quiet machine through VexJobs.heavy and reports a refusal', async () => {
    seed({ armed: true });
    globalThis.VexJobs = { heavy: vi.fn(async () => ({ ran: false, reason: 'a game is running' })) };
    const e = await AR.runUnattended('rc_1', 't');
    expect(VexJobs.heavy).toHaveBeenCalledWith('AI recipe: Monday digest', expect.any(Function), { kind: 'ai-ask', feature: 'ai-recipes' });
    expect(e.error).toMatch(/Held back: a game is running/);
    delete globalThis.VexJobs;
  });
});

describe('diff, history and the note destination', () => {
  it('counts the lines added and removed against the last answer', () => {
    expect(AR.diff('a\nb\nc', 'a\nc\nd\ne')).toMatchObject({ added: 2, removed: 1, first: false });
    expect(AR.diff('', 'a')).toMatchObject({ added: 1, removed: 0, first: true });
  });
  it('a second run reports the change, keeps only ten lines of history, and saves a note that can be undone', async () => {
    seed({ armed: true, dest: 'note' });
    await AR.runUnattended('rc_1', 't');
    callOn.mockResolvedValue({ result: 'one\ntwo\nfour\nfive', backend: 'local', model: 'llama' });
    const e = await AR.runUnattended('rc_1', 't');
    expect(e).toMatchObject({ added: 2, removed: 1, first: false });
    expect(notes).toHaveLength(2);
    expect(notes[0].content).toMatch(/Since the last run: 2 lines added, 1 removed/);
    const token = ledger.note.mock.calls.map(c => c[0]).filter(l => l.undo).pop().undo;
    expect(token.kind).toBe('recipe-note-remove');
    AR.removeNote(token.noteId);
    expect(notes).toHaveLength(1);
    expect(() => AR.removeNote(token.noteId)).toThrow(/already gone/);
    for (let i = 0; i < 12; i++) await AR.runUnattended('rc_1', 't');
    expect(AR.history('rc_1')).toHaveLength(AR.HISTORY_MAX);
  });
});
