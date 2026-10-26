// Saved payment cards (src/main/cards.js), 2026-10-26: the checks on what a person enters, the encrypted file, the list that never
// carries a full number, Lock Vex, and that no security code is kept anywhere.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { createCardService, digitsOf, luhnOk, brandOf, parseExpiry, isExpired, cleanCard, publicView, MAX_CARDS } = require('../../src/main/cards.js');

const VISA = '4242 4242 4242 4242';
const MC = '5555555555554444';
const AMEX = '378282246310005';

describe('the checks', () => {
  it('drops the spaces and dashes people type', () => {
    expect(digitsOf('4242-4242 4242.4242')).toBe('4242424242424242');
  });
  it('knows a real card number from a mistyped one (Luhn)', () => {
    expect(luhnOk('4242424242424242')).toBe(true);
    expect(luhnOk('4242424242424241')).toBe(false);
    expect(luhnOk('1234')).toBe(false);
    expect(luhnOk('')).toBe(false);
  });
  it('names the brand from the leading digits', () => {
    expect(brandOf('4242424242424242')).toBe('Visa');
    expect(brandOf(MC)).toBe('Mastercard');
    expect(brandOf('2223003122003222')).toBe('Mastercard');
    expect(brandOf(AMEX)).toBe('American Express');
    expect(brandOf('6011111111111117')).toBe('Discover');
    expect(brandOf('9792000000000001')).toBe('Troy');
    expect(brandOf('1111111111111111')).toBe('card');
  });
  it('reads an expiry typed any usual way, and refuses nonsense', () => {
    expect(parseExpiry('08/27')).toEqual({ month: 8, year: 2027 });
    expect(parseExpiry('8 / 2027')).toEqual({ month: 8, year: 2027 });
    expect(parseExpiry('0827')).toEqual({ month: 8, year: 2027 });
    expect(parseExpiry(8, 27)).toEqual({ month: 8, year: 2027 });
    expect(parseExpiry('8', '2027')).toEqual({ month: 8, year: 2027 });
    expect(parseExpiry('13/27')).toBeNull();
    expect(parseExpiry('00/27')).toBeNull();
    expect(parseExpiry('soon')).toBeNull();
    expect(parseExpiry('')).toBeNull();
  });
  it('a card is good through the last day of its month', () => {
    const now = new Date(2026, 9, 26);
    expect(isExpired({ month: 10, year: 2026 }, now)).toBe(false);
    expect(isExpired({ month: 9, year: 2026 }, now)).toBe(true);
    expect(isExpired({ month: 1, year: 2027 }, now)).toBe(false);
    expect(isExpired({ month: 12, year: 2025 }, now)).toBe(true);
  });
  it('cleans an entry and says in words what is wrong', () => {
    const ok = cleanCard({ number: VISA, name: '  Ada   Lovelace ', expMonth: '8', expYear: '27', nickname: ' Work ' });
    expect(ok).toEqual({ number: '4242424242424242', brand: 'Visa', name: 'Ada Lovelace', nickname: 'Work', expMonth: 8, expYear: 2027 });
    expect(() => cleanCard({ number: '4242 4242 4242 4241', expMonth: 8, expYear: 27 })).toThrow(/does not look right/);
    expect(() => cleanCard({ number: 'abcd', expMonth: 8, expYear: 27 })).toThrow(/digits only/);
    expect(() => cleanCard({ number: VISA, expMonth: 14, expYear: 27 })).toThrow(/expiry/);
  });
  it('the public view has the last four digits and never the full number', () => {
    const view = publicView({ id: 'a', number: '4242424242424242', brand: 'Visa', name: 'A', expMonth: 8, expYear: 2027, updatedAt: 'x' });
    expect(view.last4).toBe('4242');
    expect(JSON.stringify(view)).not.toContain('4242424242424242');
    expect(Object.keys(view)).not.toContain('number');
  });
});

