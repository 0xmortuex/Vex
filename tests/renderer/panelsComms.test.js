// @vitest-environment jsdom
//
// Wave 1, panels and messages: notifications from panels (T1-020), VIP rules
// (T1-033), the panel state strip and unread ledger (T1-034), Needs me (T1-007),
// Away mode (T1-010), delivery windows (T1-006) and close-protect (T1-039).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const JS = path.join(ROOT, 'src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NAMES = ['AttentionState', 'VexAttention', 'AttentionInbox', 'VexConsent', 'VipRules', 'PanelCapture', 'PanelState', 'NeedsMe', 'AwayMode',
  'AttentionDigest', 'CloseProtect', 'PanelBadges', 'SidebarManager', 'TabManager', 'WebviewManager', 'Autopilot', 'VexLedger', 'VexJobs', 'FocusMode', 'GameMode'];
let now, S, A, I, C, V, P, N, W, D, X, toasts;

function load() {
  for (const n of NAMES) delete globalThis[n];
  globalThis.VexJobs = { every: vi.fn(() => ({ stop() {} })) };
  globalThis.VexConsent = fresh('vex-defaults.js').VexConsent;
  S = fresh('attention-state.js').AttentionState; globalThis.AttentionState = S;
  I = fresh('attention-inbox.js').AttentionInbox; globalThis.AttentionInbox = I;
  A = fresh('vex-attention.js').VexAttention; globalThis.VexAttention = A;
  V = fresh('vip-rules.js').VipRules; globalThis.VipRules = V;
  C = fresh('panel-capture.js').PanelCapture; globalThis.PanelCapture = C;
  P = fresh('panel-state.js').PanelState; globalThis.PanelState = P;
  N = fresh('needs-me.js').NeedsMe; globalThis.NeedsMe = N;
  W = fresh('away-mode.js').AwayMode; globalThis.AwayMode = W;
  D = fresh('attention-digest.js').AttentionDigest; globalThis.AttentionDigest = D;
  X = fresh('close-protect.js').CloseProtect; globalThis.CloseProtect = X;
  now = 1_700_000_000_000;
  for (const m of [S, I, A, C, P, N, W, D]) m._now = () => now;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<button id="btn-attention" hidden></button>';
  delete window.vex; delete window.VexTabPolicy;
  toasts = [];
  window.showToast = (m, kind, ms, opts) => { toasts.push({ m, kind, opts }); return null; };
  load();
});
afterEach(() => { vi.restoreAllMocks(); delete window.showToast; });

const readable = { getURL: () => 'https://discord.com/channels/@me' };
function allowReading() { window.VexTabPolicy = { isPrivateWindow: false, canReadWebview: () => true }; }
function turnOnCapture(sites = ['discord']) {
  C.grant();
  for (const s of sites) C.setSite(s, true);
  allowReading();
}
const note = (over = {}) => ({ title: 'Alice', body: 'are you coming tonight?', ...over });

describe('T1-020 notifications from panels', () => {
  it('keeps nothing until the person agreed, and nothing from a site they did not turn on', () => {
    allowReading();
    expect(C.fromHost('discord', note(), readable)).toBeNull();
    expect(() => C.setEnabled(true)).toThrow(/permission/);
    C.grant();
    expect(C.fromHost('discord', note(), readable)).toBeNull();      // consent given, site not opted in
    C.setSite('discord', true);
    expect(C.fromHost('discord', note(), readable)).toMatchObject({ source: 'discord', title: 'Alice' });
    expect(C.fromHost('whatsapp', note(), readable)).toBeNull();
    expect(VexConsent.granted('panel-capture')).toBe(true);
  });

  it('never keeps from a page Vex may not read (private, Tor, routed) or a bank-looking address', () => {
    turnOnCapture();
    window.VexTabPolicy = { isPrivateWindow: false, canReadWebview: () => false };
    expect(C.fromHost('discord', note(), readable)).toBeNull();
    allowReading();
    expect(C.fromHost('discord', note(), { getURL: () => 'https://online.bank.example.com/' })).toBeNull();
    window.VexTabPolicy = { isPrivateWindow: true, canReadWebview: () => true };
    expect(C.fromHost('discord', note(), readable)).toBeNull();
  });

  it('keeps only a short title and body, drops a repeat, bounds the list and the age', () => {
    turnOnCapture();
    const it1 = C.fromHost('discord', { title: 'T'.repeat(500), body: 'B'.repeat(900) }, readable);
    expect(it1.title.length).toBe(200);
    expect(it1.body.length).toBe(300);
    expect(C.fromHost('discord', { title: 'T'.repeat(500), body: 'B'.repeat(900) }, readable)).toBeNull();   // same thing within 5 s
    for (let i = 0; i < 230; i++) { now += 10000; C.fromHost('discord', note({ title: 'n' + i }), readable); }
    expect(C.list({ includeMuted: true }).length).toBe(200);
    now += 8 * 24 * 3600 * 1000;
    expect(C.list({ includeMuted: true }).length).toBe(0);
  });

  it('mutes one conversation for a while, marks read, removes and forgets', () => {
    turnOnCapture();
    const a = C.fromHost('discord', note(), readable);
    C.fromHost('discord', note({ title: 'Bob' }), readable);
    C.mute('discord', 'Alice', 3600000);
    expect(C.list().map(n => n.title)).toEqual(['Bob']);
    expect(C.unreadCount('discord')).toBe(1);
    now += 2 * 3600000;
    expect(C.list().map(n => n.title).sort()).toEqual(['Alice', 'Bob']);
    expect(C.markRead(a.id)).toBe(1);
    expect(C.remove(a.id)).toBe(true);
    C.forget();
    expect(C.list({ includeMuted: true })).toEqual([]);
    expect(localStorage.getItem('vex.panelCapture.items')).toBeNull();
  });

  it('says so when a stored list is damaged instead of hiding it', () => {
    turnOnCapture();
    localStorage.setItem('vex.panelCapture.items', '{not json');
    expect(() => C.list()).toThrow(/not readable/);
  });

  it('reports a notification coming from a tab only for Discord and WhatsApp', () => {
    turnOnCapture(['discord', 'whatsapp']);
    expect(C.fromTab({ getURL: () => 'https://web.whatsapp.com/' }, note())).toMatchObject({ source: 'whatsapp' });
    expect(C.fromTab({ getURL: () => 'https://example.com/' }, note())).toBeNull();
  });

  it('the preload reports title and body to the host window only, and the host windows hand them on', () => {
    const pre = read('src/preload-webview.js');
    expect(pre).toContain("sendToHost('vex-notification-seen'");
    expect(pre).toMatch(/String\(title\)\.slice\(0, 200\)/);
    expect(pre).toMatch(/String\(body\)\.slice\(0, 300\)/);
    expect(read('src/renderer/js/sidebar.js')).toContain("PanelCapture.fromHost(panelName, e.args && e.args[0], wv)");
    expect(read('src/renderer/js/webview.js')).toContain('PanelCapture.fromTab(webview, e.args && e.args[0])');
  });
});

describe('T1-033 VIP people and keywords', () => {
  it('matches a person by name or nickname, a word, a whole panel; whole words only', () => {
    V.addPerson('Samir', 'sam, sammy');
    V.addKeyword('ban');
    V.addSite('whatsapp');
    expect(V.hit('hey Sammy are you there', 'discord')).toMatchObject({ kind: 'person', label: 'Samir' });
    expect(V.hit('he got a BAN today', 'discord')).toMatchObject({ kind: 'keyword', label: 'ban' });
    expect(V.hit('urban planning', 'discord')).toBeNull();
    expect(V.hit('anything', 'whatsapp')).toMatchObject({ kind: 'site' });
    V.setEnabled(false);
    expect(V.hit('ban', 'whatsapp')).toBeNull();
  });

  it('refuses bad input out loud and is bounded', () => {
    expect(() => V.addPerson('x')).toThrow();
    expect(() => V.addSite('Not A Panel!')).toThrow();
    for (let i = 0; i < 50; i++) V.addKeyword('word' + i);
    expect(() => V.addKeyword('one more')).toThrow(/At most/);
  });

  it('lets a VIP through the attention gate while Vex is quiet, without counting it, and nothing else', () => {
    V.addKeyword('deploy');
    localStorage.setItem('vex.fun.quiet', '1');
    expect(S.get().quiet).toBe(true);
    const vip = A.request({ feature: 'panel-capture', urgency: 'useful', id: '1', title: 'x', vipText: 'deploy failed', vipSource: 'discord' });
    expect(vip).toMatchObject({ allow: true, route: 'toast', reason: 'vip' });
    expect(A.request({ feature: 'panel-capture', urgency: 'useful', id: '2', title: 'y', vipText: 'lunch', vipSource: 'discord' }).allow).toBe(false);
    expect(JSON.parse(localStorage.getItem('vex.attention.log') || '[]')).toEqual([]);
    A.mute('panel-capture');
    expect(A.request({ feature: 'panel-capture', urgency: 'useful', id: '3', title: 'z', vipText: 'deploy', vipSource: 'x' }).allow).toBe(false);   // "Never" still wins
  });

  it('a VIP notification while quiet gets one toast; a normal one does not', () => {
    turnOnCapture();
    V.addPerson('Alice');
    localStorage.setItem('vex.fun.quiet', '1');
    C.fromHost('discord', note(), readable);
    expect(toasts.length).toBe(1);
    C.fromHost('discord', note({ title: 'Carl', body: 'hi' }), readable);
    expect(toasts.length).toBe(1);
    expect(C.list().find(n => n.title === 'Alice').vip).toMatchObject({ kind: 'person' });
  });
});

