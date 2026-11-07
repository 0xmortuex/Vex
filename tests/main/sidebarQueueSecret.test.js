// @vitest-environment node
//
// J2: the Queue's read secret used to sit in sidebar-config.json as plain text. It is sealed now (main's SecretStore),
// migrated from the old file without losing it: the plain copy goes only after the sealed copy is written AND read back.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const fs = require('fs'), os = require('os'), path = require('path');
const { loadSidebarConfigSealed, saveQueueConfigSealed, loadSidebarConfig, CONFIG_FILENAME, SEALED_FILENAME } = require('../../src/sidebar-config.js');

// A stand-in for SecretStore: values kept in memory by file name, with switches to make a step fail.
function fakeSecrets({ failWrite = false, wrongReadBack = false } = {}) {
  const files = new Map();
  return {
    files,
    async read(file) { const v = files.get(path.basename(file)); return v === undefined ? null : (wrongReadBack ? 'something else' : v); },
    async write(file, value) { if (failWrite) throw new Error('OS encryption is unavailable'); files.set(path.basename(file), value); return true; },
  };
}

let dir, cfgPath;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-qs-')); cfgPath = path.join(dir, CONFIG_FILENAME); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });
const plain = () => JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const OLD = { aiNewsUrl: 'https://news.example/', queueUrl: 'https://q.example.workers.dev', queueSecret: 'old-secret-1234', extra: 1 };

describe('moving the old plain secret to sealed storage', () => {
  it('keeps the old value working, seals it, and removes the plain copy afterwards', async () => {
    fs.writeFileSync(cfgPath, JSON.stringify(OLD));
    const s = fakeSecrets();
    const cfg = await loadSidebarConfigSealed(dir, s);
    expect(cfg.queueSecret).toBe('old-secret-1234');
    expect(cfg.queueUrl).toBe(OLD.queueUrl);
    expect(s.files.get(SEALED_FILENAME)).toBe('old-secret-1234');
    expect(plain()).toEqual({ aiNewsUrl: OLD.aiNewsUrl, queueUrl: OLD.queueUrl, extra: 1 });   // every other key kept
    expect(fs.readFileSync(cfgPath, 'utf8')).not.toContain('old-secret-1234');
    expect(fs.readdirSync(dir).filter(n => n.includes('.bak'))).toEqual([]);                      // no backup copy holds it either
  });

  it('leaves the plain copy in place when sealing fails, and the secret still works', async () => {
    fs.writeFileSync(cfgPath, JSON.stringify(OLD));
    const cfg = await loadSidebarConfigSealed(dir, fakeSecrets({ failWrite: true }));
    expect(cfg.queueSecret).toBe('old-secret-1234');
    expect(plain().queueSecret).toBe('old-secret-1234');
    expect(console.error).toHaveBeenCalled();
  });

  it('leaves the plain copy in place when the sealed copy does not read back the same', async () => {
    fs.writeFileSync(cfgPath, JSON.stringify(OLD));
    const cfg = await loadSidebarConfigSealed(dir, fakeSecrets({ wrongReadBack: true }));
    expect(cfg.queueSecret).toBe('old-secret-1234');
    expect(plain().queueSecret).toBe('old-secret-1234');
  });

  it('a sealed secret wins over a leftover plain one, and the leftover is removed', async () => {
    fs.writeFileSync(cfgPath, JSON.stringify(OLD));
    const s = fakeSecrets();
    s.files.set(SEALED_FILENAME, 'new-sealed-5678');
    const cfg = await loadSidebarConfigSealed(dir, s);
    expect(cfg.queueSecret).toBe('new-sealed-5678');
    expect('queueSecret' in plain()).toBe(false);
  });

  it('does nothing to a profile that never set a queue up', async () => {
    const s = fakeSecrets();
    expect(await loadSidebarConfigSealed(dir, s)).toEqual(loadSidebarConfig(dir));
    expect(s.files.size).toBe(0);
    expect(fs.existsSync(cfgPath)).toBe(false);
  });

  it('a hand-edited file that is not valid JSON is not touched', async () => {
    fs.writeFileSync(cfgPath, '{ broken');
    const s = fakeSecrets();
    await loadSidebarConfigSealed(dir, s);
    expect(fs.readFileSync(cfgPath, 'utf8')).toBe('{ broken');
  });
});

describe('saving', () => {
  it('seals the secret first, keeps the address and other keys in the file, and never writes the secret there', async () => {
    fs.writeFileSync(cfgPath, JSON.stringify({ aiNewsUrl: 'https://news.example/', extra: 1 }));
    const s = fakeSecrets();
    const saved = await saveQueueConfigSealed(dir, { queueUrl: ' https://q.example.workers.dev/ ', queueSecret: ' secret-1234 ' }, s);
    expect(saved).toEqual({ queueUrl: 'https://q.example.workers.dev', queueSecret: 'secret-1234' });
    expect(s.files.get(SEALED_FILENAME)).toBe('secret-1234');
    expect(plain()).toEqual({ aiNewsUrl: 'https://news.example/', extra: 1, queueUrl: 'https://q.example.workers.dev' });
    expect((await loadSidebarConfigSealed(dir, s)).queueSecret).toBe('secret-1234');
  });

  it('if sealing fails it says so and changes nothing (no plain fallback)', async () => {
    fs.writeFileSync(cfgPath, JSON.stringify(OLD));
    await expect(saveQueueConfigSealed(dir, { queueUrl: 'https://q2.example.workers.dev', queueSecret: 'secret-9999' }, fakeSecrets({ failWrite: true }))).rejects.toThrow(/encryption/);
    expect(plain()).toEqual(OLD);
  });

  it('refuses the same bad input as before', async () => {
    const s = fakeSecrets();
    await expect(saveQueueConfigSealed(dir, { queueUrl: 'http://q.example', queueSecret: 'secret-1234' }, s)).rejects.toThrow(/https/);
    await expect(saveQueueConfigSealed(dir, { queueUrl: 'https://q.example', queueSecret: 'x' }, s)).rejects.toThrow(/secret/);
    expect(s.files.size).toBe(0);
  });
});
