// === One file that is actually everything ==================================
//
// A setup code carries the panels, the shortcuts, the theme, the skin and the
// typeface. That is the decoration. It does not carry your notes, your
// sessions, your keybindings, your site rules, your reading list or any of
// the forty other things Vex remembers — so "I can move my setup" meant "I
// can move how it looks", and reinstalling Windows cost you the rest.
//
// This is the rest. One file, written by you, restored by you.
//
// What it deliberately does NOT carry:
//
//  - Secrets. Saved logins and authenticator codes live in the main process,
//    encrypted, and are not readable from here at all. A backup that quietly
//    contained your passwords would be a password file with a friendly name,
//    and it would end up in a downloads folder.
//  - Anything that is about THIS machine rather than about you: when Vex was
//    installed, when it last checked for an update, which panel was open a
//    minute ago. Restoring those onto another machine tells it lies.
//  - Your conversations with the AI, unless you tick the box. They are the
//    most personal thing Vex holds and the largest; that is a decision, not a
//    default.
const VexBackup = {
  // 2 adds `main` (the settings files only the main process keeps: site rules,
  // site permissions, reminders, which extensions are switched off) and
  // `integrity` (a SHA-256 of the payload, checked before any restore). A
  // version-1 file has neither and is still read: it is restored without the
  // check, and says so ("not verified").
  VERSION: 2,
  READABLE: [1, 2],

  // Never leaves the machine, whatever it is called: a denylist of shapes
  // rather than of names, so a key added next year is covered before anyone
  // remembers this file. Matched against the WORDS of the key (camelCase,
  // dots and dashes split): as a bare substring, "pass" and "auth" also threw
  // out ordinary settings — vex.discordBypassMode, vex.robloxBypass,
  // vex.passkeySuppressedHosts (found 2026-10-10).
  // Short stems must be a whole word (or its plural)...
  NEVER_WORDS: ['pass', 'passwd', 'passphrase', 'password', 'secret', 'token', 'key', 'apikey', 'credential', 'vault', 'totp', 'otp', 'seed', 'auth', 'oauth'],
  // ...long ones are unambiguous anywhere in a word (vex.synctoken, vex.aiapisecret).
  NEVER_INSIDE: /password|passphrase|secret|token|credential/i,
  NEVER: [
    // Lock Vex's PIN hash, and its lock state and wrong-PIN count: a 4-digit
    // PIN is quick to try against a hash in a backup file (found 2026-09-29).
    /^vex\.lock(Pin|ed|Fails|WaitUntil)$/i,
    // MCP servers: their tokens were kept here, and a server's address can
    // carry one too (security scan S5-3). The tokens now live encrypted in main.
    /^vex\.mcpServers$/i,
    // Passkeys (main/passkeys.js) live encrypted in the main process and never
    // in a preference; should a key with their name ever appear, it is a
    // passkey store and stays out. Only the two site lists are settings.
    /^vex\.passkey(?!(?:SuppressedHosts|AllowedHosts)$)/i,
    // Page actions are scripts that act as you on a site (js/page-actions.js).
    // They never travel in a backup, so a restore cannot switch them on behind
    // the warning that turning them on shows; the recorder's runs and state go
    // with them.
    /^vex\.pageActions$/i,
    /^vex\.pageRecorder\./i,
  ],

  // True of this machine, not of this person.
  LOCAL: [
    /^vex\.(installedAt|hasRunBefore|lastUpdateCheck|lastSeenVersion|whatsNewPending|notificationsChecked|defaultBrowserConfigured)$/,
    /^vex\.(panelUsage|tabs|sleptAt|commandUsage|clipboard)/,
    // Only the bare key. As a prefix, `session` also caught `vex.sessions` —
    // the named sessions you saved — so the backup that promised "sessions"
    // left every one of them out (found 2026-09-29).
    /^vex\.session$/,
    /^vex\.(aiConversations|aiChatMeta)$/,     // only with consent; added below
  ],

  // Big, personal, and only on request.
  OPTIONAL: {
    chats: [/^vex\.(aiConversations|aiChatMeta)$/],
    history: [/^vex\.(history|recall)/, /^vex\.gameDossier$/],
    // The archive library's one setting (js/archive-library.js). The copies
    // are files in Vex's data folder, not preferences, and are never in here.
    archive: [/^vex\.archive\./],
    // The AI news list Vex holds, what you read, and the address's version tag
    // (js/ai-news.js). Your choices (vex.aiNews.prefs) are an ordinary setting
    // and are in every backup. Never in Vex Sync.
    news: [/^vex\.aiNews\.state$/],
  },

  _keys() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('vex.')) out.push(k);
      }
    } catch (err) { console.error('[Backup] could not read the settings:', err.message); }
    // Notes, the reading list, annotations and AI conversations are kept in
    // the file store, not in browser storage, so the loop above never saw
    // them and the backup left them out (found 2026-09-29). localStorage's
    // getItem/setItem already reach them (js/storage.js).
    if (typeof PersistentStorage !== 'undefined') {
      for (const [k] of PersistentStorage.fileOnlyEntries()) if (k.startsWith('vex.') && !out.includes(k)) out.push(k);
    }
    return out.sort();
  },


  // ---- integrity ----------------------------------------------------------
  // Pure-JS SHA-256 (FIPS 180-4) so the check is synchronous and works in the
  // window and in main alike, and so apply() itself can refuse a damaged file:
  // a restore that forgot to ask could not skip it. It detects damage and
  // careless edits; it is not a signature (anyone can recompute it).
  sha256Hex(text) {
    const K = this._K || (this._K = (() => {
      const k = []; let n = 2;
      while (k.length < 64) {
        let prime = true;
        for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
        if (prime) k.push(Math.floor((Math.cbrt(n) % 1) * 4294967296) >>> 0);
        n++;
      }
      return k;
    })());
    const H = [];
    { let n = 2; while (H.length < 8) { let prime = true; for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; } if (prime) H.push(Math.floor((Math.sqrt(n) % 1) * 4294967296) >>> 0); n++; } }
    const bytes = new TextEncoder().encode(String(text));
    const len = bytes.length;
    const total = ((len + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(total);
    buf.set(bytes);
    buf[len] = 0x80;
    const view = new DataView(buf.buffer);
    view.setUint32(total - 8, Math.floor(len / 0x20000000), false);
    view.setUint32(total - 4, (len << 3) >>> 0, false);
    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return H.map(x => x.toString(16).padStart(8, '0')).join('');
  },

  // JSON with sorted keys at every level: the same payload always hashes the
  // same, whatever order the keys were written in or how the file was indented.
  canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(v => this.canonical(v === undefined ? null : v)).join(',') + ']';
    return '{' + Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => JSON.stringify(k) + ':' + this.canonical(value[k])).join(',') + '}';
  },

  // What the hash covers: the data, not the dates or the version label.
  _payload(data) {
    return { items: data.items || {}, stores: data.stores || {}, main: data.main || {} };
  },
  seal(data) {
    data.integrity = { alg: 'sha256', sum: this.sha256Hex(this.canonical(this._payload(data))) };
    return data;
  },
  // -> 'verified' | 'unverified' (a version-1 file has no sum). Throws when the
  // sum is there and does not match, or names a hash this Vex does not know.
  verify(data) {
    if (!data || typeof data !== 'object') throw new Error('That is not a Vex backup file');
    if (data.integrity === undefined) {
      if (data.v >= 2) throw new Error('This backup has lost its integrity check, so Vex will not restore it');
      return 'unverified';
    }
    const i = data.integrity;
    if (!i || i.alg !== 'sha256' || typeof i.sum !== 'string') throw new Error('This backup uses an integrity check this Vex does not know');
    if (this.sha256Hex(this.canonical(this._payload(data))) !== i.sum.toLowerCase()) {
      throw new Error('This backup is damaged: its contents do not match its checksum, so nothing was restored');
    }
    return 'verified';
  },

  // Settings kept by VexStorage as their own file (settings.json: the ad
  // blocker, sleeping tabs, the memory ceiling …) — not in browser storage at
  // all, so they were not in the backup either (found 2026-09-29).
  STORES: ['settings'],
  // Settings files that are in a backup only when the person ticks the box:
  // the userscripts (their code and saved values). Never in Vex Sync, and a
  // restored script comes back switched off (src/main/userscripts.js).
  OPTIONAL_STORES: { userscripts: ['userscripts'] },

  async collectStores(include = []) {
    if (typeof VexStorage === 'undefined') throw new Error('Vex settings could not be read for the backup');
    const stores = {};
    const names = this.STORES.concat(...include.map(w => this.OPTIONAL_STORES[w] || []));
    for (const name of names) {
      const value = await VexStorage.load(name);
      if (value && typeof value === 'object' && !Array.isArray(value)) stores[name] = value;
    }
    return stores;
  },

  // The settings files only the main process keeps (src/main/backup-stores.js):
  // site rules, site permissions, reminders, which extensions are switched off.
  // Each comes back through the same cleaner its normal load uses.
  MAIN_STORES: ['site-rules', 'permissions', 'reminders', 'extensions'],

  _mainApi() { return typeof window !== 'undefined' && window.vex && window.vex.backup ? window.vex.backup : null; },

  async collectMain() {
    const api = this._mainApi();
    // A window without the bridge (a test, a private window) has no main stores to give.
    if (!api || typeof api.collectMain !== 'function') return {};
    const r = await api.collectMain();
    if (!r || !r.ok) throw new Error('Vex could not read its site rules and permissions for the backup' + (r && r.error ? ': ' + r.error : ''));
    return r.main;
  },

  async applyMain(data) {
    const main = data && data.main && typeof data.main === 'object' ? data.main : {};
    if (!this.MAIN_STORES.some(n => main[n] && typeof main[n] === 'object')) return { written: 0, notes: [] };
    const api = this._mainApi();
    if (!api || typeof api.applyMain !== 'function') throw new Error('Vex could not restore its site rules and permissions here');
    const r = await api.applyMain(main);
    if (!r || !r.ok) throw new Error('Site rules and permissions were not restored' + (r && r.error ? ': ' + r.error : ''));
    return { written: r.written, notes: r.notes || [] };
  },

  async undoMain() {
    const api = this._mainApi();
    if (!api || typeof api.undoMain !== 'function') return;
    const r = await api.undoMain();
    if (r && r.ok === false) throw new Error(r.error || 'Site rules and permissions could not be put back');
  },

  // Put the settings files back. What was there is kept first, for undo.
  async applyStores(data) {
    const stores = data && data.stores && typeof data.stores === 'object' ? data.stores : {};
    const known = this.STORES.concat(...Object.values(this.OPTIONAL_STORES));
    const names = known.filter(n => stores[n] && typeof stores[n] === 'object' && !Array.isArray(stores[n]));
    if (!names.length) return 0;
    if (typeof VexStorage === 'undefined') throw new Error('Vex settings could not be restored');
    this._undoStores = {};
    for (const name of names) this._undoStores[name] = await VexStorage.load(name);
    for (const name of names) await VexStorage.save(name, stores[name]);
    return names.length;
  },

  async undoStores() {
    if (!this._undoStores) return;
    for (const [name, value] of Object.entries(this._undoStores)) await VexStorage.save(name, value);
    this._undoStores = null;
  },

  _words(key) {
    return String(key)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map(w => w.toLowerCase());
  },
  _blocked(key) {
    if (this.NEVER_INSIDE.test(key)) return true;
    if (this._words(key).some(w => this.NEVER_WORDS.includes(w) || (w.endsWith('s') && this.NEVER_WORDS.includes(w.slice(0, -1))))) return true;
    return this.NEVER.some(re => re.test(key));
  },
  _isLocal(key) { return this.LOCAL.some(re => re.test(key)); },
  _isOptional(key, what) { return (this.OPTIONAL[what] || []).some(re => re.test(key)); },

  // Everything worth carrying, as a plain object. `include` names the
  // optional groups the user ticked.
  collect(include = []) { return this.seal(this._collectRaw(include)); },
  _collectRaw(include = []) {
    const items = {};
    let skipped = 0;
    for (const key of this._keys()) {
      if (this._blocked(key)) { skipped++; continue; }
      const optional = Object.keys(this.OPTIONAL).find(w => this._isOptional(key, w));
      if (optional && !include.includes(optional)) continue;
      if (!optional && this._isLocal(key)) continue;
      try { items[key] = localStorage.getItem(key); }
      catch { /* a key that cannot be read is not in the backup */ }
    }
    return {
      v: this.VERSION,
      at: new Date().toISOString(),
      app: (() => { try { return document.documentElement.dataset.vexVersion || ''; } catch { return ''; } })(),
      includes: include.slice(),
      skipped,
      items,
    };
  },

  // What a file says it holds, before anything is changed by it.
  describe(data) {
    if (!data || typeof data !== 'object' || !this.READABLE.includes(data.v) || !data.items || typeof data.items !== 'object') return null;
    const keys = Object.keys(data.items).filter(k => k.startsWith('vex.') && !this._blocked(k));
    const known = this.STORES.concat(...Object.values(this.OPTIONAL_STORES));
    const stores = data.stores && typeof data.stores === 'object' ? known.filter(n => data.stores[n] && typeof data.stores[n] === 'object') : [];
    const main = data.main && typeof data.main === 'object' ? this.MAIN_STORES.filter(n => data.main[n] && typeof data.main[n] === 'object') : [];
    let integrity;
    try { integrity = this.verify(data); } catch { integrity = 'damaged'; }
    return {
      count: keys.length + stores.length + main.length,
      when: data.at ? new Date(data.at) : null,
      app: data.app || '',
      chats: keys.some(k => this._isOptional(k, 'chats')),
      userscripts: stores.includes('userscripts'),
      main,
      // 'verified' (the sum matched), 'unverified' (an older file, no sum) or 'damaged'.
      integrity,
      // An older file may still carry them: they are named, and not restored.
      pageActions: Object.prototype.hasOwnProperty.call(data.items, 'vex.pageActions'),
      bytes: keys.reduce((n, k) => n + String(data.items[k] || '').length, 0),
    };
  },

  // Put it back. The shape is checked key by key: a file is a file, it may
  // have been edited, and one bad entry must not stop the other four hundred.
  //
  // What is there now is kept in memory first, so a restore that turns out to
  // be the wrong file can be undone without hunting for another backup.
  apply(data) {
    const seen = this.describe(data);
    if (!seen) throw new Error('That is not a Vex backup file');
    // A damaged file is refused here, whoever asked: no caller can skip the check.
    this.verify(data);
    this._undo = {};
    for (const key of this._keys()) this._undo[key] = localStorage.getItem(key);
    let written = 0, failed = 0;
    for (const [key, value] of Object.entries(data.items)) {
      if (!key.startsWith('vex.') || this._blocked(key) || typeof value !== 'string') { failed++; continue; }
      try { localStorage.setItem(key, value); written++; }
      catch { failed++; }
    }
    return { written, failed, undoable: true };
  },

  // Back to exactly what was there before the last restore, this session.
  undo() {
    if (!this._undo) throw new Error('Nothing has been restored to undo');
    for (const key of this._keys()) {
      if (!(key in this._undo)) { try { localStorage.removeItem(key); } catch { /* it stays */ } }
    }
    for (const [key, value] of Object.entries(this._undo)) {
      try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
      catch { /* it stays */ }
    }
    this._undo = null;
    return true;
  },

  // Panels that keep what they read in memory write it back later — the
  // workspaces on every close of the window — so closing Vex after a restore
  // wrote the old workspaces over the restored ones (found 2026-09-29). Have
  // them read the restored values now, as they do after a sync.
  _reloadLive() {
    if (typeof WorkspaceManager !== 'undefined') WorkspaceManager.reloadSyncedState();
    // Marked as a restore, so what is said about it is not "synced".
    window.dispatchEvent(new CustomEvent('vex-sync-data-applied', { detail: { source: 'backup' } }));
  },

  fileName() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return 'vex-backup-' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '.json';
  },

  // The whole backup: what collect() reads plus the settings files. Also what
  // the update cover keeps before an update installs (js/update-notifier.js).
  async snapshot(include = []) {
    const data = this._collectRaw(include);
    data.stores = await this.collectStores(include);
    data.main = await this.collectMain();
    return this.seal(data);
  },

  // Written through the browser's own download, so it lands in Downloads with
  // the rest and needs no new privilege.
  async save(include = []) {
    const data = await this.snapshot(include);
    this._download(JSON.stringify(data, null, 2), this.fileName());
    // When the last file was written, for the weekly backup reminder.
    try { localStorage.setItem('vex.backup.lastAt', String(Date.now())); } catch { /* the reminder may come early */ }
    return data;
  },

  // The link's blob is let go of only after the download had time to start:
  // revoked straight after click() the download can find nothing to save.
  _download(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },

  // Settings › Data › Export All Data: every vex.* key as it is, history and
  // chats included, but through the same secret filter as a backup. It wrote
  // the Lock PIN's hash and the MCP servers' tokens into Downloads (audit
  // SET5, 2026-10-10). -> the number of keys left out.
  exportAll() {
    const data = {};
    let skipped = 0;
    for (const key of this._keys()) {
      if (this._blocked(key)) { skipped++; continue; }
      data[key] = localStorage.getItem(key);
    }
    this._download(JSON.stringify(data, null, 2), 'vex-data-export.json');
    return skipped;
  },

  read(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error('That file could not be read'));
      r.onload = () => {
        try { resolve(JSON.parse(String(r.result))); }
        catch { reject(new Error('That file is not readable as a Vex backup')); }
      };
      r.readAsText(file);
    });
  },

  // ---- the screen ---------------------------------------------------------
  open() {
    document.getElementById('vex-backup')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-backup';
    m.className = 'vexsr-ov';
    const now = this._collectRaw([]);
    m.innerHTML = '<div class="vexsr-card" role="dialog" aria-modal="true" aria-labelledby="bk-title"><div class="vexsr-head">'
      + '<span class="vexsr-title" id="bk-title">Back up everything, or put it back</span>'
      + '<button class="vexsr-x" id="bk-close" aria-label="Close" title="Close">' + VexIcons.svg('x', { size: 13 }) + '</button></div>'
      + '<div class="vexsr-sub">One file with everything Vex remembers about how you work — your notes, sessions, keybindings, site rules, panels, theme, skin and typeface. '
      + Object.keys(now.items).length + ' things right now.</div>'
      + '<div class="vexsr-row" style="margin-top:12px">'
      + '<label class="vexsr-check"><input type="checkbox" id="bk-chats"> Include my AI conversations</label>'
      + '<label class="vexsr-check"><input type="checkbox" id="bk-archive"> Include the archive library setting (the saved copies are not in a backup; export the ones you want)</label>'
      + '<label class="vexsr-check"><input type="checkbox" id="bk-userscripts"> Include my userscripts (their code and saved values)</label>'
      + '<label class="vexsr-check"><input type="checkbox" id="bk-news"> Include the AI news stories Vex holds and which I have read (my AI news choices are always included)</label>'
      + '<button id="bk-save" class="vexsr-go">Save a backup</button>'
      + '</div>'
      + '<div class="vexsr-row" style="margin-top:8px">'
      + '<input type="file" id="bk-file" accept="application/json,.json" class="vexsr-input" aria-label="Backup file to restore">'
      + '<button id="bk-restore" class="vexsr-x">Restore</button>'
      + '<button id="bk-test" class="vexsr-x">Test this backup</button>'
      + '</div>'
      + '<div id="bk-report" class="vexsr-list" hidden></div>'
      // Made by Vex itself around each update (src/main/update-backups.js).
      + '<div id="bk-updates" hidden><div class="vexsr-sub" style="margin-top:12px">Saved before updates — Vex backs up by itself before it installs one (or when a new version first starts, if it was installed another way), and keeps the last five.</div>'
      + '<div id="bk-update-list" class="vexsr-list"></div></div>'
      + '<div id="bk-msg" class="vexsr-msg"></div>'
      + '<div class="vexsr-note">Saved logins and authenticator codes are never in the file. They are kept encrypted by Vex itself and cannot be read from here — a backup that contained them would be a password file sitting in your Downloads folder. '
      + 'Restoring writes everything in the file over what Vex has now; what the file does not have is left as it is. It can be undone until you close Vex, and Vex has to be restarted for all of it to take.</div>'
      + '</div>';
    document.body.appendChild(m);

    const msg = (t, bad) => { const e = m.querySelector('#bk-msg'); e.textContent = t || ''; e.style.color = bad ? 'var(--danger, #ef4444)' : 'var(--text-muted)'; };
    // Escape closes it the way the X does; it did nothing (found 2026-09-29).
    // Capture phase, so nothing underneath takes the same key; an Escape meant
    // for the restore vexConfirm on top is left to that dialog. Focus moves in,
    // or with the page focused the key never reached Vex at all.
    const onKey = (e) => {
      if (!m.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
      if (e.key !== 'Escape' || document.querySelector('.vex-dialog-overlay')) return;
      e.preventDefault(); e.stopPropagation(); close();
    };
    const close = () => { document.removeEventListener('keydown', onKey, true); m.remove(); };
    document.addEventListener('keydown', onKey, true);
    m.addEventListener('click', e => { if (e.target === m) close(); });
    m.querySelector('#bk-close').addEventListener('click', close);
    m.querySelector('#bk-close').focus({ preventScroll: true });

    m.querySelector('#bk-save').addEventListener('click', async () => {
      try {
        const include = [];
        if (m.querySelector('#bk-chats').checked) include.push('chats');
        if (m.querySelector('#bk-archive').checked) include.push('archive');
        if (m.querySelector('#bk-userscripts').checked) include.push('userscripts');
        if (m.querySelector('#bk-news').checked) include.push('news');
        const d = await this.save(include);
        msg('Saved ' + (Object.keys(d.items).length + Object.keys(d.stores).length) + ' things to your Downloads folder');
      } catch (err) { msg(err.message, true); }
    });

    m.querySelector('#bk-restore').addEventListener('click', async () => {
      const file = m.querySelector('#bk-file').files[0];
      if (!file) { msg('Choose a backup file first', true); return; }
      let data;
      try { data = await this.read(file); }
      catch (err) { msg(err.message, true); return; }
      await this._restore(data, m, msg);
    });
    m.querySelector('#bk-test').addEventListener('click', async () => {
      const file = m.querySelector('#bk-file').files[0];
      if (!file) { msg('Choose a backup file first', true); return; }
      let data;
      try { data = await this.read(file); }
      catch (err) { msg(err.message, true); return; }
      await this._test(data, m, msg);
    });
    this._listUpdateBackups(m, msg);
    return m;
  },

  // The backups Vex made before its updates (src/main/update-backups.js), each
  // with Restore. Only the main window has them: a private window's Settings
  // does not list them.
  async _listUpdateBackups(m, msg) {
    const api = window.vex && window.vex.updates;
    if (window.VexTabPolicy?.isPrivateWindow || !api || typeof api.listBackups !== 'function') return;
    const box = m.querySelector('#bk-updates');
    const list = m.querySelector('#bk-update-list');
    let r;
    try { r = await api.listBackups(); }
    catch (err) { r = { ok: false, error: err.message }; }
    if (!m.isConnected) return;
    list.textContent = '';
    if (!r || !r.ok) {
      box.hidden = false;
      const e = document.createElement('div');
      e.className = 'vexsr-empty';
      e.textContent = window.vexTr('The backups made before updates could not be listed:') + ' ' + ((r && r.error) || 'unknown error');
      list.appendChild(e);
      return;
    }
    if (!r.items.length) return;
    box.hidden = false;
    for (const item of r.items) {
      const row = document.createElement('div');
      row.className = 'vexsr-rule';
      row.dataset.backup = item.name;
      const label = document.createElement('span');
      label.className = 'vexsr-host';
      const what = this.updateBackupName(item);
      label.textContent = what;
      const when = document.createElement('span');
      when.className = 'vexsr-mode';
      when.textContent = new Date(item.at).toLocaleString() + ' · ' + Math.max(1, Math.round(item.bytes / 1024)) + ' KB';
      const btn = document.createElement('button');
      btn.className = 'vexsr-x';
      btn.textContent = 'Restore';
      btn.setAttribute('aria-label', 'Restore ' + (item.kind === 'settings' ? 'the copy: ' + what : 'the backup made before updating to ' + item.version));
      btn.addEventListener('click', async () => {
        let got;
        try { got = await api.readBackup(item.name); }
        catch (err) { got = { ok: false, error: err.message }; }
        if (!got || !got.ok) { msg('That backup could not be read: ' + ((got && got.error) || 'unknown error'), true); return; }
        let data;
        try { data = JSON.parse(got.text); }
        catch { msg('That backup is not readable as a Vex backup', true); return; }
        await this._restore(data, m, msg);
      });
      const test = document.createElement('button');
      test.className = 'vexsr-x';
      test.textContent = 'Test this backup';
      test.setAttribute('aria-label', 'Test this backup');
      test.addEventListener('click', async () => {
        let got;
        try { got = await api.readBackup(item.name); }
        catch (err) { got = { ok: false, error: err.message }; }
        if (!got || !got.ok) { msg('That backup could not be read: ' + ((got && got.error) || 'unknown error'), true); return; }
        let data;
        try { data = JSON.parse(got.text); }
        catch { msg('That backup is not readable as a Vex backup', true); return; }
        await this._test(data, m, msg);
      });
      row.append(label, when, btn, test);
      list.appendChild(row);
    }
  },

  // What a row in that list is. 'settings' rows are the copies the older
  // first-start system kept (settings-backups), moved here once.
  updateBackupName(item) {
    if (item.kind !== 'settings') return 'Before updating to ' + item.version;
    if (item.version === 'first-run') return 'Settings from the first start';
    if (item.version === 'before-restore') return 'Settings from just before a restore';
    return 'Settings as they were in ' + item.version;
  },

  _offerUndo(m, msg) {
    m.querySelector('#bk-undo')?.remove();
    const undo = document.createElement('button');
    undo.id = 'bk-undo';
    undo.className = 'vexsr-x';
    undo.style.marginTop = '8px';
    undo.textContent = 'Undo the restore';
    undo.addEventListener('click', async () => {
      try { this.undo(); await this.undoStores(); await this.undoMain(); this._reloadLive(); msg('Put back the way it was. Restart Vex.'); undo.remove(); }
      catch (err) { msg(err.message, true); }
    });
    m.querySelector('#bk-msg').after(undo);
  },

  // "Test this backup": the backup is parsed into a throwaway profile folder
  // and compared, store by store, with what Vex holds now. The live profile is
  // only read for its counts; nothing is written to it.
  async _liveCounts() {
    const live = { items: Object.keys(this._collectRaw([]).items).length, stores: {} };
    if (typeof VexStorage !== 'undefined') {
      for (const name of this.STORES) {
        const v = await VexStorage.load(name);
        if (v && typeof v === 'object' && !Array.isArray(v)) live.stores[name] = Object.keys(v).length;
      }
    }
    return live;
  },
  async _test(data, m, msg) {
    const box = m.querySelector('#bk-report');
    box.textContent = '';
    box.hidden = true;
    const api = this._mainApi();
    if (!api || typeof api.drill !== 'function') { msg('The backup test is not available in this window', true); return; }
    let r;
    try { r = await api.drill(JSON.stringify(data), await this._liveCounts()); }
    catch (err) { r = { ok: false, error: err.message }; }
    if (!r || !r.ok) { msg((r && r.error) || 'The backup could not be tested', true); return; }
    msg(r.integrity === 'verified'
      ? 'The checksum matches. Nothing in your profile was changed by this test.'
      : 'This backup has no checksum (it was made by an older Vex), so its contents could not be checked. Nothing in your profile was changed by this test.');
    box.hidden = false;
    const head = document.createElement('div');
    head.className = 'vexsr-rule';
    for (const t of ['What', 'In the backup', 'In Vex now', 'Difference']) {
      const c = document.createElement('span'); c.className = 'vexsr-mode'; c.textContent = window.vexTr(t); head.appendChild(c);
    }
    box.appendChild(head);
    for (const row of r.rows) {
      const el = document.createElement('div');
      el.className = 'vexsr-rule';
      el.dataset.store = row.name;
      const cells = [row.label, String(row.backup), row.live === null ? '-' : String(row.live), row.diff === null ? '-' : (row.diff > 0 ? '+' : '') + row.diff];
      cells.forEach((t, i) => { const c = document.createElement('span'); c.className = i ? 'vexsr-mode' : 'vexsr-host'; c.textContent = i ? t : window.vexTr(t); el.appendChild(c); });
      box.appendChild(el);
    }
    for (const n of r.notes || []) {
      const el = document.createElement('div'); el.className = 'vexsr-empty'; el.textContent = n; box.appendChild(el);
    }
    if (r.version < 2) {
      const el = document.createElement('div'); el.className = 'vexsr-empty';
      el.textContent = window.vexTr('This backup is from an older Vex: it holds no site rules, site permissions, reminders or switched-off extensions.');
      box.appendChild(el);
    }
  },

  // Restore a backup's contents after asking, with Undo — from a chosen file
  // or from one of the backups made around an update.
  async _restore(data, m, msg) {
    const seen = this.describe(data);
    if (!seen) { msg('That is not a Vex backup file', true); return; }
    // Nothing is written from a file whose checksum does not match.
    if (seen.integrity === 'damaged') {
      let why = 'This backup is damaged: its contents do not match its checksum, so nothing was restored';
      try { this.verify(data); } catch (err) { why = err.message; }
      msg(why, true);
      return;
    }
    const when = seen.when ? seen.when.toLocaleString() : 'an unknown date';
    const ok = (typeof vexConfirm === 'function') ? await vexConfirm({
      title: 'Restore this backup?',
      // Each sentence is translated on its own (window.vexTr): the message is put together from them, so it has no entry as a whole.
      message: window.vexTr('It holds ' + seen.count + ' things, saved on ' + when + (seen.app ? ' by Vex ' + seen.app : '') + '.')
        + (seen.chats ? '\n\n' + window.vexTr('It includes AI conversations.') : '')
        + (seen.userscripts ? '\n\n' + window.vexTr('It includes userscripts. They come back switched off; turn each one on in Settings.') : '')
        + (seen.pageActions ? '\n\n' + window.vexTr('It includes page actions. They are not restored: turn them on again in Settings and read the warning again.') : '')
        + (seen.integrity === 'unverified' ? '\n\n' + window.vexTr('It was made by an older Vex and has no checksum, so its contents could not be checked.') : '')
        + (seen.main.length ? '\n\n' + window.vexTr('It includes site rules, site permissions, reminders or switched-off extensions; they are checked the way Vex checks them at every start.') : '')
        + '\n\n' + window.vexTr('Everything in it is written over what Vex has now; what it does not have is left as it is. You can undo it until you close Vex.'),
      okLabel: 'Restore', cancelLabel: 'Cancel', danger: true,
    }) : true;
    if (!ok) return;
    try {
      const r = this.apply(data);
      this._undoStores = null;
      r.written += await this.applyStores(data);
      let mainNotes = [];
      try {
        const m2 = await this.applyMain(data);
        r.written += m2.written;
        mainNotes = m2.notes;
      } catch (err) {
        // The rest is restored and can be undone; what failed is named, not hidden.
        this._reloadLive();
        msg(err.message, true);
        this._offerUndo(m, msg);
        return;
      }
      this._reloadLive();
      msg('Restored ' + r.written + ' things' + (r.failed ? ' — ' + r.failed + ' were skipped' : '') + '. Restart Vex for all of it to take.' + (mainNotes.length ? ' ' + mainNotes.join('. ') + '.' : ''));
      this._offerUndo(m, msg);
    } catch (err) { msg(err.message, true); }
  },
};

if (typeof window !== 'undefined') window.VexBackup = VexBackup;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexBackup };
