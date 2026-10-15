// The pure state layer of "one browser across devices" (js/live-session.js):
// clocks that survive a wrong wall clock, what may leave a device, the
// size-capped snapshot with tombstones, and the Devices view model.
import { describe, it, expect } from 'vitest';

const L = require('../../src/renderer/js/live-session.js');
const T0 = Date.parse('2026-10-01T12:00:00Z');
const NODE = 'a'.repeat(32);
const tab = (n, extra = {}) => ({ id: 't' + n, url: 'https://site' + n + '.test/page', title: 'Page ' + n, ...extra });
const build = (tabs, ctx = {}) => L.buildSnapshot(tabs, { now: T0, node: NODE, ...ctx });

describe('hybrid logical clock', () => {
  it('ticks forward even when the wall clock stands still or goes back', () => {
    let c = L.hlcTick('', T0, NODE);
    const same = L.hlcTick(c, T0, NODE);
    const back = L.hlcTick(same, T0 - 60000, NODE);
    expect(L.hlcCompare(same, c)).toBe(1);
    expect(L.hlcCompare(back, same)).toBe(1);
    expect(L.hlcParse(back).wall).toBe(T0);
  });

  it('sorts as plain strings', () => {
    const a = L.hlcFormat(T0, 9, NODE), b = L.hlcFormat(T0, 10, NODE), c = L.hlcFormat(T0 + 1, 0, NODE);
    expect([c, a, b].sort()).toEqual([a, b, c]);
  });

  it('believes a remote clock at most an hour ahead of its own', () => {
    const remote = L.hlcFormat(Date.parse('2099-01-01T00:00:00Z'), 0, 'b');
    const merged = L.hlcReceive(L.hlcFormat(T0, 0, NODE), remote, T0, NODE);
    expect(L.hlcParse(merged).wall).toBeLessThanOrEqual(T0 + L.LIMITS.MAX_DRIFT_MS);
    // A device whose clock is 30 minutes behind still orders after what it has seen.
    const seen = L.hlcFormat(T0, 3, NODE);
    const behind = L.hlcReceive(L.hlcFormat(T0 - 1800000, 0, 'c'), seen, T0 - 1800000, 'c');
    expect(L.hlcCompare(behind, seen)).toBe(1);
  });

  it('treats a malformed clock as the lowest', () => {
    expect(L.hlcCompare('nonsense', L.hlcFormat(1, 0, NODE))).toBe(-1);
  });
});

describe('what never leaves the device', () => {
  const ok = url => L.shareableTab({ url, partition: 'persist:main' });
  it('lets ordinary web pages through', () => {
    expect(ok('https://news.example.org/a?page=2')).toBe(true);
    expect(L.shareableTab({ url: 'http://example.com/' })).toBe(true);
  });
  it('refuses private, off-the-record, Tor and routed tabs, and private windows', () => {
    const url = 'https://news.example.org/';
    expect(L.shareableTab({ url, partition: 'otr-1' })).toBe(false);
    expect(L.shareableTab({ url, partition: 'tor-3' })).toBe(false);
    expect(L.shareableTab({ url, partition: 'persist:route-abc' })).toBe(false);
    expect(L.shareableTab({ url, partition: 'persist:container-tor-1' })).toBe(false);
    expect(L.shareableTab({ url, partition: 'persist:container-work' }, { isRouted: p => p === 'persist:container-work' })).toBe(false);
    expect(L.shareableTab({ url, ownSession: true })).toBe(false);
    expect(L.shareableTab({ url }, { privateWindow: true })).toBe(false);
  });
  it('refuses sensitive hosts, secrets in the address and local addresses', () => {
    for (const url of [
      'https://www.paypal.com/myaccount', 'https://secure.mybank.bank/login', 'https://vault.bitwarden.com/', 'https://mail.google.com/mail/u/0',
      'https://accounts.google.com/signin', 'https://www.irs.gov/', 'https://x.test/cb?code=abc', 'https://x.test/?access_token=1',
      'https://user:pw@x.test/', 'http://localhost:3000/', 'http://192.168.1.2/admin', 'http://nas/', 'https://printer.local/',
      'file:///C:/a.txt', 'javascript:alert(1)', 'https://x.test/' + 'a'.repeat(3000),
    ]) expect(L.shareableTab({ url }), url).toBe(false);
  });
  it('honours the hosts the person lists', () => {
    expect(L.shareableTab({ url: 'https://wiki.corp-example.com/a' }, { extraHosts: ['corp-example.com'] })).toBe(false);
    expect(L.shareableTab({ url: 'https://wiki.other.com/a' }, { extraHosts: ['corp-example.com'] })).toBe(true);
  });
});

