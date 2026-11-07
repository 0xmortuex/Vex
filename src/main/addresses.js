// === Saved addresses: a small address book, encrypted at rest with safeStorage (Windows DPAPI) ====
//
// Modelled on main/cards.js and main/vault.js, with these rules:
//   - addresses.dat is sealed by the operating system. If safeStorage is not available Vex refuses to save rather than
//     writing plain text; there is no plain JSON copy anywhere;
//   - this device only: no Vex Sync, no backup, no export (the backup and the export are lists of named stores, and this file is
//     in neither), and NOT in the secrets lifeboat (src/main/secrets-lifeboat.js): that file is one payload with counts, a
//     preview, a verify step and a restore for each of its three kinds, and adding a fourth would touch every one of them;
//     an address book is not a secret worth that risk. addresses.dat is in the "erase secure data" list (secure-stores.js);
//   - nothing is filled by this module: it only keeps and lists the addresses. The window fills one into a checkout form only when
//     the person asks (Ctrl+K) and has seen exactly what goes to which site (js/saved-addresses.js);
//   - Lock Vex covers it: a locked Vex lists, gives out and saves nothing; and every channel is closed in a private window.
//
// An address is { id, label, name, street, city, postcode, country, phone, updatedAt }. The checks are pure functions so the
// window and the tests read one definition.
const path = require('path');
const crypto = require('crypto');
const { atomicWrite } = require('./file-store');

const MAX_ADDRESSES = 20;
const LIMITS = Object.freeze({ label: 40, name: 80, street: 160, city: 80, postcode: 20, country: 80, phone: 30 });
const FIELDS = Object.freeze(['label', 'name', 'street', 'city', 'postcode', 'country', 'phone']);

// One line of text: control characters out, runs of spaces folded, cut to the field's limit.
function tidy(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Checks what a person entered and returns the clean record, or throws a message in words.
function cleanAddress(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const f of FIELDS) out[f] = tidy(src[f], LIMITS[f]);
  if (!out.name) throw new Error('An address needs a name');
  if (!out.street) throw new Error('An address needs a street');
  if (!out.city) throw new Error('An address needs a city');
  if (out.postcode && !/^[\p{L}\p{N} -]{2,20}$/u.test(out.postcode)) throw new Error('A postcode has letters, digits, spaces and dashes only');
  if (out.phone && !/^[+\d][\d ()./-]{4,29}$/.test(out.phone)) throw new Error('A phone number has digits, spaces and + ( ) - . / only');
  if (!out.label) out.label = (out.street + ', ' + out.city).slice(0, LIMITS.label);
  return out;
}

// What the window's list may see: enough to tell the addresses apart, not the street or the phone.
function publicView(a) {
  // The default label is "street, city"; the list must not carry the street, so a label that contains it is shown as "name, city".
  const label = a.label || '';
  const hidesStreet = a.street && label.toLowerCase().includes(String(a.street).toLowerCase());
  const shown = hidesStreet ? [a.name, a.city].filter(Boolean).join(', ').slice(0, LIMITS.label) : label;
  return { id: a.id, label: shown, name: a.name || '', city: a.city || '', country: a.country || '', updatedAt: a.updatedAt };
}

function createAddressService({ app, safeStorage, ipcMain, isLocked = () => false, now = () => new Date(), fsImpl = require('fs') }) {
  let cache = null;
  let writes = Promise.resolve();
  const FILE = () => path.join(app.getPath('userData'), 'addresses.dat');

  function load() {
    if (isLocked()) throw new Error('Vex is locked — unlock it to use saved addresses');
    if (cache) return structuredClone(cache);
    if (!fsImpl.existsSync(FILE())) return [];
    try {
      const arr = JSON.parse(safeStorage.decryptString(fsImpl.readFileSync(FILE())));
      if (!Array.isArray(arr)) throw new Error('Invalid address file format');
      cache = arr;
      return structuredClone(arr);
    } catch (err) {
      console.error('[Addresses] load failed:', err.message);
      throw new Error('Cannot read the encrypted address file; existing data has been preserved', { cause: err });
    }
  }
  async function save(arr) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption unavailable');
    const bytes = safeStorage.encryptString(JSON.stringify(arr));
    cache = structuredClone(arr);
    writes = writes.catch(() => { /* vex-allow-empty-catch: that failure was already thrown to the save that caused it */ }).then(() => atomicWrite(FILE(), bytes));
    try { await writes; } catch (error) { cache = null; throw error; }
  }

  ipcMain.handle('addresses:list', () => load().map(publicView));

  // The whole address, for the window to edit it or to fill it after the person confirmed.
  ipcMain.handle('addresses:get', (_e, id) => {
    const a = load().find(x => x.id === id);
    if (!a) return null;
    const out = { id: a.id };
    for (const f of FIELDS) out[f] = a[f] || '';
    return out;
  });

  // Without an id: a new address. With one: that address, changed.
  ipcMain.handle('addresses:save', async (_e, entry) => {
    try {
      const clean = cleanAddress(entry);
      const arr = load();
      const id = entry && typeof entry.id === 'string' ? entry.id : '';
      if (id) {
        const existing = arr.find(a => a.id === id);
        if (!existing) return { ok: false, error: 'That address is not saved any more' };
        Object.assign(existing, clean, { updatedAt: now().toISOString() });
        await save(arr);
        return { ok: true, updated: true, address: publicView(existing) };
      }
      if (arr.length >= MAX_ADDRESSES) return { ok: false, error: 'Vex keeps up to ' + MAX_ADDRESSES + ' addresses: remove one first' };
      const address = { id: crypto.randomUUID(), ...clean, updatedAt: now().toISOString() };
      arr.push(address);
      await save(arr);
      return { ok: true, updated: false, address: publicView(address) };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('addresses:delete', async (_e, id) => {
    try {
      await save(load().filter(a => a.id !== id));
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  return { flushAddresses: () => writes, load, save };
}

module.exports = { createAddressService, cleanAddress, publicView, tidy, MAX_ADDRESSES, LIMITS, FIELDS };
