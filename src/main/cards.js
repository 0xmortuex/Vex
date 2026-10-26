// === Saved payment cards — encrypted at rest with safeStorage (Windows DPAPI) ==
//
// Modelled on main/vault.js, with the rules the owner chose (2026-10-26):
//   - the CVV is NEVER stored, sent or logged: only the number, the name on the
//     card, the expiry and a nickname are kept; the three digits are typed each
//     time (card networks' rules say a CVV must not be kept after a payment);
//   - this device only: no Vex Sync, no backup, no export, nothing leaves the
//     profile folder;
//   - cards.dat is sealed by the operating system; if safeStorage is not
//     available Vex refuses to save rather than writing plaintext;
//   - the list the window shows carries the brand, the last four digits, the
//     name and the expiry: the full number crosses IPC only for cards:reveal,
//     which the window asks for after the person pressed "Fill";
//   - Lock Vex covers it: a locked Vex lists, reveals and saves nothing.
//
// The checks live here as pure functions (digits, Luhn, brand, expiry) so the
// window, the page script and the tests read one definition.
const path = require('path');
const crypto = require('crypto');
const { atomicWrite } = require('./file-store');

const MAX_CARDS = 50;

// Digits only: spaces, dashes and dots people type are dropped.
function digitsOf(value) { return String(value == null ? '' : value).replace(/[\s.-]+/g, ''); }

// The Luhn check every card number passes: it catches a mistyped digit.
function luhnOk(digits) {
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

// The brand from the leading digits (the published ranges), or 'card'.
function brandOf(digits) {
  const d = digitsOf(digits);
  if (/^4/.test(d)) return 'Visa';
  if (/^(5[1-5]|2(2[2-9][1-9]|2[3-9]\d|[3-6]\d\d|7[01]\d|720))/.test(d)) return 'Mastercard';
  if (/^3[47]/.test(d)) return 'American Express';
  if (/^(6011|65|64[4-9])/.test(d)) return 'Discover';
  if (/^35(2[89]|[3-8]\d)/.test(d)) return 'JCB';
  if (/^3(0[0-5]|09|[68])/.test(d)) return 'Diners Club';
  if (/^(62|81)/.test(d)) return 'UnionPay';
  if (/^9792/.test(d)) return 'Troy';
  return 'card';
}

// An expiry as { month: 1-12, year: four digits }, or null. Takes 'MM/YY', 'MM/YYYY', 'MMYY', or the two parts.
function parseExpiry(month, year) {
  let m = month, y = year;
  if (y === undefined || y === null || y === '') {
    const text = String(m == null ? '' : m).trim();
    const hit = /^(\d{1,2})\s*[/\-.]?\s*(\d{2}|\d{4})$/.exec(text);
    if (!hit) return null;
    m = hit[1]; y = hit[2];
  }
  m = Number(m); y = Number(y);
  if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(y)) return null;
  if (y < 100) y += 2000;
  if (y < 2000 || y > 2100) return null;
  return { month: m, year: y };
}

// Whether a card has run out: it is good through the last day of its month.
function isExpired(expiry, now = new Date()) {
  if (!expiry) return false;
  const year = now.getFullYear(), month = now.getMonth() + 1;
  return expiry.year < year || (expiry.year === year && expiry.month < month);
}

// What the window may see: never the full number.
function publicView(card) {
  return {
    id: card.id, nickname: card.nickname || '', brand: card.brand, last4: card.number.slice(-4), name: card.name || '',
    expMonth: card.expMonth, expYear: card.expYear, expired: isExpired({ month: card.expMonth, year: card.expYear }),
    updatedAt: card.updatedAt,
  };
}

// Checks what a person entered and returns the clean record, or throws a message in words.
function cleanCard(input) {
  const src = input || {};
  const number = digitsOf(src.number);
  if (!/^\d+$/.test(number)) throw new Error('The card number has to be digits only');
  if (!luhnOk(number)) throw new Error('That card number does not look right: check the digits');
  const expiry = parseExpiry(src.expMonth, src.expYear);
  if (!expiry) throw new Error('The expiry date has to be a month (1 to 12) and a year');
  const name = String(src.name == null ? '' : src.name).replace(/\s+/g, ' ').trim().slice(0, 80);
  const nickname = String(src.nickname == null ? '' : src.nickname).replace(/\s+/g, ' ').trim().slice(0, 40);
  return { number, brand: brandOf(number), name, nickname, expMonth: expiry.month, expYear: expiry.year };
}

