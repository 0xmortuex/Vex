// @vitest-environment jsdom
//
// Wave 2 interface modules: incident playbooks (T2-090), the signed-in list helpers (T2-087/088),
// the password-field interlock (T2-089) and permission hygiene's pure parts (T2-084).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(JS + p)]; return require(JS + p); };

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  vi.resetModules();
  window.showToast = vi.fn();
});

describe('incident playbooks', () => {
  it('has ids that are unique, a button only where a real action exists, and never ticks by itself', () => {
    const { VexIncident: I } = fresh('incident-playbooks.js');
    for (const [name, pb] of Object.entries(I.PLAYBOOKS)) {
      const ids = pb.steps.map(s => s.id);
      expect(new Set(ids).size, name).toBe(ids.length);
      for (const s of pb.steps) expect(Boolean(s.run) !== Boolean(s.manual), name + ':' + s.id).toBe(true);
      expect(I.progress(name).done).toBe(0);
    }
  });
  it('keeps ticks per checklist and refuses an unknown step', () => {
    const { VexIncident: I } = fresh('incident-playbooks.js');
    I.setTick('clicked', 'stop', true);
    expect(I.progress('clicked')).toMatchObject({ done: 1 });
    expect(I.progress('hacked').done).toBe(0);
    expect(() => I.setTick('clicked', 'nope', true)).toThrow(/No step/);
    I.reset('clicked');
    expect(I.progress('clicked').done).toBe(0);
  });
  it('reports damaged saved ticks instead of starting over silently', () => {
    const { VexIncident: I } = fresh('incident-playbooks.js');
    localStorage.setItem(I.TICKS, '{oops');
    expect(() => I.ticked('clicked')).toThrow(/not readable/);
  });
  it('the downloads step shows names only and the scan result in words', async () => {
    const { VexIncident: I } = fresh('incident-playbooks.js');
    window.vex = { hygieneDownloadsScan: async () => ({ folder: 'C:\\dl', total: 5, recent: 2, days: 30, flagged: [{ name: 'a.pdf.exe', why: 'It looks like a document.', at: 0 }], more: 0 }) };
    const r = await I._run('downloads');
    expect(r.lines[0]).toMatch(/1 name stands out in C:\\dl/);
    expect(r.lines[1]).toMatch(/a\.pdf\.exe/);
    await expect(I._run('nope')).rejects.toThrow(/Unknown step action/);
  });
});

describe('signed-in helpers', () => {
  it('turns what is typed into a site name, and refuses what is not one', () => {
    const { VexSignedIn: S } = fresh('signed-in-ui.js');
    expect(S.siteOf('https://www.Discord.com/channels/@me')).toBe('discord.com');
    expect(S.siteOf(' roblox.com ')).toBe('roblox.com');
    expect(() => S.siteOf('')).toThrow(/Type a site/);
    expect(() => S.siteOf('localhost')).toThrow(/not a site/);
    expect(() => S.siteOf('203.0.113.9')).toThrow(/not a site/);
  });
  it('says when a sign-in ends', () => {
    const { VexSignedIn: S } = fresh('signed-in-ui.js');
    expect(S.endsText({ sessionOnly: true })).toBe('ends when Vex closes');
    expect(S.endsText({ sessionOnly: false, expires: 1000 + 10 * 86400000 }, 1000)).toBe('lasts about 10 more days');
  });
  it('opens only a secure address', () => {
    const { VexSignedIn: S } = fresh('signed-in-ui.js');
    expect(() => S._openTab('http://x.com')).toThrow(/secure/);
  });
});

