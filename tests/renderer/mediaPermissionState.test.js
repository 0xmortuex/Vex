// @vitest-environment jsdom
// A never-asked microphone/camera read 'denied' to navigator.permissions.query,
// so WhatsApp's panel showed its own "Allow microphone - click the icon next to
// the address bar" box instead of asking. _letSitesAsk now corrects them too,
// for tabs and for sidebar panels.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

require('../../src/renderer/js/vex-utils.js');
const { WebviewManager } = require('../../src/renderer/js/webview.js');

const O = 'https://web.whatsapp.com';

function page(decisions) {
  window.SiteRulesUI = undefined;
  window.vex = { permissionsListForPage: vi.fn(async () => decisions) };
  return { getURL: () => O + '/', getWebContentsId: () => 7, executeJavaScript: vi.fn(async () => true) };
}
// The states the injected script was given for microphone and camera.
function mediaStates(wv) {
  const m = /const M = (\{.*\});/.exec(wv.executeJavaScript.mock.calls[0][0]);
  return JSON.parse(m[1]);
}

describe('microphone and camera state', () => {
  beforeEach(() => { delete window.__vexPermAsk; });

  for (const name of ['microphone', 'camera']) {
    it(`${name}: never asked reads prompt, saved allow granted, saved block denied`, async () => {
      expect(WebviewManager.permissionStateFor({}, O, name)).toBe('prompt');
      expect(WebviewManager.permissionStateFor({ [O + '::' + name]: 'allow' }, O, name)).toBe('granted');
      expect(WebviewManager.permissionStateFor({ [O + '::' + name]: 'deny' }, O, name)).toBe('denied');
      for (const [saved, want] of [[undefined, 'prompt'], ['allow', 'granted'], ['deny', 'denied']]) {
        const wv = page(saved ? { [O + '::' + name]: saved } : {});
        expect(await WebviewManager._letSitesAsk(wv)).toBe(true);
        expect(mediaStates(wv)[name]).toBe(want);
      }
    });
  }

  it('an answer saved before the split, under ::media, counts for both', () => {
    expect(WebviewManager.permissionStateFor({ [O + '::media']: 'allow' }, O, 'microphone')).toBe('granted');
    expect(WebviewManager.permissionStateFor({ [O + '::media']: 'deny' }, O, 'camera')).toBe('denied');
  });

  it('a panel gets the media states and nothing else', async () => {
    const wv = page({});
    expect(await WebviewManager._letSitesAsk(wv, { mediaOnly: true })).toBe(true);
    const code = wv.executeJavaScript.mock.calls[0][0];
    expect(mediaStates(wv)).toEqual({ microphone: 'prompt', camera: 'prompt' });
    expect(code).toContain('const S = {};');
  });

  it('a tab keeps notifications and location as before', async () => {
    const wv = page({});
    await WebviewManager._letSitesAsk(wv);
    const code = wv.executeJavaScript.mock.calls[0][0];
    expect(code).toContain('"notifications":"prompt"');
    expect(code).toContain('"geolocation":"prompt"');
  });

  it('the injected query only replaces a Chromium answer of denied', async () => {
    const wv = page({});
    await WebviewManager._letSitesAsk(wv, { mediaOnly: true });
    const code = wv.executeJavaScript.mock.calls[0][0];
    const native = vi.fn(async (d) => ({ state: d.name === 'camera' ? 'granted' : 'denied', name: d.name }));
    const win = { navigator: { permissions: { query: native } } };
    new Function('window', 'navigator', 'return ' + code.trim())(win, win.navigator);
    expect((await win.navigator.permissions.query({ name: 'microphone' })).state).toBe('prompt');
    expect((await win.navigator.permissions.query({ name: 'camera' })).state).toBe('granted');
    expect((await win.navigator.permissions.query({ name: 'notifications' })).state).toBe('denied');
  });

  it('a panel webview is wired to _letSitesAsk with mediaOnly on did-finish-load', () => {
    const src = fs.readFileSync(path.resolve('src/renderer/js/sidebar.js'), 'utf8');
    const create = src.slice(src.indexOf('_createPanelWebview(panelName, panelEl) {'));
    expect(create).toMatch(/addEventListener\('did-finish-load',[\s\S]{0,400}_letSitesAsk\(wv, \{ mediaOnly: true \}\)/);
  });
});
