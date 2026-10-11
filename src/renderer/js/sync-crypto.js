// === Vex Phase 13: End-to-end encryption primitives ===
// AES-GCM 256. Key is generated locally, exported as raw bytes, and turned
// into a hex "recovery code" the user can paste on another device.

const SyncCrypto = (() => {

  async function generateKey() {
    return crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }

  async function exportKey(key) {
    const raw = await crypto.subtle.exportKey('raw', key);
    return new Uint8Array(raw);
  }

  async function importKey(rawBytes) {
    return crypto.subtle.importKey(
      'raw',
      rawBytes,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }

  // Encode a Uint8Array as a binary-safe base64 string without exceeding the
  // argument count limit of String.fromCharCode for big buffers.
  function bytesToBase64(u8) {
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    }
    return btoa(s);
  }

  function base64ToBytes(b64) {
    const s = atob(b64);
    const u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  }

  async function encrypt(data, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(data));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    const combined = new Uint8Array(iv.length + ct.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ct), iv.length);
    return bytesToBase64(combined);
  }

  async function decrypt(base64, key) {
    const combined = base64ToBytes(base64);
    const iv = combined.slice(0, 12);
    const ct = combined.slice(12);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return JSON.parse(new TextDecoder().decode(pt));
  }

  function keyToHex(keyBytes) {
    return Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function hexToKey(hex) {
    if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/i.test(hex)) throw new Error('Invalid recovery code — must be 64 hex chars');
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    return bytes;
  }

  function formatRecoveryCode(hex) {
    return hex.match(/.{1,8}/g).join('-').toUpperCase();
  }

  function parseRecoveryCode(formatted) {
    return (formatted || '').replace(/[^0-9a-f]/gi, '').toLowerCase();
  }

  // Proof of the sync key (SYNC_PROTOCOL.md §2.7). The server is never sent
  // the sync key: it keeps this auth key, HKDF-SHA256 of the sync key with an
  // empty salt and its own info string, which decrypts nothing.
  const AUTH_INFO = 'vex-sync auth key v1';
  async function authKeyHex(keyBytes) {
    const ikm = await crypto.subtle.importKey('raw', keyBytes, 'HKDF', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(AUTH_INFO) }, ikm, 256);
    return keyToHex(new Uint8Array(bits));
  }

  async function sha256Hex(text) {
    return keyToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
  }

  // HMAC-SHA256(auth key, "vex-sync-proof/1\n<nonce>\n<deviceId>\n<action>\n<details>"), hex.
  async function proof(authHex, nonce, deviceId, action, details) {
    const key = await crypto.subtle.importKey('raw', hexToKey(authHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`vex-sync-proof/1\n${nonce}\n${deviceId}\n${action}\n${details}`));
    return keyToHex(new Uint8Array(mac));
  }

  return {
    generateKey, exportKey, importKey,
    encrypt, decrypt,
    keyToHex, hexToKey,
    formatRecoveryCode, parseRecoveryCode,
    authKeyHex, sha256Hex, proof
  };
})();

window.SyncCrypto = SyncCrypto;
