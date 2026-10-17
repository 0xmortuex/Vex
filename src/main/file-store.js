const fs = require('fs');
const path = require('path');
const { randomUUID, createHash } = require('crypto');

// On Windows another program (Defender, search indexing, a backup tool) can
// hold the file open for a moment; replacing it then fails with EPERM, EBUSY
// or EACCES. Saving settings failed outright and Vex said "Changes could not
// be saved" (seen live, 2026-10-03). Those errors are retried for a few
// seconds; anything else, or a lock that lasts, is still raised.
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RETRY_DELAYS_MS = [20, 50, 100, 200, 400, 800, 1500];
async function withRetry(op, delays = RETRY_DELAYS_MS) {
  for (let attempt = 0; ; attempt++) {
    try { return await op(); }
    catch (e) {
      if (!TRANSIENT.has(e && e.code) || attempt >= delays.length) throw e;
      await new Promise(r => setTimeout(r, delays[attempt]));
    }
  }
}

async function atomicWrite(file, bytes, { backup = true, retryDelays = RETRY_DELAYS_MS } = {}) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    const handle = await fs.promises.open(temp, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    if (backup) {
      try { await withRetry(() => fs.promises.copyFile(file, file + '.bak'), retryDelays); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    await withRetry(() => fs.promises.rename(temp, file), retryDelays);
  } finally { await fs.promises.rm(temp, { force: true }).catch(() => {}); }
}

// A copy of a file that failed its checks, kept beside it (`.corrupt-<stamp>`, the newest three), so
// whatever was in it can still be looked at by hand. Returns the copy's path, or null when there was no file.
const KEEP_CORRUPT = 3;
function keepCorruptCopy(file, now = Date.now()) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date(now).toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const copy = `${file}.corrupt-${stamp}`;
  fs.copyFileSync(file, copy);
  const dir = path.dirname(file), base = path.basename(file) + '.corrupt-';
  for (const n of fs.readdirSync(dir).filter(x => x.startsWith(base)).sort().reverse().slice(KEEP_CORRUPT)) fs.rmSync(path.join(dir, n), { force: true });
  return copy;
}

const dataSum = (data) => createHash('sha256').update(JSON.stringify(data === undefined ? null : data)).digest('hex');
// A file written by a Vex newer than this one: never "recovered" from an older copy, never rewritten.
function newerThanThisVex(what, found, known) {
  const e = new Error(`${what} was written by a newer Vex (data version ${found}, this Vex knows ${known}); it was left as it is`);
  e.code = 'EVEXNEWER';
  return e;
}

