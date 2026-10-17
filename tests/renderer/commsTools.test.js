// @vitest-environment jsdom
//
// Wave 3, community and chat tools: timezone helper (T3-020), unread to task (T3-021), meeting links
// (T3-047), Discord noise tools (T3-013), announcement composer (T3-050), community numbers (T3-059),
// link harvester (T3-060), Discord status suggestions (T3-062), moderator kit (T3-063), Vencord bridge
// receiver (T3-005). Every module is checked against its own safety promise as well as its behaviour.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const JS = path.join(ROOT, 'src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };

const NAMES = ['CommsStore', 'VexTimezone', 'UnreadTask', 'MeetingLinks', 'DiscordNoise', 'AnnounceComposer', 'CommunityMetrics', 'LinkHarvester', 'DiscordStatus', 'ModKit',
  'VencordBridge', 'OpenTasks', 'MeetingPrep', 'TabManager', 'PanelCapture', 'VipRules', 'VexConsent', 'VexLedger', 'VexAttention', 'AttentionState', 'AttentionInbox',
  'VexQuickReminder', 'PageWatch', 'ReadLater', 'VexCopySource', 'VexJobs', 'AIRouter', 'VexBrief', 'SidebarManager'];
let CS, TZ, UT, ML, DN, AC, CM, LH, DS, MK, VB, toasts;

function load() {
  for (const n of NAMES) delete globalThis[n];
  globalThis.VexJobs = { every: vi.fn(() => ({ stop() {} })) };
  globalThis.VexConsent = fresh('vex-defaults.js').VexConsent;
  globalThis.CommsStore = CS = fresh('comms-store.js').CommsStore;
  globalThis.VexTimezone = TZ = fresh('tz-helper.js').VexTimezone;
  globalThis.UnreadTask = UT = fresh('unread-task.js').UnreadTask;
  globalThis.MeetingLinks = ML = fresh('meeting-links.js').MeetingLinks;
  globalThis.DiscordNoise = DN = fresh('discord-noise.js').DiscordNoise;
  globalThis.AnnounceComposer = AC = fresh('announce-composer.js').AnnounceComposer;
  globalThis.CommunityMetrics = CM = fresh('community-metrics.js').CommunityMetrics;
  globalThis.LinkHarvester = LH = fresh('link-harvester.js').LinkHarvester;
  globalThis.DiscordStatus = DS = fresh('discord-status.js').DiscordStatus;
  globalThis.ModKit = MK = fresh('mod-kit.js').ModKit;
  globalThis.VencordBridge = VB = fresh('vencord-bridge.js').VencordBridge;
}

// Several modules wire themselves to the document when they load; a fresh copy per test would leave every earlier copy listening.
let docListeners = [];
const realAdd = document.addEventListener.bind(document);

beforeEach(() => {
  document.addEventListener = (type, fn, opts) => { docListeners.push([type, fn, opts]); realAdd(type, fn, opts); };
  localStorage.clear();
  document.body.innerHTML = '';
  delete window.vex; delete window.VexTabPolicy;
  toasts = [];
  window.showToast = (m, kind) => { toasts.push({ m, kind }); return null; };
  load();
});
afterEach(() => {
  vi.restoreAllMocks(); delete window.showToast; delete window.vexConfirm;
  for (const [type, fn, opts] of docListeners) document.removeEventListener(type, fn, opts);
  docListeners = []; document.addEventListener = realAdd;
});

const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);   // Fri 16 Oct 2026, 12:00 UTC (15:00 in Istanbul)

describe('T3-020 timezone helper', () => {
  beforeEach(() => { TZ.localZone = () => 'Europe/Istanbul'; });

  it('turns "21:00 Istanbul" into times and Discord timestamps', () => {
    const r = TZ.convert('21:00 Istanbul', NOW);
    expect(r.ts).toBe(Date.UTC(2026, 9, 16, 18, 0, 0));
    expect(r.rows[0].text).toMatch(/16 Oct, 21:00 \(UTC\+03:00\)/);
    expect(r.rows.some(x => x.zone === 'UTC' && /18:00/.test(x.text))).toBe(true);
    expect(r.discord.full).toBe('<t:' + (r.ts / 1000) + ':f>');
    expect(r.discord.relative).toBe('<t:' + (r.ts / 1000) + ':R>');
    expect(r.assumed).toMatch(/next 21:00 in Istanbul/);
  });

  it('is right across a daylight-saving change', () => {
    // New York leaves daylight time on 2026-11-01: 9pm on the 1st is UTC-5, on the 31st of October UTC-4.
    expect(TZ.parse('2026-10-31 21:00 new york', NOW).ts).toBe(Date.UTC(2026, 10, 1, 1, 0, 0));
    expect(TZ.parse('2026-11-01 21:00 new york', NOW).ts).toBe(Date.UTC(2026, 10, 2, 2, 0, 0));
  });

  it('understands days, am/pm and the next occurrence', () => {
    expect(TZ.parse('tomorrow 9pm new york', NOW).ts).toBe(Date.UTC(2026, 9, 18, 1, 0, 0));
    expect(TZ.parse('09:00 istanbul', NOW).ts).toBe(Date.UTC(2026, 9, 17, 6, 0, 0));     // 09:00 already passed in Istanbul: tomorrow
    expect(TZ.parse('today 17:00 istanbul', NOW).ts).toBe(Date.UTC(2026, 9, 16, 14, 0, 0));
    expect(TZ.parse('noon utc', NOW).ts).toBe(Date.UTC(2026, 9, 17, 12, 0, 0));
    expect(TZ.parse('21:00 Europe/Istanbul', NOW).zone).toBe('Europe/Istanbul');
  });

  it('says what it could not read', () => {
    expect(() => TZ.parse('', NOW)).toThrow(/Type a time/);
    expect(() => TZ.parse('Istanbul', NOW)).toThrow(/no time/);
    expect(() => TZ.parse('25:00 istanbul', NOW)).toThrow(/no hour 25/);
    expect(() => TZ.parse('21:75 istanbul', NOW)).toThrow(/minute 75/);
    expect(() => TZ.parse('21:00 atlantis', NOW)).toThrow(/not a place/);
    expect(() => TZ.parse('2026-02-31 21:00 utc', NOW)).toThrow(/not a real date/);
    expect(() => TZ.parse('13pm utc', NOW)).toThrow(/1 to 12/);
  });

  it('keeps a list of zones, with limits, and no write in a throwing store', () => {
    expect(TZ.zones()).toEqual(['UTC']);
    expect(TZ.addZone('Tokyo')).toBe('Asia/Tokyo');
    expect(TZ.zones()).toEqual(['UTC', 'Asia/Tokyo']);
    expect(() => TZ.addZone('nowhere')).toThrow(/not a place/);
    expect(TZ.removeZone('UTC')).toBe(true);
    expect(TZ.convert('21:00 Istanbul', NOW).rows.some(r => r.zone === 'Asia/Tokyo')).toBe(true);
    localStorage.setItem('vex.tzHelper', '{broken');
    expect(() => TZ.zones()).toThrow(/not readable/);
  });
});