describe('T1-034 panel state and unread ledger', () => {
  it('writes the change of a count to the ledger, not a repeat, not a sleeping panel', () => {
    P.noteCounts({ discord: 3 }, now);
    P.noteCounts({ discord: 3 }, now + 1000);
    P.noteCounts({ discord: 11 }, now + 2000);
    P.noteCounts({}, now + 3000);                    // asleep: no entry, no change
    expect(P.history({ panel: 'discord' }).map(e => e.from + '>' + e.to)).toEqual(['3>11', '0>3']);
    P.noteCounts({ discord: 11 }, now + 4000);        // woke with the same count: still nothing
    expect(P.history({ panel: 'discord' }).length).toBe(2);
  });

  it('counts what a panel gained since it was last looked at', () => {
    P.noteCounts({ discord: 0 }, now);
    P.noteLooked('discord', now + 10);
    P.noteCounts({ discord: 4 }, now + 20);
    P.noteCounts({ discord: 9 }, now + 30);
    expect(P.sinceLooked('discord').gained).toBe(9);
    P.noteLooked('discord', now + 40);
    expect(P.sinceLooked('discord').gained).toBe(0);
  });

  it('bounds the ledger and can clear it', () => {
    for (let i = 0; i < 350; i++) P.noteCounts({ discord: i + 1 }, now + i);
    expect(P.ledger().length).toBe(300);
    P.clearLedger();
    expect(P.ledger()).toEqual([]);
  });

  it('shows a call timer and the playing song only from what the page itself published', async () => {
    window.SidebarManager = globalThis.SidebarManager = { panelCapture: { discord: { mic: true } }, panelWebviews: {}, panelLabel: (n) => n };
    await P.tick({ discord: 2 }, now);
    expect(P.state('discord')).toMatchObject({ unread: 2, inCall: true, callSince: now });
    const wv = { isCurrentlyAudible: () => true };
    window.vexGuestEval = vi.fn(async () => ({ title: 'Song', artist: 'Artist' }));
    SidebarManager.panelWebviews.spotify = wv;
    await P.tick({}, now + 20000);
    expect(P.playing('spotify')).toMatchObject({ title: 'Song', artist: 'Artist' });
    expect(window.vexGuestEval.mock.calls[0][1]).toContain('mediaSession');
    delete window.vexGuestEval;
  });
});