// Every store file is { $vexStore: 1, v?, sum, data }:
//   $vexStore  the envelope format;
//   v          the DATA schema version of that key, written when the key registered one with schema();
//   sum        SHA-256 of the data, so a file that still parses but was cut or altered is caught like one that does not.
// A file that fails is kept aside (.corrupt-*) and the .bak takes its place; a file with no sum (older Vex) is
// accepted and gets one on its next save.
class JsonStore {
  // `codec` (main/profile-crypt.js) encrypts the keys named in `codecKeys` when the profile is
  // encrypted; the other keys, and every key when there is no codec, are plain files as before.
  constructor(directory, { log = console, codec = null, codecKeys = null } = {}) {
    this.directory = directory; this.pending = new Map(); this.schemas = new Map(); this.log = log;
    this.codec = codec; this.codecKeys = codecKeys ? new Set(codecKeys) : null;
  }
  _codecFor(key) { return this.codec && (!this.codecKeys || this.codecKeys.has(key)) ? this.codec : null; }
  // The codec passes a plain file through, so this reads both an encrypted and a not-yet-encrypted file.
  // A locked profile raises here: a key that cannot be opened is not a damaged file to fall back from.
  _text(key, bytes) { const c = this._codecFor(key); return (c ? c.decode(bytes) : bytes).toString('utf8'); }
  _out(key, text) { const c = this._codecFor(key); return c ? c.encode(Buffer.from(text, 'utf8')) : text; }
  file(key) {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(key)) throw new Error('Invalid storage key');
    return path.join(this.directory, key + '.json');
  }
  // Give a key a data schema: { version, migrations: { <from>: (data) => dataAtFrom+1 } }. A file at an older
  // version is migrated step by step on its next read (and saved at the new version); a file at a newer
  // version raises. Registered before the first read of the key.
  schema(key, { version, migrations = {} }) {
    this.file(key);
    if (!Number.isInteger(version) || version < 1) throw new Error(`Store ${key}: the schema version has to be a whole number from 1`);
    for (let from = 1; from < version; from++) {
      if (typeof migrations[from] !== 'function') throw new Error(`Store ${key}: no migration from version ${from} to ${from + 1}`);
    }
    this.schemas.set(key, { version, migrations });
    return this;
  }
  schemaVersion(key) { const s = this.schemas.get(key); return s ? s.version : null; }
  _envelope(key, data) {
    const s = this.schemas.get(key);
    return JSON.stringify({ $vexStore: 1, ...(s ? { v: s.version } : {}), sum: dataSum(data), data });
  }
  async read(key) {
    return this.enqueue(key, () => this._read(key));
  }
  // The data of a parsed file, or throws: the format version, the checksum and the data schema are checked here.
  _open(key, parsed) {
    if (parsed?.$vexStore == null) return { data: parsed, legacy: true };
    if (parsed.$vexStore !== 1) throw new Error('Unsupported storage version');
    if (typeof parsed.sum === 'string' && parsed.sum !== dataSum(parsed.data)) throw new Error(`Store ${key} failed its checksum`);
    return { data: parsed.data, v: parsed.v, legacy: false };
  }
  async _migrate(key, file, data, found) {
    const s = this.schemas.get(key);
    if (!s) return { data, changed: false };
    const at = Number.isInteger(found) ? found : 1;
    if (at > s.version) throw newerThanThisVex(`Store ${key}`, at, s.version);
    if (at === s.version) return { data, changed: !Number.isInteger(found) };
    let next = data;
    for (let from = at; from < s.version; from++) next = await s.migrations[from](next);
    return { data: next, changed: true };
  }
  async _read(key) {
    const file = this.file(key);
    let raw;
    try { raw = await fs.promises.readFile(file); }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    // A locked profile must say so: a key that cannot be opened is not a damaged file to fall back from.
    const text = this._text(key, raw);
    let opened;
    try { opened = this._open(key, JSON.parse(text)); } catch (error) {
      // A newer format or data version is not damage: no older copy takes its place.
      if (error.message === 'Unsupported storage version') throw error;
      try {
        const backup = this._open(key, JSON.parse(this._text(key, await fs.promises.readFile(file + '.bak'))));
        const mig = await this._migrate(key, file, backup.data, backup.v);
        keepCorruptCopy(file);
        this.log.error(`[Storage] ${file} could not be read (${error.message}); recovered from ${file}.bak. The damaged file was kept as ${file}.corrupt-*.`);
        await atomicWrite(file, this._out(key, this._envelope(key, mig.data)), { backup: false });
        return mig.data;
      } catch (recoverError) {
        if (recoverError.code === 'EVEXNEWER' || recoverError.name === 'ProfileLockError') throw recoverError;
        throw error;
      }
    }
    if (opened.legacy) {
      // Migration/write errors must not silently revert to an older backup.
      const mig = await this._migrate(key, file, opened.data, undefined);
      await atomicWrite(file, this._out(key, this._envelope(key, mig.data)));
      return mig.data;
    }
    const mig = await this._migrate(key, file, opened.data, opened.v);
    if (mig.changed) await atomicWrite(file, this._out(key, this._envelope(key, mig.data)));
    return mig.data;
  }
  enqueue(key, operation) {
    this.file(key);
    const next = (this.pending.get(key) || Promise.resolve()).catch(() => {}).then(operation);
    this.pending.set(key, next);
    next.finally(() => { if (this.pending.get(key) === next) this.pending.delete(key); }).catch(() => {});
    return next;
  }
  update(key, transform) {
    return this.enqueue(key, async () => {
      const current = await this._read(key);
      // Taken before transform, which may change `current` in place.
      const before = current === null ? null : JSON.stringify(current);
      const data = await transform(current);
      // Saved unchanged: the file (and its .bak) is left alone. The tab list
      // was saved on every loading event and a sync pull saved every store,
      // each a full rewrite with a forced flush (found 2026-10-09).
      if (before !== null && before === JSON.stringify(data)) return data;
      await atomicWrite(this.file(key), this._out(key, this._envelope(key, data)));
      return data;
    });
  }
  async write(key, data) { await this.update(key, () => data); return true; }
  clear(key, data = null) {
    return this.enqueue(key, async () => {
      await atomicWrite(this.file(key), this._out(key, this._envelope(key, data)), { backup: false });
      await fs.promises.rm(this.file(key) + '.bak', { force: true });
      return true;
    });
  }
  // The file and its backup gone, for a store that is no longer kept.
  remove(key) {
    return this.enqueue(key, async () => {
      await fs.promises.rm(this.file(key), { force: true });
      await fs.promises.rm(this.file(key) + '.bak', { force: true });
      return true;
    });
  }
  async flush() { await Promise.all([...this.pending.values()]); }
  // Runs `fn` while none of `keys` is being read or written and none can start: each key's queue
  // is held open until `fn` is done. For changing the files under the store (main/profile-crypt.js).
  async exclusive(keys, fn) {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const held = keys.map((key) => new Promise((resolve, reject) => {
      try { this.enqueue(key, () => { resolve(); return gate; }); } catch (e) { reject(e); }
    }));
    try { await Promise.all(held); return await fn(); } finally { release(); }
  }
}

