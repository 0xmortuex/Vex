// T0-016: "Why was I signed out?" - which rule ended a sign-in, from cookie
// metadata only. Nothing is cleared, no value is ever kept.
import { describe, it, expect } from 'vitest';

const { createSignoutWhy, looksLikeSignIn, VEX_ACTIONS } = require('../../src/main/signout-why.js');

function make(startAt = Date.parse('2026-10-16T10:00:00Z')) {
  let t = startAt;
  const disk = {};
  const store = { read: async (k) => (k in disk ? JSON.parse(JSON.stringify(disk[k])) : null), write: async (k, v) => { disk[k] = JSON.parse(JSON.stringify(v)); return true; } };
  const sw = createSignoutWhy({ store, now: () => t });
  return { sw, disk, advance: (ms) => { t += ms; }, now: () => t };
}
const cookie = (over) => ({ name: 'session-id', domain: '.amazon.com.tr', session: false, expirationDate: Date.parse('2027-01-01T00:00:00Z') / 1000, value: 'SECRET-VALUE', ...over });

describe('which cookies count as a sign-in', () => {
  it('keeps session and auth cookies, leaves trackers and tokens against forgery out', () => {
    expect(looksLikeSignIn({ name: 'session-id' })).toBe(true);
    expect(looksLikeSignIn({ name: '__Secure-next-auth.session-token' })).toBe(true);
    expect(looksLikeSignIn({ name: '_ga' })).toBe(false);
    expect(looksLikeSignIn({ name: 'csrf_token' })).toBe(false);
    expect(looksLikeSignIn({ name: 'cookie_consent' })).toBe(false);
    expect(looksLikeSignIn({ name: 'theme' })).toBe(false);
  });
});

describe('cookies removed while Vex runs', () => {
  it('a removal after Clear browsing data is attributed to it, with where to change it', async () => {
    const { sw } = make();
    sw.noteAction('clear-all');
    await sw.onCookieChanged('persist:main', cookie(), 'explicit', true);
    const r = await sw.explain('www.amazon.com.tr');
    expect(r.lines[0].cause).toBe('vex-cleared-all');
    expect(r.lines[0].where).toMatch(/Clear browsing data/);
    expect(r.lines[0].line).toMatch(/Clear browsing data/);
  });
  it('an action limited to one site does not claim another site\'s loss', async () => {
    const { sw } = make();
    sw.noteAction('clear-site', ['discord.com']);
    await sw.onCookieChanged('persist:main', cookie(), 'explicit', true);
    expect((await sw.explain('amazon.com.tr')).lines[0].cause).toBe('site-removed');
  });
  it('the action stops counting after 30 seconds', async () => {
    const { sw, advance } = make();
    sw.noteAction('clear-all');
    advance(31000);
    await sw.onCookieChanged('persist:main', cookie(), 'explicit', true);
    expect((await sw.explain('amazon.com.tr')).lines[0].cause).toBe('site-removed');
  });
  it('an expiry is the site\'s own rule, an eviction is Chromium\'s', async () => {
    const { sw } = make();
    await sw.onCookieChanged('persist:main', cookie({ domain: 'discord.com', name: 'token' }), 'expired', true);
    await sw.onCookieChanged('persist:main', cookie({ domain: 'github.com', name: 'user_session' }), 'evicted', true);
    expect((await sw.explain('discord.com')).lines[0].line).toMatch(/expiry date the site gave/);
    expect((await sw.explain('github.com')).lines[0].line).toMatch(/limit on cookies per site/);
  });
  it('an overwrite, a set and a non-sign-in cookie are not losses', async () => {
    const { sw } = make();
    expect(await sw.onCookieChanged('p', cookie(), 'overwrite', true)).toBe(false);
    expect(await sw.onCookieChanged('p', cookie(), 'explicit', false)).toBe(false);
    expect(await sw.onCookieChanged('p', cookie({ name: '_ga' }), 'explicit', true)).toBe(false);
    expect((await sw.explain(null)).lines).toEqual([]);
  });
  it('refuses an action it does not know', () => {
    const { sw } = make();
    expect(() => sw.noteAction('wipe-everything')).toThrow(/Not a known clearing action/);
    expect(Object.keys(VEX_ACTIONS).length).toBe(5);
  });
});

describe('sign-ins lost while Vex was closed', () => {
  const run = async (before, after, gapMs) => {
    const { sw, disk, advance } = make();
    await sw.snapshot('persist:main', before);
    await sw.flush();
    advance(gapMs);
    // A new run: same disk, new object.
    const again = createSignoutWhy({ store: { read: async (k) => JSON.parse(JSON.stringify(disk[k])), write: async (k, v) => { disk[k] = v; return true; } }, now: () => Date.parse('2026-10-16T10:00:00Z') + gapMs });
    const found = await again.compareAtStart('persist:main', after);
    return { again, found, disk };
  };

  it('a session cookie (no expiry) that is gone: the site meant it to end with the browser', async () => {
    const { again, found } = await run([cookie({ session: true, expirationDate: undefined })], [], 3600000);
    expect(found).toBe(1);
    const r = await again.explain('amazon.com.tr');
    expect(r.lines[0].cause).toBe('ended-with-vex');
    expect(r.lines[0].line).toMatch(/no expiry date/);
  });
  it('a cookie whose date passed while Vex was closed expired', async () => {
    const soon = Date.parse('2026-10-16T10:30:00Z') / 1000;
    const { again } = await run([cookie({ expirationDate: soon })], [], 3 * 3600000);
    expect((await again.explain('amazon.com.tr')).lines[0].cause).toBe('expired-while-closed');
  });
  it('a still-valid cookie that is gone is said to be unexplained, not blamed on anything', async () => {
    const { again } = await run([cookie()], [], 3600000);
    const l = (await again.explain('amazon.com.tr')).lines[0];
    expect(l.cause).toBe('gone-while-closed');
    expect(l.line).toMatch(/cannot tell/);
  });
  it('a cookie that is still there is not a loss', async () => {
    const { found } = await run([cookie()], [cookie()], 3600000);
    expect(found).toBe(0);
  });
});

describe('what is kept', () => {
  it('names, session flag and dates only: never a value, an address or the full domain list of the page', async () => {
    const { sw, disk } = make();
    await sw.snapshot('persist:main', [cookie()]);
    await sw.onCookieChanged('persist:main', cookie({ domain: 'discord.com', name: 'token' }), 'expired', true);
    await sw.flush();
    const text = JSON.stringify(disk['signout-why']);
    expect(text).not.toContain('SECRET-VALUE');
    expect(text).not.toMatch(/https?:/);
    expect(text).toContain('amazon.com.tr');
  });
  it('is bounded: only 12 names per site and 200 events', async () => {
    const { sw, disk } = make();
    const many = Array.from({ length: 30 }, (_, i) => cookie({ name: 'session-' + i }));
    await sw.snapshot('persist:main', many);
    for (let i = 0; i < 450; i++) await sw.onCookieChanged('p', cookie({ name: 'auth-' + i }), 'expired', true);
    await sw.flush();
    expect(disk['signout-why'].snapshots['persist:main'].sites['amazon.com.tr'].length).toBe(12);
    expect(disk['signout-why'].events.length).toBeLessThanOrEqual(200);
  });
  it('the report answers for the registrable domain whatever host was asked', async () => {
    const { sw } = make();
    await sw.onCookieChanged('p', cookie(), 'expired', true);
    expect((await sw.explain('smile.www.amazon.com.tr')).lines.length).toBe(1);
  });
});
