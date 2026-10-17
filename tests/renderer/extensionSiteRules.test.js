// @vitest-environment jsdom
//
// Wave 5, T3-120: a per-site rule on top of the pause switch, and the wider bank / mail suggestion.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const JS = '../../src/renderer/js/';
const { VexExtDiff: X } = require(JS + 'extension-diff.js');

const ext = (folder, over = {}) => ({ folder, name: folder, version: '1', enabled: true, loaded: true, audit: { reach: { level: 'all', hosts: [] }, powers: [] }, ...over });
let state, setEnabled;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(X.ENABLED_KEY, 'true');
  window.showToast = vi.fn();
  state = [ext('adblock'), ext('notes'), ext('coupons')];
  setEnabled = vi.fn(async (folder, on) => { const e = state.find(x => x.folder === folder); e.enabled = on; return { ok: true }; });
  window.vex = { extensionsList: vi.fn(async () => state.map(e => ({ ...e }))), extensionsSetEnabled: setEnabled };
  globalThis.VexLedger = { note: vi.fn() };
});
afterEach(() => { delete window.vex; delete globalThis.VexLedger; delete globalThis.VexSensitivity; delete globalThis.VexAttention; });

describe('a rule for a site', () => {
  it('keeps rules apart from the pause list and removes one with an empty list', () => {
    X.setRule('mybank.example', ['adblock', 'coupons']);
    expect(X.rules()).toEqual({ 'mybank.example': ['adblock', 'coupons'] });
    X.setRule('mybank.example', []);
    expect(X.rules()).toEqual({});
    expect(() => X.setRule('', ['a'])).toThrow(/needs a site/);
  });
  it('switches the ruled extensions off on that site, and back on when the tab leaves it', async () => {
    X.setRule('mybank.example', ['coupons']);
    const on = await X.applyRules({ url: 'https://www.mybank.example/login' });
    expect(on.paused).toEqual(['coupons']);
    expect(state.find(e => e.folder === 'coupons').enabled).toBe(false);
    expect(state.find(e => e.folder === 'adblock').enabled).toBe(true);
    expect(JSON.parse(localStorage.getItem(X.PAUSE_KEY))['mybank.example'].auto).toBe(true);
    const off = await X.applyRules({ url: 'https://news.example/' });
    expect(off.restored).toEqual(['mybank.example']);
    expect(state.find(e => e.folder === 'coupons').enabled).toBe(true);
    expect(JSON.parse(localStorage.getItem(X.PAUSE_KEY))).toEqual({});
  });
  it('applies by the rule host on a subdomain without switching twice', async () => {
    X.setRule('mybank.example', ['coupons']);
    await X.applyRules({ url: 'https://a.mybank.example/' });
    await X.applyRules({ url: 'https://mybank.example/x' });
    expect(setEnabled.mock.calls.filter(c => c[1] === false)).toHaveLength(1);
  });
  it('never puts back something the person paused by hand', async () => {
    await X.pause('manual.example', ['notes']);
    await X.applyRules({ url: 'https://other.example/' });
    expect(state.find(e => e.folder === 'notes').enabled).toBe(false);
    expect(Object.keys(JSON.parse(localStorage.getItem(X.PAUSE_KEY)))).toEqual(['manual.example']);
  });
  it('does nothing while the tools are switched off', async () => {
    X.setRule('mybank.example', ['coupons']);
    localStorage.setItem(X.ENABLED_KEY, 'false');
    expect(await X.applyRules({ url: 'https://mybank.example/' })).toEqual({ paused: [], restored: [] });
    expect(setEnabled).not.toHaveBeenCalled();
  });
  it('after a restart puts back what a rule had paused', async () => {
    X.setRule('mybank.example', ['coupons']);
    await X.applyRules({ url: 'https://mybank.example/' });
    await X.restoreStale();
    expect(state.find(e => e.folder === 'coupons').enabled).toBe(true);
  });
  it('writes a ledger line when a rule pauses something', async () => {
    X.setRule('mybank.example', ['coupons']);
    await X.applyRules({ url: 'https://mybank.example/' });
    expect(VexLedger.note).toHaveBeenCalledWith(expect.objectContaining({ feature: 'extension-diff', what: expect.stringMatching(/Paused 1 extension while you are on mybank.example/) }));
  });
});

describe('the suggestion on a bank or mail page', () => {
  it('knows the listed hosts, and the bank and mail words the AI gate uses', () => {
    expect(X.looksSensitive('mail.google.com')).toBe(true);
    expect(X.looksSensitive('news.example')).toBe(false);
    globalThis.VexSensitivity = { MAIL_HOSTS: /(^|\.)mail\.zoho\.com$/i, BANK_HEALTH_WORDS: /(^|[.-])(bank|banka)([.-]|$)/i };
    expect(X.looksSensitive('mail.zoho.com')).toBe(true);
    expect(X.looksSensitive('my-bank.example.org')).toBe(true);
    expect(X.looksSensitive('bankruptcy-law.example')).toBe(false);
  });
  it('offers one quiet card for such a page when an extension can read it', async () => {
    globalThis.VexSensitivity = { MAIL_HOSTS: /x^/, BANK_HEALTH_WORDS: /(^|[.-])bank([.-]|$)/i };
    const suggest = vi.fn(() => true);
    globalThis.VexAttention = { suggest };
    expect(await X.suggestFor({ url: 'https://my-bank.example.org/login' })).toBe(true);
    expect(suggest).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringMatching(/3 extensions can read my-bank.example.org/) }));
    expect(await X.suggestFor({ url: 'https://my-bank.example.org/again' })).toBe(false);
  });
});
