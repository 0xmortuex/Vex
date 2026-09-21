// @vitest-environment jsdom
//
// A setup code carried the decoration. This carries the rest — notes,
// sessions, keybindings, site rules, the lot. The two things that matter most
// are what it refuses to carry (anything that looks like a secret, and
// anything that is about this machine rather than this person) and that a
// restore can be undone, because the commonest way to lose everything is to
// restore the wrong file.

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
