export function parseCounter(value) {
  if (value == null) return 0;
  if (!/^(0|[1-9][0-9]*)$/.test(String(value))) throw new Error('Invalid stored counter');
  const count = Number(value);
  if (!Number.isSafeInteger(count)) throw new Error('Invalid stored counter');
  return count;
}

export async function boundedJson(request, limit = 4 * 1024 * 1024) {
  if (Number(request.headers.get('content-length')) > limit) {
    request.body?.cancel().catch(() => {});
    throw Object.assign(new Error('Request too large'), { status: 413 });
  }
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error('JSON body required'), { status: 400 });
  let size = 0;
  const chunks = [];
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { reader.cancel().catch(() => {}); reject(Object.assign(new Error('Body read timed out'), { status: 408 })); }, 10000); });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) { reader.cancel().catch(() => {}); throw Object.assign(new Error('Request too large'), { status: 413 }); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  } finally { clearTimeout(timer); reader.releaseLock(); }
}

export function durableKV(storage, prefix, legacy = null) {
  return {
    async get(key) {
      let record = await storage.get(prefix + key);
      if (!record && legacy && (prefix !== 'auth:' || key.startsWith('sess:'))) {
        const value = await legacy.get(key);
        if (value != null) {
          let expires = 0;
          if (prefix === 'auth:') { try { expires = Date.parse(JSON.parse(value).createdAt) + 365 * 86400000; } catch { return null; } if (!Number.isFinite(expires)) return null; }
          record = { value, expires };
          await storage.put(prefix + key, record);
        }
      }
      if (!record || record.deleted || record.expires && record.expires <= Date.now()) return null;
      return record.value;
    },
    async put(key, value, options = {}) {
      await storage.put(prefix + key, { value: String(value), expires: options.expirationTtl ? Date.now() + options.expirationTtl * 1000 : 0 });
      if (options.expirationTtl && storage.setAlarm && !(await storage.getAlarm())) await storage.setAlarm(Date.now() + 60000);
    },
    async delete(key) {
      if (legacy) await storage.put(prefix + key, { deleted: true, expires: 0 });
      else await storage.delete(prefix + key);
    },
  };
}

export async function expireRecords(storage) {
  let startAfter;
  do {
    const records = await storage.list({ limit: 1000, ...(startAfter ? { startAfter } : {}) });
    for (const [key, record] of records) {
      if (record.expires && record.expires <= Date.now()) {
        if (key.startsWith('auth:sess:') || key.startsWith('sync:')) await storage.put(key, { deleted: true, expires: 0 });
        else await storage.delete(key);
      }
      startAfter = key;
    }
    if (records.size < 1000) break;
  } while (startAfter);
  await storage.setAlarm(Date.now() + 3600000);
}

export function isDevelopment(request, env) {
  return env.DEVELOPMENT_MODE === 'true' && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname);
}

export async function authenticateClient(request, env) {
  let tokens;
  try { tokens = JSON.parse(env.VEX_CLIENT_TOKENS || '{}'); } catch { return null; }
  const bearer = request.headers.get('Authorization') || '';
  if (!bearer.startsWith('Bearer ')) return null;
  const value = bearer.slice(7);
  for (const [name, token] of Object.entries(tokens)) {
    if (typeof token !== 'string' || token.length < 24 || token.length !== value.length) continue;
    let diff = 0;
    for (let i = 0; i < value.length; i++) diff |= value.charCodeAt(i) ^ token.charCodeAt(i);
    if (diff === 0) return name;
  }
  return null;
}
