// @vitest-environment node
//
// Web Serial / WebUSB chooser (src/main/device-chooser.js, device-grants.js). Before this, navigator.serial.requestPort()
// and navigator.usb.requestDevice() never reached a chooser in Vex: the permission check answered "no" for 'serial' and
// 'usb', so ESP/Arduino web flashers and browser serial consoles could not connect (measured on Electron 42: with the check
// answering false, no 'select-serial-port' / 'select-usb-device' event fires at all).
import { describe, it, expect, vi } from 'vitest';
const fs = require('fs'), os = require('os'), path = require('path');
const { EventEmitter } = require('events');
const G = require('../../src/main/device-grants.js');
const { createDeviceChooser } = require('../../src/main/device-chooser.js');
const { createPermissionHygiene } = require('../../src/main/permission-hygiene.js');
const src = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vex-devgrants-'));

const PORT = { portId: 'p1', portName: 'COM3', displayName: 'USB-SERIAL CH340 (COM3)', vendorId: '6790', productId: '29987', serialNumber: 'A1' };
const VIRTUAL = { portId: 'p2', portName: 'COM7', displayName: '' };
const USB = { deviceId: 'u1', productName: 'ESP32-S3', manufacturerName: 'Espressif', vendorId: 12346, productId: 4097, serialNumber: 'S9', configurations: [{ big: 'x'.repeat(1000) }] };

describe('secure origins and device names', () => {
  it('https and this computer only', () => {
    for (const o of ['https://flash.example', 'http://localhost:8080', 'http://127.0.0.1:3000', 'http://app.localhost', 'http://[::1]:80']) expect(G.isSecureDeviceOrigin(o), o).toBe(true);
    for (const o of ['http://flash.example', 'http://192.168.1.5:80', 'file:///c:/x.html', 'ftp://localhost', '', 'null', 'https:']) expect(G.isSecureDeviceOrigin(o), o).toBe(false);
  });
  it('names serial ports and USB devices readably, with ids in hex, and sends no serial number or configuration', () => {
    const [s] = G.describeDevices('serial', [PORT]);
    expect(s).toEqual({ id: 'p1', name: 'USB-SERIAL CH340 (COM3)', port: 'COM3', maker: '', vendorId: 6790, productId: 29987 });
    expect(G.hexId(s.vendorId)).toBe('0x1a86');
    const [u] = G.describeDevices('usb', [USB]);
    expect(u).toEqual({ id: 'u1', name: 'ESP32-S3', port: '', maker: 'Espressif', vendorId: 12346, productId: 4097 });
    expect(JSON.stringify([s, u])).not.toMatch(/S9|A1|big/);
    expect(G.describeDevices('serial', [null, {}, VIRTUAL])[0].port).toBe('COM7');
    expect(G.describeDevices('usb', 'nope')).toEqual([]);
  });
  it('a device is remembered by ids and adapter serial; a port with no ids by its name; nothing else', () => {
    expect(G.deviceKey('serial', PORT)).toBe('6790:29987:A1');
    expect(G.deviceKey('usb', USB)).toBe('12346:4097:S9');
    expect(G.deviceKey('serial', VIRTUAL)).toBe('port:COM7');
    expect(() => G.deviceKey('usb', { deviceId: 'x' })).toThrow(/nothing that names it/);
    expect(() => G.deviceKey('hid', USB)).toThrow(/serial or usb/);
  });
});

