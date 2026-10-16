// === Sensitivity gate before cloud calls (T1-042) ============================
//
// Every request that would leave this computer for the cloud AI passes through
// here first (AIRouter.callBackend, the one place all cloud requests go through,
// fallbacks included). It looks at WHAT is in the request, not only at which
// feature asked:
//
//   history       entries of the browsing history (historySearch/historyIndex or
//                 any request carrying historyEntries). Local by default; to the
//                 cloud only after a per-call "Send once", never from a
//                 background feature.
//   mail          text from a webmail page or a mail digest. Per-call consent.
//   bank-health   a bank, payment or health page. Per-call consent.
//   vault         a password-manager / vault page. Never leaves.
//   private-tab   a private window, a private/Tor tab. Never leaves.
//   secrets       a card number, an IBAN, a TC kimlik number, an API key or
//                 private key, a one-time code, "password: ...". The request may
//                 go only as a REDACTED copy (shown as a diff), or stay local.
//
// The person always sees what would leave ("What would leave" preview) before
// anything is sent. A refused or redacted request is written to the "Why did
// that happen?" ledger (what and why, never the content); the request that does
// leave appears in the egress ledger (main/egress-ledger.js) as host and bytes.
//
// Decisions are plain functions (classify/redact/decide) so they can be tested
// with no DOM; gate() is the part that asks the person.
//
// Stored: nothing. Consent is per call by design (a "remember" would be a way to
// send history to the cloud without looking).

