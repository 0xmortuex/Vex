// @vitest-environment jsdom
//
// Autopilot: the ranking math, what the stream is made of, and the promises it
// keeps (read-only mail, Done hides in Vex only, drafts are never sent, no
// network of its own).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { AutopilotRank: R } = require('../../src/renderer/js/autopilot-rank.js');
const { InboxTriage } = require('../../src/renderer/js/inbox-triage.js');

// Wednesday 2026-10-14 15:30 local.
const NOW = new Date(2026, 9, 14, 15, 30, 0).getTime();
const HOUR = 3600000, DAY = 86400000;

describe('deadline wording', () => {
  it('reads urgency, today, tomorrow and a weekday out of the text', () => {
    expect(R.deadlineFromText('URGENT: sign this', NOW)).toMatchObject({ urgent: true, at: NOW });
    expect(R.deadlineFromText('can you send it by end of day', NOW).at).toBe(R.endOfDay(NOW));
    expect(R.deadlineFromText('need this by tomorrow', NOW).at).toBe(R.endOfDay(NOW) + DAY);
    const fri = R.deadlineFromText('please reply by friday', NOW);
    expect(new Date(fri.at).getDay()).toBe(5);
    expect(fri.at).toBeGreaterThan(NOW);
  });
  it('finds nothing in plain text', () => {
    expect(R.deadlineFromText('lunch next week?', NOW)).toBeNull();
    expect(R.deadlineFromText('', NOW)).toBeNull();
  });
});

describe('ranking math', () => {
  const mail = (o) => ({ id: 'm1', kind: 'mail', title: 'Quarterly numbers', sub: 'Dana', ts: NOW - HOUR, keys: [], flags: { needs: true }, ...o });
  it('puts the five kinds on one scale', () => {
    expect(R.score(mail(), { now: NOW }).score).toBe(62);
    expect(R.score(mail({ flags: { needs: false } }), { now: NOW }).score).toBe(28);
    expect(R.score(mail({ flags: { bulk: true } }), { now: NOW }).score).toBe(6);
    expect(R.score({ kind: 'reminder', title: 'x', ts: NOW, flags: { fired: true } }, { now: NOW }).score).toBe(85);
    expect(R.score({ kind: 'github', title: 'x', ts: NOW, flags: { failed: true } }, { now: NOW }).score).toBe(58);
    expect(R.score({ kind: 'github', title: 'x', ts: NOW, flags: {} }, { now: NOW }).score).toBe(22);
    expect(R.score({ kind: 'watch', title: 'x', ts: NOW, flags: { changed: true } }, { now: NOW }).score).toBe(36);
    expect(R.score({ kind: 'watch', title: 'x', ts: NOW, flags: { hit: true } }, { now: NOW }).score).toBe(55);
    expect(R.score({ kind: 'release', title: 'x', ts: NOW, flags: {} }, { now: NOW }).score).toBe(26);
  });
  it('maps scores to the three groups at 70 and 40', () => {
    expect(R.score({ kind: 'reminder', title: 'x', ts: NOW, flags: { fired: true } }, { now: NOW }).tier).toBe('now');
    expect(R.score(mail(), { now: NOW }).tier).toBe('today');
    expect(R.score({ kind: 'github', title: 'x', ts: NOW, flags: {} }, { now: NOW }).tier).toBe('fyi');
    expect(R.NOW).toBe(70);
    expect(R.TODAY).toBe(40);
  });
  it('adds for a deadline: overdue 35, within two hours 28, today 18, two days 8', () => {
    const base = mail().flags;
    const at = (dueAt) => R.score(mail({ dueAt, flags: base }), { now: NOW }).score;
    expect(at(NOW - HOUR)).toBe(62 + 35);
    expect(at(NOW + HOUR)).toBe(62 + 28);
    expect(at(R.endOfDay(NOW) - 60000)).toBe(62 + 18);
    expect(at(NOW + 30 * HOUR)).toBe(62 + 8);
    expect(at(NOW + 6 * DAY)).toBe(62);
  });
  it('counts a deadline in the wording for 70 percent', () => {
    const s = R.score(mail({ title: 'Need the report by end of day' }), { now: NOW });
    expect(s.score).toBe(62 + Math.round(18 * 0.7));
    expect(s.why.join(' ')).toMatch(/today/);
  });
  it('an urgent subject lifts mail into "needs you now"', () => {
    const s = R.score(mail({ title: 'URGENT: contract expires today' }), { now: NOW });
    expect(s.tier).toBe('now');
  });
  it('a reminder coming in the next hour outranks plain mail', () => {
    const r = R.score({ kind: 'reminder', title: 'call', ts: NOW, dueAt: NOW + 30 * 60000, flags: {} }, { now: NOW });
    expect(r.score).toBe(38 + 28);
    expect(r.score).toBeGreaterThan(R.score(mail({ flags: { needs: false } }), { now: NOW }).score);
  });
  it('waiting makes what needs you heavier; news goes stale', () => {
    expect(R.score(mail({ ts: NOW - 4 * DAY }), { now: NOW }).score).toBe(62 + 4);
    expect(R.score(mail({ ts: NOW - 40 * DAY }), { now: NOW }).score).toBe(62 + 8);
    expect(R.score({ kind: 'github', title: 'x', ts: NOW - 3 * DAY, flags: {} }, { now: NOW }).score).toBe(22 - 6);
    expect(R.score({ kind: 'github', title: 'x', ts: NOW - 30 * DAY, flags: {} }, { now: NOW }).score).toBe(22 - 14);
  });
  it('never leaves 0..100', () => {
    expect(R.score({ kind: 'mail', title: 'x', ts: NOW - 90 * DAY, flags: { bulk: true } }, { now: NOW }).score).toBe(0);
    const big = R.score({ kind: 'reminder', title: 'URGENT', ts: NOW - 30 * DAY, dueAt: NOW - DAY, keys: ['sender:a'], flags: { fired: true } },
      { now: NOW, model: { keys: { 'sender:a': { o: 500, a: 500, d: 0 } } } });
    expect(big.score).toBe(100);
  });
});

describe('what it learns', () => {
  it('a sender you act on rises; one you dismiss falls', () => {
    let m = R.newModel();
    const keys = ['sender:dana@work.example'];
    for (let i = 0; i < 4; i++) m = R.learn(m, keys, 'open', NOW);
    for (let i = 0; i < 3; i++) m = R.learn(m, keys, 'act', NOW);
    const up = R.importance(m, keys);
    expect(up.value).toBeGreaterThan(10);
    expect(up.why.join(' ')).toMatch(/dana@work\.example/);
    let n = R.newModel();
    for (let i = 0; i < 5; i++) n = R.learn(n, ['sender:promo@shop.example'], 'dismiss', NOW);
    expect(R.importance(n, ['sender:promo@shop.example']).value).toBeLessThan(0);
    expect(R.importance(n, ['sender:promo@shop.example']).value).toBeGreaterThanOrEqual(-12);
  });
  it('moves the same message up or down by the learned amount', () => {
    const item = { id: 'a', kind: 'mail', title: 'Hello', ts: NOW, keys: ['sender:dana@work.example', 'domain:work.example'], flags: { needs: true } };
    const plain = R.score(item, { now: NOW }).score;
    let m = R.newModel();
    for (let i = 0; i < 6; i++) m = R.learn(m, item.keys, 'act', NOW);
    const liked = R.score(item, { now: NOW, model: m }).score;
    expect(liked).toBeGreaterThan(plain);
    expect(liked - plain).toBeLessThanOrEqual(24);
  });
  it('is a new model each time and refuses an unknown event', () => {
    const a = R.newModel();
    const b = R.learn(a, ['x'], 'open', NOW);
    expect(a.keys.x).toBeUndefined();
    expect(b.keys.x.o).toBe(1);
    expect(() => R.learn(a, ['x'], 'like')).toThrow(/open, act and dismiss/);
  });
  it('fades a long history and caps how many keys it keeps', () => {
    let m = R.newModel();
    for (let i = 0; i < 90; i++) m = R.learn(m, ['sender:a'], 'open', NOW);
    expect(m.keys['sender:a'].o).toBeLessThan(45);
    let big = R.newModel();
    for (let i = 0; i < 450; i++) big = R.learn(big, ['sender:' + i], 'open', NOW + i);
    expect(Object.keys(big.keys).length).toBe(400);
    expect(big.keys['sender:449']).toBeTruthy();
    expect(big.keys['sender:0']).toBeUndefined();
  });
});