describe('grants: per session, site and device', () => {
  it('a remembered device is granted only to that site, in that session, for that kind', () => {
    const dir = tmp();
    const g = G.createDeviceGrants({ userDataPath: dir });
    g.grant('serial', 'persist:main', 'https://flash.example', PORT, { name: 'CH340' });
    expect(g.isGranted('serial', 'persist:main', 'https://flash.example', PORT)).toBe(true);
    expect(g.isGranted('serial', 'persist:container-work', 'https://flash.example', PORT)).toBe(false);
    expect(g.isGranted('serial', 'persist:main', 'https://other.example', PORT)).toBe(false);
    expect(g.isGranted('usb', 'persist:main', 'https://flash.example', PORT)).toBe(false);
    expect(g.isGranted('serial', 'persist:main', 'https://flash.example', { ...PORT, serialNumber: 'A2' })).toBe(false);
    expect(G.createDeviceGrants({ userDataPath: dir }).isGranted('serial', 'persist:main', 'https://flash.example', PORT)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('refuses to remember for a plain-http site, or with no session', () => {
    const g = G.createDeviceGrants({ userDataPath: tmp() });
    expect(() => g.grant('usb', 'persist:main', 'http://192.168.1.5', USB)).toThrow(/https/);
    expect(() => g.grant('usb', '', 'https://a.example', USB)).toThrow(/session/);
    expect(() => g.grant('usb', 'persist:main', 'https://a.example', { deviceId: 'x' })).toThrow(/names it/);
    expect(g.isGranted('usb', 'persist:main', 'http://192.168.1.5', USB)).toBe(false);
  });
  it('an ended grant is no grant and is not listed; permission hygiene sets the end', () => {
    let t = 1000;
    const g = G.createDeviceGrants({ userDataPath: tmp(), now: () => t });
    g.grant('usb', 'persist:main', 'https://a.example', USB, { until: 2000 });
    expect(g.isGranted('usb', 'persist:main', 'https://a.example', USB)).toBe(true);
    expect(g.list().length).toBe(1);
    t = 2000;
    expect(g.isGranted('usb', 'persist:main', 'https://a.example', USB)).toBe(false);
    expect(g.list()).toEqual([]);
    const h = createPermissionHygiene({ file: path.join(tmp(), 'h.json'), now: () => 5 });
    h.setConfig({ enabled: true, expiryDays: 3 });
    expect(h.expiryFor('https://a.example', 'serial')).toBe(5 + 3 * 86400000);
    expect(h.expiryFor('https://a.example', 'usb')).toBe(5 + 3 * 86400000);
  });
  it('lists and revokes; revoking something already gone is said', () => {
    const g = G.createDeviceGrants({ userDataPath: tmp() });
    g.grant('serial', 'persist:main', 'https://a.example', PORT, { name: 'CH340' });
    g.grant('usb', 'persist:main', 'https://a.example', USB, { name: 'ESP32-S3' });
    const rows = g.list();
    expect(rows.map(r => r.kind).sort()).toEqual(['serial', 'usb']);
    expect(rows.find(r => r.kind === 'usb')).toMatchObject({ origin: 'https://a.example', partition: 'persist:main', name: 'ESP32-S3', vendorId: 12346 });
    g.revoke(rows.find(r => r.kind === 'serial').id);
    expect(g.isGranted('serial', 'persist:main', 'https://a.example', PORT)).toBe(false);
    expect(g.isGranted('usb', 'persist:main', 'https://a.example', USB)).toBe(true);
    expect(() => g.revoke(rows.find(r => r.kind === 'serial').id)).toThrow(/already gone/);
  });
  it('a write that fails leaves the grants as they were and says so', () => {
    const dir = tmp();
    let fail = false;
    const g = G.createDeviceGrants({ userDataPath: dir, writeFile: (f, s) => { if (fail) throw new Error('disk full'); fs.writeFileSync(f, s); } });
    g.grant('usb', 'persist:main', 'https://a.example', USB);
    fail = true;
    expect(() => g.grant('serial', 'persist:main', 'https://a.example', PORT)).toThrow(/disk full/);
    expect(g.isGranted('serial', 'persist:main', 'https://a.example', PORT)).toBe(false);
    expect(() => g.revoke(g.list()[0].id)).toThrow(/disk full/);
    expect(g.isGranted('usb', 'persist:main', 'https://a.example', USB)).toBe(true);
    expect(G.createDeviceGrants({ userDataPath: dir }).isGranted('usb', 'persist:main', 'https://a.example', USB)).toBe(true);
  });
  it('a damaged grants file is said, never read as "no grants"', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'device-grants.json'), '[1]');
    expect(() => G.createDeviceGrants({ userDataPath: dir }).list()).toThrow(/not a list/);
    fs.writeFileSync(path.join(dir, 'device-grants.json'), '{nope');
    expect(() => G.createDeviceGrants({ userDataPath: dir }).list()).toThrow();
  });
});

// A fake session and tab: the same calls Electron makes, measured in the spike.
function rig({ privatePartition = null, tor = false, paranoid = false, url = 'https://flash.example/app', remembered = true } = {}) {
  const ses = new EventEmitter();
  ses.__vexTor = tor;
  const sent = [];
  const win = { isDestroyed: () => false, webContents: { send: (ch, p) => sent.push([ch, p]) } };
  const host = { win, privatePartition };
  const contents = { getURL: () => url, id: 7 };
  const frame = { url, detached: false };
  const handlers = new Map();
  const ipcMain = { on: (c, f) => handlers.set(c, f), handle: (c, f) => handlers.set(c, f) };
  const grants = G.createDeviceGrants({ userDataPath: tmp() });
  const chooser = createDeviceChooser({
    ipcMain, grants, hygiene: null,
    webContents: { fromFrame: () => contents },
    secureSessions: { owner: (c) => (c === contents || c === 'sender' ? host : null) },
    webSafety: { isParanoid: () => paranoid },
  });
  chooser.registerIpc();
  chooser.wireOnSession(ses, 'persist:main');
  handlers.get('devices:renderer-ready')();
  const ev = () => ({ preventDefault: vi.fn() });
  return { ses, sent, chooser, grants, handlers, contents, frame, ev, host };
}

