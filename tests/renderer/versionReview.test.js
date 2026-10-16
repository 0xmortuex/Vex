// @vitest-environment jsdom
//
// js/version-review.js: the card logic, once per version, the XP rules, the update flow
// not waiting for it, consent-gated sending and the Attention quiet states.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
const { VersionReview: VR } = require('../../src/renderer/js/version-review.js');
const { UpdateNotifier } = require('../../src/renderer/js/update-notifier.js');
const { VexConsent } = require('../../src/renderer/js/vex-defaults.js');
const fs = require('fs');
const path = require('path');

const flush = () => new Promise(r => setTimeout(r, 0));
let quiet, requests, suggested, signals, awards, sends, onSignal;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  quiet = false; requests = []; suggested = []; signals = []; awards = []; sends = [];
  globalThis.VexProblems = { note: vi.fn() };
  globalThis.AttentionState = { get: () => ({ quiet, reason: quiet ? 'game' : '', until: 0, sources: [] }) };
  globalThis.VexAttention = {
    isMuted: () => false,
    request: vi.fn((o) => { requests.push(o); return { allow: true, route: 'toast' }; }),
    suggest: vi.fn((o) => { suggested.push(o); return true; }),
  };
  globalThis.VexLevels = { award: vi.fn((k, n) => { awards.push([k, n]); return { gained: 30, level: 2, leveledUp: false }; }) };
  globalThis.VexConsent = VexConsent;
  VexConsent.register(VR.CONSENT_ID, { version: 1, label: 'x' });
  window.vexConfirm = vi.fn(async () => true);
  window.showToast = vi.fn();
  onSignal = (e) => signals.push(e.detail);
  document.addEventListener('vex:medal-signal', onSignal);
  window.vex = { getAppVersion: vi.fn(async () => '2.40.0'), feedbackSend: vi.fn(async (u, p) => { sends.push([u, p]); return { ok: true }; }) };
  delete window.VexTabPolicy;
  UpdateNotifier.close();
});
afterEach(() => { document.getElementById('vr-overlay')?.remove(); document.removeEventListener('vex:medal-signal', onSignal); });

const good = { ratings: { speed: 4 }, chips: ['loved'], comment: '' };

describe('what counts as a review', () => {
  it('needs a rating or a comment of 10+ characters; tags alone do not count', async () => {
    await expect(VR.submit({ ratings: {}, chips: ['bug'], comment: '' }, { version: '2.40.0' })).rejects.toThrow(/at least one/);
    await expect(VR.submit({ ratings: {}, chips: [], comment: 'too short' }, { version: '2.40.0' })).rejects.toThrow();
    expect(VR.list()).toEqual([]);
    expect(awards).toEqual([]);
    await VR.submit({ ratings: {}, chips: [], comment: 'long enough to count' }, { version: '2.40.0' });
    expect(VR.list().length).toBe(1);
  });
  it('refuses invalid values and long comments', () => {
    expect(() => VR.normalize({ ratings: { speed: 6 } })).toThrow();
    expect(() => VR.normalize({ ratings: { color: 3 } })).toThrow();
    expect(() => VR.normalize({ chips: ['zzz'] })).toThrow();
    expect(() => VR.normalize({ comment: 'x'.repeat(501) })).toThrow(/500/);
  });
});

