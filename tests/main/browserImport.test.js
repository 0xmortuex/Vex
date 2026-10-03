// @vitest-environment node
//
// Import from another browser (src/main/browser-import.js). Fixture profiles
// are built in a temp folder — a Chrome "User Data" tree with a Bookmarks file
// and a History database, and a Firefox profiles.ini with a places.sqlite —
// and pointed at through a fake LOCALAPPDATA / APPDATA. Nothing here reads the
// real browsers on the machine running the tests.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
const fs = require('fs'), os = require('os'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const bi = require('../../src/main/browser-import.js');
const { createVaultService } = require('../../src/main/vault.js');
const { validate } = require('../../src/main/ipc-schemas.js');

const FIX = path.join(__dirname, 'fixtures', 'browser-import');
const webkit = (ms) => String((ms + 11644473600000) * 1000);
const T1 = Date.UTC(2026, 8, 1, 12), T2 = Date.UTC(2026, 8, 2, 12), T3 = Date.UTC(2026, 8, 3, 12);

let root, env, chromeDefault, ffProfile;

function makeChromeHistory(file) {
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, typed_count INTEGER, last_visit_time INTEGER, hidden INTEGER)');
  const add = db.prepare('INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?, ?, ?, 0, ?, ?)');
  add.run('https://old.example/', 'Old', 2, webkit(T1), 0);
  add.run('https://new.example/', 'New', 5, webkit(T3), 0);
  add.run('https://mid.example/', '', 1, webkit(T2), 0);
  add.run('https://hidden.example/', 'Hidden', 1, webkit(T3), 1);
  add.run('chrome://settings/', 'Settings', 1, webkit(T2), 0);
  db.close();
}

function makePlaces(file) {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, hidden INTEGER DEFAULT 0, last_visit_date INTEGER);
    CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, position INTEGER, title TEXT, dateAdded INTEGER, guid TEXT);`);
  const place = db.prepare('INSERT INTO moz_places (id, url, title, visit_count, hidden, last_visit_date) VALUES (?, ?, ?, ?, ?, ?)');
  place.run(1, 'https://mozilla.example/', 'Mozilla', 3, 0, T2 * 1000);
  place.run(2, 'https://folder.example/page', 'In a folder', 1, 0, T3 * 1000);
  place.run(3, 'https://tagged.example/', 'Tagged only', 1, 0, null);
  place.run(4, 'place:sort=8&maxResults=10', 'Most visited', 0, 0, null);
  place.run(5, 'https://unfiled.example/', 'Unfiled', 1, 0, T1 * 1000);
  const bm = db.prepare('INSERT INTO moz_bookmarks (id, type, fk, parent, position, title, dateAdded, guid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  bm.run(1, 2, null, 0, 0, '', 0, 'root________');
  bm.run(2, 2, null, 1, 0, 'menu', 0, 'menu________');
  bm.run(3, 2, null, 1, 1, 'toolbar', 0, 'toolbar_____');
  bm.run(4, 2, null, 1, 2, 'tags', 0, 'tags________');
  bm.run(5, 2, null, 1, 3, 'unfiled', 0, 'unfiled_____');
  bm.run(10, 1, 1, 3, 0, 'Mozilla', T1 * 1000, 'b1');
  bm.run(11, 2, null, 3, 1, 'Reading', T1 * 1000, 'f1');
  bm.run(12, 1, 2, 11, 0, 'In a folder', T1 * 1000, 'b2');
  bm.run(13, 1, 4, 2, 0, 'Most visited', T1 * 1000, 'b3');
  bm.run(14, 2, null, 4, 0, 'mytag', 0, 't1');
  bm.run(15, 1, 3, 14, 0, null, T1 * 1000, 'b4');
  bm.run(16, 1, 5, 5, 0, 'Unfiled', T1 * 1000, 'b5');
  db.close();
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-browser-import-'));
  env = { LOCALAPPDATA: path.join(root, 'Local'), APPDATA: path.join(root, 'Roaming') };
  const ud = path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data');
  chromeDefault = path.join(ud, 'Default');
  fs.mkdirSync(chromeDefault, { recursive: true });
  fs.mkdirSync(path.join(ud, 'Profile 2'));
  fs.mkdirSync(path.join(ud, 'Crashpad'));          // not a profile
  fs.mkdirSync(path.join(ud, 'Profile 3'));          // a profile with nothing in it
  fs.writeFileSync(path.join(ud, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Person 1' }, 'Profile 2': { name: 'Work' } } } }));
  fs.copyFileSync(path.join(FIX, 'Bookmarks.json'), path.join(chromeDefault, 'Bookmarks'));
  makeChromeHistory(path.join(chromeDefault, 'History'));
  fs.copyFileSync(path.join(FIX, 'Bookmarks.json'), path.join(ud, 'Profile 2', 'Bookmarks'));

  const ff = path.join(env.APPDATA, 'Mozilla', 'Firefox');
  ffProfile = path.join(ff, 'Profiles', 'abcd1234.default-release');
  fs.mkdirSync(ffProfile, { recursive: true });
  fs.mkdirSync(path.join(ff, 'Profiles', 'zzzz0000.default'));
  fs.copyFileSync(path.join(FIX, 'profiles.ini'), path.join(ff, 'profiles.ini'));
  makePlaces(path.join(ffProfile, 'places.sqlite'));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('finding the browsers on this PC', () => {
  it('lists each browser that has a profile with something in it, by name', () => {
    const sources = bi.listSources(env);
    expect(sources.map(s => s.id)).toEqual(['chrome', 'firefox']);
    expect(sources[0].profiles).toEqual([{ id: 'Default', name: 'Person 1' }, { id: 'Profile 2', name: 'Work' }]);
    expect(sources[1].profiles).toEqual([{ id: 'Profiles/abcd1234.default-release', name: 'default-release' }]);
  });

  it('hands the window ids and names, never a folder path', () => {
    const text = JSON.stringify(bi.listSources(env));
    expect(text).not.toContain(root.replace(/\\/g, '\\\\'));
    expect(text).not.toContain('User Data');
  });

  it('reads only profiles it listed — not a path someone made up', () => {
    expect(() => bi.readProfile('chrome', '..', { env })).toThrow(/no longer on this PC/);
    expect(() => bi.readProfile('chrome', 'Crashpad', { env })).toThrow(/no longer on this PC/);
    expect(() => bi.readProfile('firefox', path.join(root, 'Local'), { env })).toThrow(/no longer on this PC/);
    expect(() => bi.readProfile('opera', 'Default', { env })).toThrow(/Unknown browser/);
  });

  it('parses profiles.ini sections, ignoring the install and general ones', () => {
    const s = bi.parseProfilesIni(fs.readFileSync(path.join(FIX, 'profiles.ini'), 'utf8'));
    expect(s.map(p => p.Name)).toEqual(['default', 'default-release', 'empty']);
  });
});

describe('a Chromium profile', () => {
  it('brings bookmarks over with their folder trail, web addresses only', () => {
    const r = bi.readProfile('chrome', 'Default', { env });
    expect(r.browserName).toBe('Chrome');
    expect(r.profile).toEqual({ id: 'Default', name: 'Person 1' });
    expect(r.bookmarks.map(b => [b.url, b.path.join(' / ')])).toEqual([
      ['https://news.example/', 'Bookmarks bar'],
      ['https://docs.example/start', 'Bookmarks bar / Work'],
      ['https://deep.example/a', 'Bookmarks bar / Work / Reference'],
      ['https://dupe.example/', 'Other bookmarks'],
    ]);
    expect(r.bookmarks[0].addedAt).toBe(new Date(13370000000000 - 11644473600000).toISOString());
  });

  it('brings history newest first, without hidden rows or browser pages', () => {
    const r = bi.readProfile('chrome', 'Default', { env });
    expect(r.history.items.map(h => h.url)).toEqual(['https://new.example/', 'https://mid.example/', 'https://old.example/']);
    expect(r.history.items[0]).toMatchObject({ title: 'New', visits: 5, visitedAt: new Date(T3).toISOString() });
    expect(r.history.items[1].title).toBe('https://mid.example/');   // no title: the address stands in
    expect(r.history.total).toBe(4);   // chrome://settings is counted by the browser, not brought over
  });

  it('stops at the limit and says how many there were', () => {
    const r = bi.readProfile('chrome', 'Default', { env, limit: 1 });
    expect(r.history.items.map(h => h.url)).toEqual(['https://new.example/']);
    expect(r.history.total).toBe(4);
  });

  it('a profile with bookmarks and no History file still imports its bookmarks', () => {
    const r = bi.readProfile('chrome', 'Profile 2', { env });
    expect(r.bookmarks).toHaveLength(4);
    expect(r.history).toEqual({ total: 0, items: [] });
  });

  it('reads a copy: the browser\'s own file is untouched and the copy is removed', () => {
    const file = path.join(chromeDefault, 'History');
    const before = fs.readFileSync(file);
    const tmpBefore = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('vex-import-'));
    bi.readProfile('chrome', 'Default', { env });
    expect(fs.readFileSync(file).equals(before)).toBe(true);
    expect(fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('vex-import-'))).toEqual(tmpBefore);
  });

  it('a copy that is refused says to close the browser', () => {
    const spy = vi.spyOn(fs, 'copyFileSync').mockImplementation(() => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); });
    try { expect(() => bi.readProfile('chrome', 'Default', { env })).toThrow(/close Chrome and try again/); }
    finally { spy.mockRestore(); }
  });
});

describe('a Firefox profile', () => {
  it('brings bookmarks with folders, leaving tags and smart queries behind', () => {
    const r = bi.readProfile('firefox', 'Profiles/abcd1234.default-release', { env });
    expect(r.browserName).toBe('Firefox');
    expect(r.bookmarks.map(b => [b.url, b.path.join(' / ')])).toEqual([
      ['https://mozilla.example/', 'Bookmarks toolbar'],
      ['https://folder.example/page', 'Bookmarks toolbar / Reading'],
      ['https://unfiled.example/', 'Other bookmarks'],
    ]);
    expect(r.bookmarks[0].addedAt).toBe(new Date(T1).toISOString());
  });

  it('brings visited pages newest first', () => {
    const r = bi.readProfile('firefox', 'Profiles/abcd1234.default-release', { env });
    expect(r.history.items.map(h => h.url)).toEqual(['https://folder.example/page', 'https://mozilla.example/', 'https://unfiled.example/']);
    expect(r.history.items[0].visitedAt).toBe(new Date(T3).toISOString());
    expect(r.history.total).toBe(3);
  });
});

describe('passwords from an exported CSV', () => {
  it('reads the Chrome / Edge / Brave export', () => {
    const csv = 'name,url,username,password,note\r\n'
      + 'example.com,https://www.Example.com/login,me@x.test,pa55,\r\n'
      + 'app,android://abc@com.app/,me,pw,\r\n'
      + 'nouser,https://nouser.test/,,secret,\r\n';
    const r = bi.credentialsFromCsv(csv);
    expect(r.entries).toEqual([{ host: 'example.com', username: 'me@x.test', password: 'pa55' }]);
    expect(r).toMatchObject({ rows: 3, noUsername: 1, notWeb: 1 });
  });

  it('reads the Firefox export, quotes, commas and line breaks included', () => {
    const csv = '\uFEFF"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"\n'
      + '"https://site.test","a, b","he said ""hi""\nthen left",,"https://site.test","{1}","1","1","1"\n'
      + '"chrome://FirefoxAccounts","u","p","Firefox Accounts credentials",,"{2}","1","1","1"\n';
    const r = bi.credentialsFromCsv(csv);
    expect(r.entries).toEqual([{ host: 'site.test', username: 'a, b', password: 'he said "hi"\nthen left' }]);
    expect(r.notWeb).toBe(1);
  });

  it('refuses a file that is not a password export', () => {
    expect(() => bi.credentialsFromCsv('a,b,c\n1,2,3\n')).toThrow(/not a password export/);
    expect(() => bi.credentialsFromCsv('')).toThrow(/empty/);
  });

  it('the file is chosen and read in main, and only hosts and usernames come back', async () => {
    const file = path.join(root, 'Chrome Passwords.csv');
    fs.writeFileSync(file, 'name,url,username,password,note\nx,https://a.test/,me,s3cret,\nx,https://b.test/,me,0ther,\n');
    const dialog = { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [file] })) };
    const addToVault = vi.fn(async (entries) => ({ added: entries.slice(1).map(({ host, username }) => ({ host, username })), duplicates: 1 }));
    const r = await bi.importPasswordCsv({ dialog, win: null, addToVault });
    expect(addToVault).toHaveBeenCalledWith([{ host: 'a.test', username: 'me', password: 's3cret' }, { host: 'b.test', username: 'me', password: '0ther' }]);
    expect(r).toEqual({ file: 'Chrome Passwords.csv', rows: 2, added: [{ host: 'b.test', username: 'me' }], duplicates: 1, noUsername: 0, notWeb: 0 });
    expect(JSON.stringify(r)).not.toMatch(/s3cret|0ther/);
  });

  it('cancelling the file picker changes nothing', async () => {
    const addToVault = vi.fn();
    const r = await bi.importPasswordCsv({ dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }, win: null, addToVault });
    expect(r).toEqual({ canceled: true });
    expect(addToVault).not.toHaveBeenCalled();
  });
});

describe('adding imported logins to the vault', () => {
  it('adds only what is new and never overwrites a saved password', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-vault-'));
    const handlers = {};
    const safeStorage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('enc:' + s), decryptString: (b) => b.toString().slice(4) };
    const svc = createVaultService({ app: { getPath: () => dir }, safeStorage, ipcMain: { handle: (c, fn) => { handlers[c] = fn; } } });
    await handlers['vault:save']({}, { host: 'a.test', username: 'me', password: 'mine' });
    const r = await svc.addMissing([
      { host: 'a.test', username: 'me', password: 'theirs' },
      { host: 'b.test', username: 'me', password: 'new' },
      { host: 'b.test', username: 'me', password: 'twice in the file' },
    ]);
    expect(r).toEqual({ added: [{ host: 'b.test', username: 'me' }], duplicates: 2 });
    expect(handlers['vault:get']({}, 'a.test')[0].password).toBe('mine');
    expect(handlers['vault:get']({}, 'b.test')[0].password).toBe('new');
    await svc.flushVault();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('the IPC contract', () => {
  it('takes a known browser and a profile id, nothing else', () => {
    expect(() => validate('browser-import:read', ['chrome', 'Default'])).not.toThrow();
    expect(() => validate('browser-import:read', ['opera', 'Default'])).toThrow();
    expect(() => validate('browser-import:read', ['chrome', { path: 'C:\\' }])).toThrow();
    expect(() => validate('browser-import:passwords-csv', ['C:\\file.csv'])).toThrow();
    expect(() => validate('browser-import:sources', [])).not.toThrow();
  });

  it('is refused in a private window', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/main/ipc-policy.js'), 'utf8');
    const re = new RegExp(/const PRIVATE_DISABLED = \/(.+)\/;/.exec(src)[1]);
    for (const c of ['browser-import:sources', 'browser-import:read', 'browser-import:passwords-csv']) expect(re.test(c)).toBe(true);
  });
});
