// @vitest-environment jsdom
//
// A setup code carried the decoration. This carries the rest — notes,
// sessions, keybindings, site rules, the lot. The two things that matter most
// are what it refuses to carry (anything that looks like a secret, and
// anything that is about this machine rather than this person) and that a
// restore can be undone, because the commonest way to lose everything is to
// restore the wrong file.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Close buttons and ticks are VexIcons SVGs (sweep 2026-09-29).
require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;

require('../../src/renderer/js/vex-utils.js');
const { VexBackup } = require('../../src/renderer/js/backup.js');
globalThis.VexBackup = VexBackup;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  VexBackup._undo = null;
  localStorage.setItem('vex.notes', '[{"t":"a note"}]');
  localStorage.setItem('vex.siteRoutes', '[{"host":"a.test","mode":"tor"}]');
  localStorage.setItem('vex.theme', 'oxford');
  localStorage.setItem('vex.userShortcuts', '{"new-tab":"Ctrl+E"}');
  localStorage.setItem('vex.aiConversations', '{"tab1":[]}');
  localStorage.setItem('vex.installedAt', '123');           // this machine
  localStorage.setItem('vex.panelUsage', '{"discord":1}');  // this machine
  localStorage.setItem('vex.vaultSeeded', '1');             // looks like a secret
  localStorage.setItem('somethingElse', 'not ours');
});

describe('what goes in the file', () => {
  it('carries what is about you', () => {
    const items = VexBackup.collect().items;
    expect(Object.keys(items).sort()).toEqual(['vex.notes', 'vex.siteRoutes', 'vex.theme', 'vex.userShortcuts']);
    expect(items['vex.notes']).toBe('[{"t":"a note"}]');
  });

  // A backup containing your passwords is a password file with a friendly
  // name, sitting in your Downloads folder.
  it('never carries anything that looks like a secret', () => {
    localStorage.setItem('vex.someApiToken', 'sk-123');
    localStorage.setItem('vex.myPassphrase', 'hunter2');
    const items = VexBackup.collect(['chats', 'history']).items;
    for (const k of Object.keys(items)) expect(k).not.toMatch(/pass|token|vault|totp/i);
  });

  it('leaves out what is true of this machine, not of you', () => {
    const items = VexBackup.collect().items;
    expect(items['vex.installedAt']).toBeUndefined();
    expect(items['vex.panelUsage']).toBeUndefined();
  });

  it('leaves anything that is not ours alone', () => {
    expect(VexBackup.collect().items.somethingElse).toBeUndefined();
  });

  // The most personal thing Vex holds. A decision, not a default.
  it('carries the AI conversations only when asked', () => {
    expect(VexBackup.collect().items['vex.aiConversations']).toBeUndefined();
    expect(VexBackup.collect(['chats']).items['vex.aiConversations']).toBe('{"tab1":[]}');
  });
});

describe('putting it back', () => {
  const file = () => VexBackup.collect(['chats']);

  it('says what a file holds before anything is changed', () => {
    const seen = VexBackup.describe(file());
    expect(seen.count).toBe(5);
    expect(seen.chats).toBe(true);
    expect(VexBackup.describe({ v: 99 })).toBe(null);
    expect(VexBackup.describe(null)).toBe(null);
    expect(VexBackup.describe({ v: 1 })).toBe(null);
  });

  it('restores the settings and reports how many', () => {
    const saved = file();
    localStorage.setItem('vex.theme', 'something-else');
    localStorage.removeItem('vex.notes');
    const r = VexBackup.apply(saved);
    expect(r.written).toBe(5);
    expect(localStorage.getItem('vex.theme')).toBe('oxford');
    expect(localStorage.getItem('vex.notes')).toBe('[{"t":"a note"}]');
  });

  // One bad entry must not cost the other four hundred.
  it('skips a bad entry and keeps the rest', () => {
    const r = VexBackup.apply({ v: 1, items: { 'vex.theme': 'oxford', 'notmine': 'x', 'vex.evilToken': 'no', 'vex.n': 5 } });
    expect(r.written).toBe(1);
    expect(r.failed).toBe(3);
    expect(localStorage.getItem('notmine')).toBe(null);
  });

  it('refuses something that is not a backup', () => {
    expect(() => VexBackup.apply({ hello: 'world' })).toThrow(/not a Vex backup/);
  });

  // The commonest way to lose everything is to restore the wrong file.
  it('can be undone, back to exactly what was there', () => {
    const before = VexBackup.collect(['chats']).items;
    VexBackup.apply({ v: 1, items: { 'vex.theme': 'midnight', 'vex.brandNew': 'hello' } });
    expect(localStorage.getItem('vex.theme')).toBe('midnight');
    expect(localStorage.getItem('vex.brandNew')).toBe('hello');
    VexBackup.undo();
    expect(localStorage.getItem('vex.theme')).toBe(before['vex.theme']);
    expect(localStorage.getItem('vex.brandNew')).toBe(null);
    expect(localStorage.getItem('vex.installedAt')).toBe('123');   // untouched all along
    expect(() => VexBackup.undo()).toThrow(/Nothing has been restored/);
  });
});

