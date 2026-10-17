// T0-012: the atomic stores beyond the preference store. Data schema versions in JsonStore, a checksum in every
// envelope, a damaged secret file kept aside, a newer preference file refused, and the Settings switch for the
// volatile split.
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const req = createRequire(import.meta.url);
const { JsonStore, SecretStore, keepCorruptCopy } = req('../../src/main/file-store.js');
const { createPreferenceStore, SCHEMA } = req('../../src/main/storage.js');

const dirs = [];
async function dir() { const d = await fs.mkdtemp(path.join(os.tmpdir(), 'vex-schema-test-')); dirs.push(d); return d; }
afterEach(async () => { for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true }); });
const quiet = { error() {}, warn() {} };
const raw = async (d, name) => JSON.parse(await fs.readFile(path.join(d, name), 'utf8'));

describe('JsonStore envelope', () => {
  it('writes a checksum, and a registered key also writes its data schema version', async () => {
    const d = await dir();
    const store = new JsonStore(d, { log: quiet }).schema('notes', { version: 1 });
    await store.write('notes', { a: 1 });
    const file = await raw(d, 'notes.json');
    expect(file).toMatchObject({ $vexStore: 1, v: 1, data: { a: 1 } });
    expect(file.sum).toMatch(/^[0-9a-f]{64}$/);
    await store.write('plain', [1]);
    expect((await raw(d, 'plain.json')).v).toBeUndefined();
  });
  it('a file that parses but was altered fails its checksum, is kept aside, and the .bak takes its place', async () => {
    const d = await dir();
    const store = new JsonStore(d, { log: quiet });
    await store.write('tabs', { n: 1 });
    await store.write('tabs', { n: 2 });                       // .bak holds n: 1
    const file = path.join(d, 'tabs.json');
    const doc = JSON.parse(await fs.readFile(file, 'utf8'));
    doc.data.n = 999;                                          // altered, still valid JSON
    await fs.writeFile(file, JSON.stringify(doc));
    expect(await new JsonStore(d, { log: quiet }).read('tabs')).toEqual({ n: 1 });
    expect((await fs.readdir(d)).some(n => n.startsWith('tabs.json.corrupt-'))).toBe(true);
    expect((await raw(d, 'tabs.json')).data).toEqual({ n: 1 });
  });
  it('a damaged file with no good copy raises instead of returning nothing', async () => {
    const d = await dir();
    await fs.writeFile(path.join(d, 'tabs.json'), JSON.stringify({ $vexStore: 1, sum: 'bad', data: { n: 1 } }));
    await expect(new JsonStore(d, { log: quiet }).read('tabs')).rejects.toThrow(/checksum/);
  });
  it('a file from an older Vex (no checksum) is accepted and gets one', async () => {
    const d = await dir();
    await fs.writeFile(path.join(d, 'old.json'), JSON.stringify({ $vexStore: 1, data: { x: 1 } }));
    expect(await new JsonStore(d).read('old')).toEqual({ x: 1 });
  });
});

describe('JsonStore data schemas', () => {
  it('migrates an older version step by step on read and saves the new version', async () => {
    const d = await dir();
    await fs.writeFile(path.join(d, 'list.json'), JSON.stringify({ $vexStore: 1, v: 1, data: ['a'] }));
    const store = new JsonStore(d).schema('list', { version: 3, migrations: { 1: (x) => x.map(t => ({ t })), 2: (x) => ({ items: x }) } });
    expect(await store.read('list')).toEqual({ items: [{ t: 'a' }] });
    expect(await raw(d, 'list.json')).toMatchObject({ v: 3, data: { items: [{ t: 'a' }] } });
  });
  it('a file with no version counts as version 1', async () => {
    const d = await dir();
    await fs.writeFile(path.join(d, 'list.json'), JSON.stringify({ $vexStore: 1, data: ['a'] }));
    const store = new JsonStore(d).schema('list', { version: 2, migrations: { 1: (x) => ({ items: x }) } });
    expect(await store.read('list')).toEqual({ items: ['a'] });
  });
  it('a file written by a newer Vex raises and is not replaced by the .bak or rewritten', async () => {
    const d = await dir();
    const future = JSON.stringify({ $vexStore: 1, v: 9, data: { future: true } });
    await fs.writeFile(path.join(d, 'list.json'), future);
    await fs.writeFile(path.join(d, 'list.json.bak'), JSON.stringify({ $vexStore: 1, v: 1, data: [] }));
    const store = new JsonStore(d).schema('list', { version: 2, migrations: { 1: (x) => x } });
    await expect(store.read('list')).rejects.toMatchObject({ code: 'EVEXNEWER' });
    expect(await fs.readFile(path.join(d, 'list.json'), 'utf8')).toBe(future);
  });
  it('refuses a schema with a missing migration or a bad version', () => {
    const store = new JsonStore('x');
    expect(() => store.schema('k', { version: 2 })).toThrow(/no migration from version 1/);
    expect(() => store.schema('k', { version: 0 })).toThrow(/whole number/);
  });
});

describe('SecretStore', () => {
  it('keeps a secret file it cannot decrypt aside and says so, instead of leaving it to be overwritten', async () => {
    const d = await dir();
    const file = path.join(d, 'token');
    const good = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() };
    await new SecretStore(good).write(file, 'hello');
    const bad = { ...good, decryptString: () => { throw new Error('cannot decrypt'); } };
    await expect(new SecretStore(bad).read(file)).rejects.toThrow(/could not be decrypted; a copy was kept as token\.corrupt-/);
    expect((await fs.readdir(d)).some(n => n.startsWith('token.corrupt-'))).toBe(true);
    expect(fsSync.existsSync(file)).toBe(true);
  });
  it('keepCorruptCopy keeps only the newest three', async () => {
    const d = await dir();
    const f = path.join(d, 'a.json');
    await fs.writeFile(f, 'x');
    for (let i = 0; i < 5; i++) keepCorruptCopy(f, Date.UTC(2026, 0, 1, 0, 0, i * 20));
    expect((await fs.readdir(d)).filter(n => n.includes('.corrupt-'))).toHaveLength(3);
    expect(keepCorruptCopy(path.join(d, 'none.json'))).toBeNull();
  });
});

describe('preference store schema', () => {
  it('refuses a file stamped by a newer Vex, keeps it, and does not recover from an older copy', async () => {
    const d = await dir();
    const file = path.join(d, 'prefs.json');
    const store = createPreferenceStore(file, { log: quiet });
    await store.set('vex.a', '1');
    await store.set('vex.a', '2');                              // .bak exists
    await store.flush();
    const doc = JSON.parse(await fs.readFile(file, 'utf8'));
    doc.__vexPreferenceStore = SCHEMA + 1;
    delete doc.__vexChecksum;
    const text = JSON.stringify(doc);
    await fs.writeFile(file, text);
    expect(() => createPreferenceStore(file, { log: quiet }).load()).toThrow(/newer Vex/);
    expect(await fs.readFile(file, 'utf8')).toBe(text);
  });
});
