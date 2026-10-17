// @vitest-environment jsdom
// T2-027: slide frame grabber with local OCR, and the brief by chapter (local model only).
import { describe, it, expect, beforeEach, vi } from 'vitest';
const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let V;
beforeEach(() => {
  localStorage.clear(); vi.resetModules();
  ({ VideoTools: V } = fresh(JS + 'video-tools.js'));
  window.VideoTools = V;
});

describe('frames', () => {
  it('turns pixels into grey and measures how much two pictures differ', () => {
    const white = V.grayFromRgba(new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]));
    const black = V.grayFromRgba(new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]));
    expect([...white]).toEqual([255, 255]);
    expect(V.frameDiff(white, white)).toBe(0);
    expect(V.frameDiff(white, black)).toBe(255);
    expect(() => V.frameDiff(white, new Uint8Array(3))).toThrow(/not the same size/);
  });
  it('a slide is new when it is the first or differs by more than the threshold', () => {
    const a = new Uint8Array(100).fill(100), nearly = new Uint8Array(100).fill(103), other = new Uint8Array(100).fill(180);
    expect(V.isNewSlide(null, a)).toBe(true);
    expect(V.isNewSlide(a, nearly)).toBe(false);
    expect(V.isNewSlide(a, other)).toBe(true);
    expect(V.isNewSlide(a, nearly, 2)).toBe(true);
  });
  it('plans the times to look at and refuses a bad range or a step that is too small', () => {
    expect(V.scanTimes(0, 30, 10)).toEqual([0, 10, 20]);
    expect(V.scanTimes(5, 6, 2)).toEqual([5]);
    expect(() => V.scanTimes(10, 5, 5)).toThrow(/after the start/);
    expect(() => V.scanTimes(0, 10, 1)).toThrow(/at least 2 seconds/);
    expect(V.scanTimes(0, 100000, 2)).toHaveLength(V.SLIDE.maxSteps);
  });
  it('writes the slides as timestamped Markdown', () => {
    const md = V.slidesNote([{ s: 65, text: 'Intro\n\n  Agenda ' }, { s: 130, text: '' }]);
    expect(md).toBe('## Slides\n\n### Slide 1 1:05\nIntro\nAgenda\n\n### Slide 2 2:10\n(no readable words)\n');
  });
});

describe('grabSlides', () => {
  const rect = { x: 0, y: 0, width: 640, height: 360, time: 3, duration: 300, paused: false, protectedMedia: false };
  function setup({ shades }) {
    const calls = [];
    window.vexGuestEval = vi.fn(async (wv, code) => {
      const m = /\)\(("[a-zA-Z]+"),(.*)\)$/.exec(code);
      const cmd = JSON.parse(m[1]); const arg = JSON.parse(m[2]);
      calls.push([cmd, arg]);
      if (cmd === 'rect') return rect;
      if (cmd === 'seekWait') { wv.__t = arg; return { time: arg }; }
      return { ok: 1 };
    });
    const wv = { capturePage: vi.fn(async () => ({ isEmpty: () => false, toDataURL: () => 'data:image/png;base64,' + shades[Math.floor(wv.__t / 10) % shades.length] })) };
    V._gray = vi.fn(async (url) => new Uint8Array(20).fill(Number(url.split(',')[1])));
    V._ocr = vi.fn(async (url) => 'text of ' + url.split(',')[1]);
    return { wv, calls };
  }
  it('keeps one picture per change, reads its words, and puts the video back', async () => {
    const { wv, calls } = setup({ shades: ['10', '10', '200', '200', '200', '60'] });
    const slides = await V.grabSlides(wv, { a: 0, b: 60, step: 10 });
    expect(slides.map(s => [s.s, s.text])).toEqual([[0, 'text of 10'], [20, 'text of 200'], [50, 'text of 60']]);
    expect(V._ocr).toHaveBeenCalledTimes(3);
    expect(calls.filter(c => c[0] === 'seekWait').map(c => c[1])).toEqual([0, 10, 20, 30, 40, 50]);
    const tail = calls.slice(-2);
    expect(tail).toEqual([['seek', 3], ['play', null]]);
  });
  it('puts the video back even when a picture fails, and refuses protected video', async () => {
    const { wv, calls } = setup({ shades: ['10'] });
    wv.capturePage = vi.fn(async () => { throw new Error('boom'); });
    await expect(V.grabSlides(wv, { a: 0, b: 20, step: 10 })).rejects.toThrow(/boom/);
    expect(calls.at(-1)).toEqual(['play', null]);
    const prot = setup({ shades: ['10'] });
    window.vexGuestEval = vi.fn(async (w, code) => (/"rect"/.test(code) ? { ...rect, protectedMedia: true } : { ok: 1 }));
    await expect(V.grabSlides(prot.wv, { a: 0, b: 20, step: 10 })).rejects.toThrow(/protected/);
  });
  it('is not used in private tabs', async () => {
    window.VexTabPolicy = { canReadWebview: () => false };
    await expect(V.grabSlides({}, { a: 0, b: 20, step: 10 })).rejects.toThrow(/private, Tor or routed/);
    delete window.VexTabPolicy;
  });
});

describe('brief by chapter', () => {
  const probe = {
    description: '0:00 Intro\n1:00 Setup\n2:00 Wrap up',
    cues: [
      { s: 1, t: 'Welcome to the course, today we look at how the build system works in detail.' },
      { s: 61, t: 'First install the toolchain, then configure the paths so that the compiler can be found by the build.' },
      { s: 121, t: 'ok' },
    ],
  };
  it('cuts the caption text by chapter', () => {
    const ch = V.chaptersFor(probe).list;
    const lines = V.lines(probe);
    expect(V.chapterText(lines, ch, 0)).toMatch(/^Welcome/);
    expect(V.chapterText(lines, ch, 1)).toMatch(/toolchain/);
    expect(V.chapterText(lines, ch, 2)).toBe('ok');
    expect(V.chapterPrompt('Intro', 'x')).toContain('Use only the captions');
  });
  it('asks only the local model, once per chapter, and marks a thin chapter', async () => {
    globalThis.VexStudyKit = { generateLocal: vi.fn(async (sys, prompt) => 'About ' + /called "([^"]+)"/.exec(prompt)[1]) };
    const items = await V.briefByChapter(probe);
    expect(items.map(i => i.brief)).toEqual(['About Intro', 'About Setup', 'Too little to say.']);
    expect(globalThis.VexStudyKit.generateLocal).toHaveBeenCalledTimes(2);
    expect(V.briefNote(items)).toContain('- 1:00 **Setup**: About Setup');
  });
  it('says so with no local model, and with no captions', async () => {
    globalThis.VexStudyKit = { generateLocal: vi.fn(async () => { throw new Error('No local model is set up (Ollama). This text is never sent to a cloud model.'); }) };
    await expect(V.briefByChapter(probe)).rejects.toThrow(/No local model/);
    await expect(V.briefByChapter({ description: '', cues: [] })).rejects.toThrow(/no captions/);
  });
});
