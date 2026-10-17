// === The storage ledger and the sync scope chooser (T3-082) =====================
//
// Every vex.* key Vex keeps already has an owner: the feature manifests
// (js/feature-manifests.js) say which feature owns which keys, and
// tests/renderer/featureRegistry.test.js fails the build on a key nobody owns
// (that is the "list every key in source against the registry" check; it ran
// before this file and keeps running). This is the person's view of it:
//
//   - which feature owns how much of what is stored here, largest first;
//   - whether each key is in a backup/export (js/backup.js decides) and
//     whether it can travel with Vex Sync (js/sync-engine.js SYNC_KEYS);
//   - a chooser: "never sync this feature's data". The choice only ever
//     HOLDS A KEY BACK. It cannot make anything sync that did not already:
//     sync-engine asks syncAllowed(key) before it takes a key (preferenceKeys),
//     and the answer is yes unless the owner was set to "never";
//   - a warning at 80 percent of the browser-storage quota, through the
//     Attention Inbox (VexAttention.suggest), at most once a day.
//
// Scope words: 'default' = the key syncs today (it is in SYNC_KEYS) and the
// person has not said otherwise; 'opt-in' = it is in SYNC_KEYS but its feature
// is still new/beta (VexRegistry.syncEligible) so it waits until stable;
// 'never' = it does not sync (not in SYNC_KEYS, or the person chose never).
// Logs, usage, ledgers, caches and gamification are not in SYNC_KEYS, so they
// are 'never' without any choice being made.
const VexStorageLedger = {
  KEY: 'vex.storageScope',
  QUOTA_CHARS: 5 * 1000 * 1000,      // Chromium keeps about 5 million characters per origin
  WARN_AT: 0.8,
  WARN_EVERY_MS: 24 * 3600 * 1000,
  _lastWarn: 0,
  _scopes: null,
  _now() { return Date.now(); },

  // ---- the person's choices ---------------------------------------------------
  // { v: 1, never: { ownerId: true } }
  _load() {
    if (this._scopes) return this._scopes;
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); }
    catch (err) { throw new Error('The sync scope choices could not be read: ' + err.message); }
    let st = null;
    if (raw) {
      try { st = JSON.parse(raw); }
      catch (err) {
        // Sync asks on every pass, so this reports once and treats the record as empty (every key as it was).
        console.error('[StorageLedger] the sync scope choices are not readable and are started again:', err.message);
        if (typeof VexProblems !== 'undefined') VexProblems.note('Storage ledger', 'The sync scope choices were not readable', err);
      }
    }
    const ok = st && typeof st === 'object' && !Array.isArray(st) && st.v === 1 && st.never && typeof st.never === 'object';
    this._scopes = { v: 1, never: ok ? { ...st.never } : {} };
    return this._scopes;
  },
  _save() { localStorage.setItem(this.KEY, JSON.stringify(this._scopes)); },

  // The id the choice is stored under: the feature's manifest id, else the key itself.
  ownerId(key) {
    const k = String(key);
    const o = typeof VexRegistry !== 'undefined' ? VexRegistry.ownerOfKey(k) : null;
    return o || 'key:' + k;
  },
  ownerTitle(id) {
    if (id.startsWith('key:')) return 'Not listed under a feature (' + id.slice(4) + ')';
    return typeof VexRegistry !== 'undefined' && VexRegistry.has(id) ? VexRegistry.get(id).title : id;
  },

  _syncKeys() {
    const s = typeof SyncEngine !== 'undefined' ? SyncEngine : null;
    return s && Array.isArray(s.SYNC_KEYS) ? s.SYNC_KEYS : [];
  },
  inSync(key) { return this._syncKeys().includes(String(key)); },

  // 'default' | 'opt-in' | 'never' for one key, as it is right now.
  scopeOf(key) {
    const k = String(key);
    if (!this.inSync(k)) return 'never';
    if (this._load().never[this.ownerId(k)]) return 'never';
    const o = typeof VexRegistry !== 'undefined' ? VexRegistry.ownerOfKey(k) : null;
    if (o && !VexRegistry.syncEligible(o)) return 'opt-in';
    return 'default';
  },

  // What sync-engine asks. Only a "never" choice says no.
  syncAllowed(key) { return !this._load().never[this.ownerId(key)]; },

  setNever(ownerId, never) {
    const id = String(ownerId || '');
    if (!id) throw new Error('Say which feature');
    const st = this._load();
    if (never) st.never[id] = true; else delete st.never[id];
    this._save();
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('vex:storage-scope-changed', { detail: { owner: id, never: !!never } }));
    return !!never;
  },

  // ---- the numbers -------------------------------------------------------------
  _keys() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('vex.')) out.push(k);
    }
    const fileOnly = new Set();
    if (typeof PersistentStorage !== 'undefined' && typeof PersistentStorage.fileOnlyEntries === 'function') {
      for (const [k] of PersistentStorage.fileOnlyEntries()) if (k.startsWith('vex.')) { fileOnly.add(k); if (!out.includes(k)) out.push(k); }
    }
    return { keys: out.sort(), fileOnly };
  },

  // Does a backup carry it? VexBackup decides; without it the answer is unknown (null).
  inBackup(key) {
    if (typeof VexBackup === 'undefined' || typeof VexBackup._blocked !== 'function') return null;
    if (VexBackup._blocked(key)) return false;
    if (typeof VexBackup._isLocal === 'function' && VexBackup._isLocal(key)) return false;
    return true;
  },

  rows() {
    const { keys, fileOnly } = this._keys();
    return keys.map(key => {
      const v = localStorage.getItem(key);
      const owner = this.ownerId(key);
      return {
        key, owner, ownerTitle: this.ownerTitle(owner),
        chars: v == null ? 0 : String(v).length,
        file: fileOnly.has(key),          // kept in the file store, not in the browser quota
        scope: this.scopeOf(key), inSync: this.inSync(key), inBackup: this.inBackup(key),
      };
    });
  },

  // One line per owner, largest first.
  byOwner() {
    const map = new Map();
    for (const r of this.rows()) {
      const o = map.get(r.owner) || { owner: r.owner, title: r.ownerTitle, keys: 0, bytes: 0, syncKeys: 0, neverChosen: false };
      o.keys += 1;
      o.bytes += r.chars * 2;                // UTF-16: two bytes a character
      if (r.inSync) o.syncKeys += 1;
      map.set(r.owner, o);
    }
    const st = this._load();
    return [...map.values()].map(o => ({ ...o, neverChosen: !!st.never[o.owner] })).sort((a, b) => b.bytes - a.bytes);
  },

  // How full the browser quota is (file-store keys do not count against it).
  quota() {
    let chars = 0;
    for (const r of this.rows()) if (!r.file) chars += r.chars + r.key.length;
    const fraction = chars / this.QUOTA_CHARS;
    return { chars, quotaChars: this.QUOTA_CHARS, fraction, warn: fraction >= this.WARN_AT };
  },

  // A key in the source nobody owns is a test failure; one found here at run
  // time is listed so it can be seen.
  unowned() {
    return this.rows().filter(r => r.owner.startsWith('key:')).map(r => r.key);
  },

  // At 80 percent: one suggestion in the Attention Inbox, at most once a day.
  checkQuota() {
    const q = this.quota();
    if (!q.warn) return q;
    const now = this._now();
    if (now - this._lastWarn < this.WARN_EVERY_MS) return q;
    this._lastWarn = now;
    if (typeof VexAttention === 'undefined') throw new Error('The attention budget is not loaded (js/vex-attention.js)');
    const top = this.byOwner()[0];
    VexAttention.suggest({
      feature: 'storage-ledger', id: 'quota', title: 'Vex storage is ' + Math.round(q.fraction * 100) + '% full',
      body: top ? 'The most is held by ' + top.title + '. Open Settings > Storage to see what each feature keeps.' : 'Open Settings > Storage to see what each feature keeps.',
      label: 'Storage',
    });
    return q;
  },

  // ---- the screen ------------------------------------------------------------------
  group(el) {
    el.appendChild(VexSettingsGroups.note('What each feature keeps on this computer, largest first, and whether it can travel with Vex Sync. "Never sync" holds a feature’s data back from other devices; it cannot make anything sync that did not already.'));
    let q, owners;
    try { q = this.quota(); owners = this.byOwner(); }
    catch (err) { el.appendChild(VexSettingsGroups.note('Could not read the stored data: ' + err.message)); return; }
    el.appendChild(VexSettingsGroups.note('Browser storage used: ' + Math.round(q.fraction * 100) + '% of about 5 million characters' + (q.warn ? ' (over 80%)' : '') + '.'));
    const list = document.createElement('div');
    list.className = 'vexsr-list';
    for (const o of owners.slice(0, 40)) {
      const row = document.createElement('div');
      row.className = 'vexsr-rule';
      const name = document.createElement('span');
      name.className = 'vexsr-host';
      name.textContent = o.title;
      const meta = document.createElement('span');
      meta.className = 'vexsr-mode';
      meta.textContent = Math.round(o.bytes / 102.4) / 10 + ' KB, ' + o.keys + ' key' + VexPlural.s(o.keys) + (o.syncKeys ? '' : ', never synced');
      row.append(name, meta);
      if (o.syncKeys) {
        const label = document.createElement('label');
        label.className = 'vexsr-check';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = o.neverChosen;
        box.setAttribute('aria-label', 'Never sync ' + o.title);
        box.addEventListener('change', () => { try { this.setNever(o.owner, box.checked); } catch (err) { box.checked = !box.checked; window.showToast?.(err.message, 'error'); } });
        label.append(box, document.createTextNode(' Never sync'));
        row.appendChild(label);
      }
      list.appendChild(row);
    }
    el.appendChild(list);
  },
};

if (typeof window !== 'undefined') {
  window.VexStorageLedger = VexStorageLedger;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'storage-ledger', title: 'Storage and sync scope', keywords: 'storage quota space data sync never which features keep what size full', before: 'about', build: (el) => VexStorageLedger.group(el) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexStorageLedger };
