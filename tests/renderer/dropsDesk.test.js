// @vitest-environment jsdom
//
// js/drops-desk.js (T3-089): a list of things that end. It tells; it never claims anything.
import { describe, it, expect, beforeEach, vi } from 'vitest';

globalThis.VexMediaKit = require('../../src/renderer/js/media-kit.js').VexMediaKit;
const { VexDropsDesk } = require('../../src/renderer/js/drops-desk.js');

const NOW = Date.UTC(2026, 9, 14, 10, 0);
let reminders, feed;

beforeEach(() => {
  localStorage.clear();
  VexDropsDesk._now = () => NOW;
  VexDropsDesk.setEnabled(true);
  VexDropsDesk.setPolling(true);
  reminders = [];
  feed = '<rss><channel><title>Giveaways</title><item><title>First</title><link>https://g.example/1</link></item></channel></rss>';
  window.vex = {
    reminders: {
      create: vi.fn(async (message, at, extra) => { const r = { id: 'r' + (reminders.length + 1), message, at, ...(extra || {}) }; reminders.push(r); return r; }),
      list: vi.fn(async () => reminders.slice()),
      delete: vi.fn(async (id) => { reminders = reminders.filter(r => r.id !== id); }),
    },
    rssFetch: vi.fn(async () => feed),
    freeGames: vi.fn(async () => ({ ok: true, games: [{ store: 'Epic', title: 'Game A', url: 'https://store.example/a', live: true, until: NOW + 86400000 }, { store: 'Epic', title: 'Later', live: false, upcoming: true, from: NOW + 1e9 }] })),
  };
  globalThis.VexFeeds = { parse: (xml) => [...String(xml).matchAll(/<item><title>(.*?)<\/title><link>(.*?)<\/link>/g)].map(m => ({ title: m[1], link: m[2] })) };
  delete globalThis.VexAttention;
  window.showToast = vi.fn();
});

describe('the list', () => {
  it('adds a line with a reminder before the end and removes the reminder with it', async () => {
    const it = await VexDropsDesk.add({ title: 'Stream drop', url: 'https://a.example/drop', endsAt: NOW + 5 * 3600000 }, { remind: 120 });
    expect(reminders).toHaveLength(1);
    expect(reminders[0].at).toBe(NOW + 3 * 3600000);
    expect(reminders[0].url).toBe('https://a.example/drop');
    expect(VexDropsDesk.items()[0].reminderId).toBe('r1');
    await VexDropsDesk.remove(it.id);
    expect(reminders).toHaveLength(0);
  });
  it('drops the reminder when it is ticked claimed, and never claims anything itself', async () => {
    const it = await VexDropsDesk.add({ title: 'Code', endsAt: NOW + 5 * 3600000, kind: 'code' }, { remind: 60 });
    await VexDropsDesk.setClaimed(it.id, true);
    expect(reminders).toHaveLength(0);
    expect(VexDropsDesk.items()[0]).toMatchObject({ claimed: true, reminderId: '' });
  });
  it('refuses a reminder that is too close to the end, a missing title, a bad address and a duplicate', async () => {
    await expect(VexDropsDesk.add({ title: 'x', endsAt: NOW + 30 * 60000 }, { remind: 120 })).rejects.toThrow(/too close/);
    await expect(VexDropsDesk.add({ title: '' })).rejects.toThrow(/title/);
    await expect(VexDropsDesk.add({ title: 'x', url: 'ftp://a' })).rejects.toThrow(/Only a web address/);
    await VexDropsDesk.add({ title: 'Same', url: 'https://a.example/1' });
    await expect(VexDropsDesk.add({ title: 'Same', url: 'https://a.example/1' })).rejects.toThrow(/already on the list/);
  });
  it('orders what ends soon first, leaves out claimed and finished, and lines up the New Tab', async () => {
    await VexDropsDesk.add({ title: 'Later', endsAt: NOW + 3 * 86400000 });
    await VexDropsDesk.add({ title: 'Soon', endsAt: NOW + 2 * 3600000 });
    const over = await VexDropsDesk.add({ title: 'Over', endsAt: NOW - 1000 });
    const claimed = await VexDropsDesk.add({ title: 'Claimed', endsAt: NOW + 3600000 });
    await VexDropsDesk.setClaimed(claimed.id, true);
    expect(VexDropsDesk.upcoming(VexDropsDesk.items(), NOW).map(i => i.title)).toEqual(['Soon', 'Later']);
    expect(VexDropsDesk.widgetLines(NOW)).toEqual(['Soon ends in 2 h']);
    expect(VexDropsDesk.calendarEvents(0, NOW * 2).map(e => e.summary).sort()).toEqual(['Later ends', 'Over ends', 'Soon ends']);
    expect(over.id).toBeTruthy();
  });
  it('copies the free games now live, with their end times', async () => {
    expect(await VexDropsDesk.addFreeGames()).toBe(1);
    expect(await VexDropsDesk.addFreeGames()).toBe(0);
    expect(VexDropsDesk.items()[0]).toMatchObject({ title: 'Epic: Game A', kind: 'free game', endsAt: NOW + 86400000 });
  });
  it('holds at most 120 lines and throws on a damaged list', async () => {
    const d = { items: Array.from({ length: 120 }, (_, i) => ({ id: 'i' + i, title: 't' + i })), sources: [] };
    localStorage.setItem('vex.drops', JSON.stringify(d));
    await expect(VexDropsDesk.add({ title: 'one more' })).rejects.toThrow(/holds 120/);
    localStorage.setItem('vex.drops', '[]');
    expect(() => VexDropsDesk.data()).toThrow(/not readable/);
  });
});

describe('the feeds', () => {
  it('learns what is there on the first look, then adds only what is new', async () => {
    VexDropsDesk.addSource('https://g.example/feed.xml', 'Giveaways');
    expect(await VexDropsDesk.poll()).toBe(0);
    expect(VexDropsDesk.items()).toHaveLength(0);
    feed = feed.replace('</channel>', '<item><title>Second</title><link>https://g.example/2</link></item></channel>');
    expect(await VexDropsDesk.poll()).toBe(1);
    expect(VexDropsDesk.items()[0]).toMatchObject({ title: 'Second', url: 'https://g.example/2', source: 'Giveaways', claimed: false });
    expect(await VexDropsDesk.poll()).toBe(0);
  });
  it('does not ask a feed unless the switch is on, and names a feed that did not answer', async () => {
    VexDropsDesk.addSource('https://g.example/feed.xml', 'Giveaways');
    VexDropsDesk.setPolling(false);
    expect(await VexDropsDesk.poll()).toBe(0);
    expect(window.vex.rssFetch).not.toHaveBeenCalled();
    VexDropsDesk.setPolling(true);
    window.vex.rssFetch = vi.fn(async () => null);
    await expect(VexDropsDesk.poll()).rejects.toThrow(/"Giveaways" did not answer/);
  });
  it('keeps ten sources at most and refuses a repeat or a bad address', () => {
    VexDropsDesk.addSource('https://a.example/f');
    expect(() => VexDropsDesk.addSource('https://a.example/f')).toThrow(/already listed/);
    expect(() => VexDropsDesk.addSource('javascript:1')).toThrow();
    for (let i = 0; i < 9; i++) VexDropsDesk.addSource('https://s' + i + '.example/f');
    expect(() => VexDropsDesk.addSource('https://more.example/f')).toThrow(/At most 10/);
  });
});
