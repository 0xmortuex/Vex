import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const { JsonStore, SecretStore } = createRequire(import.meta.url)('../../src/main/file-store.js');
const { createPreferenceStore } = createRequire(import.meta.url)('../../src/main/storage.js');
const directories = [];
async function directory() { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vex-store-test-')); directories.push(dir); return dir; }
afterEach(async () => { for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
describe('durable storage', () => {
  it('orders preference changes and deletion across windows', async () => {
    const file = path.join(await directory(), 'preferences.json');
    const store = createPreferenceStore(file);
    await Promise.all([store.set('vex.a', 'a'), store.set('vex.b', 'b'), store.delete('vex.a')]);
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ 'vex.b': 'b', __vexPreferenceStore: 1 });
    expect(store.load()).toEqual({ 'vex.b': 'b', __vexPreferenceStore: 1 });
    await store.delete('vex.b');
    expect(createPreferenceStore(file).load()).toEqual({ __vexPreferenceStore: 1 });
  });
  it('does not replace an unsupported future format with an older backup', async () => {
    const dir = await directory(), store = new JsonStore(dir);
    const future = JSON.stringify({ $vexStore: 99, data: ['future'] });
    await fs.writeFile(path.join(dir, 'tabs.json'), future);
    await fs.writeFile(path.join(dir, 'tabs.json.bak'), '[]');
    await expect(store.read('tabs')).rejects.toThrow('Unsupported storage version');
    expect(await fs.readFile(path.join(dir, 'tabs.json'), 'utf8')).toBe(future);
  });
  it('serializes secret removal after pending writes so sign-out cannot resurrect a key', async () => {
    const file = path.join(await directory(), 'secret');
    const store = new SecretStore({ isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s) });
    const write = store.write(file, 'key');
    const clear = store.clear(file);
    await Promise.all([write, clear]);
    await expect(fs.access(file)).rejects.toThrow();
  });
  it('serializes updates from concurrent callers without lost records', async () => {
    const store = new JsonStore(await directory());
    await Promise.all(Array.from({ length: 25 }, (_, id) => store.update('history', old => [...(old || []), { id }])));
    expect((await store.read('history')).map(x => x.id)).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(store.pending.size).toBe(0);
  });
  it('serializes legacy migration with writes and recovers a damaged primary', async () => {
    const dir = await directory(), store = new JsonStore(dir);
    await fs.writeFile(path.join(dir, 'tabs.json'), '[1]');
    await Promise.all([store.read('tabs'), store.write('tabs', [2]), store.read('tabs')]);
    expect(await store.read('tabs')).toEqual([2]);
    await fs.writeFile(path.join(dir, 'tabs.json'), '{broken');
    expect(await store.read('tabs')).toEqual([1]);
    expect(JSON.parse(await fs.readFile(path.join(dir, 'tabs.json'), 'utf8')).$vexStore).toBe(1);
  });
  it('rejects traversal and retries after an operation fails', async () => {
    const store = new JsonStore(await directory());
    await expect(store.write('../secret', 1)).rejects.toThrow('Invalid storage key');
    await expect(store.update('tabs', () => { throw new Error('disk failure'); })).rejects.toThrow();
    await store.write('tabs', [3]);
    expect(await store.read('tabs')).toEqual([3]);
  });
  it('migrates secrets without a plaintext backup and orders concurrent writes', async () => {
    const file = path.join(await directory(), 'key');
    const codec = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s).map(b => b ^ 83), decryptString: b => Buffer.from(b).map(b => b ^ 83).toString() };
    const store = new SecretStore(codec);
    await fs.writeFile(file, 'old-secret');
    expect(await store.read(file)).toBe('old-secret');
    expect((await fs.readFile(file)).includes(Buffer.from('old-secret'))).toBe(false);
    await expect(fs.access(file + '.bak')).rejects.toThrow();
    await Promise.all([store.write(file, 'a'), store.read(file), store.write(file, 'b')]);
    expect(await store.read(file)).toBe('b');
  });
});