describe('the chooser, with a fake session', () => {
  it('serial: lists the offered ports for the asking site, and Connect + Remember answers the page and keeps the grant', () => {
    const r = rig();
    const cb = vi.fn(); const e = r.ev();
    r.ses.emit('select-serial-port', e, [PORT, VIRTUAL], r.contents, cb);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(r.sent.length).toBe(1);
    const [ch, req] = r.sent[0];
    expect(ch).toBe('devices:select-request');
    expect(req).toMatchObject({ kind: 'serial', origin: 'https://flash.example' });
    expect(req.devices.map(d => d.id)).toEqual(['p1', 'p2']);
    expect(cb).not.toHaveBeenCalled();
    const out = r.chooser.respond('sender', { id: req.id, deviceId: 'p1', remember: true });
    expect(out).toEqual({ ok: true, remembered: true });
    expect(cb).toHaveBeenCalledWith('p1');
    expect(r.chooser.isDeviceGranted('persist:main', { deviceType: 'serial', origin: 'https://flash.example', device: PORT })).toBe(true);
    expect(r.chooser.isDeviceGranted('persist:main', { deviceType: 'serial', origin: 'https://evil.example', device: PORT })).toBe(false);
  });
  it('usb: the page is answered with the picked id; without Remember nothing is written', () => {
    const r = rig();
    const cb = vi.fn();
    r.ses.emit('select-usb-device', r.ev(), { deviceList: [USB], frame: r.frame }, cb);
    const req = r.sent[0][1];
    expect(req.kind).toBe('usb');
    expect(JSON.stringify(req)).not.toMatch(/configurations|S9/);
    expect(r.chooser.respond('sender', { id: req.id, deviceId: 'u1', remember: false })).toEqual({ ok: true, remembered: false });
    expect(cb).toHaveBeenCalledWith('u1');
    expect(fs.existsSync(r.grants.file)).toBe(false);
    expect(r.chooser.isDeviceGranted('persist:main', { deviceType: 'usb', origin: 'https://flash.example', device: USB })).toBe(false);
  });
  it('Cancel and a blank answer cancel the request (the page sees NotFoundError, it never hangs)', () => {
    const r = rig();
    const cb = vi.fn();
    r.ses.emit('select-serial-port', r.ev(), [PORT], r.contents, cb);
    expect(r.chooser.respond('sender', { id: r.sent[0][1].id, deviceId: '' }).ok).toBe(true);
    expect(cb).toHaveBeenCalledWith('');
    expect(r.chooser.pending.size).toBe(0);
  });
  it('no devices: the chooser still opens, with an empty list to say so', () => {
    const r = rig();
    r.ses.emit('select-serial-port', r.ev(), [], r.contents, vi.fn());
    expect(r.sent[0][1].devices).toEqual([]);
  });
  it('is refused, with the page answered at once, in private and Tor windows, for plain http, and for paranoid sites', () => {
    for (const opts of [{ privatePartition: 'p' }, { tor: true }, { url: 'http://192.168.1.4/x' }, { paranoid: true }]) {
      const r = rig(opts); const cb = vi.fn();
      r.ses.emit('select-serial-port', r.ev(), [PORT], r.contents, cb);
      expect(cb, JSON.stringify(opts)).toHaveBeenCalledWith('');
      expect(r.sent.length).toBe(0);
      const cb2 = vi.fn();
      r.ses.emit('select-usb-device', r.ev(), { deviceList: [USB], frame: { url: opts.url || 'https://flash.example/app' } }, cb2);
      expect(cb2).toHaveBeenCalledWith('');
    }
  });
  it('localhost is allowed (a local dev server or QEMU web console)', () => {
    const r = rig({ url: 'http://localhost:8080/' });
    r.ses.emit('select-serial-port', r.ev(), [PORT], r.contents, vi.fn());
    expect(r.sent.length).toBe(1);
  });
  it('another window cannot answer, an unknown device is refused, a page that moved on is cancelled', () => {
    const r = rig(); const cb = vi.fn();
    r.ses.emit('select-serial-port', r.ev(), [PORT], r.contents, cb);
    const id = r.sent[0][1].id;
    expect(r.chooser.respond('other', { id, deviceId: 'p1' }).error).toMatch(/another window/);
    expect(r.chooser.respond('sender', { id, deviceId: 'zzz' }).error).toMatch(/Unknown device/);
    expect(cb).not.toHaveBeenCalled();
    r.contents.getURL = () => 'https://flash.example/other';
    expect(r.chooser.respond('sender', { id, deviceId: 'p1' }).error).toMatch(/changed/);
    expect(cb).toHaveBeenCalledWith('');
  });
  it('a new request from the same tab cancels the old one; an unanswered one is cancelled after two minutes', () => {
    vi.useFakeTimers();
    try {
      const r = rig(); const a = vi.fn(), b = vi.fn();
      r.ses.emit('select-serial-port', r.ev(), [PORT], r.contents, a);
      r.ses.emit('select-serial-port', r.ev(), [PORT], r.contents, b);
      expect(a).toHaveBeenCalledWith('');
      vi.advanceTimersByTime(120001);
      expect(b).toHaveBeenCalledWith('');
      expect(r.chooser.pending.size).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('a request that fires before the window listens is held and delivered when it is ready', () => {
    const r = rig();
    const fresh = new EventEmitter();
    // a second chooser whose window has not announced itself
    const sent = [];
    const host = { win: { isDestroyed: () => false, webContents: { send: (c, p) => sent.push(p) } } };
    const handlers = new Map();
    const c = createDeviceChooser({ ipcMain: { on: (n, f) => handlers.set(n, f), handle: (n, f) => handlers.set(n, f) }, grants: r.grants, webContents: {}, secureSessions: { owner: () => host } });
    c.registerIpc(); c.wireOnSession(fresh, 't');
    fresh.emit('select-serial-port', r.ev(), [PORT], r.contents, vi.fn());
    expect(sent.length).toBe(0);
    handlers.get('devices:renderer-ready')();
    expect(sent.length).toBe(1);
  });
  it('a pick that cannot be remembered still works for the page, and the person is told', () => {
    const r = rig(); const cb = vi.fn();
    r.ses.emit('select-serial-port', r.ev(), [{ portId: 'x', portName: '' }], r.contents, cb);
    const out = r.chooser.respond('sender', { id: r.sent[0][1].id, deviceId: 'x', remember: true });
    expect(cb).toHaveBeenCalledWith('x');
    expect(out).toMatchObject({ ok: true, remembered: false });
    expect(out.error).toMatch(/names it/);
  });
  it('the device gate fails closed when the grants file is damaged, and says so', () => {
    const dir = tmp(); fs.writeFileSync(path.join(dir, 'device-grants.json'), '[]');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = createDeviceChooser({ ipcMain: {}, grants: G.createDeviceGrants({ userDataPath: dir }), webContents: {}, secureSessions: {} });
    expect(c.isDeviceGranted('persist:main', { deviceType: 'usb', origin: 'https://a.example', device: USB })).toBe(false);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    expect(c.isDeviceGranted('persist:main', { deviceType: 'hid', origin: 'https://a.example', device: USB })).toBe(false);
  });
});

describe('wiring in the real sources', () => {
  const main = src('src/main.js');
  it('the permission check lets Chromium reach the chooser for serial and usb (else no event fires)', () => {
    expect(src('src/main/permissions.js')).toMatch(/if \(permission === 'serial' \|\| permission === 'usb'\) return true;/);
  });
  it('the session device gate answers serial/usb from the grant store, and every session gets the chooser', () => {
    expect(main).toMatch(/details\.deviceType === 'serial' \|\| details\.deviceType === 'usb'\)\) return _deviceChooser\.isDeviceGranted\(tag, details\);/);
    expect(main).toMatch(/_deviceChooser\.wireOnSession\(session\.defaultSession, 'default'\);/);
    expect(main).toMatch(/_deviceChooser\.wireOnSession\(secureSessions\.fromPartition\('persist:main'\), 'persist:main'\);/);
    expect(main).toMatch(/partitions\.forEach\(p => _deviceChooser\.wireOnSession\(secureSessions\.fromPartition\(p\), p\)\);/);
  });
  it('the IPC has schemas, a preload and the private-window ban', () => {
    expect(src('src/main/ipc-schemas.js')).toMatch(/define\('devices:select-respond'/);
    expect(src('src/main/ipc-schemas.js')).toMatch(/devices:grants-revoke/);
    expect(src('src/preload.js')).toMatch(/exposeInMainWorld\('vexDevices'/);
    expect(src('src/main/ipc-policy.js')).toMatch(/devices:\(\?:select-respond\|grants-list\|grants-revoke\)/);
  });
});