describe('T1-007 Needs me', () => {
  it('ranks a VIP conversation first, gives every row a reason, and the unranked view is by time', async () => {
    turnOnCapture();
    V.addPerson('Alice');
    C.fromHost('discord', note({ title: 'Bob', body: 'lunch?' }), readable);
    now += 1000;
    C.fromHost('discord', note(), readable);
    localStorage.setItem('vex.attention.inbox', JSON.stringify([{ id: 'a1', feature: 'backup', sub: '', label: 'backup', title: 'Back up your notes', body: '', ts: now - 5000 }]));
    const r = await N.collect({ now });
    expect(r.rows[0].title).toBe('Discord: Alice');
    expect(r.rows[0].vip).toBe(true);
    expect(r.rows.every(x => x.why.length > 0)).toBe(true);
    const flat = await N.collect({ now, ranked: false });
    expect(flat.rows.map(x => x.ts)).toEqual([...flat.rows.map(x => x.ts)].sort((a, b) => b - a));
  });

  it('a panel with only a title count shows as its count, and a dismissed count comes back when it grows', async () => {
    globalThis.PanelBadges = { counts: { whatsapp: 3 } };
    let r = await N.collect({ now });
    expect(r.rows.map(x => x.title)).toEqual(['WhatsApp: 3 unread']);
    await N.dismiss(r.rows[0]);
    expect((await N.collect({ now })).rows).toEqual([]);
    PanelBadges.counts.whatsapp = 5;
    expect((await N.collect({ now })).rows.length).toBe(1);
  });

  it('snooze hides until the time, and dismissing teaches the ranker', async () => {
    localStorage.setItem('vex.attention.inbox', JSON.stringify([{ id: 'a1', feature: 'backup', sub: '', label: 'backup', title: 'Back up', body: '', ts: now }]));
    const row = (await N.collect({ now })).rows[0];
    const before = row.score;
    N.snooze(row, 'hour', now);
    expect((await N.collect({ now })).rows).toEqual([]);
    expect((await N.collect({ now: now + 3700000 })).rows.length).toBe(1);
    for (let i = 0; i < 4; i++) N._learn('inbox:backup', -3);
    expect((await N.collect({ now: now + 3700000 })).rows[0].score).toBeLessThan(before);
    expect(N.weight('inbox:backup')).toBe(-13);
  });

  it('reports a source that cannot be read instead of hiding it', async () => {
    globalThis.Autopilot = { stream: async () => { throw new Error('mail down'); } };
    const r = await N.collect({ now });
    expect(r.problems.join(' ')).toMatch(/mail down/);
    N.registerSource('extra', async () => [{ id: 'x:1', origin: 'x', learnKey: '', title: 'Extra', sub: '', ts: now, score: 10, why: ['test'], ref: {} }]);
    expect((await N.collect({ now })).rows.map(x => x.title)).toContain('Extra');
  });
});

describe('T1-010 Away mode', () => {
  it('is a quiet reason in the attention state while away, and a VIP still gets through', () => {
    expect(S.get().quiet).toBe(false);
    W.start('manual');
    expect(S.get()).toMatchObject({ quiet: true, reason: 'away' });
    expect(A.request({ feature: 'backup', urgency: 'useful', id: '1', title: 'Back up?' }).route).toBe('inbox');
    W.end();
    expect(S.get().quiet).toBe(false);
  });

  it('writes a summary of at most five lines from what Vex already held, and nothing else', () => {
    turnOnCapture();
    V.addPerson('Alice');
    P.noteCounts({ discord: 2 }, now - 100);
    W.start('manual');
    now += 90 * 60000;
    C.fromHost('discord', note(), readable);
    C.fromHost('discord', note({ body: 'hello??' }), readable);
    P.noteCounts({ discord: 7 }, now);
    A.suggest({ feature: 'backup', id: 'b', title: 'Back up your notes' });
    const heard = [];
    document.addEventListener('vex:away-summary', (e) => heard.push(e.detail));
    const s = W.end();
    expect(heard.length).toBe(1);
    expect(s.lines.length).toBeLessThanOrEqual(5);
    expect(s.lines[0]).toContain('1 hour 30 min');
    expect(s.lines.join(' ')).toMatch(/2 notifications from panels \(Discord 2\), 2 from people or words you marked VIP/);
    expect(s.lines.join(' ')).toMatch(/Discord 2 to 7/);
    expect(s.lines.join(' ')).toMatch(/Busiest conversation: Alice in Discord \(2\)/);
    expect(s.lines.join(' ')).toMatch(/1 suggestion waited in the Inbox/);
  });

  it('starts by itself when Vex is locked, writes that to the ledger, and ends with the unlock', () => {
    const noted = [];
    globalThis.VexLedger = { note: (l) => { noted.push(l); return l; }, registerUndo: vi.fn() };
    W.init();
    window.dispatchEvent(new CustomEvent('vex-locked'));
    expect(W.active()).toBe(true);
    expect(noted[0]).toMatchObject({ feature: 'away-mode', undo: { kind: 'cancel-away' } });
    window.dispatchEvent(new CustomEvent('vex-unlocked'));
    expect(W.active()).toBe(false);
  });

  it('does not start by itself when the person turned that off, and refuses to start when switched off', () => {
    W.init();
    W.setAutoOnLock(false);
    window.dispatchEvent(new CustomEvent('vex-locked'));
    expect(W.active()).toBe(false);
    W.setEnabled(false);
    expect(() => W.start('manual')).toThrow(/switched off/);
  });
});

describe('T1-006 delivery windows', () => {
  it('is off until switched on, and counts from the moment it is switched on', () => {
    expect(D.enabled()).toBe(false);
    expect(D.check()).toBeNull();
    D.setEnabled(true);
    expect(D.last()).toBe(now);
  });

  it('releases ONE digest at a chosen time with a button, not before the time, and once only', () => {
    now = new Date(2024, 0, 10, 9, 0, 0).getTime();
    I.add({ feature: 'backup', id: 'b', title: 'Back up' });
    D.setEnabled(true);
    D.setTimes(['12:30']);
    const at = new Date(now); at.setHours(12, 30, 0, 0);
    now = at.getTime() - 60000;
    I.add({ feature: 'tidy', id: 't', title: 'Tidy tabs' });
    expect(D.check(now)).toBeNull();
    now = at.getTime() + 1000;
    const text = D.check(now);
    expect(text).toMatch(/waited for you: .*in the Inbox/);
    expect(toasts.length).toBe(1);
    expect(toasts[0].opts.action.label).toBe('Open');
    expect(D.check(now + 60000)).toBeNull();
  });

  it('waits while Vex is quiet, then releases', () => {
    D.setEnabled(true);
    D.setHalfHours(true);
    now += 1000;
    I.add({ feature: 'tidy', id: 't', title: 'Tidy tabs' });
    now += 3 * 3600000;
    localStorage.setItem('vex.fun.quiet', '1');
    expect(D.check(now)).toBeNull();
    expect(toasts.length).toBe(0);
    localStorage.removeItem('vex.fun.quiet');
    expect(D.check(now)).toMatch(/1 thing waited/);
  });

  it('leaves VIP items out, and releases when a Focus block ends', () => {
    turnOnCapture();
    V.addPerson('Alice');
    D.setEnabled(true);
    now += 1000;
    C.fromHost('discord', note(), readable);                          // VIP, delivered already
    C.fromHost('discord', note({ title: 'Carl', body: 'hi' }), readable);
    D.init();
    globalThis.FocusMode = { active: true, until: 0 };
    S.changed();
    expect(toasts.length).toBe(0);
    FocusMode.active = false;
    S.changed();
    expect(toasts.length).toBe(1);
    expect(toasts[0].m).toMatch(/1 panel notification\b/);
  });

  it('refuses a time that is not a time', () => {
    expect(() => D.setTimes(['25:99'])).toThrow(/not a time/);
    expect(() => D.setTimes(['01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00'])).toThrow(/At most/);
  });
});

