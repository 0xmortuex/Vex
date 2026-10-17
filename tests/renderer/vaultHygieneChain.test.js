// @vitest-environment jsdom
//
// Wave 5, T3-088: the recovery-email chain check and the weekly safety roll-up.
// Findings only: no test here ever gives the module a password.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const { VexVaultHygiene: V } = require('../../src/renderer/js/vault-hygiene.js');

const health = (over = {}) => ({ total: 6, reused: [], weak: [], old: [], ages: [], ...over });
const logins = [
  { host: 'accounts.google.com', username: 'me@gmail.com' },
  { host: 'shop.example', username: 'me@gmail.com' },
  { host: 'bank.example', username: 'me@gmail.com' },
  { host: 'forum.example', username: 'me@gmail.com' },
  { host: 'work.example', username: 'me@mycompany.org' },
  { host: 'other.example', username: 'plainname' },
];

beforeEach(() => { localStorage.clear(); });
afterEach(() => { delete window.vex; delete globalThis.VexAttention; });

describe('the recovery-email chain', () => {
  it('finds the mailbox that other accounts open with and checks its own login', () => {
    const v = V.build({ health: health(), logins, totp: [] });
    const g = v.emailChain.find(m => m.mailbox === 'me@gmail.com');
    expect(g).toMatchObject({ dependents: 3, risk: 'high' });
    expect(g.own).toEqual({ host: 'accounts.google.com', username: 'me@gmail.com' });
    expect(g.problems).toContain('it has no authenticator entry in Vex');
    expect(g.hosts.sort()).toEqual(['bank.example', 'forum.example', 'shop.example']);
  });
  it('says the mailbox is fine when its own login is strong, unique and has 2FA', () => {
    const v = V.build({ health: health(), logins, totp: [{ issuer: 'Google' }] });
    expect(v.emailChain.find(m => m.mailbox === 'me@gmail.com').risk).toBe('ok');
  });
  it('flags a weak or reused mailbox login and names why', () => {
    const v = V.build({ health: health({ weak: [{ host: 'accounts.google.com', username: 'me@gmail.com', reasons: ['short'] }],
      reused: [{ count: 2, entries: [{ host: 'accounts.google.com', username: 'me@gmail.com' }, { host: 'shop.example', username: 'me@gmail.com' }] }] }), logins, totp: [{ issuer: 'Google' }] });
    const g = v.emailChain.find(m => m.mailbox === 'me@gmail.com');
    expect(g.problems).toEqual(expect.arrayContaining(['its password is weak', 'its password is also used on other sites']));
  });
  it('reports a mailbox whose own login is not saved as unknown, never as fine', () => {
    const g = V.build({ health: health(), logins, totp: [] }).emailChain.find(m => m.mailbox === 'me@mycompany.org');
    expect(g).toBeUndefined();
    const more = [...logins, { host: 'a.example', username: 'me@mycompany.org' }];
    const u = V.build({ health: health(), logins: more, totp: [] }).emailChain.find(m => m.mailbox === 'me@mycompany.org');
    expect(u).toMatchObject({ risk: 'unknown', own: null, dependents: 2 });
  });
  it('puts a weak recovery mailbox at the top of "rotate this week"', () => {
    const v = V.build({ health: health(), logins, totp: [] });
    expect(v.rotate[0].host).toBe('accounts.google.com');
    expect(v.rotate[0].reasons.join(' ')).toMatch(/recovers 3 other accounts/);
  });
});

describe('the weekly roll-up', () => {
  function bridge(over = {}) {
    window.vex = {
      vaultHealth: vi.fn(async () => health()),
      vaultList: vi.fn(async () => logins),
      totpList: vi.fn(async () => []),
      hygienePermSummary: vi.fn(async () => ({ soon: [{ origin: 'meet.example' }], lines: [] })),
      hygieneDownloadsScan: vi.fn(async () => ({ total: 40, recent: 5, days: 30, flagged: [{ kind: 'disguised', name: 'invoice.pdf.exe' }, { kind: 'program', name: 'setup.exe' }] })),
      ...over,
    };
  }
  it('rolls the vault, permissions and downloads into one list', async () => {
    bridge();
    const r = await V.rollup(new Date(2026, 9, 17));
    const text = r.items.map(i => i.area + ': ' + i.text).join('\n');
    expect(text).toMatch(/Passwords: 1 worth changing/);
    expect(text).toMatch(/Recovery email: me@gmail.com recovers 3 other sites/);
    expect(text).toMatch(/Permissions: 1 site permission ends within 3 days: meet.example/);
    expect(text).toMatch(/Downloads: 1 file has a name that hides a program/);
    expect(text).toMatch(/35 files older than 30 days/);
    expect(r.week).toBe(V.weekId(new Date(2026, 9, 17)));
  });
  it('says so, in the area itself, when one part cannot be read', async () => {
    bridge({ hygienePermSummary: vi.fn(async () => { throw new Error('Vex is locked'); }) });
    const r = await V.rollup();
    expect(r.items.find(i => i.area === 'Permissions')).toMatchObject({ level: 'note', text: 'Could not be checked: Vex is locked' });
  });
  it('offers one quiet card per week, only when something wants attention, and only when switched on', async () => {
    bridge();
    const suggest = vi.fn(() => true);
    globalThis.VexAttention = { suggest };
    const monday = new Date(2026, 9, 12);
    expect(await V.maybeRollup(monday)).toBe(true);
    expect(suggest).toHaveBeenCalledWith(expect.objectContaining({ feature: 'vault-hygiene', action: { label: 'Open', key: 'rollup' } }));
    expect(await V.maybeRollup(new Date(2026, 9, 14))).toBe(false);
    expect(suggest).toHaveBeenCalledTimes(1);
    V.setRollupEnabled(false);
    expect(await V.maybeRollup(new Date(2026, 9, 21))).toBe(false);
  });
  it('stays quiet when everything is fine', async () => {
    bridge({ vaultList: vi.fn(async () => []), hygienePermSummary: vi.fn(async () => ({ soon: [], lines: [] })), hygieneDownloadsScan: vi.fn(async () => ({ total: 3, recent: 3, days: 30, flagged: [] })) });
    const suggest = vi.fn();
    globalThis.VexAttention = { suggest };
    expect(await V.maybeRollup(new Date(2026, 9, 12))).toBe(false);
    expect(suggest).not.toHaveBeenCalled();
  });
});
