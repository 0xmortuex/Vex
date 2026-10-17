// @vitest-environment jsdom
//
// T3-060, the missing parts: links collected from opted-in channels that are open, and
// "Save the file now" for a Discord attachment before it expires (after a confirm).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const path = require('path');
const fs = require('fs');
const JS = path.resolve(__dirname, '../../src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };

const G = '123456789012345678';
const C1 = '223456789012345678';
const C2 = '323456789012345678';
let LH, wv, evals;

function page(url, links) {
  return { url, title: 'general', getURL() { return this.url; }, getTitle() { return this.title; }, links };
}

beforeEach(() => {
  localStorage.clear();
  delete window.vex; delete window.VexTabPolicy;
  globalThis.CommsStore = fresh('comms-store.js').CommsStore;
  globalThis.LinkHarvester = window.LinkHarvester = LH = fresh('link-harvester.js').LinkHarvester;
  globalThis.vexGuestUrl = (w) => w.url;
  evals = [];
  window.vexGuestEval = vi.fn(async (w, code) => { evals.push(code); return w.result || { links: w.links }; });
  wv = page('https://discord.com/channels/' + G + '/' + C1, ['https://example.com/a', 'https://discord.com/channels/' + G + '/999999999999999999', 'https://cdn.discordapp.com/attachments/1/2/map.png?ex=7fffffff&is=1&hm=2']);
  globalThis.DiscordTheme = window.DiscordTheme = { pages: () => [wv] };
});

describe('opting a channel in', () => {
  it('is by the channel address, one at a time, with a limit', () => {
    expect(LH.channelKeyOf(wv.url)).toBe(G + '/' + C1);
    expect(LH.channelKeyOf('https://discord.com/channels/@me/' + C2)).toBe('@me/' + C2);
    expect(LH.channelKeyOf('https://discord.com/app')).toBe('');
    expect(() => LH.optIn('https://discord.com/app', 'x')).toThrow(/channel you want to collect from/);
    const c = LH.optIn(wv.url, 'general');
    expect(c).toMatchObject({ key: G + '/' + C1, label: 'general' });
    expect(() => LH.optIn(wv.url, 'again')).toThrow(/already opted in/);
    for (let i = 0; i < 19; i++) LH.optIn('https://discord.com/channels/' + G + '/4' + String(i).padStart(17, '0'), 'c' + i);
    expect(() => LH.optIn('https://discord.com/channels/' + G + '/599999999999999999', 'late')).toThrow(/At most 20/);
    expect(LH.optOut(c.key)).toBe(true);
    expect(LH.optOut(c.key)).toBe(false);
  });

  it('offers the channel that is open in a Discord page', () => {
    expect(LH.openChannel()).toEqual({ url: wv.url, label: 'general' });
    wv.url = 'https://discord.com/app';
    expect(LH.openChannel()).toBeNull();
  });
});

describe('collecting from opted-in channels that are open', () => {
  it('reads nothing when no channel is opted in, or when none of them is open', async () => {
    await expect(LH.harvestOpen()).rejects.toThrow(/No channel is opted in/);
    LH.optIn('https://discord.com/channels/' + G + '/' + C2, 'other');
    await expect(LH.harvestOpen()).rejects.toThrow(/None of the channels you opted in is open/);
    expect(window.vexGuestEval).not.toHaveBeenCalled();      // a channel not opted in is never read
  });

  it('reads the links on screen of the opted-in channel, folds in the attachment, skips links to Discord itself', async () => {
    LH.optIn(wv.url, 'general');
    const r = await LH.harvestOpen();
    expect(r).toEqual({ channels: 1, added: 2, seen: 0 });
    expect(window.vexGuestEval).toHaveBeenCalledTimes(1);
    const urls = LH.links().map(l => l.url);
    expect(urls.some(u => u.startsWith('https://example.com/a'))).toBe(true);
    expect(urls.some(u => u.includes('channels/' + G))).toBe(false);
    expect(LH.links().every(l => l.channel === 'general' && l.source === 'Discord')).toBe(true);
    const again = await LH.harvestOpen();
    expect(again).toEqual({ channels: 1, added: 0, seen: 2 });
  });

  it('the page script returns link addresses only: no message text, no clicking, no scrolling', () => {
    expect(LH.PAGE_SCRIPT).toMatch(/a\[href\]/);
    expect(LH.PAGE_SCRIPT).not.toMatch(/textContent|innerText|innerHTML|click\(|scroll|dispatchEvent|value/);
  });

  it('says so when the messages are not on screen yet, instead of collecting nothing quietly', async () => {
    LH.optIn(wv.url, 'general');
    wv.result = { error: 'no-messages' };
    await expect(LH.harvestOpen()).rejects.toThrow(/not on screen yet/);
  });

  it('is off with the switch, and keeps nothing in a private window', async () => {
    LH.optIn(wv.url, 'general');
    LH.setEnabled(false);
    await expect(LH.harvestOpen()).rejects.toThrow(/switched off/);
    LH.setEnabled(true);
    window.VexTabPolicy = { isPrivateWindow: true };
    await expect(LH.harvestOpen()).rejects.toThrow();
    expect(LH.links()).toEqual([]);
  });

  it('the module does not fetch anything or run its own timers; the only page read is the one script', () => {
    const src = fs.readFileSync(path.join(JS, 'link-harvester.js'), 'utf8');
    expect(src).not.toMatch(/executeJavaScript|\bfetch\(|XMLHttpRequest|setInterval|VexJobs/);
    expect(src.match(/vexGuestEval\(/g)).toHaveLength(1);
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