function createCardService({ app, safeStorage, ipcMain, isLocked = () => false, now = () => new Date() }) {
  let cache = null;
  let writes = Promise.resolve();
  const FILE = () => path.join(app.getPath('userData'), 'cards.dat');

  function load() {
    if (isLocked()) throw new Error('Vex is locked — unlock it to use saved cards');
    if (cache) return structuredClone(cache);
    const fsx = require('fs');
    if (!fsx.existsSync(FILE())) return [];
    try {
      const arr = JSON.parse(safeStorage.decryptString(fsx.readFileSync(FILE())));
      if (!Array.isArray(arr)) throw new Error('Invalid card file format');
      cache = arr;
      return structuredClone(arr);
    } catch (err) {
      console.error('[Cards] load failed:', err.message);
      throw new Error('Cannot read the encrypted card file; existing data has been preserved', { cause: err });
    }
  }
  async function save(arr) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption unavailable');
    const bytes = safeStorage.encryptString(JSON.stringify(arr));
    cache = structuredClone(arr);
    writes = writes.catch(() => { /* vex-allow-empty-catch: that failure was already thrown to the save that caused it */ }).then(() => atomicWrite(FILE(), bytes));
    try { await writes; } catch (error) { cache = null; throw error; }
  }

  ipcMain.handle('cards:list', () => load().map(publicView));

  // The full details of one card, for the window to type into a payment page
  // after the person pressed "Fill". There is no CVV to give: none is kept.
  ipcMain.handle('cards:reveal', (_e, id) => {
    const card = load().find(c => c.id === id);
    if (!card) return null;
    return { id: card.id, number: card.number, brand: card.brand, name: card.name, expMonth: card.expMonth, expYear: card.expYear };
  });

  // Whether a number is already saved, so the "Save this card?" offer is not made twice. Says yes or no, never the number.
  ipcMain.handle('cards:has', (_e, number) => {
    const digits = digitsOf(number);
    return load().some(c => c.number === digits);
  });

  ipcMain.handle('cards:save', async (_e, entry) => {
    try {
      const clean = cleanCard(entry);
      const arr = load();
      const existing = arr.find(c => c.number === clean.number);
      if (existing) {
        Object.assign(existing, { name: clean.name || existing.name, expMonth: clean.expMonth, expYear: clean.expYear, updatedAt: now().toISOString() });
        if (clean.nickname) existing.nickname = clean.nickname;
        await save(arr);
        return { ok: true, updated: true, card: publicView(existing) };
      }
      if (arr.length >= MAX_CARDS) return { ok: false, error: 'Vex keeps up to ' + MAX_CARDS + ' cards: remove one first' };
      const card = { id: crypto.randomUUID(), ...clean, updatedAt: now().toISOString() };
      arr.push(card);
      await save(arr);
      return { ok: true, updated: false, card: publicView(card) };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // Settings > Payment cards > Edit: the name, the expiry and the nickname. The number is not editable: a different number is a different card.
  ipcMain.handle('cards:update', async (_e, { id, name, expMonth, expYear, nickname } = {}) => {
    try {
      const arr = load();
      const card = arr.find(c => c.id === id);
      if (!card) return { ok: false, error: 'That card is not saved any more' };
      if (expMonth !== undefined || expYear !== undefined) {
        const expiry = parseExpiry(expMonth, expYear);
        if (!expiry) return { ok: false, error: 'The expiry date has to be a month (1 to 12) and a year' };
        card.expMonth = expiry.month; card.expYear = expiry.year;
      }
      if (typeof name === 'string') card.name = name.replace(/\s+/g, ' ').trim().slice(0, 80);
      if (typeof nickname === 'string') card.nickname = nickname.replace(/\s+/g, ' ').trim().slice(0, 40);
      card.updatedAt = now().toISOString();
      await save(arr);
      return { ok: true, card: publicView(card) };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('cards:delete', async (_e, id) => {
    try {
      await save(load().filter(c => c.id !== id));
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  return { flushCards: () => writes, load, save };
}

module.exports = { createCardService, digitsOf, luhnOk, brandOf, parseExpiry, isExpired, cleanCard, publicView, MAX_CARDS };
