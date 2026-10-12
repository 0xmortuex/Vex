// === WebHID grants: which HID device a site may use, in which session ===
// A site gets a device only by picking it in Vex's chooser
// (navigator.hid.requestDevice). The pick is kept in hid-grants.json under
// the session (partition) and the site, so a device picked in one container
// or panel is not handed to the same site in another, and
// navigator.hid.getDevices() sees exactly the devices picked there.
//
// The file used to be keyed by site alone. Those older grants were made in
// ordinary tabs or app panels; they are read as persist:main's, so a tab keeps
// its device and anywhere else asks once more.
const fs = require('fs');
const path = require('path');

const SEP = '|';   // "persist:main|https://site.example"; neither part has one
const LEGACY_PARTITION = 'persist:main';

function createHidGrants({ userDataPath, writeFile = (f, s) => fs.writeFileSync(f, s, 'utf-8') }) {
  const file = path.join(userDataPath, 'hid-grants.json');
  let cache = null;

  function load() {
    if (cache) return cache;
    let raw = {};
    if (fs.existsSync(file)) {
      raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('hid-grants.json is not a list of grants');
    }
    const out = {};
    for (const [key, list] of Object.entries(raw)) {
      if (!Array.isArray(list)) continue;
      const k = key.includes(SEP) ? key : LEGACY_PARTITION + SEP + key;
      const into = out[k] || (out[k] = []);
      for (const g of list) {
        if (g && Number.isInteger(g.vendorId) && Number.isInteger(g.productId) && !into.some(x => x.vendorId === g.vendorId && x.productId === g.productId)) {
          into.push({ vendorId: g.vendorId, productId: g.productId });
        }
      }
    }
    cache = out;
    return cache;
  }

  function keyOf(partition, origin) {
    if (!partition) throw new Error('A HID grant needs the session it is for');
    if (!origin || origin === 'null' || origin === 'unknown') throw new Error('A HID grant needs the site it is for');
    return partition + SEP + origin;
  }

  function isGranted(partition, origin, vendorId, productId) {
    if (!partition || !origin) return false;
    const list = load()[partition + SEP + origin];
    return !!list && list.some(g => g.vendorId === vendorId && g.productId === productId);
  }

  function grant(partition, origin, vendorId, productId) {
    const key = keyOf(partition, origin);
    const grants = load();
    const list = grants[key] || (grants[key] = []);
    if (list.some(g => g.vendorId === vendorId && g.productId === productId)) return;
    list.push({ vendorId, productId });
    writeFile(file, JSON.stringify(grants, null, 2));
  }

  return { isGranted, grant, file };
}

module.exports = { createHidGrants };
