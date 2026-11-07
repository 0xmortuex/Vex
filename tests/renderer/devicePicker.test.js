// @vitest-environment jsdom
//
// The Web Serial / WebUSB chooser window (js/device-picker.js): names the site, lists devices with readable names and ids,
// says plainly when there are none, answers with Remember only when ticked, and is Turkish.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
let respond, DevicePicker, tr;
globalThis.VexTr = require('../../src/renderer/js/vex-tr.js').VexTr;

afterEach(() => { if (DevicePicker) DevicePicker.cancelActive(); });
beforeEach(() => {
  document.body.innerHTML = '';
  window.escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  respond = vi.fn().mockResolvedValue({ ok: true, remembered: true });
  window.vexDevices = { respond, grantsList: vi.fn(), grantsRevoke: vi.fn() };
  window.requestAnimationFrame = (f) => f();
  const { VexI18nUI } = fresh('../../src/renderer/js/i18n-ui.js');
  tr = (s) => VexI18nUI.lookup(s, 'tr');
  window.vexTr = null;
  DevicePicker = fresh('../../src/renderer/js/device-picker.js').DevicePicker;
});

const serialReq = { id: 'dev_1', kind: 'serial', origin: 'https://flash.example:8443', devices: [
  { id: 'p1', name: 'USB-SERIAL CH340 (COM3)', port: 'COM3', maker: '', vendorId: 6790, productId: 29987 },
  { id: 'p2', name: '', port: 'COM7', maker: '', vendorId: null, productId: null },
] };

describe('the chooser window', () => {
  it('names the asking site, lists readable names with the port and ids', () => {
    const o = DevicePicker.show(serialReq);
    expect(o.querySelector('.device-picker-site').textContent).toBe('flash.example:8443');
    const names = [...o.querySelectorAll('.hid-device-name')].map(n => n.textContent);
    expect(names).toEqual(['USB-SERIAL CH340 (COM3)', 'COM7']);
    expect(o.querySelectorAll('.hid-device-ids')[0].textContent).toBe('COM3 · 0x1a86:0x7523');
    expect(o.textContent).toMatch(/wants to connect to a serial port/);
  });
  it('USB devices show the maker and product name', () => {
    expect(DevicePicker.nameOf('usb', { name: 'ESP32-S3', maker: 'Espressif' })).toBe('Espressif ESP32-S3');
    expect(DevicePicker.nameOf('usb', { name: 'Espressif ESP32', maker: 'Espressif' })).toBe('Espressif ESP32');
    expect(DevicePicker.nameOf('usb', {})).toBe('Unknown USB device');
    expect(DevicePicker.nameOf('serial', {})).toBe('Unknown serial device');
  });
  it('no devices: says so clearly, and Connect is off', () => {
    const o = DevicePicker.show({ id: 'd', kind: 'serial', origin: 'https://a.example', devices: [] });
    expect(o.querySelector('.hid-empty').textContent).toMatch(/^No serial devices found\./);
    expect(o.querySelector('[data-act="connect"]').disabled).toBe(true);
    expect(o.querySelector('.device-picker-remember-box')).toBeNull();
    const u = DevicePicker.show({ id: 'd', kind: 'usb', origin: 'https://a.example', devices: [] });
    expect(u.querySelector('.hid-empty').textContent).toMatch(/^No USB devices found\./);
  });
  it('Connect sends the pick, and remember only when ticked', () => {
    let o = DevicePicker.show(serialReq);
    o.querySelectorAll('.hid-device')[1].click();
    o.querySelector('[data-act="connect"]').click();
    expect(respond).toHaveBeenLastCalledWith({ id: 'dev_1', deviceId: 'p2', remember: false });
    o = DevicePicker.show(serialReq);
    o.querySelector('.device-picker-remember-box').checked = true;
    o.querySelector('[data-act="connect"]').click();
    expect(respond).toHaveBeenLastCalledWith({ id: 'dev_1', deviceId: 'p1', remember: true });
  });
  it('Cancel, Escape and the backdrop all cancel, once, never remembering', () => {
    let o = DevicePicker.show(serialReq);
    o.querySelector('.device-picker-remember-box').checked = true;
    o.querySelector('[data-act="cancel"]').click();
    o.querySelector('[data-act="cancel"]').click();
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenLastCalledWith({ id: 'dev_1', deviceId: '', remember: false });
    o = DevicePicker.show(serialReq);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(respond).toHaveBeenLastCalledWith({ id: 'dev_1', deviceId: '', remember: false });
    o = DevicePicker.show(serialReq);
    o.click();
    expect(respond).toHaveBeenCalledTimes(3);
  });
  it('a device with markup in its name is shown as text', () => {
    const o = DevicePicker.show({ id: 'd', kind: 'usb', origin: 'https://a.example', devices: [{ id: 'u', name: '<img src=x onerror=1>', port: '', maker: '', vendorId: 1, productId: 2 }] });
    expect(o.querySelector('img')).toBeNull();
  });
});

describe('the remembered-devices list', () => {
  it('lists them with a Revoke each, and revoking asks main then redraws', async () => {
    const rows = [{ id: 'k1', kind: 'usb', origin: 'https://a.example', name: 'ESP32-S3', vendorId: 12346, productId: 4097, until: null }];
    window.vexDevices.grantsList.mockResolvedValueOnce(rows).mockResolvedValueOnce([]);
    window.vexDevices.grantsRevoke.mockResolvedValue({ ok: true });
    const host = document.createElement('div');
    await DevicePicker.renderGrants(host);
    expect(host.querySelector('.perm-row-origin').textContent).toBe('https://a.example');
    expect(host.querySelector('.perm-row-detail').textContent).toBe('USB device · ESP32-S3 · 0x303a:0x1001');
    host.querySelector('button').click();
    await new Promise(r => setTimeout(r, 0));
    expect(window.vexDevices.grantsRevoke).toHaveBeenCalledWith('k1');
    expect(host.querySelector('.perm-live-none').textContent).toMatch(/No site has/);
  });
  it('an error reading the list is shown, not swallowed', async () => {
    window.vexDevices.grantsList.mockRejectedValue(new Error('broken file'));
    const host = document.createElement('div');
    await DevicePicker.renderGrants(host);
    expect(host.textContent).toMatch(/could not be read: broken file/);
  });
});

describe('Turkish', () => {
  it('every text of the chooser and the list has Turkish', () => {
    for (const k of ['Connect to a serial port', 'Connect to a USB device', 'A site', 'wants to connect to a serial port', 'wants to connect to a USB device',
      'No serial devices found. Plug the device in, then ask the page again.', 'No USB devices found. Plug the device in, then ask the page again.',
      'The site can send data to this device and read from it. Only pick one you mean to use.', 'Remember this device for this site', 'Unknown serial device',
      'Unknown USB device', 'Serial port', 'USB device', 'Ends', 'Serial and USB devices', 'No site has a serial port or USB device remembered.',
      'The remembered devices could not be read', 'Could not revoke it', 'Permission revoked', 'Cancel', 'Connect', 'Revoke',
      'Serial and USB devices', 'That device permission is already gone', 'This device has nothing that names it, so it cannot be remembered']) {
      const t = tr(k);
      expect(t, k).toBeTruthy();
      expect(t, k).not.toBe(k);
    }
  });
});
