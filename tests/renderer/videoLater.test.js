// @vitest-environment jsdom
//
// js/video-later.js (T3-039): a saved video has a length, a channel and progress, and the reading queue picks it.
import { describe, it, expect, beforeEach, vi } from 'vitest';

globalThis.VexMediaKit = require('../../src/renderer/js/media-kit.js').VexMediaKit;
const { VideoLater } = require('../../src/renderer/js/video-later.js');
const { ReadingQueue } = require('../../src/renderer/js/reading-queue.js');

let items, found;
beforeEach(() => {
  localStorage.clear();
  items = [];
  found = { time: 600, duration: 1800, title: 'A talk - YouTube', channel: 'Some Channel' };
  globalThis.ReadLater = { items, save: vi.fn() };
  globalThis.TabManager = { activeTabId: 't1', getActiveTab: () => ({ url: 'https://www.youtube.com/watch?v=abc&utm=1', title: 'A talk' }), createTab: vi.fn() };
  globalThis.WebviewManager = { webviews: new Map([['t1', { getURL: () => 'https://www.youtube.com/watch?v=abc&utm=1' }]]) };
  window.vexGuestEval = vi.fn(async () => found);
  window.showToast = vi.fn();
  VideoLater.setEnabled(true);
});

describe('reading the playing page', () => {
  it('keeps length, channel, progress and the minutes that are left', () => {
    const info = VideoLater.fromPage(found, 'https://x/y');
    expect(info).toMatchObject({ title: 'A talk', channel: 'Some Channel', live: false, minutes: 20 });
    expect(info.video).toEqual({ duration: 1800, progress: 600, channel: 'Some Channel' });
  });
  it('treats a live stream as having no length, and refuses a page with no video', () => {
    expect(VideoLater.fromPage({ time: 5, duration: Infinity, title: 't' }, 'u')).toMatchObject({ live: true, minutes: 0 });
    expect(() => VideoLater.fromPage(null, 'u')).toThrow(/nothing playing/);
  });
  it('knows the same video behind different addresses', () => {
    expect(VideoLater.sameVideo('https://www.youtube.com/watch?v=abc&t=5', 'https://youtube.com/watch?v=abc')).toBe(true);
    expect(VideoLater.sameVideo('https://youtu.be/abc', 'https://www.youtube.com/watch?v=abc')).toBe(true);
    expect(VideoLater.sameVideo('https://youtube.com/watch?v=abc', 'https://youtube.com/watch?v=zzz')).toBe(false);
  });
});

describe('saving and updating', () => {
  it('saves into Read Later with the minutes left, so the queue can pick it', async () => {
    const item = await VideoLater.saveCurrent();
    expect(items).toHaveLength(1);
    expect(item).toMatchObject({ minutes: 20, read: false, video: { duration: 1800 } });
    expect(ReadLater.save).toHaveBeenCalled();
    expect(ReadingQueue.fit(items, 25).picks).toHaveLength(1);
    expect(ReadingQueue.fit(items, 10).picks).toHaveLength(0);
  });
  it('saving the same video again updates it instead of duplicating', async () => {
    await VideoLater.saveCurrent();
    found = { ...found, time: 1200 };
    await VideoLater.saveCurrent();
    expect(items).toHaveLength(1);
    expect(items[0].video.progress).toBe(1200);
    expect(items[0].minutes).toBe(10);
  });
  it('marks a video finished once the last 5 percent is reached', async () => {
    await VideoLater.saveCurrent();
    found = { ...found, time: 1750 };
    const it = await VideoLater.updateProgress();
    expect(it.read).toBe(true);
    expect(it.finishedAt).toBeGreaterThan(0);
  });
  it('asks for a save first when the video is not on the list, and refuses when switched off', async () => {
    await expect(VideoLater.updateProgress()).rejects.toThrow(/Save it first/);
    VideoLater.setEnabled(false);
    await expect(VideoLater.saveCurrent()).rejects.toThrow(/switched off/);
  });
  it('continues where you left off', async () => {
    const item = await VideoLater.saveCurrent();
    globalThis.VideoNotes = { stamp: (s) => s + 's', link: (u, s) => u + '#t=' + s };
    expect(VideoLater.resumeUrl(item)).toMatch(/#t=597$/);
    expect(VideoLater.label(item)).toBe('video, 1800s, at 600s, Some Channel');
  });
});
