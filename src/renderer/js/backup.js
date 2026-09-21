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
  VERSION: 1,

  // Never leaves the machine, whatever it is called. Matched against the
  // whole key, case-insensitively: a denylist of shapes rather than of names,
  // so a key added next year is covered before anyone remembers this file.
  NEVER: [
    /pass|secret|token|key\b|credential|vault|totp|otp|seed|auth/i,
  ],

  // True of this machine, not of this person.
  LOCAL: [
    /^vex\.(installedAt|hasRunBefore|lastUpdateCheck|lastSeenVersion|notificationsChecked|defaultBrowserConfigured)$/,
    /^vex\.(panelUsage|tabs|session|sleptAt|commandUsage|clipboard)/,
    /^vex\.(aiConversations|aiChatMeta)$/,     // only with consent; added below
  ],

  // Big, personal, and only on request.
  OPTIONAL: {
    chats: [/^vex\.(aiConversations|aiChatMeta)$/],
    history: [/^vex\.(history|recall)/],
  },

  _keys() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('vex.')) out.push(k);
      }
    } catch (err) { console.error('[Backup] could not read the settings:', err.message); }
    return out.sort();
  },

  _blocked(key) { return this.NEVER.some(re => re.test(key)); },
  _isLocal(key) { return this.LOCAL.some(re => re.test(key)); },
  _isOptional(key, what) { return (this.OPTIONAL[what] || []).some(re => re.test(key)); },

  // Everything worth carrying, as a plain object. `include` names the
  // optional groups the user ticked.
  collect(include = []) {
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
    if (!data || typeof data !== 'object' || data.v !== this.VERSION || !data.items || typeof data.items !== 'object') return null;
    const keys = Object.keys(data.items).filter(k => k.startsWith('vex.') && !this._blocked(k));
    return {
      count: keys.length,
      when: data.at ? new Date(data.at) : null,
      app: data.app || '',
      chats: keys.some(k => this._isOptional(k, 'chats')),
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

  fileName() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return 'vex-backup-' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '.json';
  },

  // Written through the browser's own download, so it lands in Downloads with
  // the rest and needs no new privilege.
  save(include = []) {
    const data = this.collect(include);
    const text = JSON.stringify(data, null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = this.fileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return data;
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
    const now = this.collect([]);
    m.innerHTML = '<div class="vexsr-card"><div class="vexsr-head">'
      + '<span class="vexsr-title">Back up everything, or put it back</span>'
      + '<button class="vexsr-x" id="bk-close" aria-label="Close">✕</button></div>'
      + '<div class="vexsr-sub">One file with everything Vex remembers about how you work — your notes, sessions, keybindings, site rules, panels, theme, skin and typeface. '
      + Object.keys(now.items).length + ' things right now.</div>'
      + '<div class="vexsr-row" style="margin-top:12px">'
      + '<label class="vexsr-check"><input type="checkbox" id="bk-chats"> Include my AI conversations</label>'
      + '<button id="bk-save" class="vexsr-go">Save a backup</button>'
      + '</div>'
      + '<div class="vexsr-row" style="margin-top:8px">'
      + '<input type="file" id="bk-file" accept="application/json,.json" class="vexsr-input">'
      + '<button id="bk-restore" class="vexsr-x">Restore</button>'
      + '</div>'
      + '<div id="bk-msg" class="vexsr-msg"></div>'
      + '<div class="vexsr-note">Saved logins and authenticator codes are never in the file. They are kept encrypted by Vex itself and cannot be read from here — a backup that contained them would be a password file sitting in your Downloads folder. '
      + 'Restoring replaces what is in Vex now; it can be undone until you close Vex, and Vex has to be restarted for all of it to take.</div>'
      + '</div>';
    document.body.appendChild(m);

    const msg = (t, bad) => { const e = m.querySelector('#bk-msg'); e.textContent = t || ''; e.style.color = bad ? 'var(--danger, #ef4444)' : 'var(--text-muted)'; };
    const close = () => m.remove();
    m.addEventListener('click', e => { if (e.target === m) close(); });
    m.querySelector('#bk-close').addEventListener('click', close);

    m.querySelector('#bk-save').addEventListener('click', () => {
      try {
        const include = m.querySelector('#bk-chats').checked ? ['chats'] : [];
        const d = this.save(include);
        msg('Saved ' + Object.keys(d.items).length + ' things to your Downloads folder');
      } catch (err) { msg(err.message, true); }
    });

    m.querySelector('#bk-restore').addEventListener('click', async () => {
      const file = m.querySelector('#bk-file').files[0];
      if (!file) { msg('Choose a backup file first', true); return; }
      let data;
      try { data = await this.read(file); }
      catch (err) { msg(err.message, true); return; }
      const seen = this.describe(data);
      if (!seen) { msg('That is not a Vex backup file', true); return; }
      const when = seen.when ? seen.when.toLocaleString() : 'an unknown date';
      const ok = (typeof vexConfirm === 'function') ? await vexConfirm({
        title: 'Restore this backup?',
        message: 'It holds ' + seen.count + ' things, saved on ' + when + (seen.app ? ' by Vex ' + seen.app : '') + '.'
          + (seen.chats ? '\n\nIt includes AI conversations.' : '')
          + '\n\nThis replaces what is in Vex now. You can undo it until you close Vex.',
        okLabel: 'Restore', cancelLabel: 'Cancel', danger: true,
      }) : true;
      if (!ok) return;
      try {
        const r = this.apply(data);
        msg('Restored ' + r.written + ' things' + (r.failed ? ' — ' + r.failed + ' were skipped' : '') + '. Restart Vex for all of it to take.');
        const undo = document.createElement('button');
        undo.className = 'vexsr-x';
        undo.style.marginTop = '8px';
        undo.textContent = 'Undo the restore';
        undo.addEventListener('click', () => {
          try { this.undo(); msg('Put back the way it was. Restart Vex.'); undo.remove(); }
          catch (err) { msg(err.message, true); }
        });
        m.querySelector('#bk-msg').after(undo);
      } catch (err) { msg(err.message, true); }
    });
    return m;
  },
};

if (typeof window !== 'undefined') window.VexBackup = VexBackup;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexBackup };
