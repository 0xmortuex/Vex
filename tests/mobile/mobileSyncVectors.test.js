// @vitest-environment node
//
// Sync, step one: the bytes. Before the phone may talk to an account it has to
// produce exactly what the desktop produces and read exactly what the desktop
// writes. Each vector here was computed independently (Node's own AES-GCM in
// node:crypto, not WebCrypto) and is checked byte for byte against the files
// the phone runs (www/js/shared/, copied verbatim from the desktop).
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import nodeCrypto from 'node:crypto';

globalThis.window = globalThis;
require('../../mobile/www/js/shared/sync-crypto.js');
const records = require('../../mobile/www/js/shared/sync-records.js');
const SyncCrypto = globalThis.SyncCrypto;

// Key 00 01 02 … 1f, IV a0 a1 … ab.
const KEY = Uint8Array.from({ length: 32 }, (_, i) => i);
const IV = Uint8Array.from({ length: 12 }, (_, i) => 0xa0 + i);
const KEY_HEX = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const RECOVERY = '00010203-04050607-08090A0B-0C0D0E0F-10111213-14151617-18191A1B-1C1D1E1F';

// A one-bookmark schema-2 document with the characters that trip encoders up:
// a slash in a URL (must not become \/), a quote, non-ASCII, an emoji.
const PLAINTEXT = '{"schema":2,"records":{"[\\"preference:vex.bookmarks\\",\\"item\\",\\"bm1\\"]":'
  + '{"clock":{"phone1":1},"deleted":false,"value":{"index":0,"item":{"id":"bm1","url":"https://example.com/a/b?q=1",'
  + '"title":"Café \\"quoted\\" ☕","folder":"","at":1700000000000}},"at":1700000000000,"conflicts":[]}}}';
const CIPHERTEXT = 'oKGio6SlpqeoqaqrnToPTi2ub95AX7X/JQilvR/ePWOwjTlOx1IE9g3OE2SgEymcyhglWCeyZqdmEe6YNXA1FED8RlwoKm4z+FKp7Jbe6F5sh7nCzpnde+Ohr9HvMdCGtan2FItEHKCA52G26+FHznfL67mkvWc89u3BClIxDdu7F6FHDaawwNEt0Hf1PZIWpyftNQ0i3OJ2aKv06rScSZLyj/6R74fXx7NAW7UiMJ7TEiF78mZODAy9284WCZ+nc1ufHK6gAlAo7np1DhQPqAYSEs2vfzG6JlBX0Q7LxAqn9vqUz6c3iTmjqEVScxANmwytHfqNdW9yO3BPO43yD7liDfpHj8weRwkZpScP+bff/JLQVpNnqUVYA71efWMzz8nhEKM6a6ef90IzERgsmsoxgSzUN0SmVA==';

let key;
beforeAll(async () => { key = await SyncCrypto.importKey(KEY); });
afterEach(() => vi.restoreAllMocks());

describe('the recovery code is the raw key', () => {
  it('formats the 32 bytes as 8 groups of 8 hex digits, upper case', () => {
    expect(SyncCrypto.keyToHex(KEY)).toBe(KEY_HEX);
    expect(SyncCrypto.formatRecoveryCode(KEY_HEX)).toBe(RECOVERY);
  });

  it('reads it back however it was typed: case, dashes, spaces', () => {
    for (const typed of [RECOVERY, RECOVERY.toLowerCase(), RECOVERY.replace(/-/g, ' '), KEY_HEX]) {
      expect(SyncCrypto.parseRecoveryCode(typed)).toBe(KEY_HEX);
      expect([...SyncCrypto.hexToKey(SyncCrypto.parseRecoveryCode(typed))]).toEqual([...KEY]);
    }
  });

  it('refuses a code that is not 64 hex digits — no derivation, no padding', () => {
    expect(() => SyncCrypto.hexToKey(KEY_HEX.slice(1))).toThrow(/64 hex/);
    expect(() => SyncCrypto.hexToKey(KEY_HEX + '0')).toThrow(/64 hex/);
    expect(() => SyncCrypto.hexToKey('zz' + KEY_HEX.slice(2))).toThrow(/64 hex/);
  });
});