describe('the service', () => {
  let dir, handlers, locked, svc, encrypted;
  const safeStorage = {
    isEncryptionAvailable: () => encrypted,
    encryptString: (s) => Buffer.from('enc:' + Buffer.from(s, 'utf8').toString('base64'), 'utf8'),
    decryptString: (b) => Buffer.from(b.toString('utf8').slice(4), 'base64').toString('utf8'),
  };
  const call = (c, ...a) => handlers[c]({ sender: {} }, ...a);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-cards-'));
    handlers = {}; locked = false; encrypted = true;
    svc = createCardService({ app: { getPath: () => dir }, safeStorage, ipcMain: { handle: (c, fn) => { handlers[c] = fn; } }, isLocked: () => locked });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('saves a card, lists it masked, and reveals the full number only on request', async () => {
    const saved = await call('cards:save', { number: VISA, name: 'Ada', expMonth: 8, expYear: 27 });
    expect(saved.ok).toBe(true);
    expect(saved.card.last4).toBe('4242');
    const list = await call('cards:list');
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain('4242424242424242');
    const full = await call('cards:reveal', list[0].id);
    expect(full.number).toBe('4242424242424242');
    expect(full.expMonth).toBe(8);
    expect(await call('cards:reveal', 'nope')).toBeNull();
  });

  it('keeps no security code: neither in what it reveals nor in the file, even when one is handed to it', async () => {
    await call('cards:save', { number: VISA, name: 'Ada', expMonth: 8, expYear: 27, cvv: '123', cvc: '123', csc: '123' });
    const full = await call('cards:reveal', (await call('cards:list'))[0].id);
    expect(Object.keys(full).sort()).toEqual(['brand', 'expMonth', 'expYear', 'id', 'name', 'number']);
    const file = safeStorage.decryptString(fs.readFileSync(path.join(dir, 'cards.dat')));
    expect(file).not.toMatch(/cvv|cvc|csc|"123"/i);
  });

  it('writes the file sealed, never the number in plain text', async () => {
    await call('cards:save', { number: VISA, name: 'Ada', expMonth: 8, expYear: 27 });
    await svc.flushCards();
    const raw = fs.readFileSync(path.join(dir, 'cards.dat'), 'utf8');
    expect(raw.startsWith('enc:')).toBe(true);
    expect(raw).not.toContain('4242');
  });

  it('refuses to save when the operating system cannot encrypt', async () => {
    encrypted = false;
    const r = await call('cards:save', { number: VISA, expMonth: 8, expYear: 27 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/encryption/i);
    expect(fs.existsSync(path.join(dir, 'cards.dat'))).toBe(false);
  });

  it('saving a number that is already there updates it instead of adding a second', async () => {
    await call('cards:save', { number: VISA, name: 'Ada', expMonth: 8, expYear: 27 });
    const again = await call('cards:save', { number: '4242424242424242', name: 'Ada L', expMonth: 9, expYear: 28 });
    expect(again.updated).toBe(true);
    const list = await call('cards:list');
    expect(list).toHaveLength(1);
    expect(list[0].expMonth).toBe(9);
    expect(await call('cards:has', '4242 4242 4242 4242')).toBe(true);
    expect(await call('cards:has', MC)).toBe(false);
  });

  it('edits the name, expiry and nickname, but never the number', async () => {
    const { card } = await call('cards:save', { number: MC, name: 'A', expMonth: 1, expYear: 30 });
    const r = await call('cards:update', { id: card.id, name: 'B', expMonth: '2', expYear: '31', nickname: 'Travel', number: '4242424242424242' });
    expect(r.ok).toBe(true);
    expect(r.card).toMatchObject({ name: 'B', expMonth: 2, expYear: 2031, nickname: 'Travel', last4: '4444' });
    expect((await call('cards:reveal', card.id)).number).toBe(MC);
    expect((await call('cards:update', { id: card.id, expMonth: 13, expYear: 30 })).ok).toBe(false);
    expect((await call('cards:update', { id: 'gone', name: 'x' })).ok).toBe(false);
  });

  it('deletes a card', async () => {
    const { card } = await call('cards:save', { number: AMEX, expMonth: 1, expYear: 30 });
    expect((await call('cards:delete', card.id)).ok).toBe(true);
    expect(await call('cards:list')).toEqual([]);
  });

  it('keeps at most fifty cards', async () => {
    for (let i = 0; i < MAX_CARDS; i++) {
      // 4000 0000 0000 00xx style numbers that pass Luhn: vary the middle digits and fix the check digit.
      const base = '40000000' + String(i).padStart(7, '0');
      let sum = 0;
      for (let k = 0; k < base.length; k++) { let d = base.charCodeAt(base.length - 1 - k) - 48; if (k % 2 === 0) { d *= 2; if (d > 9) d -= 9; } sum += d; }
      const number = base + ((10 - (sum % 10)) % 10);
      expect(luhnOk(number)).toBe(true);
      expect((await call('cards:save', { number, expMonth: 1, expYear: 2040 })).ok).toBe(true);
    }
    const over = await call('cards:save', { number: MC, expMonth: 1, expYear: 2040 });
    expect(over.ok).toBe(false);
    expect(over.error).toMatch(/up to 50/);
  });

  it('Lock Vex covers it: nothing is listed, revealed or saved while locked', async () => {
    await call('cards:save', { number: VISA, expMonth: 8, expYear: 27 });
    locked = true;
    expect(() => call('cards:list')).toThrow(/Vex is locked/);
    expect(() => call('cards:reveal', 'x')).toThrow(/Vex is locked/);
    expect(() => call('cards:has', VISA)).toThrow(/Vex is locked/);
    expect((await call('cards:save', { number: MC, expMonth: 8, expYear: 27 })).ok).toBe(false);
    locked = false;
    expect(await call('cards:list')).toHaveLength(1);
  });

  it('survives a restart: a new service reads what the first wrote', async () => {
    await call('cards:save', { number: VISA, name: 'Ada', expMonth: 8, expYear: 27 });
    await svc.flushCards();
    const handlers2 = {};
    createCardService({ app: { getPath: () => dir }, safeStorage, ipcMain: { handle: (c, fn) => { handlers2[c] = fn; } }, isLocked: () => false });
    const list = await handlers2['cards:list']({});
    expect(list).toHaveLength(1);
    expect(list[0].last4).toBe('4242');
  });
});

describe('the wiring', () => {
  it('every card channel is in the schemas, window-only, and off in private windows', () => {
    const { validate } = require('../../src/main/ipc-schemas.js');
    expect(() => validate('cards:list', [])).not.toThrow();
    expect(() => validate('cards:reveal', ['abc'])).not.toThrow();
    expect(() => validate('cards:reveal', [{}])).toThrow();
    expect(() => validate('cards:save', [{ number: VISA, expMonth: 8, expYear: 27 }])).not.toThrow();
    expect(() => validate('cards:save', [{ number: 4242, expMonth: 8 }])).toThrow();
    const policy = fs.readFileSync(path.join(__dirname, '../../src/main/ipc-policy.js'), 'utf8');
    for (const ch of ['cards:list', 'cards:reveal', 'cards:has', 'cards:save', 'cards:update', 'cards:delete']) expect(policy).toContain("'" + ch + "'");
    expect(policy).toMatch(/PRIVATE_DISABLED = \/\^\(\?:[^\n]*\|cards:\|/);
  });
});
