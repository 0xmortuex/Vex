// @vitest-environment jsdom
//
// Share a space (js/share-space.js): a workspace's tabs go out as a .vexspace file or a vex://space link and come back in through strict checks.
// The checks, the cleaning of addresses, the file format, the link packing, Apply and Undo are the real code; the tab manager, the workspace
// manager, the sidebar folders and Share my look are small stand-ins (they need a whole window).
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';

const read = (f) => fs.readFileSync(path.resolve(__dirname, '../../src/renderer', f), 'utf8');
const run = (src, ret) => new Function(src + '\n;return ' + ret + ';')();

let S, TM, WM, SG, SL;

const SIDEBAR = ['knowledge', 'browsing', 'security', 'tools', 'chat', 'media', 'aicode', 'apps'];
function stubs() {
  TM = {
    groups: [{ id: 'g1', name: 'History project', color: '#22c55e', collapsed: false }, { id: 'g2', name: 'Games', color: 'var(--primary)', collapsed: false }],
    tabs: [],
  };
  window.TabManager = TM;
  window.VexTabPolicy = { isPrivateWindow: false };
  WM = {
    COLORS: ['#6366f1', '#00b4d8'], activeId: 'ws_personal',
    workspaces: [{ id: 'ws_personal', name: 'Personal', color: '#d4a574', tabs: [{ id: 'tab-mine', url: 'https://mine.example.com/', title: 'Mine' }], groups: [], shortcuts: [], tools: [] }],
    getActive() { return this.workspaces.find((w) => w.id === this.activeId); },
    addWorkspace(name, color) { const ws = { id: 'ws_' + (this.workspaces.length + 1), name, color, tabs: [], shortcuts: [], tools: [] }; this.workspaces.push(ws); return ws; },
    save() { this.saved = (this.saved || 0) + 1; }, render() {},
    async switchTo(id) { this.activeId = id; },
    async deleteWorkspace(id) { const i = this.workspaces.findIndex((w) => w.id === id); const item = this.workspaces.splice(i, 1)[0]; return { item, index: i }; },
  };
  window.WorkspaceManager = WM;
  let raw = null;
  SG = {
    GROUPS: SIDEBAR.map((id) => ({ id, icon: 'folder' })), ICONS: ['folder', 'gamepad', 'star'], COLORS: ['accent', 'success'], ESSENTIALS: ['start', 'settings'],
    rawDefs: () => raw, parseDefs: (r) => JSON.parse(r),
    replaceDefs(d) { raw = JSON.stringify(d); }, restoreDefs(r) { raw = r; },
    set(r) { raw = r; },
  };
  window.VexSidebarGroups = SG;
  SL = {
    undoable: false, applied: null,
    validate: (l) => { if (!l || l.format !== 'vex-look') throw new Error('That is not a Vex look'); return l; },
    capture: () => ({ format: 'vex-look', version: 1, colours: 'dark', design: 'x', icons: 'y', look: 'classic', guiColors: 'look', skin: {}, fonts: {} }),
    async apply(l) { this.applied = l; this.undoable = true; }, hasUndo() { return this.undoable; }, async undo() { this.undoable = false; this.applied = null; },
  };
  window.VexShareLook = SL;
}

beforeEach(() => {
  localStorage.clear();
  delete window.VexShareSpace;
  stubs();
  run(read('js/share-space.js'), '0');
  S = window.VexShareSpace;
});

const tab = (url, extra) => ({ id: 'tab-' + Math.random(), url, title: 'Title of ' + url, partition: null, groupId: null, pinned: false, ...extra });
const file = (over) => ({ format: 'vex-space', version: 1, name: 'Test', groups: [], tabs: [{ url: 'https://example.com/a', title: 'A' }], ...over });
const parseOk = async (data) => (await S.parse(JSON.stringify(data)));

