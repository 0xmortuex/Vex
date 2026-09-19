// @vitest-environment jsdom
//
// Dictation: Whisper on this PC. The model is proven live (see CHANGELOG);
// here the microphone, the audio graph and the model are stand-ins, and what
// is checked is everything around them: asking before the download, where
// the words go, cancelling, silence, and never using the graphics card during
// a game.

import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-icons.js');
const { Dictation } = require('../../src/renderer/js/dictation.js');

let processor, tracks;
function fakeAudio(samples) {
  tracks = [{ stop: vi.fn() }];
  navigator.mediaDevices = { getUserMedia: vi.fn(async () => ({ getTracks: () => tracks })) };
  globalThis.AudioContext = class {
    constructor(o) { this.sampleRate = o.sampleRate; this.destination = {}; }
    createMediaStreamSource() { return { connect: vi.fn() }; }
    createScriptProcessor() { processor = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null }; return processor; }
    close() { return Promise.resolve(); }
  };
  return () => processor.onaudioprocess({ inputBuffer: { getChannelData: () => samples } });
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  Dictation._session = null; Dictation._asr = null; Dictation._asrKey = '';
  window.showToast = vi.fn();
  window.vexConfirm = vi.fn(async () => true);
  window.GameMode = { gaming: false };
  vi.spyOn(Dictation, '_idle').mockImplementation(() => {});
});

describe('the pieces', () => {
  it('joins the recording into one buffer', () => {
    expect(Array.from(Dictation.join([new Float32Array([1, 2]), new Float32Array([3])]))).toEqual([1, 2, 3]);
  });

  it('what Whisper says for silence is not dictation', () => {
    expect(Dictation.clean('  Remind me   to call.  ')).toBe('Remind me to call.');
    for (const x of ['', ' . ', '[BLANK_AUDIO]', '(silence)', '...']) expect(Dictation.clean(x), x).toBe('');
  });

  it('never the graphics card while a game is running', () => {
    navigator.gpu = {};
    expect(Dictation.device()).toBe('webgpu');
    window.GameMode.gaming = true;
    expect(Dictation.device()).toBe('wasm');
    delete navigator.gpu;
    window.GameMode.gaming = false;
    expect(Dictation.device()).toBe('wasm');
  });

  it('types into a Vex box at the cursor, with a space when the words run on', () => {
    document.body.innerHTML = '<textarea id="t"></textarea>';
    const t = document.getElementById('t');
    t.value = 'Call Dana'; t.setSelectionRange(9, 9);
    const input = vi.fn(); t.addEventListener('input', input);
    Dictation.insertInto(t, 'about the invoice.');
    expect(t.value).toBe('Call Dana about the invoice.');
    expect(input).toHaveBeenCalled();
  });
});

describe('asking before the download', () => {
  it('asks the first time, with the size, and not once the model is there', async () => {
    expect(await Dictation._allowed()).toBe(true);
    expect(window.vexConfirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/73 MB.*nothing you say leaves this computer/) }));
    localStorage.setItem('vex.dictation.ready.base', '1');
    window.vexConfirm.mockClear();
    expect(await Dictation._allowed()).toBe(true);
    expect(window.vexConfirm).not.toHaveBeenCalled();
  });

  it('a No starts nothing: no microphone', async () => {
    document.body.innerHTML = '<textarea id="t"></textarea>';
    document.getElementById('t').focus();
    window.vexConfirm = vi.fn(async () => false);
    fakeAudio(new Float32Array(4096));
    await Dictation.start();
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(Dictation._session).toBeNull();
  });
});

describe('dictating', () => {
  const speech = new Float32Array(4096).map((_, i) => Math.sin(i / 5) * 0.3);

  it('into a Vex box: listens, then types what Whisper heard, and lets the microphone go', async () => {
    document.body.innerHTML = '<input id="i" type="text">';
    document.getElementById('i').focus();
    const asr = vi.fn(async () => ({ text: ' Remind me to call the dentist.' }));
    vi.spyOn(Dictation, '_load').mockResolvedValue(asr);
    const feed = fakeAudio(speech);
    await Dictation.start();
    expect(document.getElementById('vex-dictation').textContent).toMatch(/Listening/);
    for (let i = 0; i < 4; i++) feed();                      // about a second
    await Dictation.stop();
    expect(asr).toHaveBeenCalledWith(expect.any(Float32Array), expect.objectContaining({ task: 'transcribe' }));
    expect(asr.mock.calls[0][0].length).toBe(4 * 4096);
    expect(document.getElementById('i').value).toBe('Remind me to call the dentist.');
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(document.getElementById('vex-dictation')).toBeNull();
  });

  it('into a web page: typed through the page, as if from the keyboard', async () => {
    const wv = { focus: vi.fn(), insertText: vi.fn(), tagName: 'WEBVIEW' };
    globalThis.WebviewManager = { getActiveWebview: () => wv };
    vi.spyOn(Dictation, '_load').mockResolvedValue(async () => ({ text: 'Hello there' }));
    const feed = fakeAudio(speech);
    await Dictation.start();
    for (let i = 0; i < 4; i++) feed();
    await Dictation.stop();
    expect(wv.insertText).toHaveBeenCalledWith('Hello there');
    delete globalThis.WebviewManager;
  });

  it('the chosen language is passed on; "detect" passes none', async () => {
    document.body.innerHTML = '<input id="i" type="text">';
    document.getElementById('i').focus();
    localStorage.setItem('vex.dictation.language', 'arabic');
    const asr = vi.fn(async () => ({ text: 'مرحبا' }));
    vi.spyOn(Dictation, '_load').mockResolvedValue(asr);
    const feed = fakeAudio(speech);
    await Dictation.start(); for (let i = 0; i < 4; i++) feed(); await Dictation.stop();
    expect(asr.mock.calls[0][1].language).toBe('arabic');
    expect(document.getElementById('i').value).toBe('مرحبا');
  });

  it('Esc throws it away: nothing typed, microphone off', async () => {
    document.body.innerHTML = '<input id="i" type="text">';
    document.getElementById('i').focus();
    const asr = vi.fn();
    vi.spyOn(Dictation, '_load').mockResolvedValue(asr);
    const feed = fakeAudio(speech);
    await Dictation.start(); feed();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(Dictation._session).toBeNull();
    expect(asr).not.toHaveBeenCalled();
    expect(document.getElementById('i').value).toBe('');
  });

  it('a click too short to hold words is said, not sent to the model', async () => {
    document.body.innerHTML = '<input id="i" type="text">';
    document.getElementById('i').focus();
    const asr = vi.fn();
    vi.spyOn(Dictation, '_load').mockResolvedValue(asr);
    fakeAudio(speech);
    await Dictation.start();
    await Dictation.stop();
    expect(asr).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith('Nothing was recorded');
  });

  it('a refused microphone says where to fix it', async () => {
    document.body.innerHTML = '<input id="i" type="text">';
    document.getElementById('i').focus();
    vi.spyOn(Dictation, '_load').mockResolvedValue(vi.fn());
    fakeAudio(speech);
    navigator.mediaDevices.getUserMedia = vi.fn(async () => { const e = new Error('denied'); e.name = 'NotAllowedError'; throw e; });
    await expect(Dictation.start()).rejects.toThrow(/Privacy › Microphone/);
    expect(Dictation._session).toBeNull();
  });

  it('with nowhere to type, says so instead of recording', async () => {
    globalThis.WebviewManager = { getActiveWebview: () => null };
    await expect(Dictation.start()).rejects.toThrow(/text box first/);
    delete globalThis.WebviewManager;
  });
});
