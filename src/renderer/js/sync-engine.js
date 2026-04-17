// === Vex Phase 13: Sync Engine ===
// Auth + encrypted push/pull against the vex-sync Cloudflare worker.
// Data source is localStorage (which the Phase 11 persistent-storage shim
// already mirrors to %APPDATA%/Vex/vex-persist.json).

const SyncEngine = (() => {
  const SYNC_WORKER_URL = 'https://vex-sync.mortuexhavoc.workers.dev';

  // Keys in localStorage that should be synced across devices.
  const SYNC_KEYS = [
    'vex.tabs', 'vex.sessions', 'vex.workspaces', 'vex.shortcuts', 'vex.tools',
    'vex.notes', 'vex.history', 'vex.theme', 'vex.settings', 'vex.schedules',
    'vex.agentMode', 'vex.aiIndexingEnabled', 'vex.customCommands', 'vex.zooms',
    'vex.forceDarkSites', 'vex.restoreOnStartup', 'vex.autosleep',
    'vex.autosleepMinutes', 'vex.autosleepExcludePinned', 'vex.groups',
    // Phase 14: AI routing prefs (but NOT localAIModel — each device has
    // its own installed Ollama models)
    'vex.aiRouting', 'vex.preferLocalAI', 'vex.forceCloudAI',
    // Phase 15: custom personas + globally active persona id
    // (per-tab selections live under vex.activePersonaByTab.* and are NOT
    // synced — tab ids are device-local)
    'vex.personas', 'vex.activePersona',
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

  // ===== AUTH =====

  async function requestCode(email) {
    const r = await fetch(`${SYNC_WORKER_URL}/auth/request-code`, {
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
    const r = await fetch(`${SYNC_WORKER_URL}/auth/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, deviceName: deviceName || getDefaultDeviceName() })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: 'Code verification failed' }));
      throw new Error(err.error || 'Code verification failed');
    }
    const data = await r.json();

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
    startAutoSync();

    // Push immediately so other devices have something to pull
    pushNow();

    return { ok: true, recoveryCode: SyncCrypto.formatRecoveryCode(keyHex) };
  }

  async function enrollWithRecoveryCode(email, code, recoveryCode, deviceName) {
    const r = await fetch(`${SYNC_WORKER_URL}/auth/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, deviceName: deviceName || getDefaultDeviceName() })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: 'Code verification failed' }));
      throw new Error(err.error || 'Code verification failed');
    }
    const data = await r.json();

    const cleanHex = SyncCrypto.parseRecoveryCode(recoveryCode);
    const keyBytes = SyncCrypto.hexToKey(cleanHex);
    const cryptoKey = await SyncCrypto.importKey(keyBytes);

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
    await pullNow();
    startAutoSync();
    return { ok: true };
  }

  async function signOut(removeFromServer = false) {
    if (removeFromServer && state.sessionToken && state.deviceId) {
      try {
        await fetch(`${SYNC_WORKER_URL}/sync/devices/${state.deviceId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${state.sessionToken}` }
        });
      } catch {}
    }
    stopAutoSync();
    try { await window.vex.syncClearState(); } catch {}
    state = {
      enabled: false, email: null, sessionToken: null, deviceId: null,
      emailHash: null, encryptionKey: null,
      lastPushAt: null, lastPullAt: null, syncing: false, lastError: null
    };
  }

  // ===== DATA COLLECTION =====

  function collectSyncData() {
    const data = {};
    for (const key of SYNC_KEYS) {
      const raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) continue;
      // Store the raw string so values round-trip byte-for-byte.
      data[key] = raw;
    }
    data._syncedAt = new Date().toISOString();
    data._fromDevice = state.deviceId;
    return data;
  }

  function applySyncData(data) {
    if (!data || typeof data !== 'object') return;
    for (const key of SYNC_KEYS) {
      const val = data[key];
      if (val === undefined) continue;
      const str = typeof val === 'string' ? val : JSON.stringify(val);
      localStorage.setItem(key, str);
    }
    // Tell panels to re-read their state.
    window.dispatchEvent(new CustomEvent('vex-sync-data-applied'));
  }

  // ===== PUSH/PULL =====

  async function pushNow() {
    if (!state.enabled || state.syncing) return { ok: false, reason: 'not-ready' };
    state.syncing = true;
    try {
      const data = collectSyncData();
      const encryptedBlob = await SyncCrypto.encrypt(data, state.encryptionKey);
      const r = await fetch(`${SYNC_WORKER_URL}/sync/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.sessionToken}`
        },
        body: JSON.stringify({ encryptedBlob, updatedAt: new Date().toISOString() })
      });
      if (r.status === 401) { await signOut(); return { ok: false, reason: 'unauthorized' }; }
      if (!r.ok) throw new Error('Push returned ' + r.status);
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
    }
  }

  async function pullNow() {
    if (!state.enabled || state.syncing) return { ok: false, reason: 'not-ready' };
    state.syncing = true;
    try {
      const r = await fetch(`${SYNC_WORKER_URL}/sync/pull`, {
        headers: { 'Authorization': `Bearer ${state.sessionToken}` }
      });
      if (r.status === 401) { await signOut(); return { ok: false, reason: 'unauthorized' }; }
      if (!r.ok) throw new Error('Pull returned ' + r.status);

      const result = await r.json();
      const blob = result.encryptedBlob;
      if (!blob) {
        state.lastPullAt = new Date().toISOString();
        await saveMetaToDisk();
        return { ok: true, empty: true };
      }
      // Skip our own push coming back
      if (result.pushedBy === state.deviceId) {
        state.lastPullAt = new Date().toISOString();
        await saveMetaToDisk();
        return { ok: true, ownPush: true };
      }
      const decrypted = await SyncCrypto.decrypt(blob, state.encryptionKey);
      applySyncData(decrypted);
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
    }
  }

  // ===== AUTO-SYNC =====

  function startAutoSync() {
    stopAutoSync();
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
    if (!state.enabled) return [];
    const r = await fetch(`${SYNC_WORKER_URL}/sync/devices`, {
      headers: { 'Authorization': `Bearer ${state.sessionToken}` }
    });
    if (!r.ok) return [];
    const data = await r.json();
    return data.devices || [];
  }

  async function removeDevice(deviceId) {
    if (!state.enabled) return;
    await fetch(`${SYNC_WORKER_URL}/sync/devices/${deviceId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.sessionToken}` }
    });
  }

  async function wipeAllCloudData() {
    if (!state.enabled) return false;
    const r = await fetch(`${SYNC_WORKER_URL}/sync/all`, {
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
    });
  }

  async function initFromDisk() {
    let meta, keyHex;
    try {
      meta = await window.vex.syncLoadMeta();
      keyHex = await window.vex.syncLoadKey();
    } catch { return false; }
    if (!meta || !keyHex) return false;

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
    getState,
    getRecoveryCode,
    isEnabled: () => state.enabled,
    SYNC_KEYS
  };
})();

window.SyncEngine = SyncEngine;
