// @vitest-environment jsdom
//
// T2-073: the orders hub knows more carriers by the shape of the number, watches the carrier's
// page through Page watch when asked, keeps a timeline per order and groups orders for the brief.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
let O, watchList, watchApi;

beforeEach(() => {
  localStorage.clear();
  globalThis.VexLifeKit = fresh(JS + 'life-kit.js').VexLifeKit || window.VexLifeKit;
  window.VexLifeKit = globalThis.VexLifeKit;
  window.vex = { reminders: { create: vi.fn(async () => ({ id: 'r1' })), delete: vi.fn(async () => true) } };
  ({ OrdersHub: O } = fresh(JS + 'orders-hub.js'));
  watchList = [];
  watchApi = {
    list: () => watchList,
    add: vi.fn((o) => { const w = { id: 'w' + (watchList.length + 1), ...o }; watchList.push(w); return w; }),
    remove: vi.fn((id) => { watchList = watchList.filter(w => w.id !== id); }),
  };
  globalThis.PageWatch = watchApi;
  globalThis.TabManager = { createTab: vi.fn() };
});

describe('carrier detection', () => {
  it('tells UPS, PTT, USPS, DHL Express and FedEx apart by the number', () => {
    expect(O.guessCarrier('1Z999AA10123456784')).toBe('ups');
    expect(O.guessCarrier('rr123456789tr')).toBe('ptt');
    expect(O.guessCarrier('9400111899223197428490')).toBe('usps');
    expect(O.guessCarrier('EA123456789US')).toBe('usps');
    expect(O.guessCarrier('1234567890')).toBe('dhl');
    expect(O.guessCarrier('123456789012')).toBe('fedex');
    expect(O.guessCarrier('1 2345 6789 0123 45')).toBe('fedex');
  });
  it('does not guess a carrier it has no pattern for', () => {
    expect(O.guessCarrier('ABC123')).toBe('');
    expect(O.guessCarrier('12345')).toBe('');
    expect(O.guessCarrier('')).toBe('');
  });
  it('"detect" picks the carrier on save and refuses when nothing fits', () => {
    expect(O.clean({ carrier: 'auto', number: '1Z999AA10123456784', label: 'Shoes' }).carrier).toBe('ups');
    expect(() => O.clean({ carrier: 'auto', number: 'ZZZ-1234567', label: 'Shoes' })).toThrow(/choose the carrier/);
  });
  it('every named carrier makes a tracking page address with the number encoded', () => {
    for (const k of ['ups', 'fedex', 'dhl', 'usps']) {
      expect(O.trackUrl({ carrier: k, number: 'A B' })).toMatch(/^https:\/\/.*A%20B$/);
    }
  });
});

describe('watching the carrier page', () => {
  const make = async (over = {}) => (await O.add({ carrier: 'ups', number: '1Z999AA10123456784', label: 'Shoes', ...over })).order;
  it('hands the public page to Page watch, only when asked, and tags it', async () => {
    const o = await make();
    expect(watchApi.add).not.toHaveBeenCalled();
    O.watch(o.id);
    expect(watchApi.add).toHaveBeenCalledTimes(1);
    expect(watchApi.add.mock.calls[0][0]).toMatchObject({ url: expect.stringContaining('ups.com/track'), source: 'orders-hub', byUser: true });
    expect(O.all()[0].watchId).toBe('w1');
    expect(() => O.watch(o.id)).toThrow(/already being watched/);
  });
  it('stops the watch, and delivered or deleted parcels take theirs with them', async () => {
    const a = await make(); const b = await make({ number: '1Z999AA10123456785' });
    O.watch(a.id); O.watch(b.id);
    O.unwatch(a.id);
    expect(watchApi.remove).toHaveBeenCalledWith('w1');
    expect(O.all().find(x => x.id === a.id).watchId).toBe('');
    await O.markDelivered(b.id);
    expect(watchApi.remove).toHaveBeenCalledWith('w2');
    expect(O.all().find(x => x.id === b.id).watchId).toBe('');
  });
  it('raises when Page watch is missing', async () => {
    const o = await make();
    delete globalThis.PageWatch;
    expect(() => O.watch(o.id)).toThrow(/Page watch is not loaded/);
  });
  it('a change of our page goes on the timeline, another page does not', async () => {
    const o = await make(); O.watch(o.id);
    expect(O.onPageWatch({ watch: { id: 'w1', source: 'orders-hub' } })).toBe(true);
    expect(O.onPageWatch({ watch: { id: 'w9', source: 'orders-hub' } })).toBe(false);
    expect(O.onPageWatch({ watch: { id: 'w1', source: 'user' } })).toBe(false);
    expect(O.all()[0].events.map(e => e.text)).toContain('The carrier page changed');
  });
});

describe('the timeline', () => {
  it('records adding, tracking and delivering, and keeps at most 30', async () => {
    const { order } = await O.add({ carrier: 'ptt', number: 'RR123456789TR', label: 'Book' });
    O.track(order);
    await O.markDelivered(order.id);
    const texts = O.all()[0].events.map(e => e.text);
    expect(texts[0]).toMatch(/^Added/);
    expect(texts).toContain('Opened the carrier page');
    expect(texts[texts.length - 1]).toBe('Marked delivered');
    for (let i = 0; i < 40; i++) O.noteEvent(order.id, 'e' + i);
    expect(O.all()[0].events).toHaveLength(30);
  });
  it('raises for an order that is gone', () => {
    expect(() => O.noteEvent('nope', 'x')).toThrow(/gone/);
  });
});

describe('the Morning Brief section', () => {
  const day = (offset) => window.VexLifeKit.dayString(window.VexLifeKit.addDays(Date.now(), offset));
  it('is empty with nothing open, and groups pick-ups, late parcels and the rest', async () => {
    expect(await O.briefModule().build()).toBeNull();
    const orders = [
      { id: 'a', carrier: 'ptt', number: 'RR123456789TR', label: 'Held parcel', holdDay: day(1), status: 'open', added: Date.now() - 86400000, events: [], remindIds: [] },
      { id: 'b', carrier: 'ups', number: '1Z999AA10123456784', label: 'Late parcel', status: 'open', added: Date.now() - 20 * 86400000, events: [], remindIds: [] },
      { id: 'c', carrier: 'dhl', number: '1234567890', label: 'Fresh parcel', status: 'open', added: Date.now() - 86400000, events: [], remindIds: [] },
      { id: 'd', carrier: 'dhl', number: '1234567891', label: 'Done', status: 'delivered', added: Date.now() - 86400000, events: [], remindIds: [] },
    ];
    window.VexLifeKit.write(O.KEY, { v: 1, orders });
    const g = O.groups();
    expect([g.hold.length, g.late.length, g.rest.length]).toEqual([1, 1, 1]);
    const out = await O.briefModule().build();
    expect(out.summary).toBe('1 to pick up, 1 late, 1 on the way.');
    expect(out.lines.map(l => l.text)).toEqual(['Held parcel', 'Late parcel', 'Fresh parcel']);
  });
  it('is registered for the brief and follows the hub switch', () => {
    expect(window.VexBriefModules.some(m => m.id === 'orders-hub')).toBe(true);
    O.setEnabled(false);
    expect(O.briefModule().isEnabled()).toBe(false);
  });
});