describe('credential interlock', () => {
  const wv = (url) => ({ getURL: () => url, canGoBack: () => true, goBack: vi.fn() });
  it('asks nothing on a clean verdict', async () => {
    const { CredentialInterlock: C } = fresh('credential-interlock.js');
    window.vex = { credguardCheck: vi.fn(async () => ({ verdict: 'ok' })) };
    globalThis.vexConfirm = vi.fn();
    expect(await C.onFocus(wv('https://www.roblox.com/login'), { host: 'roblox.com' })).toBe(false);
    expect(globalThis.vexConfirm).not.toHaveBeenCalled();
  });
  it('asks with the lookalike\'s name, leaves on OK, and remembers Continue anyway for that tab', async () => {
    const { CredentialInterlock: C } = fresh('credential-interlock.js');
    const verdict = { verdict: 'warn', host: 'paypa1.com', resembles: 'paypal.com', line: 'It is made to read as paypal.com.' };
    window.vex = { credguardCheck: vi.fn(async () => verdict) };
    const tab = wv('https://paypa1.com/signin');
    globalThis.vexConfirm = vi.fn(async () => true);
    await C.onFocus(tab, { host: 'paypa1.com' });
    expect(globalThis.vexConfirm.mock.calls[0][0]).toMatchObject({ title: 'This is not paypal.com', okLabel: 'Leave this page', cancelLabel: 'Continue anyway' });
    expect(globalThis.vexConfirm.mock.calls[0][0].danger).toBeUndefined();
    expect(tab.goBack).toHaveBeenCalled();
    globalThis.vexConfirm = vi.fn(async () => false);
    await C.onFocus(tab, { host: 'paypa1.com' });
    await C.onFocus(tab, { host: 'paypa1.com' });
    expect(globalThis.vexConfirm).toHaveBeenCalledTimes(1);
  });
  it('trusts the tab\'s own address, not the page\'s word for it', async () => {
    const { CredentialInterlock: C } = fresh('credential-interlock.js');
    window.vex = { credguardCheck: vi.fn() };
    expect(await C.onFocus(wv('https://evil.example/'), { host: 'roblox.com' })).toBe(false);
    expect(window.vex.credguardCheck).not.toHaveBeenCalled();
  });
  it('does nothing when switched off', async () => {
    const { CredentialInterlock: C } = fresh('credential-interlock.js');
    C.setEnabled(false);
    expect(await C.onFocus(wv('https://paypa1.com/'), { host: 'paypa1.com' })).toBe(false);
  });
});

describe('permission hygiene (interface)', () => {
  it('words the end of a grant and decides when the weekly line is due', () => {
    const { VexPermHygiene: P } = fresh('permission-hygiene-ui.js');
    expect(P.whenText(null)).toBe('until you change it');
    expect(P.whenText(1000 + 3 * 86400000, 1000)).toBe('ends in 3 days');
    expect(P.whenText(1000, 2000)).toBe('ends today');
    expect(P.weeklyDue(NaN)).toBe(true);
    expect(P.weeklyDue(1000, 1000 + 6 * 86400000)).toBe(false);
    expect(P.weeklyDue(1000, 1000 + 7 * 86400000)).toBe(true);
    expect(P.partsText(['camera', 'microphone'])).toBe('camera and microphone');
  });
  it('keeps its settings, and says when the saved copy is damaged', () => {
    const { VexPermHygiene: P } = fresh('permission-hygiene-ui.js');
    expect(P.config()).toMatchObject({ expiryDays: 30, trapGuard: true });
    localStorage.setItem(P.CFG, '{bad');
    expect(() => P.config()).toThrow(/not readable/);
  });
  it('pushes to main only when something changed', async () => {
    const { VexPermHygiene: P } = fresh('permission-hygiene-ui.js');
    window.vex = { hygienePermConfig: vi.fn(async (c) => c) };
    await P.sync(); await P.sync();
    expect(window.vex.hygienePermConfig).toHaveBeenCalledTimes(1);
    await P.setConfig({ expiryDays: 7 });
    expect(window.vex.hygienePermConfig).toHaveBeenCalledTimes(2);
    expect(window.vex.hygienePermConfig.mock.calls[1][0]).toMatchObject({ enabled: true, expiryDays: 7 });
  });
});
