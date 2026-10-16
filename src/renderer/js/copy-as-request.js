// === Copy as cURL / fetch / PowerShell, and send to the API playground =========
//
// Right-click a link and choose "Copy link as request..." (or Ctrl+K > "Copy as
// cURL, fetch or PowerShell"): a small card holds the request (method, address,
// headers, body), shows it as cURL for bash or for cmd, PowerShell
// Invoke-RestMethod or fetch(), copies the one you pick, or opens it in the API
// playground (js/api-playground.js).
//
// Secrets stay out by default:
//   * Authorization, Cookie and token-like headers show "<REDACTED>" in the copy and
//     are left out of what is sent to the playground, unless you tick "Include
//     authorization and cookies". The box starts unticked every time the card opens
//     and the choice is not kept;
//   * a user:password@ in the address, a ?token=... style query value and obvious
//     secret fields in a JSON or form body are redacted the same way;
//   * nothing is sent anywhere: the card only formats text on this computer.
//
// Not built: a list of the requests a page made. Vex has no network log that keeps
// request headers (main only counts bytes and sniffs media), and keeping them would
// mean holding every page's cookies and tokens, so only a request you describe, or a
// link's address, can be copied. The converters are pure and take any request object,
// so a log can feed them later.
//
// Pure functions are tested in tests/renderer/copyAsRequest.test.js.
const VexCopyAs = {
  ENABLED_KEY: 'vex.copyAs.enabled',
  METHODS: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
  FORMATS: { 'curl-bash': 'cURL (bash)', 'curl-cmd': 'cURL (cmd)', powershell: 'PowerShell', fetch: 'fetch()' },
  SENSITIVE_HEADER: /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-csrf-token|x-xsrf-token)$|token|secret|password|passwd|session|signature|credential|(^|-)key$/i,
  SENSITIVE_PARAM: /^(?:access_?token|id_?token|refresh_?token|token|api_?key|key|secret|client_?secret|password|passwd|pwd|auth|authorization|session|sessionid|sid|sig|signature|code)$/i,
  REDACTED: '<REDACTED>',

  enabled() {
    try { return localStorage.getItem(this.ENABLED_KEY) !== 'false'; }
    catch (err) { console.error('[CopyAs] the switch could not be read:', err); return true; }
  },
  setEnabled(on) { localStorage.setItem(this.ENABLED_KEY, on ? 'true' : 'false'); },

  isSensitiveHeader(name) { return this.SENSITIVE_HEADER.test(String(name || '').trim()); },

  // Checks a request and returns a clean copy: { method, url, headers:[{name,value}], body }.
  normalize(req) {
    if (!req || typeof req !== 'object') throw new Error('There is no request to copy');
    const method = String(req.method || 'GET').toUpperCase();
    if (!this.METHODS.includes(method)) throw new Error('Method not allowed: ' + method);
    const url = String(req.url == null ? '' : req.url).trim();
    if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('The address must start with http:// or https://');
    const headers = (req.headers || []).filter(h => h && String(h.name || '').trim()).map(h => {
      const name = String(h.name).trim();
      const value = String(h.value == null ? '' : h.value);
      if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) throw new Error('"' + name + '" is not a valid header name');
      if (/[\r\n]/.test(value)) throw new Error('The value of the header ' + name + ' has a line break in it');
      return { name, value };
    });
    const body = req.body == null || String(req.body) === '' || method === 'GET' || method === 'HEAD' ? '' : String(req.body);
    return { method, url, headers, body };
  },

  // The same request with secrets replaced by <REDACTED>, or left out of `headers` when
  // `drop` is set (what the playground gets).
  redact(req, { includeAuth = false, drop = false } = {}) {
    const r = this.normalize(req);
    if (includeAuth) return r;
    let url = r.url;
    try {
      const u = new URL(url);
      if (u.username || u.password) { u.username = ''; u.password = ''; }
      for (const k of [...u.searchParams.keys()]) if (this.SENSITIVE_PARAM.test(k)) u.searchParams.set(k, this.REDACTED);
      url = u.toString().split(encodeURIComponent(this.REDACTED)).join(this.REDACTED);
    } catch (err) { throw new Error('The address could not be read: ' + err.message); }
    let headers = r.headers;
    headers = drop ? headers.filter(h => !this.isSensitiveHeader(h.name)) : headers.map(h => (this.isSensitiveHeader(h.name) ? { name: h.name, value: this.REDACTED } : h));
    let body = r.body;
    if (body) {
      body = body.replace(/("(?:password|passwd|pwd|secret|client_secret|token|access_token|refresh_token|id_token|api_?key|authorization)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi, '$1"' + this.REDACTED + '"');
      body = body.replace(/((?:^|&)(?:password|passwd|pwd|secret|client_secret|token|access_token|refresh_token|id_token|api_?key)=)[^&]*/gi, '$1' + encodeURIComponent(this.REDACTED));
    }
    return { method: r.method, url, headers, body };
  },
  // Did redaction change anything? (so the card can say so)
  redactedCount(req) {
    const a = this.normalize(req), b = this.redact(req);
    let n = a.url !== b.url ? 1 : 0;
    n += a.headers.filter((h, i) => h.value !== b.headers[i].value).length;
    if (a.body !== b.body) n++;
    return n;
  },

  // ---- the four formats -----------------------------------------------------------------
  _sq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; },        // bash single quotes
  _dq(s) { return '"' + String(s).replace(/"/g, '\\"') + '"'; },          // cmd double quotes
  _psq(s) { return "'" + String(s).replace(/'/g, "''") + "'"; },          // PowerShell single quotes

  toCurlBash(r) {
    const q = (s) => this._sq(s);
    const parts = ['curl'];
    if (r.method !== 'GET') parts.push(r.method === 'HEAD' ? '-I' : '-X ' + r.method);
    parts.push(q(r.url));
    for (const h of r.headers) parts.push('-H ' + q(h.name + ': ' + h.value));
    if (r.body) parts.push('--data-raw ' + q(r.body));
    return parts.join(' ');
  },
  toCurlCmd(r) {
    const q = (s) => this._dq(s);
    const parts = ['curl'];
    if (r.method !== 'GET') parts.push(r.method === 'HEAD' ? '-I' : '-X ' + r.method);
    parts.push(q(r.url));
    for (const h of r.headers) parts.push('-H ' + q(h.name + ': ' + h.value));
    if (r.body) parts.push('--data-raw ' + q(r.body.replace(/\r?\n/g, ' ')));
    return parts.join(' ');
  },
  toPowerShell(r) {
    const q = (s) => this._psq(s);
    const parts = ['Invoke-RestMethod', '-Method ' + r.method.charAt(0) + r.method.slice(1).toLowerCase(), '-Uri ' + q(r.url)];
    const ct = r.headers.find(h => h.name.toLowerCase() === 'content-type');
    const others = r.headers.filter(h => h !== ct);
    if (others.length) parts.push('-Headers @{ ' + others.map(h => q(h.name) + ' = ' + q(h.value)).join('; ') + ' }');
    if (ct) parts.push('-ContentType ' + q(ct.value));
    if (r.body) parts.push('-Body ' + q(r.body));
    return parts.join(' ');
  },
  toFetch(r) {
    const lines = ['fetch(' + JSON.stringify(r.url) + ', {', '  method: ' + JSON.stringify(r.method) + ','];
    if (r.headers.length) lines.push('  headers: {', ...r.headers.map(h => '    ' + JSON.stringify(h.name) + ': ' + JSON.stringify(h.value) + ','), '  },');
    if (r.body) lines.push('  body: ' + JSON.stringify(r.body) + ',');
    lines.push('});');
    return lines.join('\n');
  },
  // kind: curl-bash | curl-cmd | powershell | fetch. includeAuth is the explicit toggle.
  format(req, kind, { includeAuth = false } = {}) {
    const r = this.redact(req, { includeAuth });
    switch (kind) {
      case 'curl-bash': return this.toCurlBash(r);
      case 'curl-cmd': return this.toCurlCmd(r);
      case 'powershell': return this.toPowerShell(r);
      case 'fetch': return this.toFetch(r);
      default: throw new Error('Unknown format "' + kind + '": use ' + Object.keys(this.FORMATS).join(', '));
    }
  },

  // "Name: value" lines <-> headers
  parseHeaders(text) {
    return String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
      const i = l.indexOf(':');
      if (i < 1) throw new Error('Write each header as Name: value (not "' + l.slice(0, 40) + '")');
      return { name: l.slice(0, i).trim(), value: l.slice(i + 1).trim() };
    });
  },

  // ---- sending to the playground ------------------------------------------------------------
  toPlayground(req, { includeAuth = false } = {}) {
    if (typeof ApiPlayground === 'undefined' || typeof ApiPlayground.open !== 'function') throw new Error('The API playground is not available in this build');
    const r = this.redact(req, { includeAuth, drop: true });
    return ApiPlayground.open({ url: r.url, method: r.method, body: r.body, headers: r.headers });
  },

  // ---- the card -------------------------------------------------------------------------------
  open(init) {
    if (typeof VexUsage !== 'undefined') VexUsage.touch('copy-as-request');
    const start = { method: 'GET', url: '', headers: [], body: '', ...(init || {}) };
    const { body } = VexSettingsGroups.dialog({ id: 'vex-copyas', title: 'Copy as a request', sub: 'Formats text on this computer. Sensitive headers are left out unless you tick the box.' });
    const mk = (tag, attrs, style) => { const e = document.createElement(tag); Object.assign(e, attrs || {}); if (style) e.style.cssText = style; return e; };
    const mono = "font-family:'JetBrains Mono',monospace;font-size:12px;";
    const method = mk('select', { className: 'set-input' });
    method.setAttribute('aria-label', 'Method');
    for (const m of this.METHODS) method.appendChild(mk('option', { value: m, textContent: m }));
    method.value = start.method;
    const url = mk('input', { className: 'set-input', type: 'text', value: start.url, spellcheck: false }, 'flex:1;' + mono);
    url.setAttribute('aria-label', 'Address');
    const top = mk('div', {}, 'display:flex;gap:8px;margin-bottom:8px');
    top.append(method, url);
    const headers = mk('textarea', { className: 'set-input', rows: 4, spellcheck: false, value: start.headers.map(h => h.name + ': ' + h.value).join('\n') }, 'width:100%;box-sizing:border-box;' + mono);
    headers.setAttribute('aria-label', 'Headers, one per line as Name: value');
    headers.placeholder = 'Name: value (one per line)';
    const reqBody = mk('textarea', { className: 'set-input', rows: 3, spellcheck: false, value: start.body }, 'width:100%;box-sizing:border-box;margin-top:6px;' + mono);
    reqBody.setAttribute('aria-label', 'Body');
    reqBody.placeholder = 'Body (not used for GET and HEAD)';
    const auth = mk('input', { type: 'checkbox' });
    const authLabel = mk('label', {}, 'display:flex;gap:6px;align-items:center;font-size:12px;margin:8px 0');
    authLabel.append(auth, document.createTextNode('Include authorization and cookies (otherwise they are left out)'));
    const fmt = mk('select', { className: 'set-input' });
    fmt.setAttribute('aria-label', 'Format');
    for (const [k, v] of Object.entries(this.FORMATS)) fmt.appendChild(mk('option', { value: k, textContent: v }));
    const out = mk('pre', {}, 'margin:8px 0;padding:8px 10px;border:1px solid var(--border);border-radius:8px;white-space:pre-wrap;word-break:break-all;user-select:text;' + mono);
    const note = mk('div', {}, 'font-size:12px;color:var(--text-muted);min-height:16px');
    const read = () => ({ method: method.value, url: url.value, headers: this.parseHeaders(headers.value), body: reqBody.value });
    const draw = () => {
      try {
        const req = read();
        out.textContent = this.format(req, fmt.value, { includeAuth: auth.checked });
        const n = auth.checked ? 0 : this.redactedCount(req);
        note.textContent = n ? n + ' sensitive value' + (n === 1 ? ' was' : 's were') + ' replaced with ' + this.REDACTED + '.' : '';
      } catch (err) { out.textContent = ''; note.textContent = err.message; }
    };
    for (const el of [method, url, headers, reqBody, fmt]) el.addEventListener('input', draw);
    auth.addEventListener('change', draw);
    const copy = VexSettingsGroups.button('Copy', async () => {
      try { if (!out.textContent) throw new Error(note.textContent || 'Nothing to copy'); await navigator.clipboard.writeText(out.textContent); window.showToast?.('Copied'); }
      catch (err) { window.showToast?.('Could not copy: ' + err.message, 'error'); }
    }, { primary: true });
    const pg = VexSettingsGroups.button('Open in API playground', () => {
      try { this.toPlayground(read(), { includeAuth: auth.checked }); }
      catch (err) { window.showToast?.(err.message, 'error'); }
    });
    const btns = mk('div', {}, 'display:flex;gap:8px;flex-wrap:wrap');
    btns.append(copy, pg);
    body.append(top, headers, reqBody, authLabel, fmt, out, note, btns);
    draw();
  },

  settingsRows(body) {
    body.appendChild(VexSettingsGroup.toggle('Copy as cURL, fetch or PowerShell', this.enabled(), (on) => this.setEnabled(on), 'right-click a link, or Ctrl+K'));
  },
};

if (typeof window !== 'undefined') {
  window.VexCopyAs = VexCopyAs;
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({
      id: 'copy-as-request', label: 'Copy as cURL, fetch or PowerShell', hint: 'Format a request, hide its secrets, or open it in the API playground', icon: 'terminal',
      action: () => {
        if (!VexCopyAs.enabled()) throw new Error('Copy as request is switched off in Settings');
        const tab = typeof TabManager !== 'undefined' && TabManager.getActiveTab ? TabManager.getActiveTab() : null;
        VexCopyAs.open({ url: tab && /^https?:/i.test(tab.url || '') ? tab.url : '' });
      },
    });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexCopyAs };
