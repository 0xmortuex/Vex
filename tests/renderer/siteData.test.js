// Cookies and storage for one site: reading them, describing them, and the
// two things that must not go wrong — a value that came back clipped being
// written back short, and a key with a quote in it breaking the script that
// writes it.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { SiteData } = require('../../src/renderer/js/site-data.js');

const T = { url: 'https://example.com/page', partition: 'persist:main', wv: {} };

beforeEach(() => {
  globalThis.window = {
    vex: {
      cookiesList: vi.fn(async () => ({ ok: true, cookies: [] })),
      cookiesRemove: vi.fn(async () => ({ ok: true })),
      cookiesSet: vi.fn(async () => ({ ok: true })),
    },
    vexGuestEval: vi.fn(async () => []),
  };
});

describe('reading', () => {
  it('a failed cookie read says why, rather than looking empty', async () => {
    window.vex.cookiesList.mockResolvedValue({ ok: false, error: 'No such session' });
    await expect(SiteData.cookies(T)).rejects.toThrow('No such session');
  });

  it('cookies and stored items come back sorted by name', async () => {
    window.vex.cookiesList.mockResolvedValue({ ok: true, cookies: [
      { name: 'session', value: 'b', domain: '.example.com', path: '/' },
      { name: 'consent', value: 'a', domain: 'example.com', path: '/' },
    ] });
    expect((await SiteData.read(T, 'cookies')).map(c => c.name)).toEqual(['consent', 'session']);
  });

  it('a page with storage switched off throws, and the error is the answer', async () => {
    window.vexGuestEval.mockRejectedValue(new Error('Access is denied for this document'));
    await expect(SiteData.read(T, 'local')).rejects.toThrow('Access is denied');
  });
});

describe('changing', () => {
  it('a cookie is removed by the four things that identify it', async () => {
    await SiteData.remove(T, 'cookies', { name: 'sid', domain: '.example.com', path: '/app', secure: true });
    expect(window.vex.cookiesRemove).toHaveBeenCalledWith(expect.objectContaining({
      url: T.url, partition: 'persist:main', name: 'sid', domain: '.example.com', path: '/app', secure: true,
    }));
  });

  it('a clipped value is never written back short', async () => {
    await expect(SiteData.write(T, 'local', { name: 'big', value: 'x', clipped: true }, 'x!')).rejects.toThrow(/too big/);
    expect(window.vexGuestEval).not.toHaveBeenCalled();
  });

  it('a key or value with quotes in it cannot break out of the script', () => {
    const script = SiteData.writeScript('local', 'a"b\'c', '");alert(1);//');
    expect(script).toContain(JSON.stringify('a"b\'c'));
    expect(script).toContain(JSON.stringify('");alert(1);//'));
    expect(() => new Function(script)).not.toThrow();
  });

  it('removing a stored item removes exactly that key', () => {
    expect(SiteData.writeScript('session', 'k', null)).toContain('sessionStorage.removeItem("k")');
  });
});

describe('what a row says', () => {
  const now = Date.UTC(2026, 8, 20);
  it('a cookie: where it applies and how long it lasts', () => {
    expect(SiteData.describe('cookies', { domain: '.example.com', path: '/', expires: null }, now)).toBe('.example.com · until Vex closes');
    expect(SiteData.describe('cookies', { domain: 'example.com', path: '/app', expires: now + 3 * 86400000 }, now)).toBe('example.com/app · expires in 3 days');
    expect(SiteData.describe('cookies', { domain: 'x.com', path: '/', expires: now - 86400000 }, now)).toContain('expired');
    expect(SiteData.describe('cookies', { domain: 'x.com', path: '/', expires: null, httpOnly: true }, now)).toContain('the page cannot read it');
  });

  it('a stored item: how big it is, and whether it can be edited here', () => {
    expect(SiteData.describe('local', { size: 1 })).toBe('1 character');
    expect(SiteData.describe('local', { size: 90000, clipped: true })).toContain('too big to edit here');
  });

  it('a long value is shortened for the row, not for the edit box', () => {
    expect(SiteData.clip('a'.repeat(200))).toHaveLength(64);
    expect(SiteData.clip('one\n  two')).toBe('one two');
  });
});
