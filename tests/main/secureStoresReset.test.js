// T3-123: the report of the secure stores and the explicit "forgot it" reset.
import { describe, it, expect, vi } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ss = require('../../src/main/secure-stores.js');

function profile(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-secure-'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

describe('describe', () => {
  it('says which secret files exist and whether they look encrypted', () => {
    const dir = profile({
      'vault.dat': Buffer.concat([Buffer.from('v10'), Buffer.alloc(40, 7)]),
      'github-token.enc': Buffer.concat([Buffer.from('VEXENC1\0'), Buffer.alloc(20, 1)]),
      'mcp-auth.enc': '{"a":1}',
      'totp.dat': Buffer.from([1, 0, 0, 0, 0xD0, 0x8C, 0x9D, 0xDF, 9, 9]),
      'sync-meta.json': 'garbage that is not json',
    });
    try {
      const r = Object.fromEntries(ss.describe({ userDataPath: dir }).map(s => [s.id, s]));
      expect(r.vault.state).toBe('encrypted');
      expect(r.github.state).toBe('encrypted');
      expect(r['mcp-auth'].state).toBe('plain');
      expect(r.totp.state).toBe('encrypted');
      expect(r['sync-meta'].state).toBe('unknown');
      expect(r.passkeys).toMatchObject({ exists: false, state: 'absent' });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('lists plainly what is not encrypted', () => {
    expect(ss.NOT_ENCRYPTED.join(' ')).toMatch(/Notes/);
    expect(ss.NOT_ENCRYPTED.join(' ')).toMatch(/history/);
  });
});

describe('wipe', () => {
  it('needs the exact phrase and touches nothing without it', () => {
    const dir = profile({ 'vault.dat': 'x' });
    try {
      for (const bad of [undefined, '', 'erase secure data', 'ERASE SECURE DATA ', 'yes']) expect(() => ss.wipe({ userDataPath: dir, confirm: bad }), String(bad)).toThrow(/exactly/);
      expect(fs.existsSync(path.join(dir, 'vault.dat'))).toBe(true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('erases the listed files and their .bak, and nothing else, and says what it did', () => {
    const dir = profile({ 'vault.dat': 'x', 'vault.dat.bak': 'x', 'totp.dat': 'x', 'notes.json': 'keep', 'Preferences': 'keep', 'github-token.enc': 'x' });
    try {
      const r = ss.wipe({ userDataPath: dir, confirm: ss.CONFIRM_PHRASE });
      expect(r.removed).toEqual(expect.arrayContaining(['Saved passwords', 'Authenticator accounts', 'GitHub read-only token']));
      expect(r.absent).toContain('Passkeys');
      expect(fs.readdirSync(dir).sort()).toEqual(['Preferences', 'notes.json']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('a file that cannot be removed throws and names what was already gone', () => {
    const fsMod = { ...fs, unlinkSync: (f) => { if (/totp/.test(f)) { const e = new Error('busy'); e.code = 'EBUSY'; throw e; } const e = new Error('no'); e.code = 'ENOENT'; throw e; } };
    expect(() => ss.wipe({ userDataPath: 'C:\\nowhere', confirm: ss.CONFIRM_PHRASE, fsMod })).toThrow(/Authenticator accounts.*busy/);
  });
});

describe('the handlers', () => {
  function setup(extra = {}) {
    const handlers = new Map();
    const win = { isDestroyed: () => false, webContents: { mainFrame: { id: 1 } } };
    const calls = [];
    const dir = profile({ 'vault.dat': 'x' });
    ss.registerAppLock({
      ipcMain: { handle: (c, f) => handlers.set(c, f) },
      app: { relaunch: () => calls.push('relaunch'), exit: () => calls.push('exit') },
      userDataPath: dir, mainWindowOf: () => win,
      makeRecord: async (s) => ({ kdf: 'scrypt', hash: s.length }),
      dropLockRecord: async () => { calls.push('drop:' + fs.existsSync(path.join(dir, 'vault.dat'))); },
      clearSessions: async () => { calls.push('signout:' + fs.existsSync(path.join(dir, 'vault.dat'))); return []; },
      ...extra,
    });
    const main = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
    return { handlers, calls, dir, main };
  }
  it('registers exactly the three channels', () => {
    const { handlers, dir } = setup();
    try { expect([...handlers.keys()].sort()).toEqual(['applock:make-record', 'applock:reset', 'applock:stores']); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('only the main window may call them', async () => {
    const { handlers, dir } = setup();
    try {
      const stranger = { sender: {}, senderFrame: {} };
      for (const c of ['applock:make-record', 'applock:stores', 'applock:reset']) await expect(handlers.get(c)(stranger, 'ERASE SECURE DATA')).rejects.toThrow(/main Vex window/);
      expect(fs.existsSync(path.join(dir, 'vault.dat'))).toBe(true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('make-record returns the record as text; stores reports', async () => {
    const { handlers, dir, main } = setup();
    try {
      expect(JSON.parse(await handlers.get('applock:make-record')(main, 'abcdefgh'))).toEqual({ kdf: 'scrypt', hash: 8 });
      const r = await handlers.get('applock:stores')(main);
      expect(r.phrase).toBe(ss.CONFIRM_PHRASE);
      expect(r.stores.find(s => s.id === 'vault').exists).toBe(true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('reset: a wrong phrase changes nothing; the right one erases first, then drops the lock, then restarts', async () => {
    const { handlers, calls, dir, main } = setup();
    try {
      await expect(handlers.get('applock:reset')(main, 'please')).rejects.toThrow(/exactly/);
      expect(calls).toEqual([]);
      expect(fs.existsSync(path.join(dir, 'vault.dat'))).toBe(true);
      const r = await handlers.get('applock:reset')(main, ss.CONFIRM_PHRASE);
      expect(r.ok).toBe(true);
      expect(r.removed).toContain('Saved passwords');
      // The secret file was already gone when the lock record was dropped.
      expect(calls).toEqual(['signout:false', 'drop:false', 'relaunch', 'exit']);
      expect(r.signedOut).toBe(true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('reset: if the lock record cannot be dropped, Vex is not restarted and the error is raised', async () => {
    const { handlers, calls, dir, main } = setup({ dropLockRecord: async () => { throw new Error('prefs locked'); } });
    try {
      await expect(handlers.get('applock:reset')(main, ss.CONFIRM_PHRASE)).rejects.toThrow(/prefs locked/);
      expect(calls).toEqual(['signout:false']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

describe('reset also signs the person out of every site', () => {
  it('refuses to register without a way to clear the sessions', () => {
    const dir = profile({});
    try {
      expect(() => ss.registerAppLock({ ipcMain: { handle() {} }, app: {}, userDataPath: dir, mainWindowOf: () => null, makeRecord: async () => ({}), dropLockRecord: async () => {} })).toThrow(/clearSessions is required/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('a wrong phrase clears no session', async () => {
    const { handlers, calls, dir, main } = setup();
    try {
      await expect(handlers.get('applock:reset')(main, 'nope')).rejects.toThrow(/exactly/);
      expect(calls).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('a session that cannot be cleared is raised and logged, and the lock is kept and Vex not restarted', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { handlers, calls, dir, main } = setup({ clearSessions: async () => ['disk busy'] });
    try {
      await expect(handlers.get('applock:reset')(main, ss.CONFIRM_PHRASE)).rejects.toThrow(/could not be signed out \(disk busy\)/);
      expect(calls).toEqual([]);
      expect(err).toHaveBeenCalledWith(expect.stringContaining('could not clear a session'), 'disk busy');
    } finally { err.mockRestore(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('main.js clears every session the way browsing:clear-data does, and collects failures', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
    const block = src.slice(src.indexOf("registerAppLock({"), src.indexOf("dropLockRecord: async"));
    expect(block).toMatch(/clearSessions: async \(\) =>/);
    expect(block).toMatch(/new Set\(\[session\.defaultSession, \.\.\.secureSessions\.sessions\]\)/);
    expect(block).toMatch(/await ses\.clearStorageData\(\); await ses\.clearCache\(\)/);
    expect(block).toMatch(/failures\.push/);
    expect(block).not.toMatch(/dataStore|preferences\.clear|remove\('history'\)/);
  });
  it('the Settings text says it signs you out of every site', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/secure-lock.js'), 'utf8');
    expect(src.match(/sign you out of every site|signs you out of every site/g).length).toBeGreaterThanOrEqual(3);
  });
});
});
