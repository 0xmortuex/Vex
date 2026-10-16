// === API playground ===
//
// A small request builder: method, address, headers, body, saved requests,
// environments with {{variables}} and a history. Ctrl+K › "API Playground".
// (Ctrl+K › "API Client" is the older one-shot viewer; this is the one that
// remembers.)
//
// Where requests go and what is kept:
//   - Each request is sent by the main process (main/api-playground.js) with a
//     10 second timeout and a size cap. The page and its cookies are not
//     involved.
//   - Addresses on this machine or the local network are refused. "Allow
//     localhost" (off every time the playground opens) allows localhost only.
//   - A header value (and an environment variable) can be marked sensitive.
//     Authorization, Cookie and token-like headers start marked. Sensitive
//     values are kept in their own key, 'vex.playgroundSecretValues', which
//     Vex Sync never carries and backups and exports always leave out. The
//     saved request keeps only the name.
//   - History keeps the method, the address without its query string, the
//     status and the time: never a header or a body.
//   - Not available in a private window.

const ApiPlayground = {
  KEY: 'vex.playground',
  SECRET_KEY: 'vex.playgroundSecretValues',
  MAX_REQUESTS: 100,
  MAX_ENVS: 20,
  MAX_HISTORY: 50,
  METHODS: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
  SENSITIVE_HEADER: /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token)$|token|secret|password|passwd|session|signature|credential|(^|-)key$/i,

  // --- pure helpers -------------------------------------------------------
  isSensitiveHeader(name) { return this.SENSITIVE_HEADER.test(String(name || '').trim()); },

  // Replaces {{name}} from `vars`; an undefined variable is an error.
  interpolate(text, vars) {
    return String(text == null ? '' : text).replace(/\{\{\s*([A-Za-z_][\w.-]{0,60})\s*\}\}/g, (_m, name) => {
      if (!vars || !Object.hasOwn(vars, name)) throw new Error('The variable {{' + name + '}} is not defined in this environment');
      return String(vars[name]);
    });
  },

  // The request exactly as it will be sent. headers: [{ name, value, enabled }].
  buildRequest(form, vars) {
    const method = String(form.method || 'GET').toUpperCase();
    if (!this.METHODS.includes(method)) throw new Error('Method not allowed: ' + method);
    const url = this.interpolate(form.url, vars).trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('The address must start with http:// or https://');
    const headers = {};
    for (const h of form.headers || []) {
      if (!h || h.enabled === false || !String(h.name || '').trim()) continue;
      headers[String(h.name).trim()] = this.interpolate(h.value, vars);
    }
    const req = { url, method, headers };
    if (form.body != null && String(form.body) !== '' && method !== 'GET' && method !== 'HEAD') req.body = this.interpolate(form.body, vars);
    if (form.allowLocal === true) req.allowLocal = true;
    return req;
  },

  // What a history line may keep of an address: no query string, no fragment.
  historyUrl(url) {
    const s = String(url || '');
    const cut = s.search(/[?#]/);
    return (cut === -1 ? s : s.slice(0, cut) + '?…').slice(0, 300);
  },

  _id(prefix) { return prefix + '_' + Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 6); },

  // --- storage ------------------------------------------------------------
  _blank() { return { requests: [], envs: [], activeEnv: '', history: [] }; },

  load() {
    let raw;
    try { raw = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch { raw = null; }
    const out = this._blank();
    if (!raw || typeof raw !== 'object') return out;
    const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
    if (Array.isArray(raw.requests)) {
      out.requests = raw.requests.filter(r => r && typeof r.id === 'string' && /^rq_[\w]{4,24}$/.test(r.id)).slice(0, this.MAX_REQUESTS).map(r => ({
        id: r.id, name: str(r.name, 80) || 'Untitled',
        method: this.METHODS.includes(r.method) ? r.method : 'GET', url: str(r.url, 4096), body: str(r.body, 200000),
        headers: (Array.isArray(r.headers) ? r.headers : []).filter(h => h && typeof h.name === 'string').slice(0, 50).map(h => ({
          name: str(h.name, 100), value: h.sensitive ? '' : str(h.value, 8192), sensitive: !!h.sensitive, enabled: h.enabled !== false,
        })),
      }));
    }
    if (Array.isArray(raw.envs)) {
      out.envs = raw.envs.filter(e => e && typeof e.id === 'string' && /^ev_[\w]{4,24}$/.test(e.id)).slice(0, this.MAX_ENVS).map(e => ({
        id: e.id, name: str(e.name, 60) || 'Environment',
        vars: (Array.isArray(e.vars) ? e.vars : []).filter(v => v && /^[A-Za-z_][\w.-]{0,60}$/.test(String(v.name))).slice(0, 60).map(v => ({
          name: v.name, value: v.secret ? '' : str(v.value, 4096), secret: !!v.secret,
        })),
      }));
    }
    out.activeEnv = out.envs.some(e => e.id === raw.activeEnv) ? raw.activeEnv : '';
    if (Array.isArray(raw.history)) {
      out.history = raw.history.filter(h => h && typeof h.url === 'string').slice(0, this.MAX_HISTORY)
        .map(h => ({ ts: Number(h.ts) || 0, method: this.METHODS.includes(h.method) ? h.method : 'GET', url: str(h.url, 300), status: Number(h.status) || 0, ms: Number(h.ms) || 0, error: str(h.error, 120) }));
    }
    return out;
  },
  save(state) {
    try { localStorage.setItem(this.KEY, JSON.stringify(state)); }
    catch (err) { throw new Error('The playground could not be saved: ' + ((err && err.message) || err)); }
  },
  secrets() {
    try { const o = JSON.parse(localStorage.getItem(this.SECRET_KEY) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; }
  },
  saveSecrets(map) {
    try { localStorage.setItem(this.SECRET_KEY, JSON.stringify(map)); }
    catch (err) { throw new Error('The sensitive values could not be saved: ' + ((err && err.message) || err)); }
  },

  // A saved request with its sensitive values put back, ready for the form.
  hydrateRequest(r) {
    const sec = this.secrets();
    return { ...r, headers: r.headers.map(h => ({ ...h, value: h.sensitive ? String(sec['req:' + r.id + ':' + h.name] || '') : h.value })) };
  },
  envVars(env) {
    if (!env) return {};
    const sec = this.secrets();
    const out = {};
    for (const v of env.vars) out[v.name] = v.secret ? String(sec['env:' + env.id + ':' + v.name] || '') : v.value;
    return out;
  },

  // form: { id?, name, method, url, body, headers:[{name,value,sensitive,enabled}] }
  saveRequest(form) {
    const state = this.load();
    const secrets = this.secrets();
    let id = form.id && state.requests.some(r => r.id === form.id) ? form.id : null;
    if (!id) {
      if (state.requests.length >= this.MAX_REQUESTS) throw new Error('That is the most saved requests Vex keeps (' + this.MAX_REQUESTS + ')');
      id = this._id('rq');
    }
    for (const k of Object.keys(secrets)) if (k.startsWith('req:' + id + ':')) delete secrets[k];
    const headers = (form.headers || []).filter(h => String(h.name || '').trim()).map(h => {
      const name = String(h.name).trim().slice(0, 100);
      const sensitive = !!h.sensitive;
      if (sensitive && h.value) secrets['req:' + id + ':' + name] = String(h.value);
      return { name, value: sensitive ? '' : String(h.value || '').slice(0, 8192), sensitive, enabled: h.enabled !== false };
    });
    const rec = { id, name: String(form.name || '').trim().slice(0, 80) || 'Untitled', method: form.method, url: String(form.url || '').slice(0, 4096), body: String(form.body || '').slice(0, 200000), headers };
    const at = state.requests.findIndex(r => r.id === id);
    if (at >= 0) state.requests[at] = rec; else state.requests.push(rec);
    // Secrets first: a failure here must not leave a request that points at nothing.
    this.saveSecrets(secrets);
    this.save(state);
    return id;
  },
  deleteRequest(id) {
    const state = this.load();
    state.requests = state.requests.filter(r => r.id !== id);
    const secrets = this.secrets();
    for (const k of Object.keys(secrets)) if (k.startsWith('req:' + id + ':')) delete secrets[k];
    this.saveSecrets(secrets);
    this.save(state);
  },
  saveEnv(env) {
    const state = this.load();
    const secrets = this.secrets();
    let id = env.id && state.envs.some(e => e.id === env.id) ? env.id : null;
    if (!id) {
      if (state.envs.length >= this.MAX_ENVS) throw new Error('That is the most environments Vex keeps (' + this.MAX_ENVS + ')');
      id = this._id('ev');
    }
    for (const k of Object.keys(secrets)) if (k.startsWith('env:' + id + ':')) delete secrets[k];
    const vars = (env.vars || []).filter(v => String(v.name || '').trim()).map(v => {
      const name = String(v.name).trim();
      if (!/^[A-Za-z_][\w.-]{0,60}$/.test(name)) throw new Error('"' + name.slice(0, 30) + '" is not a valid variable name (letters, digits, _ . -)');
      const secret = !!v.secret;
      if (secret && v.value) secrets['env:' + id + ':' + name] = String(v.value);
      return { name, value: secret ? '' : String(v.value || '').slice(0, 4096), secret };
    });
    const rec = { id, name: String(env.name || '').trim().slice(0, 60) || 'Environment', vars };
    const at = state.envs.findIndex(e => e.id === id);
    if (at >= 0) state.envs[at] = rec; else state.envs.push(rec);
    this.saveSecrets(secrets);
    this.save(state);
    return id;
  },
  deleteEnv(id) {
    const state = this.load();
    state.envs = state.envs.filter(e => e.id !== id);
    if (state.activeEnv === id) state.activeEnv = '';
    const secrets = this.secrets();
    for (const k of Object.keys(secrets)) if (k.startsWith('env:' + id + ':')) delete secrets[k];
    this.saveSecrets(secrets);
    this.save(state);
  },
  setActiveEnv(id) { const s = this.load(); s.activeEnv = s.envs.some(e => e.id === id) ? id : ''; this.save(s); },
  addHistory(entry) {
    const s = this.load();
    s.history.unshift({ ts: Date.now(), method: entry.method, url: this.historyUrl(entry.url), status: entry.status || 0, ms: entry.ms || 0, error: String(entry.error || '').slice(0, 120) });
    s.history = s.history.slice(0, this.MAX_HISTORY);
    this.save(s);
  },
  clearHistory() { const s = this.load(); s.history = []; this.save(s); },

  // --- sending --------------------------------------------------------------
  async send(form) {
    if (this._privateWindow()) throw new Error('The API playground is not available in a private window');
    if (!window.vex || typeof window.vex.playgroundSend !== 'function') throw new Error('This window cannot send requests');
    const state = this.load();
    const env = state.envs.find(e => e.id === state.activeEnv) || null;
    const req = this.buildRequest(form, this.envVars(env));
    const res = await window.vex.playgroundSend(req);
    try {
      this.addHistory({ method: req.method, url: String(form.url || ''), status: res && res.ok ? res.status : 0, ms: res && res.timeMs, error: res && !res.ok ? res.error : '' });
    } catch (err) { console.error('[ApiPlayground] history not saved:', err); }
    return res;
  },

  _privateWindow() { return !!(window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow); },

  // --- the panel ------------------------------------------------------------
  // prefill: an address, or { url, method, body, headers:[{name,value}] } (js/copy-as-request.js
  // sends a request here). A sensitive header comes in marked sensitive.
  open(prefill) {
    const prefillUrl = prefill && typeof prefill === 'object' ? prefill.url : prefill;
    if (this._privateWindow()) { window.showToast?.('The API playground is not available in a private window', 'error'); return null; }
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    document.getElementById('vex-playground')?.remove();
    const tab = typeof TabManager !== 'undefined' && TabManager.getActiveTab ? TabManager.getActiveTab() : null;
    const startUrl = prefillUrl || (tab && /^https?:/i.test(tab.url || '') ? tab.url : '');
    const ui = { current: { id: '', name: '', method: 'GET', url: startUrl, body: '', headers: [], allowLocal: false } };
    if (prefill && typeof prefill === 'object') {
      const method = String(prefill.method || 'GET').toUpperCase();
      if (!this.METHODS.includes(method)) throw new Error('Method not allowed: ' + method);
      ui.current.method = method;
      ui.current.body = String(prefill.body == null ? '' : prefill.body);
      ui.current.headers = (prefill.headers || []).map(h => ({ name: String(h.name), value: String(h.value), sensitive: this.isSensitiveHeader(h.name), enabled: true }));
    }
    const m = document.createElement('div');
    m.id = 'vex-playground';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    const inp = 'padding:7px 9px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:\'JetBrains Mono\',monospace;font-size:12px';
    m.innerHTML = `<div role="dialog" aria-modal="true" aria-label="API playground" style="width:1000px;max-width:96vw;height:84vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px var(--vex-shadow-color,rgba(0,0,0,0.5));overflow:hidden">
      <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--border)">
        <span style="font-size:14px;font-weight:700;color:var(--text);flex:1">API playground</span>
        <label for="pg-env" style="font-size:12px;color:var(--text-muted)">Environment</label>
        <select id="pg-env" class="set-input"></select>
        <button id="pg-env-edit" type="button" class="btn-secondary-sm">Edit</button>
        <label style="font-size:12px;display:inline-flex;gap:5px;align-items:center;margin-left:8px" title="Off every time this opens. Allows localhost and 127.x only; the local network stays refused.">
          <input id="pg-local" type="checkbox"> Allow localhost
        </label>
        <button id="pg-close" type="button" aria-label="Close" title="Close" style="padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;line-height:0">${VexIcons.svg('x', { size: 14 })}</button>
      </div>
      <div style="display:flex;flex:1;min-height:0">
        <div style="width:240px;border-right:1px solid var(--border);overflow:auto;padding:8px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:12px;font-weight:600;color:var(--text)">Saved</span><button id="pg-new" type="button" class="btn-secondary-sm">New</button></div>
          <div id="pg-saved"></div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin:12px 0 6px"><span style="font-size:12px;font-weight:600;color:var(--text)">History</span><button id="pg-clear-history" type="button" class="btn-secondary-sm">Clear</button></div>
          <div id="pg-history"></div>
        </div>
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;overflow:auto;padding:10px 14px;gap:8px">
          <div style="display:flex;gap:8px">
            <select id="pg-method" style="font-family:'JetBrains Mono',monospace;font-weight:700">${this.METHODS.map(x => `<option>${x}</option>`).join('')}</select>
            <input id="pg-url" type="text" spellcheck="false" placeholder="https://api.example.com/v1/{{resource}}" style="flex:1;${inp}">
            <button id="pg-send" type="button" class="btn-primary" style="padding:8px 18px;background:var(--primary,var(--accent));color:var(--on-primary,#fff);border:none;border-radius:8px;cursor:pointer;font-weight:600">Send</button>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <input id="pg-name" type="text" maxlength="80" placeholder="Name to save this request" class="set-input" style="flex:1">
            <button id="pg-save" type="button" class="btn-secondary-sm">Save request</button>
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><span style="font-size:12px;color:var(--text-muted)">Headers (tick Sensitive to keep a value out of backups and sync)</span><button id="pg-add-header" type="button" class="btn-secondary-sm">Add header</button></div>
            <div id="pg-headers"></div>
          </div>
          <div>
            <label for="pg-body" style="font-size:12px;color:var(--text-muted)">Body</label>
            <textarea id="pg-body" spellcheck="false" rows="5" style="width:100%;margin-top:4px;resize:vertical;${inp}"></textarea>
          </div>
          <div id="pg-status" role="status" style="font-size:12px;color:var(--text-muted);font-family:'JetBrains Mono',monospace;min-height:18px"></div>
          <details id="pg-resp-headers" style="font-size:11.5px"><summary style="cursor:pointer;color:var(--text-muted)">Response headers</summary><pre id="pg-resp-headers-body" style="white-space:pre-wrap;word-break:break-word;margin:6px 0 0;color:var(--text)"></pre></details>
          <pre id="pg-response" style="flex:1;min-height:120px;margin:0;white-space:pre-wrap;word-break:break-word;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text);background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px;overflow:auto"></pre>
        </div>
      </div>
    </div>`;
    document.body.appendChild(m);
    const q = (s) => m.querySelector(s);

    const readForm = () => ({
      id: ui.current.id, name: q('#pg-name').value, method: q('#pg-method').value, url: q('#pg-url').value, body: q('#pg-body').value,
      allowLocal: q('#pg-local').checked,
      headers: [...m.querySelectorAll('#pg-headers [data-row]')].map(r => ({
        name: r.querySelector('[data-h-name]').value, value: r.querySelector('[data-h-value]').value,
        sensitive: r.querySelector('[data-h-sens]').checked, enabled: r.querySelector('[data-h-on]').checked,
      })),
    });
    const headerRow = (h) => {
      const row = document.createElement('div');
      row.dataset.row = '1';
      row.style.cssText = 'display:flex;gap:6px;margin-bottom:4px;align-items:center';
      row.innerHTML = `<input type="checkbox" data-h-on aria-label="Send this header" ${h.enabled === false ? '' : 'checked'}>
        <input data-h-name type="text" spellcheck="false" placeholder="Name" value="${esc(h.name)}" style="width:170px;${inp}">
        <input data-h-value type="${h.sensitive ? 'password' : 'text'}" spellcheck="false" placeholder="Value" value="${esc(h.value)}" style="flex:1;${inp}">
        <label style="font-size:11.5px;display:inline-flex;gap:4px;align-items:center"><input type="checkbox" data-h-sens ${h.sensitive ? 'checked' : ''}>Sensitive</label>
        <button type="button" data-h-del aria-label="Remove header" title="Remove" style="padding:5px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;cursor:pointer;line-height:0">${VexIcons.svg('x', { size: 12 })}</button>`;
      const name = row.querySelector('[data-h-name]'), sens = row.querySelector('[data-h-sens]'), val = row.querySelector('[data-h-value]');
      name.addEventListener('change', () => { if (this.isSensitiveHeader(name.value)) { sens.checked = true; val.type = 'password'; } });
      sens.addEventListener('change', () => { val.type = sens.checked ? 'password' : 'text'; });
      row.querySelector('[data-h-del]').addEventListener('click', () => row.remove());
      return row;
    };
    const fillForm = (f) => {
      ui.current = { ...f };
      q('#pg-name').value = f.name || '';
      q('#pg-method').value = f.method || 'GET';
      q('#pg-url').value = f.url || '';
      q('#pg-body').value = f.body || '';
      const box = q('#pg-headers');
      box.textContent = '';
      (f.headers || []).forEach(h => box.appendChild(headerRow(h)));
    };
    const drawLists = () => {
      const st = this.load();
      const saved = q('#pg-saved');
      saved.innerHTML = st.requests.length ? '' : '<div class="muted" style="font-size:11.5px">Nothing saved yet.</div>';
      for (const r of st.requests) {
        const b = document.createElement('div');
        b.style.cssText = 'display:flex;gap:4px;align-items:center;margin-bottom:3px';
        b.innerHTML = `<button type="button" data-open style="flex:1;text-align:left;padding:5px 7px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b style="font-family:'JetBrains Mono',monospace;font-size:10.5px">${esc(r.method)}</b> ${esc(r.name)}</button>
          <button type="button" data-del aria-label="Delete ${esc(r.name)}" title="Delete" style="padding:5px 7px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;cursor:pointer;line-height:0">${VexIcons.svg('trash', { size: 12 })}</button>`;
        b.querySelector('[data-open]').addEventListener('click', () => fillForm(this.hydrateRequest(r)));
        b.querySelector('[data-del]').addEventListener('click', async () => {
          if (!(await vexConfirm({ title: 'Delete saved request?', message: 'Delete "' + r.name + '" and its saved header values?', okLabel: 'Delete', danger: true }))) return;
          try { this.deleteRequest(r.id); if (ui.current.id === r.id) ui.current.id = ''; drawLists(); } catch (err) { window.showToast?.(err.message, 'error'); }
        });
        saved.appendChild(b);
      }
      const hist = q('#pg-history');
      hist.innerHTML = st.history.length ? '' : '<div class="muted" style="font-size:11.5px">No requests sent yet.</div>';
      for (const h of st.history) {
        const b = document.createElement('button');
        b.type = 'button';
        b.style.cssText = 'display:block;width:100%;text-align:left;padding:4px 6px;margin-bottom:3px;background:transparent;color:var(--text);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        b.title = h.url;
        b.textContent = h.method + ' ' + (h.status || h.error || 'failed') + '  ' + h.url.replace(/^https?:\/\//, '');
        b.addEventListener('click', () => { q('#pg-method').value = h.method; q('#pg-url').value = h.url.replace(/\?…$/, ''); });
        hist.appendChild(b);
      }
      const sel = q('#pg-env');
      sel.innerHTML = '<option value="">No environment</option>' + st.envs.map(e => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');
      sel.value = st.activeEnv || '';
    };

    const show = (res) => {
      const status = q('#pg-status');
      const out = q('#pg-response');
      q('#pg-resp-headers-body').textContent = '';
      if (!res || !res.ok) { status.textContent = (res && res.error) || 'The request failed'; status.style.color = 'var(--danger,#ef4444)'; out.textContent = ''; return; }
      status.style.color = res.status < 400 ? 'var(--text)' : 'var(--danger,#ef4444)';
      const kb = res.size < 1024 ? res.size + ' B' : (res.size / 1024).toFixed(1) + ' KB';
      status.textContent = res.status + ' ' + res.statusText + '  ·  ' + res.timeMs + ' ms  ·  ' + kb + (res.local ? '  ·  localhost' : '');
      q('#pg-resp-headers-body').textContent = (res.headers || []).map(([k, v]) => k + ': ' + v).join('\n');
      let text = res.binary ? '(' + (res.contentType || 'binary') + ', ' + kb + ' — not shown)' : res.body;
      if (!res.binary && /json/i.test(res.contentType || '')) { try { text = JSON.stringify(JSON.parse(res.body), null, 2); } catch { /* shown as received */ } }
      out.textContent = text;
    };

    q('#pg-send').addEventListener('click', async () => {
      const status = q('#pg-status');
      status.style.color = 'var(--text-muted)';
      status.textContent = 'Sending…';
      q('#pg-response').textContent = '';
      try { show(await this.send(readForm())); }
      catch (err) { status.style.color = 'var(--danger,#ef4444)'; status.textContent = err.message; }
      drawLists();
    });
    q('#pg-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') q('#pg-send').click(); });
    q('#pg-save').addEventListener('click', () => {
      try {
        const f = readForm();
        ui.current.id = this.saveRequest(f);
        window.showToast?.('Request saved');
        drawLists();
      } catch (err) { window.showToast?.(err.message, 'error'); }
    });
    q('#pg-new').addEventListener('click', () => fillForm({ id: '', name: '', method: 'GET', url: '', body: '', headers: [] }));
    q('#pg-add-header').addEventListener('click', () => q('#pg-headers').appendChild(headerRow({ name: '', value: '', sensitive: false, enabled: true })));
    q('#pg-clear-history').addEventListener('click', () => { try { this.clearHistory(); drawLists(); } catch (err) { window.showToast?.(err.message, 'error'); } });
    q('#pg-env').addEventListener('change', (e) => { try { this.setActiveEnv(e.target.value); } catch (err) { window.showToast?.(err.message, 'error'); } });
    q('#pg-env-edit').addEventListener('click', () => this.editEnv(q('#pg-env').value, () => drawLists()));

    const onKey = (e) => {
      if (!m.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
      if (e.key === 'Escape' && !document.querySelector('.vex-dialog-overlay') && !document.getElementById('vex-playground-env')) { e.preventDefault(); e.stopPropagation(); close(); }
    };
    const close = () => { document.removeEventListener('keydown', onKey, true); m.remove(); };
    document.addEventListener('keydown', onKey, true);
    q('#pg-close').addEventListener('click', close);
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    fillForm(ui.current);
    drawLists();
    setTimeout(() => q('#pg-url').focus(), 30);
    return m;
  },

  // Environment editor: a name and a list of variables, secret ones masked.
  editEnv(id, done) {
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    document.getElementById('vex-playground-env')?.remove();
    const st = this.load();
    const env = st.envs.find(e => e.id === id) || null;
    const sec = this.secrets();
    const vars = env ? env.vars.map(v => ({ ...v, value: v.secret ? String(sec['env:' + env.id + ':' + v.name] || '') : v.value })) : [];
    const m = document.createElement('div');
    m.id = 'vex-playground-env';
    m.style.cssText = 'position:fixed;inset:0;z-index:100053;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center';
    m.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Environment" style="width:520px;max-width:94vw;max-height:86vh;overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px">
      <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:8px">${env ? 'Edit environment' : 'New environment'}</div>
      <input id="ev-name" class="set-input" type="text" maxlength="60" placeholder="Name (for example Staging)" value="${esc(env ? env.name : '')}" style="width:100%;margin-bottom:8px">
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Variables, used as {{name}} in the address, headers and body. Tick Secret to keep a value out of backups and sync.</div>
      <div id="ev-vars"></div>
      <div id="ev-msg" role="status" style="font-size:11.5px;color:var(--danger,#ef4444);min-height:16px;margin:4px 0"></div>
      <div style="display:flex;gap:8px;justify-content:space-between">
        <span><button id="ev-add" type="button" class="btn-secondary-sm">Add variable</button> ${env ? '<button id="ev-del" type="button" class="btn-secondary-sm">Delete environment</button>' : ''}</span>
        <span><button id="ev-cancel" type="button" class="btn-secondary-sm">Cancel</button> <button id="ev-save" type="button" class="btn-primary" style="padding:7px 14px;background:var(--primary,var(--accent));color:var(--on-primary,#fff);border:none;border-radius:8px;cursor:pointer;font-weight:600">Save</button></span>
      </div>
    </div>`;
    document.body.appendChild(m);
    const q = (s) => m.querySelector(s);
    const addVar = (v) => {
      const row = document.createElement('div');
      row.dataset.row = '1';
      row.style.cssText = 'display:flex;gap:6px;margin-bottom:4px;align-items:center';
      row.innerHTML = `<input data-v-name class="set-input" type="text" spellcheck="false" placeholder="name" value="${esc(v.name)}" style="width:150px">
        <input data-v-value class="set-input" type="${v.secret ? 'password' : 'text'}" spellcheck="false" placeholder="value" value="${esc(v.value)}" style="flex:1">
        <label style="font-size:11.5px;display:inline-flex;gap:4px;align-items:center"><input type="checkbox" data-v-secret ${v.secret ? 'checked' : ''}>Secret</label>
        <button type="button" data-v-del aria-label="Remove variable" style="padding:5px 8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;cursor:pointer;line-height:0">${VexIcons.svg('x', { size: 12 })}</button>`;
      const val = row.querySelector('[data-v-value]'), secret = row.querySelector('[data-v-secret]');
      secret.addEventListener('change', () => { val.type = secret.checked ? 'password' : 'text'; });
      row.querySelector('[data-v-del]').addEventListener('click', () => row.remove());
      q('#ev-vars').appendChild(row);
    };
    vars.forEach(addVar);
    if (!vars.length) addVar({ name: '', value: '', secret: false });
    q('#ev-add').addEventListener('click', () => addVar({ name: '', value: '', secret: false }));
    const close = () => { document.removeEventListener('keydown', onKey, true); m.remove(); };
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.vex-dialog-overlay')) { e.preventDefault(); e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    q('#ev-cancel').addEventListener('click', close);
    q('#ev-save').addEventListener('click', () => {
      try {
        const rows = [...m.querySelectorAll('#ev-vars [data-row]')].map(r => ({
          name: r.querySelector('[data-v-name]').value, value: r.querySelector('[data-v-value]').value, secret: r.querySelector('[data-v-secret]').checked,
        }));
        const saved = this.saveEnv({ id: env ? env.id : '', name: q('#ev-name').value, vars: rows });
        this.setActiveEnv(saved);
      } catch (err) { q('#ev-msg').textContent = err.message; return; }
      close();
      if (typeof done === 'function') done();
    });
    if (q('#ev-del')) q('#ev-del').addEventListener('click', async () => {
      if (!(await vexConfirm({ title: 'Delete environment?', message: 'Delete "' + env.name + '" and its saved values?', okLabel: 'Delete', danger: true }))) return;
      try { this.deleteEnv(env.id); } catch (err) { q('#ev-msg').textContent = err.message; return; }
      close();
      if (typeof done === 'function') done();
    });
    setTimeout(() => q('#ev-name').focus(), 30);
    return m;
  },

  init() {
    if (typeof document === 'undefined' || !window.VexModuleCommands) return;
    VexModuleCommands.set('apiplayground:', [{
      id: 'apiplayground:open', label: 'API Playground', hint: 'Build, save and re-send HTTP requests with environments and history',
      icon: 'send', action: () => { try { this.open(); } catch (err) { window.showToast?.('Could not open: ' + ((err && err.message) || err), 'error'); } },
    }]);
  },
};

if (typeof window !== 'undefined') { window.ApiPlayground = ApiPlayground; ApiPlayground.init(); }
if (typeof module !== 'undefined' && module.exports) module.exports = { ApiPlayground };
