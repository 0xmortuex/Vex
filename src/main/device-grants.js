// === Web Serial and WebUSB: which device a site may use, in which session ===
// A site gets a serial port or a USB device only by picking it in Vex's own
// chooser (src/main/device-chooser.js). When the person ticks "remember", the
// pick is kept in device-grants.json under the session (partition) and the site,
// so a device picked in one container or panel is not handed to the same site in
// another, and navigator.serial.getPorts() / navigator.usb.getDevices() see
// exactly the devices picked there. Without the tick Chromium keeps the pick for
// that page's life only and nothing is written here.
//
// This file holds the pure rules (secure origins, a device's key and readable
// name) and the grants store. It reads and writes nothing but its own file and
// never opens a device.
'use strict';

const fs = require('fs');
const path = require('path');
const { atomicWriteSync } = require('./file-store');

const SEP = '|';
const KINDS = ['serial', 'usb'];

// Web Serial and WebUSB exist only on secure pages: https, or the machine itself
// (a local dev server, QEMU's web console). Chromium already hides them on other
// pages; this is the second lock, so a bug elsewhere cannot offer a device to
// a plain-http site.
function isSecureDeviceOrigin(origin) {
  let u;
  try { u = new URL(origin); } catch { return false; }
  if (u.protocol === 'https:') return true;
  if (u.protocol !== 'http:') return false;
  const h = u.hostname;
  return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '[::1]';
}

function originOfUrl(url) {
  try { const o = new URL(url).origin; return o === 'null' ? '' : o; } catch { return ''; }
}

function _id(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v));
  return Number.isInteger(n) && n >= 0 && n <= 0xffff ? n : null;
}
// 0x1a86 form, the one datasheets and flashing tools use.
function hexId(v) {
  const n = _id(v);
  return n === null ? '' : '0x' + n.toString(16).padStart(4, '0');
}

// What names one device across plug-ins. A serial port has no id of its own that
// survives re-plugging (COM3 becomes COM4), so: vendor, product and the adapter's
// serial number when it has them; the port name only for a port with no ids at all
// (a virtual COM pair, a QEMU pipe).
function deviceKey(kind, d) {
  if (!KINDS.includes(kind)) throw new Error('A device is serial or usb');
  if (!d || typeof d !== 'object') throw new Error('A device grant needs the device');
  const v = _id(d.vendorId), p = _id(d.productId);
  if (v !== null && p !== null) return v + ':' + p + ':' + String(d.serialNumber || '');
  if (kind === 'serial' && d.portName) return 'port:' + String(d.portName);
  throw new Error('This device has nothing that names it, so it cannot be remembered');
}

// The shape sent to the chooser window. Never the whole object Chromium gives:
// a USB device carries every configuration and endpoint, and nothing in the
// window needs them (nor the serial number).
function describeDevices(kind, list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const d of list) {
    if (!d || typeof d !== 'object') continue;
    if (kind === 'serial') {
      if (!d.portId) continue;
      out.push({ id: String(d.portId), name: String(d.displayName || ''), port: String(d.portName || ''), maker: '', vendorId: _id(d.vendorId), productId: _id(d.productId) });
    } else {
      if (!d.deviceId) continue;
      out.push({ id: String(d.deviceId), name: String(d.productName || ''), port: '', maker: String(d.manufacturerName || ''), vendorId: _id(d.vendorId), productId: _id(d.productId) });
    }
  }
  return out;
}

function createDeviceGrants({ userDataPath, writeFile = (f, s) => atomicWriteSync(f, s), now = () => Date.now() }) {
  const file = path.join(userDataPath, 'device-grants.json');
  let cache = null;

  function load() {
    if (cache) return cache;
    let raw = {};
    if (fs.existsSync(file)) {
      raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('device-grants.json is not a list of grants');
    }
    const out = {};
    for (const [site, byKind] of Object.entries(raw)) {
      if (!byKind || typeof byKind !== 'object') continue;
      for (const kind of KINDS) {
        const list = Array.isArray(byKind[kind]) ? byKind[kind] : [];
        const kept = list.filter(g => g && typeof g.key === 'string' && g.key).map(g => ({
          key: g.key, name: typeof g.name === 'string' ? g.name : '', vendorId: _id(g.vendorId), productId: _id(g.productId),
          until: Number.isFinite(g.until) ? g.until : null,
        }));
        if (kept.length) (out[site] || (out[site] = {}))[kind] = kept;
      }
    }
    cache = out;
    return cache;
  }

  function siteKey(partition, origin) {
    if (!partition) throw new Error('A device grant needs the session it is for');
    if (!origin || origin === 'null' || origin === 'unknown') throw new Error('A device grant needs the site it is for');
    return partition + SEP + origin;
  }
  const live = (g) => g.until === null || g.until > now();
  // Change a copy, write it, and only then make it the truth: a write that fails leaves memory and disk as they were.
  function commit(change) {
    const next = JSON.parse(JSON.stringify(load()));
    change(next);
    writeFile(file, JSON.stringify(next, null, 2));
    cache = next;
  }

  function isGranted(kind, partition, origin, device) {
    if (!partition || !origin || !KINDS.includes(kind) || !isSecureDeviceOrigin(origin)) return false;
    let key;
    // A device with nothing that names it can never have been remembered, so it is not granted.
    try { key = deviceKey(kind, device); } catch { return false; }
    const byKind = load()[partition + SEP + origin];
    const list = byKind && byKind[kind];
    return !!list && list.some(g => g.key === key && live(g));
  }

  // until: when the grant ends (permission hygiene), or null to keep it.
  function grant(kind, partition, origin, device, { until = null, name = '' } = {}) {
    if (!isSecureDeviceOrigin(origin)) throw new Error('Devices are only remembered for https sites and this computer');
    const site = siteKey(partition, origin);
    const key = deviceKey(kind, device);
    const entry = { key, name: String(name || ''), vendorId: _id(device.vendorId), productId: _id(device.productId), until: until === null ? null : Number(until) };
    commit((all) => {
      const byKind = all[site] || (all[site] = {});
      const list = byKind[kind] || (byKind[kind] = []);
      const at = list.findIndex(g => g.key === key);
      if (at >= 0) list[at] = entry; else list.push(entry);
    });
  }

  function idOf(site, kind, g) { return site + SEP + kind + SEP + g.key; }

  // Every live grant, for Settings.
  function list() {
    const out = [];
    for (const [site, byKind] of Object.entries(load())) {
      const cut = site.indexOf(SEP);
      for (const kind of KINDS) {
        for (const g of byKind[kind] || []) {
          if (!live(g)) continue;
          out.push({ id: idOf(site, kind, g), kind, partition: site.slice(0, cut), origin: site.slice(cut + 1), name: g.name, vendorId: g.vendorId, productId: g.productId, until: g.until });
        }
      }
    }
    return out;
  }

  function revoke(id) {
    for (const [site, byKind] of Object.entries(load())) {
      for (const kind of KINDS) {
        if (!(byKind[kind] || []).some(g => idOf(site, kind, g) === id)) continue;
        commit((all) => {
          const b = all[site];
          b[kind] = b[kind].filter(g => idOf(site, kind, g) !== id);
          if (!b[kind].length) delete b[kind];
          if (!Object.keys(b).length) delete all[site];
        });
        return true;
      }
    }
    throw new Error('That device permission is already gone');
  }

  return { isGranted, grant, list, revoke, file };
}

module.exports = { createDeviceGrants, isSecureDeviceOrigin, originOfUrl, deviceKey, describeDevices, hexId, KINDS };