describe('cleaning an address', () => {
  const clean = (u) => S.cleanUrl(u);
  const SECRETS = [
    ['https://x.com/p?token=abc123', 'token'],
    ['https://x.com/p?access_token=zzz&page=2', 'access_token'],
    ['https://x.com/p?sessionid=1234', 'sessionid'],
    ['https://x.com/p?SessionID=1234', 'SessionID'],
    ['https://x.com/p?sid=9', 'sid'],
    ['https://x.com/p?apikey=k', 'apikey'],
    ['https://x.com/p?api_key=k', 'api_key'],
    ['https://x.com/p?key=k', 'key'],
    ['https://x.com/p?auth=1', 'auth'],
    ['https://x.com/p?code=4/0AX4XfWh', 'code'],
    ['https://x.com/p?password=hunter2', 'password'],
    ['https://x.com/p?pwd=hunter2', 'pwd'],
    ['https://x.com/p?secret=s', 'secret'],
    ['https://x.com/p?jwt=a.b.c', 'jwt'],
    ['https://x.com/p?signature=AbC', 'signature'],
    ['https://x.com/p?sig=AbC', 'sig'],
    ['https://x.com/p?X-Amz-Signature=0123abcd', 'X-Amz-Signature'],
    ['https://x.com/p?X-Amz-Credential=AKIA%2F2024', 'X-Amz-Credential'],
    ['https://x.com/p?X-Amz-Security-Token=zzz', 'X-Amz-Security-Token'],
    ['https://x.com/p?X-Goog-Signature=abcd', 'X-Goog-Signature'],
    ['https://x.com/p?csrfToken=abc', 'csrfToken'],
    ['https://x.com/p?id_token=abc', 'id_token'],
    ['https://x.com/p?otp=123456', 'otp'],
    ['https://x.com/p?email=me@example.com', 'email'],
    ['https://x.com/p?ref=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig', 'ref'],                           // a JWT under an innocent name
    ['https://x.com/p?next=3f2b8a9c-1d4e-4f6a-9b7c-0e5d2a1c8b3f', 'next'],                             // a UUID
    ['https://x.com/p?thing=0123456789abcdef0123456789abcdef', 'thing'],                               // 32 hex characters
    ['https://x.com/p?v=Zm9vYmFyQmF6UXV4MTIzNDU2Nzg5MEFiQ2Q', 'v'],                                    // 30 random-looking characters
    ['https://x.com/p?utm_source=mail&utm_campaign=x', 'utm_source'],
    ['https://x.com/p?fbclid=IwAR0abc', 'fbclid'],
    ['https://x.com/p?gclid=Cj0KCQ', 'gclid'],
  ];
  it.each(SECRETS)('removes the secret in %s', (u, name) => {
    const r = clean(u);
    expect(r.ok).toBe(true);
    expect(r.url).not.toContain(name + '=');
    expect(r.url.toLowerCase()).not.toMatch(/token|jwt|hunter2|akia|sessionid=|password=|eyj/);
    expect(r.changes.join(' ')).toContain(name.slice(0, 30));
    // The VALUE of a removed parameter is never repeated in what the person is told.
    expect(r.changes.join(' ')).not.toMatch(/hunter2|AKIA|eyJ|0123456789abcdef/);
  });

  it('keeps ordinary parameters, in order, and a plain anchor', () => {
    const r = clean('https://example.com/search?q=history+of+rome&page=2&sort=new&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf#section-2');
    expect(r.url).toBe('https://example.com/search?q=history+of+rome&page=2&sort=new&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf#section-2');
    expect(r.changes).toEqual([]);
  });

  it('keeps a long readable slug (many separators) and a short video id', () => {
    expect(clean('https://blog.example.com/how-to-build-a-treehouse-in-your-garden-2024?v=dQw4w9WgXcQ').changes).toEqual([]);
  });

  it('removes a fragment that is not a plain anchor', () => {
    for (const hash of ['#access_token=abc&token_type=bearer', '#!/inbox/FMfcgzGxRZ', '#/route?x=1', '#state=abc123', '#eyJhbGciOiJIUzI1NiJ9abcdefghij1234567']) {
      const r = clean('https://example.com/app' + hash);
      expect(r.url, hash).toBe('https://example.com/app');
      expect(r.changes.length, hash).toBe(1);
    }
  });

  it('warns, without removing, when the path itself is a long code (a shared document)', () => {
    const r = clean('https://docs.example.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdef/edit');
    expect(r.ok).toBe(true);
    expect(r.url).toContain('1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdef');
    expect(r.warnings.join(' ')).toMatch(/long code/);
    expect(clean('https://chat.example.com/invite/AbCd123').warnings.length).toBe(1);
  });

  it.each([
    ['https://user:pass@example.com/', 'credentials'],
    ['https://user@example.com/', 'credentials'],
    ['http://localhost:3000/app', 'internal'],
    ['http://app.localhost/', 'internal'],
    ['http://127.0.0.1/', 'internal'],
    ['http://10.0.0.5/', 'internal'],
    ['http://192.168.1.1/', 'internal'],
    ['http://172.16.4.4/', 'internal'],
    ['http://169.254.169.254/latest/meta-data', 'internal'],
    ['http://100.64.0.1/', 'internal'],
    ['http://8.8.8.8/', 'internal'],
    ['http://[::1]/', 'internal'],
    ['http://[fd00::1]/', 'internal'],
    ['http://2130706433/', 'internal'],                       // 127.0.0.1 written as one number
    ['http://0x7f.0.0.1/', 'internal'],
    ['http://router/', 'internal'],
    ['http://nas.local/', 'internal'],
    ['http://printer.lan/', 'internal'],
    ['http://wiki.corp/', 'internal'],
    ['http://abcdef.onion/', 'internal'],
    ['http://localhost./', 'internal'],
    ['file:///C:/Users/me/secret.txt', 'file'],
    ['vex://start', 'vex-page'],
    ['vex://settings', 'vex-page'],
    ['about:blank', 'vex-page'],
    ['view-source:https://example.com/', 'vex-page'],
    ['javascript:alert(1)', 'bad-scheme'],
    ['data:text/html,<script>alert(1)</script>', 'bad-scheme'],
    ['blob:https://example.com/1234', 'bad-scheme'],
    ['ftp://example.com/file', 'bad-scheme'],
    ['https://example.com/reset-password/abc', 'auth-page'],
    ['https://example.com/account/verify?x=1', 'auth-page'],
    ['https://example.com/oauth2/callback?code=1', 'auth-page'],
    ['https://example.com/logout', 'auth-page'],
    ['https://example.com/' + 'a'.repeat(2100), 'too-long'],
    ['not an address', 'invalid'],
    ['', 'invalid'],
    [42, 'invalid'],
  ])('refuses %s', (u, code) => {
    const r = clean(u);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(code);
  });

  it('is stable: cleaning a cleaned address changes nothing', () => {
    for (const [u] of SECRETS) {
      const once = clean(u);
      const twice = clean(once.url);
      expect(twice.url).toBe(once.url);
      expect(twice.changes).toEqual([]);
    }
  });

  it('replaces a title that carries an e-mail address, and keeps an ordinary one', () => {
    expect(S.cleanTitle('Inbox (3) - me@example.com - Mail', 'mail.example.com')).toBe('mail.example.com');
    expect(S.cleanTitle('Roman history notes', 'x.com')).toBe('Roman history notes');
    expect(S.cleanTitle('<b>x</b>\u202e\u0000', 'x.com')).toBe('bx/b');
    expect(S.cleanTitle('word '.repeat(60), 'x.com').length).toBeLessThanOrEqual(100);
    expect(S.cleanTitle('word '.repeat(60), 'x.com').length).toBeGreaterThan(90);
    expect(S.cleanTitle('Reset link https://x.com/p?token=abc', 'x.com')).toBe('x.com');
    expect(S.cleanTitle('Session 0123456789abcdef0123456789abcdef open', 'x.com')).toBe('x.com');
    expect(S.cleanTitle('', 'x.com')).toBe('x.com');
  });
});

