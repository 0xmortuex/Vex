// @vitest-environment jsdom
// T2-006: the strict study block with a cooldown (js/study-block.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
let S;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  ({ VexStudyBlock: S } = fresh(JS + 'study-block.js'));
  globalThis.VexStudyBlock = S;
});

describe('the allowlist', () => {
  it('cleans addresses to host names and refuses nonsense', () => {
    expect(S.cleanAllow('https://www.Wikipedia.org/wiki/X, khanacademy.org  khanacademy.org')).toEqual(['wikipedia.org', 'khanacademy.org']);
    expect(() => S.cleanAllow('not a site!')).toThrow(/not a site name/);
  });
  it('allows a listed site and its subdomains, Vex pages and files, and refuses others', () => {
    const allow = ['wikipedia.org'];
    expect(S.hostAllowed('https://en.wikipedia.org/wiki/A', allow)).toBe(true);
    expect(S.hostAllowed('https://notwikipedia.org/', allow)).toBe(false);
    expect(S.hostAllowed('https://youtube.com/', allow)).toBe(false);
    expect(S.hostAllowed('file:///C:/a.html', allow)).toBe(true);
    expect(S.hostAllowed('vex://settings', allow)).toBe(true);
  });
});

describe('the cooldown', () => {
  it('needs the wait and a reason, and then lets you go', () => {
    const t0 = 1_000_000;
    expect(S.leaveStatus(NaN, '', t0).ok).toBe(false);
    expect(S.leaveStatus(t0, 'short', t0 + 70_000)).toMatchObject({ ok: false });
    expect(S.leaveStatus(t0, 'I need the lecture video', t0 + 30_000)).toMatchObject({ ok: false, wait: 30 });
    expect(S.leaveStatus(t0, 'I need the lecture video', t0 + 60_000)).toMatchObject({ ok: true, wait: 0 });
  });
});

describe('a session', () => {
  it('starts, bounces a site off the list, and gives a pass after leaving', () => {
    S.start({ name: 'Calc', allow: ['wikipedia.org'], minutes: 30 });
    expect(S.active()).toBe(true);
    const wv = { canGoBack: () => true, goBack: vi.fn(), loadURL: vi.fn() };
    globalThis.VexSettingsGroups = { note: (t) => Object.assign(document.createElement('div'), { textContent: t }), button: (t, f) => { const b = document.createElement('button'); b.textContent = t; b.addEventListener('click', f); return b; } };
    expect(S.guard(wv, 'https://en.wikipedia.org/x')).toBe(false);
    expect(S.guard(wv, 'https://youtube.com/watch')).toBe(true);
    expect(wv.goBack).toHaveBeenCalled();
    expect(document.getElementById('vex-study-leave')).not.toBeNull();
    S.grantPass('youtube.com', 'a lecture is on it');
    expect(S.guard(wv, 'https://www.youtube.com/watch')).toBe(false);
    expect(S.log().map(e => e.kind)).toEqual(['started', 'left']);
  });
  it('is never a lock: the override ends it, and it ends by itself', () => {
    S.start({ name: 'x', allow: ['a.org'], minutes: 5 });
    expect(S.end('override')).toBe(true);
    expect(S.active()).toBe(false);
    S.start({ name: 'y', allow: ['a.org'], minutes: 5 });
    const raw = JSON.parse(localStorage.getItem('vex.studyBlock'));
    raw.session.until = Date.now() - 1;
    localStorage.setItem('vex.studyBlock', JSON.stringify(raw));
    expect(S.session()).toBeNull();
    expect(S.log().some(e => e.how === 'time')).toBe(true);
  });
  it('refuses a bad length, an empty list and a second session; off ends it', () => {
    expect(() => S.start({ name: 'x', allow: ['a.org'], minutes: 2 })).toThrow(/5 to/);
    expect(() => S.start({ name: 'x', allow: [], minutes: 30 })).toThrow(/at least one site/);
    S.start({ name: 'x', allow: ['a.org'], minutes: 30 });
    expect(() => S.start({ name: 'y', allow: ['a.org'], minutes: 30 })).toThrow(/already running/);
    S.setEnabled(false);
    expect(S.active()).toBe(false);
  });
  it('saves and removes lists', () => {
    S.savePreset('Calc', 'a.org b.org');
    expect(S.presets()).toEqual([{ name: 'Calc', allow: ['a.org', 'b.org'] }]);
    S.removePreset('calc');
    expect(S.presets()).toEqual([]);
  });
});
