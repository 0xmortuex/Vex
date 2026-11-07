// === Web Serial and WebUSB chooser: navigator.serial.requestPort() / navigator.usb.requestDevice() ===
// Measured on this castLabs Electron 42 build (probe in the Wave 4 report):
//   ses.on('select-serial-port', (event, portList, webContents, callback))
//   ses.on('select-usb-device',  (event, { deviceList, frame }, callback))
// both fire only when ses.setPermissionCheckHandler answers true for 'serial' /
// 'usb' (src/main/permissions.js), and callback('') makes the page see
// NotFoundError at once. The same device lists are what setDevicePermissionHandler
// is asked about on getPorts()/getDevices(), so that handler (main.js) asks
// isDeviceGranted() below and nothing else: a device is the page's only if the
// person picked it and ticked "remember".
//
// Same pattern as WebHID (hid:* in main.js): the chooser IS the permission gate,
// a request goes to the window that owns the tab, an answer from any other
// window is refused, and an unanswered chooser is cancelled after two minutes.
// Never in private or Tor windows, never for a page that is not https or this
// computer, never for a site in paranoid mode. No scan of any kind: the lists
// are what Chromium hands over for one request.
'use strict';

const { describeDevices, deviceKey, isSecureDeviceOrigin, originOfUrl, KINDS } = require('./device-grants');

const ASK_MS = 120000;

function createDeviceChooser({ ipcMain, webContents, secureSessions, grants, hygiene = null, webSafety = null, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
  const pending = new Map();      // request id -> what the chooser was asked
  const queue = [];               // requests that fired before the window attached its listener
  let rendererReady = false;

  function deliver(payload) {
    const p = pending.get(payload.id);
    if (!p) return true;
    const win = p.host && p.host.win;
    if (!win || win.isDestroyed()) return false;
    try { win.webContents.send('devices:select-request', payload); return true; }
    catch (err) { console.error('[Devices] could not show the chooser:', err.message); return false; }
  }
  function send(payload) {
    if (rendererReady && deliver(payload)) return;
    queue.push(payload);
  }

  function finish(id, choice) {
    const p = pending.get(id);
    if (!p) return false;
    pending.delete(id);
    clearTimeoutFn(p.timer);
    try { p.callback(choice); }
    catch (err) { console.error('[Devices] the page could not be answered:', err.message); return false; }
    return true;
  }

  // Everything that must be true before a page is even shown a list.
  function refusal(ses, host, origin) {
    if (!host) return 'no window owns this page';
    if (host.privatePartition) return 'a private window';
    if (ses && ses.__vexTor) return 'a Tor tab';
    if (!isSecureDeviceOrigin(origin)) return 'a page that is not https or this computer';
    if (webSafety && webSafety.isParanoid(origin)) return 'a site in paranoid mode';
    return null;
  }

  function ask({ kind, ses, tag, contents, frame, url, list, callback }) {
    const host = contents ? secureSessions.owner(contents) : null;
    const origin = originOfUrl(url);
    const why = refusal(ses, host, origin);
    if (why) {
      console.log(`[Devices] (${tag}) ${kind} chooser refused for ${origin || 'unknown'}: ${why}`);
      callback('');
      return;
    }
    // One chooser per tab and kind: a new request replaces the old one (which the page sees as cancelled).
    for (const [oid, o] of pending) if (o.contents === contents && o.kind === kind) finish(oid, '');
    const devices = describeDevices(kind, list);
    const raw = new Map();
    for (const d of list || []) raw.set(String(kind === 'serial' ? d.portId : d.deviceId), d);
    const id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[Devices] (${tag}) ${origin} asks for a ${kind} device, ${devices.length} offered`);
    const timer = setTimeoutFn(() => finish(id, ''), ASK_MS);
    pending.set(id, { kind, callback, origin, host, contents, partition: tag, frame, url, raw, ids: new Set(devices.map(d => d.id)), timer });
    send({ id, kind, origin, devices });
  }

  function wireOnSession(ses, tag) {
    if (!ses || ses.__vexDevicesWired) return;
    ses.__vexDevicesWired = true;
    ses.on('select-serial-port', (event, portList, contents, callback) => {
      event.preventDefault();
      let url = '';
      try { url = contents.getURL(); } catch (err) { console.error('[Devices] could not read the page address:', err.message); }
      ask({ kind: 'serial', ses, tag, contents, frame: null, url, list: portList, callback });
    });
    ses.on('select-usb-device', (event, details, callback) => {
      event.preventDefault();
      const frame = details && details.frame;
      const contents = frame ? webContents.fromFrame(frame) : null;
      ask({ kind: 'usb', ses, tag, contents, frame, url: frame ? frame.url : '', list: details && details.deviceList, callback });
    });
  }

  // The answer from the chooser window. remember only counts with a device picked.
  function respond(sender, payload) {
    const { id, deviceId, remember } = payload || {};
    const p = pending.get(id);
    if (!p) return { ok: false, error: 'No pending device request' };
    if (p.host !== secureSessions.owner(sender)) return { ok: false, error: 'Request belongs to another window' };
    try {
      if (p.frame && (p.frame.detached || p.frame.url !== p.url)) { finish(id, ''); return { ok: false, error: 'Requesting page changed' }; }
      if (!p.frame && p.contents.getURL() !== p.url) { finish(id, ''); return { ok: false, error: 'Requesting page changed' }; }
    } catch (err) { finish(id, ''); return { ok: false, error: 'Requesting page is gone' }; }
    if (deviceId && !p.ids.has(deviceId)) return { ok: false, error: 'Unknown device' };
    if (deviceId && remember === true) {
      // Written BEFORE the page is answered, so the device gate sees it the moment Chromium asks. A grant that cannot be
      // written (a device with nothing that names it, a full disk) is said to the person and the pick still works for this page.
      const device = p.raw.get(deviceId);
      let note = null;
      try {
        const until = hygiene ? hygiene.expiryFor(p.origin, p.kind) : null;
        const shown = describeDevices(p.kind, [device])[0] || {};
        grants.grant(p.kind, p.partition, p.origin, device, { until, name: shown.name || shown.port || '' });
      } catch (err) { console.error('[Devices] could not remember the device:', err.message); note = err.message; }
      finish(id, deviceId);
      return note ? { ok: true, remembered: false, error: note } : { ok: true, remembered: true };
    }
    finish(id, deviceId || '');
    return { ok: true, remembered: false };
  }

  // setDevicePermissionHandler asks this for 'serial' and 'usb'. Fails closed, loudly.
  function isDeviceGranted(tag, details) {
    if (!details || !KINDS.includes(details.deviceType)) return false;
    try { return grants.isGranted(details.deviceType, tag, details.origin, details.device); }
    catch (err) { console.error('[Devices] could not read the device grants:', err.message); return false; }
  }

  function registerIpc() {
    ipcMain.on('devices:renderer-ready', () => {
      rendererReady = true;
      while (queue.length) {
        const next = queue.shift();
        if (!deliver(next)) { queue.unshift(next); break; }
      }
    });
    ipcMain.handle('devices:select-respond', (e, payload) => respond(e.sender, payload));
    ipcMain.handle('devices:grants-list', () => grants.list());
    ipcMain.handle('devices:grants-revoke', (_e, payload) => {
      grants.revoke(payload && payload.id);
      return { ok: true };
    });
  }

  return { wireOnSession, respond, isDeviceGranted, registerIpc, pending };
}

module.exports = { createDeviceChooser, deviceKey, ASK_MS };
