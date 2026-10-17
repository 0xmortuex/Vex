// @vitest-environment jsdom
//
// T2-073 (Wave 6): a tracking number that is only digits is ambiguous, so "Detect from the number" asks once
// and remembers the answer for numbers that look the same, instead of silently picking DHL or FedEx.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
let O;

beforeEach(() => {
  localStorage.clear();
  globalThis.VexLifeKit = fresh(JS + 'life-kit.js').VexLifeKit || window.VexLifeKit;
  window.VexLifeKit = globalThis.VexLifeKit;
  window.vex = { reminders: { create: vi.fn(async () => ({ id: 'r1' })), delete: vi.fn(async () => true) } };
  ({ OrdersHub: O } = fresh(JS + 'orders-hub.js'));
});

describe('digit-only numbers', () => {
  it('are not given a carrier by "detect": it asks, naming the usual one for the length', () => {
    expect(() => O.clean({ carrier: 'auto', number: '1234567890', label: 'Cable' })).toThrow(/only digits[\s\S]*Choose the carrier[\s\S]*DHL Express is the usual one/);
    expect(() => O.clean({ carrier: 'auto', number: '1234', label: 'x' })).toThrow(/only digits/);
    expect(() => O.clean({ carrier: 'auto', number: '1 2345 6789 0123 45', label: 'x' })).toThrow(/FedEx is the usual one/);
  });
  it('a number with letters is still detected at once', () => {
    expect(O.clean({ carrier: 'auto', number: '1Z999AA10123456784', label: 'Shoes' })).toMatchObject({ carrier: 'ups', carrierBy: 'detected' });
    expect(O.clean({ carrier: 'auto', number: 'RR123456789TR', label: 'Parcel' })).toMatchObject({ carrier: 'ptt', carrierBy: 'detected' });
  });
  it('the carrier the person chooses is remembered for numbers of the same length and start', async () => {
    const first = await O.add({ carrier: 'aras', number: '1234567890123', label: 'Book' });
    expect(first.order).toMatchObject({ carrier: 'aras', carrierBy: 'chosen' });
    expect(O.remembered('1234567890999')).toBe('aras');             // same length, same first three digits
    expect(O.remembered('1244567890123')).toBe('');                 // another start: asks again
    expect(O.remembered('123456789012')).toBe('');                  // another length: asks again
    const next = await O.add({ carrier: 'auto', number: '1234567890999', label: 'Another book' });
    expect(next.order).toMatchObject({ carrier: 'aras', carrierBy: 'remembered' });
    expect(next.order.events[0].text).toMatch(/the carrier you chose for a number like it/);
  });
  it('a number with letters is not put in the memory, and "Other carrier" never is', async () => {
    await O.add({ carrier: 'ups', number: '1Z999AA10123456784', label: 'Shoes' });
    await O.add({ carrier: 'other', number: '12345678', link: 'https://track.example/1', label: 'Odd' });
    expect(localStorage.getItem(O.MEMORY_KEY)).toBe(null);
  });
  it('can be forgotten, and an unreadable memory is an error, not an empty one', () => {
    O.remember('1234567890', 'dhl');
    expect(O.remembered('1234567890')).toBe('dhl');
    O.forgetCarriers();
    expect(O.remembered('1234567890')).toBe('');
    localStorage.setItem(O.MEMORY_KEY, '{nope');
    expect(() => O.remembered('1234567890')).toThrow(/not readable/);
  });
  it('keeps at most 100 remembered shapes', () => {
    for (let i = 0; i < 105; i++) O.remember(String(100 + i) + '0000000', 'dhl');
    expect(Object.keys(JSON.parse(localStorage.getItem(O.MEMORY_KEY))).length).toBe(100);
  });
});