describe('T1-039 close-protect', () => {
  function tabs(tab, closed) {
    globalThis.TabManager = { tabs: [tab], isCapturing: (t) => !!(t.capturing && t.capturing.mic), closeTab: vi.fn((id) => closed.push(id)), requestClose: (id) => X.close(id) };
    globalThis.WebviewManager = { webviews: new Map() };
  }

  it('closes a quiet tab at once, in the same call', () => {
    const closed = [];
    tabs({ id: 't1', title: 'Docs', url: 'https://x.test/' }, closed);
    X.close('t1');
    expect(closed).toEqual(['t1']);
  });

  it('asks before closing a tab playing sound, and "Keep it open" keeps it', async () => {
    const closed = [];
    tabs({ id: 't1', title: 'Music', url: 'https://x.test/', audible: true, muted: false }, closed);
    window.vexConfirm = vi.fn(async () => false);
    expect(await X.close('t1')).toBe(false);
    expect(closed).toEqual([]);
    expect(window.vexConfirm.mock.calls[0][0].message).toMatch(/is playing sound/);
    expect(window.vexConfirm.mock.calls[0][0].message).toMatch(/Ctrl\+Shift\+T/);
    window.vexConfirm = vi.fn(async () => true);
    expect(await X.close('t1')).toBe(true);
    expect(closed).toEqual(['t1']);
  });

  it('asks for a call and for typed text, and says which', async () => {
    const closed = [];
    const tab = { id: 't1', title: 'Meet', url: 'https://x.test/', capturing: { mic: true } };
    tabs(tab, closed);
    globalThis.WebviewManager.webviews.set('t1', {});
    window.vexGuestEval = vi.fn(async () => true);
    window.vexConfirm = vi.fn(async () => false);
    await X.close('t1');
    const msg = window.vexConfirm.mock.calls[0][0].message;
    expect(msg).toMatch(/in a call/);
    expect(msg).toMatch(/text you typed/);
    expect(window.vexGuestEval.mock.calls[0][1]).toContain('textarea');
    delete window.vexGuestEval;
  });

  it('closes a tab whose page does not answer, and says so in Problems', async () => {
    const closed = [];
    tabs({ id: 't1', title: 'Slow', url: 'https://x.test/' }, closed);
    globalThis.WebviewManager.webviews.set('t1', {});
    window.vexGuestEval = vi.fn(async () => { throw new Error('The page did not answer'); });
    window.VexProblems = { note: vi.fn() };
    window.vexConfirm = vi.fn();
    expect(await X.close('t1')).toBe(true);
    expect(closed).toEqual(['t1']);
    expect(window.VexProblems.note).toHaveBeenCalled();
    expect(window.vexConfirm).not.toHaveBeenCalled();
    delete window.vexGuestEval; delete window.VexProblems;
  });

  it('does not ask when switched off, and one question at a time', async () => {
    const closed = [];
    tabs({ id: 't1', title: 'Music', url: 'https://x.test/', audible: true }, closed);
    X.setEnabled(false);
    X.close('t1');
    expect(closed).toEqual(['t1']);
    X.setEnabled(true);
    closed.length = 0;
    let release;
    window.vexConfirm = vi.fn(() => new Promise((r) => { release = r; }));
    const first = X.close('t1');
    await new Promise((r) => setTimeout(r, 0));
    expect(await X.close('t1')).toBe(false);
    release(true);
    expect(await first).toBe(true);
  });

  it('only single, person-made closes go through it; bulk closes still close at once', () => {
    for (const f of ['tabs.js', 'app.js', 'horizontal-tabs.js', 'gestures.js', 'command.js', 'a11y-keys.js']) expect(read('src/renderer/js/' + f)).toContain('requestClose(');
    expect(read('src/renderer/js/tabs.js')).toContain('closing.forEach(t => this.closeTab(t.id))');
  });
});

describe('wiring', () => {
  it('loads the modules in an order they can use, after the foundations they need', () => {
    const html = read('src/renderer/index.html');
    const order = [...html.matchAll(/<script src="js\/([^"]+)"/g)].map(m => m[1]);
    const at = (f) => order.indexOf(f);
    for (const f of ['panel-capture.js', 'vip-rules.js', 'panel-state.js', 'needs-me.js', 'away-mode.js', 'attention-digest.js', 'close-protect.js', 'panels-comms-ui.js']) {
      expect(at(f), f).toBeGreaterThan(-1);
      for (const before of ['vex-defaults.js', 'vex-attention.js', 'attention-inbox.js', 'vex-settings-groups.js', 'command.js', 'panel-badges.js', 'jobs.js']) expect(at(before), before + ' before ' + f).toBeLessThan(at(f));
      expect(at(f)).toBeLessThan(at('vex-usage-registry.js'));
    }
  });

  it('every new feature has a manifest and a usage switch', () => {
    const manifests = read('src/renderer/js/feature-manifests.js');
    const registry = read('src/renderer/js/vex-usage-registry.js');
    for (const id of ['panel-capture', 'vip-rules', 'needs-me', 'panel-state', 'away-mode', 'attention-digest', 'close-protect']) {
      expect(manifests).toContain("id: '" + id + "'");
      expect(registry).toContain("['" + id + "'");
    }
  });

  it('panel badges publish the per-panel counts the ledger reads', () => {
    expect(read('src/renderer/js/panel-badges.js')).toContain('detail: { total, counts }');
  });

  it('has no emoji in the new files', () => {
    for (const f of ['panel-capture', 'vip-rules', 'panel-state', 'needs-me', 'away-mode', 'attention-digest', 'close-protect', 'panels-comms-ui']) {
      expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(read('src/renderer/js/' + f + '.js')), f).toBe(false);
    }
  });
});
