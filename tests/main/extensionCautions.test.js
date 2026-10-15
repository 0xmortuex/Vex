// @vitest-environment node
//
// EX7: the install dialog's "what will not work" missed ~15 namespaces Vex
// does not have, said DNR rules were refused when they are accepted and block
// nothing, and the extension's card never said any of it after installing.
// EX8: plain webRequest made an extension "a blocker", with an 85 MB note
// that is wrong for a service worker.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const ws = req('../../src/main/webstore.js');
const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8').replace(/\r\n/g, '\n');
const SETTINGS = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/extensions-settings.js'), 'utf8').replace(/\r\n/g, '\n');

describe('install cautions', () => {
  it('names every namespace Vex does not have', () => {
    const c = ws.cautions({ manifest_version: 3, permissions: ['history', 'bookmarks', 'tabGroups', 'topSites', 'sessions', 'tts', 'fontSettings', 'privacy', 'proxy', 'browsingData', 'search', 'sidePanel'] }).join(' ');
    for (const n of ['history', 'bookmarks', 'tabGroups', 'topSites', 'sessions', 'tts', 'fontSettings', 'privacy', 'proxy', 'browsingData', 'search', 'sidePanel']) expect(c).toContain(`(${n})`);
  });
  it('says DNR rules are accepted and block nothing, and what partly works', () => {
    const c = ws.cautions({ manifest_version: 3, permissions: ['declarativeNetRequest', 'cookies', 'notifications', 'downloads'] }).join(' ');
    expect(c).toMatch(/applied by Vex, after its own ad blocker/);
    expect(c).toMatch(/not told when one changes/);
    expect(c).toMatch(/Windows notifications/);
    expect(c).toMatch(/cannot name the file, open it/);
  });
  it('plain webRequest is told it only hears finished requests, and is no blocker', () => {
    expect(ws.cautions({ manifest_version: 3, permissions: ['webRequest'] })).toEqual(['It is told only about finished requests (webRequest.onCompleted), not about requests as they start or their headers.']);
    expect(MAIN).toMatch(/some\(p => \/\^webRequestBlocking\/\.test\(String\(p\)\)\)/);
  });
  it('the card shows them, and the 85 MB note only for a background page that stays loaded', () => {
    expect(MAIN).toMatch(/cautions: e\.manifest \? require\('\.\/main\/webstore'\)\.cautions\(manifest\) : \[\]/);
    expect(SETTINGS).toMatch(/\$\{_cautionsHtml\(e\)\}/);
    expect(SETTINGS).toMatch(/\$\{e\.persistentBackground \? ' — and its background page stays loaded for that, about 85 MB' : ''\}/);
  });
});
