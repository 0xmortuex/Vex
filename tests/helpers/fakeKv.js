// An in-memory stand-in for a Workers KV namespace (get / put / delete / list,
// with expirationTtl measured on an injectable clock). Used by the worker tests.
export function makeKv(now = () => Date.now()) {
  const data = new Map(); // key -> { value, expires }
  const live = (k) => { const e = data.get(k); if (!e) return null; if (e.expires && e.expires <= now()) { data.delete(k); return null; } return e; };
  return {
    data,
    async get(key) { const e = live(key); return e ? e.value : null; },
    async put(key, value, opts = {}) { data.set(key, { value: String(value), expires: opts.expirationTtl ? now() + opts.expirationTtl * 1000 : 0 }); },
    async delete(key) { data.delete(key); },
    async list({ prefix = '', limit = 1000 } = {}) {
      const keys = [...data.keys()].filter(k => k.startsWith(prefix) && live(k)).sort().slice(0, limit).map(name => ({ name }));
      return { keys, list_complete: true };
    },
  };
}
