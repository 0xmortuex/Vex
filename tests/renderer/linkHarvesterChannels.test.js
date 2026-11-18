// @vitest-environment jsdom
//
// T3-060: "Save the file now" for a Discord attachment before it expires (after a confirm), and that the
// link collector never reads a page. Reading the links on screen in a Discord channel you had opted in is gone:
// Discord is a plain page in Vex.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const path = require('path');
const fs = require('fs');
const JS = path.resolve(__dirname, '../../src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };

let LH;

beforeEach(() => {
  localStorage.clear();
  delete window.vex; delete window.VexTabPolicy;
  globalThis.CommsStore = fresh('comms-store.js').CommsStore;
  globalThis.LinkHarvester = window.LinkHarvester = LH = fresh('link-harvester.js').LinkHarvester;
});

describe('the collector never reads a page', () => {
  it('has no opted-in channels, no page script and runs nothing in a page', () => {
    for (const gone of ['optIn', 'optOut', 'channels', 'openChannel', 'harvestOpen', 'PAGE_SCRIPT', '_pages']) expect(LH[gone]).toBeUndefined();
    const src = fs.readFileSync(path.join(JS, 'link-harvester.js'), 'utf8');
    expect(src).not.toMatch(/vexGuestEval|executeJavaScript|insertCSS|querySelector/);
    expect(src).not.toMatch(/\bfetch\(|setInterval\(/);
  });
});

describe('saving the file before it expires', () => {
  const FUTURE = Math.floor(Date.now() / 1000) + 3 * 3600;
  const url = (ex) => 'https://cdn.discordapp.com/attachments/1/2/build.zip?ex=' + ex.toString(16) + '&is=1&hm=2';
  let id;

  beforeEach(() => {
    LH.collect(url(FUTURE) + ' https://example.com/page', { source: 'Pasted', channel: 'x' });
    id = LH.links().find(l => l.url.includes('build.zip')).id;
    window.vex = { downloadsRetry: vi.fn(async () => ({ ok: true })) };
    window.vexConfirm = vi.fn(async () => true);
  });

  it('asks first, naming the file, then starts one ordinary download and marks the link', async () => {
    expect(await LH.saveFile(id)).toBe(true);
    expect(window.vexConfirm.mock.calls[0][0].message).toContain('build.zip');
    expect(window.vexConfirm.mock.calls[0][0].message).toContain('stops working');
    expect(window.vex.downloadsRetry).toHaveBeenCalledWith(expect.stringContaining('build.zip'));
    expect(LH.links().find(l => l.id === id).fileSaved).toBe(true);
  });

  it('downloads nothing on a no', async () => {
    window.vexConfirm = vi.fn(async () => false);
    expect(await LH.saveFile(id)).toBe(false);
    expect(window.vex.downloadsRetry).not.toHaveBeenCalled();
  });

  it('refuses a link without an expiry, an expired one, and says when the download did not start', async () => {
    const plain = LH.links().find(l => l.url.startsWith('https://example.com')).id;
    await expect(LH.saveFile(plain)).rejects.toThrow(/Only a Discord attachment/);
    const old = LH.state(); old.links.find(l => l.id === id).expiresAt = Date.now() - 1000; LH._save(old);
    await expect(LH.saveFile(id)).rejects.toThrow(/expired/);
    const fresh1 = LH.state(); fresh1.links.find(l => l.id === id).expiresAt = Date.now() + 3600000; LH._save(fresh1);
    window.vex.downloadsRetry = vi.fn(async () => ({ ok: false, error: 'blocked by the download rules' }));
    await expect(LH.saveFile(id)).rejects.toThrow(/blocked by the download rules/);
    expect(LH.links().find(l => l.id === id).fileSaved).toBeUndefined();
    await expect(LH.saveFile('nope')).rejects.toThrow(/gone/);
  });
});
