// === Vex Mobile — sync ===
//
// The same encrypted store the desktop uses, against the same worker: sign in
// with an emailed code, and the phone and the PC share one blob that only the
// devices can read. The encryption key never leaves the device — it is shown
// once as a recovery code, and the other device is enrolled by typing it in.
//
// Two files are copied from the desktop rather than rewritten (www/js/shared):
// the AES-GCM primitives and the version-vector record merge. Both sides have
// to agree on those exactly, so `npm run check` fails if the copies drift.
//
// What travels, and under the desktop's own record keys:
//   preference:vex.bookmarks    both ways
//   preference:vex.sessions     both ways
//   preference:vex.readingList  both ways
//   preference:vex.history      the recent slice, both ways (Settings → Sync)
//   preference:vex.mobile       phone settings — the desktop keeps it untouched
//   storage:tabs                read only, to list what is open on the PC
//
// History travels as a slice, not whole. On the phone it lives in IndexedDB and
// runs to tens of thousands of rows, and the blob is capped at 5 MB — so what
// goes is the most recent few hundred, in the desktop's own entry shape
// (id, url, title, favicon, visitedAt), which is the part that answers "what was
// that page I had open this morning" from the other device. Incoming history is
// merged into what is here rather than replacing it: two devices both browsing
// is the normal case, and whoever pushed last should not win.