describe('grouping', () => {
  it('sorts each group by score then newest, and drops what is hidden', () => {
    const items = [
      { id: 'a', kind: 'reminder', title: 'a', ts: NOW - 5 * HOUR, flags: { fired: true } },
      { id: 'b', kind: 'reminder', title: 'b', ts: NOW - 1 * HOUR, flags: { fired: true } },
      { id: 'c', kind: 'mail', title: 'c', ts: NOW, flags: { needs: true } },
      { id: 'd', kind: 'github', title: 'd', ts: NOW, flags: {} },
      { id: 'e', kind: 'mail', title: 'e', ts: NOW, flags: { needs: true } },
    ];
    const g = R.rank(items, { now: NOW, hidden: (i) => i.id === 'e' });
    expect(g.now.map(i => i.id)).toEqual(['b', 'a']);
    expect(g.today.map(i => i.id)).toEqual(['c']);
    expect(g.fyi.map(i => i.id)).toEqual(['d']);
    expect(g.hidden).toBe(1);
    expect(R.summary(g)).toBe('2 need you now, 1 for today, 1 to know.');
    expect(R.summary({ now: [], today: [], fyi: [] })).toBe('Nothing is waiting on you.');
  });
});

// --- the module -----------------------------------------------------------------

let VexAutopilot;
function loadModule() {
  vi.resetModules();
  globalThis.AutopilotRank = R;
  globalThis.InboxTriage = InboxTriage;
  return require('../../src/renderer/js/autopilot.js').VexAutopilot;
}

function mailStub(messages) {
  const calls = [];
  const api = {
    accounts: async () => { calls.push('accounts'); return { ok: true, value: [{ id: 'a1', email: 'me@gmail.com', provider: 'gmail', webmail: 'https://mail.google.com/' }] }; },
    inbox: async () => { calls.push('inbox'); return { ok: true, value: { messages, unseen: messages.length } }; },
    message: async () => { calls.push('message'); return { ok: true, value: { subject: 'Re: budget', from: 'Dana <dana@work.example>', text: 'Can you confirm the budget by Friday?' } }; },
  };
  // Anything but the three read calls is a write the bridge does not have.
  const guarded = new Proxy(api, { get(t, k) { if (k in t) return t[k]; throw new Error('mail bridge has no ' + String(k)); } });
  return { api: guarded, calls };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ now: NOW });
  window.showToast = vi.fn();
  window.escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  globalThis.VexProblems = { note: vi.fn() };
  window.vex = { reminders: { list: async () => [], ack: vi.fn(async () => ({ ok: true })), create: vi.fn(async () => ({ ok: true })) } };
  delete globalThis.PageWatch; delete globalThis.MailTriage; delete globalThis.VexSnooze; delete globalThis.AIRouter; delete globalThis.VexBrief;
  VexAutopilot = loadModule();
});
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

const msg = (o) => ({ uid: 1, messageId: '<1@x>', subject: 'Budget question?', from: { name: 'Dana', address: 'dana@work.example' }, date: NOW - HOUR, seen: false, flagged: false, ...o });

