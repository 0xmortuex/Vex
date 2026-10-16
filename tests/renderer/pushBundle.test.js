// @vitest-environment jsdom
//
// js/push-bundle.js (T3-052): hold the listed sites' notifications and show them together; never a code.
import { describe, it, expect, beforeEach, vi } from 'vitest';

globalThis.VexMediaKit = require('../../src/renderer/js/media-kit.js').VexMediaKit;
const { VexPushBundle } = require('../../src/renderer/js/push-bundle.js');
const { AttentionDigest } = require('../../src/renderer/js/attention-digest.js');

const HOUR = 3600000;
let now, wv;
const tab = (url) => ({ getURL: () => url, send: vi.fn() });

beforeEach(() => {
  localStorage.clear();
  now = Date.UTC(2026, 9, 14, 10, 0);
  VexPushBundle._now = () => now;
  VexPushBundle._sent = new WeakSet();
  delete globalThis.AttentionState; delete globalThis.VexAttention; delete globalThis.VexLedger; delete globalThis.GameSession; delete globalThis.GameMode;
  globalThis.AttentionDigest = AttentionDigest;
  window.VexTabPolicy = { isPrivateWindow: false, canReadWebview: () => true };
  window.showToast = vi.fn();
  wv = tab('https://shop.example/orders');
  VexPushBundle.setEnabled(true);
});

describe('what always comes straight through', () => {
  it.each([
    ['Your code', '123456 is your verification code'],
    ['Security alert', 'New sign-in from Windows'],
    ['Login', 'Sign in code: 884211'],
    ['Weather', 'Emergency flood warning for your area'],
    ['Bank', 'Your one-time password'],
  ])('%s: %s', (title, body) => {
    expect(VexPushBundle.passes(title, body, [])).toBe(true);
  });
  it('lets through a word the person gave, and holds an ordinary sale notice', () => {
    expect(VexPushBundle.passes('School', 'Closed tomorrow', ['school'])).toBe(true);
    expect(VexPushBundle.passes('Big sale', '20% off shoes today', ['school'])).toBe(false);
  });
  it('escapes a given word so it cannot break the pattern', () => {
    expect(() => new RegExp(VexPushBundle.passSource(['a(b', '[x']), 'i')).not.toThrow();
  });
});

describe('the list of sites', () => {
  it('cleans a host, and refuses Discord, WhatsApp, banks and nonsense', () => {
    expect(VexPushBundle.cleanHost('https://www.Shop.example/orders')).toBe('shop.example');
    expect(() => VexPushBundle.cleanHost('discord.com')).toThrow(/Notifications from panels/);
    expect(() => VexPushBundle.cleanHost('web.whatsapp.com')).toThrow(/Notifications from panels/);
    expect(() => VexPushBundle.cleanHost('mybank.example')).toThrow(/bank/);
    expect(() => VexPushBundle.cleanHost('localhost')).toThrow(/site name/);
  });
  it('keeps each once and caps them', () => {
    VexPushBundle.addHost('shop.example');
    expect(() => VexPushBundle.addHost('shop.example')).toThrow(/already listed/);
    for (let i = 0; i < 29; i++) VexPushBundle.addHost('s' + i + '.example');
    expect(() => VexPushBundle.addHost('more.example')).toThrow(/At most 30/);
  });
});

describe('telling the pages', () => {
  it('sends the rules to a readable tab, and nothing to a private one or while it has never been on', () => {
    VexPushBundle.addHost('shop.example');
    wv.send.mockClear();
    expect(VexPushBundle.pushRules(wv)).toBe(true);
    expect(wv.send).toHaveBeenCalledWith('vex-push-rules', expect.objectContaining({ hosts: ['shop.example'] }));
    window.VexTabPolicy.canReadWebview = () => false;
    const priv = tab('https://shop.example/');
    expect(VexPushBundle.pushRules(priv)).toBe(false);
    expect(priv.send).not.toHaveBeenCalled();
    window.VexTabPolicy.canReadWebview = () => true;
    VexPushBundle.setEnabled(false);
    const fresh = tab('https://other.example/');
    expect(VexPushBundle.pushRules(fresh)).toBe(false);
  });
  it('tells a page that was told before when the feature is switched off, so it stops holding', () => {
    VexPushBundle.addHost('shop.example');
    VexPushBundle.pushRules(wv);
    VexPushBundle.setEnabled(false);
    wv.send.mockClear();
    expect(VexPushBundle.pushRules(wv)).toBe(true);
    expect(wv.send).toHaveBeenCalledWith('vex-push-rules', { hosts: [], pass: '' });
  });
});

describe('holding and showing', () => {
  beforeEach(() => { VexPushBundle.addHost('shop.example'); });
  it('keeps what a listed site sent, and ignores another site, a private tab and an empty one', () => {
    expect(VexPushBundle.fromTab(wv, { title: 'Order shipped', body: 'Arrives Friday' })).toMatchObject({ host: 'shop.example', title: 'Order shipped' });
    expect(VexPushBundle.fromTab(tab('https://news.example/'), { title: 'x', body: '' })).toBeNull();
    expect(VexPushBundle.fromTab(wv, { title: '', body: '' })).toBeNull();
    window.VexTabPolicy.canReadWebview = () => false;
    expect(VexPushBundle.fromTab(wv, { title: 'x', body: '' })).toBeNull();
    expect(VexPushBundle.list()).toHaveLength(1);
  });
  it('shows them together after an hour, once, and records it', () => {
    globalThis.VexLedger = { note: vi.fn() };
    VexPushBundle.fromTab(wv, { title: 'A', body: '' });
    VexPushBundle.fromTab(wv, { title: 'B', body: '' });
    expect(VexPushBundle.release()).toBeNull();                    // not yet an hour
    now += HOUR + 1;
    const text = VexPushBundle.release();
    expect(text).toBe('2 site notifications held for you: shop.example 2.');
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(VexPushBundle.release()).toBeNull();
    expect(VexPushBundle.list()).toHaveLength(0);
    expect(VexPushBundle.list({ unreleasedOnly: false })).toHaveLength(2);
    expect(globalThis.VexLedger.note).toHaveBeenCalledTimes(1);
  });
  it('waits through a quiet moment, but never longer than three hours', () => {
    globalThis.AttentionState = { get: () => ({ quiet: true }) };
    VexPushBundle.fromTab(wv, { title: 'A', body: '' });
    now += 2 * HOUR;
    expect(VexPushBundle.release()).toBeNull();
    now += 2 * HOUR;
    expect(VexPushBundle.release()).toMatch(/1 site notification held/);
  });
  it('leaves the timing to the delivery digest when that is on, and the digest then includes and releases them', () => {
    globalThis.VexPushBundle = VexPushBundle;
    AttentionDigest._now = () => now;
    AttentionDigest.setEnabled(true);
    now += 60000;
    VexPushBundle.fromTab(wv, { title: 'A', body: '' });
    now += 90 * 60000;
    expect(VexPushBundle.release()).toBeNull();
    expect(AttentionDigest.pending(0).push).toHaveLength(1);
    globalThis.VexAttention = { notify: (o, show) => show() };
    const text = AttentionDigest.release('now', now);
    expect(text).toMatch(/1 thing waited for you: 1 site notification/);
    expect(VexPushBundle.list()).toHaveLength(0);
  });
  it('forgets on request and bounds what it keeps', () => {
    for (let i = 0; i < 205; i++) VexPushBundle.fromTab(wv, { title: 't' + i, body: '' });
    expect(VexPushBundle.data().items).toHaveLength(200);
    VexPushBundle.forget();
    expect(VexPushBundle.data().items).toEqual([]);
  });
});
