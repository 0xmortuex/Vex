// @vitest-environment jsdom
//
// Meeting copilot (js/meeting-copilot.js) and the subscription and renewal
// radar (js/renewal-radar.js): the note-tag parser, the action-item prompt
// with a fake model, the renewal date math, the detection heuristics on
// fixture headers, and the promise that no secret is ever read.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
require('../../src/renderer/js/vex-utils.js');
const { MeetingCopilot: MC } = require('../../src/renderer/js/meeting-copilot.js');
const { RenewalRadar: RR } = require('../../src/renderer/js/renewal-radar.js');

const SRC = path.join(__dirname, '../../src/renderer/js');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

beforeEach(() => { localStorage.clear(); delete window.vex; delete globalThis.OpenTasks; delete globalThis.VexQuickReminder; });

// ---------------------------------------------------------------- tags ----
describe('meeting note tags', () => {
  it('reads one-key prefixes and strips them', () => {
    expect(MC.parseLine('d: ship on Friday')).toEqual({ kind: 'decision', text: 'ship on Friday' });
    expect(MC.parseLine('Decision: drop the pilot')).toEqual({ kind: 'decision', text: 'drop the pilot' });
    expect(MC.parseLine('a: send the deck @sam by friday').kind).toBe('action');
    expect(MC.parseLine('TODO: book room').kind).toBe('action');
    expect(MC.parseLine('[ ] ping legal').kind).toBe('action');
    expect(MC.parseLine('q: who owns billing?')).toEqual({ kind: 'question', text: 'who owns billing?' });
  });
  it('leaves ordinary lines and look-alikes as notes', () => {
    expect(MC.parseLine('Discussed the budget').kind).toBe('note');
    expect(MC.parseLine('data: 40 rows').kind).toBe('note');
    expect(MC.parseLine('   ')).toEqual({ kind: 'note', text: '' });
  });
  it('stamps lines, lets a mark override or clear, and refuses empty lines', () => {
    const s = MC.newSession({ title: 'Sprint review', now: 1_000_000 });
    MC.addLine(s, 'kick off', { now: 1_000_000 + 65_000 });
    MC.addLine(s, 'a: write the spec', { now: 1_000_000 + 3_725_000 });
    MC.addLine(s, 'use Postgres', { kind: 'decision', now: 1_000_000 + 4_000_000 });
    expect(MC.offset(s, s.lines[0])).toBe('+1:05');
    expect(MC.offset(s, s.lines[1])).toBe('+1:02:05');
    expect(s.lines.map(l => l.kind)).toEqual(['note', 'action', 'decision']);
    MC.setKind(s, 0, 'question');
    expect(s.lines[0].kind).toBe('question');
    MC.setKind(s, 0, 'question');                       // same key again clears it
    expect(s.lines[0].kind).toBe('note');
    expect(() => MC.addLine(s, '  d:  ')).toThrow(/something/);
    expect(() => MC.setKind(s, 0, 'bogus')).toThrow(/Unknown/);
    s.endedAt = 1;
    expect(() => MC.addLine(s, 'late')).toThrow(/ended/);
  });
  it('reads a due date and an owner out of an action', () => {
    const now = new Date(2026, 9, 16);                  // Friday 16 Oct 2026
    expect(MC.parseDue('send it @2026-10-30', now)).toBe('2026-10-30');
    expect(MC.parseDue('send it by tomorrow', now)).toBe('2026-10-17');
    expect(MC.parseDue('send it by friday', now)).toBe('2026-10-23');   // today is Friday: the NEXT one
    expect(MC.parseDue('send it by monday', now)).toBe('2026-10-19');
    expect(MC.parseDue('send it by 2026-02-30', now)).toBe('');         // not a real date
    expect(MC.parseDue('no date here', now)).toBe('');
    expect(MC.actionMeta('call Sam @sam by 2026-11-02', now)).toEqual({ owner: 'sam', due: '2026-11-02' });
  });
});

// ------------------------------------------------------- the model step ----
describe('meeting summary through a fake model', () => {
  const session = () => {
    const s = MC.newSession({ title: 'Roadmap sync', event: { summary: 'Roadmap sync', start: 5, key: 'roadmap sync@5' }, now: Date.UTC(2026, 9, 16, 9, 0, 0) });
    MC.addLine(s, 'intro and agenda', { now: s.startedAt + 10_000 });
    MC.addLine(s, 'd: freeze scope on 1 Nov', { now: s.startedAt + 60_000 });
    MC.addLine(s, 'a: Priya sends the cost sheet by 2026-10-23', { now: s.startedAt + 120_000 });
    MC.addLine(s, 'q: do we need legal review?', { now: s.startedAt + 180_000 });
    return s;
  };

  it('assembles a prompt that keeps the marks and the times', () => {
    const p = MC.buildPrompt(session());
    expect(p.system).toMatch(/JSON only/);
    expect(p.system).toMatch(/do not invent/i);
    expect(p.prompt).toContain('Meeting: Roadmap sync');
    expect(p.prompt).toContain('[+0:10] intro and agenda');
    expect(p.prompt).toContain('[+1:00] (decision) freeze scope on 1 Nov');
    expect(p.prompt).toContain('(action) Priya sends the cost sheet');
    expect(p.truncated).toBe(false);
  });

  it('drops the oldest plain lines first when the notes are long, never the marked ones', () => {
    const s = MC.newSession({ title: 'Long', now: 0 });
    for (let i = 0; i < 60; i++) MC.addLine(s, 'plain line number ' + i + ' ' + 'x'.repeat(60), { now: i * 1000 });
    MC.addLine(s, 'd: the one decision', { now: 61_000 });
    const p = MC.buildPrompt(s, { maxChars: 1200 });
    expect(p.truncated).toBe(true);
    expect(p.prompt.length).toBeLessThan(1400);
    expect(p.prompt).toContain('(decision) the one decision');
    expect(p.prompt).not.toContain('plain line number 0 ');
    expect(p.prompt).toContain('plain line number 59');
  });

  it('summarises with the injected model and merges it with what was marked', async () => {
    const calls = [];
    const fake = async (system, prompt) => {
      calls.push({ system, prompt });
      return '```json\n' + JSON.stringify({
        summary: 'Scope is frozen on 1 November.',
        decisions: ['Freeze scope on 1 Nov', 'Use the new vendor'],
        actions: [{ text: 'Priya sends the cost sheet by 2026-10-23', owner: 'Priya', due: '2026-10-23' }, { text: 'Book the review room', owner: '', due: '2026-10-20' }],
        questions: ['Do we need legal review?'],
      }) + '\n```';
    };
    const r = await MC.summarise(session(), fake, new Date(2026, 9, 16));
    expect(calls).toHaveLength(1);
    expect(r.summary).toBe('Scope is frozen on 1 November.');
    expect(r.decisions).toEqual(['freeze scope on 1 Nov', 'Use the new vendor']);   // the marked one once, the model's extra one added
    expect(r.questions).toEqual(['do we need legal review?']);
    expect(r.actions.map(a => a.text)).toEqual(['Priya sends the cost sheet by 2026-10-23', 'Book the review room']);
    expect(r.actions[0]).toMatchObject({ due: '2026-10-23', marked: true });
    expect(r.actions[1]).toMatchObject({ due: '2026-10-20', marked: false });
  });

  it('refuses a reply that is not JSON, and an empty session', async () => {
    await expect(MC.summarise(session(), async () => 'Sure! Here is a summary.')).rejects.toThrow(/expected form/);
    await expect(MC.summarise(session(), async () => '{ not json }')).rejects.toThrow(/could not be read/);
    await expect(MC.summarise(MC.newSession({ title: 'x' }), async () => '{}')).rejects.toThrow(/no notes/);
  });

  it('keeps your marked lines even when the model returns nothing useful', async () => {
    const r = await MC.summarise(session(), async () => '{"summary":"","decisions":[],"actions":[],"questions":[]}', new Date(2026, 9, 16));
    expect(r.decisions).toEqual(['freeze scope on 1 Nov']);
    expect(r.actions).toHaveLength(1);
  });

  it('builds a note that Meeting prep will find again, linked to the event', () => {
    const s = session();
    const r = MC.plain(s, new Date(2026, 9, 16));
    const note = MC.noteFor(s, { ...r, summary: 'Short.' }, Date.UTC(2026, 9, 16, 10));
    expect(note.tags).toContain('meeting');
    expect(note.tags).toContain('roadmap sync');
    expect(note.title).toMatch(/^Roadmap sync — 20/);
    expect(note.meetingEvent).toEqual({ summary: 'Roadmap sync', start: 5, key: 'roadmap sync@5' });
    expect(note.content).toContain('## Decisions');
    expect(note.content).toContain('- [ ] Priya sends the cost sheet by 2026-10-23');
    expect(note.content).toContain('**decision**');
  });

  it('creates tasks and, for dated ones, reminders, only from what it is handed', async () => {
    const added = [], reminded = [];
    globalThis.OpenTasks = { add: (t) => { added.push(t); } };
    globalThis.VexQuickReminder = { create: async (m, at) => { reminded.push({ m, at }); return { id: 'r' + reminded.length }; } };
    const now = new Date(2026, 9, 16, 12, 0, 0);
    const r = await MC.createFollowUps([
      { text: 'Send the cost sheet', due: '2026-10-23' },
      { text: 'Chase the vendor', due: '' },
      { text: 'Old thing', due: '2026-10-01' },
      { text: 'Today thing', due: '2026-10-16' },
    ], { now });
    expect(added).toEqual(['Send the cost sheet @2026-10-23', 'Chase the vendor', 'Old thing @2026-10-01', 'Today thing @2026-10-16']);
    expect(r).toMatchObject({ tasks: 4, reminders: 2, failed: [] });
    expect(reminded[0].at.getHours()).toBe(9);
    expect(reminded[1].at.getTime()).toBe(now.getTime() + 60000);       // 09:00 today has passed
    const none = await MC.createFollowUps([], { now });
    expect(none).toMatchObject({ tasks: 0, reminders: 0 });
  });

  it('never asks for the microphone, the camera or the screen', () => {
    const src = read('meeting-copilot.js');
    for (const word of ['getUserMedia', 'getDisplayMedia', 'MediaRecorder', 'desktopCapturer', 'mediaDevices', 'SpeechRecognition', 'AudioContext', 'captureStream']) {
      expect(src.includes(word), word).toBe(false);
    }
    expect(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/.test(src)).toBe(false);
  });

  it('uses only the local model', () => {
    expect(() => MC.localGenerate()).toThrow(/not available/);          // no Ollama in this window
    globalThis.Ollama = { generate: vi.fn(async () => '{}') };
    globalThis.AIRouter = { getOllamaStatus: () => ({ available: false, model: '' }) };
    expect(() => MC.localGenerate()).toThrow(/not set up/);
    delete globalThis.Ollama; delete globalThis.AIRouter;
  });
});

// ---------------------------------------------------------- date math ----
describe('renewal date math', () => {
  it('clamps month ends and comes back to the anchor day', () => {
    expect(RR.addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(RR.addMonths('2026-01-31', 2)).toBe('2026-03-31');            // not the 28th it was clamped to
    expect(RR.addMonths('2028-01-31', 1)).toBe('2028-02-29');            // leap year
    expect(RR.addMonths('2026-03-31', 1)).toBe('2026-04-30');
    expect(RR.addMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(RR.addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(RR.addMonths('2026-01-15', -2)).toBe('2025-11-15');
  });
  it('handles 29 February yearly plans across leap and common years', () => {
    expect(RR.occurrence('2024-02-29', 'yearly', 1)).toBe('2025-02-28');
    expect(RR.occurrence('2024-02-29', 'yearly', 4)).toBe('2028-02-29');
    expect(RR.nextOnOrAfter('2024-02-29', 'yearly', '2027-03-01')).toBe('2028-02-29');
  });
  it('rolls an old anchor forward to the next renewal on or after today', () => {
    expect(RR.nextOnOrAfter('2026-01-31', 'monthly', '2026-02-28')).toBe('2026-02-28');
    expect(RR.nextOnOrAfter('2026-01-31', 'monthly', '2026-03-01')).toBe('2026-03-31');
    expect(RR.nextOnOrAfter('2025-01-10', 'monthly', '2026-10-16')).toBe('2026-11-10');
    expect(RR.nextOnOrAfter('2025-12-31', 'quarterly', '2026-10-16')).toBe('2026-12-31');
    expect(RR.nextOnOrAfter('2026-10-01', 'weekly', '2026-10-16')).toBe('2026-10-22');
    expect(RR.nextOnOrAfter('2026-10-16', 'monthly', '2026-10-16')).toBe('2026-10-16');   // today counts
    expect(RR.nextOnOrAfter('2030-05-05', 'monthly', '2026-10-16')).toBe('2030-05-05');   // future anchor
  });
  it('ends a trial N days after it starts, across a month and a leap day', () => {
    expect(RR.trialEnd('2026-10-10', 14)).toBe('2026-10-24');
    expect(RR.trialEnd('2026-01-28', 7)).toBe('2026-02-04');
    expect(RR.trialEnd('2028-02-25', 7)).toBe('2028-03-03');
    expect(RR.trialEnd('2026-12-25', 30)).toBe('2027-01-24');
    expect(() => RR.trialEnd('2026-10-10', 0)).toThrow(/1 to 366/);
  });
  it('counts days and refuses a date that is not real', () => {
    expect(RR.daysBetween('2026-02-27', '2026-03-02')).toBe(3);
    expect(RR.daysBetween('2028-02-27', '2028-03-02')).toBe(4);
    expect(() => RR.addDays('2026-02-30', 1)).toThrow(/Not a date/);
  });
  it('makes monthly and annual totals per currency, confirmed subscriptions only', () => {
    const items = [
      { status: 'confirmed', kind: 'subscription', cost: 12, cycle: 'monthly', currency: 'USD' },
      { status: 'confirmed', kind: 'subscription', cost: 120, cycle: 'yearly', currency: 'USD' },
      { status: 'confirmed', kind: 'subscription', cost: 3, cycle: 'weekly', currency: 'EUR' },
      { status: 'confirmed', kind: 'subscription', cost: null, cycle: 'monthly', currency: 'USD' },
      { status: 'confirmed', kind: 'trial', cost: 99, cycle: null, currency: 'USD' },
      { status: 'detected', kind: 'subscription', cost: 500, cycle: 'monthly', currency: 'USD' },
      { status: 'dismissed', kind: 'subscription', cost: 500, cycle: 'monthly', currency: 'USD' },
      { status: 'confirmed', kind: 'subscription', cost: 500, cycle: 'monthly', currency: 'USD', cancelled: true },
    ];
    const t = RR.totals(items);
    expect(t.byCurrency.USD).toEqual({ monthly: 22, annual: 264, count: 2 });
    expect(t.byCurrency.EUR).toEqual({ monthly: 13, annual: 156, count: 1 });
    expect(t.unpriced).toBe(1);
  });
  it('plans the reminder N days before at 09:00, or in a minute when that has passed', () => {
    const item = { status: 'confirmed', kind: 'subscription', name: 'Netflix', cost: 15.49, currency: 'USD', cycle: 'monthly', anchor: '2026-11-02', remindDays: null };
    const now = new Date(2026, 9, 16, 8, 0, 0);
    const p = RR.reminderPlan(item, { now, defaultDays: 3 });
    expect(p.forDate).toBe('2026-11-02');
    expect([p.at.getFullYear(), p.at.getMonth(), p.at.getDate(), p.at.getHours()]).toEqual([2026, 9, 30, 9]);
    expect(p.message).toBe('Netflix renews on 2026-11-02 (15.49 USD)');
    const late = RR.reminderPlan({ ...item, anchor: '2026-10-17' }, { now, defaultDays: 3 });
    expect(late.at.getTime()).toBe(now.getTime() + 60000);
    expect(RR.reminderPlan({ ...item, status: 'detected' }, { now })).toBeNull();
    expect(RR.reminderPlan({ ...item, cancelled: true }, { now })).toBeNull();
    const trial = RR.reminderPlan({ ...item, kind: 'trial', cycle: null, anchor: '2026-10-20', name: 'Notion' }, { now, defaultDays: 1 });
    expect(trial.message).toBe('Notion free trial ends tomorrow');          // reminded the day before
    expect(RR.reminderPlan({ ...item, kind: 'trial', cycle: null, anchor: '2026-10-25', name: 'Notion', remindDays: 2 }, { now }).message).toBe('Notion free trial ends on 2026-10-25');
  });
  it('reads dates in words, with the year left out or not', () => {
    expect(RR.parseTextDate('Renews on March 3, 2027', '2026-10-16')).toBe('2027-03-03');
    expect(RR.parseTextDate('Your trial ends 12 Nov', '2026-10-16')).toBe('2026-11-12');
    expect(RR.parseTextDate('trial ends Oct 5', '2026-10-16')).toBe('2027-10-05');   // already past this year
    expect(RR.parseTextDate('next billing date: 2026-12-01', '2026-10-16')).toBe('2026-12-01');
    expect(RR.parseTextDate('on 03/04/2026', '2026-10-16')).toBe('');                // ambiguous: not guessed
    expect(RR.parseTextDate('Feb 30', '2026-01-01')).toBe('');
  });
});

// ---------------------------------------------------------- detection ----
const D = (iso) => Date.parse(iso + 'T12:00:00');
const FIXTURE = [
  // Netflix: two monthly receipts -> monthly, priced
  { subject: 'Your Netflix receipt - $15.49 monthly', from: 'Netflix', date: D('2026-09-02') },
  { subject: 'Your Netflix receipt - $15.49 monthly', from: 'Netflix', date: D('2026-10-02') },
  // Spotify: one receipt, nothing stated -> proposed without a date
  { subject: 'Your receipt from Spotify', from: 'Spotify', date: D('2026-09-20') },
  // trial ending in N days
  { subject: 'Your free trial of Notion ends in 3 days', from: 'Notion', date: D('2026-10-15') },
  // explicit renewal date in words
  { subject: 'Your Adobe Creative Cloud subscription will renew on March 3, 2027', from: 'Adobe', date: D('2026-10-10') },
  // payment processor sender: service named in the subject
  { subject: 'Receipt for your payment to Dropbox Inc. - $11.99/month', from: 'PayPal', date: D('2026-10-05') },
  { subject: 'Receipt for your payment to Dropbox Inc. - $11.99/month', from: 'PayPal', date: D('2026-09-05') },
  // trial that has just started
  { subject: 'Your 14-day free trial has started', from: 'Figma', date: D('2026-10-10') },
  // yearly by wording
  { subject: 'Your 1Password annual subscription renewal', from: '1Password', date: D('2026-03-01') },
  // per month in pounds
  { subject: 'Your membership payment of £7.99 per month', from: 'Audible', date: D('2026-10-08') },
  // explicit day trial end
  { subject: 'Your Duolingo Plus trial ends on Oct 28', from: 'Duolingo', date: D('2026-10-14') },
  // ---- not subscriptions ----
  { subject: 'Your order #1234 has shipped', from: 'Amazon', date: D('2026-10-12') },
  { subject: '50% off - flash sale this weekend', from: 'Adobe', date: D('2026-10-11') },
  { subject: 'Weekly newsletter: 10 tips', from: 'Medium Digest', date: D('2026-10-13') },
  { subject: 'Security alert: new sign-in from Windows', from: 'Google', date: D('2026-10-09') },
  { subject: 'Your receipt from Uber Eats', from: 'Uber Eats', date: D('2026-10-03') },
  { subject: 'Invoice #4410 for consulting', from: 'Client Co', date: D('2026-10-01') },
  { subject: 'Your Hulu subscription has been canceled', from: 'Hulu', date: D('2026-10-04') },
  { subject: 'Meeting tomorrow at 3pm', from: 'Sam', date: D('2026-10-15') },
  { subject: 'Verify your email address', from: 'Acme', date: D('2026-10-14') },
  { subject: 'Your subscription to our newsletter is confirmed', from: 'Blog', date: D('2026-10-12') },
  { subject: 'Subscribe to our newsletter', from: 'Shop', date: D('2026-10-12') },
];
const EXPECTED = ['Netflix', 'Spotify', 'Notion', 'Adobe', 'Dropbox', 'Figma', '1Password', 'Audible', 'Duolingo'];

describe('subscription detection from mail headers', () => {
  const found = RR.detectFromMail(FIXTURE, { today: '2026-10-16' });
  const by = (n) => found.find(f => f.name === n);

  it('finds every real one and nothing else on the fixtures', () => {
    const names = found.map(f => f.name).sort();
    const tp = EXPECTED.filter(n => names.includes(n)).length;
    const fp = names.filter(n => !EXPECTED.includes(n));
    console.log(`[fixtures] ${FIXTURE.length} headers, ${EXPECTED.length} real services: found ${tp}/${EXPECTED.length}, false positives ${fp.length}`, fp);
    expect(names).toEqual([...EXPECTED].sort());
    expect(fp).toEqual([]);
  });
  it('infers cost, cycle and the next renewal', () => {
    expect(by('Netflix')).toMatchObject({ kind: 'subscription', cost: 15.49, currency: 'USD', cycle: 'monthly', anchor: '2026-11-02', status: 'detected' });
    expect(by('Dropbox')).toMatchObject({ cost: 11.99, cycle: 'monthly', anchor: '2026-11-05' });
    expect(by('Adobe')).toMatchObject({ kind: 'subscription', anchor: '2027-03-03' });
    expect(by('1Password')).toMatchObject({ cycle: 'yearly', anchor: '2027-03-01' });
    expect(by('Audible')).toMatchObject({ cost: 7.99, currency: 'GBP', cycle: 'monthly', anchor: '2026-11-08' });
    expect(by('Spotify')).toMatchObject({ kind: 'subscription', anchor: '', cycle: null });
  });
  it('finds trial ends: relative, started-with-length, and written out', () => {
    expect(by('Notion')).toMatchObject({ kind: 'trial', anchor: '2026-10-18' });
    expect(by('Figma')).toMatchObject({ kind: 'trial', anchor: '2026-10-24' });
    expect(by('Duolingo')).toMatchObject({ kind: 'trial', anchor: '2026-10-28' });
  });
  it('keeps the evidence it came from, for you to judge', () => {
    expect(by('Netflix').evidence).toMatch(/2 mail headers/);
    expect(by('Netflix').evidence).toContain('Your Netflix receipt');
  });
  it('lets a trial that converted become a subscription, and a cancellation drop the service', () => {
    const r = RR.detectFromMail([
      { subject: 'Your free trial of Notion ends in 3 days', from: 'Notion', date: D('2026-09-10') },
      { subject: 'Your Notion subscription receipt - $8.00 per month', from: 'Notion', date: D('2026-09-14') },
    ], { today: '2026-10-16' });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'subscription', cost: 8, cycle: 'monthly', anchor: '2026-10-14' });
    expect(RR.detectFromMail([
      { subject: 'Your Hulu subscription receipt - $9.99 monthly', from: 'Hulu', date: D('2026-09-01') },
      { subject: 'Your Hulu subscription has been canceled', from: 'Hulu', date: D('2026-10-04') },
    ])).toEqual([]);
  });
  it('infers the cycle from the gap between receipts when none is written', () => {
    expect(RR.cycleFromGaps(['2026-01-05', '2026-02-05', '2026-03-05'])).toBe('monthly');
    expect(RR.cycleFromGaps(['2025-03-01', '2026-03-01'])).toBe('yearly');
    expect(RR.cycleFromGaps(['2026-10-01', '2026-10-08'])).toBe('weekly');
    expect(RR.cycleFromGaps(['2026-10-01', '2026-10-20'])).toBeNull();
    expect(RR.cycleFromGaps(['2026-10-01'])).toBeNull();
  });
  it('proposes only what is new: not already tracked, not dismissed', () => {
    const fresh = RR.fresh(found, [{ name: 'Netflix' }], [RR.keyOf('Spotify')]);
    expect(fresh.map(f => f.name)).not.toContain('Netflix');
    expect(fresh.map(f => f.name)).not.toContain('Spotify');
    expect(fresh.map(f => f.name)).toContain('Dropbox');
  });
});

describe('detection from clips and the vault list', () => {
  it('reads a clipped receipt', () => {
    const f = RR.detectFromText('Proton Mail Plus\n$4.99 / month\nNext billing date: 2026-11-18\nThanks!', { name: 'Proton', today: '2026-10-16' });
    expect(f).toMatchObject({ name: 'Proton', kind: 'subscription', cost: 4.99, cycle: 'monthly', anchor: '2026-11-18', source: 'clip' });
    const t = RR.detectFromText('Your free trial ends 3 Nov', { name: 'Canva', today: '2026-10-16' });
    expect(t).toMatchObject({ kind: 'trial', anchor: '2026-11-03' });
    expect(RR.detectFromText('Buy milk and eggs', { name: 'x' })).toBeNull();
  });
  it('proposes a known service from a saved login by site name only', () => {
    const f = RR.detectFromVault([
      { host: 'www.netflix.com', username: 'a@b.c', updatedAt: '2024-03-02T10:00:00Z' },
      { host: 'my-bank.example', username: 'x', updatedAt: '2025-01-01T00:00:00Z' },
      { host: 'accounts.spotify.com', username: 'x', updatedAt: '2025-06-01T00:00:00Z' },
    ]);
    expect(f.map(x => x.name).sort()).toEqual(['Netflix', 'Spotify']);
    expect(f[0]).toMatchObject({ source: 'vault', cost: null, anchor: '', confidence: 'low' });
    expect(f[0].evidence).toContain('last changed 2024-03-02');
  });
});

// -------------------------------------------------------------- secrets ----
describe('no secret is ever read, and nothing is contacted', () => {
  it('scans the vault through its metadata list only', async () => {
    const spies = {
      vaultGet: vi.fn(), vaultSave: vi.fn(), vaultUpdate: vi.fn(), vaultDelete: vi.fn(), vaultExportCsv: vi.fn(), vaultHealth: vi.fn(),
      totpList: vi.fn(), totpCodes: vi.fn(), mail: { message: vi.fn(), inbox: vi.fn(), accounts: vi.fn() },
    };
    window.vex = {
      ...spies,
      vaultList: vi.fn(async () => [{ host: 'netflix.com', username: 'me', updatedAt: '2024-01-01T00:00:00Z', password: 'LEAKED-IF-READ', secret: 'LEAKED' }]),
      clipsInboxList: vi.fn(async () => ({ ok: true, items: [{ id: '1', text: 'Notion Plus $8.00 per month\nRenews on 2026-11-20', at: D('2026-10-10') }] })),
    };
    localStorage.setItem('vex.mailHeaders', JSON.stringify([{ accountId: 'a', uid: 1, subject: 'Your Netflix receipt - $15.49 monthly', from: 'Netflix', date: D('2026-10-02'), body: 'SECRET BODY' }]));
    const found = await RR.scan(new Date(2026, 9, 16));
    expect(window.vex.vaultList).toHaveBeenCalledTimes(1);
    for (const [name, fn] of Object.entries(spies)) {
      if (typeof fn === 'function') expect(fn, name).not.toHaveBeenCalled();
    }
    for (const fn of Object.values(spies.mail)) expect(fn).not.toHaveBeenCalled();
    expect(JSON.stringify(found)).not.toContain('LEAKED');
    expect(JSON.stringify(found)).not.toContain('SECRET BODY');
    expect(found.map(f => f.name).sort()).toEqual(['Netflix', 'Notion Plus']);
    const notion = found.find(f => f.name === 'Notion Plus');
    expect(notion).toMatchObject({ cost: 8, cycle: 'monthly', anchor: '2026-11-20' });
    // The mail header is richer than the vault's bare login, so it wins for Netflix.
    expect(found.find(f => f.name === 'Netflix')).toMatchObject({ source: 'mail', cost: 15.49 });
  });

  it('has no code path to a secret, a message body or the network', () => {
    const src = read('renewal-radar.js');
    expect(/\bvex\.mail\b/.test(src)).toBe(false);                      // window.vex.mail (the IMAP bridge) is never touched
    for (const word of ['vaultGet', 'vaultSave', 'vaultUpdate', 'vaultExportCsv', 'vaultHealth', 'totpList', 'totpCodes', 'mail.message', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'getPassword']) {
      expect(src.includes(word), word).toBe(false);
    }
    expect(src).toContain('vaultList');
    // The only mail it reads is the headers memo.
    expect(src).toContain("MAIL_KEY: 'vex.mailHeaders'");
    // The meeting copilot does not touch the vault either.
    expect(/vault|password/i.test(read('meeting-copilot.js'))).toBe(false);
  });
});

// ------------------------------------------------------------------ CSV ----
describe('CSV export', () => {
  it('writes a header, the maths, and neutralises formulas and quotes', () => {
    const csv = RR.toCsv([
      { name: 'Netflix', kind: 'subscription', status: 'confirmed', cost: 15.49, currency: 'USD', cycle: 'monthly', anchor: '2026-11-02', source: 'mail' },
      { name: '=HYPERLINK("http://x")', kind: 'subscription', status: 'detected', cost: 120, currency: 'EUR', cycle: 'yearly', anchor: '2027-01-31', source: 'vault' },
      { name: 'Foo, "Bar"', kind: 'trial', status: 'confirmed', cost: null, currency: 'USD', cycle: null, anchor: '2026-10-20', source: 'manual' },
    ], '2026-10-16').split('\r\n');
    expect(csv[0]).toBe('Name,Kind,Status,Cost,Currency,Billing cycle,Next date,Per month,Per year,Source');
    expect(csv[1]).toBe('Netflix,subscription,confirmed,15.49,USD,monthly,2026-11-02,15.49,185.88,mail');
    expect(csv[2].startsWith("\"'=HYPERLINK(\"\"http://x\"\")\"")).toBe(true);
    expect(csv[2]).toContain(',10.00,120.00,');
    expect(csv[3]).toBe('"Foo, ""Bar""",trial,confirmed,,USD,,2026-10-20,,,manual');
    expect(csv[4]).toBe('');
  });
});

// ---------------------------------------------------------------- store ----
describe('keeping items', () => {
  it('stores, confirms, remembers a dismissal and does not propose it again', async () => {
    const added = RR.addProposals([{ name: 'Netflix', kind: 'subscription', cost: 15.49, currency: 'USD', cycle: 'monthly', anchor: '2026-11-02', source: 'mail', evidence: 'x' }]);
    expect(added).toBe(1);
    expect(RR.addProposals([{ name: 'netflix', kind: 'subscription' }])).toBe(0);
    const [it] = RR.items();
    expect(it.status).toBe('detected');
    expect(RR.totals(RR.items()).byCurrency).toEqual({});                 // not counted until confirmed
    RR.setStatus(it.id, 'dismissed');
    expect(RR.dismissedKeys()).toContain('netflix');
    window.vex = { clipsInboxList: async () => ({ ok: true, items: [] }), vaultList: async () => [{ host: 'netflix.com', updatedAt: '2024-01-01' }] };
    expect(await RR.scan(new Date(2026, 9, 16))).toEqual([]);
  });
  it('refuses bad input instead of storing it', () => {
    expect(() => RR.clean({ name: ' ' })).toThrow(/name/);
    expect(() => RR.clean({ name: 'x', cost: 'abc' })).toThrow(/cost/);
    expect(() => RR.clean({ name: 'x', cycle: 'daily' })).toThrow(/cycle/);
    expect(() => RR.clean({ name: 'x', anchor: '2026-13-40' })).toThrow(/date/);
    expect(() => RR.clean({ name: 'x', remindDays: 99 })).toThrow(/0 and 60/);
    expect(() => RR.setRemindDays(-1)).toThrow();
    localStorage.setItem('vex.renewals', '{oops');
    expect(() => RR.items()).toThrow(/not valid JSON/);
  });
  it('sets one reminder per renewal and replaces it when the date moves', async () => {
    const made = [], deleted = [];
    window.vex = { reminders: { delete: async (id) => { deleted.push(id); }, create: async (m, at) => { made.push({ m, at }); return { id: 'rem' + made.length }; } } };
    RR.upsert({ name: 'Netflix', kind: 'subscription', cost: 15.49, cycle: 'monthly', anchor: '2026-11-02', status: 'confirmed' });
    RR.upsert({ name: 'Detected only', kind: 'subscription', anchor: '2026-11-02', status: 'detected' });
    const now = new Date(2026, 9, 16, 8, 0, 0);
    expect((await RR.syncReminders(now)).set).toBe(1);
    expect((await RR.syncReminders(now)).set).toBe(0);                    // same date: no second reminder
    const [it] = RR.items();
    RR.upsert({ ...it, anchor: '2026-11-20' });
    expect((await RR.syncReminders(now)).set).toBe(1);
    expect(deleted).toEqual(['rem1']);
    expect(made).toHaveLength(2);
  });
  it('gives the brief a snapshot without drawing anything', () => {
    RR.upsert({ name: 'Netflix', kind: 'subscription', cost: 10, cycle: 'monthly', anchor: '2026-10-20', status: 'confirmed' });
    RR.upsert({ name: 'Far', kind: 'subscription', cost: 5, cycle: 'yearly', anchor: '2027-05-01', status: 'confirmed' });
    RR.upsert({ name: 'Maybe', kind: 'trial', anchor: '2026-10-18', status: 'detected' });
    const s = RR.snapshot(new Date(2026, 9, 16));
    expect(s.upcoming.map(u => u.name)).toEqual(['Netflix']);
    expect(s.toConfirm).toBe(1);
    expect(s.totals.byCurrency.USD.monthly).toBe(10.42);
    expect(MC.snapshot()).toBeNull();
    MC.begin({ title: 'Standup', now: 1000 });
    MC.note('d: go', { now: 2000 });
    expect(MC.snapshot()).toMatchObject({ title: 'Standup', lines: 1, decisions: 1, ended: false });
  });
});
