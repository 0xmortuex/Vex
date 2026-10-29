// A blocked Google tag script leaves the page an inert dataLayer and gtag (src/main/analytics-stub.js), 2026-10-29.
// Found on https://app.3daimtrainer.com/quick-play: the blocked gtag script left window.dataLayer undefined, the site's click handler threw on
// dataLayer.push, and no game could be picked. Defining dataLayer by hand made the same click work. (A redirect of the script to a data: address is
// refused by Chromium, net::ERR_UNSAFE_REDIRECT, so the stand-in is run in the page instead.)
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { isTagScript, provide, STUB_SOURCE } = createRequire(import.meta.url)('../../src/main/analytics-stub.js');
const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8').replace(/\r\n/g, '\n');

describe('which blocked requests get the stand-in', () => {
  it('Google Tag Manager, gtag.js and Analytics scripts, and only scripts', () => {
    for (const url of ['https://www.googletagmanager.com/gtag/js?id=G-ABC123', 'https://www.googletagmanager.com/gtm.js?id=GTM-XXXX', 'https://googletagmanager.com/gtm.js', 'https://www.google-analytics.com/analytics.js', 'https://ssl.google-analytics.com/ga.js']) {
      expect(isTagScript({ url, resourceType: 'script' })).toBe(true);
    }
    expect(isTagScript({ url: 'https://www.googletagmanager.com/gtag/js?id=G-1', resourceType: 'xhr' })).toBe(false);
    expect(isTagScript({ url: 'https://www.google-analytics.com/g/collect?v=2', resourceType: 'ping' })).toBe(false);
  });
  it('every other address is left to the blocker alone', () => {
    for (const url of ['https://doubleclick.net/x.js', 'https://www.googletagmanager.com/ns.html?id=GTM-1', 'https://evil.example/gtm.js', 'https://www.googletagmanager.com.evil.example/gtm.js', 'http://www.googletagmanager.com/gtm.js']) {
      expect(isTagScript({ url, resourceType: 'script' })).toBe(false);
    }
    expect(isTagScript(null)).toBe(false);
    expect(isTagScript({ url: 5, resourceType: 'script' })).toBe(false);
  });
});

describe('the stand-in script', () => {
  it('makes dataLayer, gtag and ga exist and push into dataLayer, and fetches nothing', () => {
    const win = {};
    win.window = win;
    vm.runInContext(STUB_SOURCE, vm.createContext(win));
    expect(Array.isArray(win.dataLayer)).toBe(true);
    win.gtag('event', 'click');
    expect(win.dataLayer.length).toBe(1);
    expect(() => win.ga('send', 'pageview')).not.toThrow();
    expect(() => win.dataLayer.push({ event: 'pick_game' })).not.toThrow();
    expect(STUB_SOURCE).not.toMatch(/fetch|XMLHttpRequest|sendBeacon|Image\(|createElement|https?:/);
  });
  it('keeps what the page already made', () => {
    const win = { dataLayer: [{ early: 1 }] };
    win.window = win;
    vm.runInContext(STUB_SOURCE, vm.createContext(win));
    expect(win.dataLayer).toEqual([{ early: 1 }]);
  });
});

describe('giving it to the page', () => {
  const tag = { url: 'https://www.googletagmanager.com/gtag/js?id=G-1', resourceType: 'script', webContentsId: 7 };
  it('runs in the frame that asked, when there is one', () => {
    const frame = { executeJavaScript: vi.fn(async () => {}) };
    const contentsOf = vi.fn();
    expect(provide({ ...tag, frame }, contentsOf)).toBe(true);
    expect(frame.executeJavaScript).toHaveBeenCalledWith(STUB_SOURCE);
    expect(contentsOf).not.toHaveBeenCalled();
  });
  it('else in the page by its id; a page that is gone is not an error', () => {
    const page = { isDestroyed: () => false, executeJavaScript: vi.fn(async () => {}) };
    expect(provide(tag, (id) => (id === 7 ? page : null))).toBe(true);
    expect(page.executeJavaScript).toHaveBeenCalledWith(STUB_SOURCE);
    expect(provide(tag, () => null)).toBe(false);
    expect(provide(tag, () => ({ isDestroyed: () => true, executeJavaScript: vi.fn() }))).toBe(false);
  });
  it('a script that cannot run, or a request that is not a tag script, changes nothing and raises nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = { isDestroyed: () => false, executeJavaScript: vi.fn(async () => { throw new Error('frame gone'); }) };
    expect(provide(tag, () => bad)).toBe(true);
    await new Promise(r => setTimeout(r, 0));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    const never = vi.fn();
    expect(provide({ url: 'https://doubleclick.net/x.js', resourceType: 'script', webContentsId: 7 }, never)).toBe(false);
    expect(never).not.toHaveBeenCalled();
  });
});

describe('the blocker uses it', () => {
  it('a blocked request still gets cancelled, after the page was given the stand-in', () => {
    expect(MAIN).toMatch(/_analyticsStub\.provide\(details, \(id\) => webContents\.fromId\(id\)\);\n\s+callback\(\{ cancel: true \}\);/);
  });
});