describe('the blob: base64(IV ‖ ciphertext ‖ tag), AES-256-GCM, JSON inside', () => {
  it('matches an independent AES-GCM implementation byte for byte', async () => {
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(array => { array.set(IV); return array; });
    const blob = await SyncCrypto.encrypt(JSON.parse(PLAINTEXT), key);
    expect(blob).toBe(CIPHERTEXT);

    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', Buffer.from(KEY), Buffer.from(IV));
    const independent = Buffer.concat([Buffer.from(IV), cipher.update(PLAINTEXT, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64');
    expect(independent).toBe(CIPHERTEXT);
  });

  it('decrypts the vector to the exact document', async () => {
    const document = await SyncCrypto.decrypt(CIPHERTEXT, key);
    expect(JSON.stringify(document)).toBe(PLAINTEXT);
  });

  it('decrypts what node:crypto encrypts with a random IV', async () => {
    const iv = nodeCrypto.randomBytes(12);
    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', Buffer.from(KEY), iv);
    const blob = Buffer.concat([iv, cipher.update(PLAINTEXT, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64');
    expect(JSON.stringify(await SyncCrypto.decrypt(blob, key))).toBe(PLAINTEXT);
  });

  it('rejects a wrong key as OperationError — which is how a wrong recovery code is told apart', async () => {
    const other = await SyncCrypto.importKey(Uint8Array.from({ length: 32 }, (_, i) => 255 - i));
    await expect(SyncCrypto.decrypt(CIPHERTEXT, other)).rejects.toHaveProperty('name', 'OperationError');
  });

  it('rejects a blob with one bit flipped', async () => {
    const bytes = Buffer.from(CIPHERTEXT, 'base64');
    bytes[40] ^= 1;
    await expect(SyncCrypto.decrypt(bytes.toString('base64'), key)).rejects.toHaveProperty('name', 'OperationError');
  });

  it('uses a fresh IV for every encryption', async () => {
    const a = Buffer.from(await SyncCrypto.encrypt({ x: 1 }, key), 'base64').subarray(0, 12);
    const b = Buffer.from(await SyncCrypto.encrypt({ x: 1 }, key), 'base64').subarray(0, 12);
    expect(a.equals(b)).toBe(false);
  });
});

describe('record keys are JSON arrays, byte for byte', () => {
  it('writes them exactly as the desktop does', () => {
    const flat = records.flatten({
      'preference:vex.bookmarks': [{ id: 'bm1', url: 'https://a.example/x/y', title: 'A', folder: '', at: 1 }],
      'sync:device:abc123': { level: 1 }
    });
    expect(Object.keys(flat)).toEqual([
      '["preference:vex.bookmarks","type"]',
      '["preference:vex.bookmarks","item","bm1"]',
      '["sync:device:abc123","type"]',
      '["sync:device:abc123","value"]'
    ]);
    expect(flat['["preference:vex.bookmarks","type"]']).toBe('array');
    expect(flat['["sync:device:abc123","type"]']).toBe('scalar');
    expect(flat['["sync:device:abc123","value"]']).toEqual({ level: 1 });
    expect(flat['["preference:vex.bookmarks","item","bm1"]']).toEqual({ index: 0, item: { id: 'bm1', url: 'https://a.example/x/y', title: 'A', folder: '', at: 1 } });
  });

  it('never escapes a slash, and escapes only what JSON must', () => {
    expect(JSON.stringify(['preference:vex.history', 'item', 'https://a.example/p:2026'])).toBe('["preference:vex.history","item","https://a.example/p:2026"]');
    expect(JSON.stringify(['s', 'item', 'é"☕\\'])).toBe('["s","item","é\\"☕\\\\"]');
  });

  it('keeps the order and number formatting of a record it passes through', () => {
    // A desktop record whose keys are not in any order the phone would choose,
    // with numbers JSON writes in one way only.
    const text = '{"value":{"z":1,"a":2,"index":3,"item":{"url":"https://x.example/","id":"q","at":1e+21,"n":-0.5}},"deleted":false,"clock":{"b":2,"a":1}}';
    expect(JSON.stringify(JSON.parse(text))).toBe(text);
  });

  it('a device id and a clock name both pass the desktop’s validation', () => {
    const document = records.capture(records.empty(), records.flatten({ 'sync:device:0123456789abcdef0123456789abcdef': { level: 1 } }),
      '0123456789abcdef0123456789abcdef');
    expect(() => records.valid(document)).not.toThrow();
  });
});

// ── The spec's own vectors (docs/SYNC_PROTOCOL.md §3.6 and §4.6) ─────────────
// Read out of the spec itself, so these are its bytes, not a retyping of them.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const SPEC = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'SYNC_PROTOCOL.md'), 'utf8');
const SECTION = SPEC.slice(SPEC.indexOf('### 3.6 Test vector'), SPEC.indexOf('## 4. Document'));
const BLOCKS = [...SECTION.matchAll(/```[a-z]*\n([\s\S]*?)\n```/g)].map(match => match[1]);
const SPEC_SOURCES = JSON.parse(BLOCKS[1]);
const SPEC_PLAINTEXT = BLOCKS[2];
const SPEC_BLOB = BLOCKS[3];
const SPEC_HANDOFF = BLOCKS[4];
const SPEC_DEVICE = '0123456789abcdef0123456789abcdef';
const SPEC_NOW = 1767225600000;

describe('spec §3.6 — the document vector', () => {
  it('is the vector the spec states: 808 bytes, 836 before base64, tag cd449705…', () => {
    expect(Buffer.byteLength(SPEC_PLAINTEXT, 'utf8')).toBe(808);
    const bytes = Buffer.from(SPEC_BLOB, 'base64');
    expect(bytes.length).toBe(836);
    expect(bytes.subarray(0, 12).toString('hex')).toBe('a0a1a2a3a4a5a6a7a8a9aaab');
    expect(bytes.subarray(-16).toString('hex')).toBe('cd449705d23588dceb36f06f9d4beb40');
    expect(BLOCKS[0]).toContain(RECOVERY);
    expect(BLOCKS[0]).toContain(KEY_HEX);
  });

  it('1. decrypts to the plaintext byte for byte', async () => {
    const document = await SyncCrypto.decrypt(SPEC_BLOB, key);
    expect(JSON.stringify(document)).toBe(SPEC_PLAINTEXT);
    // And the raw bytes, not only the round trip through JSON.
    const bytes = Buffer.from(SPEC_BLOB, 'base64');
    const raw = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
    expect(Buffer.from(raw).toString('utf8')).toBe(SPEC_PLAINTEXT);
  });

  it('2. encrypts the plaintext, with the fixed IV, to the blob byte for byte', async () => {
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(array => { array.set(IV); return array; });
    expect(await SyncCrypto.encrypt(JSON.parse(SPEC_PLAINTEXT), key)).toBe(SPEC_BLOB);
  });

  it('3. the desktop’s flatten and capture rebuild the plaintext from the spec’s sources', () => {
    vi.spyOn(Date, 'now').mockReturnValue(SPEC_NOW);
    const document = records.capture(records.empty(), records.flatten(SPEC_SOURCES), SPEC_DEVICE);
    expect(JSON.stringify(document)).toBe(SPEC_PLAINTEXT);
  });

  it('3′. so does the phone’s own pipeline, from a phone holding that one bookmark', () => {
    vi.spyOn(Date, 'now').mockReturnValue(SPEC_NOW);
    // The phone's sync.js and bookmark store, with the spec's bookmark in it
    // (plus the icon the phone keeps for itself, which must not travel).
    const store = new Map([['vex.bookmarks', [{ ...SPEC_SOURCES['preference:vex.bookmarks'][0], icon: 'https://example.com/favicon.ico' }]]]);
    const context = {
      console, crypto: globalThis.crypto, TextEncoder, TextDecoder, atob, btoa, URL, AbortController,
      setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
      VexStore: { get: (k, f) => (store.has(k) ? store.get(k) : f), set: async (k, v) => store.set(k, v) },
      VexBridge: { vaultGet: async () => null, vaultSet: async () => {} },
      VexDB: { get: async () => undefined, put: async () => {}, delete: async () => {} }
    };
    context.window = context;
    vm.createContext(context);
    for (const file of ['shared/sync-crypto.js', 'shared/sync-records.js', 'shared/data-contracts.js', 'collections.js', 'sync.js']) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'www', 'js', file), 'utf8'), context);
    }
    context.Date = Date;
    context.VexSync.state.deviceId = SPEC_DEVICE;
    const document = context.VexSync._captureOwned({ schema: 2, records: {} });
    expect(JSON.stringify(document)).toBe(SPEC_PLAINTEXT);
  });

  it('the handoff vector: {url, title} with the same key and IV', async () => {
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(array => { array.set(IV); return array; });
    expect(await SyncCrypto.encrypt({ url: 'https://example.com/', title: 'Example' }, key)).toBe(SPEC_HANDOFF);
    vi.restoreAllMocks();
    expect(await SyncCrypto.decrypt(SPEC_HANDOFF, key)).toEqual({ url: 'https://example.com/', title: 'Example' });
  });

  it('the first blob with key ff…ff fails authentication (OperationError)', async () => {
    const wrong = await SyncCrypto.importKey(new Uint8Array(32).fill(0xff));
    await expect(SyncCrypto.decrypt(SPEC_BLOB, wrong)).rejects.toHaveProperty('name', 'OperationError');
  });
});

describe('spec §4.6 — tile ids', () => {
  // The table in §4.6, read from the spec.
  const table = SPEC.slice(SPEC.indexOf('Vectors (from running the real `withTileIds`)'), SPEC.indexOf('Because it hashes code points'));
  const rows = [...table.matchAll(/^\| `([^`]+)`(?: \([^)]*\))? \| `([^`]+)` \|$/gm)].map(match => [match[1], match[2]]);

  it('has the six rows the spec lists', () => {
    expect(rows.length).toBe(6);
  });

  it('the phone’s tileIds gives every id in the table, in list order', () => {
    const context = { console, window: null };
    context.window = context;
    context.VexStore = { get: (k, f) => f, set: async () => {} };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'www', 'js', 'sync.js'), 'utf8'), context);
    const ids = context.VexSync.tileIds(rows.map(([url]) => ({ url })));
    expect(ids).toEqual(rows.map(([, id]) => id));
  });

  it('agrees with the desktop’s own withTileIds on the same list', () => {
    // sync-engine.js keeps withTileIds private; its text is the reference.
    const engine = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'js', 'sync-engine.js'), 'utf8');
    const source = engine.slice(engine.indexOf('function withTileIds'), engine.indexOf('const withoutTileIds'));
    const withTileIds = vm.runInNewContext('(' + source + ')');
    const desktopIds = withTileIds(rows.map(([url]) => ({ url }))).map(tile => tile.id);
    expect(desktopIds).toEqual(rows.map(([, id]) => id));
  });
});