describe('what a window contributes, and what it never does', () => {
  function sixTabs() {
    TM.tabs = [
      tab('https://history.example.com/rome', { groupId: 'g1', title: 'Rome' }),
      tab('https://private.example.com/', { partition: 'private-abc123', title: 'A private tab' }),
      tab('https://tor.example.com/', { partition: 'tor-session', title: 'A Tor tab' }),
      tab('https://news.example.com/article?id=7&token=SECRET-TOKEN-VALUE-9f8e7d6c5b4a', { title: 'Article', groupId: 'g2', pinned: true }),
      tab('http://localhost:3000/admin', { title: 'My dev server' }),
      tab('https://work.example.com/', { partition: 'persist:container-work', title: 'Work container' }),
    ];
  }

  it('leaves out private, Tor, container, localhost; cleans the token; counts and explains', () => {
    sixTabs();
    const c = S.collect();
    expect(c.items.map((i) => i.host)).toEqual(['history.example.com', 'news.example.com']);
    expect(c.items[1].url).toBe('https://news.example.com/article?id=7');
    expect(c.items[1].changes.join(' ')).toContain('token');
    expect(c.excluded.total).toBe(4);
    const by = Object.fromEntries(c.excluded.reasons.map((r) => [r.code, r.count]));
    expect(by).toEqual({ 'private-tab': 2, internal: 1, container: 1 });
    expect(c.excluded.reasons.every((r) => typeof r.text === 'string' && r.text.length > 10)).toBe(true);
  });

  it('puts only the listed fields in the file, and not one secret', () => {
    sixTabs();
    TM.tabs[0].cookies = 'sid=COOKIE-VALUE'; TM.tabs[0].note = 'MY PRIVATE NOTE'; TM.tabs[0].formData = { pw: 'hunter2' };
    TM.tabs[0].favicon = 'https://history.example.com/favicon.ico'; TM.tabs[0].scrollPosition = 400; TM.tabs[0].history = { entries: ['https://secret.example.com/'] };
    const text = S.toFile(S.build(S.collect(), {}));
    const data = JSON.parse(text);
    expect(Object.keys(data).sort()).toEqual(['format', 'groups', 'name', 'tabs', 'version', 'color'].sort());
    for (const t of data.tabs) expect(Object.keys(t).every((k) => ['url', 'title', 'group', 'pinned'].includes(k))).toBe(true);
    for (const forbidden of ['SECRET-TOKEN-VALUE', 'COOKIE-VALUE', 'MY PRIVATE NOTE', 'hunter2', 'localhost', 'private.example.com', 'tor.example.com', 'work.example.com', 'secret.example.com', 'favicon', 'cookie', 'persist:', 'partition']) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    expect(data.tabs[1]).toEqual({ url: 'https://news.example.com/article?id=7', title: 'Article', group: 1, pinned: true });
    expect(data.groups).toEqual([{ name: 'History project', color: '#22c55e' }, { name: 'Games' }]);   // a colour that is a theme reference is not shared
  });

  it('shares one group only', () => {
    sixTabs();
    const c = S.collect({ groupId: 'g1' });
    expect(c.items.length).toBe(1);
    expect(c.name).toBe('History project');
  });

  it('a tab with a long code in its address starts unticked, and the person can untick any', () => {
    TM.tabs = [tab('https://docs.example.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdef/edit'), tab('https://a.example.com/')];
    const c = S.collect();
    expect(c.items.map((i) => i.include)).toEqual([false, true]);
    expect(S.build(c, {}).tabs.length).toBe(1);
    expect(S.build(c, { include: ['0', '1'] }).tabs.length).toBe(2);
    expect(S.build(c, { include: ['1'] }).tabs[0].url).toBe('https://a.example.com/');
  });

  it('refuses in a private window and when Vex is locked, and when the feature is off', () => {
    TM.tabs = [tab('https://a.example.com/')];
    window.VexTabPolicy = { isPrivateWindow: true };
    expect(() => S.collect()).toThrow(/private window/);
    window.VexTabPolicy = { isPrivateWindow: false };
    window.VexLock = { locked: () => true };
    try { expect(() => S.collect()).toThrow(/locked/); } finally { delete window.VexLock; }
    S.setEnabled(false);
    expect(S.enabled()).toBe(false);
    expect(() => S.requireOn()).toThrow(/switched off/);
    S.setEnabled(true);
    expect(S.enabled()).toBe(true);
  });

  it('refuses more than 60 ticked tabs on the way out', () => {
    TM.tabs = Array.from({ length: 70 }, (_, i) => tab('https://s' + i + '.example.com/'));
    const c = S.collect();
    expect(() => S.build(c, {})).toThrow(/60 tabs at most/);
    expect(S.build(c, { include: c.items.slice(0, 60).map((i) => i.key) }).tabs.length).toBe(60);
  });

  it('the look and the sidebar go in only when asked for', () => {
    TM.tabs = [tab('https://a.example.com/')];
    SG.set(JSON.stringify({ v: 1, groups: [{ id: 'chat', name: 'Friends', panels: ['discord'] }, { id: 'g_abc123', name: 'Mine', icon: 'star', color: 'accent', panels: ['notes', 'history'] }], order: ['g_abc123', 'chat'] }));
    const c = S.collect();
    expect(c.hasSidebar).toBe(true);
    expect(S.build(c, {}).look).toBeUndefined();
    expect(S.build(c, {}).sidebar).toBeUndefined();
    const full = S.build(c, { look: true, sidebar: true });
    expect(full.look.format).toBe('vex-look');
    expect(full.sidebar.groups).toEqual([{ name: 'Mine', icon: 'star', color: 'accent', panels: ['notes', 'history'] }, { id: 'chat', name: 'Friends', panels: ['discord'] }]);
  });
});

describe('a file coming in is hostile', () => {
  it('accepts a clean file and rebuilds it', async () => {
    const r = await parseOk(file({ groups: [{ name: 'G', color: '#AABBCC' }], tabs: [{ url: 'https://example.com/a', title: 'A', group: 0, pinned: true }] }));
    expect(r.space).toEqual({ format: 'vex-space', version: 1, name: 'Test', groups: [{ name: 'G', color: '#aabbcc' }], tabs: [{ url: 'https://example.com/a', title: 'A', group: 0, pinned: true }] });
    expect(r.refused).toEqual([]);
  });

  it.each([
    ['not json', 'nope', /not JSON/],
    ['an array', '[1,2]', /not a Vex space/],
    ['a number', '42', /not a Vex space/],
    ['another format', JSON.stringify({ format: 'vex-look', version: 1, tabs: [] }), /not a Vex space/],
    ['no version', JSON.stringify({ format: 'vex-space', tabs: [] }), /no version/],
    ['version 0', JSON.stringify({ format: 'vex-space', version: 0, tabs: [] }), /no version/],
    ['a fractional version', JSON.stringify({ format: 'vex-space', version: 1.5, tabs: [] }), /no version/],
    ['a newer version', JSON.stringify({ format: 'vex-space', version: 2, tabs: [] }), /newer Vex: update Vex/],
    ['no tabs list', JSON.stringify({ format: 'vex-space', version: 1 }), /no list of tabs/],
    ['tabs that are not a list', JSON.stringify({ format: 'vex-space', version: 1, tabs: {} }), /no list of tabs/],
    ['an unknown top-level field', JSON.stringify(file({ cookies: [{ name: 'sid' }] })), /something a space does not \(field: "cookies"\)/],
    ['an unknown tab field', JSON.stringify(file({ tabs: [{ url: 'https://example.com/', cookies: 'x' }] })), /tab field: "cookies"/],
    ['an unknown group field', JSON.stringify(file({ groups: [{ name: 'G', icon: 'x' }] })), /group field: "icon"/],
    ['a tab that is not an object', JSON.stringify(file({ tabs: ['https://example.com/'] })), /Tab 1 .* is not a tab/],
    ['a group index that is not there', JSON.stringify(file({ groups: [], tabs: [{ url: 'https://example.com/', group: 0 }] })), /group that is not in it/],
    ['a pinned flag that is not true', JSON.stringify(file({ tabs: [{ url: 'https://example.com/', pinned: 'yes' }] })), /pinned flag/],
    ['a bad space colour', JSON.stringify(file({ color: 'red' })), /plain hex colour/],
    ['a css colour in a group', JSON.stringify(file({ groups: [{ name: 'G', color: 'url(http://x)' }] })), /plain hex colour/],
    ['a group without a name', JSON.stringify(file({ groups: [{ name: '' }] })), /no name/],
    ['more than 12 groups', JSON.stringify(file({ groups: Array.from({ length: 13 }, (_, i) => ({ name: 'G' + i })) })), /more than 12/],
    ['a name that is not text', JSON.stringify(file({ name: { a: 1 } })), /must be text/],
    ['a look that is not a look', JSON.stringify(file({ look: { format: 'nope' } })), /not a Vex look/],
    ['a sidebar with an unknown folder id', JSON.stringify(file({ sidebar: { groups: [{ id: 'evil', panels: [] }] } })), /built-in folder this Vex does not have/],
    ['a sidebar panel that is not a panel', JSON.stringify(file({ sidebar: { groups: [{ name: 'X', panels: ['../etc'] }] } })), /not a panel/],
    ['Start inside a sidebar folder', JSON.stringify(file({ sidebar: { groups: [{ name: 'X', panels: ['settings'] }] } })), /not a panel/],
    ['a panel in two folders', JSON.stringify(file({ sidebar: { groups: [{ name: 'X', panels: ['notes'] }, { name: 'Y', panels: ['notes'] }] } })), /two sidebar folders/],
    ['a sidebar folder field that is unknown', JSON.stringify(file({ sidebar: { groups: [{ name: 'X', panels: [], script: '1' }] } })), /sidebar folder field/],
  ])('raises on %s', async (_what, text, re) => {
    await expect(S.parse(text)).rejects.toThrow(re);
  });

  it('refuses a file over the size cap before reading it', async () => {
    const big = JSON.stringify(file({ name: 'x'.repeat(S.FILE_MAX) }));
    await expect(S.parse(big)).rejects.toThrow(/too big/);
  });

  it('refuses every address that is not an ordinary web page, and says which tab', async () => {
    const bad = ['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'file:///C:/Windows/win.ini', 'vex://settings', 'vex://start', 'blob:https://x.com/1', 'ftp://example.com/', 'http://localhost/', 'http://192.168.0.1/', 'https://user:pw@example.com/', 'about:blank', '//example.com', 'https://', ''];
    const r = await parseOk(file({ tabs: [...bad.map((url) => ({ url })), { url: 'https://example.com/ok' }] }));
    expect(r.space.tabs.map((t) => t.url)).toEqual(['https://example.com/ok']);
    expect(r.refused.map((x) => x.n)).toEqual(bad.map((_, i) => i + 1));
    expect(r.refused.every((x) => x.reason && x.code)).toBe(true);
  });

  it('cleans secrets out of a file\u2019s addresses on the way in too', async () => {
    const r = await parseOk(file({ tabs: [{ url: 'https://example.com/a?token=EVIL&q=1#access_token=EVIL2' }] }));
    expect(r.space.tabs[0].url).toBe('https://example.com/a?q=1');
    expect(r.cleaned.length).toBe(1);
    expect(r.cleaned[0].n).toBe(1);
  });

  it('keeps 60 tabs and says how many more were dropped', async () => {
    const tabs = Array.from({ length: 75 }, (_, i) => ({ url: 'https://s' + i + '.example.com/' }));
    const r = await parseOk(file({ tabs }));
    expect(r.space.tabs.length).toBe(60);
    expect(r.truncated).toBe(15);
    await expect(S.parse(JSON.stringify(file({ tabs: Array.from({ length: 700 }, () => ({ url: 'https://a.example.com/' })) })))).rejects.toThrow(/far too many/);
  });

  it('drops the same address twice, and renumbers the groups that remain', async () => {
    const r = await parseOk(file({ groups: [{ name: 'Unused' }, { name: 'Used' }], tabs: [{ url: 'https://a.example.com/', group: 1 }, { url: 'https://a.example.com/', group: 1 }] }));
    expect(r.space.tabs).toEqual([{ url: 'https://a.example.com/', group: 0 }]);
    expect(r.space.groups).toEqual([{ name: 'Used' }]);
    expect(r.refused[0].code).toBe('duplicate');
  });

  it('shows a punycode host as the network sees it', async () => {
    const r = await parseOk(file({ tabs: [{ url: 'https://xn--80ak6aa92e.com/login', title: 'apple.com sign in' }] }));
    expect(new URL(r.space.tabs[0].url).hostname).toBe('xn--80ak6aa92e.com');
  });

  it('never evaluates or inserts anything: a title with markup is plain text', async () => {
    const r = await parseOk(file({ tabs: [{ url: 'https://example.com/', title: '<img src=x onerror=alert(1)>Hello' }] }));
    expect(r.space.tabs[0].title).toBe('img src=x onerror=alert(1)Hello');
  });
});

describe('the link', () => {
  const sample = () => file({ groups: [{ name: 'Study', color: '#22c55e' }], tabs: Array.from({ length: 8 }, (_, i) => ({ url: 'https://school.example.com/unit-' + i + '?page=' + i, title: 'Unit ' + i, group: 0 })) });

  it('round-trips through deflate and base64url, and the file round-trips too', async () => {
    const space = (await parseOk(sample())).space;
    const link = await S.toLink(space);
    expect(link.startsWith('vex://space?d=')).toBe(true);
    expect(link.slice(14)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect((await S.parse(link)).space).toEqual(space);
    expect((await S.parse(S.toFile(space))).space).toEqual(space);
    const asText = await S.toText(space);
    expect(asText).toContain('Test: 8 tabs in 1 groups');
    expect((await S.parse(asText.split('\n').pop())).space).toEqual(space);
  });

  it('is smaller than the plain JSON', async () => {
    const space = (await parseOk(sample())).space;
    expect((await S.toLink(space)).length).toBeLessThan(JSON.stringify(space).length);
  });

  it('says so, and points at the file, when a space is too big for a link', async () => {
    const tabs = Array.from({ length: 60 }, (_, i) => ({ url: 'https://host' + i + '.example.com/' + Array.from({ length: 14 }, () => 'p' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8)).join('/'), title: Math.random().toString(36).slice(2) + ' ' + Math.random().toString(36).slice(2) }));
    const space = (await parseOk(file({ tabs }))).space;
    await expect(S.toLink(space)).rejects.toThrow(/too big for a link.*Share the file instead/);
    expect(S.toFile(space).length).toBeGreaterThan(1000);        // the file still works
  });

  it('refuses damaged links with a clear message', async () => {
    await expect(S.parse('vex://space?d=%%%')).rejects.toThrow(/damaged/);
    await expect(S.parse('vex://space?d=AAAA')).rejects.toThrow(/damaged/);
    await expect(S.parse('vex://space?d=' + 'A'.repeat(S.LINK_PARSE_MAX + 1))).rejects.toThrow(/too big/);
    await expect(S.parse('vex://space?d=')).rejects.toThrow();
  });

  it('refuses a small link that unpacks into something enormous (a compression bomb)', async () => {
    const bomb = deflateRawSync(Buffer.alloc(8 * 1024 * 1024, 0x20));
    expect(bomb.length).toBeLessThan(S.LINK_PARSE_MAX);
    const link = 'vex://space?d=' + bomb.toString('base64url');
    await expect(S.parse(link)).rejects.toThrow(/too big to be a space/);
  });

  it('refuses a link that unpacks into something that is not a space', async () => {
    const link = 'vex://space?d=' + deflateRawSync(Buffer.from('{"format":"vex-space","version":3,"tabs":[]}')).toString('base64url');
    await expect(S.parse(link)).rejects.toThrow(/newer Vex/);
    const link2 = 'vex://space?d=' + deflateRawSync(Buffer.from([0xff, 0xfe, 0xfd])).toString('base64url');
    await expect(S.parse(link2)).rejects.toThrow(/not text/);
  });

  it('recognises a link only when it starts with exactly the prefix', () => {
    expect(S.isLink('vex://space?d=abc')).toBe(true);
    expect(S.isLink('  vex://space?d=abc  ')).toBe(true);
    expect(S.isLink('vex://look?d=abc')).toBe(false);
    expect(S.isLink('https://x.com/vex://space?d=abc')).toBe(false);
    expect(S.isLink(42)).toBe(false);
  });
});

describe('Apply and Undo', () => {
  const sp = async (over) => (await parseOk(file({
    name: 'History project', color: '#22c55e', groups: [{ name: 'Sources', color: '#ef4444' }],
    tabs: [{ url: 'https://a.example.com/', title: 'A', group: 0 }, { url: 'https://b.example.com/', title: 'B', pinned: true }, { url: 'https://c.example.com/' }], ...over,
  }))).space;
  const mine = () => JSON.stringify(WM.workspaces[0]);

  it('adds a NEW workspace of sleeping tabs and replaces nothing of the person\u2019s', async () => {
    const before = mine();
    const r = await S.apply(await sp());
    expect(r.count).toBe(3);
    expect(WM.workspaces.length).toBe(2);
    expect(mine()).toBe(before);
    const ws = WM.workspaces[1];
    expect(ws.id).toBe(r.workspaceId);
    expect(ws.name).toBe('History project');
    expect(ws.color).toBe('#22c55e');
    expect(ws.tabs.map((t) => [t.url, t.sleeping, t.pinned, t.partition])).toEqual([['https://a.example.com/', true, false, null], ['https://b.example.com/', true, true, null], ['https://c.example.com/', true, false, null]]);
    expect(ws.tabs[2].title).toBe('c.example.com');
    expect(ws.tabs.every((t) => /^tab-[0-9a-f-]{36}$/.test(t.id) && t.favicon === null && t.note === '')).toBe(true);
    expect(ws.groups.length).toBe(1);
    expect(ws.groups[0]).toMatchObject({ name: 'Sources', color: '#ef4444', collapsed: false });
    expect(ws.tabs[0].groupId).toBe(ws.groups[0].id);
    expect(ws.tabs[1].groupId).toBeNull();
    expect(WM.activeId).toBe('ws_personal');                 // nothing opened, nothing switched
    expect(S.hasUndo()).toBe(true);
  });

  it('adds only the ticked tabs, and without groups when asked', async () => {
    await S.apply(await sp(), { tabs: true, groups: false }, [1]);
    const ws = WM.workspaces[1];
    expect(ws.tabs.map((t) => t.url)).toEqual(['https://b.example.com/']);
    expect(ws.groups).toEqual([]);
    await expect(S.apply(await sp(), { tabs: true }, [])).rejects.toThrow(/No tab is ticked/);
    await expect(S.apply(await sp(), { tabs: false, sidebar: false, look: false })).rejects.toThrow(/Choose something/);
  });

  it('Undo removes the new workspace and leaves the person where they were', async () => {
    const before = mine();
    await S.apply(await sp());
    expect(await S.undo()).toBe('History project');
    expect(WM.workspaces.map((w) => w.id)).toEqual(['ws_personal']);
    expect(mine()).toBe(before);
    expect(S.hasUndo()).toBe(false);
    await expect(S.undo()).rejects.toThrow(/nothing to undo|no shared space/i);
  });

  it('Undo from inside the new workspace goes back to the previous one first', async () => {
    const r = await S.apply(await sp());
    await S.open(r.workspaceId);
    expect(WM.activeId).toBe(r.workspaceId);
    await S.undo();
    expect(WM.activeId).toBe('ws_personal');
    expect(WM.workspaces.length).toBe(1);
  });

  it('the look is worn only when asked, and Undo gives it back', async () => {
    const withLook = await sp({ look: SL.capture() });
    await S.apply(withLook);
    expect(SL.applied).toBeNull();
    await S.undo();
    await S.apply(withLook, { tabs: true, look: true });
    expect(SL.applied.format).toBe('vex-look');
    await S.undo();
    expect(SL.undoable).toBe(false);
  });

  it('the sidebar folders are replaced only when asked, and Undo puts the exact old text back', async () => {
    const old = JSON.stringify({ v: 1, groups: [{ id: 'chat', name: 'Old', panels: ['whatsapp'] }], order: ['chat'] });
    SG.set(old);
    const withSide = await sp({ sidebar: { groups: [{ id: 'chat', name: 'Friends', panels: ['discord'] }, { name: 'Mine', panels: ['notes'] }] } });
    await S.apply(withSide);
    expect(SG.rawDefs()).toBe(old);
    await S.undo();
    await S.apply(withSide, { tabs: true, sidebar: true });
    const defs = JSON.parse(SG.rawDefs());
    expect(defs.groups[0]).toMatchObject({ id: 'chat', builtin: true, name: 'Friends', panels: ['discord'] });
    expect(defs.groups[1].id).toMatch(/^g_[a-z0-9]+$/);
    expect(defs.order).toEqual(defs.groups.map((g) => g.id));
    await S.undo();
    expect(SG.rawDefs()).toBe(old);
    SG.set(null);
    await S.apply(withSide, { tabs: false, sidebar: true });
    await S.undo();
    expect(SG.rawDefs()).toBeNull();
  });

  it('rolls everything back when a step fails, and raises the failure', async () => {
    const withBoth = await sp({ look: SL.capture() });
    SL.apply = async () => { throw new Error('the look broke'); };
    await expect(S.apply(withBoth, { tabs: true, look: true })).rejects.toThrow(/the look broke/);
    expect(WM.workspaces.length).toBe(1);
    expect(S.hasUndo()).toBe(false);
  });

  it('is refused in a private window and when the feature is off', async () => {
    const space = await sp();
    window.VexTabPolicy = { isPrivateWindow: true };
    await expect(S.apply(space)).rejects.toThrow(/private window/);
    window.VexTabPolicy = { isPrivateWindow: false };
    S.setEnabled(false);
    await expect(S.apply(space)).rejects.toThrow(/switched off/);
    expect(WM.workspaces.length).toBe(1);
  });

  it('re-checks the space it is given: a hand-made object with a javascript: address is refused or dropped, never added', async () => {
    const r = await S.apply({ format: 'vex-space', version: 1, groups: [], tabs: [{ url: 'javascript:alert(1)' }, { url: 'https://ok.example.com/' }] });
    expect(WM.workspaces[1].tabs.map((t) => t.url)).toEqual(['https://ok.example.com/']);
    expect(r.count).toBe(1);
    await expect(S.apply({ format: 'vex-space', version: 1, groups: [], tabs: [{ url: 'x', cookie: 'y' }] })).rejects.toThrow(/tab field/);
  });
});