describe('XP and medals', () => {
  it('awards the feedback kind once per version, whatever the rating, and never again for a re-review', async () => {
    const a = await VR.submit({ ratings: { speed: 1, ai: 1 } }, { version: '2.40.0' });
    const b = await VR.submit({ ratings: { speed: 5, ai: 5 } }, { version: '2.41.0' });
    const c = await VR.submit({ ratings: { speed: 3 } }, { version: '2.40.0' });
    expect(a.xp.gained).toBe(30); expect(b.xp.gained).toBe(30);
    expect(c.xp).toEqual({ gained: 0, why: 'already-rewarded' });
    expect(awards).toEqual([['feedback', 1], ['feedback', 1]]);
    expect(VR.list().filter(r => r.version === '2.40.0').length).toBe(1);
  });
  it('signals feedback-first, and feedback-5 progress then award at five versions', async () => {
    for (let i = 0; i < 5; i++) await VR.submit({ ratings: { speed: 3 } }, { version: '2.4' + i + '.0' });
    expect(signals.filter(s => s.id === 'feedback-first').length).toBe(5);
    expect(signals).toContainEqual({ id: 'feedback-5', n: 4, of: 5 });
    expect(signals.at(-1)).toEqual({ id: 'feedback-5' });
  });
  it('the action exists in the levels table and the medals are in the catalogue', () => {
    const levels = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/js/fun/levels.js'), 'utf8');
    expect(levels).toMatch(/'feedback':\s+\{ xp: 30, cap: 2/);
    const cat = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/js/vex-medals-catalog.js'), 'utf8');
    expect(cat).toMatch(/M\('feedback-first'/); expect(cat).toMatch(/M\('feedback-5'/);
  });
  it('keeps at most 50 reviews', async () => {
    for (let i = 0; i < 55; i++) await VR.submit({ ratings: { speed: 3 } }, { version: '3.' + i + '.0' });
    expect(VR.list().length).toBe(50);
    expect(VR.list()[0].version).toBe('3.5.0');
  });
});

describe('when it asks', () => {
  it('asks once per version, as an asked item, and shows the card', async () => {
    expect((await VR.maybeOffer({ version: '2.40.0' })).shown).toBe(true);
    expect(requests[0]).toMatchObject({ feature: 'version-review', urgency: 'asked', id: '2.40.0' });
    expect(document.getElementById('vr-overlay')).not.toBeNull();
    document.getElementById('vr-overlay').remove();
    expect(await VR.maybeOffer({ version: '2.40.0' })).toEqual({ shown: false, why: 'already-offered' });
    expect((await VR.maybeOffer({ version: '2.41.0' })).shown).toBe(true);
  });
  it('waits in the Attention Inbox when the moment is quiet (game, meeting, focus)', async () => {
    quiet = true;
    expect(await VR.maybeOffer({ version: '2.40.0' })).toEqual({ shown: false, why: 'inbox' });
    expect(suggested[0]).toMatchObject({ feature: 'version-review', id: '2.40.0', action: { key: 'open' } });
    expect(document.getElementById('vr-overlay')).toBeNull();
    expect(requests).toEqual([]);
  });
  it('is silent when off, after Never ask again, when muted and in a private window', async () => {
    VR.setEnabled(false); expect((await VR.maybeOffer({ version: '1.0.0' })).why).toBe('off'); VR.setEnabled(true);
    VR.savePrefs({ never: true }); expect((await VR.maybeOffer({ version: '1.0.0' })).why).toBe('never'); VR.savePrefs({ never: false });
    VattentionMuted();
    expect((await VR.maybeOffer({ version: '1.0.0' })).why).toBe('muted');
    globalThis.VexAttention.isMuted = () => false;
    window.VexTabPolicy = { isPrivateWindow: true };
    expect((await VR.maybeOffer({ version: '1.0.0' })).why).toBe('private-window');
  });
  it('on the first start after an update asks about the version that was running, once', async () => {
    window.vex.getAppVersion = vi.fn(async () => '2.40.0');
    expect((await VR.startupCheck()).why).toBe('no-update');
    window.vex.getAppVersion = vi.fn(async () => '2.41.0');
    const r = await VR.startupCheck();
    expect(r.shown).toBe(true);
    expect(document.querySelector('#vr-title').textContent).toContain('2.40.0');
    document.getElementById('vr-overlay').remove();
    expect((await VR.startupCheck()).why).toBe('no-update');
  });
  it('is on by default for a new profile', () => { expect(VR.enabled()).toBe(true); expect(VR.prefs().send).toBe(false); expect(VR.prefs().relayUrl).toBe(''); });
});
function VattentionMuted() { globalThis.VexAttention.isMuted = () => true; }

describe('the card', () => {
  it('has the categories, tags, a 500-character comment, Not now and Never ask again; Not now keeps nothing', async () => {
    await VR.maybeOffer({ version: '2.40.0' });
    const o = document.getElementById('vr-overlay');
    expect(o.querySelectorAll('.vr-row').length).toBe(7);
    expect(o.querySelectorAll('.vr-chip').length).toBe(6);
    expect(o.querySelector('textarea').maxLength).toBe(500);
    const labels = [...o.querySelectorAll('.vr-btn')].map(b => b.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Not now', 'Never ask again']));
    [...o.querySelectorAll('.vr-btn')].find(b => b.textContent === 'Not now').click();
    expect(document.getElementById('vr-overlay')).toBeNull();
    expect(VR.list()).toEqual([]);
  });
  it('an empty save shows the reason and keeps the card; a rating saves, rewards and closes', async () => {
    await VR.maybeOffer({ version: '2.40.0' });
    const o = document.getElementById('vr-overlay');
    const save = [...o.querySelectorAll('.vr-btn')].find(b => b.textContent === 'Save review');
    save.click(); await flush();
    expect(o.querySelector('.vr-error').textContent).toMatch(/at least one/);
    o.querySelectorAll('.vr-row')[0].querySelectorAll('.vr-star')[3].click();
    [...o.querySelectorAll('.vr-btn')].find(b => b.textContent === 'Save review').click(); await flush(); await flush();
    expect(document.getElementById('vr-overlay')).toBeNull();
    expect(VR.list()[0].ratings).toEqual({ speed: 4 });
    expect(awards.length).toBe(1);
  });
  it('Never ask again turns the prompts off', async () => {
    await VR.maybeOffer({ version: '2.40.0' });
    [...document.querySelectorAll('.vr-btn')].find(b => b.textContent === 'Never ask again').click();
    expect(VR.prefs().never).toBe(true);
  });
  it('uses no emoji', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/js/version-review.js'), 'utf8');
    expect(/\p{Extended_Pictographic}/u.test(src)).toBe(false);
  });
});

describe('the update is never held up by the card', () => {
  const info = { ok: true, hasUpdate: true, latest: '2.41.0', current: '2.40.0', size: 1000 };
  it('showCover returns at once and tells the review through an event nobody waits for', () => {
    const slow = vi.fn(() => new Promise(() => {}));   // a card that never answers
    document.addEventListener('vex:update-cover', slow);
    const el = UpdateNotifier.showCover(info);
    expect(el).toBe(document.getElementById('update-cover'));
    expect(slow).toHaveBeenCalledTimes(1);
    document.removeEventListener('vex:update-cover', slow);
  });
  it('Update now proceeds to the download while a review card is open and unanswered', async () => {
    window.vex.updates = { upcomingNotes: vi.fn(async () => ({ ok: true, entries: [] })), download: vi.fn(async () => ({ ok: false, error: 'stop here' })), onProgress() {}, onInstallFailed() {}, cancel: vi.fn(), install: vi.fn(), saveBackup: vi.fn() };
    VR.init();
    UpdateNotifier.showCover(info);
    await flush();
    expect(document.getElementById('vr-overlay')).not.toBeNull();   // the card is up over the cover
    await UpdateNotifier._act('update');
    expect(window.vex.updates.download).toHaveBeenCalledWith('2.41.0');
  });
  it('the update code never awaits or references the review', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/js/update-notifier.js'), 'utf8');
    expect(src).not.toMatch(/VersionReview/);
    expect(src).not.toMatch(/await[^;\n]*vex:update-cover/);
  });
});

describe('sending', () => {
  it('sends nothing by default, and nothing without the relay address, the switch and the consent', async () => {
    await VR.submit(good, { version: '2.40.0' });
    expect(sends).toEqual([]);
    VR.savePrefs({ relayUrl: 'https://r.example', send: true });
    await VR.submit(good, { version: '2.41.0' });          // switch on but never agreed to
    expect(sends).toEqual([]);
    expect(VR.sendReady()).toBe(false);
  });
  it('asks the one-time consent with the exact list, then sends only the allowed fields', async () => {
    VR.savePrefs({ relayUrl: 'https://r.example/' });
    expect(await VR.enableSending()).toBe(true);
    const msg = window.vexConfirm.mock.calls[0][0].message;
    for (const part of ['anonymous random id', 'Vex version', 'ratings', 'tags', 'comment', 'Never sent', 'history']) expect(msg).toContain(part);
    expect(msg).toContain('https://r.example');
    const r = await VR.submit({ ratings: { speed: 4 }, chips: ['bug'], comment: 'a long enough comment' }, { version: '2.40.0' });
    expect(r.sent.state).toBe('sent');
    expect(sends.length).toBe(1);
    expect(sends[0][0]).toBe('https://r.example');
    expect(Object.keys(sends[0][1]).sort()).toEqual(['chips', 'comment', 'installId', 'ratings', 'version']);
    expect(sends[0][1].installId).toMatch(/^[0-9a-f]{32}$/);
    // The consent is not asked again.
    await VR.enableSending();
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
  });
  it('a declined consent keeps sending off; a send failure keeps the local review and says so', async () => {
    VR.savePrefs({ relayUrl: 'https://r.example' });
    window.vexConfirm = vi.fn(async () => false);
    expect(await VR.enableSending()).toBe(false);
    expect(VR.prefs().send).toBe(false);
    window.vexConfirm = vi.fn(async () => true);
    await VR.enableSending();
    window.vex.feedbackSend = vi.fn(async () => { throw new Error('relay down'); });
    const r = await VR.submit(good, { version: '2.40.0' });
    expect(r.sent).toEqual({ state: 'failed', error: 'relay down' });
    expect(VR.list().length).toBe(1);
  });
  it('refuses a relay address that is not https', () => {
    expect(() => VR.savePrefs({ relayUrl: 'http://r.example' })).toThrow(/https/);
    expect(() => VR.savePrefs({ relayUrl: 'https://r.example/?k=1' })).toThrow();
    expect(VR.savePrefs({ relayUrl: '' }).relayUrl).toBe('');
  });
  it('the anonymous id is random, kept, and resettable', () => {
    const a = VR.installId();
    expect(VR.installId()).toBe(a);
    VR.resetInstallId();
    expect(VR.installId()).not.toBe(a);
  });
});

describe('local history', () => {
  it('formats as text, forgets one and forgets all', async () => {
    await VR.submit({ ratings: { speed: 5 }, chips: ['loved'], comment: 'great work here' }, { version: '2.40.0' });
    await VR.submit({ ratings: { ai: 2 } }, { version: '2.41.0' });
    const t = VR.formatText(VR.list());
    expect(t).toContain('Vex 2.40.0'); expect(t).toContain('Speed: 5/5'); expect(t).toContain('I loved a feature'); expect(t).toContain('great work here');
    expect(VR.forget('2.40.0')).toBe(true);
    expect(VR.list().length).toBe(1);
    VR.forgetAll();
    expect(VR.list()).toEqual([]);
  });
});
