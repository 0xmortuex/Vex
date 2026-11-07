// Saved addresses (src/main/addresses.js): the checks on what a person enters, the sealed file, the list that carries no street or
// phone, Lock Vex, and the wiring that keeps the file out of backups, sync and the page-reachable channels.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { createAddressService, cleanAddress, publicView, MAX_ADDRESSES, LIMITS } = require('../../src/main/addresses.js');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

const HOME = { name: 'Ada Lovelace', street: '12 Analytical Way', city: 'London', postcode: 'N1 9GU', country: 'United Kingdom', phone: '+44 20 7946 0000' };

describe('the checks', () => {
  it('cleans an entry: spaces folded, control characters out, text cut to its limit', () => {
    const a = cleanAddress({ ...HOME, name: '  Ada \t  Lovelace ', street: '12\u0000 Analytical\nWay', city: 'x'.repeat(500) });
    expect(a.name).toBe('Ada Lovelace');
    expect(a.street).toBe('12 Analytical Way');
    expect(a.city.length).toBe(LIMITS.city);
  });
  it('makes a label from the street and city when none is given', () => {
    expect(cleanAddress(HOME).label).toBe('12 Analytical Way, London');
    expect(cleanAddress({ ...HOME, label: ' Home ' }).label).toBe('Home');
  });
  it('says in words what is missing or wrong', () => {
    expect(() => cleanAddress({ ...HOME, name: '' })).toThrow(/needs a name/);
    expect(() => cleanAddress({ ...HOME, street: ' ' })).toThrow(/needs a street/);
    expect(() => cleanAddress({ ...HOME, city: '' })).toThrow(/needs a city/);
    expect(() => cleanAddress({ ...HOME, postcode: '<b>' })).toThrow(/postcode/);
    expect(() => cleanAddress({ ...HOME, phone: 'call me' })).toThrow(/phone number/);
    expect(() => cleanAddress(null)).toThrow(/needs a name/);
  });
  it('accepts a missing postcode, country and phone, and Turkish letters', () => {
    const a = cleanAddress({ name: 'Çağla Şahin', street: 'Gül Sokak 4/2', city: 'İzmir', postcode: '', phone: '' });
    expect(a).toMatchObject({ name: 'Çağla Şahin', city: 'İzmir', postcode: '', phone: '', country: '' });
    expect(cleanAddress({ ...HOME, postcode: '35 330' }).postcode).toBe('35 330');
  });
  it('the public view has a label, a name, a city and a country, and no street or phone', () => {
    const v = publicView({ id: 'a', ...cleanAddress(HOME), updatedAt: 'x' });
    expect(Object.keys(v).sort()).toEqual(['city', 'country', 'id', 'label', 'name', 'updatedAt']);
    expect(JSON.stringify(v)).not.toContain('Analytical Way');
    expect(JSON.stringify(v)).not.toContain('7946');
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
  const make = (ipc) => createAddressService({ app: { getPath: () => dir }, safeStorage, ipcMain: { handle: (c, fn) => { ipc[c] = fn; } }, isLocked: () => locked });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-addr-'));
    handlers = {}; locked = false; encrypted = true;
    svc = make(handlers);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('registers exactly the four channels', () => {
    expect(Object.keys(handlers).sort()).toEqual(['addresses:delete', 'addresses:get', 'addresses:list', 'addresses:save']);
  });

  it('saves an address, lists it without the street, and gives the whole of it only on get', async () => {
    const saved = await call('addresses:save', HOME);
    expect(saved.ok).toBe(true);
    expect(saved.updated).toBe(false);
    const list = await call('addresses:list');
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain('Analytical Way');
    const full = await call('addresses:get', list[0].id);
    expect(full).toMatchObject(HOME);
    expect(Object.keys(full).sort()).toEqual(['city', 'country', 'id', 'label', 'name', 'phone', 'postcode', 'street']);
    expect(await call('addresses:get', 'nope')).toBeNull();
  });

  it('writes the file sealed, never the street in plain text', async () => {
    await call('addresses:save', HOME);
    await svc.flushAddresses();
    const raw = fs.readFileSync(path.join(dir, 'addresses.dat'), 'utf8');
    expect(raw.startsWith('enc:')).toBe(true);
    expect(raw).not.toContain('Analytical');
    expect(raw).not.toContain('Lovelace');
    expect(fs.readdirSync(dir).filter(f => /addresses/.test(f))).toEqual(['addresses.dat']);
  });

  it('refuses to save when the operating system cannot encrypt, and writes nothing', async () => {
    encrypted = false;
    const r = await call('addresses:save', HOME);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/encryption/i);
    expect(fs.existsSync(path.join(dir, 'addresses.dat'))).toBe(false);
  });

  it('says what is wrong with an entry instead of saving it', async () => {
    const r = await call('addresses:save', { ...HOME, street: '' });
    expect(r).toEqual({ ok: false, error: 'An address needs a street' });
    expect(await call('addresses:list')).toEqual([]);
  });

  it('saving with an id changes that address; an id that is gone is refused', async () => {
    const { address } = await call('addresses:save', HOME);
    const r = await call('addresses:save', { ...HOME, id: address.id, city: 'Leeds' });
    expect(r.updated).toBe(true);
    expect(await call('addresses:list')).toHaveLength(1);
    expect((await call('addresses:get', address.id)).city).toBe('Leeds');
    const gone = await call('addresses:save', { ...HOME, id: 'gone' });
    expect(gone).toEqual({ ok: false, error: 'That address is not saved any more' });
  });

  it('deletes an address', async () => {
    const { address } = await call('addresses:save', HOME);
    expect((await call('addresses:delete', address.id)).ok).toBe(true);
    expect(await call('addresses:list')).toEqual([]);
  });

  it('keeps at most twenty addresses', async () => {
    for (let i = 0; i < MAX_ADDRESSES; i++) expect((await call('addresses:save', { ...HOME, street: i + ' Road' })).ok).toBe(true);
    const over = await call('addresses:save', HOME);
    expect(over.ok).toBe(false);
    expect(over.error).toMatch(/up to 20/);
  });

  it('Lock Vex covers it: nothing is listed, given out or saved while locked', async () => {
    const { address } = await call('addresses:save', HOME);
    locked = true;
    expect(() => call('addresses:list')).toThrow(/Vex is locked/);
    expect(() => call('addresses:get', address.id)).toThrow(/Vex is locked/);
    expect((await call('addresses:save', HOME)).ok).toBe(false);
    expect((await call('addresses:delete', address.id)).ok).toBe(false);
    locked = false;
    expect(await call('addresses:list')).toHaveLength(1);
  });

  it('survives a restart: a new service reads what the first wrote', async () => {
    await call('addresses:save', HOME);
    await svc.flushAddresses();
    const again = {};
    make(again);
    const list = await again['addresses:list']({});
    expect(list).toHaveLength(1);
    expect((await again['addresses:get']({}, list[0].id)).street).toBe('12 Analytical Way');
  });

  it('keeps the old file when it cannot be read, and says so', async () => {
    fs.writeFileSync(path.join(dir, 'addresses.dat'), 'not sealed at all');
    expect(() => call('addresses:list')).toThrow(/Cannot read the encrypted address file/);
    expect(fs.readFileSync(path.join(dir, 'addresses.dat'), 'utf8')).toBe('not sealed at all');
  });
});

describe('the wiring', () => {
  it('every channel has a schema that accepts a good call and refuses a bad one', () => {
    const { validate } = require('../../src/main/ipc-schemas.js');
    expect(() => validate('addresses:list', [])).not.toThrow();
    expect(() => validate('addresses:get', ['abc'])).not.toThrow();
    expect(() => validate('addresses:get', [{}])).toThrow();
    expect(() => validate('addresses:delete', [7])).toThrow();
    expect(() => validate('addresses:save', [HOME])).not.toThrow();
    expect(() => validate('addresses:save', [{ ...HOME, id: 'x' }])).not.toThrow();
    expect(() => validate('addresses:save', [{ ...HOME, name: 5 }])).toThrow();
    expect(() => validate('addresses:save', [{ street: 'x' }])).toThrow();
  });
  it('the channels are Vex-window only and closed in private windows', () => {
    const policy = require('../../src/main/ipc-policy.js');
    for (const ch of ['addresses:list', 'addresses:get', 'addresses:save', 'addresses:delete']) expect(policy.UI_ONLY_CHANNELS.has(ch), ch).toBe(true);
    expect(read('src/main/ipc-policy.js')).toMatch(/PRIVATE_DISABLED = \/\^\(\?:[^\n]*\|cards:\|addresses:\|/);
  });
  it('the preload exposes the four calls', () => {
    const pre = read('src/preload.js');
    for (const ch of ['addresses:list', 'addresses:get', 'addresses:save', 'addresses:delete']) expect(pre).toContain("ipcRenderer.invoke('" + ch + "'");
  });
  it('is flushed on quit with the other sealed stores, and listed with the files "erase secure data" removes', () => {
    expect(read('src/main.js')).toMatch(/await flushCards\(\); await flushAddresses\(\);/);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-addr-ss-'));
    try { expect(require('../../src/main/secure-stores.js').describe({ userDataPath: empty }).map(s => s.id)).toContain('addresses'); }
    finally { fs.rmSync(empty, { recursive: true, force: true }); }
  });
  it('is in no backup, no sync and no secrets lifeboat: the file is named only where it is kept or erased', () => {
    const owners = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.js') && /addresses\.dat/.test(fs.readFileSync(p, 'utf8'))) owners.push(path.relative(path.join(__dirname, '../..'), p).replace(/\\/g, '/')); } };
    walk(path.join(__dirname, '../../src'));
    expect(owners.sort()).toEqual(['src/main/addresses.js', 'src/main/secure-stores.js']);
  });
});
