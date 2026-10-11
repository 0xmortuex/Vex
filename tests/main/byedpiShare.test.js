// @vitest-environment node
//
// Roblox and Discord share ONE ByeDPI process. Each start() replaces it on a
// fresh port; each stop() ends it. Before this, each caller only re-pointed its
// own session — so running Discord's auto-configure sweep while the Roblox
// bypass was on left Roblox aimed at a port that no longer existed, and Roblox
// simply stopped connecting with nothing said.
//
// Whether a desync actually defeats a given ISP's inspection can only be judged
// on a connection that is really being blocked. This is the other half — who is
// using the shared process and where it went — and that is where the bug was.

import { describe, it, expect, vi } from 'vitest';
const { createByedpiShare } = require('../../src/main/byedpi-share.js');

function harness(opts = {}) {
  let port = opts.startPort || 1080;
  let running = !!opts.running;
  const byedpi = {
    isRunning: () => running,
    getPort: () => port,
    start: vi.fn(async () => { running = true; port += 1; return port; }),
    stop: vi.fn(() => { running = false; }),
  };
  const proxySet = [];
  const told = [];
  const share = createByedpiShare({
    byedpi,
    setRobloxProxy: (v) => proxySet.push(v),
    notify: (m) => told.push(m),
  });
  return { share, byedpi, proxySet, told, currentPort: () => port };
}

describe('when only Discord is using it', () => {
  it('starting and stopping never touches Roblox', async () => {
    const { share, proxySet, told } = harness();
    await share.start('ud', null, 0);
    share.stop();
    expect(proxySet).toEqual([]);
    expect(told).toEqual([]);
  });
});

describe('when Roblox is riding the shared process', () => {
  it('re-points Roblox every time the process restarts on a new port', async () => {
    const { share, proxySet } = harness();
    share.attachRoblox(true);

    const first = await share.start('ud', null, 0);
    const second = await share.start('ud', null, 1);     // Discord sweeping presets
    const third = await share.start('ud', null, 2);

    expect(new Set([first, second, third]).size).toBe(3);   // a new port each time
    expect(proxySet).toEqual([
      'socks5://127.0.0.1:' + first,
      'socks5://127.0.0.1:' + second,
      'socks5://127.0.0.1:' + third,
    ]);
  });

  // The bug: Discord's sweep ends with a stop(), and Roblox was left pointing
  // at the dead port, failing every request in silence.
  it('takes Roblox off a port that no longer exists, and says so', async () => {
    const { share, proxySet, told } = harness();
    share.attachRoblox(true);
    await share.start('ud', null, 0);
    proxySet.length = 0;

    share.stop();

    expect(proxySet).toEqual([null]);            // proxy cleared, not left dangling
    expect(told[0]).toMatch(/Roblox bypass is off/i);
    expect(share.isRobloxAttached()).toBe(false);
  });

  it('a second stop does not repeat itself', async () => {
    const { share, told } = harness();
    share.attachRoblox(true);
    await share.start('ud', null, 0);
    share.stop();
    share.stop();
    expect(told).toHaveLength(1);
  });

  it('stops following the process once Roblox has been switched off', async () => {
    const { share, proxySet } = harness();
    share.attachRoblox(true);
    await share.start('ud', null, 0);
    share.attachRoblox(false);
    proxySet.length = 0;

    await share.start('ud', null, 1);
    expect(proxySet).toEqual([]);
  });
});

describe('reusing a process that is already up', () => {
  it('joins the running one rather than restarting what Discord is using', () => {
    const { share, byedpi, proxySet } = harness({ running: true, startPort: 9050 });
    const port = share.reuseExisting();
    expect(port).toBe(9050);
    expect(byedpi.start).not.toHaveBeenCalled();
    expect(proxySet).toEqual(['socks5://127.0.0.1:9050']);
    expect(share.isRobloxAttached()).toBe(true);
  });

  it('reports nothing to join when it is not running', () => {
    const { share, proxySet } = harness({ running: false });
    expect(share.reuseExisting()).toBeNull();
    expect(proxySet).toEqual([]);
    expect(share.isRobloxAttached()).toBe(false);
  });
});

describe('construction', () => {
  it('refuses to be built without the process it manages', () => {
    expect(() => createByedpiShare({})).toThrow(/needs the byedpi module/);
  });

  it('works without a proxy setter or notifier rather than throwing', async () => {
    const { byedpi } = harness();
    const bare = createByedpiShare({ byedpi });
    bare.attachRoblox(true);
    await expect(bare.start('ud', null, 0)).resolves.toBeTypeOf('number');
    expect(() => bare.stop()).not.toThrow();
  });
});

// Turning Discord's bypass off (or to light) used to stop the shared process
// for Roblox too, while Roblox's menu still said "On".
describe('Discord letting go while Roblox rides the shared process', () => {
  it('keeps the process and Roblox on its bypass', async () => {
    const { share, byedpi, proxySet, told } = harness();
    share.attachRoblox(true);
    await share.start('ud', null, 0);
    const before = proxySet.length;
    expect(share.releaseDiscord()).toBe(false);
    expect(byedpi.stop).not.toHaveBeenCalled();
    expect(share.isRobloxAttached()).toBe(true);
    expect(proxySet.length).toBe(before);
    expect(told).toEqual([]);
  });

  it('stops it when Discord was the only one using it', async () => {
    const { share, byedpi } = harness();
    await share.start('ud', null, 0);
    expect(share.releaseDiscord()).toBe(true);
    expect(byedpi.stop).toHaveBeenCalledTimes(1);
  });

  it('main.js lets Discord go through releaseDiscord, never a bare stop', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require('path').join(__dirname, '../../src/main.js'), 'utf8');
    const start = src.indexOf('async function _applyDiscordBypass(');
    const end = src.indexOf('// Start the built-in JS proxy', start);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).not.toMatch(/_share\.stop\(|_byedpi\.stop\(/);
    expect(src).toMatch(/const _byedpiStop = \(\) => _share\.releaseDiscord\(\);/);
  });
});
