// Invoked only by the isolated smoke harness (VEX_DRM_SMOKE=1, driven by
// scripts/verify-drm.js --boot), never in normal browsing.
//
// In the BUILT app, in a fresh throwaway profile: wait for the Widevine
// component to be installed, then ask the CDM for a license request. If the
// castLabs VMP signature is invalid or the component never installs, this is
// where a release is stopped (T0-021). It needs the network on a fresh profile
// (the CDM is downloaded), and a packaged app: from source it fails on purpose.
'use strict';
const assert = require('assert/strict');

// A Widevine PSSH box (system id edef8ba9-...) carrying one 16-byte key id, the
// smallest init data the CDM accepts to produce a license request.
const REQUEST_SCRIPT = `(async () => {
  const keyId = new Uint8Array(16).fill(7);
  const data = new Uint8Array([0x12, 0x10, ...keyId]);
  const sys = [0xed,0xef,0x8b,0xa9,0x79,0xd6,0x4a,0xce,0xa3,0xc8,0x27,0xdc,0xd5,0x1d,0x21,0xed];
  const size = 4 + 4 + 4 + 16 + 4 + data.length;
  const box = new Uint8Array(size);
  const v = new DataView(box.buffer);
  v.setUint32(0, size); box.set([0x70, 0x73, 0x73, 0x68], 4); v.setUint32(8, 0);
  box.set(sys, 12); v.setUint32(28, data.length); box.set(data, 32);
  const access = await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{
    initDataTypes: ['cenc'],
    videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"', robustness: 'SW_SECURE_CRYPTO' }],
  }]);
  const keys = await access.createMediaKeys();
  const session = keys.createSession();
  const bytes = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the CDM made no license request within 20 s')), 20000);
    session.addEventListener('message', (e) => { clearTimeout(timer); resolve(e.message.byteLength); }, { once: true });
    session.generateRequest('cenc', box).catch((err) => { clearTimeout(timer); reject(err); });
  });
  return bytes;
})()`;

async function run({ mainWindow, status, isPackaged, deadlineMs = 150000, now = Date.now, sleep = (ms) => new Promise(r => setTimeout(r, ms)) }) {
  assert(isPackaged, 'the DRM check needs the BUILT app (from source Widevine is not installed)');
  const deadline = now() + deadlineMs;
  let text = status();
  while (!/^Widevine ready/.test(text)) {
    assert(now() < deadline, 'Widevine did not become ready: ' + text);
    await sleep(1000);
    text = status();
  }
  const bytes = await mainWindow.webContents.executeJavaScript(REQUEST_SCRIPT, true);
  assert(bytes > 0, 'the CDM returned an empty license request');
  return text + '; license request of ' + bytes + ' bytes generated';
}

module.exports = { run, REQUEST_SCRIPT };
