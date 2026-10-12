// @vitest-environment jsdom
//
// Reading a page aloud. Android's TextToSpeech has no pause — only stop — so
// everything the bar offers (pause, carry on, skip, change speed) is really
// "stop and re-queue from line N". What is worth pinning down is that the line
// number survives all of it, because that is the one thing a listener notices.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = { 'vex.speakRate': 1, 'vex.speakVoice': '' };
window.VexStore = {
  get: (key, fallback) => (key in store ? store[key] : fallback),
  set: async (key, value) => { store[key] = value; return value; }
};

let spoken = [];            // every queue handed to the engine
const handlers = {};
window.VexBridge = {
  speakAvailable: vi.fn(async () => ({ available: true, voices: [{ name: 'en-gb-x', language: 'en-GB' }] })),
  speak: vi.fn(async (parts, options) => { spoken.push({ parts, options }); return { parts: parts.length }; }),
  speakStop: vi.fn(async () => {}),
  speakPause: vi.fn(async () => {}),
  speakState: vi.fn(async () => ({ speaking: true, index: 1 })),
  onSpeak: (event, fn) => { handlers[event] = fn; return () => { delete handlers[event]; }; }
};
window.VexUI = { toast: vi.fn() };
window.VexReader = {
  extract: vi.fn(async () => ({
    title: 'An article',
    blocks: [{ type: 'p', text: 'One.' }, { type: 'img', src: 'x.png' }, { type: 'p', text: 'Two.' }]
  }))
};
let active = { id: 't1', url: 'https://example.com/a', title: 'An article' };
window.VexTabStore = { active: () => active };

const { VexSpeak } = require('../../mobile/www/js/speak.js');
VexSpeak.bind();

beforeEach(async () => {
  spoken = [];
  store['vex.speakRate'] = 1;
  store['vex.speakVoice'] = '';
  active = { id: 't1', url: 'https://example.com/a', title: 'An article' };
  await VexSpeak.stop();
  spoken = [];
  for (const fn of [window.VexBridge.speak, window.VexBridge.speakStop, window.VexBridge.speakPause, window.VexUI.toast]) fn.mockClear();
});

describe('what gets read', () => {
  it('is the article, title first, and never the images', () => {
    const lines = VexSpeak.linesFor({
      title: 'A headline',
      blocks: [{ text: 'First.' }, { type: 'img', src: 'x.png' }, { text: 'Second.' }]
    });
    expect(lines).toEqual(['A headline', 'First.', 'Second.']);
  });

  it('breaks an enormous paragraph into pieces you can skip out of', () => {
    const sentence = 'This is a sentence of some length. ';
    const lines = VexSpeak.linesFor({ title: '', blocks: [{ text: sentence.repeat(40) }] });
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(400);
    // Nothing is lost in the splitting.
    expect(lines.join(' ').replace(/\s+/g, ' ')).toContain('This is a sentence of some length.');
  });

  it('says so rather than starting on a page with no article', async () => {
    window.VexReader.extract.mockResolvedValueOnce({ title: '', blocks: [] });
    expect(await VexSpeak.readPage()).toBe(false);
    expect(window.VexBridge.speak).not.toHaveBeenCalled();
    expect(VexSpeak.state.loaded).toBe(false);
  });

  it('refuses when there is no page', async () => {
    active = { id: 't1', url: 'about:blank', title: '' };
    expect(await VexSpeak.readPage()).toBe(false);
    expect(window.VexUI.toast).toHaveBeenCalledWith('Open a page first');
  });
});

