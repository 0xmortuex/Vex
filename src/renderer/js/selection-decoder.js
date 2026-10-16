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
// The entry's longer list (errno, NTSTATUS, EFI_STATUS, HTTP codes, signals, cron
// with offline lookup tables) is not built: only the decodings above.
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

  // What the text could be: a list of { kind, title, rows:[{label,value,code}], warnings? }.
  // Empty when it is none of them. `now` and `zone` are for tests.
  analyze(text, { now = Date.now(), zone } = {}) {
    const s = String(text == null ? '' : text).trim();
    if (!s || s.length > this.MAX_INPUT) return [];
    const found = [];
    const jwt = this._jwt(s, now, zone);
    if (jwt) found.push(jwt);
    else {
      for (const fn of [this._epoch, this._percent, this._escapes, this._hexString, this._base64]) {
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
    if (!found.length) { body.appendChild(VexSettingsGroups.note('Nothing here looks like base64, a percent-encoded address, a JWT, hex, a Unix time or unicode escapes.')); return; }
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