describe('T3-021 unread to task', () => {
  const date = new Date(2026, 9, 16, 12, 0, 0);

  it('builds a task line with the source, the link and a day', () => {
    expect(UT.line({ text: 'Reply to Sam about the build', source: 'Discord', due: 'tomorrow' }, date)).toBe('Reply to Sam about the build (from Discord) @2026-10-17');
    expect(UT.line({ text: 'Read this', source: 'Docs', url: 'https://x.test/a', due: 'none' }, date)).toBe('Read this (Docs: https://x.test/a)');
    expect(UT.line({ text: 'x', due: 'week' }, date)).toBe('x @2026-10-23');
    expect(UT.line({ text: 'x', due: '2026-12-01' }, date)).toBe('x @2026-12-01');
    expect(() => UT.line({ text: '   ' }, date)).toThrow(/no text/);
    expect(() => UT.line({ text: 'x', due: 'someday' }, date)).toThrow(/A day is/);
  });

  it('cuts a long message to fit the task limit and keeps the source', () => {
    const l = UT.line({ text: 'word '.repeat(300), source: 'Discord', due: 'today' }, date);
    expect(l.length).toBeLessThanOrEqual(UT.MAX_LINE);
    expect(l.endsWith('(from Discord) @2026-10-16')).toBe(true);
  });

  it('adds it through the To-do list, only when on, and not in a private window', () => {
    const added = [];
    globalThis.OpenTasks = { add: (t) => { added.push(t); return { id: 'note1' }; } };
    const r = UT.add({ text: 'Call the printer', source: 'Mail', due: 'none' });
    expect(added).toEqual(['Call the printer (from Mail)']);
    expect(r.noteId).toBe('note1');
    UT.setEnabled(false);
    expect(() => UT.add({ text: 'x' })).toThrow(/switched off/);
    UT.setEnabled(true);
    window.VexTabPolicy = { isPrivateWindow: true };
    expect(() => UT.add({ text: 'x' })).toThrow(/private window/);
    expect(added).toHaveLength(1);
  });

  it('makes a task from a kept notification', () => {
    globalThis.OpenTasks = { add: vi.fn(() => ({ id: 'n' })) };
    globalThis.PanelCapture = { label: () => 'Discord', list: () => [{ id: 'a1', source: 'discord', title: 'Sam', body: 'can you review?' }] };
    UT.setDefaultDue('none');
    UT.fromNotification('a1');
    expect(OpenTasks.add).toHaveBeenCalledWith('Sam: can you review? (from Discord)');
    expect(() => UT.fromNotification('missing')).toThrow(/gone/);
  });
});

describe('T3-047 meeting links and the join strip', () => {
  it('knows call links and ignores the rest', () => {
    for (const u of ['https://meet.google.com/abc-defg-hij', 'https://us02web.zoom.us/j/123', 'https://teams.microsoft.com/l/meetup-join/x', 'https://discord.gg/abc', 'https://discord.com/events/1/2', 'https://app.slack.com/huddle/T1/C1']) expect(ML.isCallLink(u), u).toBe(true);
    for (const u of ['https://discord.com/channels/1/2', 'https://example.com/zoom.us', 'ftp://meet.google.com/x', 'not a url']) expect(ML.isCallLink(u), u).toBe(false);
    expect(ML.callLinks('see https://meet.google.com/aaa-bbb-ccc, and https://docs.example.com/x.')).toEqual(['https://meet.google.com/aaa-bbb-ccc']);
  });

  it('keeps a link with a time, refuses non-call links, and clears old ones', () => {
    expect(() => ML.add({ url: 'https://example.com/x' })).toThrow(/call link/);
    expect(() => ML.add({ url: 'nope' })).toThrow(/https/);
    const l = ML.add({ url: 'https://meet.google.com/aaa-bbb-ccc', label: 'Standup', at: NOW + 600000 });
    expect(ML.links()).toHaveLength(1);
    expect(ML.add({ url: l.url, at: NOW + 900000 }).at).toBe(NOW + 900000);   // same link updates, no duplicate
    expect(ML.links()).toHaveLength(1);
    expect(ML.tidy(NOW + 3 * 86400000)).toBe(1);
  });

  it('due() picks what starts within the lead time and not what was dismissed', () => {
    const items = [
      { key: 'a', title: 'A', at: NOW + 4 * 60000, url: 'u' }, { key: 'b', title: 'B', at: NOW + 20 * 60000, url: 'u' },
      { key: 'c', title: 'C', at: NOW - 5 * 60000, url: 'u' }, { key: 'd', title: 'D', at: NOW - 30 * 60000, url: 'u' }, { key: 'e', title: 'E', at: NOW + 2 * 60000, url: 'u' },
    ];
    expect(ML.due(items, NOW, 5, { e: 1 }).map(i => i.key)).toEqual(['c', 'a']);
  });

  it('shows the strip for a calendar meeting with a call link, and never opens the link itself', async () => {
    const created = [];
    globalThis.TabManager = { createTab: (...a) => created.push(a) };
    globalThis.MeetingPrep = {
      keyOf: (e) => e.summary + '@' + e.start,
      _events: async () => [{ summary: 'Planning', start: NOW + 3 * 60000, description: 'Join: https://meet.google.com/aaa-bbb-ccc and notes https://docs.example.com/p' }, { summary: 'No call', start: NOW + 2 * 60000, description: 'room 4' }],
    };
    ML._now = () => NOW;
    const shown = await ML.tick(NOW);
    expect(shown.title).toBe('Planning');
    expect(document.querySelector('.vex-join-strip')).not.toBeNull();
    expect(created).toHaveLength(0);                                    // showing the strip joined nothing
    document.querySelector('.vex-join-strip .btn-primary').click();
    expect(created).toEqual([['https://meet.google.com/aaa-bbb-ccc', true]]);
    expect(document.querySelector('.vex-join-strip')).toBeNull();
    expect(await ML.tick(NOW)).toBeNull();                              // dismissed once joined
  });

  it('shows no strip when switched off or in a private window, and refuses to join a non-call link', async () => {
    globalThis.MeetingPrep = { keyOf: (e) => e.summary, _events: async () => [{ summary: 'X', start: NOW + 60000, description: 'https://zoom.us/j/1' }] };
    ML.setEnabled(false);
    expect(await ML.tick(NOW)).toBeNull();
    ML.setEnabled(true);
    window.VexTabPolicy = { isPrivateWindow: true };
    expect(await ML.tick(NOW)).toBeNull();
    expect(() => ML.join('https://example.com')).toThrow(/not a call link/);
  });

  it('looks in kept notifications for links, and in mail only when asked', async () => {
    globalThis.PanelCapture = { enabled: () => true, label: () => 'Discord', list: () => [{ source: 'discord', title: 'Sam', body: 'stage at https://discord.com/events/1/2 now', ts: NOW }, { source: 'discord', title: 'Lee', body: 'no link', ts: NOW }] };
    expect(ML.fromNotifications()).toHaveLength(1);
    window.vex = { mail: {} };
    globalThis.VexMail = {
      accounts: async () => [{ id: 'a1' }], inbox: async () => [{ uid: 1, subject: 'Call', date: '2026-10-16' }, { uid: 2, subject: 'Spam' }],
      message: async (id, uid) => ({ subject: uid === 1 ? 'Call' : 'Spam', text: uid === 1 ? 'Join https://zoom.us/j/99' : 'buy things' }), htmlToText: (h) => h,
    };
    const r = await ML.fromMail();
    expect(r.read).toBe(2);
    expect(r.found.map(f => f.url)).toEqual(['https://zoom.us/j/99']);
    delete globalThis.VexMail;
  });
});

