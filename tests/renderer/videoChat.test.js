// @vitest-environment jsdom
//
// On a YouTube video the AI reads what was said (the captions), cites moments
// as [m:ss], and each of those jumps the video there.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { AgentTools } = require('../../src/renderer/js/agent-tools.js');
const { VideoChat } = require('../../src/renderer/js/video-chat.js');

const VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
beforeEach(() => { globalThis.AgentTools = AgentTools; });

describe('the context the AI gets', () => {
  it('on a video, the transcript replaces the page, with the ask to cite [m:ss]', async () => {
    vi.spyOn(AgentTools, 'youtubeTranscript').mockResolvedValue({ text: '[0:00] hello [2:05] the chorus' });
    const ctx = await VideoChat.contextFor({ url: VIDEO, title: 't', text: 'comments and recommendations' });
    expect(ctx.text).toMatch(/^Transcript of this video, with \[m:ss\] timestamps\./);
    expect(ctx.text).toContain('[2:05] the chorus');
    expect(ctx.text).not.toContain('recommendations');
  });
  it('a video without captions keeps the page, and says why', async () => {
    vi.spyOn(AgentTools, 'youtubeTranscript').mockRejectedValue(new Error('This video has no captions'));
    const ctx = await VideoChat.contextFor({ url: VIDEO, text: 'the page' });
    expect(ctx.text).toBe('(No transcript: This video has no captions)\n\nthe page');
  });
  it('anything else is left alone', async () => {
    const ctx = { url: 'https://example.com', text: 'x' };
    expect(await VideoChat.contextFor(ctx)).toBe(ctx);
  });
});

describe('timestamps in the answer', () => {
  it('become buttons that know their second, on a video only', () => {
    const html = '<p>The chorus starts at [2:05], and the bridge at [1:02:03].</p>';
    const out = VideoChat.linkify(html, VIDEO);
    expect([...out.matchAll(/data-t="(\d+)"/g)].map(m => Number(m[1]))).toEqual([125, 3723]);
    expect(VideoChat.linkify(html, 'https://example.com')).toBe(html);
  });
  it('jump the video in the tab, or say there is none', async () => {
    const calls = [];
    globalThis.WebviewManager = { getActiveWebview: () => ({}) };
    window.vexGuestEval = vi.fn(async (wv, code) => { calls.push(code); return true; });
    await VideoChat.seek(125);
    expect(calls[0]).toContain('v.currentTime = 125');
    window.vexGuestEval = vi.fn(async () => false);
    await expect(VideoChat.seek(1)).rejects.toThrow('There is no video on this page');
  });
});

describe('a note that links to a moment', () => {
  it('links back to the second the video is at', () => {
    expect(VideoChat.momentLink(VIDEO, 125.7)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=125');
    expect(VideoChat.momentLink('https://vimeo.com/123#x', 61)).toBe('https://vimeo.com/123#t=61');
  });

  it('saves the timestamp and the link as a note, and says when there is no video', async () => {
    const saved = [];
    globalThis.TabManager = { getActiveTab: () => ({ url: VIDEO, title: 'How tides work' }) };
    globalThis.WebviewManager = { getActiveWebview: () => ({}) };
    globalThis.AgentTools = { ...AgentTools, saveNote: (t, c, s) => saved.push([t, c, s]) };
    window.vexGuestEval = vi.fn(async () => 3725);
    const r = await VideoChat.noteMoment('the tide turns');
    expect(r.stamp).toBe('01:02:05');
    expect(saved[0]).toEqual(['How tides work', '[01:02:05](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3725) — the tide turns', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3725']);
    window.vexGuestEval = vi.fn(async () => null);
    await expect(VideoChat.noteMoment()).rejects.toThrow('no video on this page');
  });
});
