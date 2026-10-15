// @vitest-environment jsdom
//
// The rules the Vex agent task runner and the page recorder share
// (js/agent-safety.js): what is a secret, where the agent may not go, the
// budgets, the kill switch and which model is used.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { AgentSafety, AgentBudget } = require('../../src/renderer/js/agent-safety.js');

beforeEach(() => {
  localStorage.clear();
  delete window.VexTabPolicy;
  delete globalThis.Recall;
  AgentSafety._listeners.clear();
});

describe('sensitive fields', () => {
  const secret = [
    { type: 'password' },
    { type: 'text', autocomplete: 'cc-number' },
    { type: 'text', autocomplete: 'one-time-code' },
    { type: 'text', autocomplete: 'username' },
    { type: 'text', name: 'cvv' },
    { type: 'text', label: 'Card number' },
    { type: 'text', placeholder: 'Enter your PIN' },
    { type: 'text', id: 'otp-input' },
    { type: 'text', ariaLabel: 'Verification code' },
    { type: 'text', name: 'api_key' },
    { type: 'text', name: 'iban' },
  ];
  it.each(secret)('refuses %o', (d) => {
    expect(AgentSafety.isSensitiveField(d)).toBe(true);
    expect(AgentSafety.fieldRefusal(d, 'x')).toMatch(/never types or reads/);
  });
  it('lets ordinary fields through', () => {
    for (const d of [{ type: 'text', name: 'q', label: 'Search' }, { type: 'text', placeholder: 'Passenger name' }, { type: 'email', name: 'email' }, { type: 'text', name: 'bypass-note' }]) {
      expect(AgentSafety.isSensitiveField(d)).toBe(false);
    }
  });
  it('refuses a value that is a card number or a one-time code, in any field', () => {
    expect(AgentSafety.looksLikeSecretValue('4111 1111 1111 1111')).toBe(true);
    expect(AgentSafety.looksLikeSecretValue('4111-1111-1111-1111')).toBe(true);
    expect(AgentSafety.looksLikeSecretValue('123456')).toBe(true);
    expect(AgentSafety.looksLikeSecretValue('4111 1111 1111 1112')).toBe(false); // fails Luhn
    expect(AgentSafety.looksLikeSecretValue('best laptop 2026')).toBe(false);
    expect(AgentSafety.fieldRefusal({ type: 'text', name: 'q' }, '4111111111111111')).toMatch(/card number|one-time/);
  });
  it('redacts card numbers and codes out of anything that is logged', () => {
    expect(AgentSafety.redact('paid with 4111 1111 1111 1111 ok')).toBe('paid with [card number removed] ok');
    expect(AgentSafety.redact('your code is 482913')).toBe('your code is [removed]');
    expect(AgentSafety.redact('order 20260101')).toBe('order 20260101');
  });
});

describe('where the agent may not go', () => {
  it('no downloads or installs, no local network, no non-web schemes', () => {
    expect(AgentSafety.urlRefusal('https://x.example/setup.exe')).toMatch(/download/);
    expect(AgentSafety.urlRefusal('https://x.example/a.zip?dl=1')).toMatch(/download/);
    expect(AgentSafety.urlRefusal('https://x.example/report.pdf', { forNavigation: true })).toMatch(/download/);
    expect(AgentSafety.urlRefusal('https://x.example/report.pdf')).toBe('');           // read without opening
    expect(AgentSafety.urlRefusal('file:///C:/secret.txt')).toMatch(/http/);
    expect(AgentSafety.urlRefusal('http://192.168.1.1/')).toMatch(/local network|machine/);
    expect(AgentSafety.urlRefusal('https://user:pw@x.example/')).toMatch(/login/);
    expect(AgentSafety.urlRefusal('https://shop.example/laptops')).toBe('');
  });
  it('the exclude list wins', () => {
    globalThis.Recall = { isExcluded: (u) => /bank\.example/.test(u) };
    expect(AgentSafety.urlRefusal('https://bank.example/accounts')).toMatch(/exclude list/);
    expect(AgentSafety.urlRefusal('https://shop.example/')).toBe('');
  });
  it('never a private, Tor or routed tab, never a private window', () => {
    const wv = {};
    window.VexTabPolicy = { canReadWebview: () => false };
    expect(AgentSafety.tabRefusal(wv, 'https://shop.example/')).toMatch(/private, Tor or routed/);
    window.VexTabPolicy = { canReadWebview: () => true };
    expect(AgentSafety.tabRefusal(wv, 'https://shop.example/')).toBe('');
    expect(AgentSafety.tabRefusal(null, 'https://shop.example/')).toMatch(/no page/);
    window.VexTabPolicy = { canReadWebview: () => true, isPrivateWindow: true };
    expect(AgentSafety.tabRefusal(wv, 'https://shop.example/')).toMatch(/private window/);
    expect(AgentSafety.available()).toBe(false);
    expect(() => AgentSafety.setEnabled(true)).toThrow(/private window/);
  });
  it('a click that downloads, or submits a login or payment form, is refused', () => {
    expect(AgentSafety.clickRefusal({ href: 'https://x.example/a.msi' })).toMatch(/download/);
    expect(AgentSafety.clickRefusal({ download: true, href: 'https://x.example/r' })).toMatch(/download/);
    expect(AgentSafety.clickRefusal({ formHasSensitive: true })).toMatch(/password, payment/);
    expect(AgentSafety.clickRefusal({ tag: 'button', text: 'Next' })).toBe('');
  });
  it('names a form that would be posted to another origin', () => {
    expect(AgentSafety.crossOriginPost({ submits: true, formActionOrigin: 'https://pay.example', pageOrigin: 'https://shop.example' })).toBe('https://pay.example');
    expect(AgentSafety.crossOriginPost({ submits: true, formActionOrigin: 'https://shop.example', pageOrigin: 'https://shop.example' })).toBe('');
    expect(AgentSafety.crossOriginPost({ submits: false, formActionOrigin: 'https://pay.example', pageOrigin: 'https://shop.example' })).toBe('');
  });
});

describe('classification', () => {
  it('reads read, writes write, anything else is nothing', () => {
    for (const op of ['search', 'read_url', 'navigate', 'read_page', 'scroll', 'find', 'wait', 'summarize']) expect(AgentSafety.classifyOp(op)).toBe('read');
    for (const op of ['type', 'select', 'click']) expect(AgentSafety.classifyOp(op)).toBe('write');
    for (const op of ['download_file', 'sign_in', 'eval', 'press_key', '']) expect(AgentSafety.classifyOp(op)).toBe(null);
  });
});

describe('budgets', () => {
  it('stops at the step budget', () => {
    const b = new AgentBudget({ maxSteps: 2 });
    b.start();
    expect(b.check()).toBe('');
    b.consume(); b.consume();
    expect(b.check()).toMatch(/step budget of 2/);
  });
  it('stops at the time budget, and paused time does not count', () => {
    let t = 1000;
    const b = new AgentBudget({ maxSteps: 99, maxMs: 60000, now: () => t });
    b.start();
    t += 30000;
    expect(b.check()).toBe('');
    b.pause(); t += 3600000; b.resume();     // an hour waiting on a person
    expect(b.elapsed()).toBe(30000);
    t += 30000;
    expect(b.check()).toMatch(/time budget/);
  });
});

describe('off by default, kill switch, preferences', () => {
  it('is off until turned on', () => {
    expect(AgentSafety.enabled()).toBe(false);
    AgentSafety.setEnabled(true);
    expect(AgentSafety.enabled()).toBe(true);
  });
  it('the kill switch switches it off and tells every listener', () => {
    AgentSafety.setEnabled(true);
    const a = vi.fn(), b = vi.fn();
    AgentSafety.onKill(a); AgentSafety.onKill(b);
    AgentSafety.kill('test');
    expect(AgentSafety.enabled()).toBe(false);
    expect(a).toHaveBeenCalledWith('test');
    expect(b).toHaveBeenCalledWith('test');
  });
  it('one listener failing does not stop the others', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const b = vi.fn();
    AgentSafety.onKill(() => { throw new Error('boom'); });
    AgentSafety.onKill(b);
    AgentSafety.kill();
    expect(b).toHaveBeenCalled();
    err.mockRestore();
  });
  it('budgets default to 25 steps and are capped', () => {
    expect(AgentSafety.prefs()).toEqual({ maxSteps: 25, maxMinutes: 10, useCloud: false });
    AgentSafety.setPrefs({ maxSteps: 9999, maxMinutes: 500 });
    expect(AgentSafety.prefs().maxSteps).toBe(AgentSafety.MAX_STEPS_CAP);
    expect(AgentSafety.prefs().maxMinutes).toBe(AgentSafety.MAX_MINUTES_CAP);
  });
  it('uses the local model unless the backend is already cloud AND it was ticked', () => {
    expect(AgentSafety.chooseBackend({ useCloud: false }, { forceCloud: true })).toBe('local');
    expect(AgentSafety.chooseBackend({ useCloud: true }, { forceCloud: false })).toBe('local');
    expect(AgentSafety.chooseBackend({ useCloud: true }, { forceCloud: true })).toBe('cloud');
    expect(AgentSafety.chooseBackend({}, {})).toBe('local');
  });
});