function withCapture() {
  globalThis.AttentionState = fresh('attention-state.js').AttentionState;
  globalThis.VexLedger = fresh('vex-ledger.js').VexLedger;
  globalThis.VipRules = fresh('vip-rules.js').VipRules;
  globalThis.PanelCapture = fresh('panel-capture.js').PanelCapture;
  // The noise tools are loaded again so they register their undo with THIS ledger, and the copy load() made stops
  // listening (two copies would judge every notification twice).
  for (let i = docListeners.length - 1; i >= 0; i--) {
    if (docListeners[i][0] === 'vex:panel-notification') { document.removeEventListener(...docListeners[i]); docListeners.splice(i, 1); }
  }
  globalThis.DiscordNoise = DN = fresh('discord-noise.js').DiscordNoise;
  window.VexTabPolicy = { isPrivateWindow: false, canReadWebview: () => true };
  PanelCapture.grant(); PanelCapture.setSite('discord', true);
  return { wv: { getURL: () => 'https://discord.com/channels/@me' } };
}

describe('T3-013 Discord noise tools', () => {
  it('hides a matching notification the moment it is kept, and leaves the others', () => {
    const { wv } = withCapture();
    DN.addRule({ kind: 'hide', field: 'body', match: 'joined the server' });
    expect(PanelCapture.fromHost('discord', { title: 'Welcome Bot', body: 'Sam joined the server!' }, wv)).toMatchObject({ title: 'Welcome Bot' });
    PanelCapture.fromHost('discord', { title: 'Alice', body: 'lunch?' }, wv);
    expect(PanelCapture.list().map(i => i.title)).toEqual(['Alice']);
    expect(DN.hiddenCount()).toBe(1);
  });

  it('mutes a conversation for the time given', () => {
    const { wv } = withCapture();
    DN.addRule({ kind: 'mute', field: 'title', match: 'Build Bot', ms: 3600000 });
    PanelCapture.fromHost('discord', { title: 'Build Bot', body: 'passed' }, wv);
    expect(PanelCapture.isMuted('discord', 'Build Bot')).toBe(true);
    expect(PanelCapture.unreadCount('discord')).toBe(0);
  });

  it('never hides or mutes a VIP match', () => {
    const { wv } = withCapture();
    VipRules.addKeyword('ban');
    DN.addRule({ kind: 'hide', field: 'any', match: 'server' });
    PanelCapture.fromHost('discord', { title: 'Mod', body: 'ban list for the server' }, wv);
    expect(PanelCapture.list()).toHaveLength(1);
    expect(DN.hiddenCount()).toBe(0);
  });

  it('notes one ledger line per rule per hour, and its undo puts the notifications back', async () => {
    const { wv } = withCapture();
    DN.addRule({ kind: 'hide', field: 'body', match: 'boosted' });
    for (let i = 0; i < 3; i++) PanelCapture.fromHost('discord', { title: 'Boost ' + i, body: 'Sam boosted the server' }, wv);
    const lines = VexLedger.list().filter(e => e.feature === 'discord-noise');
    expect(lines).toHaveLength(1);
    expect(lines[0].undo).toEqual({ kind: 'noise-restore', rule: DN.rules()[0].id });
    expect(PanelCapture.list()).toHaveLength(0);
    await VexLedger.undo(lines[0].id);
    expect(PanelCapture.list().map(i => i.title).sort()).toEqual(['Boost 0', 'Boost 1', 'Boost 2']);
    expect(DN.hiddenCount()).toBe(0);
  });

  it('validates rules and does nothing when switched off', () => {
    const { wv } = withCapture();
    expect(() => DN.addRule({ kind: 'delete', match: 'abc' })).toThrow(/hides or mutes/);
    expect(() => DN.addRule({ kind: 'hide', match: 'ab' })).toThrow(/at least 3/);
    expect(() => DN.addRule({ kind: 'mute', match: 'abc', ms: 5 })).toThrow(/a minute to a week/);
    DN.addRule({ kind: 'hide', match: 'abc' });
    expect(() => DN.addRule({ kind: 'hide', match: 'ABC' })).toThrow(/already exists/);
    DN.setEnabled(false);
    PanelCapture.fromHost('discord', { title: 'abc', body: 'x' }, wv);
    expect(PanelCapture.list()).toHaveLength(1);
  });

  it('lists the conversations and servers that never got read, and turns one into a rule', () => {
    const { wv } = withCapture();
    for (let i = 0; i < 6; i++) PanelCapture.fromHost('discord', { title: 'bot (#feed, Big Server)', body: 'line ' + i }, wv);
    PanelCapture.fromHost('discord', { title: 'Alice', body: 'hi' }, wv);
    expect(DN.serverOf('Sam (#general, My Server)')).toBe('My Server');
    expect(DN.serverOf('#general (My Server)')).toBe('My Server');
    expect(DN.serverOf('Alice')).toBe('');
    const noisy = DN.noisiest();
    expect(noisy).toHaveLength(1);
    expect(noisy[0]).toMatchObject({ label: 'Big Server', kind: 'server', count: 6 });
    DN.suggestRule(noisy[0], 'mute');
    expect(DN.ruleCovers(noisy[0])).toBe(true);
  });

  it('touches the page only by the opt-in stylesheet and one read of the server bar: no script of its own, no input, no network', () => {
    const src = fs.readFileSync(path.join(JS, 'discord-noise.js'), 'utf8');
    expect(src).not.toMatch(/executeJavaScript|sendInputEvent|webContents|\.fetch\(|XMLHttpRequest/);
    expect(src.match(/vexGuestEval\(/g)).toHaveLength(1);       // the server bar, on a click
  });
});

describe('T3-050 announcement composer', () => {
  const T = (id) => AC.targets().find(t => t.id === id);

  it('measures each place against its limit and says how far over', () => {
    const r = AC.render('x'.repeat(2100), T('discord'));
    expect(r).toMatchObject({ length: 2100, limit: 2000, over: 100, fits: false });
    expect(AC.render('short', T('x')).fits).toBe(true);
    const all = AC.preview('hello world');
    expect(all.map(p => p.id)).toEqual(AC.TARGETS.map(t => t.id));
  });

  it('turns Markdown into plain text where the place shows none, and keeps it for Discord and GitHub', () => {
    const md = '# Update\n**Bold** and *italic* with `code` and [site](https://a.test/x)\n- one\n> quote';
    expect(AC.render(md, T('discord')).text).toBe(md);
    expect(AC.render(md, T('roblox-shout')).text).toBe('Update\nBold and italic with code and site https://a.test/x\n- one\nquote');
  });

  it('counts a link as 23 characters on X, as that place does', () => {
    const t = AC.render('See https://example.com/a/very/long/path/that/goes/on/and/on/and/on/for/ever/and/ever/x', T('x'));
    expect(t.length).toBe(4 + 23);
  });

  it('never cuts the text for you, and limits are editable', () => {
    const long = 'a'.repeat(300);
    expect(AC.render(long, T('x')).text).toHaveLength(300);
    AC.setLimit('x', 500);
    expect(T('x').limit).toBe(500);
    expect(() => AC.setLimit('x', 3)).toThrow(/from 10/);
    AC.setLimit('x', null);
    expect(T('x').limit).toBe(280);
  });

  it('keeps drafts with a checklist of where they were posted', () => {
    expect(() => AC.save({ text: '   ' })).toThrow(/Write the announcement/);
    const d = AC.save({ title: 'Patch 1.2', text: 'Patch notes' });
    AC.setDone(d.id, 'discord', true);
    expect(AC.draft(d.id).done).toEqual({ discord: true });
    expect(() => AC.setDone(d.id, 'nowhere', true)).toThrow(/No such place/);
    expect(AC.remove(d.id)).toBe(true);
  });

  it('turns the share queue into one weekly post', () => {
    AC.queueLink({ url: 'https://a.test/1', title: 'A tool', caption: 'Great for builders' });
    AC.queueLink({ url: 'https://a.test/2' });
    expect(() => AC.queueLink({ url: 'https://a.test/1' })).toThrow(/already/);
    expect(AC.weeklyText()).toBe('**This week\'s good finds**\n- Great for builders https://a.test/1\n- https://a.test/2');
    expect(AC.clearQueue()).toBe(2);
    expect(() => AC.weeklyText()).toThrow(/empty/);
  });

  describe('posting to the owner\'s own webhook', () => {
    let sent, hook;
    beforeEach(() => {
      sent = []; hook = { has: true, label: 'Discord webhook ending 5678' };
      window.vex = { commsWebhookStatus: async () => hook, commsWebhookSend: async (req) => { sent.push(req); return { ok: true, status: 204 }; }, commsWebhookSet: async () => ({}), commsWebhookClear: async () => ({}) };
    });

    it('sends nothing when the person cancels the confirm', async () => {
      window.vexConfirm = vi.fn(async () => false);
      expect(await AC.post('Patch is out')).toEqual({ sent: false });
      expect(sent).toHaveLength(0);
    });

    it('shows the exact payload in the confirm, then sends exactly that text once', async () => {
      window.vexConfirm = vi.fn(async () => true);
      const r = await AC.post('Patch is out');
      expect(r).toEqual({ sent: true, status: 204 });
      expect(window.vexConfirm.mock.calls[0][0].message).toContain(AC.payloadText('Patch is out', false));
      expect(window.vexConfirm.mock.calls[0][0].message).toContain(hook.label);
      expect(sent).toEqual([{ content: 'Patch is out', allowEveryone: false }]);
    });

    it('refuses without asking when it is over the limit, when no webhook is saved, when off or in a private window', async () => {
      window.vexConfirm = vi.fn(async () => true);
      await expect(AC.post('x'.repeat(2001))).rejects.toThrow(/over the 2000/);
      hook = { has: false, label: '' };
      await expect(AC.post('hi')).rejects.toThrow(/no webhook/);
      hook = { has: true, label: 'w' };
      AC.setEnabled(false);
      await expect(AC.post('hi')).rejects.toThrow(/switched off/);
      AC.setEnabled(true);
      window.VexTabPolicy = { isPrivateWindow: true };
      await expect(AC.post('hi')).rejects.toThrow(/private window/);
      expect(window.vexConfirm).not.toHaveBeenCalled();
      expect(sent).toHaveLength(0);
    });

    it('the webhook address is never stored in the page\'s storage', async () => {
      window.vexConfirm = vi.fn(async () => true);
      await AC.saveWebhook('https://discord.com/api/webhooks/1/secret');
      AC.save({ text: 'x' });
      expect(JSON.stringify(Object.entries(localStorage))).not.toMatch(/webhooks|secret/);
    });
  });

  it('has no way to post by itself: the only send is behind post(), which asks first', () => {
    const src = fs.readFileSync(path.join(JS, 'announce-composer.js'), 'utf8');
    expect(src.match(/commsWebhookSend/g).length).toBe(2);   // the guard check and the single call inside post()
    expect(src).not.toMatch(/setInterval|setTimeout|VexJobs/);
  });
});

describe('T3-059 community numbers and name watch', () => {
  const day = (n) => NOW + n * 86400000;

  it('keeps one reading per day and describes the change against a week ago', () => {
    const m = CM.addMetric({ label: 'Discord members' });
    for (let i = 0; i <= 8; i++) CM.record(m.id, 1000 + i * 10, day(i));
    CM.record(m.id, 1090, day(8) + 3600000);                              // same day: replaces
    const cur = CM.metrics()[0];
    expect(cur.points).toHaveLength(9);
    expect(CM.change(cur)).toMatchObject({ now: 1090, then: 1010, diff: 80, days: 7 });
    expect(CM.describe(cur)).toBe('Discord members: 1,090, +80 (+7.9%) in 7 days');
    expect(CM.sparkOf(cur)).toHaveLength(9);
    expect(CM.sparkOf(cur)[0]).toBe('▁');
    expect(CM.sparkOf(cur)[8]).toBe('█');
    expect(() => CM.record(m.id, 'lots')).toThrow(/a number/);
    expect(() => CM.addMetric({ label: 'discord members' })).toThrow(/already/);
  });

  it('with one reading there is no change to claim', () => {
    const m = CM.addMetric({ label: 'Stars' });
    expect(CM.describe(CM.metrics()[0])).toBe('Stars: no reading yet');
    CM.record(m.id, 5, NOW);
    expect(CM.describe(CM.metrics()[0])).toBe('Stars: 5');
    expect(CM.change(CM.metrics()[0])).toBeNull();
  });

  it('follows only public pages: a login site and an address with a password are refused', () => {
    expect(() => CM.checkUrl('https://discord.com/channels/1/2')).toThrow(/sign-in/);
    expect(() => CM.checkUrl('https://web.whatsapp.com/')).toThrow(/sign-in/);
    expect(() => CM.checkUrl('https://user:pw@example.com/')).toThrow(/user name and password/);
    expect(() => CM.checkUrl('ftp://example.com')).toThrow(/http/);
    expect(CM.checkUrl('https://example.com/stats')).toBe('https://example.com/stats');
  });

  it('follows a page through a page watch and takes its value into the series', () => {
    const watches = [];
    globalThis.PageWatch = {
      add: vi.fn((o) => { const w = { id: 'w1', ...o, lastValue: null, lastCheckedAt: 0 }; watches.push(w); return w; }),
      list: () => watches, remove: vi.fn(), firstNumber: (t) => { const n = Number(String(t).replace(/[^0-9.]/g, '')); return Number.isFinite(n) && String(t).match(/\d/) ? n : null; },
      isUnseen: () => false,
    };
    const m = CM.addMetric({ label: 'Members' });
    CM.watchMetric(m.id, { url: 'https://example.com/server', pattern: '([0-9,]+) members' });
    expect(PageWatch.add).toHaveBeenCalledWith(expect.objectContaining({ kind: 'regex', every: 6 * 3600000, source: 'community-metrics', byUser: false }));
    expect(() => CM.watchMetric(m.id, { url: 'https://example.com/x', pattern: 'y' })).toThrow(/already follows/);
    watches[0].lastValue = '1,204'; watches[0].lastCheckedAt = NOW;
    expect(CM.sync()).toBe(1);
    expect(CM.latest(CM.metrics()[0]).v).toBe(1204);
    expect(CM.sync()).toBe(0);                                              // nothing new
    expect(CM.unwatchMetric(m.id)).toBe(true);
    expect(PageWatch.remove).toHaveBeenCalledWith('w1');
  });

  it('a name watch is an hourly page watch on a public address', () => {
    globalThis.PageWatch = { add: vi.fn(() => ({ id: 'w9' })), list: () => [], remove: vi.fn(), isUnseen: () => false };
    const n = CM.addName({ label: 'my game on the forum', url: 'https://forum.example.com/search?q=mygame' });
    expect(PageWatch.add).toHaveBeenCalledWith(expect.objectContaining({ kind: 'text', every: 3600000, source: 'name-watch' }));
    expect(() => CM.addName({ label: 'dms', url: 'https://discord.com/channels/@me' })).toThrow(/sign-in/);
    expect(CM.removeName(n.id)).toBe(true);
  });

  it('feeds the Morning Brief a bounded payload and nothing when empty', () => {
    expect(CM.briefPayload()).toBeNull();
    const m = CM.addMetric({ label: 'Members' });
    CM.record(m.id, 10, day(0)); CM.record(m.id, 15, day(7));
    const p = CM.briefPayload();
    expect(p.items[0].text).toMatch(/Members: 15, \+5/);
    expect(p.items[0].sub).toHaveLength(2);
  });
});

describe('T3-060 chat link harvester', () => {
  const cdn = (ex) => 'https://cdn.discordapp.com/attachments/1/2/file.zip?ex=' + ex.toString(16) + '&is=abc&hm=def';

  it('reads the expiry of a Discord attachment address', () => {
    const t = Math.floor(NOW / 1000) + 3600;
    expect(LH.expiryOf(cdn(t))).toBe(t * 1000);
    expect(LH.expiryOf('https://example.com/a?ex=ffff')).toBe(0);
    expect(LH.expiryOf('https://cdn.discordapp.com/attachments/1/2/file.zip')).toBe(0);
    expect(LH.expiryOf('https://cdn.discordapp.com/a?ex=zzzz')).toBe(0);
    expect(LH.expiryState({ expiresAt: NOW - 1 }, NOW)).toBe('expired');
    expect(LH.expiryState({ expiresAt: NOW + 3600000 }, NOW)).toBe('soon');
    expect(LH.expiryState({ expiresAt: NOW + 3 * 86400000 }, NOW)).toBe('later');
  });

  it('collects links from text, folds duplicates and groups by conversation', () => {
    LH._now = () => NOW;
    const r1 = LH.collect('look https://a.test/x?utm_source=z and https://b.test/y.', { source: 'Discord', channel: 'Sam (#dev, Srv)' });
    expect(r1).toEqual({ added: 2, seen: 0, found: 2 });
    const r2 = LH.collect('again https://a.test/x', { source: 'Discord', channel: 'Alice' });
    expect(r2).toEqual({ added: 0, seen: 1, found: 1 });
    const groups = LH.byChannel();
    expect(groups.map(g => g.channel)).toEqual(['Sam (#dev, Srv)']);
    expect(groups[0].links).toHaveLength(2);
  });

  it('keeps the newer address when the same attachment is shared again', () => {
    LH._now = () => NOW;
    const t = Math.floor(NOW / 1000);
    LH.collect(cdn(t + 100), { source: 'Discord', channel: 'c' });
    LH.collect(cdn(t + 9000), { source: 'Discord', channel: 'c' });
    expect(LH.links()).toHaveLength(1);
    expect(LH.links()[0].expiresAt).toBe((t + 9000) * 1000);
  });

  it('offers rescue and does each only on the press: open, read later, reminder', async () => {
    LH._now = () => NOW;
    const t = Math.floor(NOW / 1000) + 3 * 3600;
    LH.collect(cdn(t), { source: 'Discord', channel: 'c' });
    LH.collect(cdn(Math.floor(NOW / 1000) - 5).replace('file.zip', 'old.zip'), { source: 'Discord', channel: 'c2' });   // another attachment: the same path with a later expiry would only refresh the first
    const [soon, dead] = [LH.links().find(l => l.expiresAt > NOW), LH.links().find(l => l.expiresAt < NOW)];
    const tabs = [], later = [], reminders = [];
    globalThis.TabManager = { createTab: (...a) => tabs.push(a) };
    globalThis.ReadLater = { add: (...a) => later.push(a) };
    globalThis.VexQuickReminder = { create: async (...a) => reminders.push(a) };
    expect(tabs.length + later.length + reminders.length).toBe(0);         // collecting did none of it
    LH.open(soon.id); LH.saveForLater(soon.id); await LH.remind(soon.id);
    expect(tabs).toHaveLength(1); expect(later[0][1]).toBe('file.zip');
    expect(reminders[0][1].getTime()).toBe(t * 1000 - 30 * 60000);
    expect(() => LH.open(dead.id)).toThrow(/expired/);
    expect(() => LH.saveForLater(dead.id)).toThrow(/expired/);
    expect(LH.expiring().length).toBe(2);
  });

  it('collects from kept notifications only on the call, and only when they are kept', () => {
    globalThis.PanelCapture = { enabled: () => false, list: () => [] };
    expect(() => LH.collectFromNotifications()).toThrow(/off/);
    globalThis.PanelCapture = { enabled: () => true, label: () => 'Discord', list: () => [{ title: 'Sam', body: 'see https://a.test/z' }] };
    expect(LH.collectFromNotifications()).toEqual({ added: 1, seen: 0, scanned: 1 });
  });

  it('reads a chat only through the opted-in channel path and never goes to the network by itself', () => {
    const src = fs.readFileSync(path.join(JS, 'link-harvester.js'), 'utf8');
    expect(src).not.toMatch(/executeJavaScript|\bfetch\(|XMLHttpRequest|setInterval|VexJobs/);
  });

  it('keeps nothing in a private window', () => {
    window.VexTabPolicy = { isPrivateWindow: true };
    expect(() => LH.collect('https://a.test/x')).toThrow(/private window/);
  });
});

describe('T3-062 Discord status follows Game and Focus mode', () => {
  const att = (...ids) => ({ quiet: ids.length > 0, sources: ids.map(id => ({ id, until: id === 'focus' ? new Date(2026, 9, 16, 22, 30).getTime() : 0 })) });
  let suggested, inbox;
  beforeEach(() => {
    suggested = [];
    globalThis.VexAttention = { suggest: vi.fn((o) => { suggested.push(o); return true; }) };
    inbox = null;
  });

  it('suggests once when a mode starts and the way back when it ends, and never touches Discord', () => {
    expect(DS.follow(att())).toBe('');
    expect(DS.follow(att('game'))).toBe('start');
    expect(DS.follow(att('game', 'quiet-switch'))).toBe('');                // still the same mode
    expect(DS.follow(att())).toBe('end');
    expect(suggested.map(s => s.id)).toEqual(['game', 'back']);
    expect(suggested[0].title).toBe('Set Discord to Do Not Disturb: "In a game, back later"?');
    expect(suggested[1].title).toBe('Set Discord to Online?');
    expect(suggested[0].action.label).toBe('Copy status text');
    const src = fs.readFileSync(path.join(JS, 'discord-status.js'), 'utf8');
    expect(src).not.toMatch(/executeJavaScript|insertCSS|sendInputEvent|webContents|\.fetch\(|XMLHttpRequest|userSettings|\/users\/@me/);
  });

  it('puts the end time of a Focus block in the words, or drops it when unknown', () => {
    expect(DS.advice('focus', new Date(2026, 9, 16, 22, 30).getTime()).text).toBe('Focusing until 22:30');
    expect(DS.advice('focus', 0).text).toBe('Focusing');
    DS.follow(att('focus'));
    expect(suggested[0].title).toContain('Focusing until 22:30');
  });

  it('game wins over focus, and nothing is suggested when suggestions are off or the feature is off', () => {
    expect(DS.modeOf(att('focus', 'game')).mode).toBe('game');
    DS.setSuggest(false);
    expect(DS.follow(att('game'))).toBe('');
    DS.follow(att());
    DS.setSuggest(true); DS.setEnabled(false);
    expect(DS.follow(att('game'))).toBe('');
    expect(suggested).toHaveLength(0);
  });

  it('does not suggest the way back when the start was never suggested', () => {
    DS.setSuggest(false);
    DS.follow(att('game'));
    DS.setSuggest(true);
    expect(DS.follow(att())).toBe('');
    expect(suggested).toHaveLength(0);
  });

  it('copies the words and opens the Discord panel on the button, nothing more', async () => {
    const copied = [];
    Object.assign(navigator, { clipboard: { writeText: async (t) => copied.push(t) } });
    const panels = [];
    globalThis.SidebarManager = { openPanel: (p) => panels.push(p) };
    await DS.act('game');
    expect(copied).toEqual(['In a game, back later']);
    expect(panels).toEqual(['discord']);
    expect(toasts[0].m).toMatch(/Do Not Disturb/);
  });

  it('keeps editable wording, rejects an unknown status, and shows a status line on the New Tab page', () => {
    DS.setText('game', { status: 'Idle', text: 'Match in progress' });
    expect(DS.advice('game').label).toBe('Set Discord to Idle: "Match in progress"');
    expect(() => DS.setText('game', { status: 'Gone' })).toThrow(/A Discord status is/);
    expect(DS.currentLine(att())).toBe('');
    expect(DS.currentLine(att('game'))).toBe('Match in progress');
    DS.setManual('Back at 9', 30);
    expect(DS.currentLine(att())).toBe('Back at 9');
    DS.clearManual();
    DS.setLine(false);
    expect(DS.currentLine(att('game'))).toBe('');
    expect(() => DS.setManual('x', 0)).toThrow(/1 minute/);
  });
});

describe('T3-063 moderator chores kit', () => {
  it('logs actions, finds repeat offenders by name and counts them', () => {
    MK.log({ who: 'Sam', action: 'warn', reason: 'spam in #general' });
    MK.log({ who: 'Sam', action: 'timeout', reason: 'spam again' });
    MK.log({ who: 'Samantha', action: 'note', reason: 'asked about rules' });
    const r = MK.lookup('sam');
    expect(r.count).toBe(2);                                                // whole word: Samantha is someone else
    expect(r.repeat).toBe(true);
    expect(r.byAction).toEqual({ warn: 1, timeout: 1 });
    expect(MK.lookup('nobody').count).toBe(0);
    expect(() => MK.lookup('s')).toThrow(/two characters/);
    expect(() => MK.log({ who: '', action: 'warn' })).toThrow(/Who is it about/);
    expect(() => MK.log({ who: 'x', action: 'ban everyone' })).toThrow(/An action is one of/);
  });

  it('writes to a Notes note only if switched on, and creates it', () => {
    const notes = [];
    globalThis.OpenTasks = { notes: () => notes, writeNotes: vi.fn() };
    MK.log({ who: 'Sam', action: 'warn', reason: 'spam' });
    expect(OpenTasks.writeNotes).not.toHaveBeenCalled();
    MK.setToNote(true);
    MK.log({ who: 'Lee', action: 'ban', reason: 'raid' });
    expect(notes[0].title).toBe('Mod log');
    expect(notes[0].content).toMatch(/\| ban \| Lee \| raid$/);
  });

  it('fills templates and keeps a placeholder with no value visible', () => {
    expect(MK.fill('Hi {name}, {reason}. See {rule}.', { name: 'Sam', reason: 'spam' })).toBe('Hi Sam, spam. See {rule}.');
    expect(MK.templates().length).toBe(MK.TEMPLATE_PRESETS.length);
    const t = MK.addTemplate({ name: 'Mine', text: 'Hello {name}' });
    expect(MK.templates().some(x => x.id === t.id)).toBe(true);
    expect(() => MK.addTemplate({ name: '', text: 'x' })).toThrow(/name and a text/);
  });

  it('runs checklists from a preset and from your own items', () => {
    const c = MK.startChecklist({ preset: 'Before a ban' });
    MK.tick(c.id, 0, true);
    expect(MK.checklists()[0].items[0].done).toBe(true);
    expect(() => MK.startChecklist({ preset: 'Nope' })).toThrow(/No such checklist/);
    expect(MK.startChecklist({ name: 'Mine', items: 'one\ntwo' }).items).toHaveLength(2);
    expect(() => MK.startChecklist({ name: 'x', items: '' })).toThrow(/at least one item/);
  });

  it('keeps a report queue and builds a handover note', () => {
    MK.addReport({ about: 'Sam', text: 'Spamming links', from: 'Alex' });
    const r2 = MK.addReport({ text: 'Rude in voice' });
    MK.setReportDone(r2.id);
    MK.log({ who: 'Sam', action: 'warn', reason: 'spam' });
    MK.startChecklist({ preset: 'Raid response' });
    const text = MK.handoverText(7);
    expect(text).toMatch(/Open reports \(1\):\n- Sam: Spamming links \(from Alex\)/);
    expect(text).toMatch(/\| warn \| Sam \| spam/);
    expect(text).toMatch(/Unfinished checklist items \(6\)/);
  });

  it('erases by age, by person and everything, and reports what is overdue', () => {
    const t0 = NOW;
    MK._now = () => t0 - 200 * 86400000;
    MK.log({ who: 'Old Case', action: 'warn' });
    MK._now = () => t0;
    MK.log({ who: 'Sam', action: 'warn' });
    MK.log({ who: 'Lee', action: 'note' });
    expect(MK.overdue(t0)).toEqual({ cases: 1, reports: 0, days: 90 });
    expect(MK.purgeOld(t0)).toEqual({ cases: 1, reports: 0 });
    expect(MK.forgetPerson('sam')).toEqual({ cases: 1, reports: 0 });
    expect(MK.cases().map(c => c.who)).toEqual(['Lee']);
    expect(MK.forgetAll().cases).toBe(1);
    expect(() => MK.setKeepDays(2)).toThrow(/7 to 3650/);
  });

  it('keeps nothing in a private window, nothing when off, and takes no action anywhere', () => {
    window.VexTabPolicy = { isPrivateWindow: true };
    expect(() => MK.log({ who: 'Sam', action: 'warn' })).toThrow(/private window/);
    window.VexTabPolicy = { isPrivateWindow: false };
    MK.setEnabled(false);
    expect(() => MK.log({ who: 'Sam', action: 'warn' })).toThrow(/switched off/);
    const src = fs.readFileSync(path.join(JS, 'mod-kit.js'), 'utf8');
    expect(src).not.toMatch(/executeJavaScript|\bfetch\(|XMLHttpRequest|webContents|window\.vex\./);
  });

  it('a follow-up reminder reminds and does nothing else', async () => {
    const made = [];
    globalThis.VexQuickReminder = { create: async (...a) => { made.push(a); } };
    const c = MK.log({ who: 'Sam', action: 'warn', reason: 'spam' });
    await MK.remind(c.id, new Date(NOW + 86400000));
    expect(made[0][0]).toBe('Moderator follow-up: Sam (warn, spam)');
    await expect(MK.remind(c.id, new Date('x'))).rejects.toThrow(/real time/);
  });
});

describe('T3-005 Vencord bridge receiver', () => {
  const file = () => ({
    schema: 'vex-bridge/1', generatedAt: NOW, account: 'mortuex',
    mentions: [{ id: 'm1', author: 'Sam', text: '@mortuex look at this', ts: NOW - 5000, channelId: '1', channelName: 'dev', guildName: 'Srv' }, { id: 'm2', author: 'Alex', text: 'hey', ts: NOW - 9000, channelId: '2', channelName: 'chat', guildName: 'Srv' }],
    replies: [{ id: 'r1', author: 'Lee', text: 'thanks', ts: NOW - 1000, channelId: '1', channelName: 'dev', guildName: 'Srv' }],
    channels: [{ channelId: '1', name: 'dev', guildName: 'Srv', messages: [
      { id: 'a', author: 'Sam', text: 'Should we ship Friday?', ts: NOW - 40000 }, { id: 'b', author: 'Lee', text: 'We agreed to ship Friday', ts: NOW - 30000 },
      { id: 'c', author: 'Sam', text: '@mortuex can you check https://ci.test/run/9', ts: NOW - 20000 }, { id: 'd', author: 'Alex', text: 'ok', ts: NOW - 10000 }] }],
  });
  let reads;
  beforeEach(() => {
    reads = 0;
    window.vex = {
      commsBridgeStatus: async () => ({ granted: true, folder: 'C:\\bridge', found: true, mtime: NOW, size: 100 }),
      commsBridgeRead: async () => { reads++; return { ok: true, mtime: NOW, data: { ...file(), account: 'mortuex', skipped: 0 } }; },
      commsBridgePick: async () => ({ ok: true }), commsBridgeForget: async () => ({ ok: true, granted: false }),
    };
  });

  it('reads nothing until asked, then digests the new mentions and replies', async () => {
    expect(reads).toBe(0);
    expect(VB.mentions()).toEqual([]);
    await VB.read();
    expect(reads).toBe(1);
    expect(VB.mentions().map(m => m.id)).toEqual(['m1', 'm2']);
    const d = VB.digest();
    expect(d.mentions).toBe(2); expect(d.replies).toBe(1);
    expect(d.lines[0]).toBe('2 new mentions, 1 new reply');
    expect(d.channels[0]).toMatchObject({ name: '#dev (Srv)', n: 2 });
  });

  it('remembers only the ids it showed, so new means new', async () => {
    await VB.read();
    VB.markSeen(['m1']);
    expect(VB.mentions({ onlyNew: true }).map(m => m.id)).toEqual(['m2']);
    VB.markAllSeen();
    expect(VB.digest().mentions).toBe(0);
    const kept = JSON.parse(localStorage.getItem('vex.vencordBridge'));
    expect(Object.keys(kept).sort()).toEqual(['lastRead', 'on', 'seen']);
    expect(JSON.stringify(kept)).not.toMatch(/look at this|thanks/);          // no message text on disk
  });

  it('catches you up on a channel by counting: questions, decisions, mentions of you, links', async () => {
    await VB.read();
    const c = VB.catchUp('1');
    expect(c.count).toBe(4);
    expect(c.authors[0]).toEqual({ name: 'Sam', n: 2 });
    expect(c.questions.map(q => q.text)).toEqual(['Should we ship Friday?']);
    expect(c.decisions.map(q => q.text)).toEqual(['We agreed to ship Friday']);
    expect(c.mentionedYou).toHaveLength(1);
    expect(c.links).toEqual(['https://ci.test/run/9']);
    expect(VB.catchUpText('1')).toMatch(/4 messages in #dev \(Srv\)/);
    expect(() => VB.catchUp('nope')).toThrow(/not in the file/);
  });

  it('summarizes with the local model only', async () => {
    await VB.read();
    const calls = [];
    globalThis.AIRouter = { callOn: async (backend, kind, req) => { calls.push([backend, kind, req.message]); return { result: 'Ship Friday; Sam asks about CI.' }; } };
    expect(await VB.summarizeLocal('1')).toBe('Ship Friday; Sam asks about CI.');
    expect(calls[0][0]).toBe('local');
    expect(calls[0][2]).toContain('Sam: Should we ship Friday?');
    globalThis.AIRouter = { callOn: async () => ({ result: '  ' }) };
    await expect(VB.summarizeLocal('1')).rejects.toThrow(/returned nothing/);
  });

  it('is off or private: reads nothing', async () => {
    VB.setEnabled(false);
    await expect(VB.read()).rejects.toThrow(/switched off/);
    VB.setEnabled(true);
    window.VexTabPolicy = { isPrivateWindow: true };
    await expect(VB.read()).rejects.toThrow(/private window/);
    expect(reads).toBe(0);
  });

  it('the brief section reads only when the file is there, and says nothing when there is nothing new', async () => {
    const p = await VB.briefPayload();
    expect(p.summary).toBe('2 new mentions, 1 new reply');
    VB.markAllSeen();
    expect(await VB.briefPayload()).toBeNull();
    window.vex.commsBridgeStatus = async () => ({ granted: false });
    expect(await VB.briefPayload()).toBeNull();
  });

  it('forgetting clears the session and the seen ids', async () => {
    await VB.read(); VB.markAllSeen();
    await VB.forget();
    expect(VB.data()).toBeNull();
    expect(VB.state().seen).toEqual([]);
  });

  it('the receiver never writes or reaches the network: the window module only asks main', () => {
    const src = fs.readFileSync(path.join(JS, 'vencord-bridge.js'), 'utf8');
    expect(src).not.toMatch(/\bfetch\(|XMLHttpRequest|executeJavaScript|setInterval|VexJobs/);
  });
});

describe('the shared helpers', () => {
  it('report a damaged record instead of replacing it', () => {
    localStorage.setItem('vex.modKit', '{oops');
    expect(() => MK.state()).toThrow(/not readable/);
    localStorage.setItem('vex.modKit', '[1]');
    expect(() => MK.state()).toThrow(/not in a form/);
  });
  it('find links without trailing punctuation', () => {
    expect(CS.links('a https://x.test/p). b https://x.test/p, c http://y.test')).toEqual(['https://x.test/p', 'http://y.test']);
  });
});

describe('wiring', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
  const IDS = ['tz-helper', 'unread-task', 'meeting-links', 'discord-noise', 'announce-composer', 'community-metrics', 'link-harvester', 'discord-status', 'mod-kit', 'vencord-bridge'];

  it('has a manifest and a Minimal Vex row for each of the ten, all staged as new', () => {
    vi.resetModules();
    globalThis.VexRegistry = fresh('feature-registry.js').VexRegistry;
    globalThis.VexUsage = fresh('vex-usage.js').VexUsage;
    fresh('feature-manifests.js');
    globalThis.VexUsageRegistry = fresh('vex-usage-registry.js').VexUsageRegistry;
    const rows = new Set(VexUsageRegistry.table().map(([id]) => id));
    for (const id of IDS) {
      expect(VexRegistry.has(id), id).toBe(true);
      expect(VexRegistry.get(id).maturity, id).toBe('new');
      expect(rows.has(id), id).toBe(true);
    }
  });

  it('loads the scripts in an order where each one finds what it needs at load time', () => {
    const order = ['js/jobs.js', 'js/vex-ledger.js', 'js/brief.js', 'js/vex-attention.js', 'js/attention-inbox.js', 'js/panel-capture.js', 'js/comms-store.js', 'js/tz-helper.js', 'js/unread-task.js', 'js/meeting-links.js',
      'js/discord-noise.js', 'js/announce-composer.js', 'js/community-metrics.js', 'js/link-harvester.js', 'js/discord-status.js', 'js/mod-kit.js', 'js/vencord-bridge.js', 'js/comms-tools-ui.js', 'js/vex-usage-registry.js'];
    const at = order.map(s => html.indexOf('<script src="' + s + '"'));
    expect(at.every(i => i > 0), JSON.stringify(order.filter((s, i) => at[i] < 0))).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('registers each feature command once', () => {
    const ui = fs.readFileSync(path.join(JS, 'comms-tools-ui.js'), 'utf8');
    for (const c of ['timezone-helper', 'task-from-selection', 'meeting-links', 'discord-noise', 'announce-composer', 'community-metrics', 'link-harvester', 'mod-kit', 'vencord-bridge']) expect(ui).toContain("id: '" + c + "'");
  });

  it('the page menu asks for its items by the name the UI module exports', () => {
    expect(fs.readFileSync(path.join(JS, 'webview.js'), 'utf8')).toContain('window.CommsTools.textItems');
    const ui = fresh('comms-tools-ui.js');
    expect(typeof window.CommsTools.textItems).toBe('function');
    globalThis.CommsStore = CS;
    expect(window.CommsTools.textItems('', {}, {})).toEqual([]);
    expect(window.CommsTools.textItems('some text', {}, { editable: true })).toEqual([]);
    expect(typeof ui.CommsToolsUI.render).toBe('function');
  });

  it('offers task, link collection and time conversion items on selected text', () => {
    fresh('comms-tools-ui.js');
    TZ.localZone = () => 'Europe/Istanbul';
    const wv = { getTitle: () => 'Doc', getURL: () => 'https://doc.test/a' };
    expect(window.CommsTools.textItems('Review 21:00 Istanbul https://a.test/z', wv, {}).map(i => i.label)).toEqual(['Make a task from this', 'Collect the links in this']);
    expect(window.CommsTools.textItems('21:00 Istanbul', wv, {}).map(i => i.label)).toEqual(['Make a task from this', 'Convert this time']);
    UT.setEnabled(false);
    expect(window.CommsTools.textItems('21:00 Istanbul', wv, {}).map(i => i.label)).toEqual(['Convert this time']);
  });

  it('no module of this set talks to the network on its own (Vex-side fetch/XHR is absent)', () => {
    for (const f of ['comms-store', 'tz-helper', 'unread-task', 'meeting-links', 'discord-noise', 'announce-composer', 'community-metrics', 'link-harvester', 'discord-status', 'mod-kit', 'vencord-bridge', 'comms-tools-ui']) {
      expect(fs.readFileSync(path.join(JS, f + '.js'), 'utf8'), f).not.toMatch(/\bfetch\(|XMLHttpRequest|\bWebSocket\b|sendBeacon/);
    }
  });
});