describe('device snapshot', () => {
  it('keeps what a reader needs and leaves tombstones for closed tabs', () => {
    const first = build([tab(1, { pinned: true, favicon: 'https://site1.test/f.ico', scrollPosition: { x: 0, y: 1234 } }), tab(2)], { activeId: 't1', groupName: () => 'Work' });
    expect(first.v).toBe(2);
    expect(first.tabs[0]).toMatchObject({ id: 't1', url: 'https://site1.test/page', title: 'Page 1', p: 1, fav: 'https://site1.test/f.ico', s: 1000 });
    expect(first.active).toBe('t1');
    const second = L.buildSnapshot([tab(1, { pinned: true })], { prev: first, now: T0 + 1000, node: NODE });
    expect(second.tabs.map(t => t.id)).toEqual(['t1']);
    expect(second.closed.map(t => t.id)).toEqual(['t2']);
    // A version 1 reader still finds url and title on every entry.
    expect(second.tabs.every(t => typeof t.url === 'string' && typeof t.title === 'string')).toBe(true);
  });

  it('is byte-for-byte the same when nothing changed, so an idle device never looks edited', () => {
    const a = build([tab(1), tab(2)], { activeId: 't1' });
    const b = L.buildSnapshot([tab(1), tab(2)], { prev: a, now: T0 + 5 * 60000, node: NODE, activeId: 't1' });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    // Scrolling a little is not a change either.
    const c = L.buildSnapshot([tab(1, { scrollPosition: { y: 90 } }), tab(2)], { prev: a, now: T0 + 6 * 60000, node: NODE, activeId: 't1' });
    expect(JSON.stringify(c)).toBe(JSON.stringify(a));
  });

  it('drops tombstones after a week and caps them at 50', () => {
    const many = Array.from({ length: 70 }, (_, i) => tab(i));
    const open = build(many.slice(0, 60));
    const closed = L.buildSnapshot([], { prev: open, now: T0 + 1000, node: NODE });
    expect(closed.closed.length).toBe(50);
    const later = L.buildSnapshot([], { prev: closed, now: T0 + 8 * 86400000, node: NODE });
    expect(later.closed).toEqual([]);
  });

  it('stays under the size cap, shedding icons and titles before tabs, pinned tabs last', () => {
    const big = Array.from({ length: 100 }, (_, i) => tab(i, { title: 'T'.repeat(300), favicon: 'https://site' + i + '.test/' + 'f'.repeat(300), pinned: i === 0 }));
    const snap = build(big, { maxBytes: 8000 });
    expect(JSON.stringify(snap).length).toBeLessThanOrEqual(8000);
    expect(snap.cut).toBeGreaterThan(0);
    expect(snap.tabs.some(t => t.id === 't0')).toBe(true);
    const full = build(big);
    expect(JSON.stringify(full).length).toBeLessThanOrEqual(L.LIMITS.MAX_BYTES);
    expect(full.tabs.length).toBeLessThanOrEqual(100);
  });

  it('reads version 1 values and refuses what another device should not have sent', () => {
    const parsed = L.parseSnapshot({ tabs: [{ url: 'https://ok.test/', title: 'OK' }, { url: 'https://mail.google.com/', title: 'Mail' }, { url: 'javascript:1' }, null] });
    expect(parsed.v).toBe(1);
    expect(parsed.tabs.map(t => t.url)).toEqual(['https://ok.test/']);
    expect(L.parseSnapshot('junk').tabs).toEqual([]);
  });
});

describe('merging two copies of one device', () => {
  const a = L.buildSnapshot([tab(1), tab(2)], { now: T0, node: NODE });
  const b = L.buildSnapshot([tab(1, { title: 'Renamed' }), tab(3)], { prev: a, now: T0 + 1000, node: NODE });
  const norm = x => JSON.stringify(L.mergeSnapshots(x, {}, T0 + 2000));
  it('is commutative and idempotent', () => {
    expect(JSON.stringify(L.mergeSnapshots(a, b, T0 + 2000))).toBe(JSON.stringify(L.mergeSnapshots(b, a, T0 + 2000)));
    const m = L.mergeSnapshots(a, b, T0 + 2000);
    expect(JSON.stringify(L.mergeSnapshots(m, m, T0 + 2000))).toBe(JSON.stringify(m));
    expect(norm(b)).toBe(JSON.stringify(L.mergeSnapshots(b, b, T0 + 2000)));
  });
  it('lets the newer change win per tab, and a newer tombstone remove a tab', () => {
    const m = L.mergeSnapshots(a, b, T0 + 2000);
    expect(m.tabs.find(t => t.id === 't1').title).toBe('Renamed');
    expect(m.tabs.some(t => t.id === 't2')).toBe(false);          // b closed it
    expect(m.closed.some(t => t.id === 't2')).toBe(true);
    expect(m.tabs.some(t => t.id === 't3')).toBe(true);
  });
  it('lets a tab opened again after its tombstone stand', () => {
    const reopened = L.buildSnapshot([tab(1), tab(2, { title: 'Back' }), tab(3)], { prev: b, now: T0 + 5000, node: NODE });
    const m = L.mergeSnapshots(b, reopened, T0 + 6000);
    expect(m.tabs.some(t => t.id === 't2')).toBe(true);
    expect(m.closed.some(t => t.id === 't2')).toBe(false);
  });
});