describe('what the stream is made of', () => {
  it('reads no mail until it is turned on', async () => {
    const { api, calls } = mailStub([msg()]);
    window.vex.mail = api;
    const g = await VexAutopilot.stream({ now: NOW });
    expect(calls).toEqual([]);
    expect(g.mailOn).toBe(false);
    expect(g.now.length + g.today.length + g.fyi.length).toBe(0);
  });
  it('ranks unread mail once on, leaves bulk out and counts it', async () => {
    const { api, calls } = mailStub([
      msg(),
      msg({ uid: 2, messageId: '<2@x>', subject: 'Your weekly digest', from: { name: 'News', address: 'noreply@news.example' } }),
      msg({ uid: 3, messageId: '<3@x>', subject: 'Old thread', seen: true }),
    ]);
    window.vex.mail = api;
    VexAutopilot.setMail(true);
    const g = await VexAutopilot.stream({ now: NOW });
    expect(calls).toEqual(['accounts', 'inbox']);
    const all = [...g.now, ...g.today, ...g.fyi];
    expect(all.map(i => i.title)).toEqual(['Budget question?']);
    expect(g.bulk).toBe(1);
    expect(all[0].url).toMatch(/mail\.google\.com/);
  });
  it('keeps the mail answer for five minutes instead of asking the server again', async () => {
    const { api, calls } = mailStub([msg()]);
    window.vex.mail = api;
    VexAutopilot.setMail(true);
    await VexAutopilot.stream({ now: NOW });
    await VexAutopilot.stream({ now: NOW + 60000 });
    expect(calls.filter(c => c === 'inbox').length).toBe(1);
    await VexAutopilot.stream({ now: NOW + 6 * 60000 });
    expect(calls.filter(c => c === 'inbox').length).toBe(2);
  });
  it('says when mail cannot be read and keeps the rest', async () => {
    window.vex.mail = { accounts: async () => ({ ok: false, error: 'The mail server refused the password.' }), inbox: async () => ({ ok: false }) };
    window.vex.reminders.list = async () => [{ id: 'r1', message: 'Call the bank', at: NOW - 600000, firedAt: NOW - 600000, ackedAt: null, kind: 'reminder' }];
    VexAutopilot.setMail(true);
    const g = await VexAutopilot.stream({ now: NOW });
    expect(g.problems.join(' ')).toMatch(/refused the password/);
    expect(g.now.map(i => i.title)).toEqual(['Call the bank']);
  });
  it('includes fired and imminent reminders, not alarms, timers or acknowledged ones', async () => {
    window.vex.reminders.list = async () => [
      { id: 'r1', message: 'Fired', at: NOW - HOUR, firedAt: NOW - HOUR, ackedAt: null, kind: 'reminder' },
      { id: 'r2', message: 'Soon', at: NOW + HOUR, firedAt: null, ackedAt: null, kind: 'reminder' },
      { id: 'r3', message: 'Far off', at: NOW + 5 * DAY, firedAt: null, ackedAt: null, kind: 'reminder' },
      { id: 'r4', message: 'Alarm', at: NOW + HOUR, kind: 'alarm' },
      { id: 'r5', message: 'Done already', at: NOW - HOUR, firedAt: NOW - HOUR, ackedAt: NOW, kind: 'reminder' },
    ];
    const g = await VexAutopilot.stream({ now: NOW });
    expect([...g.now, ...g.today, ...g.fyi].map(i => i.title).sort()).toEqual(['Fired', 'Soon']);
  });
  it('keeps a GitHub event the watch announced once', async () => {
    document.dispatchEvent(new CustomEvent('vex:github-watch', { detail: { text: 'CI failed for acme/widget: build', url: 'https://github.com/acme/widget/actions/runs/9' } }));
    const g = await VexAutopilot.stream({ now: NOW });
    const e = [...g.now, ...g.today, ...g.fyi][0];
    expect(e.kind).toBe('github');
    expect(e.sub).toBe('acme/widget');
    expect(e.flags.failed).toBe(true);
    expect(e.score).toBe(58);
  });
  it('takes unseen watched pages and release radar from PageWatch', async () => {
    const seen = [];
    globalThis.PageWatch = {
      list: () => [
        { id: 'w1', url: 'https://shop.example/item', title: 'Keyboard price', lastChangedAt: NOW - HOUR, seenAt: 0, kind: 'number', target: 50 },
        { id: 'w2', url: 'https://store.example/patch', title: 'Game patch notes', lastChangedAt: NOW - HOUR, seenAt: 0, source: 'radar:patch-notes' },
        { id: 'w3', url: 'https://old.example', title: 'Seen', lastChangedAt: NOW - DAY, seenAt: NOW },
      ],
      isUnseen: (w) => !!(w.lastChangedAt && w.lastChangedAt > (w.seenAt || 0)),
      markSeen: (id) => seen.push(id),
    };
    const g = await VexAutopilot.stream({ now: NOW });
    const all = [...g.now, ...g.today, ...g.fyi];
    expect(all.map(i => i.kind).sort()).toEqual(['release', 'watch']);
    expect(all.find(i => i.kind === 'watch').score).toBe(55);
    await VexAutopilot.done(all.find(i => i.kind === 'watch'));
    expect(seen).toEqual(['w1']);
  });
});

describe('what Done, snooze and remind really do', () => {
  async function oneMail() {
    const { api, calls } = mailStub([msg()]);
    window.vex.mail = api;
    VexAutopilot.setMail(true);
    const g = await VexAutopilot.stream({ now: NOW });
    return { item: [...g.now, ...g.today][0], calls };
  }
  it('Done hides the row in Vex and touches nothing on the mail server', async () => {
    const { item, calls } = await oneMail();
    calls.length = 0;
    await VexAutopilot.done(item);
    expect(calls).toEqual([]);                      // no mail call of any kind
    const g = await VexAutopilot.stream({ now: NOW });
    expect([...g.now, ...g.today, ...g.fyi]).toEqual([]);
    VexAutopilot.undoDone(item);
    const back = await VexAutopilot.stream({ now: NOW });
    expect(back.today.length + back.now.length).toBe(1);
  });
  it('mail has no write call in the bridge for Autopilot to misuse', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/autopilot.js'), 'utf8');
    expect(src).not.toMatch(/vex\.mail\.(send|archive|delete|remove|move|flag|setFlags|markRead|expunge|store)\b/);
    const mailMain = fs.readFileSync(path.join(__dirname, '../../src/main/mail.js'), 'utf8');
    expect(mailMain).toMatch(/EXAMINE|mailboxOpen\([^)]*readOnly/);   // the server side stays read-only
  });
  it('snooze hides until the time, then the row is back', async () => {
    const { item } = await oneMail();
    const at = VexAutopilot.snooze(item, 'hour', NOW);
    expect(at).toBe(NOW + HOUR);
    let g = await VexAutopilot.stream({ now: NOW + 30 * 60000 });
    expect(g.snoozed).toBe(1);
    expect([...g.now, ...g.today, ...g.fyi]).toEqual([]);
    g = await VexAutopilot.stream({ now: NOW + HOUR + 1 });
    expect(g.now.length + g.today.length).toBe(1);
  });
  it('snooze times: this evening is 18:00, tomorrow morning is 08:00 the next day', () => {
    const e = new Date(VexAutopilot.snoozeUntil('evening', NOW));
    expect([e.getHours(), e.getMinutes(), e.getDate()]).toEqual([18, 0, 14]);
    const t = new Date(VexAutopilot.snoozeUntil('tomorrow', NOW));
    expect([t.getHours(), t.getDate()]).toEqual([8, 15]);
    expect(() => VexAutopilot.snoozeUntil('never')).toThrow();
    // Past 18:00 the evening is tomorrow's.
    const late = new Date(2026, 9, 14, 19, 0).getTime();
    expect(new Date(VexAutopilot.snoozeUntil('evening', late)).getDate()).toBe(15);
  });
  it('also tells the brief\'s snooze list when that is there', async () => {
    const { item } = await oneMail();
    const add = vi.fn();
    globalThis.VexSnooze = { add };
    VexAutopilot.snooze(item, 'tomorrow', NOW);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][0]).toBe('mail');
  });
  it('remind me makes a Vex reminder with the link', async () => {
    const { item } = await oneMail();
    await VexAutopilot.remind(item, 'tomorrow', NOW);
    const [message, at, extra] = window.vex.reminders.create.mock.calls[0];
    expect(message).toBe('Budget question?');
    expect(new Date(at).getHours()).toBe(8);
    expect(extra.url).toMatch(/^https:\/\/mail\.google\.com/);
  });
  it('acknowledging a reminder is the reminder service\'s own ack', async () => {
    window.vex.reminders.list = async () => [{ id: 'r1', message: 'Pay rent', at: NOW - HOUR, firedAt: NOW - HOUR, ackedAt: null, kind: 'reminder' }];
    const g = await VexAutopilot.stream({ now: NOW });
    await VexAutopilot.done(g.now[0]);
    expect(window.vex.reminders.ack).toHaveBeenCalledWith('r1');
  });
  it('learns: opening then finishing a sender raises it, dismissing unseen lowers it', async () => {
    const { item } = await oneMail();
    TabManagerStub();
    VexAutopilot.open(item);
    await VexAutopilot.done(item);
    const m = VexAutopilot.state().model;
    expect(m.keys['sender:dana@work.example']).toMatchObject({ o: 1, a: 1, d: 0 });
    const other = { ...item, id: 'mail:a1:99', keys: ['sender:spam@x.example'] };
    await VexAutopilot.done(other);
    expect(VexAutopilot.state().model.keys['sender:spam@x.example']).toMatchObject({ o: 0, a: 0, d: 1 });
    VexAutopilot.forgetLearning();
    expect(VexAutopilot.state().model.keys).toEqual({});
  });
});

function TabManagerStub() { globalThis.TabManager = { createTab: vi.fn() }; }

describe('drafts', () => {
  it('asks only the local model, and never sends', async () => {
    const calls = [];
    globalThis.AIRouter = { callOn: vi.fn(async (backend, kind, payload) => { calls.push(backend); return { result: '{"reply":"Yes, confirmed."}' }; }) };
    const { api } = mailStub([msg()]);
    window.vex.mail = api;
    window.vex.composeMail = vi.fn();
    VexAutopilot.setMail(true);
    const g = await VexAutopilot.stream({ now: NOW });
    const item = [...g.now, ...g.today][0];
    const d = await VexAutopilot.draft(item);
    expect(calls).toEqual(['local']);
    expect(d.reply).toBe('Yes, confirmed.');
    expect(d.subject).toBe('Re: budget');
    expect(d.to).toBe('dana@work.example');
    expect(window.vex.composeMail).not.toHaveBeenCalled();
  });
  it('says plainly when there is no AI to ask', async () => {
    await expect(VexAutopilot.draft({ kind: 'mail', ref: { accountId: 'a', uid: 1 } })).rejects.toThrow(/AI is not loaded/);
    await expect(VexAutopilot.draft({ kind: 'github', ref: null })).rejects.toThrow(/only be drafted for a message/);
  });
  it('plain text and json replies both come out as text', () => {
    expect(VexAutopilot.plainReply('{"reply": "Thanks."}')).toBe('Thanks.');
    expect(VexAutopilot.plainReply('Thanks.')).toBe('Thanks.');
  });
});

describe('brief module', () => {
  it('registers with the brief when it is there and answers display data', async () => {
    const register = vi.fn();
    globalThis.VexBrief = { register };
    expect(VexAutopilot.registerWithBrief()).toBe(true);
    expect(VexAutopilot.registerWithBrief()).toBe(false);          // once
    const def = register.mock.calls[0][0];
    expect(def.id).toBe('autopilot');
    window.vex.reminders.list = async () => [{ id: 'r1', message: 'Call the bank', at: NOW - 600000, firedAt: NOW - 600000, ackedAt: null, kind: 'reminder' }];
    const out = await def.build({ now: NOW });
    expect(out.summary).toBe('1 needs you now.');
    expect(out.items[0]).toMatchObject({ text: 'Call the bank', badge: 'Now' });
    expect(out.action.cmd.type).toBe('autopilot-open');
    expect(JSON.stringify(out)).not.toMatch(/<[a-z]/i);            // data, never markup
  });
  it('is quiet about the brief when the brief is not loaded', () => {
    expect(VexAutopilot.registerWithBrief()).toBe(false);
  });
});

describe('the panel', () => {
  it('shows the three groups, the action buttons and the plain read-only line', async () => {
    window.vex.reminders.list = async () => [
      { id: 'r1', message: 'Call the bank', at: NOW - 600000, firedAt: NOW - 600000, ackedAt: null, kind: 'reminder' },
    ];
    document.dispatchEvent(new CustomEvent('vex:github-watch', { detail: { text: 'New release of acme/widget: 2.0', url: 'https://github.com/acme/widget/releases' } }));
    const overlay = await VexAutopilot.showPanel();
    await vi.advanceTimersByTimeAsync(0);
    const text = overlay.textContent;
    expect(text).toMatch(/Needs you now/);
    expect(text).toMatch(/FYI/);
    expect(text).toMatch(/Call the bank/);
    expect(text).toMatch(/hides an item inside Vex only/);
    expect(text).toMatch(/read-only/);
    const row = overlay.querySelector('.ap-row');
    expect([...row.querySelectorAll('button')].map(b => b.dataset.act)).toEqual(['open', 'snooze', 'remind', 'done']);
    // Every control is labelled.
    for (const b of overlay.querySelectorAll('button')) expect(b.getAttribute('aria-label') || b.textContent.trim(), b.outerHTML).toBeTruthy();
    // No emoji anywhere in what it drew.
    expect(overlay.innerHTML).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe('no network of its own', () => {
  it('never calls fetch while building the stream', async () => {
    const spy = vi.fn(async () => { throw new Error('network'); });
    globalThis.fetch = spy;
    window.fetch = spy;
    await VexAutopilot.stream({ now: NOW, force: true });
    expect(spy).not.toHaveBeenCalled();
  });
  it('the sources contain no network call', () => {
    for (const f of ['autopilot.js', 'autopilot-rank.js']) {
      const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/js', f), 'utf8');
      expect(src, f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|VexNet|sendBeacon|https?:\/\/(?!github\.com|mail\.google)/);
    }
  });
});
