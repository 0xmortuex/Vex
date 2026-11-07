// @vitest-environment jsdom
//
// The backup's checksum, its version, and the refusal to restore a damaged file.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import nodeCrypto from 'node:crypto';

require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/i18n-ui.js');
const { VexBackup } = require('../../src/renderer/js/backup.js');
globalThis.VexBackup = VexBackup;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  VexBackup._undo = null;
  delete window.vex;
});

describe('the SHA-256', () => {
  it('matches Node for the empty string, block edges, long input and non-ASCII', () => {
    for (const t of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), 'ğüşiöç '.repeat(300), 'x'.repeat(100000)]) {
      expect(VexBackup.sha256Hex(t)).toBe(nodeCrypto.createHash('sha256').update(t).digest('hex'));
    }
  });
});

describe('canonical form', () => {
  it('does not depend on key order or indentation', () => {
    expect(VexBackup.canonical({ b: 1, a: { d: [1, { y: 1, x: 2 }], c: null } })).toBe(VexBackup.canonical({ a: { c: null, d: [1, { x: 2, y: 1 }] }, b: 1 }));
  });
});

describe('seal and verify', () => {
  const make = () => VexBackup.seal({ v: 2, at: 'x', items: { 'vex.a': '1' }, stores: { settings: { k: 1 } }, main: { 'site-rules': { rules: {} } } });
  it('a sealed backup verifies, even re-indented', () => {
    const d = JSON.parse(JSON.stringify(make(), null, 4));
    expect(VexBackup.verify(d)).toBe('verified');
    expect(d.integrity.alg).toBe('sha256');
  });
  it('a changed item, store or main store is caught', () => {
    for (const edit of [(d) => { d.items['vex.a'] = '2'; }, (d) => { d.stores.settings.k = 2; }, (d) => { d.main['site-rules'].rules['x.test'] = { js: 'off' }; }, (d) => { d.items['vex.new'] = 'x'; }]) {
      const d = make();
      edit(d);
      expect(() => VexBackup.verify(d)).toThrow(/damaged/);
    }
  });
  it('a version 2 file with its checksum stripped is refused; a version 1 file is read as unverified', () => {
    const d = make();
    delete d.integrity;
    expect(() => VexBackup.verify(d)).toThrow(/lost its integrity check/);
    expect(VexBackup.verify({ v: 1, items: {} })).toBe('unverified');
  });
  it('an unknown hash name is refused', () => {
    const d = make();
    d.integrity.alg = 'md5';
    expect(() => VexBackup.verify(d)).toThrow(/does not know/);
  });
});

describe('versions', () => {
  it('reads both version 1 and 2, and a snapshot is version 2 with a checksum and the main stores', async () => {
    expect(VexBackup.describe({ v: 1, items: { 'vex.a': 'x' } })).toMatchObject({ count: 1, integrity: 'unverified' });
    expect(VexBackup.describe({ v: 3, items: {} })).toBe(null);
    window.vex = { backup: { collectMain: async () => ({ ok: true, main: { 'site-rules': { rules: { 'a.test': { js: 'off' } } } } }) } };
    window.VexStorage = { load: async () => ({ s: 1 }), save: async () => {} };
    globalThis.VexStorage = window.VexStorage;
    localStorage.setItem('vex.theme', 'x');
    const snap = await VexBackup.snapshot();
    expect(snap.v).toBe(2);
    expect(snap.main['site-rules'].rules['a.test']).toEqual({ js: 'off' });
    expect(VexBackup.verify(snap)).toBe('verified');
    expect(VexBackup.describe(snap)).toMatchObject({ integrity: 'verified', main: ['site-rules'] });
    delete globalThis.VexStorage;
  });
  it('a failed read of the main stores fails the backup instead of leaving them out silently', async () => {
    window.vex = { backup: { collectMain: async () => ({ ok: false, error: 'reminders are not running' }) } };
    globalThis.VexStorage = { load: async () => ({}) };
    await expect(VexBackup.snapshot()).rejects.toThrow(/reminders are not running/);
    delete globalThis.VexStorage;
  });
});

describe('a damaged backup is not restored', () => {
  it('apply() throws before it writes anything', () => {
    localStorage.setItem('vex.theme', 'before');
    const d = VexBackup.seal({ v: 2, items: { 'vex.theme': 'after' }, stores: {}, main: {} });
    d.items['vex.theme'] = 'tampered';
    expect(() => VexBackup.apply(d)).toThrow(/damaged/);
    expect(localStorage.getItem('vex.theme')).toBe('before');
  });
  it('the restore screen refuses, says why, and asks nothing', async () => {
    window.vexConfirm = vi.fn(async () => true);
    globalThis.vexConfirm = window.vexConfirm;
    const m = document.createElement('div');
    m.innerHTML = '<div id="bk-msg"></div>';
    const msgs = [];
    const d = VexBackup.seal({ v: 2, items: { 'vex.theme': 'a' }, stores: {}, main: {} });
    d.items['vex.theme'] = 'b';
    await VexBackup._restore(d, m, (t, bad) => msgs.push([t, bad]));
    expect(msgs[0][1]).toBe(true);
    expect(msgs[0][0]).toMatch(/damaged/);
    expect(window.vexConfirm).not.toHaveBeenCalled();
    expect(localStorage.getItem('vex.theme')).toBe(null);
  });
  it('a good one restores the main stores too, and Undo asks main to put them back', async () => {
    const calls = [];
    window.vex = { backup: { applyMain: async (main) => { calls.push(['apply', Object.keys(main)]); return { ok: true, written: 2, notes: ['Restored reminders fire while Vex is open'] }; }, undoMain: async () => { calls.push(['undo']); return { ok: true }; } } };
    window.vexConfirm = vi.fn(async () => true);
    globalThis.vexConfirm = window.vexConfirm;
    const m = document.createElement('div');
    m.innerHTML = '<div id="bk-msg"></div>';
    document.body.appendChild(m);
    const msgs = [];
    const d = VexBackup.seal({ v: 2, items: { 'vex.theme': 'a' }, stores: {}, main: { 'site-rules': { rules: { 'a.test': { js: 'off' } } } } });
    await VexBackup._restore(d, m, (t) => msgs.push(t));
    expect(calls[0]).toEqual(['apply', ['site-rules']]);
    expect(msgs.at(-1)).toMatch(/Restored 3 things/);
    expect(msgs.at(-1)).toMatch(/fire while Vex is open/);
    m.querySelector('#bk-undo').click();
    await new Promise(r => setTimeout(r, 0));
    expect(calls.at(-1)).toEqual(['undo']);
    expect(localStorage.getItem('vex.theme')).toBe(null);
  });
});
