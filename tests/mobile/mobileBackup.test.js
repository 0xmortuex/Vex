// @vitest-environment jsdom
//
// Backup and restore. The things worth pinning down: that the file is useless
// without the passphrase, that it refuses to carry what it must not carry, and
// that a restore puts back what was taken.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const store = new Map();
window.VexStore = {
  keys: () => [...store.keys()],
  get: (key, fallback) => (store.has(key) ? store.get(key) : fallback),
  set: async (key, value) => { store.set(key, value); return value; }
};
const db = { history: [], notes: [] };
window.VexDB = {
  scan: async (name, { limit } = {}) => (db[name] || []).slice(0, limit),
  add: async (name, row) => { (db[name] = db[name] || []).push(row); return row; }
};

// Restored history rows carry the same host the rest of Vex writes, which is
// VexSearch's — scheme and a leading www. stripped.
const { VexSearch } = require('../../mobile/www/js/search.js');
window.VexSearch = VexSearch;

const { VexBackup } = require('../../mobile/www/js/backup.js');

beforeEach(() => {
  store.clear();
  db.history = [];
  db.notes = [];
  store.set('vex.bookmarks', [{ url: 'https://a.example/', title: 'A', folder: 'Work' }]);
  store.set('vex.sessions', [{ name: 'Monday', tabs: [] }]);
  store.set('vex.siteRules', { 'x.example': { scripts: false } });
  store.set('vex.theme', 'midnight');
  store.set('vex.openTabs', [{ url: 'https://private.example/' }]);
  store.set('vex.sync', { key: 'secret' });
});

describe('what goes in', () => {
  it('carries the settings that describe the browser', async () => {
    const data = await VexBackup.collect();
    expect(data.settings['vex.theme']).toBe('midnight');
    expect(data.settings['vex.bookmarks']).toHaveLength(1);
  });

  it('never carries the open tabs or the sync key', async () => {
    const data = await VexBackup.collect();
    expect(data.settings['vex.openTabs']).toBeUndefined();
    expect(data.settings['vex.sync']).toBeUndefined();
  });

  it('leaves history out unless asked', async () => {
    db.history = [{ url: 'https://h.example/', title: 'H', at: 1 }];
    expect((await VexBackup.collect()).history).toBeUndefined();
    expect((await VexBackup.collect({ history: true })).history).toHaveLength(1);
  });

  it('counts what it would carry, for saying so first', async () => {
    const summary = await VexBackup.summary();
    expect(summary.bookmarks).toBe(1);
    expect(summary.sessions).toBe(1);
    expect(summary.rules).toBe(1);
  });
});

describe('the file', () => {
  it('cannot be read without the passphrase', async () => {
    const text = await VexBackup.write('a good passphrase');
    expect(text).not.toContain('midnight');
    expect(text).not.toContain('a.example');
    const envelope = JSON.parse(text);
    await expect(VexBackup.decrypt(envelope, 'the wrong one')).rejects.toThrow('does not open');
  });

  it('round-trips with the right one', async () => {
    const envelope = JSON.parse(await VexBackup.write('a good passphrase', { history: true }));
    const data = await VexBackup.decrypt(envelope, 'a good passphrase');
    expect(data.settings['vex.theme']).toBe('midnight');
  });

  it('refuses a passphrase too short to be worth anything', async () => {
    await expect(VexBackup.write('short')).rejects.toThrow('eight characters');
  });

  it('refuses a file that is not a backup', async () => {
    await expect(VexBackup.decrypt({ format: 'something else' }, 'x')).rejects.toThrow('not a Vex backup');
  });

  it('refuses a backup from a newer Vex rather than half-reading it', async () => {
    await expect(VexBackup.decrypt({ format: 'vex.backup', version: 99 }, 'x'))
      .rejects.toThrow('newer Vex');
  });
});

describe('putting it back', () => {
  it('restores the settings and leaves the excluded ones alone', async () => {
    const envelope = JSON.parse(await VexBackup.write('a good passphrase'));
    const data = await VexBackup.decrypt(envelope, 'a good passphrase');
    store.clear();
    const applied = await VexBackup.restore(data);
    expect(applied.settings).toBeGreaterThan(2);
    expect(window.VexStore.get('vex.theme')).toBe('midnight');
    expect(window.VexStore.get('vex.openTabs')).toBeUndefined();
  });

  it('adds notes and history rather than replacing them', async () => {
    db.notes = [{ id: 1, text: 'kept' }];
    db.history = [{ url: 'https://h.example/', title: 'H', at: 1 }];
    const data = await VexBackup.decrypt(
      JSON.parse(await VexBackup.write('a good passphrase', { history: true })), 'a good passphrase');
    const applied = await VexBackup.restore(data);
    expect(applied.notes).toBe(1);
    expect(applied.history).toBe(1);
    // The host has to match what a visit writes, or "forget this site" and the
    // per-site grouping both miss everything that came out of a backup.
    expect(db.history.at(-1).host).toBe('h.example');
    expect(db.notes.length).toBe(2);
  });

  it('ignores anything in the file that is not a Vex setting', async () => {
    const applied = await VexBackup.restore({ settings: { 'evil.key': 1, 'vex.theme': 'oxford' } });
    expect(applied.settings).toBe(1);
    expect(window.VexStore.get('evil.key')).toBeUndefined();
  });
});
