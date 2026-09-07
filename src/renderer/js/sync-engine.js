// === Vex Phase 13: Sync Engine ===
// Auth + encrypted push/pull against the vex-sync Cloudflare worker.
// Data source is localStorage (which the Phase 11 persistent-storage shim
// already mirrors to %APPDATA%/Vex/vex-persist.json).

const SyncEngine = (() => {
  // A failed decryption/application must never be followed by a destructive push.
  // A successful pull is required to clear this guard.
  let pullBlocked = false;
  // Sync targets a Cloudflare Worker each user deploys themselves
  // (see SELF_HOSTING.md). The URL is set in Settings → Sync (VexConfig).
  // Sync stays OFF until a URL is configured: auth, push, pull, and device
  // calls all no-op when it's empty, so a fresh install never hits a dead
  // endpoint or spams the network on a timer.
  function syncWorkerUrl() {
    try { return (typeof window !== 'undefined' && window.VexConfig) ? window.VexConfig.syncWorkerUrl() : ''; }
    catch { return ''; }
  }
  function requireSyncUrl() {
    const u = syncWorkerUrl();
    if (!u) throw new Error('Sync is not configured. Add your Sync Worker URL in Settings → Sync (see SELF_HOSTING.md).');
    return u;
  }

  // Keys in localStorage that should be synced across devices.
  const SYNC_KEYS = [
    'vex.bookmarks',
    'vex.tabs', 'vex.sessions', 'vex.workspaces', 'vex.shortcuts', 'vex.tools',
    'vex.notes', 'vex.history', 'vex.theme', 'vex.settings', 'vex.schedules',
    'vex.agentMode', 'vex.aiIndexingEnabled', 'vex.customCommands', 'vex.zooms',
    'vex.forceDarkSites', 'vex.autosleep',
    'vex.autosleepMinutes', 'vex.autosleepExcludePinned', 'vex.groups',
    // Phase 14: AI routing prefs (but NOT localAIModel — each device has
    // its own installed Ollama models)
    'vex.aiRouting', 'vex.preferLocalAI', 'vex.forceCloudAI',
    // Phase 15: custom personas + globally active persona id
    // (per-tab selections live under vex.activePersonaByTab.* and are NOT
    // synced — tab ids are device-local)
    'vex.personas', 'vex.activePersona',
    // Persistent AI memory (facts the assistant remembers) — follows you across devices
    'vex.aiMemory',
    // Phase 16: tab auto-grouping preferences + remembered patterns
    // (groupPatterns uses local group ids, but that's fine — matching is
    // reconstructed from patterns on the other device)
    'vex.autoGroupSuggest', 'vex.autoAddToGroups', 'vex.groupPatterns',
    // Phase 17: customized keyboard shortcuts follow you across devices
    'vex.userShortcuts',
    // Tab layout (horizontal vs vertical)
    'vex.tabLayout',
    'vex-theme'
  ];

  let state = {
    enabled: false,
    email: null,
    sessionToken: null,
    deviceId: null,
    emailHash: null,
    encryptionKey: null,
    lastPushAt: null,
    lastPullAt: null,
    syncing: false,
    lastError: null
  };

  let pushTimer = null;
  let pullTimer = null;
  let revision = 0;
  let recordDocument = null;
  const STORE_KEYS = ['tabs', 'groups', 'stacks', 'history', 'settings', 'shortcuts', 'theme'];
  // HistoryPanel keeps enriched records separately from the lightweight visit
  // log. Include both until their format migration is complete.
  const preferenceKeys = () => SYNC_KEYS.filter(key => key === 'vex.history' || !STORE_KEYS.some(store => key === 'vex.' + store));

  // ===== AUTH =====

  async function requestCode(email) {
    requireSyncUrl();
    const r = await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/auth/request-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: 'Failed to request code' }));
      throw new Error(err.error || 'Failed to request code');
    }
    return await r.json();
  }

  async function verifyCode(email, code, deviceName) {
    requireSyncUrl();
    const r = await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/auth/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, deviceName: deviceName || getDefaultDeviceName() })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: 'Code verification failed' }));
      throw new Error(err.error || 'Code verification failed');
    }
    const data = await r.json();
    if (data.hasEncryptedData !== false) throw new Error('This account already has encrypted data, or the server needs updating. Enroll with your recovery code.');
    const cryptoKey = await SyncCrypto.generateKey();
    const keyBytes = await SyncCrypto.exportKey(cryptoKey);
    const keyHex = SyncCrypto.keyToHex(keyBytes);

    state = {
      ...state,
      enabled: true,
      email,
      sessionToken: data.sessionToken,
      deviceId: data.deviceId,
      emailHash: data.emailHash,
      encryptionKey: cryptoKey,
      lastPushAt: null,
      lastPullAt: null,
      syncing: false,
      lastError: null
    };

    await saveStateToDisk(keyHex);
    revision = 0;
    pullBlocked = false;
    // Do not advertise enrollment until the first encrypted document exists.
    const pushed = await pushNow();
    if (!pushed.ok) { await signOut(); throw new Error('Initial sync failed: ' + pushed.reason); }
    startAutoSync();

    return { ok: true, recoveryCode: SyncCrypto.formatRecoveryCode(keyHex) };
  }

  async function enrollWithRecoveryCode(email, code, recoveryCode, deviceName) {
    requireSyncUrl();
    const cleanHex = SyncCrypto.parseRecoveryCode(recoveryCode);
    const keyBytes = SyncCrypto.hexToKey(cleanHex);
    const cryptoKey = await SyncCrypto.importKey(keyBytes);
    const r = await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/auth/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, deviceName: deviceName || getDefaultDeviceName() })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: 'Code verification failed' }));
      throw new Error(err.error || 'Code verification failed');
    }
    const data = await r.json();

    state = {
      ...state,
      enabled: true,
      email,
      sessionToken: data.sessionToken,
      deviceId: data.deviceId,
      emailHash: data.emailHash,
      encryptionKey: cryptoKey,
      lastPushAt: null,
      lastPullAt: null,
      syncing: false,
      lastError: null
    };

    await saveStateToDisk(cleanHex);
    // Pull cloud data first (it's authoritative when restoring on a new device)
    const pulled = await pullNow({ restore: true });
    if (!pulled.ok) {
      await signOut();
      throw new Error('Could not restore sync data: ' + pulled.reason);
    }
    startAutoSync();
    return { ok: true };
  }

  async function signOut(removeFromServer = false) {
    // Every remote call below must bail when no Sync Worker URL is configured:
    // fetch(`${''}/sync/...`) is a RELATIVE request, which the file:// host
    // page resolves to file:///C:/sync/... — console ERR_FILE_NOT_FOUND spam
    // on boot for anyone whose sync state restored without a worker URL.
    if (removeFromServer && state.sessionToken && state.deviceId && syncWorkerUrl()) {
      try {
        await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/sync/devices/${state.deviceId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${state.sessionToken}` }
        });
      } catch {}
    }
    stopAutoSync();
    revision = 0;
    pullBlocked = false;
    recordDocument = null;
    if (typeof VexStorage !== 'undefined') await VexStorage.save('sync-records', null);
    try { await window.vex.syncClearState(); } catch {}
    state = {
      enabled: false, email: null, sessionToken: null, deviceId: null,
      emailHash: null, encryptionKey: null,
      lastPushAt: null, lastPullAt: null, syncing: false, lastError: null
    };
  }

  // ===== DATA COLLECTION =====

  async function collectSyncData() {
    if (typeof TabManager !== 'undefined') await TabManager.persistTabs();
    if (typeof PersistentStorage !== 'undefined') await PersistentStorage._flush();
    const data = {};
    for (const key of preferenceKeys()) {
      const raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) continue;
      // Store the raw string so values round-trip byte-for-byte.
      if (['vex.bookmarks','vex.sessions','vex.history'].includes(key)) {
        try { data['preference:' + key] = JSON.parse(raw); } catch { throw new Error('Invalid bookmarks data'); }
      } else data['preference:' + key] = raw;
    }
    for (const key of STORE_KEYS) {
      let value = await VexStorage.load(key);
      if (key === 'tabs' && Array.isArray(value)) value = window.VexTabPolicy.snapshot(value);
      data['storage:' + key] = value;
    }
    const records = window.VexSyncRecords;
    if (!recordDocument) recordDocument = await VexStorage.load('sync-records') || records.empty();
    recordDocument = records.capture(recordDocument, records.flatten(data), state.deviceId);
    await VexStorage.save('sync-records', recordDocument);
    return recordDocument;
  }

  async function applySyncData(data, restore = false) {
    if (!data || typeof data !== 'object') return;
    const records = window.VexSyncRecords;
    if (data.schema !== 2) {
      if (data.schema != null) throw new Error('Unsupported sync schema');
      const sources = {};
      for (const key of preferenceKeys()) if (Object.hasOwn(data, key)) {
        let value = data[key];
        if (['vex.bookmarks','vex.sessions','vex.history'].includes(key) && typeof value === 'string') value = JSON.parse(value);
        sources['preference:' + key] = value;
      }
      for (const key of STORE_KEYS) if (Object.hasOwn(data, 'vex.' + key)) {
        let value = data['vex.' + key];
        if (typeof value === 'string') { try { value = JSON.parse(value); } catch {} }
        if (key === 'tabs' && Array.isArray(value)) value = window.VexTabPolicy.snapshot(value);
        sources['storage:' + key] = value;
      }
      data = records.capture(records.empty(), records.flatten(sources), 'legacy');
    }
    const local = restore ? records.empty() : await collectSyncData();
    const merged = records.merge(local, data);
    const sources = records.unflatten(records.values(merged));
    window.VexDataContracts?.sources(sources);
    for (const key of ['vex.bookmarks', 'vex.history', 'vex.sessions']) {
      const name = 'preference:' + key;
      if (!Object.hasOwn(sources, name)) continue;
      const value = typeof sources[name] === 'string' ? JSON.parse(sources[name]) : sources[name];
      if (!Array.isArray(value)) throw new Error('Invalid synced list: ' + key);
      sources[name] = value;
    }
    for (const key of preferenceKeys()) {
      const name = 'preference:' + key;
      if (Object.hasOwn(sources, name)) localStorage.setItem(key, typeof sources[name] === 'string' ? sources[name] : JSON.stringify(sources[name]));
      else localStorage.removeItem(key);
    }
    for (const key of STORE_KEYS) {
      if (Object.hasOwn(sources, 'storage:' + key)) await VexStorage.save(key, sources['storage:' + key]);
    }
    recordDocument = merged;
    await VexStorage.save('sync-records', merged);
    if (typeof TabManager !== 'undefined' && Array.isArray(sources['storage:tabs'])) TabManager.applySyncedState(sources['storage:tabs'], sources['storage:groups'], sources['storage:stacks']);
    if (typeof WorkspaceManager !== 'undefined') WorkspaceManager.reloadSyncedState?.();
    const conflicts = Object.values(merged.records).filter(r => r.conflicts?.length > 1).length;
    if (conflicts) window.showToast?.(`${conflicts} sync conflicts retained in recovery data`);
    // Tell panels to re-read their state.
    window.dispatchEvent(new CustomEvent('vex-sync-data-applied'));
  }

  // ===== PUSH/PULL =====

  async function pushNow() {
    if (pullBlocked) return { ok: false, reason: 'Recover cloud data with a successful pull before uploading changes' };
    if (!syncWorkerUrl()) {
      console.log('[Sync] not configured — skipping push');
      return { ok: false, reason: 'sync-not-configured' };
    }
    if (!state.enabled || state.syncing) return { ok: false, reason: 'not-ready' };
    state.syncing = true;
    try {
      const data = await collectSyncData();
      const encryptedBlob = await SyncCrypto.encrypt(data, state.encryptionKey);
      const r = await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/sync/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.sessionToken}`
        },
        body: JSON.stringify({ encryptedBlob, updatedAt: new Date().toISOString(), baseRevision: revision })
      });
      if (r.status === 401) { await signOut(); return { ok: false, reason: 'unauthorized' }; }
      if (!r.ok) throw new Error('Push returned ' + r.status);
      revision = (await r.json()).revision;
      state.lastPushAt = new Date().toISOString();
      state.lastError = null;
      await saveMetaToDisk();
      return { ok: true };
    } catch (err) {
      console.error('[Sync] Push failed:', err);
      state.lastError = err.message || String(err);
      return { ok: false, reason: state.lastError };
    } finally {
      state.syncing = false;
      window.dispatchEvent(new CustomEvent('vex-sync-status', { detail: { error: state.lastError } }));
    }
  }

  async function pullNow({ restore = false } = {}) {
    if (!syncWorkerUrl()) {
      console.log('[Sync] not configured — skipping pull');
      return { ok: false, reason: 'sync-not-configured' };
    }
    if (!state.enabled || state.syncing) return { ok: false, reason: 'not-ready' };
    state.syncing = true;
    try {
      const r = await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/sync/pull`, {
        headers: { 'Authorization': `Bearer ${state.sessionToken}` }
      });
      if (r.status === 401) { await signOut(); return { ok: false, reason: 'unauthorized' }; }
      if (!r.ok) throw new Error('Pull returned ' + r.status);

      const result = await r.json();
      const receivedRevision = result.revision || 0;
      if (!Number.isSafeInteger(receivedRevision) || receivedRevision < 0) throw new Error('Invalid sync revision');
      const blob = result.encryptedBlob;
      if (!blob) {
        revision = receivedRevision;
        pullBlocked = false;
        state.lastPullAt = new Date().toISOString();
        await saveMetaToDisk();
        return { ok: true, empty: true };
      }
      pullBlocked = true;
      const decrypted = await SyncCrypto.decrypt(blob, state.encryptionKey);
      await applySyncData(decrypted, restore);
      // Only acknowledge a revision after its contents were decrypted and applied.
      // Otherwise a stale or damaged local key could overwrite unreadable cloud data.
      revision = receivedRevision;
      pullBlocked = false;
      state.lastPullAt = new Date().toISOString();
      state.lastError = null;
      await saveMetaToDisk();
      return { ok: true };
    } catch (err) {
      console.error('[Sync] Pull failed:', err);
      state.lastError = err.message || String(err);
      return { ok: false, reason: state.lastError };
    } finally {
      state.syncing = false;
      window.dispatchEvent(new CustomEvent('vex-sync-status', { detail: { error: state.lastError } }));
    }
  }

  // ===== AUTO-SYNC =====

  function startAutoSync() {
    stopAutoSync();
    if (!syncWorkerUrl()) {
      console.log('[Sync] not configured — no push/pull timers started');
      return;
    }
    pushTimer = setInterval(() => pushNow(), 2 * 60 * 1000);
    pullTimer = setInterval(() => pullNow(), 5 * 60 * 1000);
  }

  function stopAutoSync() {
    if (pushTimer) clearInterval(pushTimer);
    if (pullTimer) clearInterval(pullTimer);
    pushTimer = pullTimer = null;
  }

  // ===== DEVICES =====

  async function listDevices() {
    if (!state.enabled || !syncWorkerUrl()) return [];
    const r = await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/sync/devices`, {
      headers: { 'Authorization': `Bearer ${state.sessionToken}` }
    });
    if (!r.ok) return [];
    const data = await r.json();
    return data.devices || [];
  }

  async function removeDevice(deviceId) {
    if (!state.enabled || !syncWorkerUrl()) return;
    await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/sync/devices/${deviceId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.sessionToken}` }
    });
  }

  async function wipeAllCloudData() {
    if (!state.enabled || !syncWorkerUrl()) return false;
    const r = await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/sync/all`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.sessionToken}` }
    });
    return r.ok;
  }

  // ===== PERSISTENCE =====

  async function saveStateToDisk(keyHex) {
    await window.vex.syncSaveKey(keyHex);
    await saveMetaToDisk();
  }

  async function saveMetaToDisk() {
    await window.vex.syncSaveMeta({
      email: state.email,
      sessionToken: state.sessionToken,
      deviceId: state.deviceId,
      emailHash: state.emailHash,
      lastPushAt: state.lastPushAt,
      lastPullAt: state.lastPullAt
      , revision
    });
  }

  async function initFromDisk() {
    let meta, keyHex;
    try {
      meta = await window.vex.syncLoadMeta();
      keyHex = await window.vex.syncLoadKey();
    } catch { return false; }
    if (!meta || !keyHex) return false;
    revision = meta.revision || 0;
    pullBlocked = true;

    try {
      const keyBytes = SyncCrypto.hexToKey(keyHex);
      const cryptoKey = await SyncCrypto.importKey(keyBytes);

      state = {
        enabled: true,
        email: meta.email,
        sessionToken: meta.sessionToken,
        deviceId: meta.deviceId,
        emailHash: meta.emailHash,
        encryptionKey: cryptoKey,
        lastPushAt: meta.lastPushAt,
        lastPullAt: meta.lastPullAt,
        syncing: false,
        lastError: null
      };

      startAutoSync();
      // Kick off a pull shortly; don't block init.
      setTimeout(() => pullNow(), 1500);
      return true;
    } catch (err) {
      console.error('[Sync] Failed to restore state:', err);
      return false;
    }
  }

  function getDefaultDeviceName() {
    try {
      const plat = (window.vex && window.vex.platform) || '';
      const platLabel = plat === 'win32' ? 'Windows' : plat === 'darwin' ? 'Mac' : plat === 'linux' ? 'Linux' : 'Device';
      return `${platLabel}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
    } catch { return 'Vex Device'; }
  }

  function getState() {
    // Never expose the raw key
    return { ...state, encryptionKey: null };
  }

  // ===== DROP — cross-device tab handoff ("Send to Phone") =====
  async function dropSend(url, title) {
    if (!state.enabled || !state.sessionToken) {
      throw new Error('Sign in to Vex Sync first (Settings → Vex Sync)');
    }
    requireSyncUrl();
    if (!/^https?:$/.test(new URL(url).protocol)) throw new Error('Only web URLs can be sent');
    const encryptedBlob = await SyncCrypto.encrypt({ url: url.slice(0,2048), title: String(title || '').slice(0,300) }, state.encryptionKey);
    const r = await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/sync/drop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.sessionToken}` },
      body: JSON.stringify({ encryptedBlob })
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || 'Send failed');
    }
    return await r.json();
  }

  async function dropFetch() {
    if (!state.enabled || !state.sessionToken || !syncWorkerUrl()) return [];
    try {
      const r = await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/sync/drop`, {
        headers: { 'Authorization': `Bearer ${state.sessionToken}` }
      });
      if (!r.ok) return [];
      const d = await r.json().catch(() => null);
      const items = [];
      for (const item of (d?.items || [])) {
        if (!item.encryptedBlob) continue;
        const payload = await SyncCrypto.decrypt(item.encryptedBlob, state.encryptionKey);
        if (typeof payload.url === 'string' && /^https?:$/.test(new URL(payload.url).protocol)) items.push({ ...item, url: payload.url, title: String(payload.title || '') });
      }
      return items;
    } catch { return []; }
  }

  async function getRecoveryCode() {
    const keyHex = await window.vex.syncLoadKey();
    if (!keyHex) return null;
    return SyncCrypto.formatRecoveryCode(keyHex);
  }

  return {
    initFromDisk,
    requestCode,
    verifyCode,
    enrollWithRecoveryCode,
    signOut,
    pushNow,
    pullNow,
    listDevices,
    removeDevice,
    wipeAllCloudData,
    dropSend,
    dropFetch,
    getState,
    getRecoveryCode,
    isEnabled: () => state.enabled,
    SYNC_KEYS
  };
})();

window.SyncEngine = SyncEngine;
