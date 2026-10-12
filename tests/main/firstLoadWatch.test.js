// @vitest-environment node
//
// EX3: a container's first tab stayed blank when an extension that watches
// or rules requests was installed: it was still being loaded into the new
// session as the page started, and the request never left. The page is asked
// for again once, when the extensions are in or after a few seconds.
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const { watchFirstLoad, interceptsRequests } = req('../../src/main/first-load-watch.js');
const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8').replace(/\r\n/g, '\n');

function page() {
  const c = new EventEmitter();
  c.url = ''; c.loading = true;
  c.getURL = () => c.url; c.isLoading = () => c.loading; c.isDestroyed = () => false;
  c.loadURL = vi.fn(() => Promise.resolve());
  return c;
}
const WR = [{ manifest: { permissions: ['webRequest'] } }];
const clock = () => { const t = []; return { setTimer: (fn, ms) => { t.push(fn); return t.length; }, clearTimer: () => {}, fire: () => t.splice(0).forEach(f => f()) }; };

describe('a tab\'s first page', () => {
  it('is asked for again as soon as the session\'s extensions are in, if it has not started', async () => {
    const c = page(); let exts = []; let cover; const covered = new Promise(r => { cover = r; });
    const k = clock();
    watchFirstLoad(c, { sessionExtensions: () => exts, covered, log: () => {}, ...k });
    c.emit('did-start-navigation', {}, 'http://site.test/a', false, true);
    exts = WR; cover(); await covered; await Promise.resolve();
    expect(c.loadURL).toHaveBeenCalledWith('http://site.test/a');
    k.fire();
    expect(c.loadURL).toHaveBeenCalledTimes(1);   // never twice
  });
  it('or after a few seconds', () => {
    const c = page(); const k = clock();
    watchFirstLoad(c, { sessionExtensions: () => WR, log: () => {}, ...k });
    c.emit('did-start-navigation', {}, 'https://site.test/', false, true);
    k.fire();
    expect(c.loadURL).toHaveBeenCalledWith('https://site.test/');
  });
  it('is left alone once it commits, without such an extension, or when it is not a web page', () => {
    for (const [exts, url, commit] of [[WR, 'https://a.test/', true], [[{ manifest: { permissions: ['storage'] } }], 'https://a.test/', false], [WR, 'file:///C:/start.html', false]]) {
      const c = page(); const k = clock();
      watchFirstLoad(c, { sessionExtensions: () => exts, log: () => {}, ...k });
      c.emit('did-start-navigation', {}, url, false, true);
      if (commit) { c.url = url; c.emit('did-navigate', {}, url); }
      k.fire();
      expect(c.loadURL).not.toHaveBeenCalled();
    }
  });
  it('knows which extensions watch requests', () => {
    expect(interceptsRequests([{ manifest: { permissions: ['declarativeNetRequest'] } }])).toBe(true);
    expect(interceptsRequests([{ manifest: { permissions: ['tabs'] } }])).toBe(false);
  });
  it('main watches every tab\'s page with its session\'s coverage', () => {
    expect(MAIN).toMatch(/const covered = _coverNewSession\(contents\.session\);/);
    expect(MAIN).toMatch(/watchFirstLoad\(contents, \{\n\s+covered,/);
  });
});