describe('the controls', () => {
  beforeEach(async () => {
    await VexSpeak.readPage();
    spoken = [];
  });

  it('reads from the top, with the speed and voice you chose', async () => {
    expect(VexSpeak.state.parts).toEqual(['An article', 'One.', 'Two.']);
    expect(VexSpeak.state.speaking).toBe(true);
    expect(VexSpeak.state.index).toBe(0);
  });

  it('follows the engine from line to line', () => {
    handlers.speaking({ index: 2 });
    expect(VexSpeak.state.index).toBe(2);
  });

  it('pauses, and carries on from the same line', async () => {
    handlers.speaking({ index: 1 });
    await VexSpeak.toggle();
    // A pause, not a stop: a stop would take the notification away.
    expect(window.VexBridge.speakPause).toHaveBeenCalled();
    expect(window.VexBridge.speakStop).not.toHaveBeenCalled();
    expect(VexSpeak.state.speaking).toBe(false);
    expect(VexSpeak.state.index).toBe(1);

    await VexSpeak.toggle();
    expect(VexSpeak.state.speaking).toBe(true);
    // Only what is left, not the whole article again.
    expect(spoken.at(-1).parts).toEqual(['One.', 'Two.']);
  });

  it('keeps counting from the right line after carrying on', async () => {
    handlers.speaking({ index: 1 });
    await VexSpeak.toggle();
    await VexSpeak.toggle();
    // The engine's index 1 is now the second line of what was sent, not of the
    // article — this is the arithmetic that used to drift.
    handlers.speaking({ index: 1 });
    expect(VexSpeak.state.index).toBe(2);
  });

  it('skips a line forward and back, without running off either end', async () => {
    await VexSpeak.skip(1);
    expect(VexSpeak.state.index).toBe(1);
    await VexSpeak.skip(-5);
    expect(VexSpeak.state.index).toBe(0);
    await VexSpeak.skip(99);
    expect(VexSpeak.state.index).toBe(VexSpeak.state.parts.length - 1);
  });

  it('skips while paused without starting to talk again', async () => {
    await VexSpeak.toggle();
    window.VexBridge.speak.mockClear();
    await VexSpeak.skip(1);
    expect(VexSpeak.state.index).toBe(1);
    expect(VexSpeak.state.speaking).toBe(false);
    expect(window.VexBridge.speak).not.toHaveBeenCalled();
  });

  it('steps through the speeds and re-reads from where it was', async () => {
    handlers.speaking({ index: 1 });
    expect(await VexSpeak.cycleRate()).toBe(1.25);
    expect(store['vex.speakRate']).toBe(1.25);
    expect(spoken.at(-1).options.rate).toBe(1.25);
    expect(spoken.at(-1).parts).toEqual(['One.', 'Two.']);
    // And round the end of the range.
    await VexSpeak.setRate(2);
    expect(await VexSpeak.cycleRate()).toBe(0.75);
  });

  it('keeps the bar up when it reaches the end, offering to read it again', () => {
    handlers.finished();
    expect(VexSpeak.state.speaking).toBe(false);
    expect(VexSpeak.state.loaded).toBe(true);
    expect(VexSpeak.state.index).toBe(0);
  });

  it('follows a pause and a carry-on from the notification or the headset', () => {
    handlers.paused();
    expect(VexSpeak.state.speaking).toBe(false);
    expect(VexSpeak.state.loaded).toBe(true);
    handlers.resumed();
    expect(VexSpeak.state.speaking).toBe(true);
  });

  it('puts the bar away when the notification stops it', () => {
    handlers.stopped();
    expect(VexSpeak.state.loaded).toBe(false);
    expect(VexSpeak.state.parts).toEqual([]);
  });

  it('catches up on coming back, counting from what it last sent', async () => {
    handlers.speaking({ index: 1 });
    await VexSpeak.toggle();
    await VexSpeak.toggle();             // sent from line 1
    await VexSpeak.resync();             // native has read on to its line 1
    expect(VexSpeak.state.index).toBe(2);
    expect(VexSpeak.state.speaking).toBe(true);
  });

  it('gives the notification the title to show', () => {
    expect(window.VexBridge.speak.mock.calls.at(-1)[1].title).toBe('An article');
  });

  it('puts the bar away on stop, and forgets the article', async () => {
    await VexSpeak.stop();
    expect(VexSpeak.state.loaded).toBe(false);
    expect(VexSpeak.state.parts).toEqual([]);
    expect(window.VexBridge.speakStop).toHaveBeenCalled();
  });

  it('tells anyone drawing a bar whenever any of that happens', async () => {
    const seen = [];
    const off = VexSpeak.onChange(state => seen.push(state.index + ':' + state.speaking));
    handlers.speaking({ index: 1 });
    await VexSpeak.toggle();
    off();
    expect(seen).toEqual(['1:true', '1:false']);
  });
});

describe('a phone with no speech engine', () => {
  it('says so once and does not pretend to read', async () => {
    window.VexBridge.speakAvailable.mockResolvedValueOnce({ available: false, voices: [] });
    VexSpeak.state.available = null;
    expect(await VexSpeak.readPage()).toBe(false);
    expect(window.VexUI.toast).toHaveBeenCalledWith('This phone has no speech engine', 4000);
    VexSpeak.state.available = true;
  });
});