const VexSync = (() => {
  const state = {
    email: null,
    token: null,
    deviceId: null,
    key: null,            // CryptoKey
    enabled: false,
    revision: 0,
    lastPullAt: null,
    lastPushAt: null,
    lastError: null,
    syncing: false,
    remoteTabs: []
  };

  let pushTimer = null;
  let recordDocument = null;
  // Set while the server holds a blob this phone has not been able to read.
  let pullBlocked = false;

  function url() { return String(VexStore.get('vex.syncWorkerUrl', '') || '').trim(); }

  // The record clock is keyed by device, and the worker's device ids are hex —
  // both sides validate the shape, so a stray character breaks a merge.
  function deviceId() {
    const raw = String(state.deviceId || 'mobile').replace(/[^a-zA-Z0-9_-]/g, '');
    return raw.slice(0, 80) || 'mobile';
  }

  function configured() { return /^https:\/\//.test(url()); }

  async function request(path, options = {}) {
    if (!configured()) throw new Error('Add your Sync Worker URL in Settings → Sync.');
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetch(url() + path, Object.assign({}, options, { headers, signal: controller.signal }));
    } catch {
      throw new Error(controller.signal.aborted ? 'The sync worker did not answer.' : 'Could not reach the sync worker.');
    } finally {
      clearTimeout(timer);
    }
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) { await signOut(); throw new Error('Signed out — sign in again.'); }
    if (!response.ok) throw new Error(body.error || ('The worker returned ' + response.status));
    return body;
  }

  // ── What the phone contributes ──────────────────────────────────────────
  // Few enough to leave room for everything else inside the 5 MB blob: roughly
  // 150 bytes an entry, so 400 is about 60 KB before compression.
  const HISTORY_SLICE = 400;

  function historyForSync() {
    if (VexStore.get('vex.syncHistory', true) === false) return undefined;
    return VexHistory.recent(HISTORY_SLICE).map(entry => ({
      // The desktop's shape, exactly, so its own history panel can read these.
      id: 'h_' + (entry.at || 0) + '_' + Math.abs(hashOf(entry.url || '')).toString(36),
      url: entry.url,
      title: entry.title || entry.url,
      favicon: entry.icon || '',
      visitedAt: new Date(entry.at || Date.now()).toISOString()
    }));
  }

  // A stable id per (url, time) so the same visit keeps the same identity on
  // both devices and the merge does not see it as two.
  function hashOf(text) {
    let hash = 0;
    for (let at = 0; at < text.length; at++) hash = ((hash << 5) - hash + text.charCodeAt(at)) | 0;
    return hash;
  }

  /**
   * Fold another device's history into this one's.
   *
   * Merged, never replaced: two devices both browsing is the normal case, and
   * whoever pushed last should not win. A visit is "already here" if the same
   * url was visited in the same hour — which is what the desktop does when it
   * folds a repeat visit into an existing row.
   */
  async function mergeHistory(entries) {
    if (!Array.isArray(entries)) return 0;
    if (VexStore.get('vex.syncHistory', true) === false) return 0;
    const seen = new Set(VexHistory.recent(1000)
      .map(entry => entry.url + '|' + Math.round((entry.at || 0) / 3600000)));
    let added = 0;
    for (const entry of entries.slice(0, HISTORY_SLICE)) {
      if (!entry || !entry.url) continue;
      const at = Date.parse(entry.visitedAt || '') || 0;
      if (!at) continue;
      const key = entry.url + '|' + Math.round(at / 3600000);
      if (seen.has(key)) continue;
      seen.add(key);
      await VexHistory.addRaw({ url: entry.url, title: entry.title || '', at, icon: entry.favicon || '' });
      added++;
    }
    return added;
  }

  function collect() {
    const history = historyForSync();
    return {
      ...(history ? { 'preference:vex.history': history } : {}),
      'preference:vex.bookmarks': VexCollections.bookmarks.all(),
      'preference:vex.sessions': VexCollections.sessions.all(),
      'preference:vex.readingList': VexCollections.reading.all(),
      'preference:vex.quickAccess': VexCollections.quick.all(),
      'preference:vex.mobile': {
        theme: VexStore.get('vex.theme', 'auto'),
        skin: VexStore.get('vex.skin', 'none'),
        font: VexStore.get('vex.font', 'system'),
        searchEngine: VexStore.get('vex.searchEngine', 'duckduckgo'),
        // The definition travels with the choice. Without it the other device
        // would store "custom" and have nothing to search with.
        customEngine: VexStore.get('vex.customEngine', null),
        siteRules: VexStore.get('vex.siteRules', {}),
        blockEnabled: VexStore.get('vex.blockEnabled', true),
        shield: VexStore.get('vex.shield', 'standard'),
        toolbarPosition: VexStore.get('vex.toolbarPosition', 'bottom'),
        openTabs: VexTabStore.normal().map(tab => ({ url: tab.url, title: tab.title }))
      }
    };
  }

  async function applyIncoming(values) {
    const bookmarks = values['preference:vex.bookmarks'];
    if (Array.isArray(bookmarks)) await VexStore.set('vex.bookmarks', bookmarks.slice(0, 5000));

    const sessions = values['preference:vex.sessions'];
    if (Array.isArray(sessions)) await VexStore.set('vex.sessions', sessions.slice(0, 50));

    const readingList = values['preference:vex.readingList'];
    if (Array.isArray(readingList)) await VexStore.set('vex.readingList', readingList.slice(0, 500));

    const quickAccess = values['preference:vex.quickAccess'];
    if (Array.isArray(quickAccess)) await VexStore.set('vex.quickAccess', quickAccess.slice(0, 24));

    const mobile = values['preference:vex.mobile'];
    if (mobile && typeof mobile === 'object') {
      // Settings follow the account, but not the ones that are about this
      // device: a phone should not take the desktop's window layout, and a
      // theme you set here should not be undone by the other phone.
      for (const [key, value] of Object.entries({
        'vex.searchEngine': mobile.searchEngine,
        'vex.customEngine': mobile.customEngine,
        'vex.siteRules': mobile.siteRules,
        'vex.blockEnabled': mobile.blockEnabled,
        'vex.shield': mobile.shield
      })) {
        if (value !== undefined) await VexStore.set(key, value);
      }
    }

    const merged = await mergeHistory(values['preference:vex.history']);
    if (merged) state.historyMerged = merged;

    // The desktop's open tabs, for "open on my PC". Read, never written.
    const desktopTabs = values['storage:tabs'];
    state.remoteTabs = Array.isArray(desktopTabs)
      ? desktopTabs.filter(tab => tab && tab.url).map(tab => ({ url: tab.url, title: tab.title || '' })).slice(0, 200)
      : [];
  }

  async function saveMeta() {
    await VexStore.set('vex.sync', {
      email: state.email,
      deviceId: state.deviceId,
      enabled: state.enabled,
      revision: state.revision,
      lastPullAt: state.lastPullAt,
      lastPushAt: state.lastPushAt
    });
  }

  async function signOut() {
    state.email = null;
    state.token = null;
    state.enabled = false;
    state.revision = 0;
    state.remoteTabs = [];
    recordDocument = null;
    pullBlocked = false;
    await VexBridge.vaultSet('vex.syncToken', '');
    await saveMeta();
  }

  return {
    state,
    HISTORY_SLICE,
    // Exposed because they are the two halves of the only record that is merged
    // rather than overwritten, and both deserve a test of their own.
    historyForSync,
    mergeHistory,
    configured,

    async setWorkerUrl(value) {
      const clean = String(value || '').trim();
      if (clean && !/^https:\/\//.test(clean)) throw new Error('The sync worker URL has to be https://');
      await VexStore.set('vex.syncWorkerUrl', clean);
    },

    workerUrl: url,

    // Bring the saved session back at boot.
    async restore() {
      const meta = VexStore.get('vex.sync', null);
      if (!meta || !meta.email) return false;
      state.email = meta.email;
      state.deviceId = meta.deviceId;
      state.revision = meta.revision || 0;
      state.lastPullAt = meta.lastPullAt;
      state.lastPushAt = meta.lastPushAt;
      state.token = await VexBridge.vaultGet('vex.syncToken');
      const keyHex = await VexBridge.vaultGet('vex.syncKey');
      if (!state.token || !keyHex) { state.enabled = false; return false; }
      state.key = await SyncCrypto.importKey(SyncCrypto.hexToKey(keyHex));
      state.enabled = !!meta.enabled;
      return state.enabled;
    },

    // ── Signing in ─────────────────────────────────────────────────────────
    async requestCode(email) {
      const answer = await request('/auth/request-code', {
        method: 'POST',
        body: JSON.stringify({ email })
      });
      return answer;
    },

    async verifyCode(email, code) {
      const answer = await request('/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email, code, deviceName: 'Vex on Android' })
      });
      if (!answer.token) throw new Error('The worker did not return a session');
      state.email = email;
      state.token = answer.token;
      state.deviceId = answer.deviceId || VexCollections.id('dev_');
      state.enabled = true;
      await VexBridge.vaultSet('vex.syncToken', state.token);
      await saveMeta();
      return answer;
    },

    // A new key is made on the first device; the second is given the code.
    async createKey() {
      const key = await SyncCrypto.generateKey();
      const raw = await SyncCrypto.exportKey(key);
      const hex = SyncCrypto.keyToHex(raw);
      state.key = key;
      await VexBridge.vaultSet('vex.syncKey', hex);
      return SyncCrypto.formatRecoveryCode(hex);
    },

    async useRecoveryCode(code) {
      const hex = SyncCrypto.parseRecoveryCode(code);
      const bytes = SyncCrypto.hexToKey(hex);       // throws on a bad code
      state.key = await SyncCrypto.importKey(bytes);
      await VexBridge.vaultSet('vex.syncKey', hex);
      return true;
    },

    // Strict: "no key" makes a new one, and a key that merely could not be
    // read this moment must not be replaced by one.
    async hasKey() { return !!(await VexBridge.vaultGet('vex.syncKey', { strict: true })); },

    async recoveryCode() {
      const hex = await VexBridge.vaultGet('vex.syncKey');
      return hex ? SyncCrypto.formatRecoveryCode(hex) : '';
    },

    signOut,

    // ── Pull, merge, push ──────────────────────────────────────────────────
    async pull() {
      if (!state.enabled || !state.key) return { ok: false, reason: 'not-signed-in' };
      state.syncing = true;
      try {
        const answer = await request('/sync/pull', { method: 'GET' });
        if (!answer.encryptedBlob) {
          state.revision = Number(answer.revision) || 0;
          pullBlocked = false;
          state.lastPullAt = new Date().toISOString();
          await saveMeta();
          return { ok: true, empty: true };
        }
        // The revision is taken only once the blob has been read. Taken
        // before, a blob this key cannot open — signed in here before the
        // recovery code was typed, so the phone made a key of its own — left
        // the phone holding the server's current revision, and the next
        // scheduled push was accepted: the other devices' data replaced by
        // this phone's, under a key they do not have. Left behind, the push
        // is refused as a conflict instead.
        // Until it is, nothing is pushed either — the desktop's pullBlocked.
        pullBlocked = true;
        let incoming;
        try { incoming = await SyncCrypto.decrypt(answer.encryptedBlob, state.key); }
        catch {
          throw new Error('This phone’s key does not open what is synced — enter the recovery code from your other device');
        }
        const records = window.VexSyncRecords;
        // capture() first, so anything changed on this device since the last
        // push is part of the merge rather than being overwritten by it.
        recordDocument = records.capture(recordDocument || records.empty(), records.flatten(collect()), deviceId());
        recordDocument = records.merge(recordDocument, incoming);
        await applyIncoming(records.unflatten(records.values(recordDocument)));
        state.revision = Number(answer.revision) || 0;
        pullBlocked = false;
        state.lastPullAt = new Date().toISOString();
        state.lastError = null;
        await saveMeta();
        return { ok: true };
      } catch (error) {
        state.lastError = error.message;
        return { ok: false, reason: error.message };
      } finally {
        state.syncing = false;
      }
    },

    async push() {
      if (!state.enabled || !state.key) return { ok: false, reason: 'not-signed-in' };
      if (pullBlocked) return { ok: false, reason: state.lastError || 'What is synced could not be read here' };
      state.syncing = true;
      try {
        const records = window.VexSyncRecords;
        recordDocument = records.capture(recordDocument || records.empty(), records.flatten(collect()), deviceId());
        const blob = await SyncCrypto.encrypt(recordDocument, state.key);
        const answer = await request('/sync/push', {
          method: 'POST',
          body: JSON.stringify({
            encryptedBlob: blob,
            updatedAt: new Date().toISOString(),
            baseRevision: state.revision
          })
        });
        state.revision = Number(answer.revision) || state.revision + 1;
        state.lastPushAt = new Date().toISOString();
        state.lastError = null;
        await saveMeta();
        return { ok: true };
      } catch (error) {
        // A conflict means another device pushed first: pull, merge, push once.
        if (/conflict/i.test(error.message) && !this._retrying) {
          this._retrying = true;
          try {
            await this.pull();
            return await this.push();
          } finally {
            this._retrying = false;
          }
        }
        state.lastError = error.message;
        return { ok: false, reason: error.message };
      } finally {
        state.syncing = false;
      }
    },

    // Called after anything worth syncing changes; batched, because a page of
    // bookmark edits should be one upload.
    schedulePush(delay = 4000) {
      if (!state.enabled) return;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => this.push(), delay);
    },

    async syncNow() {
      const pulled = await this.pull();
      if (!pulled.ok) return pulled;
      return this.push();
    },

    /** Whether the account already holds a synced blob — a key exists somewhere else. */
    async serverHasData() {
      const answer = await request('/sync/pull', { method: 'GET' });
      return !!answer.encryptedBlob;
    },

    async devices() {
      const answer = await request('/sync/devices', { method: 'GET' });
      return answer.devices || [];
    },

    async forgetDevice(deviceId) {
      return request('/sync/devices/' + encodeURIComponent(deviceId), { method: 'DELETE' });
    },

    async deleteEverything() {
      await request('/sync/all', { method: 'DELETE' });
      await signOut();
    },

    remoteTabs() { return state.remoteTabs; }
  };
})();

if (typeof window !== 'undefined') window.VexSync = VexSync;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSync };
