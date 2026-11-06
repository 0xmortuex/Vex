// @vitest-environment jsdom
// Voice control's window side (js/voice-control.js) with a FAKE microphone and a FAKE engine: when the microphone is opened and
// closed, when a recording ends (pause, nobody spoke, the hard maximum), what each decision shows, that nothing runs before its
// second / its confirmation, that dictation is typed only after Insert and never into a secret field, and that the audio is dropped.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { VexTr } = require('../../src/renderer/js/vex-tr.js');
globalThis.VexTr = VexTr;
globalThis.VexTrLemma = require('../../src/renderer/js/turkish-lemma.js').VexTrLemma;
globalThis.VexVoiceMatch = require('../../src/renderer/js/voice-match.js').VexVoiceMatch;
const { VexVoice: V } = require('../../src/renderer/js/voice-control.js');

const RATE = 16000;
const loud = (seconds) => new Float32Array(Math.round(RATE * seconds)).fill(0.2);
const quiet = (seconds) => new Float32Array(Math.round(RATE * seconds));

let tracks, proc, vexApi, executed, opened;
function fakeAudio() {
  tracks = [{ stop: vi.fn() }];
  proc = null; opened = 0;
  globalThis.navigator.mediaDevices = { getUserMedia: vi.fn(async () => { opened++; return { getTracks: () => tracks }; }), enumerateDevices: vi.fn(async () => []) };
  globalThis.AudioContext = class {
    constructor() { this.destination = {}; this.closed = false; }
    createMediaStreamSource() { return { connect() {} }; }
    createScriptProcessor() { proc = { connect() {}, disconnect: vi.fn(), onaudioprocess: null }; return proc; }
    close() { this.closed = true; return Promise.resolve(); }
  };
}
// After the recording ends the real browser stops delivering audio: so does the fake.
const feed = (block) => { if (proc.onaudioprocess) proc.onaudioprocess({ inputBuffer: { getChannelData: () => block } }); };
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const panel = () => document.getElementById('vex-voice-panel');
const buttons = () => [...panel().querySelectorAll('button')].map(b => b.textContent);
const click = (label) => [...panel().querySelectorAll('button')].find(b => b.textContent.startsWith(label)).click();

function commandBar(extra = []) {
  executed = [];
  globalThis.CommandBar = {
    commands: [
      { id: 'new', label: 'New Tab', action() {} },
      { id: 'downloads', label: 'Downloads', action() {} },
      { id: 'clear-data', label: 'Clear Browsing Data', action() {} },
      { id: 'zoom-in', label: 'Zoom In', action() {} },
      { id: 'zoom-out', label: 'Zoom Out', action() {} },
      ...extra,
    ],
    _shown: () => true,
    _execute: vi.fn((c) => { executed.push(c.id); }),
  };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="top-bar-right"><button id="btn-toggle-ai"></button></div><input id="field" type="text"><input id="pw" type="password">';
  document.head.innerHTML = '';
  vi.useFakeTimers();
  fakeAudio();
  commandBar();
  vexApi = {
    voiceStatus: vi.fn(async () => ({ platformOk: true, testSeam: false, engine: { installed: true }, models: { base: { installed: true }, small: { installed: false } } })),
    voiceTranscribe: vi.fn(async () => ({ text: 'new tab', ms: 5 })),
    voiceCancel: vi.fn(async () => true),
    voiceTestClip: vi.fn(async () => new Uint8Array(RATE * 2)),
  };
  window.vex = vexApi;
  window.showToast = vi.fn();
  localStorage.setItem(V.KEYS.enabled, 'true');
  V._run = null;
});
afterEach(() => { V.cancel(); document.getElementById('vex-voice-panel')?.remove(); vi.useRealTimers(); delete window.vex; });

// Starts listening, speaks for `s` seconds, then stays quiet until the pause ends the recording.
async function speakAndPause(opts = { kind: 'command' }, s = 1) {
  const p = V.listen(opts);
  await flush();
  feed(loud(s));
  for (let i = 0; i < 4; i++) feed(quiet(0.5));      // 2 s of silence: longer than the 1.5 s default
  await flush();
  return p;
}

describe('pure parts', () => {
  it('converts samples to little-endian 16-bit PCM', () => {
    const b = V.floatToPcm16(new Float32Array([0, 1, -1, 0.5, 2, -2]));
    const v = new DataView(b.buffer);
    expect([0, 1, 2, 3, 4, 5].map(i => v.getInt16(i * 2, true))).toEqual([0, 32767, -32768, 16383, 32767, -32768]);
    expect(b.length).toBe(12);
  });
  it('stops after a pause that follows speech, not before and not on leading silence', () => {
    const e = V.createEndpointer({ silenceS: 1.5 });
    expect(e.push(quiet(1)).stop).toBe(null);
    expect(e.push(loud(0.5)).voiced).toBe(true);
    expect(e.push(quiet(1)).stop).toBe(null);
    expect(e.push(quiet(0.4)).stop).toBe(null);
    expect(e.push(quiet(0.2)).stop).toBe('silence');
  });
  it('a word in the middle resets the pause', () => {
    const e = V.createEndpointer({ silenceS: 1 });
    e.push(loud(0.5)); e.push(quiet(0.9)); e.push(loud(0.2));
    expect(e.push(quiet(0.9)).stop).toBe(null);
    expect(e.push(quiet(0.2)).stop).toBe('silence');
  });
  it('gives up when nobody speaks', () => {
    const e = V.createEndpointer({ noSpeechS: 6 });
    for (let i = 0; i < 11; i++) expect(e.push(quiet(0.5)).stop).toBe(null);
    expect(e.push(quiet(0.5)).stop).toBe('no-speech');
  });
  it('has a hard maximum even if the person never stops talking', () => {
    const e = V.createEndpointer({ maxS: 30 });
    let stop = null, s = 0;
    while (!stop && s < 40) { stop = e.push(loud(1)).stop; s++; }
    expect(stop).toBe('max');
    expect(s).toBe(30);
    expect(V.MAX_SECONDS).toBeLessThanOrEqual(30);
  });
  it('knows secret fields', () => {
    const pw = document.createElement('input'); pw.type = 'password';
    const otp = document.createElement('input'); otp.setAttribute('autocomplete', 'one-time-code');
    const card = document.createElement('input'); card.setAttribute('autocomplete', 'cc-number');
    const text = document.createElement('input'); text.type = 'text';
    expect([pw, otp, card].map(e => V.isSecretField(e))).toEqual([true, true, true]);
    expect(V.isSecretField(text)).toBe(false);
    expect(V.isEditable(text)).toBe(true);
    expect(V.isEditable(pw)).toBe(false);
  });
});

describe('the microphone', () => {
  it('is not opened until a recording starts, and is closed the moment it ends', async () => {
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    const p = V.listen({ kind: 'command' });
    await flush();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(tracks[0].stop).not.toHaveBeenCalled();
    expect(V.isListening()).toBe(true);
    feed(loud(1)); for (let i = 0; i < 4; i++) feed(quiet(0.5));
    await flush();
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(proc.disconnect).toHaveBeenCalled();
    expect(V.isListening()).toBe(false);
    await p;
  });
  it('shows an unmissable panel while listening, with Stop and Cancel, and announces it', async () => {
    const p = V.listen({ kind: 'command' });
    await flush();
    expect(panel().dataset.state).toBe('listening');
    expect(panel().getAttribute('role')).toBe('dialog');
    expect(buttons()).toEqual(expect.arrayContaining(['Stop', 'Cancel (Esc)']));
    expect(document.getElementById('vex-voice-live').textContent).toBe('Listening');
    V.cancel(); await p;
    expect(panel()).toBe(null);
  });
  it('Esc and Cancel close the microphone and throw the audio away without asking the engine', async () => {
    const p = V.listen({ kind: 'command' });
    await flush();
    feed(loud(1));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await p;
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(vexApi.voiceTranscribe).not.toHaveBeenCalled();
    expect(panel()).toBe(null);
  });
  it('a recording with no speech in it never reaches the engine', async () => {
    const p = V.listen({ kind: 'command' });
    await flush();
    for (let i = 0; i < 14; i++) feed(quiet(0.5));    // 7 s of silence: gives up
    await flush(); await p;
    expect(vexApi.voiceTranscribe).not.toHaveBeenCalled();
    expect(panel().textContent).toContain('Nothing was heard.');
  });
  it('is never opened when the feature is off, or when the engine and model are not downloaded', async () => {
    localStorage.setItem(V.KEYS.enabled, 'false');
    await expect(V.listen({ kind: 'command' })).rejects.toThrow(/switched off/);
    localStorage.setItem(V.KEYS.enabled, 'true');
    vexApi.voiceStatus = vi.fn(async () => ({ platformOk: true, engine: { installed: false }, models: { base: { installed: false } } }));
    await expect(V.listen({ kind: 'command' })).rejects.toThrow(/needs its speech engine and model/);
    vexApi.voiceStatus = vi.fn(async () => ({ platformOk: false, engine: {}, models: {} }));
    await expect(V.listen({ kind: 'command' })).rejects.toThrow(/Windows/);
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });
  it('says so when Windows refuses the microphone, and leaves nothing open', async () => {
    navigator.mediaDevices.getUserMedia = vi.fn(async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); });
    await expect(V.listen({ kind: 'command' })).rejects.toThrow(/could not use the microphone/);
    expect(V.isBusy()).toBe(false);
    expect(panel()).toBe(null);
  });
  it('asks the engine with the model and language that are set, and drops the audio afterwards', async () => {
    localStorage.setItem(V.KEYS.model, 'small'); localStorage.setItem(V.KEYS.language, 'tr');
    vexApi.voiceStatus = vi.fn(async () => ({ platformOk: true, engine: { installed: true }, models: { base: { installed: true }, small: { installed: true } } }));
    await speakAndPause();
    const [pcm, opts] = vexApi.voiceTranscribe.mock.calls[0];
    expect(pcm).toBeInstanceOf(Uint8Array);
    expect(pcm.length).toBe(RATE * 2.5 * 2);          // 1 s of speech and the 1.5 s pause that ended it
    expect(opts).toEqual({ model: 'small', language: 'tr' });
    expect(V._run).toBe(null);
  });
  it('writes the audio nowhere: no storage entry holds it and nothing is logged', async () => {
    const logs = ['log', 'info', 'warn', 'error'].map(k => vi.spyOn(console, k).mockImplementation(() => {}));
    await speakAndPause();
    for (const l of logs) expect(l).not.toHaveBeenCalled();
    for (let i = 0; i < localStorage.length; i++) expect(localStorage.getItem(localStorage.key(i)).length).toBeLessThan(200);
    logs.forEach(l => l.mockRestore());
  });
});

describe('commands', () => {
  it('a clear command is shown with what was heard for one second, with Cancel, and then runs', async () => {
    await speakAndPause();
    expect(panel().textContent).toContain('“new tab”');
    expect(panel().textContent).toContain('Running: New Tab');
    expect(buttons()).toContain('Cancel (Esc)');
    expect(executed).toEqual([]);
    vi.advanceTimersByTime(900);
    expect(executed).toEqual([]);
    vi.advanceTimersByTime(150);
    expect(executed).toEqual(['new']);
    expect(panel()).toBe(null);
  });
  it('Cancel during that second stops the command', async () => {
    await speakAndPause();
    click('Cancel');
    vi.advanceTimersByTime(3000);
    expect(executed).toEqual([]);
  });
  it('Esc during that second stops it too', async () => {
    await speakAndPause();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    vi.advanceTimersByTime(3000);
    expect(executed).toEqual([]);
  });
  it('Run now does not wait', async () => {
    await speakAndPause();
    click('Run now');
    expect(executed).toEqual(['new']);
  });
  it('an unsure phrase offers "Did you mean" and runs nothing until one is clicked', async () => {
    vexApi.voiceTranscribe = vi.fn(async () => ({ text: 'zoom', ms: 5 }));
    await speakAndPause();
    expect(panel().textContent).toContain('Did you mean:');
    expect(buttons()).toEqual(expect.arrayContaining(['Zoom In', 'Zoom Out', 'None of these']));
    vi.advanceTimersByTime(10000);
    expect(executed).toEqual([]);
    click('Zoom Out');
    expect(executed).toEqual(['zoom-out']);
  });
  it('words that match nothing say so and run nothing', async () => {
    vexApi.voiceTranscribe = vi.fn(async () => ({ text: 'what is the weather in Paris', ms: 5 }));
    await speakAndPause();
    expect(panel().textContent).toContain('No command is close to that');
    vi.advanceTimersByTime(10000);
    expect(executed).toEqual([]);
  });
  it('Turkish speech runs the Turkish-named command', async () => {
    vexApi.voiceTranscribe = vi.fn(async () => ({ text: 'Yeni sekme.', ms: 5 }));
    const twin = (s) => ({ 'New Tab': 'Yeni Sekme' }[s] || '');
    globalThis.VexSmartSearch = { otherLanguage: twin };
    await speakAndPause();
    vi.advanceTimersByTime(1100);
    expect(executed).toEqual(['new']);
    delete globalThis.VexSmartSearch;
  });
  it('the voice never picks its own commands', async () => {
    commandBar([{ id: 'voice-settings', label: 'Voice control settings', action() {} }]);
    vexApi.voiceTranscribe = vi.fn(async () => ({ text: 'voice control settings', ms: 5 }));
    await speakAndPause();
    expect(executed).toEqual([]);
  });
});

