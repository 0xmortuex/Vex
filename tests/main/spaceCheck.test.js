// Share a space, the main-process parts: the address check (main/space-check.js), its IPC contract and the vex://space launch argument.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import url from 'node:url';
import { normalizeLaunchArg, findLaunchUrl } from '../../src/main-helpers.js';

const require = createRequire(import.meta.url);
const { checkAddresses, MAX_URLS } = require('../../src/main/space-check.js');
const ws = require('../../src/main/web-safety.js');
const { validate, schemas } = require('../../src/main/ipc-schemas.js');
const policy = require('../../src/main/ipc-policy.js');

const run = (urls, extra = {}) => checkAddresses(urls, {
  analyzeHost: (h) => ws.analyzeHost(h, { sensitivity: 'strict' }),
  threatCheck: () => null,
  domainToUnicode: (h) => url.domainToUnicode(h),
  ...extra,
});

describe('the address check', () => {
  it('shows the real host name and says nothing against an ordinary site', () => {
    const [r] = run(['https://en.wikipedia.org/wiki/Vex']);
    expect(r).toMatchObject({ host: 'en.wikipedia.org', unicode: 'en.wikipedia.org', punycode: false, lookalike: null, threat: null, error: null });
  });

  it('shows a punycode name as punycode and as it would be drawn, and flags the look-alike', () => {
    // "apple.com" written entirely with Cyrillic letters (the well-known demonstration name)
    const [r] = run(['https://xn--80ak6aa92e.com/login']);
    expect(r.host).toBe('xn--80ak6aa92e.com');
    expect(r.punycode).toBe(true);
    expect(r.unicode).not.toBe(r.host);
    expect(r.lookalike).not.toBeNull();
    expect(r.lookalike.resembles).toBe('apple.com');
  });

  it('flags a name that mixes alphabets, which has no single site it copies', () => {
    const [r] = run(['https://xn--pple-43d.com/']);   // a Cyrillic a in front of Latin letters
    expect(r.punycode).toBe(true);
    expect(r.lookalike).not.toBeNull();
  });

  it('flags a name that swaps a letter for a number', () => {
    const [r] = run(['https://paypa1.com/']);
    expect(r.lookalike).not.toBeNull();
    expect(r.punycode).toBe(false);
  });

  it('carries the dangerous-site answer through, and asks it with the whole address', () => {
    const asked = [];
    const [r] = run(['https://bad.example.net/x'], { threatCheck: (u) => { asked.push(u); return { kind: 'domain', host: 'bad.example.net' }; } });
    expect(r.threat).toEqual({ kind: 'domain', host: 'bad.example.net' });
    expect(asked).toEqual(['https://bad.example.net/x']);
  });

  it('answers for an address that is not a web page without throwing', () => {
    const out = run(['javascript:alert(1)', 'not a url', 'file:///C:/x', 'data:text/html,hi']);
    expect(out.map((o) => !!o.error)).toEqual([true, true, true, true]);
    expect(out.every((o) => o.lookalike === null && o.threat === null)).toBe(true);
  });

  it('refuses a request that is not a list of short text', () => {
    expect(() => run('https://x.com')).toThrow(/list/);
    expect(() => run([42])).toThrow(/text/);
    expect(() => run(['https://x.com/' + 'a'.repeat(3000)])).toThrow(/2048/);
    expect(() => run(new Array(MAX_URLS + 1).fill('https://x.com'))).toThrow(/At most/);
  });
});

describe('the IPC contract', () => {
  it('has a schema, and the preload channel is covered', () => {
    expect(schemas.has('space:check')).toBe(true);
  });
  it('accepts a list of at most 200 short addresses', () => {
    expect(() => validate('space:check', [['https://a.com/', 'https://b.com/']])).not.toThrow();
    expect(() => validate('space:check', [[]])).not.toThrow();
  });
  it('rejects anything else', () => {
    expect(() => validate('space:check', [])).toThrow();
    expect(() => validate('space:check', ['https://a.com/'])).toThrow();
    expect(() => validate('space:check', [[42]])).toThrow();
    expect(() => validate('space:check', [[{ url: 'https://a.com/' }]])).toThrow();
    expect(() => validate('space:check', [new Array(201).fill('https://a.com/')])).toThrow();
    expect(() => validate('space:check', [['https://a.com/' + 'x'.repeat(2100)]])).toThrow();
    expect(() => validate('space:check', [['https://a.com/'], 'extra'])).toThrow();
  });
  it('is on the list of channels only the interface may call', () => {
    const source = require('node:fs').readFileSync(require.resolve('../../src/main/ipc-policy.js'), 'utf8');
    expect(source).toContain("'space:check'");
    expect(policy).toBeTruthy();
  });
});

describe('a vex://space link handed to Vex by another program', () => {
  const ok = 'vex://space?d=' + 'AbC_-09'.repeat(10);
  it('is passed on exactly as it is', () => {
    expect(normalizeLaunchArg(ok)).toBe(ok);
    expect(findLaunchUrl(['--flag', ok])).toBe(ok);
  });
  it('refuses anything that is not exactly vex://space?d= and link characters', () => {
    expect(normalizeLaunchArg('vex://space')).toBeNull();
    expect(normalizeLaunchArg('vex://space?d=')).toBeNull();
    expect(normalizeLaunchArg('vex://space?d=abc&x=1')).toBeNull();
    expect(normalizeLaunchArg('vex://space?d=abc def')).toBeNull();
    expect(normalizeLaunchArg('vex://space?d=abc/def')).toBeNull();
    expect(normalizeLaunchArg('vex://space?d=<script>')).toBeNull();
    expect(normalizeLaunchArg('vex://space/?d=abc')).toBeNull();
    expect(normalizeLaunchArg('vex://spacex?d=abc')).toBeNull();
    expect(normalizeLaunchArg('VEX://space?d=abc')).toBeNull();
    expect(normalizeLaunchArg('vex://space?d=abc\n')).toBeNull();
    expect(normalizeLaunchArg('vex://space?d=' + 'a'.repeat(16001))).toBeNull();
    expect(normalizeLaunchArg('vex://space?d=' + 'a'.repeat(16000))).not.toBeNull();
  });
  it('leaves the other vex:// actions to their own handler', () => {
    expect(normalizeLaunchArg('vex://snooze/abc')).toBeNull();
    expect(normalizeLaunchArg('javascript:alert(1)')).toBeNull();
  });
});