describe('Devices view', () => {
  const now = T0 + 3600000;
  const mine = 'a'.repeat(32), laptop = 'b'.repeat(32), phone = 'c'.repeat(32), gone = 'd'.repeat(32);
  const snaps = {
    [mine]: build([tab(1)], { now: now - 20 * 60000 }),
    [laptop]: build([tab(2), tab(3)], { now: now - 5 * 60000, activeId: 't2' }),
    [phone]: { tabs: [{ url: 'https://phone.test/', title: 'From phone' }] },
    [gone]: build([tab(9)], { now }),
  };
  const listed = [
    { deviceId: mine, deviceName: 'Desk', lastSeenAt: new Date(now).toISOString() },
    { deviceId: laptop, deviceName: 'Laptop', lastSeenAt: new Date(now - 4 * 60000).toISOString() },
    { deviceId: phone, deviceName: 'Pixel 9', lastSeenAt: new Date(now - 30 * 86400000).toISOString() },
  ];
  const view = L.devicesView({ listed, snapshots: snaps, names: {}, selfId: mine, now });

  it('lists the account\'s devices, this one first, then by last use; removed devices are not shown', () => {
    expect(view.map(d => d.name)).toEqual(['Desk', 'Laptop', 'Pixel 9']);
    expect(view.find(d => d.deviceId === gone)).toBeUndefined();
    expect(view[0].self).toBe(true);
  });
  it('knows a phone, a stale device and a version 1 list', () => {
    const p = view.find(d => d.deviceId === phone);
    expect(p.kind).toBe('phone');
    expect(p.stale).toBe(true);
    expect(p.tabs[0]).toMatchObject({ url: 'https://phone.test/', title: 'From phone' });
  });
  it('trusts the server clock over a device clock that is wrong', () => {
    const skewed = { ...snaps[laptop], seen: now + 9 * 3600000, la: now + 9 * 3600000 };
    const v = L.devicesView({ listed, snapshots: { ...snaps, [laptop]: skewed }, names: {}, selfId: mine, now });
    const d = v.find(x => x.deviceId === laptop);
    expect(d.lastSeen).toBe(now - 4 * 60000);
    expect(d.lastActive).toBeLessThanOrEqual(now);
  });
  it('offers to continue where you left off only when this device was idle and another was used since', () => {
    const idle = L.continueWhereLeftOff(view, { now, selfLastActive: now - 20 * 60000 });
    expect(idle.device.name).toBe('Laptop');
    expect(idle.tabs[0].active).toBe(true);
    expect(L.continueWhereLeftOff(view, { now, selfLastActive: now - 60000 })).toBeNull();     // not idle
    expect(L.continueWhereLeftOff(view, { now, selfLastActive: now })).toBeNull();             // nothing newer
    expect(L.continueWhereLeftOff(view, { now: now + 8 * 86400000, selfLastActive: 1 })).toBeNull(); // too old
  });
});

describe('reading queue', () => {
  it('keeps own-session and sensitive items on the device and gives them back after a pull', () => {
    const list = [
      { id: 'rl1', url: 'https://blog.test/a', title: 'A' },
      { id: 'rl2', url: 'https://blog.test/b', title: 'B', ownSession: true },
      { id: 'rl3', url: 'https://mail.google.com/x', title: 'C' },
    ];
    const { send, kept } = L.readingQueueForSync(list);
    expect(send.map(i => i.id)).toEqual(['rl1']);
    expect(kept.map(i => i.id)).toEqual(['rl2', 'rl3']);
    const back = L.readingQueueApply([{ id: 'rl1', url: 'https://blog.test/a', title: 'A' }, { id: 'rl9', url: 'https://x.test/', title: 'From other' }], kept);
    expect(back.map(i => i.id)).toEqual(['rl1', 'rl9', 'rl2', 'rl3']);
  });
});