const VexSensitivity = {
  MAX_SCAN: 200000,        // characters looked at
  MAX_PREVIEW: 600,        // characters of each shown snippet

  // class -> what happens. 'refuse' has no way through, 'ask' needs a yes for
  // this one call, 'redact' sends only the redacted copy.
  POLICY: { history: 'ask', mail: 'ask', 'bank-health': 'ask', vault: 'refuse', 'private-tab': 'refuse', secrets: 'redact' },
  LABELS: {
    history: 'browsing history', mail: 'mail', 'bank-health': 'a bank, payment or health page',
    vault: 'a password manager or vault page', 'private-tab': 'a private window or tab', secrets: 'a secret (card, IBAN, ID number, key or code)',
  },

  // Features that nobody is waiting for: they never get to ask.
  BACKGROUND: ['historyIndex'],
  HISTORY_FEATURES: ['historySearch', 'historyIndex'],

  MAIL_HOSTS: /(^|\.)(mail\.google\.com|outlook\.live\.com|outlook\.office\.com|outlook\.office365\.com|mail\.yahoo\.com|mail\.proton\.me|proton\.me|protonmail\.com|mail\.zoho\.com|fastmail\.com|icloud\.com|mail\.ru|yandex\.com|mail\.yandex\.com|hotmail\.com|webmail\.[a-z0-9.-]+)$/i,
  VAULT_HOSTS: /(^|\.)(1password\.com|bitwarden\.com|lastpass\.com|dashlane\.com|keepersecurity\.com|vault\.bitwarden\.com|my\.1password\.com|proton\.me\/pass|nordpass\.com|roboform\.com)$/i,
  // Words in a host name that mean money or health. Deliberately a short list of
  // clear words: a miss only means the secret scanner is the safety net.
  BANK_HEALTH_WORDS: /(^|[.-])(bank|banka|bankasi|banking|paypal|wise|revolut|payoneer|stripe|ibank|internetbank|garanti|isbank|akbank|ziraat|yapikredi|qnb|denizbank|chase|wellsfargo|bankofamerica|hsbc|barclays|santander|mychart|patient|saglik|enabiz|hospital|hastane|clinic|klinik|pharmacy|eczane|medical|healthcare|insurance|sigorta)([.-]|$)/i,

  // ---- reading a request -----------------------------------------------------
  // Every string in the request with the path it was found at; the known
  // non-content fields (the Stop signal, callbacks) are skipped.
  strings(request) {
    const out = [];
    const skip = new Set(['signal', 'onMeta', 'onToken', 'onThinking', 'onSlow', 'persona', 'availableTools', 'image']);
    let budget = this.MAX_SCAN;
    const walk = (v, path, depth) => {
      if (budget <= 0 || depth > 5 || v == null) return;
      if (typeof v === 'string') {
        const s = v.length > budget ? v.slice(0, budget) : v;
        budget -= s.length;
        if (s) out.push({ path, text: s });
        return;
      }
      if (typeof v === 'function' || typeof v !== 'object') return;
      if (Array.isArray(v)) { v.slice(0, 400).forEach((x, i) => walk(x, path + '[' + i + ']', depth + 1)); return; }
      for (const [k, x] of Object.entries(v)) { if (!skip.has(k)) walk(x, path ? path + '.' + k : k, depth + 1); }
    };
    walk(request, '', 0);
    return out;
  },

  _hostOf(url) { try { return new URL(String(url)).hostname.toLowerCase(); } catch { return ''; } },

  // Every address in the request (page, tabs, history entries).
  hosts(request) {
    const urls = [];
    if (!request || typeof request !== 'object') return [];
    if (request.pageContext && request.pageContext.url) urls.push(request.pageContext.url);
    for (const c of (Array.isArray(request.tabContexts) ? request.tabContexts : [])) if (c && c.url) urls.push(c.url);
    for (const e of (Array.isArray(request.historyEntries) ? request.historyEntries : [])) if (e && e.url) urls.push(e.url);
    return urls.map(u => ({ url: String(u), host: this._hostOf(u) })).filter(x => x.host || /^vex:/i.test(x.url));
  },

  // ---- the scanners -----------------------------------------------------------
  _luhn(digits) {
    let sum = 0, alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = digits.charCodeAt(i) - 48;
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    return sum % 10 === 0;
  },
  _iban(raw) {
    const s = raw.replace(/\s+/g, '').toUpperCase();
    if (s.length < 15 || s.length > 34) return false;
    const moved = s.slice(4) + s.slice(0, 4);
    let rem = 0;
    for (const ch of moved) {
      const v = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
      for (const d of v) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
    }
    return rem === 1;
  },
  // Turkish national ID number: 11 digits, first not zero, two check digits.
  _tckn(s) {
    if (!/^[1-9]\d{10}$/.test(s)) return false;
    const d = s.split('').map(Number);
    const odd = d[0] + d[2] + d[4] + d[6] + d[8];
    const even = d[1] + d[3] + d[5] + d[7];
    const d10 = (((odd * 7) - even) % 10 + 10) % 10;
    const d11 = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
    return d[9] === d10 && d[10] === d11;
  },

  // The patterns, each with the words that replace a match. Order matters: the
  // longer shapes first so a card inside a key is not cut in two.
  SECRET_RULES: [
    { id: 'private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, to: '[private key removed]' },
    { id: 'API key', re: /\b(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g, to: '[API key removed]' },
    { id: 'password', re: /\b(?:password|passwd|pwd|parola|şifre|sifre)\s*[:=]\s*\S+/gi, to: '[password removed]' },
    { id: 'IBAN', re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g, to: '[IBAN removed]', check: (m) => VexSensitivity._iban(m) },
    { id: 'card number', re: /\b\d(?:[ -]?\d){12,18}\b/g, to: '[card number removed]', check: (m) => { const d = m.replace(/[\s-]/g, ''); return d.length >= 13 && d.length <= 19 && VexSensitivity._luhn(d); } },
    { id: 'ID number', re: /\b[1-9]\d{10}\b/g, to: '[ID number removed]', check: (m) => VexSensitivity._tckn(m) },
    // 6 to 8 digits only: "the code 1234" in ordinary talk about programming is not a login code.
    { id: 'one-time code', re: /(\b(?:code|otp|2fa|mfa|passcode|verification|doğrulama|dogrulama|kodu?)\b[^\d\n]{0,24})(\d{6,8})\b/gi, to: '$1[code removed]', group: true },
  ],

  // -> { text, found: [{ id, count }] }
  redact(text) {
    let s = String(text == null ? '' : text);
    const found = [];
    for (const rule of this.SECRET_RULES) {
      let count = 0;
      s = s.replace(rule.re, (...args) => {
        const m = args[0];
        if (rule.check && !rule.check(m)) return m;
        count++;
        return rule.group ? rule.to.replace('$1', args[1]) : rule.to;
      });
      if (count) found.push({ id: rule.id, count });
    }
    return { text: s, found };
  },

  // Does a request carry a secret anywhere? -> [{ id, count }]
  scanSecrets(request) {
    const total = new Map();
    for (const { text } of this.strings(request)) {
      for (const f of this.redact(text).found) total.set(f.id, (total.get(f.id) || 0) + f.count);
    }
    return [...total].map(([id, count]) => ({ id, count }));
  },

  // A copy of the request with every string redacted. Fields that are not text
  // (numbers, flags, the Stop signal, callbacks) are kept as they were.
  redactRequest(request) {
    const walk = (v, depth) => {
      if (typeof v === 'string') return this.redact(v).text;
      if (v == null || typeof v !== 'object' || depth > 6) return v;
      if (Array.isArray(v)) return v.map(x => walk(x, depth + 1));
      const out = {};
      // The Stop signal and the callbacks are not text: they are kept as they are.
      for (const [k, x] of Object.entries(v)) out[k] = (k === 'signal' || typeof x === 'function') ? x : walk(x, depth + 1);
      return out;
    };
    return walk(request, 0);
  },

  // ---- the classification -----------------------------------------------------
  // -> { classes: [{ id, why }], secrets: [{ id, count }] }
  classify(feature, request) {
    const classes = [];
    const add = (id, why) => { if (!classes.some(c => c.id === id)) classes.push({ id, why }); };
    const req = request && typeof request === 'object' ? request : {};

    if (this.HISTORY_FEATURES.includes(feature) || Array.isArray(req.historyEntries) || req.dataClass === 'history') {
      add('history', Array.isArray(req.historyEntries) ? req.historyEntries.length + ' history entries' : 'browsing history');
    }
    if (req.dataClass === 'mail') add('mail', 'mail text');
    if (req.dataClass === 'vault') add('vault', 'vault data');
    if (req.dataClass === 'private') add('private-tab', 'a private tab');
    if (req.private === true || (req.pageContext && (req.pageContext.private === true || req.pageContext.incognito === true))) add('private-tab', 'a private tab');
    // A private window is only a reason when the request carries what the window shows
    // (a page, tabs, history): a question typed into the chat is the person's own words.
    const carriesPages = !!(req.pageContext || (Array.isArray(req.tabContexts) && req.tabContexts.length) || Array.isArray(req.historyEntries));
    try { if (carriesPages && typeof window !== 'undefined' && window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) add('private-tab', 'a private window'); }
    catch (err) { throw new Error('Could not tell whether this is a private window: ' + err.message, { cause: err }); }

    for (const { url, host } of this.hosts(req)) {
      if (/^vex:\/\/(vault|passwords?|passkeys?|totp)/i.test(url) || (host && this.VAULT_HOSTS.test(host))) add('vault', host || url);
      else if (host && this.MAIL_HOSTS.test(host)) add('mail', host);
      else if (host && this.BANK_HEALTH_WORDS.test(host)) add('bank-health', host);
    }
    const secrets = this.scanSecrets(req);
    if (secrets.length) add('secrets', secrets.map(s => s.count + ' ' + s.id).join(', '));
    return { classes, secrets };
  },

  // -> { verdict: 'send' | 'ask' | 'redact' | 'refuse', classes, secrets, why }
  // refuse beats ask beats redact. A background feature that would have to ask is refused.
  decide(feature, request) {
    const { classes, secrets } = this.classify(feature, request);
    if (!classes.length) return { verdict: 'send', classes, secrets, why: '' };
    const kinds = classes.map(c => this.POLICY[c.id]);
    const names = classes.map(c => this.LABELS[c.id]).join('; ');
    if (kinds.includes('refuse')) return { verdict: 'refuse', classes, secrets, why: 'This request holds ' + names + ', which never goes to the cloud.' };
    if (kinds.includes('ask')) {
      if (this.BACKGROUND.includes(feature)) return { verdict: 'refuse', classes, secrets, why: 'A background feature may not send ' + names + ' to the cloud.' };
      return { verdict: 'ask', classes, secrets, why: 'This request holds ' + names + '.' };
    }
    return { verdict: 'redact', classes, secrets, why: 'This request holds ' + names + '.' };
  },

  // ---- what would leave ---------------------------------------------------------
  // A short, human preview: which fields, how big, and the first words of each.
  preview(request) {
    const rows = [];
    let bytes = 0;
    for (const { path, text } of this.strings(request)) {
      bytes += text.length;
      if (rows.length < 8 && text.trim().length > 2) rows.push({ path: path || 'text', size: text.length, head: text.trim().replace(/\s+/g, ' ').slice(0, this.MAX_PREVIEW) });
    }
    return { rows, characters: bytes };
  },

  _esc(s) { return typeof window !== 'undefined' && window.escapeHtml ? window.escapeHtml(String(s)) : String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); },

  // The dialog body: what would leave, with the redacted copy beside it when
  // there is one.
  previewHtml(request, d) {
    const p = this.preview(request);
    const red = d.verdict === 'redact' ? this.preview(this.redactRequest(request)) : null;
    const rows = p.rows.map((r, i) => {
      const after = red && red.rows[i] && red.rows[i].head !== r.head ? '<div style="margin-top:2px"><b>Redacted copy:</b> ' + this._esc(red.rows[i].head) + '</div>' : '';
      return '<li style="margin:6px 0"><code>' + this._esc(r.path) + '</code> (' + r.size + ' characters)<div style="opacity:.85">' + this._esc(r.head) + (r.size > this.MAX_PREVIEW ? '…' : '') + '</div>' + after + '</li>';
    }).join('');
    return '<div class="vex-sensitivity-preview"><b>What would leave:</b> ' + p.characters + ' characters to your cloud AI Worker.<ul style="margin:6px 0 0 18px;max-height:240px;overflow:auto">' + (rows || '<li>nothing readable</li>') + '</ul></div>';
  },

  _ledger(what, why) {
    if (typeof VexLedger === 'undefined') return;
    VexLedger.note({ feature: 'ai-sensitivity', what, why });
  },

  // ---- the gate ------------------------------------------------------------------
  // -> { action: 'send', request } | { action: 'local' }  (or throws a refusal)
  async gate(feature, request, { canLocal = false } = {}) {
    const d = this.decide(feature, request);
    if (d.verdict === 'send') return { action: 'send', request };
    const names = d.classes.map(c => this.LABELS[c.id]).join(', ');
    if (d.verdict === 'refuse') {
      this._ledger('Kept a request from the cloud AI (' + feature + ')', d.why);
      if (canLocal) return { action: 'local' };
      const err = new Error(d.why + ' Use the local model (Settings › AI).');
      err.code = 'vex-sensitive';
      throw err;
    }
    if (typeof window === 'undefined' || typeof window.vexConfirm !== 'function') {
      this._ledger('Kept a request from the cloud AI (' + feature + ')', d.why + ' There was no way to ask.');
      if (canLocal) return { action: 'local' };
      const err = new Error(d.why + ' Vex could not ask you, so nothing was sent.');
      err.code = 'vex-sensitive';
      throw err;
    }
    const redacted = d.verdict === 'redact';
    let alt = false;
    const yes = await window.vexConfirm({
      title: redacted ? 'Send a redacted copy to the cloud AI?' : 'Send this to the cloud AI?',
      message: d.why + (redacted ? ' A copy with those removed can go; the original stays here.' : ' Nothing is sent unless you say so, and this answer is for this one request only.'),
      html: this.previewHtml(request, d),
      okLabel: redacted ? 'Send redacted copy' : 'Send once',
      cancelLabel: 'Cancel',
      wide: true,
      extra: canLocal ? { label: 'Use the local model', run: () => { alt = true; } } : undefined,
    });
    if (alt) { this._ledger('Used the local model instead of the cloud (' + feature + ')', 'You chose it when asked about ' + names); return { action: 'local' }; }
    if (!yes) {
      this._ledger('Did not send a request to the cloud AI (' + feature + ')', 'You declined: ' + names);
      const err = new Error('Not sent: you chose not to send ' + names + ' to the cloud.');
      err.code = 'vex-sensitive';
      throw err;
    }
    this._ledger(redacted ? 'Sent a redacted copy to the cloud AI (' + feature + ')' : 'Sent a request to the cloud AI (' + feature + ')', 'You allowed it once: ' + names);
    return { action: 'send', request: redacted ? this.redactRequest(request) : request };
  },
};

if (typeof window !== 'undefined') window.VexSensitivity = VexSensitivity;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSensitivity };
