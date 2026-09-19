// @vitest-environment jsdom
//
// The weekly review: honest numbers for the last seven days, a Friday
// reminder that opens it, created once and respected if removed.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { VexReview } = require('../../src/renderer/js/weekly-review.js');
require('../../src/renderer/js/page-watch.js');       // the real one: a mock of a module that did not exist hid a dead section

const NOW = new Date(2026, 8, 13, 14, 30).getTime();   // Sunday
const ago = (days) => NOW - days * 24 * 3600000;

describe('building the review', () => {
  beforeEach(() => {
    localStorage.clear();
    global.window.vex = { reminders: { list: vi.fn(async () => [
      { id: 'a', message: 'Call Dana', at: ago(2), firedAt: ago(2), delivered: 'toast', createdAt: ago(3) },
      { id: 'b', message: 'Call Dana', at: ago(2) + 600000, firedAt: ago(2) + 600000, delivered: 'toast', createdAt: ago(2) + 30000 },  // a snooze of a
      { id: 'c', message: 'Refused', at: ago(1), firedAt: ago(1), delivered: 'failed', createdAt: ago(4) },
      { id: 'd', message: 'Ahead', at: NOW + 3600000, firedAt: null, createdAt: ago(1) },
      { id: 'e', message: 'Old', at: ago(20), firedAt: ago(20), delivered: 'toast', createdAt: ago(21) },
      { id: 'f', message: 'Weekly review', at: NOW + 5 * 86400000, firedAt: null, kind: 'review', createdAt: ago(9) },
    ]), onFired: vi.fn(), create: vi.fn(async (m, at, x) => ({ id: 'rv', message: m, at, ...x })) } };
    globalThis.ReadLater = { items: [{ id: 'r1', url: 'https://read.example/', title: 'Long read', at: ago(3), read: false }, { id: 'r2', url: 'https://done.example/', title: 'Done', at: ago(2), read: true }, { id: 'r3', url: 'https://old.example/', title: 'Old', at: ago(30), read: false }] };
    localStorage.setItem('vex.pageWatches', JSON.stringify([{ id: 'w1', url: 'https://news.example/', title: 'News', lastChangedAt: ago(1) }, { id: 'w2', url: 'https://quiet.example/', title: 'Quiet', lastChangedAt: ago(40) }]));
    localStorage.setItem('vex.tool.history.base64', JSON.stringify([{ input: 'a', at: ago(1) }, { input: 'b', at: ago(2) }, { input: 'c', at: ago(30) }]));
  });

  it('counts fired, snoozed, pending and refused, within the week only', async () => {
    const r = await VexReview.build(NOW);
    expect(r.reminders.fired).toBe(3);        // a, b, c — not e (old), not f (the review itself)
    expect(r.reminders.snoozed).toBe(1);      // b, created moments after a fired with the same text
    expect(r.reminders.pending).toBe(1);      // d
    expect(r.reminders.missed).toBe(1);       // c
    expect(r.reminders.list[0].text).toBe('Refused');
    expect(r.saved.unread.map(x => x.text)).toEqual(['Long read']);
    expect(r.saved.readCount).toBe(1);
    expect(r.changed.map(x => x.text)).toEqual(['News']);
    expect(r.tools).toEqual([{ id: 'base64', name: 'base64', n: 2 }]);
    expect(r.errors).toEqual([]);
  });

  it('reports a failed source and keeps the rest', async () => {
    global.window.vex.reminders.list = vi.fn(async () => { throw new Error('bridge down'); });
    const r = await VexReview.build(NOW);
    expect(r.errors).toEqual(['reminders: bridge down']);
    expect(r.changed).toHaveLength(1);
  });

  it('opens a card with the numbers and the lists', async () => {
    document.body.innerHTML = '';
    const card = await VexReview.open(NOW);
    expect(card).toBeTruthy();
    expect([...card.querySelectorAll('.rv-stat b')].map(b => b.textContent)).toEqual(['3', '1', '1', '1']);
    expect(card.textContent).toContain('Long read');
    card.querySelector('#rv-done').click();
    expect(document.getElementById('vex-review')).toBe(null);
  });
});

describe('scheduling itself', () => {
  beforeEach(() => { localStorage.clear(); });

  it('creates one weekly Friday 17:00 review reminder, once', async () => {
    const create = vi.fn(async (m, at, x) => ({ id: 'rv', message: m, at, ...x }));
    global.window.vex = { reminders: { list: vi.fn(async () => []), create, onFired: vi.fn() } };
    expect(await VexReview.ensureScheduled()).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    const [msg, at, extra] = create.mock.calls[0];
    expect(msg).toBe('Weekly review');
    expect(new Date(at).getDay()).toBe(5);
    expect(new Date(at).getHours()).toBe(17);
    expect(extra).toEqual({ kind: 'review', repeat: 'weekly' });
    expect(localStorage.getItem('vex.review.seeded')).toBe('1');
    expect(await VexReview.ensureScheduled()).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('does not recreate one that exists, and respects one that was removed after seeding', async () => {
    const create = vi.fn();
    global.window.vex = { reminders: { list: vi.fn(async () => [{ kind: 'review', firedAt: null }]), create, onFired: vi.fn() } };
    await VexReview.ensureScheduled();
    expect(create).not.toHaveBeenCalled();
    localStorage.setItem('vex.review.seeded', '1');
    global.window.vex.reminders.list = vi.fn(async () => []);
    expect(await VexReview.ensureScheduled()).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('opens the card when the review reminder fires', async () => {
    document.body.innerHTML = '';
    let handler = null;
    global.window.vex = { reminders: { list: vi.fn(async () => []), create: vi.fn(async () => ({})), onFired: (cb) => { handler = cb; } } };
    globalThis.ReadLater = { items: [] }; localStorage.setItem('vex.pageWatches', '[]');
    expect(VexReview.init()).toBe(true);
    handler({ id: 'rv', kind: 'review', message: 'Weekly review' });
    await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    expect(document.getElementById('vex-review')).toBeTruthy();
  });
});
