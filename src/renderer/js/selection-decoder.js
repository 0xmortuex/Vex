// === Selection decoder =========================================================
//
// Select a base64 string, a percent-encoded address, a JWT, a hex number or
// string, a Unix time or backslash-u escapes on any page, right-click, and
// "Decode selection" shows what it is as a small card. Everything is worked out
// here, on this computer, from the selected text alone:
//
//   * nothing is sent anywhere and nothing is kept: the card shows the result
//     and the text is forgotten when it closes;
//   * a JWT is shown decoded but NEVER verified: its signature is not checked,
//     so the card says it proves nothing about who made it, and it is not logged;
//   * decoding is a read-out, it never runs or opens what it decoded.
//
// It also looks codes up in local tables (js/selection-decoder-tables.js, no network): errno and Windows
// error numbers, NTSTATUS / HRESULT (including the DirectX device-removed codes), EFI_STATUS, HTTP status
// codes, signals and shell exit codes (128+N), and cron expressions (in words, with the next runs). A bare
// number is only decoded when it is a name (ENOENT, STATUS_ACCESS_VIOLATION), a hex status (0xC0000005) or
// has a word in front (errno 2, signal 11, exit code 139); a code that is not in a table is said so.
//
// analyze() is pure (the clock and the zone are passed in) and tested in
// tests/renderer/selectionDecoder.test.js.
const VexDecode = {
  ENABLED_KEY: 'vex.selectionDecoder.enabled',
  MAX_INPUT: 20000,
  MAX_SHOWN: 4000,

  enabled() {
    try { return localStorage.getItem(this.ENABLED_KEY) !== 'false'; }
    catch (err) { console.error('[Decode] the switch could not be read:', err); return true; }
  },
  setEnabled(on) { localStorage.setItem(this.ENABLED_KEY, on ? 'true' : 'false'); },

  // ---- helpers (pure) ------------------------------------------------------------
  _clip(s) { const t = String(s); return t.length > this.MAX_SHOWN ? t.slice(0, this.MAX_SHOWN) + '... (' + (t.length - this.MAX_SHOWN) + ' more characters)' : t; },

  // base64 or base64url text -> Uint8Array, or null when it is not valid base64.
  _b64bytes(text) {
    let s = String(text).replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(s)) return null;
    s = s.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
    if (s.length % 4 === 1) return null;
    while (s.length % 4) s += '=';
    let bin;
    try { bin = atob(s); } catch { return null; }   // vex-allow-empty-catch: invalid base64 is "not base64", reported as null
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
  // Bytes -> text when they are valid UTF-8 and mostly printable; else null.
  _text(bytes) {
    let t;
    try { t = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }   // vex-allow-empty-catch: not UTF-8 means "not text"
    if (!t.length) return null;
    let odd = 0;
    for (const ch of t) { const c = ch.codePointAt(0); if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 0x7f || c === 0xfffd) odd++; }
    return odd / [...t].length <= 0.05 ? t : null;
  },
  _hex(bytes, max = 48) {
    const h = Array.from(bytes.slice(0, max), b => b.toString(16).padStart(2, '0')).join(' ');
    return h + (bytes.length > max ? ' ... (' + bytes.length + ' bytes)' : '');
  },
  _pretty(json) { return JSON.stringify(json, null, 2); },

  _when(sec, now, zone) {
    const d = new Date(sec * 1000);
    if (!Number.isFinite(d.getTime())) return null;
    const diff = Math.round((sec * 1000 - now) / 1000);
    const abs = Math.abs(diff);
    const span = abs < 90 ? abs + ' seconds' : abs < 5400 ? Math.round(abs / 60) + ' minutes' : abs < 129600 ? Math.round(abs / 3600) + ' hours' : Math.round(abs / 86400) + ' days';
    return {
      utc: d.toISOString(),
      local: d.toLocaleString('en-GB', { timeZone: zone || undefined, hour12: false, dateStyle: 'medium', timeStyle: 'medium' }),
      relative: diff >= 0 ? 'in ' + span : span + ' ago',
    };
  },

  // ---- detectors ---------------------------------------------------------------------
  _jwt(s, now, zone) {
    const m = /^([A-Za-z0-9_-]{4,})\.([A-Za-z0-9_-]{2,})\.([A-Za-z0-9_-]*)$/.exec(s);
    if (!m) return null;
    const parts = [this._b64bytes(m[1]), this._b64bytes(m[2])];
    if (!parts[0] || !parts[1]) return null;
    let header, payload;
    try {
      header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(parts[0]));
      payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(parts[1]));
    } catch { return null; }   // vex-allow-empty-catch: not JSON means "not a JWT"
    if (!header || typeof header !== 'object' || Array.isArray(header) || !('alg' in header || 'typ' in header)) return null;
    const rows = [{ label: 'Header', value: this._pretty(header), code: true }, { label: 'Payload', value: this._pretty(payload), code: true }];
    for (const claim of ['iat', 'nbf', 'exp']) {
      if (payload && typeof payload[claim] === 'number') {
        const w = this._when(payload[claim], now, zone);
        if (w) rows.push({ label: claim === 'exp' ? 'Expires' : claim === 'iat' ? 'Issued' : 'Not before', value: w.utc + '  (' + w.relative + ')' });
      }
    }
    rows.push({ label: 'Signature', value: m[3] ? m[3].length + ' characters, NOT checked' : 'none' });
    const warn = ['Not verified. Vex only unpacks the text; it does not check the signature, so this says nothing about who made the token. The token never leaves this window.'];
    if (String(header.alg).toLowerCase() === 'none') warn.push('The algorithm is "none": the token carries no signature at all.');
    return { kind: 'jwt', title: 'JSON Web Token', rows, warnings: warn };
  },

  _percent(s) {
    if (!/%[0-9A-Fa-f]{2}/.test(s)) return null;
    let out;
    try { out = decodeURIComponent(s); } catch { return null; }   // vex-allow-empty-catch: a broken escape means "not percent-encoded text"
    if (out === s) return null;
    return { kind: 'url', title: 'Percent-encoded text', rows: [{ label: 'Decoded', value: this._clip(out), code: true }] };
  },

  _escapes(s) {
    const re = /\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})|\bU\+([0-9A-Fa-f]{4,6})\b/g;
    if (!re.test(s)) return null;
    re.lastIndex = 0;
    let bad = false;
    const out = s.replace(re, (_m, a, b, c, d) => {
      const cp = parseInt(a || b || c || d, 16);
      if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff && !b)) { bad = true; return _m; }
      return String.fromCodePoint(cp);
    });
    if (bad && out === s) return null;
    return { kind: 'escapes', title: 'Unicode escapes', rows: [{ label: 'Decoded', value: this._clip(out), code: true }] };
  },

  _epoch(s, now, zone) {
    if (!/^\d{9,13}$/.test(s)) return null;
    const n = Number(s);
    const sec = s.length <= 10 ? n : n / 1000;
    if (sec < 946684800 || sec > 4102444800) return null;   // 2000-01-01 .. 2100-01-01
    const w = this._when(sec, now, zone);
    if (!w) return null;
    return { kind: 'epoch', title: s.length <= 10 ? 'Unix time (seconds)' : 'Unix time (milliseconds)', rows: [
      { label: 'UTC', value: w.utc }, { label: 'Local', value: w.local }, { label: 'Relative', value: w.relative },
    ] };
  },

  _hexString(s) {
    const m = /^(0x)?([0-9a-fA-F]+)$/.exec(s.replace(/[\s:]+/g, ''));
    if (!m) return null;
    const digits = m[2];
    const rows = [];
    // As a number (BigInt: any length, no rounding).
    if (digits.length <= 32) rows.push({ label: 'As a number', value: BigInt('0x' + digits).toString(10) });
    if (digits.length % 2 === 0 && digits.length >= 4) {
      const bytes = new Uint8Array(digits.length / 2);
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(digits.slice(i * 2, i * 2 + 2), 16);
      const text = this._text(bytes);
      if (text) rows.unshift({ label: 'As text', value: this._clip(text), code: true });
    }
    if (!rows.length) return null;
    // A plain decimal-looking run of digits is far more often a number than hex: leave it
    // to the other readers unless it has a letter or a 0x.
    if (!m[1] && !/[a-fA-F]/.test(digits)) return null;
    return { kind: 'hex', title: 'Hexadecimal', rows };
  },

  _base64(s) {
    const t = s.replace(/\s+/g, '');
    if (t.length < 8 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(t)) return null;
    // Plain words and numbers are valid base64 too. Without padding, "+", "/", "-" or "_"
    // it must be long and mixed-case-with-digits to count.
    const marked = /[=+/_-]/.test(t);
    if (!marked && !(t.length >= 16 && /[A-Z]/.test(t) && /[a-z]/.test(t) && /\d/.test(t))) return null;
    const bytes = this._b64bytes(t);
    if (!bytes || !bytes.length) return null;
    const text = this._text(bytes);
    const rows = text
      ? [{ label: 'Decoded text', value: this._clip(text), code: true }]
      : [{ label: 'Not text', value: bytes.length + ' bytes', code: false }, { label: 'As hex', value: this._hex(bytes), code: true }];
    // Not text: only padding or a + or / shows it is really base64 (a kebab-case or snake_case word is not).
    if (!text && !/=|[+/]/.test(t)) return null;
    return { kind: 'base64', title: /[-_]/.test(t) && !/[+/]/.test(t) ? 'Base64 (URL-safe)' : 'Base64', rows };
  },

  _tables() {
    if (typeof VexDecodeTables !== 'undefined') return VexDecodeTables;
    if (typeof require === 'function') return require('./selection-decoder-tables').VexDecodeTables;
    throw new Error('selection-decoder-tables.js must load before selection-decoder.js');
  },

  _http(s) {
    const m = /^(?:HTTP[ /]?\d?(?:\.\d)?\s*)?([1-5]\d\d)(?:\s+[A-Za-z' -]{2,40})?$/i.exec(s);
    if (!m) return null;
    const h = this._tables().http(m[1]);
    if (!h) return null;
    return { kind: 'http', title: 'HTTP status ' + h.code, rows: [{ label: 'Name', value: h.name }, { label: 'Family', value: h.family }, { label: 'Meaning', value: h.meaning }] };
  },

  _errno(s) {
    const T = this._tables();
    const rows = [];
    const add = (label, e) => rows.push({ label, value: e.name + (e.number != null ? ' (' + e.number + ')' : '') + ': ' + e.meaning });
    let m = /^(?:Error:\s*)?(WSAE[A-Z0-9]+|E[A-Z][A-Z0-9]{2,})\b(?::.*)?$/.exec(s);
    if (m) {
      const name = m[1];
      const e = T.errno(name);
      if (e) add('errno', e);
      for (const [n, v] of Object.entries(T.WIN32)) if (v[0] === name) add('Windows', { number: Number(n), name, meaning: v[1] });
      if (!rows.length) return null;
      return { kind: 'errno', title: 'Error ' + name, rows, warnings: e ? ['The numbers differ between systems: this is the Linux number; macOS and Windows C runtimes use others for some names.'] : undefined };
    }
    m = /^\(?\s*(errno|os error|error)\s*[:=#]?\s*(-?\d{1,5})\s*\)?$/i.exec(s);
    if (m) {
      const n = Math.abs(Number(m[2]));
      const e = T.errno(String(n)), w = T.win32(n);
      if (e) add('Linux errno', e);
      if (w) add('Windows error', w);
      if (!rows.length) return null;
      return { kind: 'errno', title: 'Error number ' + n, rows, warnings: e && w ? ['The same number means different things on Linux and Windows: use the line for the system the message came from.'] : undefined };
    }
    m = /^(?:WinError|Win32 error|GetLastError|WSAGetLastError|system error)\s*[:=#]?\s*(\d{1,5})$/i.exec(s);
    if (m) {
      const w = T.win32(m[1]);
      if (!w) return null;
      add('Windows error', w);
      return { kind: 'errno', title: 'Windows error ' + w.number, rows };
    }
    return null;
  },

  _status(s) {
    const T = this._tables();
    let v = null;
    let m = /^(?:0x)?([0-9A-Fa-f]{8})$/.exec(s);
    if (m && (/^0x/i.test(s) || /[A-Fa-f]/.test(m[1]))) v = parseInt(m[1], 16);
    else if ((m = /^(?:exit code|exit status|status|code)?\s*[:=]?\s*(-?\d{9,10})$/i.exec(s))) {
      const n = Number(m[1]);
      if (n >= -2147483648 && n <= 4294967295) v = n >>> 0;
    } else if (/^(STATUS_[A-Z0-9_]+|E_[A-Z]+|DXGI_ERROR_[A-Z_]+)$/.test(s)) {
      const hit = Object.entries(T.NTSTATUS).find(([, e]) => e[0] === s);
      if (hit) v = Number(hit[0]);
    }
    if (v == null) return null;
    const r = T.ntstatus(v);
    // Only a code that is in the table, or that has the high bit set (a warning or an error), is worth a card.
    if (!r.known && r.severity !== 'Error' && r.severity !== 'Warning') return null;
    const rows = [{ label: 'Code', value: r.hex + '  (signed ' + (v | 0) + ', unsigned ' + v + ')' }];
    rows.push(r.known ? { label: 'Name', value: r.name } : { label: 'Name', value: 'not in the offline table' });
    if (r.known) rows.push({ label: 'Meaning', value: r.meaning });
    rows.push({ label: 'Severity', value: r.severity });
    const fac = T.facilityName(r.facility);
    rows.push({ label: 'Facility', value: r.facility + (fac ? ' (' + fac + ')' : '') });
    const w = T.win32InHresult(v);
    if (w) rows.push({ label: 'Win32 error inside', value: w.name + ' (' + w.number + '): ' + w.meaning });
    const warnings = [];
    if (!r.known) warnings.push('The same shape is used by NTSTATUS and HRESULT; this code is not in the short offline table, so only its parts are read out.');
    return { kind: 'ntstatus', title: 'Windows status ' + r.hex, rows, warnings: warnings.length ? warnings : undefined };
  },

  _efi(s) {
    const T = this._tables();
    let key = null;
    let m = /^EFI_[A-Z_]+$/.exec(s);
    if (m) key = s;
    else if ((m = /^(?:0x)?([0-9A-Fa-f]{16})$/.exec(s)) && (/^0x/i.test(s) || /[A-Fa-f]/.test(m[1]))) key = '0x' + m[1];
    else if ((m = /^0x(80[0-9A-Fa-f]{6})$/.exec(s))) key = '0x' + m[1];
    if (key == null) return null;
    const r = T.efi(key);
    if (!r) return null;
    const rows = [{ label: 'Name', value: r.name }, { label: 'Kind', value: r.kind }, { label: 'Meaning', value: r.meaning }];
    if (r.number) rows.splice(1, 0, { label: 'Number', value: String(r.number) + (r.bits ? ' (error bit set, ' + r.bits + '-bit status)' : '') });
    const warnings = r.bits === 32 ? ['As a 32-bit EFI_STATUS. The same number is also read as a Windows status if it comes from Windows.'] : undefined;
    return { kind: 'efi', title: 'UEFI status ' + r.name, rows, warnings };
  },

  _signal(s) {
    const T = this._tables();
    let sig = null, from = '';
    let m = /^SIG[A-Z0-9]+$/.exec(s);
    if (m) { sig = T.signal(s); }
    else if ((m = /^(?:signal|sig)\s*[:=#]?\s*(\d{1,2})$/i.exec(s))) { sig = T.signal(m[1]); }
    else if ((m = /^(?:exit(?:ed)?(?: with)?(?: code| status)?|status|exit)\s*[:=#]?\s*(\d{3})$/i.exec(s))) {
      const x = T.exitCode(m[1]);
      if (x) { sig = x.signal; from = 'Exit code ' + x.code + ' = 128 + ' + x.signal.number; }
    }
    if (!sig) return null;
    const rows = [{ label: 'Signal', value: sig.name + ' (' + sig.number + ')' }, { label: 'Default action', value: sig.action }, { label: 'Meaning', value: sig.meaning }];
    if (from) rows.unshift({ label: 'Exit code', value: from + ': the process was ended by this signal' });
    return { kind: 'signal', title: 'Signal ' + sig.name, rows, warnings: ['Numbers are the Linux ones; macOS numbers some signals differently.'] };
  },

  _cron(s, now) {
    const T = this._tables();
    const macro = T.MACROS[s.toLowerCase()];
    const tokens = s.split(/\s+/);
    if (!macro) {
      if (tokens.length !== 5 || !tokens.every(t => /^[\d*\/,A-Za-z-]+$/.test(t))) return null;
      // Five plain numbers are far more often something else; a cron has a star, a step, a list, a range or a name.
      if (!/[*\/,A-Za-z-]/.test(s)) return null;
    }
    let c;
    try { c = T.parseCron(s); } catch { return null; }   // vex-allow-empty-catch: not a valid cron expression means "not cron"
    const rows = [{ label: 'In words', value: T.cronWords(c) }];
    const next = T.cronNext(c, 3, now);
    if (next.length) rows.push({ label: 'Next runs', value: next.map(d => d.toLocaleString('en-GB', { hour12: false, dateStyle: 'medium', timeStyle: 'short' })).join('\n'), code: true });
    else rows.push({ label: 'Next runs', value: 'none in the next two years' });
    if (macro) rows.push({ label: 'Same as', value: macro, code: true });
    return { kind: 'cron', title: 'Cron expression', rows, warnings: ['Times are in this computer\'s time zone; a server may run cron in another one.'] };
  },

  // What the text could be: a list of { kind, title, rows:[{label,value,code}], warnings? }.
  // Empty when it is none of them. `now` and `zone` are for tests.
  analyze(text, { now = Date.now(), zone } = {}) {
    const s = String(text == null ? '' : text).trim();
    if (!s || s.length > this.MAX_INPUT) return [];
    const found = [];
    const jwt = this._jwt(s, now, zone);
    if (jwt) found.push(jwt);
    else {
      for (const fn of [this._http, this._errno, this._status, this._efi, this._signal, this._cron, this._epoch, this._percent, this._escapes, this._hexString, this._base64]) {
        const r = fn.call(this, s, now, zone);
        if (r) found.push(r);
      }
    }
    return found;
  },
  looksDecodable(text) { return this.enabled() && this.analyze(text).length > 0; },

  // ---- the card ------------------------------------------------------------------------
  open(text) {
    const found = this.analyze(text);
    if (typeof VexUsage !== 'undefined') VexUsage.touch('selection-decoder');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-decode', title: 'Decoded selection', sub: 'Worked out on this computer from the text you selected. Nothing is sent or kept.' });
    if (!found.length) { body.appendChild(VexSettingsGroups.note('Nothing here looks like base64, a percent-encoded address, a JWT, hex, a Unix time, unicode escapes, an error code (errno, Windows status, UEFI), an HTTP status, a signal or a cron expression.')); return; }
    for (const f of found) {
      const card = document.createElement('div');
      card.style.cssText = 'border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin:0 0 10px';
      const h = document.createElement('div');
      h.style.cssText = 'font-weight:700;font-size:13px;margin-bottom:6px;color:var(--text)';
      h.textContent = f.title;
      card.appendChild(h);
      for (const w of f.warnings || []) {
        const p = document.createElement('div');
        p.style.cssText = 'font-size:12px;color:var(--warning,var(--text));margin:0 0 8px';
        p.textContent = w;
        card.appendChild(p);
      }
      for (const r of f.rows) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;margin:4px 0';
        const l = document.createElement('span');
        l.style.cssText = 'min-width:84px;font-size:11.5px;color:var(--text-muted)';
        l.textContent = r.label;
        const v = document.createElement(r.code ? 'pre' : 'span');
        v.style.cssText = 'flex:1;margin:0;font-size:12px;white-space:pre-wrap;word-break:break-word;user-select:text;' + (r.code ? "font-family:'JetBrains Mono',monospace;" : '');
        v.textContent = r.value;
        const c = VexSettingsGroups.button('Copy', async () => {
          try { await navigator.clipboard.writeText(r.value); window.showToast?.('Copied'); }
          catch (err) { window.showToast?.('Could not copy: ' + err.message, 'error'); }
        });
        c.setAttribute('aria-label', 'Copy ' + r.label);
        row.append(l, v, c);
        card.appendChild(row);
      }
      body.appendChild(card);
    }
  },

  settingsRows(body) {
    const S = VexSettingsGroup;
    body.appendChild(S.toggle('Decode selection', this.enabled(), (on) => this.setEnabled(on), 'right-click selected base64, JWT, hex, a Unix time or escapes'));
  },
};

if (typeof window !== 'undefined') window.VexDecode = VexDecode;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDecode };
