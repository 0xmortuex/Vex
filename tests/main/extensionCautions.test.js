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
    const c = ws.cautions({ manifest_version: 3, permissions: ['sessions', 'tts', 'fontSettings', 'privacy', 'proxy', 'browsingData', 'search', 'userScripts'] }).join(' ');
    for (const n of ['sessions', 'tts', 'fontSettings', 'privacy', 'proxy', 'browsingData', 'search', 'userScripts']) expect(c).toContain(`(${n})`);
  });
  it('does not say Vex lacks what it has built since: history/bookmarks/topSites are read-only, the rest work', () => {
    const c = ws.cautions({ manifest_version: 3, permissions: ['history', 'bookmarks', 'topSites', 'tabGroups', 'sidePanel', 'identity', 'debugger', 'nativeMessaging'] });
    const all = c.join(' ');
    for (const n of ['history', 'bookmarks', 'topSites', 'tabGroups', 'sidePanel', 'identity', 'debugger', 'nativeMessaging']) expect(all).not.toContain(`(${n})`);
    expect(all).toMatch(/read your history, bookmarks, most visited sites .* cannot add, change or delete any/);
    expect(all).toMatch(/only after you switch on "Allow it to control other tabs"/);
    expect(all).toMatch(/only after you switch on "Allow it to talk to programs/);
  });
  it('says DNR rules are accepted and block nothing, and what partly works', () => {
    const c = ws.cautions({ manifest_version: 3, permissions: ['declarativeNetRequest', 'cookies', 'notifications', 'downloads'] }).join(' ');
    expect(c).toMatch(/applied by Vex, after its own ad blocker/);
    expect(c).toMatch(/one cookie store/);
    expect(c).toMatch(/Windows notifications/);
    expect(c).toMatch(/cannot name the file, open it/);
  });
  it('plain webRequest is told it can only watch requests, and is no blocker', () => {
    expect(ws.cautions({ manifest_version: 3, permissions: ['webRequest'] })).toEqual(['It is told about requests (before they go, the headers sent and received, redirects, errors and finished ones) in normal tabs, but it can only watch: it cannot block or change one.']);
    expect(MAIN).toMatch(/some\(p => \/\^webRequestBlocking\/\.test\(String\(p\)\)\)/);
  });
  it('the card shows them, and the 85 MB note only for a background page that stays loaded', () => {
    expect(MAIN).toMatch(/cautions: e\.manifest \? require\('\.\/main\/webstore'\)\.cautions\(manifest\) : \[\]/);
    expect(SETTINGS).toMatch(/\$\{_cautionsHtml\(e\)\}/);
    expect(SETTINGS).toMatch(/\$\{e\.persistentBackground \? ' — and its background page stays loaded for that, about 85 MB' : ''\}/);
  });
});
