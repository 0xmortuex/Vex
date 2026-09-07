const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

async function atomicWrite(file, bytes, { backup = true } = {}) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    const handle = await fs.promises.open(temp, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    if (backup) {
      try { await fs.promises.copyFile(file, file + '.bak'); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    await fs.promises.rename(temp, file);
  } finally { await fs.promises.rm(temp, { force: true }).catch(() => {}); }
}

class JsonStore {
  constructor(directory) { this.directory = directory; this.pending = new Map(); }
  file(key) {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(key)) throw new Error('Invalid storage key');
    return path.join(this.directory, key + '.json');
  }
  async read(key) {
    return this.enqueue(key, () => this._read(key));
  }
  async _read(key) {
    const file = this.file(key);
    let raw;
    try { raw = await fs.promises.readFile(file, 'utf8'); }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    let parsed;
    try { parsed = JSON.parse(raw); } catch (error) {
      try {
        const backup = JSON.parse(await fs.promises.readFile(file + '.bak', 'utf8'));
        if (backup?.$vexStore != null && backup.$vexStore !== 1) throw new Error('Unsupported backup version', { cause: error });
        const value = backup?.$vexStore === 1 ? backup.data : backup;
        await atomicWrite(file, JSON.stringify({ $vexStore: 1, data: value }), { backup: false });
        return value;
      } catch { throw error; }
    }
    if (parsed?.$vexStore != null) {
      if (parsed.$vexStore !== 1) throw new Error('Unsupported storage version');
      return parsed.data;
    }
    // Migration/write errors must not silently revert to an older backup.
    await atomicWrite(file, JSON.stringify({ $vexStore: 1, data: parsed }));
    return parsed;
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
      const data = await transform(await this._read(key));
      await atomicWrite(this.file(key), JSON.stringify({ $vexStore: 1, data }));
      return data;
    });
  }
  async write(key, data) { await this.update(key, () => data); return true; }
  clear(key, data = null) {
    return this.enqueue(key, async () => {
      await atomicWrite(this.file(key), JSON.stringify({ $vexStore: 1, data }), { backup: false });
      await fs.promises.rm(this.file(key) + '.bak', { force: true });
      return true;
    });
  }
  async flush() { await Promise.all([...this.pending.values()]); }
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
    if (raw.subarray(0, 8).equals(Buffer.from('VEXENC1\0'))) return JSON.parse(this.safeStorage.decryptString(raw.subarray(8)));
    const value = parseLegacy(raw.toString('utf8'));
    await this._write(file, value);
    return value;
  }
}
module.exports = { atomicWrite, JsonStore, SecretStore };
