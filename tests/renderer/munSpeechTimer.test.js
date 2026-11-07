// @vitest-environment jsdom
// A Model UN dossier speech opens the speech timer at its length and keeps the timed run.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const JS = '../../src/renderer/js/';
let M;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  delete globalThis.VexSources;
  delete globalThis.VexSpeechTimer;
  M = fresh(JS + 'mun-dossier.js').VexMunDossier;
});

const withSpeech = (text) => {
  const d = M.create({ country: 'France', committee: 'UNSC', topic: 'Water' });
  M.addItem(d.id, 'speeches', { text, source: { title: 'Own draft, 2026' } });
  return { d, it: M.get(d.id).sections.speeches[0] };
};

describe('speech length and runs', () => {
  it('estimates a length from the words, inside the timer limits', () => {
    expect(M.speechSeconds({ text: Array(130).fill('word').join(' ') })).toBe(60);
    expect(M.speechSeconds({ text: 'one' })).toBe(5);
    expect(M.speechSeconds({ text: Array(20000).fill('w').join(' ') })).toBe(3600);
  });
  it('saves only seconds and a timestamp on the item, newest ten', () => {
    const { d, it } = withSpeech('We urge the council to act.');
    for (let i = 1; i <= 12; i++) M.saveRun(d.id, it.id, { seconds: i, at: 1000 + i });
    const runs = M.get(d.id).sections.speeches[0].runs;
    expect(runs).toHaveLength(10);
    expect(runs[9]).toEqual({ seconds: 12, at: 1012 });
    expect(Object.keys(runs[0]).sort()).toEqual(['at', 'seconds']);
  });
  it('refuses nonsense and a missing item; old items read as before', () => {
    const { d, it } = withSpeech('We urge the council to act.');
    expect(it.runs).toBeUndefined();
    expect(() => M.saveRun(d.id, it.id, { seconds: 0 })).toThrow(/1 to 3600/);
    expect(() => M.saveRun(d.id, 'nope', { seconds: 30 })).toThrow(/gone/);
    expect(() => M.saveRun('nope', it.id, { seconds: 30 })).toThrow(/gone/);
  });
});

describe('Open speech timer', () => {
  it('hands the length and a save callback to the timer, and saves the run', () => {
    const { d, it } = withSpeech(Array(65).fill('word').join(' '));
    globalThis.VexSpeechTimer = { openFor: vi.fn() };
    M.openTimer(d.id, it.id);
    const arg = globalThis.VexSpeechTimer.openFor.mock.calls[0][0];
    expect(arg.seconds).toBe(30);
    arg.save(41);
    expect(M.get(d.id).sections.speeches[0].runs[0].seconds).toBe(41);
  });
  it('says so when the timer is not loaded', () => {
    const { d, it } = withSpeech('We urge the council to act.');
    expect(() => M.openTimer(d.id, it.id)).toThrow(/not available/);
  });
});

describe('the timer side', () => {
  it('openFor sets the clock for this run only and saves the used time', () => {
    globalThis.VexStudyKit = fresh(JS + 'study-kit.js').VexStudyKit;
    const T = fresh(JS + 'speech-timer.js').VexSpeechTimer;
    const save = vi.fn();
    T.openFor({ seconds: 45, label: 'France', save });
    expect(T._run.state.total).toBe(45000);
    expect(T._read().preset).toBe(60);
    expect(() => T._saveAttached()).toThrow(/Run the clock/);
    T._run.state.left = 15000;
    T._saveAttached();
    expect(save).toHaveBeenCalledWith(30);
    T.close();
  });
  it('refuses a length outside 5 to 3600 seconds', () => {
    globalThis.VexStudyKit = fresh(JS + 'study-kit.js').VexStudyKit;
    const T = fresh(JS + 'speech-timer.js').VexSpeechTimer;
    expect(() => T.openFor({ seconds: 2, save() {} })).toThrow(/5 to 3600/);
  });
});
