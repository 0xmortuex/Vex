// === API playground secrets: kept in the main process, variables filled in here ===
//
// The playground (js/api-playground.js) lets a header value (Authorization, a cookie, an API key) and an
// environment variable be marked secret. Those used to sit in a localStorage key of the window. Now:
//
//   - they are kept sealed by the operating system (the same SecretStore the GitHub token and the AI keys use),
//     in ONE file in the profile folder, and the window is never given a value back: it can list which keys
//     exist, write a value it has just been typed, and delete;
//   - {{variables}} are filled in HERE, when a request is sent: the window sends the form (with {{names}} still in
//     it), the non-secret variables and, for the secret ones, only the names of the vault keys. Main looks the
//     secrets up, fills them in and sends. A secret variable that has no value is an error, never an empty string;
//   - the values never reach history, sync, a backup, a log or an error message (every message is scrubbed of
//     every secret value before it leaves this module).
//
// A key is "req:<request id>:<header name>" or "env:<environment id>:<variable name>".
//
// createPlaygroundVault({ secretStore, file, send })
//   send(req) -> the playground's answer   (main/api-playground.js send)

const KEY_RE = /^(?:req|env):[A-Za-z0-9_-]{4,40}:[^\s\u0000-\u001f]{1,100}$/;
const VAR_RE = /^[A-Za-z_][\w.-]{0,60}$/;
const MAX_KEYS = 2000;
const MAX_VALUE = 8192;

function createPlaygroundVault({ secretStore, file, send } = {}) {
  if (!secretStore || typeof secretStore.read !== 'function' || typeof secretStore.write !== 'function') throw new Error('createPlaygroundVault needs a secret store');
  if (!file) throw new Error('createPlaygroundVault needs a file');
  if (typeof send !== 'function') throw new Error('createPlaygroundVault needs a send');

  async function load() {
    const rec = await secretStore.read(file, () => null);
    const map = rec && rec.map && typeof rec.map === 'object' && !Array.isArray(rec.map) ? rec.map : {};
    const clean = {};
    for (const [k, v] of Object.entries(map)) if (KEY_RE.test(k) && typeof v === 'string') clean[k] = v;
    return clean;
  }
  async function store(map) { await secretStore.write(file, { v: 1, map }); }

  const scrubber = (map) => {
    const values = Object.values(map).filter(v => v.length >= 4).sort((a, b) => b.length - a.length);
    return (text) => { let s = String(text == null ? '' : text); for (const v of values) s = s.split(v).join('[secret]'); return s; };
  };

  // Which keys exist. Never a value.
  async function keys() { return Object.keys(await load()).sort(); }

  // set: { key: value }, clear: [key or "prefix*"]. One write, clears first.
  async function apply({ set = {}, clear = [] } = {}) {
    if (!set || typeof set !== 'object' || Array.isArray(set) || !Array.isArray(clear)) throw new Error('Not a valid change to the playground secrets');
    const map = await load();
    for (const c of clear) {
      const target = String(c);
      if (target.endsWith('*')) { const prefix = target.slice(0, -1); if (!/^(?:req|env):[A-Za-z0-9_-]{4,40}:$/.test(prefix)) throw new Error('Not a valid prefix to clear'); for (const k of Object.keys(map)) if (k.startsWith(prefix)) delete map[k]; }
      else delete map[target];
    }
    for (const [k, v] of Object.entries(set)) {
      if (!KEY_RE.test(k)) throw new Error('Not a valid secret name: ' + k.slice(0, 40));
      if (typeof v !== 'string' || !v || v.length > MAX_VALUE) throw new Error('A secret value is 1 to ' + MAX_VALUE + ' characters');
      map[k] = v;
    }
    if (Object.keys(map).length > MAX_KEYS) throw new Error('Too many saved secrets (at most ' + MAX_KEYS + ')');
    await store(map);
    return { count: Object.keys(map).length };
  }

  // The one-time move from the window's old storage. Existing keys are never overwritten.
  async function migrate(legacy) {
    if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) throw new Error('The old secrets are not in the expected form');
    const map = await load();
    let imported = 0, kept = 0, refused = 0;
    for (const [k, v] of Object.entries(legacy)) {
      if (!KEY_RE.test(k) || typeof v !== 'string' || !v || v.length > MAX_VALUE) { refused++; continue; }
      if (Object.hasOwn(map, k)) { kept++; continue; }
      map[k] = v; imported++;
    }
    if (Object.keys(map).length > MAX_KEYS) throw new Error('Too many saved secrets (at most ' + MAX_KEYS + ')');
    await store(map);
    return { imported, kept, refused };
  }

  // Pure given `lookup`: fills {{name}} in text; an undefined name is an error.
  function fill(text, vars) {
    return String(text == null ? '' : text).replace(/\{\{\s*([A-Za-z_][\w.-]{0,60})\s*\}\}/g, (_m, name) => {
      if (!Object.hasOwn(vars, name)) throw new Error('The variable {{' + name + '}} is not defined in this environment');
      return String(vars[name]);
    });
  }

  // form: { method, url, body, headers:[{ name, value, enabled, sensitive, ref? }], allowLocal }
  // vars: { name: value } the non-secret variables.  secretVars: { name: vaultKey }.
  async function sendForm({ form, vars = {}, secretVars = {} } = {}) {
    if (!form || typeof form !== 'object') throw new Error('No request');
    const map = await load();
    const scrub = scrubber(map);
    try {
      const all = { ...vars };
      for (const [name, key] of Object.entries(secretVars || {})) {
        if (!VAR_RE.test(name)) throw new Error('"' + String(name).slice(0, 30) + '" is not a valid variable name');
        if (!Object.hasOwn(map, key)) continue;   // left undefined: filling it in reports it by name
        all[name] = map[key];
      }
      const headers = {};
      for (const h of Array.isArray(form.headers) ? form.headers : []) {
        if (!h || h.enabled === false || !String(h.name || '').trim()) continue;
        let value = String(h.value == null ? '' : h.value);
        // A sensitive header left empty in the form keeps the value saved for it.
        if (!value && h.sensitive && h.ref) {
          if (!Object.hasOwn(map, h.ref)) throw new Error('The saved value of the header ' + String(h.name).slice(0, 40) + ' is not in the vault; type it again');
          value = map[h.ref];
        }
        headers[String(h.name).trim()] = fill(value, all);
      }
      const method = String(form.method || 'GET').toUpperCase();
      const req = { url: fill(form.url, all).trim(), method, headers };
      if (form.body != null && String(form.body) !== '' && method !== 'GET' && method !== 'HEAD') req.body = fill(form.body, all);
      if (form.allowLocal === true) req.allowLocal = true;
      const res = await send(req);
      // Nothing a server echoes back may carry a secret into the window or the history.
      if (res && typeof res.body === 'string') res.body = scrub(res.body);
      if (res && Array.isArray(res.headers)) res.headers = res.headers.map(([k, v]) => [k, scrub(v)]);
      if (res && typeof res.error === 'string') res.error = scrub(res.error);
      return res;
    } catch (err) {
      const e = new Error(scrub(err && err.message));
      throw e;
    }
  }

  return { keys, apply, migrate, sendForm, fill };
}

module.exports = { createPlaygroundVault, KEY_RE, MAX_KEYS };
