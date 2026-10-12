// Audit B21 (2026-10-10): "Clear this site's data" always reported success,
// even when clearing failed or the address could not be read and nothing was
// cleared. The answer now says what failed (src/main/site-data.js), and the
// command says it to you.
import { describe, it, expect, vi } from 'vitest';
const fs = require('fs');
const path = require('path');
const { clearSiteData, STORAGES } = require('../../src/main/site-data.js');

function fakeSession({ storageFails, getFails, removeFails } = {}) {
  return {
    clearStorageData: vi.fn(async () => { if (storageFails) throw new Error(storageFails); }),
    cookies: {
      get: vi.fn(async () => { if (getFails) throw new Error(getFails); return [
        { name: 'sid', domain: '.example.com', path: '/', secure: true },
        { name: 'pref', domain: 'www.example.com', path: '/a', secure: false },
      ]; }),
      remove: vi.fn(async (url, name) => { if (removeFails && name === 'sid') throw new Error(removeFails); }),
    },
  };
}

describe('clearing a site\'s data', () => {
  it('clears the origin\'s storage and each cookie, and says ok', async () => {
    const ses = fakeSession();
    expect(await clearSiteData(ses, 'https://www.example.com/page?q=1')).toEqual({ ok: true, cookies: 2 });
    expect(ses.clearStorageData).toHaveBeenCalledWith({ origin: 'https://www.example.com', storages: STORAGES });
    expect(ses.cookies.remove).toHaveBeenCalledWith('https://example.com/', 'sid');
    expect(ses.cookies.remove).toHaveBeenCalledWith('http://www.example.com/a', 'pref');
  });

  it('an address it cannot read is a failure, and nothing is touched', async () => {
    for (const url of [undefined, '', 'not a url']) {
      const ses = fakeSession();
      const r = await clearSiteData(ses, url);
      expect(r).toEqual({ ok: false, error: 'The page\'s address could not be read, so nothing was cleared' });
      expect(ses.clearStorageData).not.toHaveBeenCalled();
    }
    const r = await clearSiteData(fakeSession(), 'file:///C:/x.html');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Only a website's data/);
  });

  it('says which part failed, and still clears the rest', async () => {
    let ses = fakeSession({ storageFails: 'disk busy' });
    let r = await clearSiteData(ses, 'https://example.com/');
    expect(r).toEqual({ ok: false, error: 'Not everything was cleared: its stored data (disk busy)' });
    expect(ses.cookies.remove).toHaveBeenCalledTimes(2);

    r = await clearSiteData(fakeSession({ getFails: 'session gone' }), 'https://example.com/');
    expect(r.error).toBe('Not everything was cleared: its cookies (session gone)');

    r = await clearSiteData(fakeSession({ removeFails: 'locked' }), 'https://example.com/');
    expect(r.error).toBe('Not everything was cleared: 1 of 2 cookies (locked)');
  });
});

describe('the handler and the command pass the failure on', () => {
  it('main.js answers with what the module found', () => {
    const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
    const h = MAIN.slice(MAIN.indexOf("ipcMain.handle('site:clear-data'"), MAIN.indexOf("ipcMain.handle('site:clear-data'") + 600);
    expect(h).toContain("await require('./main/site-data').clearSiteData(ses, url)");
    expect(h).not.toContain('return { ok: true }');
  });
});