describe('destructive commands always ask', () => {
  const say = async (text) => { vexApi.voiceTranscribe = vi.fn(async () => ({ text, ms: 5 })); await speakAndPause(); };
  it('never runs "clear browsing data" on its own, however long you wait', async () => {
    await say('clear browsing data');
    expect(panel().textContent).toContain('asks first');
    vi.advanceTimersByTime(60000);
    expect(executed).toEqual([]);
    expect(buttons()).toEqual(expect.arrayContaining(['Cancel', 'Answer by voice']));
  });
  it('runs it only when the Run button is clicked', async () => {
    await say('clear browsing data');
    click('Run Clear Browsing Data');
    expect(executed).toEqual(['clear-data']);
  });
  it('Cancel on the question runs nothing', async () => {
    await say('clear browsing data');
    click('Cancel');
    vi.advanceTimersByTime(5000);
    expect(executed).toEqual([]);
    expect(panel()).toBe(null);
  });
  it('can be answered by voice: "yes" runs it, "no" and anything else do not', async () => {
    for (const [answer, ran] of [['Yes.', 1], ['evet', 1], ['no', 0], ['maybe later', 0]]) {
      executed.length = 0;
      await say('clear browsing data');
      vexApi.voiceTranscribe = vi.fn(async () => ({ text: answer, ms: 5 }));
      click('Answer by voice');
      await flush();
      feed(loud(0.6)); for (let i = 0; i < 4; i++) feed(quiet(0.5));
      await flush();
      expect(executed.length, answer).toBe(ran);
      document.getElementById('vex-voice-panel')?.remove(); V._run = null;
    }
  });
  it('an answer is only heard after the person asks for it: the question itself opens no microphone', async () => {
    await say('clear browsing data');
    opened = 0;
    vi.advanceTimersByTime(20000);
    expect(opened).toBe(0);
  });
  it('words that ask to delete never run a harmless match', async () => {
    await say('delete downloads');
    vi.advanceTimersByTime(20000);
    expect(executed).toEqual([]);
    expect(panel().textContent).toContain('nothing runs by itself');
  });
});

describe('dictation', () => {
  const focusField = (id = 'field') => { const el = document.getElementById(id); el.focus(); return el; };
  beforeEach(() => { vexApi.voiceTranscribe = vi.fn(async () => ({ text: 'merhaba dünya', ms: 5 })); });

  it('shows the words in a box to correct and types them only when Insert is pressed', async () => {
    const field = focusField();
    await speakAndPause({ kind: 'dictate' });
    expect(field.value).toBe('');
    const ta = panel().querySelector('textarea');
    expect(ta.value).toBe('merhaba dünya');
    ta.value = 'merhaba dünya!';
    click('Insert');
    await flush();
    expect(field.value).toBe('merhaba dünya!');
    expect(panel()).toBe(null);
  });
  it('Esc throws the transcript away and types nothing', async () => {
    const field = focusField();
    await speakAndPause({ kind: 'dictate' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(field.value).toBe('');
    expect(panel()).toBe(null);
  });
  it('adds a space when the field already has text', async () => {
    const field = focusField(); field.value = 'Dear Ali,'; field.setSelectionRange(9, 9);
    await speakAndPause({ kind: 'dictate' });
    click('Insert'); await flush();
    expect(field.value).toBe('Dear Ali, merhaba dünya');
  });
  it('never starts in a password field: the microphone is not even opened', async () => {
    focusField('pw');
    await expect(V.listen({ kind: 'dictate' })).rejects.toThrow(/never types into a password/);
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(V.isBusy()).toBe(false);
  });
  it('refuses at the last moment if the field turned into a password field while the words were being checked', async () => {
    const field = focusField();
    await speakAndPause({ kind: 'dictate' });
    field.type = 'password';
    click('Insert'); await flush();
    expect(field.value).toBe('');
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/never types into a password/), 'error');
  });
  it('refuses when the field is gone', async () => {
    const field = focusField();
    await speakAndPause({ kind: 'dictate' });
    field.remove();
    click('Insert'); await flush();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/field you were speaking to is gone/), 'error');
  });
  it('asks to click into a text box when there is none', async () => {
    document.activeElement.blur();
    await expect(V.listen({ kind: 'dictate' })).rejects.toThrow(/Click into a text box/);
  });
  it('auto mode dictates when a text field has the cursor and takes commands otherwise', async () => {
    focusField();
    await speakAndPause({ kind: 'auto' });
    expect(panel().textContent).toContain('Dictation');
    document.getElementById('vex-voice-panel').remove(); V._run = null;
    document.activeElement.blur();
    vexApi.voiceTranscribe = vi.fn(async () => ({ text: 'downloads', ms: 5 }));
    await speakAndPause({ kind: 'auto' });
    expect(panel().textContent).toContain('Running: Downloads');
  });
  it('probes a page field before typing into it, and refuses a secret one', async () => {
    const wv = { executeJavaScript: vi.fn(async () => 'secret'), focus: vi.fn(), insertText: vi.fn() };
    await expect(V.insert({ kind: 'page', wv }, 'x')).rejects.toThrow(/never types into a password/);
    expect(wv.insertText).not.toHaveBeenCalled();
    wv.executeJavaScript = vi.fn(async () => 'ok');
    await V.insert({ kind: 'page', wv }, 'hello');
    expect(wv.insertText).toHaveBeenCalledWith('hello');
    expect(wv.executeJavaScript.mock.calls[0][0]).toContain("'password'");
    wv.executeJavaScript = vi.fn(async () => 'none');
    await expect(V.insert({ kind: 'page', wv }, 'x')).rejects.toThrow(/gone/);
  });
});

describe('the key', () => {
  it('a key repeating while held does not start or stop anything', async () => {
    const p = V.listen({ kind: 'command', how: 'key' });
    await flush();
    V.hotkeyDown({ repeat: true });
    expect(V.isListening()).toBe(true);
    V.cancel(); await p;
  });
  it('releasing a held key ends the recording; a quick tap does not', async () => {
    const p = V.listen({ kind: 'command', how: 'key' });
    await flush();
    V._keyDownAt = Date.now() - 100;
    V._onKeyUp({ key: 'v' });
    expect(V.isListening()).toBe(true);
    V._keyDownAt = Date.now() - 800;
    feed(loud(1));
    V._onKeyUp({ key: 'v' });
    expect(V.isListening()).toBe(false);
    await flush(); await p;
    expect(tracks[0].stop).toHaveBeenCalled();
  });
  it('pressing the key again while listening stops it', async () => {
    const p = V.listen({ kind: 'command', how: 'toggle' });
    await flush();
    feed(loud(1));
    V.hotkeyDown({});
    await flush(); await p;
    expect(tracks[0].stop).toHaveBeenCalled();
  });
});

describe('the test seam', () => {
  it('feeds a clip through the same pipeline without opening a microphone, only when main says the seam is on', async () => {
    vexApi.voiceStatus = vi.fn(async () => ({ platformOk: true, testSeam: true, engine: { installed: true }, models: { base: { installed: true } } }));
    await V.listen({ kind: 'command', clip: 'en-new-tab.wav' });
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(vexApi.voiceTestClip).toHaveBeenCalledWith('en-new-tab.wav');
    expect(vexApi.voiceTranscribe).toHaveBeenCalled();
  });
  it('is refused when main did not switch it on', async () => {
    await expect(V.listen({ kind: 'command', clip: 'x.wav' })).rejects.toThrow(/seam is not available/);
    expect(vexApi.voiceTestClip).not.toHaveBeenCalled();
  });
});

describe('the toolbar button and the switch', () => {
  it('appears with its shortcut in the label when on and goes when off', () => {
    V.syncButton();
    const b = document.getElementById('btn-voice');
    expect(b).toBeTruthy();
    expect(b.getAttribute('aria-label')).toMatch(/^Voice control/);
    expect(b.nextElementSibling.id).toBe('btn-toggle-ai');
    V.setEnabled(false);
    expect(document.getElementById('btn-voice')).toBe(null);
  });
  it('switching off in the middle of a recording closes the microphone', async () => {
    const p = V.listen({ kind: 'command' });
    await flush();
    V.setEnabled(false);
    await p;
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(panel()).toBe(null);
  });
});