describe('the screen', () => {
  it('counts what it would save and offers both directions', () => {
    VexBackup.open();
    const card = document.getElementById('vex-backup');
    expect(card.textContent).toMatch(/4 things right now/);
    expect(card.querySelector('#bk-save')).not.toBeNull();
    expect(card.querySelector('#bk-restore')).not.toBeNull();
    expect(card.textContent).toMatch(/Saved logins and authenticator codes are never in the file/);
  });

  it('will not restore with no file chosen', async () => {
    VexBackup.open();
    document.querySelector('#bk-restore').click();
    await Promise.resolve();
    expect(document.querySelector('#bk-msg').textContent).toMatch(/Choose a backup file/);
  });
});

// The backups Vex makes by itself before an update (update-notifier.js,
// src/main/update-backups.js) are listed here, each with Restore — the same
// restore, with the same question and the same Undo.
describe('saved before updates', () => {
  const flush = () => new Promise(r => setTimeout(r, 0));
  const saved = { v: 1, at: '2026-10-01T12:05:09.000Z', app: '2.35.0', items: { 'vex.theme': 'before-update-theme', 'vex.notes': '[{"t":"old note"}]' }, stores: {} };
  beforeEach(() => {
    delete window.VexTabPolicy;
    window.vex = { updates: {
      listBackups: vi.fn(async () => ({ ok: true, items: [
        { name: 'before-2.35.1-2026-10-01-140509.json', version: '2.35.1', at: new Date(2026, 9, 1, 14, 5, 9).getTime(), bytes: 4096 },
        { name: 'before-2.35.0-2026-09-30-090000.json', version: '2.35.0', at: new Date(2026, 8, 30, 9).getTime(), bytes: 2048 },
      ] })),
      readBackup: vi.fn(async () => ({ ok: true, text: JSON.stringify(saved) })),
    } };
    globalThis.vexConfirm = vi.fn(async () => true);
  });

  it('lists them, newest first, as "Before updating to X"', async () => {
    VexBackup.open();
    await flush();
    const rows = [...document.querySelectorAll('#bk-update-list [data-backup]')];
    expect(document.getElementById('bk-updates').hidden).toBe(false);
    expect(rows.map(r => r.querySelector('.vexsr-host').textContent)).toEqual(['Before updating to 2.35.1', 'Before updating to 2.35.0']);
    expect(rows[0].querySelector('.vexsr-mode').textContent).toMatch(/· 4 KB$/);
    expect(rows[0].querySelector('button').getAttribute('aria-label')).toBe('Restore the backup made before updating to 2.35.1');
  });

  it('Restore asks first, puts it back, and can be undone', async () => {
    VexBackup.open();
    await flush();
    document.querySelector('[data-backup="before-2.35.1-2026-10-01-140509.json"] button').click();
    await flush(); await flush();
    expect(window.vex.updates.readBackup).toHaveBeenCalledWith('before-2.35.1-2026-10-01-140509.json');
    expect(vexConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Restore this backup?', danger: true }));
    expect(vexConfirm.mock.calls[0][0].message).toMatch(/It holds 2 things, saved on .* by Vex 2\.35\.0\./);
    expect(localStorage.getItem('vex.theme')).toBe('before-update-theme');
    expect(document.querySelector('#bk-msg').textContent).toMatch(/Restored 2 things/);
    document.getElementById('bk-undo').click();
    await flush();
    expect(localStorage.getItem('vex.theme')).toBe('oxford');
  });

  it('nothing to list: the section stays hidden; a list that fails says so', async () => {
    window.vex.updates.listBackups = vi.fn(async () => ({ ok: true, items: [] }));
    VexBackup.open();
    await flush();
    expect(document.getElementById('bk-updates').hidden).toBe(true);
    window.vex.updates.listBackups = vi.fn(async () => ({ ok: false, error: 'EACCES' }));
    VexBackup.open();
    await flush();
    expect(document.getElementById('bk-updates').hidden).toBe(false);
    expect(document.getElementById('bk-update-list').textContent).toMatch(/could not be listed: EACCES/);
  });

  it('a private window does not ask for them', async () => {
    window.VexTabPolicy = { isPrivateWindow: true };
    VexBackup.open();
    await flush();
    expect(window.vex.updates.listBackups).not.toHaveBeenCalled();
    expect(document.getElementById('bk-updates').hidden).toBe(true);
  });
});
