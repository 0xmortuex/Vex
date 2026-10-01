// === Vex Mobile — the vault ===
//
// Logins and two-factor codes, the desktop's two autofill features on a phone.
// Three rules shape it:
//
//   1. Nothing is captured behind your back. The desktop watches form
//      submissions; here you tap "Save this login", and what gets saved is
//      read out of the fields you can see. A browser that quietly harvests
//      passwords is a browser you cannot audit.
//   2. The vault is one encrypted blob under an Android Keystore key
//      (VexVault), never a preference file, and never synced — a phone is
//      lost more often than a PC.
//   3. Filling is always a tap, and never submits the form for you.
//
// Two-factor codes are RFC 6238 TOTP, computed with WebCrypto: the secret is
// stored beside the login and the code is worked out on the device.

const VexVault = (() => {
  const KEY = 'vex.logins';
  const LOCK_AFTER_MS = 5 * 60 * 1000;

  let entries = null;          // decrypted, in memory only while unlocked
  let unlockedAt = 0;

  function hostOf(url) { return VexSearch.prettyHost(url); }

  function locked() {
    return entries === null || Date.now() - unlockedAt > LOCK_AFTER_MS;
  }

  async function read() {
    const raw = await VexBridge.vaultGet(KEY);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }

  async function write(next) {
    entries = next;
    unlockedAt = Date.now();
    await VexBridge.vaultSet(KEY, JSON.stringify(next));
  }

  // ── TOTP ─────────────────────────────────────────────────────────────────
  const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  function base32Decode(secret) {
    const clean = String(secret || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
    let bits = 0, value = 0;
    const bytes = [];
    for (const character of clean) {
      const index = BASE32.indexOf(character);
      if (index < 0) continue;
      value = (value << 5) | index;
      bits += 5;
      if (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return new Uint8Array(bytes);
  }

  // SHA-1 is what nearly every site uses; a QR code can ask for the others.
  const HASHES = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };

  async function totp(secret, { digits = 6, period = 30, algorithm = 'SHA1', at = Date.now() } = {}) {
    const keyBytes = base32Decode(secret);
    if (!keyBytes.length) throw new Error('That does not look like a 2FA secret');
    digits = [6, 7, 8].includes(Number(digits)) ? Number(digits) : 6;
    period = Number(period) > 0 ? Number(period) : 30;
    const hash = HASHES[String(algorithm || 'SHA1').toUpperCase().replace('-', '')] || 'SHA-1';
    const counter = Math.floor(at / 1000 / period);
    const message = new ArrayBuffer(8);
    const view = new DataView(message);
    view.setUint32(0, Math.floor(counter / 0x100000000));
    view.setUint32(4, counter >>> 0);
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash }, false, ['sign']);
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
    const offset = signature[signature.length - 1] & 0x0f;
    const binary = ((signature[offset] & 0x7f) << 24)
      | ((signature[offset + 1] & 0xff) << 16)
      | ((signature[offset + 2] & 0xff) << 8)
      | (signature[offset + 3] & 0xff);
    return String(binary % Math.pow(10, digits)).padStart(digits, '0');
  }

  function secondsLeft(period = 30) {
    return period - Math.floor((Date.now() / 1000) % period);
  }

  // otpauth://totp/Label?secret=ABC&issuer=X — what a QR code carries.
  // ── Making one up ────────────────────────────────────────────────────────
  // A saved password that you chose is usually one you have used before. This
  // makes one you have not: crypto.getRandomValues, rejection sampling so the
  // alphabet is not biased by a modulo, and at least one character from each
  // class that was asked for so a site's own rules do not reject it.
  const CLASSES = {
    lower: 'abcdefghijkmnopqrstuvwxyz',       // no l
    upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',        // no I, no O
    digits: '23456789',                       // no 0, no 1
    symbols: '!#$%&*+-=?@^_~'
  };

  function pick(alphabet) {
    // Rejection sampling: 256 % alphabet.length is almost never zero, so taking
    // a byte modulo the length would favour the first few characters.
    const limit = 256 - (256 % alphabet.length);
    const byte = new Uint8Array(1);
    for (;;) {
      crypto.getRandomValues(byte);
      if (byte[0] < limit) return alphabet[byte[0] % alphabet.length];
    }
  }

  function makePassword({ length = 20, symbols = true, digits = true, upper = true } = {}) {
    const wanted = ['lower'];
    if (upper) wanted.push('upper');
    if (digits) wanted.push('digits');
    if (symbols) wanted.push('symbols');
    const alphabet = wanted.map(name => CLASSES[name]).join('');
    const size = Math.max(8, Math.min(64, Math.round(length)));

    // One from each class first, then the rest from everything, then shuffled —
    // otherwise the classes are always in the same order at the front.
    const out = wanted.map(name => pick(CLASSES[name]));
    while (out.length < size) out.push(pick(alphabet));
    // Fisher-Yates, with the same rejection sampling: a byte modulo (index + 1)
    // would favour the low positions just as it favoured the low characters.
    for (let index = out.length - 1; index > 0; index--) {
      const span = index + 1;
      const limit = 256 - (256 % span);
      const swap = new Uint8Array(1);
      do { crypto.getRandomValues(swap); } while (swap[0] >= limit);
      const other = swap[0] % span;
      [out[index], out[other]] = [out[other], out[index]];
    }
    return out.join('');
  }

  function parseOtpAuth(uri) {
    try {
      const parsed = new URL(uri);
      if (parsed.protocol !== 'otpauth:') return null;
      const secret = parsed.searchParams.get('secret');
      if (!secret) return null;
      const label = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
      return {
        secret,
        issuer: parsed.searchParams.get('issuer') || label.split(':')[0] || '',
        account: label.includes(':') ? label.split(':')[1] : label,
        digits: Number(parsed.searchParams.get('digits')) || 6,
        period: Number(parsed.searchParams.get('period')) || 30,
        algorithm: (parsed.searchParams.get('algorithm') || 'SHA1').toUpperCase()
      };
    } catch { return null; }
  }

  // ── Filling a page ───────────────────────────────────────────────────────
  // Runs inside the page. It fills the fields and fires the events frameworks
  // listen for, and it never submits: the last step stays yours.
  // The host is checked again in the page, at the moment of filling: the tab
  // can have moved on between the sheet being opened and the tap on it, and a
  // password typed into whatever page happens to be there by then is the
  // whole of phishing.
  const FILL = (username, password, host) => `(function(){
  var expected = ${JSON.stringify(host || '')};
  var here = location.hostname.replace(/^www\\./, '');
  if (expected && here !== expected && here.slice(-(expected.length + 1)) !== '.' + expected) return 'wrong-host';
  function setValue(field, value) {
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }
  var password = document.querySelector('input[type=password]:not([disabled])');
  if (!password) return 'no-password-field';
  var form = password.form || document;
  var user = form.querySelector('input[autocomplete="username"], input[type=email], input[name*=user i], input[name*=email i], input[id*=user i], input[id*=email i]');
  if (user) setValue(user, ${JSON.stringify(username)});
  setValue(password, ${JSON.stringify(password)});
  password.focus();
  return 'filled';
})()`;

  // Reads what is in the fields right now, for "save this login".
  const READ_FIELDS = `(function(){
  var password = document.querySelector('input[type=password]:not([disabled])');
  if (!password) return JSON.stringify({ ok: false });
  var form = password.form || document;
  var user = form.querySelector('input[autocomplete="username"], input[type=email], input[name*=user i], input[name*=email i], input[id*=user i], input[id*=email i]');
  return JSON.stringify({ ok: true, username: user ? user.value : '', password: password.value });
})()`;

  const HAS_PASSWORD_FIELD = "(function(){return !!document.querySelector('input[type=password]:not([disabled])')})()";

  // The other half of autofill: the checkout and sign-up forms that want your
  // name, your email, your address. Card numbers are deliberately not here —
  // a browser that types a card number into a page it does not understand is
  // a browser that will one day type it into the wrong one.
  const PROFILE_FIELDS = [
    ['name', 'Full name', ['name', 'fullname', 'full-name', 'your-name']],
    ['email', 'Email', ['email', 'e-mail']],
    ['phone', 'Phone', ['phone', 'tel', 'mobile']],
    ['address', 'Street address', ['address', 'street', 'address-line1', 'addr']],
    ['city', 'City', ['city', 'town', 'locality']],
    ['postcode', 'Post code', ['zip', 'postal', 'postcode']],
    ['country', 'Country', ['country']]
  ];

  const FILL_PROFILE = profile => `(function(){
  var map = ${JSON.stringify(PROFILE_FIELDS.map(([key, , hints]) => [key, hints]))};
  var values = ${JSON.stringify(profile)};
  function setValue(field, value) {
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }
  var filled = 0;
  var inputs = document.querySelectorAll('input:not([type=hidden]):not([type=password]):not([disabled]), textarea');
  for (var i = 0; i < inputs.length; i++) {
    var field = inputs[i];
    var marker = ((field.name || '') + ' ' + (field.id || '') + ' ' + (field.autocomplete || '')
      + ' ' + (field.placeholder || '')).toLowerCase();
    for (var j = 0; j < map.length; j++) {
      var key = map[j][0], hints = map[j][1];
      if (!values[key]) continue;
      var matched = false;
      for (var k = 0; k < hints.length; k++) if (marker.indexOf(hints[k]) >= 0) matched = true;
      if (matched && !field.value) { setValue(field, values[key]); filled++; break; }
    }
  }
  return String(filled);
})()`;

  return {
    totp, secondsLeft, parseOtpAuth, base32Decode,
    makePassword,

    locked,

    async count() { return (await read()).length; },

    /** A fingerprint (or the device PIN) opens it, and it re-locks itself. */
    async unlock(reason = 'Unlock your logins') {
      if (!locked()) return true;
      const check = await VexBridge.authenticate('Vex', reason);
      if (!check.ok) return false;
      entries = await read();
      unlockedAt = Date.now();
      return true;
    },

    lock() { entries = null; unlockedAt = 0; },

    all() { return locked() ? [] : entries.slice(); },

    forHost(host) {
      if (locked() || !host) return [];
      return entries.filter(entry => entry.host === host || host.endsWith('.' + entry.host));
    },

    // Is there anything for this page? Answerable while locked, because it
    // only needs the hosts — which are kept unencrypted for exactly this, so
    // the "fill" button can appear without a fingerprint prompt first.
    knownHosts() { return VexStore.get('vex.loginHosts', []); },

    hasFor(host) {
      if (!host) return false;
      return this.knownHosts().some(known => host === known || host.endsWith('.' + known));
    },

    async save({ host, username, password, secret, label, digits, period, algorithm }) {
      if (!(await this.unlock('Save this login'))) throw new Error('Not unlocked');
      const now = Date.now();
      // The whole otpauth:// address (what a QR code carries) is accepted in
      // the secret field, so its digits, period and algorithm come with it.
      if (secret && /^otpauth:/i.test(secret)) {
        const parsed = parseOtpAuth(secret);
        if (!parsed) throw new Error('That 2FA code could not be read');
        secret = parsed.secret;
        digits = parsed.digits; period = parsed.period; algorithm = parsed.algorithm;
      }
      const code = secret ? { digits: digits || 6, period: period || 30, algorithm: algorithm || 'SHA1' } : {};
      const existing = entries.find(entry => entry.host === host && entry.username === username);
      if (existing) {
        Object.assign(existing, {
          password: password || existing.password,
          secret: secret !== undefined ? secret : existing.secret,
          label: label || existing.label,
          at: now
        }, secret ? code : {});
      } else {
        entries.unshift(Object.assign({
          id: VexCollections.id('lg_'), host, username: username || '', password: password || '',
          secret: secret || '', label: label || host, at: now
        }, code));
      }
      await write(entries);
      await VexStore.set('vex.loginHosts', [...new Set(entries.map(entry => entry.host))]);
      return true;
    },

    async remove(entryId) {
      if (locked()) return false;
      await write(entries.filter(entry => entry.id !== entryId));
      await VexStore.set('vex.loginHosts', [...new Set(entries.map(entry => entry.host))]);
      return true;
    },

    async clear() {
      await VexBridge.vaultSet(KEY, '');
      await VexStore.set('vex.loginHosts', []);
      entries = [];
    },

    // ── The page ───────────────────────────────────────────────────────────
    async pageHasLoginForm(tabId) {
      try {
        const { result } = await VexBridge.evaluate(tabId, HAS_PASSWORD_FIELD);
        return String(result) === 'true';
      } catch { return false; }
    },

    /**
     * Fill a login into the page. Only on its own site (or a subdomain of it)
     * unless `anyHost` says the person was asked and said yes; the check runs
     * in the page itself, so a tab that navigated in the meantime gets
     * nothing. Returns 'filled', 'wrong-host' or 'no-form'.
     */
    async fill(tabId, entry, { anyHost = false } = {}) {
      const { result } = await VexBridge.evaluate(tabId,
        FILL(entry.username || '', entry.password || '', anyHost ? '' : entry.host));
      const said = String(result || '');
      if (said.includes('wrong-host')) return 'wrong-host';
      return said.includes('filled') ? 'filled' : 'no-form';
    },

    /** Whether a login belongs on this host: the same site or a subdomain of it. */
    belongsOn(entry, host) {
      if (!entry || !host) return false;
      const clean = String(host).replace(/^www\./, '');
      return clean === entry.host || clean.endsWith('.' + entry.host);
    },

    /** The 2FA settings an entry was saved with, for totp(). */
    codeOptions(entry) {
      return {
        digits: (entry && entry.digits) || 6,
        period: (entry && entry.period) || 30,
        algorithm: (entry && entry.algorithm) || 'SHA1'
      };
    },

    // evaluate() hands back a JSON string, and some WebViews encode it twice.
    // Unwrap up to twice and take whatever turns into the object we asked for.
    async readFields(tabId) {
      const { result } = await VexBridge.evaluate(tabId, READ_FIELDS);
      let value = result;
      for (let attempt = 0; attempt < 2 && typeof value === 'string'; attempt++) {
        try { value = JSON.parse(value); } catch { return null; }
      }
      return value && typeof value === 'object' && value.ok ? value : null;
    },

    // ── Your details ───────────────────────────────────────────────────────
    PROFILE_FIELDS,

    profile() {
      const stored = VexStore.get('vex.profile', null);
      return stored && typeof stored === 'object' ? stored : {};
    },

    async saveProfile(profile) {
      const clean = {};
      for (const [key] of PROFILE_FIELDS) {
        const value = String((profile || {})[key] || '').trim();
        if (value) clean[key] = value.slice(0, 200);
      }
      await VexStore.set('vex.profile', Object.keys(clean).length ? clean : null);
      return clean;
    },

    hasProfile() { return Object.keys(this.profile()).length > 0; },

    async fillProfile(tabId) {
      const profile = this.profile();
      if (!Object.keys(profile).length) return 0;
      const { result } = await VexBridge.evaluate(tabId, FILL_PROFILE(profile));
      return Number(String(result).replace(/"/g, '')) || 0;
    },

    hostOf
  };
})();

if (typeof window !== 'undefined') window.VexVault = VexVault;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexVault };
