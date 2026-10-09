// === Vex Phase 13: Sync Engine ===
// Auth + encrypted push/pull against the vex-sync Cloudflare worker.
// Data source is localStorage (which the Phase 11 persistent-storage shim
// already mirrors to %APPDATA%/Vex/vex-persist.json).

const SyncEngine = (() => {
  // A failed decryption/application must never be followed by a destructive push.
  // A successful pull is required to clear this guard.
  let pullBlocked = false;
  // Sync targets a Cloudflare Worker each user deploys themselves
  // (see SELF_HOSTING.md). The URL is set in Settings › Cloud (VexConfig).
  // Sync stays OFF until a URL is configured: auth, push, pull, and device
  // calls all no-op when it's empty, so a fresh install never hits a dead
  // endpoint or spams the network on a timer.
  function syncWorkerUrl() {
    try { return (typeof window !== 'undefined' && window.VexConfig) ? window.VexConfig.syncWorkerUrl() : ''; }
    catch { return ''; }
  }
  function requireSyncUrl() {
    const u = syncWorkerUrl();
    if (!u) throw new Error('Sync is not configured. Add your Sync Worker URL in Settings › Cloud (see SELF_HOSTING.md).');
    return u;
  }

  // A private window never syncs. Its storage is its own and thrown away, so
  // anything it pulled would sit in a window meant to keep nothing, and
  // anything it pushed would be built from that. Main refuses it the saved
  // sign-in, but its Settings could still sign in afresh: that registered a
  // device named after it, pulled the account's bookmarks into the window and
  // pushed (found 2026-10-08). Nothing here reaches the network from one.
  const PRIVATE_OFF = 'Sync is off in private windows';
  function privateWindow() {
    return !!(typeof window !== 'undefined' && window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow);
  }
  function refuseInPrivate() { if (privateWindow()) throw new Error(PRIVATE_OFF); }

  // Keys in localStorage that should be synced across devices.
  const SYNC_KEYS = [
    'vex.bookmarks',
    'vex.tabs', 'vex.sessions', 'vex.workspaces', 'vex.shortcuts', 'vex.tools',
    'vex.notes', 'vex.history', 'vex.theme', 'vex.schedules',
    // Light and dark: the two themes and when each is worn (js/theme-auto.js).
    'vex.themeAuto',
    // Your own colour themes (js/theme-studio.js): name and colours only, a
    // few hundred bytes each. Their background images stay on each device
    // (up to 1.5 MB each, held by the main process): a .vextheme file carries
    // a theme with its image to another device.
    'vex.customThemes',
    'vex.agentMode', 'vex.aiIndexingEnabled', 'vex.zooms',
    // The site panel's per-site lists (js/site-panel.js) travel together, as
    // zoom and force-dark already did: sites that never sleep, and sites
    // translated every time they load. They are choices about a site, not
    // about this machine; Reset to Defaults leaves all of them alone.
    'vex.neverSleepHosts', 'vex.translateAlwaysHosts',
    // 'vex.forceDarkSites' is the retired global flag; per-site force-dark has
    // lived in 'vex.forceDarkHosts' since the right-click menu replaced it, and
    // was left out of this list, so the choice never reached another device.
    'vex.forceDarkSites', 'vex.forceDarkHosts', 'vex.groups',
    // Auto-sleep lives in settings.json; app.js mirrors it here and adopts a
    // copy that arrived from another device on the next start. (The old
    // names — vex.autosleep, vex.autosleepMinutes, vex.autosleepExcludePinned
    // — were never written by anything, so it never synced.)
    'vex.autoSleepPrefs',
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
    // Reminders and alarms. The main process owns them (reminders.json); the
    // renderer mirrors the list here so it travels, and imports what arrives
    // (js/quick-reminder.js). Only the machine that set one wakes Windows for it.
    'vex.reminders',
    // Settings › About › Show what is new after an update (js/update-log.js).
    'vex.whatsNewCard',
  ];

  // Lists synced item by item, so two devices' entries merge instead of one
  // whole list replacing the other. Notes were one value, so joining sync (or
  // a concurrent edit) dropped every note one side had (found 2026-09-29).
  // Tools, scheduled tasks, personas, reminders and force-dark sites were still
  // one value each, so the same thing happened to them (found 2026-09-30).
  // Their items carry ids already (a force-dark site is a plain host name,
  // which is its own id: sync-records.js flatten). A device on an older Vex
  // still sends these whole; its copy then wins whole, as notes did.
  const LIST_PREFERENCES = ['vex.bookmarks', 'vex.sessions', 'vex.history', 'vex.notes',
    'vex.tools', 'vex.schedules', 'vex.personas', 'vex.reminders', 'vex.forceDarkHosts',
    // The site panel's other per-site lists, merged the same way.
    'vex.neverSleepHosts', 'vex.translateAlwaysHosts',
    // Colour themes the user made (js/theme-custom.js), merged theme by theme.
    'vex.customThemes'];

  // Shortcut tiles (vex.shortcuts) never synced: preferenceKeys() dropped the
  // key because the unused storage key 'shortcuts' has the same name (found
  // 2026-09-30). Vex 2.34.2 and older mark every record they do not know as
  // deleted on each push, so tiles in the account would vanish from the newer
  // devices the moment an older one synced. Tiles therefore sync, item by item,
  // only while every device on the account says it understands them: each
  // device writes a marker record of its own ('sync:device:<id>'), and the
  // device list the worker already keeps says who is on the account. Until then
  // (or again, once an older device joins) tiles stay on each device as before,
  // and this device leaves the account's tile records exactly as it found them.
  // The New Tab page's grid is a list of its own (vex.startTiles): the page
  // keeps it in its own storage, hands it to this window on every change and
  // is handed the synced list back (js/webview.js, saveStartTiles). It synced nowhere
  // (found 2026-09-30); it now waits for the same devices, the same way.
  const TILE_LISTS = ['vex.shortcuts', 'vex.startTiles'];
  const TILE_SOURCES = TILE_LISTS.map(key => 'preference:' + key);
  const DEVICE_SOURCE = 'sync:device:';
  // 1 = shortcut tiles and the New Tab grid (Vex 2.34.3). Raise it for the
  // next feature that must wait for every device, and compare against the
  // level that feature needs.
  const SYNC_LEVEL = 1;
  const TILES_LEVEL = 1;
  let tileGate = { open: false, waitingOn: [] };

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
  // Every change to `state` is announced, so the toolbar indicator can follow
  // it without asking once a second (js/app.js).
  const stateChanged = () => window.dispatchEvent(new CustomEvent('vex-sync-state', { detail: getState() }));

  let pushTimer = null;
  let pullTimer = null;
  let markerTimer = null;   // the push that puts this device's marker back (pullNow)
  let revision = 0;
  let recordDocument = null;
  const STORE_KEYS = ['tabs', 'groups', 'stacks', 'history', 'settings', 'shortcuts', 'theme'];
  // HistoryPanel keeps enriched records separately from the lightweight visit
  // log. Include both until their format migration is complete.
  const preferenceKeys = () => SYNC_KEYS.filter(key => key === 'vex.history' || !STORE_KEYS.some(store => key === 'vex.' + store));

  // ===== AUTH =====

  // The AI worker turns away a request without its token with 401
  // "Authentication required" (and a GET with 405 "Method not allowed"), and
  // that was all the Sync field holding the AI worker's address said (found
  // 2026-10-09). Ask the address which worker it is (VexConfig.workerKind)
  // and say that instead. → the sentence, or null.
  async function wrongWorker(status, error) {
    if (!(status === 401 && error === 'Authentication required') && !(status === 405 && error === 'Method not allowed')) return null;
    try { return (await window.VexConfig.workerKind(syncWorkerUrl())) === 'ai' ? window.VexConfig.WRONG_WORKER.sync : null; }
    catch (err) { console.error('[Sync] Could not ask the Sync Worker URL which worker it is:', (err && err.message) || err); return null; }
  }
  async function authFailure(r, fallback) {
    const err = await r.json().catch(() => ({ error: fallback }));
    return new Error((await wrongWorker(r.status, err.error)) || err.error || fallback);
  }

  async function requestCode(email) {
    refuseInPrivate();
    requireSyncUrl();
    const r = await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/auth/request-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (!r.ok) throw await authFailure(r, 'Failed to request code');
    return await r.json();
  }

  async function verifyCode(email, code, deviceName) {
    refuseInPrivate();
    requireSyncUrl();
    const r = await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/auth/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, deviceName: deviceName || getDefaultDeviceName() })
    });
    if (!r.ok) throw await authFailure(r, 'Code verification failed');
    const data = await r.json();
    if (data.hasEncryptedData !== false) {
      // An older server registered this device before answering; a refusal
      // here left a ghost in the device list (found 2026-09-29). A current
      // one registers it on its first push or pull, and this drops the session.
      await forgetDevice(data.sessionToken, data.deviceId);
      throw new Error('This account already has encrypted data, or the server needs updating. Enroll with your recovery code.');
    }
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
    stateChanged();

    await saveStateToDisk(keyHex);
    revision = 0;
    pullBlocked = false;
    // Do not advertise enrollment until the first encrypted document exists.
    const pushed = await pushNow();
    if (!pushed.ok) { await signOut(true); throw new Error('Initial sync failed: ' + pushed.reason); }
    startAutoSync();

    return { ok: true, recoveryCode: SyncCrypto.formatRecoveryCode(keyHex) };
  }

  async function enrollWithRecoveryCode(email, code, recoveryCode, deviceName) {
    refuseInPrivate();
    requireSyncUrl();
    const cleanHex = SyncCrypto.parseRecoveryCode(recoveryCode);
    const keyBytes = SyncCrypto.hexToKey(cleanHex);
    const cryptoKey = await SyncCrypto.importKey(keyBytes);
    const r = await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/auth/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, deviceName: deviceName || getDefaultDeviceName() })
    });
    if (!r.ok) throw await authFailure(r, 'Code verification failed');
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
    stateChanged();

    await saveStateToDisk(cleanHex);
    // Pull cloud data first (it's authoritative when restoring on a new device)
    const pulled = await pullNow({ restore: true });
    if (!pulled.ok) {
      // signOut(true) so a failed join does not leave a ghost device on the
      // server (found 2026-09-29).
      await signOut(true);
      if (pulled.badKey) throw new Error('This recovery code doesn’t unlock this account’s data — check it and try again.');
      throw new Error('Could not restore sync data: ' + pulled.reason);
    }
    // The restore kept what this device had that the cloud did not; upload it
    // so the other devices get it too.
    const pushed = await pushNow();
    startAutoSync();
    return pushed.ok ? { ok: true } : { ok: true, pushError: pushed.reason };
  }

  // Removes a device the server registered during a sign-in that then failed.
  async function forgetDevice(sessionToken, deviceId) {
    if (!sessionToken || !deviceId) return;
    try {
      const r = await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/sync/devices/${deviceId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${sessionToken}` }
      });
      if (!r.ok) console.error('[Sync] Could not remove the half-enrolled device: server returned ' + r.status);
    } catch (err) { console.error('[Sync] Could not remove the half-enrolled device:', err); }
  }

  // The server stopped recognising this device (removed from another device,
  // or the cloud data was wiped). Signing out silently left the user with a
  // sync that had just stopped (found 2026-09-29).
  async function signedOutByServer() {
    await signOut();
    window.showToast?.('This device was signed out of Vex Sync — the server no longer recognises it (it was removed from another device, or the cloud data was wiped). Sign in again in Settings › Vex Sync.', 'error');
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
    tileGate = { open: false, waitingOn: [] };
    if (typeof VexStorage !== 'undefined') { await VexStorage.save('sync-records', null); await VexStorage.save('sync-tiles-joined', null); }
    try { await window.vex.syncClearState(); } catch {}
    state = {
      enabled: false, email: null, sessionToken: null, deviceId: null,
      emailHash: null, encryptionKey: null,
      lastPushAt: null, lastPullAt: null, syncing: false, lastError: null
    };
    stateChanged();
  }

  // ===== SHORTCUT TILES =====

  const sourceOf = key => JSON.parse(key)[0];
  // The sources this device reads and writes: its synced preferences, its
  // file-store keys, its own marker, and the tiles while every device
  // understands them. Every other record (another device's marker, a list a
  // newer Vex or the phone added, a record kind this version does not know)
  // is carried exactly as it was pulled. Vex 2.35.1 and older marked all of
  // those deleted on every push, so whatever another client added vanished
  // from every device (SYNC_PROTOCOL.md §6 rule 1).
  const RECORD_KINDS = ['type', 'value', 'item'];
  const ownsSource = (source, gate) => source === DEVICE_SOURCE + state.deviceId
    || preferenceKeys().some(key => source === 'preference:' + key)
    || STORE_KEYS.some(key => source === 'storage:' + key)
    || (gate.open && TILE_SOURCES.includes(source));
  const ownsRecord = (key, gate) => { const [source, kind] = JSON.parse(key); return RECORD_KINDS.includes(kind) && ownsSource(source, gate); };
  const tileRecords = doc =>({ schema: 2, records: Object.fromEntries(Object.entries(doc.records).filter(([key]) => TILE_SOURCES.includes(sourceOf(key)))) });

  // Tiles carry no id, so the id comes from the address: the same tile made on
  // two devices is one tile, and a second tile with the same address (Duplicate)
  // gets "-2" instead of overwriting the first. The id exists only in the
  // account; it is taken off again before the tiles are saved here.
  function withTileIds(list) {
    const seen = new Map();
    return list.map(tile => {
      let hash = 0x811c9dc5;
      for (const ch of String(tile.url)) hash = Math.imul(hash ^ ch.codePointAt(0), 0x01000193) >>> 0;
      const base = 'tile-' + hash.toString(16).padStart(8, '0');
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return { ...tile, id: n > 1 ? base + '-' + n : base };
    });
  }
  const withoutTileIds = list => list.map(tile => { const copy = { ...tile }; delete copy.id; return copy; });

  // This device's tiles: those the account can carry, and those it cannot. A
  // tile every device would refuse on arrival (a mailto: address) stays here
  // rather than stopping sync for the whole account. null: no tiles saved (the
  // bar shows its defaults), which this device then takes from the account.
  function localTiles(key) {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    let list;
    try { list = JSON.parse(raw); } catch { throw new Error('Invalid ' + key.slice(4) + ' data'); }
    if (!Array.isArray(list)) throw new Error('Invalid ' + key.slice(4) + ' data');
    const synced = [], kept = [];
    for (const tile of list) {
      let ok = !!tile && typeof tile === 'object' && typeof tile.url === 'string';
      if (ok && window.VexDataContracts) { try { window.VexDataContracts.storage(key.slice(4), [tile]); } catch { ok = false; } }
      (ok ? synced : kept).push(tile);
    }
    return { synced, kept };
  }

  // Whether tiles may sync on this round. It is asked after a pull has been
  // read: a device is in the server's list from its first pull, before it can
  // push, so tile records an older device marked deleted never arrive without
  // that device already listed here. A device that has not synced yet has no
  // list (403) and keeps its tiles to itself until the next round.
  async function checkTileGate(doc) {
    let devices = null;
    try {
      const r = await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/sync/devices`, {
        headers: { 'Authorization': `Bearer ${state.sessionToken}` }
      });
      if (r.ok) {
        devices = (await r.json().catch(() => null))?.devices;
        if (!Array.isArray(devices)) { devices = null; console.error('[Sync] The device list came back unreadable; shortcut tiles stay on this device for now'); }
      } else if (r.status !== 403) console.error('[Sync] Could not read the device list (server returned ' + r.status + '); shortcut tiles stay on this device for now');
    } catch (err) { console.error('[Sync] Could not read the device list; shortcut tiles stay on this device for now:', err); }
    let open = false, waitingOn = [];
    if (devices) {
      waitingOn = devices.filter(d => {
        if (!d || d.deviceId === state.deviceId) return false;
        const marker = doc.records[JSON.stringify([DEVICE_SOURCE + d.deviceId, 'value'])];
        return !(marker && !marker.deleted && marker.value?.level >= TILES_LEVEL);
      }).map(d => d.deviceId);
      open = !waitingOn.length;
    }
    tileGate = { open, waitingOn };
    const joined = await VexStorage.load('sync-tiles-joined') === state.deviceId;
    // Shut again (an older device joined): the next time it opens, this
    // device's tiles are added to the account's once more.
    if (!open && joined) await VexStorage.save('sync-tiles-joined', null);
    return { open, join: open && !joined, cloud: doc };
  }

  // ===== DATA COLLECTION =====

  async function collectSyncData(gate = { open: false }) {
    if (typeof TabManager !== 'undefined') await TabManager.persistTabs();
    if (typeof PersistentStorage !== 'undefined') await PersistentStorage._flush();
    const data = {};
    for (const key of preferenceKeys()) {
      const raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) continue;
      // Store the raw string so values round-trip byte-for-byte.
      if (LIST_PREFERENCES.includes(key)) {
        let list;
        try { list = JSON.parse(raw); } catch { throw new Error('Invalid ' + key.slice(4) + ' data'); }
        // Sent as anything but a list, every other device would refuse it
        // ("Invalid synced list"); refuse it here, on the device that has it.
        if (!Array.isArray(list)) throw new Error('Invalid ' + key.slice(4) + ' data');
        data['preference:' + key] = list;
      } else data['preference:' + key] = raw;
    }
    for (const key of STORE_KEYS) {
      let value = await VexStorage.load(key);
      if (key === 'tabs' && Array.isArray(value)) value = window.VexTabPolicy.snapshot(value);
      data['storage:' + key] = value;
    }
    const records = window.VexSyncRecords;
    if (!recordDocument) recordDocument = await VexStorage.load('sync-records') || records.empty();
    let before = recordDocument;
    data[DEVICE_SOURCE + state.deviceId] = { level: SYNC_LEVEL };
    if (gate.open) {
      // First tile sync on this device, or the first since an older device
      // left: start from the account's tile records and add this device's
      // tiles to them, so neither side loses one. Tiles an older device
      // marked deleted come back.
      if (gate.join) before = { schema: 2, records: { ...before.records, ...tileRecords(gate.cloud).records } };
      const cloudLists = gate.join ? records.unflatten(records.values(tileRecords(gate.cloud))) : {};
      for (const key of TILE_LISTS) {
        const source = 'preference:' + key;
        let tiles = localTiles(key);
        const cloud = cloudLists[source];
        if (gate.join && (Array.isArray(cloud) || tiles)) {
          const have = Array.isArray(cloud) ? cloud : [];
          const ids = new Set(have.map(tile => tile.id));
          const union = withoutTileIds([...have, ...withTileIds(tiles ? tiles.synced : []).filter(tile => !ids.has(tile.id))]);
          const kept = tiles ? tiles.kept : [];
          localStorage.setItem(key, JSON.stringify([...union, ...kept]));
          tiles = { synced: union, kept };
        }
        if (tiles) data[source] = withTileIds(tiles.synced);
      }
    }
    recordDocument = records.capture(before, records.flatten(data), state.deviceId);
    // Records this device leaves exactly as it found them: everything it does
    // not own (ownsRecord), including the tiles while they wait for every
    // device to understand them. capture() marked them deleted, as it does
    // every record missing from its values; they go back unchanged, in place.
    for (const key of Object.keys(recordDocument.records)) {
      if (ownsRecord(key, gate)) continue;
      if (!Object.hasOwn(before.records, key)) throw new Error('Sync tried to write a record it does not own: ' + key);
      recordDocument.records[key] = before.records[key];
    }
    await VexStorage.save('sync-records', recordDocument);
    if (gate.join) await VexStorage.save('sync-tiles-joined', state.deviceId);
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
        if (LIST_PREFERENCES.includes(key) && typeof value === 'string') value = JSON.parse(value);
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
    records.valid(data);
    const gate = await checkTileGate(data);
    const local = await collectSyncData(gate);
    let merged;
    if (restore) {
      // Joining used to start from an empty local side, so every bookmark,
      // note and setting this device already had was overwritten or removed
      // (found 2026-09-29). The cloud still wins for every record it has,
      // tombstones included; records only this device has are kept, and
      // enrollWithRecoveryCode pushes them up afterwards.
      records.valid(data);
      merged = { schema: 2, records: { ...data.records } };
      const typeOf = (doc, key) => doc.records[JSON.stringify([JSON.parse(key)[0], 'type'])];
      // A bookmark this device has under another id than the account's copy
      // of the same address would come back as a second bookmark on every
      // device. The account's copy is kept; the address is the identity, as
      // for the star button (bookmarks.js has(): the same URL string).
      const bookmarkItem = key => { const [source, kind] = JSON.parse(key); return source === 'preference:vex.bookmarks' && kind === 'item'; };
      const accountBookmarks = new Set(Object.entries(data.records)
        .filter(([key, record]) => !record.deleted && bookmarkItem(key) && typeof record.value?.item?.url === 'string')
        .map(([, record]) => record.value.item.url));
      for (const [key, record] of Object.entries(local.records)) {
        if (Object.hasOwn(merged.records, key) || record.deleted) continue;
        // The cloud keeps this source in another shape (notes pushed as one
        // value by an older Vex): its copy wins whole rather than mixing both.
        const cloudType = typeOf(data, key);
        if (cloudType && !cloudType.deleted && cloudType.value !== typeOf(local, key)?.value) continue;
        if (bookmarkItem(key) && accountBookmarks.has(record.value?.item?.url)) continue;
        merged.records[key] = record;
      }
      // This device's tiles were just added on top of the account's (see
      // collectSyncData), so its tile records are the newer ones.
      if (gate.open) Object.assign(merged.records, records.merge(tileRecords(local), tileRecords(data)).records);
    } else merged = records.merge(local, data);
    // Only what this device applies is read and checked. A source it does not
    // own stays in the document as it came, and must not stop this device
    // syncing because it fails a check that applies to what this device writes.
    const sources = records.unflatten(Object.fromEntries(Object.entries(records.values(merged)).filter(([key]) => ownsRecord(key, gate))));
    window.VexDataContracts?.sources(sources);
    for (const key of LIST_PREFERENCES) {
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
    // Tiles only while every device understands them; otherwise this device's
    // own tiles stay as they are, whatever the account holds.
    if (gate.open) {
      for (const key of TILE_LISTS) {
        const source = 'preference:' + key;
        if (Object.hasOwn(sources, source) && !Array.isArray(sources[source])) throw new Error('Invalid synced list: ' + key);
      }
      for (const key of TILE_LISTS) {
        const source = 'preference:' + key;
        const kept = localTiles(key)?.kept || [];
        if (Object.hasOwn(sources, source)) localStorage.setItem(key, JSON.stringify([...withoutTileIds(sources[source]), ...kept]));
        else if (kept.length) localStorage.setItem(key, JSON.stringify(kept));
        else localStorage.removeItem(key);
      }
      window.VexGuiStyle?.render?.();
      // The open New Tab pages are handed the grid (js/webview.js).
      if (typeof WebviewManager !== 'undefined') WebviewManager.pushStartTiles?.();
    }
    for (const key of STORE_KEYS) {
      if (Object.hasOwn(sources, 'storage:' + key)) await VexStorage.save(key, sources['storage:' + key]);
    }
    recordDocument = merged;
    await VexStorage.save('sync-records', merged);
    // An older Vex marks this device's marker deleted on its push. This device
    // put it back only on its own next push, up to two minutes later, and
    // meanwhile the other devices named it as the one tiles wait on
    // (found 2026-09-30). The account lacking it, it is pushed right away.
    const own = data.records[JSON.stringify([DEVICE_SOURCE + state.deviceId, 'value'])];
    const markerMissing = !(own && !own.deleted && own.value?.level >= SYNC_LEVEL);
    if (typeof TabManager !== 'undefined' && Array.isArray(sources['storage:tabs'])) TabManager.applySyncedState(sources['storage:tabs'], sources['storage:groups'], sources['storage:stacks']);
    if (typeof WorkspaceManager !== 'undefined') WorkspaceManager.reloadSyncedState?.();
    // Only conflicts this merge created. Counting every record that still
    // carried old variants repeated the toast on every sync (found 2026-09-29).
    // A restore copies records as they are and never creates one.
    const conflicts = restore ? 0 : Object.entries(merged.records).filter(([key, r]) => r.conflicts?.length > 1
      && JSON.stringify(r.conflicts) !== JSON.stringify(local.records[key]?.conflicts || [])).length;
    if (conflicts) window.showToast?.(conflicts === 1 ? '1 sync conflict retained in recovery data' : `${conflicts} sync conflicts retained in recovery data`);
    // Tell panels to re-read their state.
    window.dispatchEvent(new CustomEvent('vex-sync-data-applied'));
    return { markerMissing };
  }

  // ===== PUSH/PULL =====

  // A 409 means another device pushed since this one last pulled. The worker
  // refuses the push until we merge, so pull and try once more instead of
  // failing with "Push returned 409" (found 2026-09-29). Auto-push uses this too.
  async function pushNow() {
    if (privateWindow()) return { ok: false, reason: PRIVATE_OFF };
    const first = await pushOnce();
    if (!first.conflict) return first;
    const pulled = await pullNow();
    if (!pulled.ok) return { ok: false, reason: pulled.reason };
    const second = await pushOnce();
    if (second.conflict) {
      state.lastError = second.reason;
      stateChanged();
      window.dispatchEvent(new CustomEvent('vex-sync-status', { detail: { error: state.lastError } }));
      return { ok: false, reason: second.reason };
    }
    return second;
  }

  async function pushOnce() {
    if (pullBlocked) return { ok: false, reason: 'Recover cloud data with a successful pull before uploading changes' };
    if (!syncWorkerUrl()) {
      console.log('[Sync] not configured — skipping push');
      return { ok: false, reason: 'sync-not-configured' };
    }
    if (!state.enabled || state.syncing) return { ok: false, reason: 'not-ready' };
    state.syncing = true;
    stateChanged();
    // This push carries the marker; the one pullNow scheduled is not needed.
    if (markerTimer) { clearTimeout(markerTimer); markerTimer = null; }
    try {
      if (!recordDocument) recordDocument = await VexStorage.load('sync-records') || window.VexSyncRecords.empty();
      const data = await collectSyncData(await checkTileGate(recordDocument));
      const encryptedBlob = await SyncCrypto.encrypt(data, state.encryptionKey);
      const r = await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/sync/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.sessionToken}`
        },
        body: JSON.stringify({ encryptedBlob, updatedAt: new Date().toISOString(), baseRevision: revision })
      });
      if (r.status === 401) {
        // The Sync field now holding the AI worker's address is not this
        // device being removed: say it and keep the sign-in.
        const why = await wrongWorker(401, (await r.json().catch(() => ({}))).error);
        if (why) throw new Error(why);
        await signedOutByServer(); return { ok: false, reason: 'unauthorized' };
      }
      if (r.status === 409) return { ok: false, conflict: true, reason: 'Another device synced at the same moment — try again' };
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
      stateChanged();
      window.dispatchEvent(new CustomEvent('vex-sync-status', { detail: { error: state.lastError } }));
    }
  }

  async function pullNow({ restore = false } = {}) {
    if (privateWindow()) return { ok: false, reason: PRIVATE_OFF };
    if (!syncWorkerUrl()) {
      console.log('[Sync] not configured — skipping pull');
      return { ok: false, reason: 'sync-not-configured' };
    }
    if (!state.enabled || state.syncing) return { ok: false, reason: 'not-ready' };
    state.syncing = true;
    stateChanged();
    try {
      const r = await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/sync/pull`, {
        headers: { 'Authorization': `Bearer ${state.sessionToken}` }
      });
      if (r.status === 401 || r.status === 405) {
        const why = await wrongWorker(r.status, (await r.json().catch(() => ({}))).error);
        if (why) throw new Error(why);
        if (r.status === 401) { await signedOutByServer(); return { ok: false, reason: 'unauthorized' }; }
      }
      if (!r.ok) throw new Error('Pull returned ' + r.status);

      const result = await r.json();
      const receivedRevision = result.revision || 0;
      if (!Number.isSafeInteger(receivedRevision) || receivedRevision < 0) throw new Error('Invalid sync revision');
      const blob = result.encryptedBlob;
      if (!blob) {
        // The account is empty (new, or its data was lost while the sessions
        // survived). The next push starts from an empty document and this
        // device's own data; the stored copy of the old document would bring
        // back records, other clients' included, that nobody holds any more
        // (SYNC_PROTOCOL.md §6 rule 3).
        recordDocument = window.VexSyncRecords.empty();
        await VexStorage.save('sync-records', recordDocument);
        revision = receivedRevision;
        pullBlocked = false;
        state.lastPullAt = new Date().toISOString();
        await saveMetaToDisk();
        return { ok: true, empty: true };
      }
      pullBlocked = true;
      let decrypted;
      try { decrypted = await SyncCrypto.decrypt(blob, state.encryptionKey); }
      catch (err) {
        // AES-GCM rejects a wrong key as a bare "OperationError", which is what
        // a mistyped recovery code showed (found 2026-09-29).
        if (err?.name === 'OperationError') {
          console.error('[Sync] Pull failed: this key does not decrypt the cloud data');
          state.lastError = 'This key doesn’t unlock this account’s data';
          return { ok: false, badKey: true, reason: state.lastError };
        }
        throw err;
      }
      const applied = await applySyncData(decrypted, restore);
      // Only acknowledge a revision after its contents were decrypted and applied.
      // Otherwise a stale or damaged local key could overwrite unreadable cloud data.
      revision = receivedRevision;
      pullBlocked = false;
      state.lastPullAt = new Date().toISOString();
      state.lastError = null;
      await saveMetaToDisk();
      // Once this pull has finished (state.syncing is cleared in finally).
      // A push already under way (joining with a recovery code) carries the
      // marker too, and this one is then not needed.
      if (applied?.markerMissing) markerTimer = setTimeout(() => {
        markerTimer = null;
        pushNow().then((r) => {
          if (!r.ok && r.reason !== 'not-ready') console.error('[Sync] Could not tell the account this device is up to date again: ' + r.reason);
        });
      }, 0);
      return { ok: true };
    } catch (err) {
      console.error('[Sync] Pull failed:', err);
      state.lastError = err.message || String(err);
      return { ok: false, reason: state.lastError };
    } finally {
      state.syncing = false;
      stateChanged();
      window.dispatchEvent(new CustomEvent('vex-sync-status', { detail: { error: state.lastError } }));
    }
  }

  // ===== AUTO-SYNC =====

  function startAutoSync() {
    if (privateWindow()) return;
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
    if (markerTimer) clearTimeout(markerTimer);
    pushTimer = pullTimer = markerTimer = null;
  }

  // ===== DEVICES =====

  // Throws on failure. It used to swallow every error and return [], which the
  // settings panel then drew as "No devices yet." — a server that was down, a
  // revoked session and an account with genuinely no devices all looked the
  // same, and the one case that needs the user's attention looked like success.
  async function listDevices() {
    refuseInPrivate();
    if (!state.enabled) throw new Error('Sync is not signed in');
    requireSyncUrl();
    const r = await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/sync/devices`, {
      headers: { 'Authorization': `Bearer ${state.sessionToken}` }
    });
    if (r.status === 401) { await signedOutByServer(); throw new Error('This device is no longer enrolled — sign in again'); }
    if (!r.ok) throw new Error('Could not load your devices (server returned ' + r.status + ')');
    const data = await r.json().catch(() => null);
    if (!data || !Array.isArray(data.devices)) throw new Error('Could not load your devices (unexpected response)');
    return data.devices;
  }

  // Throws on failure, so "Device removed" is never shown for a request the
  // server refused.
  async function removeDevice(deviceId) {
    refuseInPrivate();
    if (!state.enabled) throw new Error('Sync is not signed in');
    requireSyncUrl();
    const r = await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/sync/devices/${deviceId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.sessionToken}` }
    });
    if (!r.ok) throw new Error('Could not remove that device (server returned ' + r.status + ')');
    return { ok: true };
  }

  // DELETE /sync/all drops the blob AND the device registry, so afterwards the
  // server's revision is back to 0 and this device is no longer enrolled.
  // Leaving `revision` at its old value made every later push fail the
  // baseRevision check with a 409 "Sync conflict" the user could not clear, and
  // the next authenticated call 401'd into a silent sign-out while the panel
  // still claimed to be signed in. So: reset the revision, drop the record
  // document, and sign out here where we can say so.
  async function wipeAllCloudData() {
    if (privateWindow()) return { ok: false, reason: PRIVATE_OFF };
    if (!state.enabled) return { ok: false, reason: 'Sync is not signed in' };
    if (!syncWorkerUrl()) return { ok: false, reason: 'sync-not-configured' };
    let r;
    try {
      r = await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/sync/all`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${state.sessionToken}` }
      });
    } catch (err) { return { ok: false, reason: err.message || String(err) }; }
    if (!r.ok) return { ok: false, reason: 'Server returned ' + r.status };
    revision = 0;
    recordDocument = null;
    await signOut();
    return { ok: true, signedOut: true };
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

  // A saved sign-in that cannot be used is said, not shown as a quiet "Not
  // signed in". Reading it could fail (Windows can no longer decrypt it), or
  // Vex could have been closed between saving the key and its details while
  // signing in (saveStateToDisk writes one, then the other), which left the
  // device signed out with no word on the next start (found 2026-10-09).
  function restoreFailed(why) {
    state.lastError = why;
    stateChanged();
    // Shown while Vex is still starting: long enough to be read.
    window.showToast?.(why + ' Sign in again in Settings › Vex Sync.', 'error', 15000);
  }

  async function initFromDisk() {
    if (privateWindow()) return false;
    let meta, keyHex;
    try {
      meta = await window.vex.syncLoadMeta();
      keyHex = await window.vex.syncLoadKey();
    } catch (err) {
      console.error('[Sync] Could not read the saved sign-in:', err);
      // Said in words, not as Electron's "Error invoking remote method …".
      const raw = String(err && err.message || err).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
      const reason = /decrypt/i.test(raw) ? 'Windows could not decrypt it' : raw;
      restoreFailed('Vex Sync could not read this device’s saved sign-in (' + reason + '), so it is signed out.');
      return false;
    }
    if (!meta && !keyHex) return false;
    if (!meta || !keyHex) {
      // Half a sign-in. A sign-in cut short leaves the key without its
      // details, and nothing was pushed with it (the first push comes after
      // both are saved), so the leftover is removed and nothing is lost.
      console.error('[Sync] The saved sign-in is incomplete (' + (meta ? 'no key' : 'no account details') + '); clearing it');
      await window.vex.syncClearState();
      restoreFailed('Vex Sync’s last sign-in did not finish (Vex was closed during it), so this device is signed out.');
      return false;
    }
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
      stateChanged();

      startAutoSync();
      // Kick off a pull shortly; don't block init.
      setTimeout(() => pullNow(), 1500);
      return true;
    } catch (err) {
      console.error('[Sync] Failed to restore state:', err);
      restoreFailed('Vex Sync could not use this device’s saved key (' + (err.message || String(err)) + '), so it is signed out.');
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

  // ===== DROP — cross-device tab handoff (SYNC_PROTOCOL.md §7) =====
  // The UI is js/handoff.js: Send to your devices, and the cards on the New
  // Tab page for tabs sent here.
  async function dropSend(url, title) {
    refuseInPrivate();
    if (!state.enabled || !state.sessionToken) {
      throw new Error('Sign in to Vex Sync first (Settings › Vex Sync)');
    }
    requireSyncUrl();
    if (!/^https?:$/.test(new URL(url).protocol)) throw new Error('Only web URLs can be sent');
    const encryptedBlob = await SyncCrypto.encrypt({ url: url.slice(0,2048), title: String(title || '').slice(0,300) }, state.encryptionKey);
    const r = await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/sync/drop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.sessionToken}` },
      body: JSON.stringify({ encryptedBlob })
    });
    if (r.status === 401) { await signedOutByServer(); throw new Error('This device is no longer enrolled — sign in again'); }
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || 'Send failed');
    }
    return await r.json();
  }

  // Fetching consumes the items on the server (§7), so the caller must keep
  // what this returns. Throws when the server could not be asked: it used to
  // answer [] for a down server, a refused session and an empty mailbox
  // alike, and a 401 here never signed the device out.
  async function dropFetch() {
    if (privateWindow()) return [];
    if (!state.enabled || !state.sessionToken || !syncWorkerUrl()) return [];
    const r = await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/sync/drop`, {
      headers: { 'Authorization': `Bearer ${state.sessionToken}` }
    });
    if (r.status === 401) { await signedOutByServer(); throw new Error('This device is no longer enrolled — sign in again'); }
    // A session that has not pushed or pulled yet may not read the mailbox
    // (§2.3); its first sync round opens it. Nothing has been consumed.
    if (r.status === 403) return [];
    if (!r.ok) throw new Error('Could not check for tabs sent from your other devices (server returned ' + r.status + ')');
    const d = await r.json().catch(() => null);
    if (!d || !Array.isArray(d.items)) throw new Error('Could not check for tabs sent from your other devices (unexpected response)');
    const items = [];
    for (const item of d.items) {
      if (!item || !item.encryptedBlob) continue;
      // One unreadable item used to throw out of the loop and lose every
      // other handed-off tab with it (found 2026-09-29). The server already
      // consumed them, so skip only the bad one and say so in the log.
      try {
        const payload = await SyncCrypto.decrypt(item.encryptedBlob, state.encryptionKey);
        if (typeof payload.url === 'string' && /^https?:$/.test(new URL(payload.url).protocol)) items.push({ ...item, url: payload.url, title: String(payload.title || '') });
        else console.error('[Sync] Skipped a handed-off tab that is not a web address');
      } catch (err) { console.error('[Sync] Skipped a handed-off tab that could not be read:', err); }
    }
    return items;
  }

  async function getRecoveryCode() {
    if (privateWindow()) return null;
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
    // Whether shortcut tiles synced on the last round, and which devices they
    // are waiting on (too old to understand them).
    tileSyncState: () => ({ open: tileGate.open, waitingOn: [...tileGate.waitingOn] }),
    isEnabled: () => state.enabled && !privateWindow(),
    // Settings and the sync indicator say so in a private window.
    offInThisWindow: () => (privateWindow() ? PRIVATE_OFF : ''),
    SYNC_KEYS
  };
})();

window.SyncEngine = SyncEngine;
