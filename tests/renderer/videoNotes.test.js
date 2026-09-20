// Notes that point at a moment. The whole value is the link going back to the
// right second, so the link building is what this leans on — plus one note per
// video, found by the video's address rather than its title.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { VideoNotes: V } = require('../../src/renderer/js/video-notes.js');

let notes;
beforeEach(() => {
  notes = [];
  globalThis.OpenTasks = { notes: () => notes, writeNotes: (n) => { notes = n; } };
  globalThis.window = { showToast: vi.fn(), vexGuestEval: vi.fn() };
});

describe('the time', () => {
  it('reads as a person would say it', () => {
    expect(V.stamp(0)).toBe('0:00');
    expect(V.stamp(9)).toBe('0:09');
    expect(V.stamp(754)).toBe('12:34');
    expect(V.stamp(3723)).toBe('1:02:03');
  });

  it('is never negative or fractional', () => {
    expect(V.stamp(-5)).toBe('0:00');
    expect(V.stamp(61.8)).toBe('1:01');
  });
});

describe('the link back', () => {
  it('YouTube gets its own t= parameter, replacing any already there', () => {
    expect(V.link('https://www.youtube.com/watch?v=abc123', 754)).toBe('https://www.youtube.com/watch?v=abc123&t=754s');
    expect(V.link('https://www.youtube.com/watch?v=abc123&t=12s', 754)).toBe('https://www.youtube.com/watch?v=abc123&t=754s');
    expect(V.link('https://youtu.be/abc123', 30)).toBe('https://youtu.be/abc123?t=30s');
  });

  it('Vimeo and anything else get a media fragment', () => {
    expect(V.link('https://vimeo.com/12345', 90)).toBe('https://vimeo.com/12345#t=90s');
    expect(V.link('https://example.com/talk.mp4', 90)).toBe('https://example.com/talk.mp4#t=90');
  });

  it('something that is not an address is left as it is', () => {
    expect(V.link('not a url', 10)).toBe('not a url');
  });
});

describe('the note', () => {
  const video = { url: 'https://www.youtube.com/watch?v=abc', title: 'A long talk', seconds: 754 };

  it('is made on the first note and added to after that', () => {
    V.add(video, 'the caching bit');
    V.add({ ...video, seconds: 900 }, 'the questions start');
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('A long talk');
    expect(notes[0].content.split('\n')).toEqual([
      '- [12:34](https://www.youtube.com/watch?v=abc&t=754s) the caching bit',
      '- [15:00](https://www.youtube.com/watch?v=abc&t=900s) the questions start',
    ]);
  });

  it('is found by the video, not by its title — including from a timestamped link', () => {
    V.add(video, 'first');
    V.add({ ...video, url: 'https://www.youtube.com/watch?v=abc&t=754s', title: 'A long talk (re-uploaded)' }, 'second');
    expect(notes).toHaveLength(1);
    expect(notes[0].content.split('\n')).toHaveLength(2);
  });

  it('a different video gets its own note', () => {
    V.add(video, 'first');
    V.add({ url: 'https://www.youtube.com/watch?v=xyz', title: 'Another', seconds: 10 }, 'other');
    expect(notes).toHaveLength(2);
  });

  it('an empty note is refused rather than written', () => {
    expect(() => V.add(video, '   ')).toThrow(/Write the note/);
    expect(notes).toHaveLength(0);
  });
});

describe('finding the video', () => {
  beforeEach(() => {
    globalThis.TabManager = { getActiveTab: () => ({ url: 'https://www.youtube.com/watch?v=abc', title: 'A talk - YouTube' }), activeTabId: 1 };
    globalThis.WebviewManager = { webviews: new Map([[1, { getURL: () => 'https://www.youtube.com/watch?v=abc' }]]) };
  });

  it('takes the time from the video that is playing', async () => {
    window.vexGuestEval.mockResolvedValue({ time: 120.4, duration: 3600, title: 'A talk - YouTube' });
    const m = await V.moment();
    expect(m.seconds).toBe(120.4);
    expect(m.title).toBe('A talk');          // "- YouTube" is not part of the name
  });

  it('a page with nothing playing says so', async () => {
    window.vexGuestEval.mockResolvedValue(null);
    await expect(V.moment()).rejects.toThrow(/nothing playing/);
  });

  it('a podcast counts as well as a video', () => {
    expect(V.script()).toContain("querySelectorAll('video,audio')");
  });
});