class SecretStore {
  constructor(safeStorage) { this.safeStorage = safeStorage; this.pending = new Map(); }
  enqueue(file, operation) {
    const next = (this.pending.get(file) || Promise.resolve()).catch(() => {}).then(operation);
    this.pending.set(file, next);
    next.finally(() => { if (this.pending.get(file) === next) this.pending.delete(file); }).catch(() => {});
    return next;
  }
  write(file, value) { return this.enqueue(file, () => this._write(file, value)); }
  clear(file) { return this.enqueue(file, async () => {
    await fs.promises.rm(file, { force: true });
    await fs.promises.rm(file + '.bak', { force: true });
    return true;
  }); }
  async flush() { await Promise.all([...this.pending.values()]); }
  async _write(file, value) {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('OS encryption is unavailable');
    const bytes = Buffer.concat([Buffer.from('VEXENC1\0'), this.safeStorage.encryptString(JSON.stringify(value))]);
    // Never create a plaintext backup during migration.
    await atomicWrite(file, bytes, { backup: false });
    return true;
  }
  read(file, parseLegacy = text => text.trim()) { return this.enqueue(file, () => this._read(file, parseLegacy)); }
  async _read(file, parseLegacy) {
    let raw;
    try { raw = await fs.promises.readFile(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    if (raw.subarray(0, 8).equals(Buffer.from('VEXENC1\0'))) {
      try { return JSON.parse(this.safeStorage.decryptString(raw.subarray(8))); }
      catch (cause) {
        // A secret file that cannot be decrypted (another Windows account, a damaged disk, a cut file) is kept
        // aside, not overwritten by the next save; the caller is told, and the person signs in again.
        let kept = null;
        try { kept = keepCorruptCopy(file); } catch (e) { cause.keepError = e.message; }
        throw new Error(`The secret file ${path.basename(file)} could not be decrypted${kept ? '; a copy was kept as ' + path.basename(kept) : ''}`, { cause });
      }
    }
    const value = parseLegacy(raw.toString('utf8'));
    await this._write(file, value);
    return value;
  }
}
module.exports = { atomicWrite, JsonStore, SecretStore, keepCorruptCopy, dataSum };
