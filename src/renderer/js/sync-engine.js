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
    // Open tabs are not one list shared by every computer any more: each
    // device sends its own (TABS_SOURCE) and the others show them under
    // History › Tabs from other devices. A pull used to apply the shared list
    // to the open tabs, so a tab you were typing in was navigated away or
    // closed by another computer (found 2026-10-10).
    'vex.sessions', 'vex.workspaces', 'vex.shortcuts', 'vex.tools',
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
    'vex.forceDarkSites', 'vex.forceDarkHosts',
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
    // When History › Clear History last ran (an ISO time). Only recent history
    // syncs (HISTORY_SYNC_*), so a clear on one device reaches the older
    // visits other devices keep only through this.
    'vex.historyClearedAt',
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
  // Each device's open tabs, written by that device alone: { tabs: [{ url, title }] }.
  const TABS_SOURCE = 'sync:tabs:';
  const DEVICE_TABS_MAX = 100;
  // 1 = shortcut tiles and the New Tab grid (Vex 2.34.3). Raise it for the
  // next feature that must wait for every device, and compare against the
  // level that feature needs.
  // 2 = this device also copies every record it does not own exactly as it
  // found it (Vex 2.35.2 did already, but its level-1 marker cannot be told
  // from 2.34.3 to 2.35.1, which did not), writes the account revision it
  // last synced in its marker, drops a deleted record the account no longer
  // holds (another device cleared it away), and never writes a retired source
  // (SYNC_PROTOCOL.md §4.7). Deleted records and retired sources are cleared
  // out of the account only while every device on it is at level 2: they were
  // kept for ever, and the account grew until the server refused it (found
  // 2026-10-10).
  const SYNC_LEVEL = 2;
  const TILES_LEVEL = 1;
  const COMPACT_LEVEL = 2;
  let tileGate = { open: false, waitingOn: [] };
  let compactGate = { open: false, waitingOn: [], floor: 0 };
  // The account's device list as last read (checkTileGate).
  let knownDevices = [];
  // A device's name: the one it gave itself in its marker (renameDevice), else
  // the one the server was told when it signed in.
  function deviceName(deviceId, listed) {
    const marker = recordDocument?.records[JSON.stringify([DEVICE_SOURCE + deviceId, 'value'])];
    const own = marker && !marker.deleted && marker.value && typeof marker.value.name === 'string' ? cleanName(marker.value.name) : '';
    return own || (listed && typeof listed.deviceName === 'string' && listed.deviceName.trim()) || 'Another device';
  }

  // This device's name, chosen in Settings › Vex Sync. Kept on this device
  // (not synced) and sent in its marker, so it is encrypted like everything
  // else: the server keeps only the name given at sign-in, which was always
  // "Windows-" and four letters (found 2026-10-10).
  const NAME_KEY = 'vex.syncDeviceName';
  const cleanName = name => String(name == null ? '' : name).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  function thisDeviceName() {
    try { return cleanName(localStorage.getItem(NAME_KEY)); }
    catch (err) { console.error('[Sync] This device\'s name could not be read:', err.message); return ''; }
  }
  // The name a sign-in sends, remembered as this device's name.
  function signInName(asked) {
    const name = cleanName(asked) || thisDeviceName() || getDefaultDeviceName();
    localStorage.setItem(NAME_KEY, name);
    return name;
  }
  // Renames this device on every device on the account (on the next sync,
  // which this starts).
  async function renameDevice(name) {
    const clean = cleanName(name);
    if (!clean) throw new Error('Give this device a name');
    localStorage.setItem(NAME_KEY, clean);
    if (!state.enabled) return { ok: true };
    const pushed = await pushNow();
    if (!pushed.ok) throw new Error('Renamed here, but your other devices will see it only after the next sync: ' + pushed.reason);
    return { ok: true };
  }
  // A marker whose revision is older than this is written again even when
  // nothing else changed, so the other devices learn this one is up to date.
  // Not on every round: two devices would push each other's new revision back
  // and forth for ever.
  const MARKER_REFRESH_MS = 24 * 3600 * 1000;
  // Sources no current Vex reads or writes. Older desktops still send them
  // and newer ones carry them as they came; once every device is at level 2
  // they leave the account.
  const RETIRED_SOURCES = ['storage:history', 'storage:tabs', 'storage:groups', 'storage:stacks', 'preference:vex.autosleep', 'preference:vex.autosleepMinutes',
    'preference:vex.autosleepExcludePinned', 'preference:vex.customCommands', 'preference:vex.settings', 'preference:vex-theme'];
  // History syncs only its newest entries: a full 5,000-visit history was a
  // 3.8 MB upload, close to the server's 4 MiB limit (found 2026-10-10).
  // Visits older than this stay on the device that has them.
  const HISTORY_SYNC_MAX = 1000;
  const HISTORY_SYNC_DAYS = 90;

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
  // Deleted records this device has seen in the account, and the first
  // account revision it saw each in: { recordKey: revision }. A deleted record
  // may be cleared away once every device has synced that revision.
  let tombstones = null;
  async function seenTombstones() {
    if (!tombstones) {
      const saved = typeof VexStorage !== 'undefined' ? await VexStorage.load('sync-tombstones') : null;
      tombstones = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    }
    return tombstones;
  }
  // Notes the deleted records of `doc`, a document the account held at `rev`,
  // and forgets the ones `current` no longer has.
  async function noteTombstones(doc, rev, current) {
    const seen = await seenTombstones();
    let changed = false;
    for (const [key, record] of Object.entries(doc.records)) {
      if (record.deleted && seen[key] == null) { seen[key] = rev; changed = true; }
    }
    for (const key of Object.keys(seen)) {
      if (!current.records[key]?.deleted) { delete seen[key]; changed = true; }
    }
    if (changed) await VexStorage.save('sync-tombstones', seen);
  }
  // The document without the deleted records every device has synced past,
  // and without the retired sources. Only while every device is at level 2.
  function compactDocument(doc, floor, seen) {
    const records = {};
    for (const [key, record] of Object.entries(doc.records)) {
      if (RETIRED_SOURCES.includes(sourceOf(key))) continue;
      if (record.deleted && seen[key] != null && seen[key] <= floor) continue;
      records[key] = record;
    }
    return { schema: 2, records };
  }
  // The history this device sends: its newest visits, none older than
  // HISTORY_SYNC_DAYS. The list is kept in its own order.
  function historyWindow(list, now = Date.now()) {
    const since = now - HISTORY_SYNC_DAYS * 86400000;
    const time = entry => { const t = Date.parse(entry && entry.visitedAt); return Number.isFinite(t) ? t : 0; };
    const recent = list.filter(entry => time(entry) >= since);
    if (recent.length <= HISTORY_SYNC_MAX) return recent;
    const cut = new Set([...recent].sort((a, b) => time(b) - time(a)).slice(0, HISTORY_SYNC_MAX));
    return recent.filter(entry => cut.has(entry));
  }
  // The synced history, plus the visits this device keeps to itself because
  // they are older than what syncs, less everything before a Clear History
  // made on any device.
  function withOlderHistory(synced, local, clearedAt) {
    const ids = new Set(synced.map(entry => entry && entry.id));
    const recent = new Set(historyWindow([...synced, ...local.filter(entry => !ids.has(entry && entry.id))]));
    const older = local.filter(entry => entry && !ids.has(entry.id) && !recent.has(entry));
    const cleared = Date.parse(clearedAt);
    const after = entry => !Number.isFinite(cleared) || !(Date.parse(entry && entry.visitedAt) <= cleared);
    return [...synced, ...older].filter(after);
  }
  // The document the server holds at `revision`, as this device last saw it
  // (its own push, or a pull), in a form that ignores key order; null when
  // not known this session. A push that would send it again is not sent, and
  // a pull of the same revision is not applied again: every two minutes the
  // whole account (about 1 MB) was uploaded unchanged, and every pull
  // rewrote every store (found 2026-10-09).
  let server = null;
  const canonical = (value) => JSON.stringify(value, function (key, v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v;
  });
  // 'history' is not one: the file-store visit log was folded into
  // vex.history (main/history-fold.js), which syncs as a preference. A
  // storage:history an older desktop still sends is carried as it came
  // (ownsSource), never applied. Nor are 'tabs', 'groups' and 'stacks' any
  // more (TABS_SOURCE): an older desktop's shared tab list is carried the same way.
  const STORE_KEYS = ['settings', 'shortcuts', 'theme'];
  const preferenceKeys = () => SYNC_KEYS.filter(key => !STORE_KEYS.some(store => key === 'vex.' + store));

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
    // A new code starts the sign-in over.
    await cancelPendingJoin();
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
    await cancelPendingJoin();
    const r = await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/auth/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, deviceName: signInName(deviceName) })
    });
    if (!r.ok) throw await authFailure(r, 'Code verification failed');
    const data = await r.json();
    if (data.hasEncryptedData !== false) {
      // The account already has data, so this device must join it with the
      // recovery code. The session is kept for that: dropping it burned the
      // email code, and the user had to ask for a new one just to tick "I have
      // a recovery code" (found 2026-10-10). joinPending finishes the sign-in
      // with it; cancelPendingJoin (or ten minutes) removes it, since an
      // older server registered the device before answering (found 2026-09-29).
      setPendingJoin(email, data);
      return { ok: false, needsRecoveryCode: true };
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

  // A session verified for an account that already has data, waiting for the
  // recovery code (verifyCode). In memory only.
  let pendingJoin = null;
  function setPendingJoin(email, data) {
    clearPendingJoin();
    const timer = setTimeout(() => { cancelPendingJoin().catch(err => console.error('[Sync] Could not drop the unfinished sign-in:', err)); }, 10 * 60 * 1000);
    pendingJoin = { email, data, timer };
  }
  function clearPendingJoin() {
    if (pendingJoin) clearTimeout(pendingJoin.timer);
    pendingJoin = null;
  }
  // The sign-in was left (another address, a new code, ten minutes): the
  // session it holds is removed from the server.
  async function cancelPendingJoin() {
    const pending = pendingJoin;
    clearPendingJoin();
    if (pending) await forgetDevice(pending.data.sessionToken, pending.data.deviceId);
  }
  const pendingJoinFor = email => !!pendingJoin && pendingJoin.email === email;

  // Finishes the sign-in verifyCode started, with the recovery code, without
  // asking the server for the email code again.
  async function joinPending(recoveryCode) {
    refuseInPrivate();
    requireSyncUrl();
    if (!pendingJoin) throw new Error('This sign-in has expired — send a new code.');
    const cleanHex = SyncCrypto.parseRecoveryCode(recoveryCode);
    const cryptoKey = await SyncCrypto.importKey(SyncCrypto.hexToKey(cleanHex));
    const { email, data } = pendingJoin;
    clearPendingJoin();
    return joinWithSession(email, data, cleanHex, cryptoKey);
  }

  async function enrollWithRecoveryCode(email, code, recoveryCode, deviceName) {
    refuseInPrivate();
    requireSyncUrl();
    await cancelPendingJoin();
    const cleanHex = SyncCrypto.parseRecoveryCode(recoveryCode);
    const keyBytes = SyncCrypto.hexToKey(cleanHex);
    const cryptoKey = await SyncCrypto.importKey(keyBytes);
    const r = await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/auth/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, deviceName: signInName(deviceName) })
    });
    if (!r.ok) throw await authFailure(r, 'Code verification failed');
    const data = await r.json();
    return joinWithSession(email, data, cleanHex, cryptoKey);
  }

  async function joinWithSession(email, data, cleanHex, cryptoKey) {
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
    server = null;
    tileGate = { open: false, waitingOn: [] };
    compactGate = { open: false, waitingOn: [], floor: 0 };
    knownDevices = [];
    tombstones = null;
    if (typeof VexStorage !== 'undefined') { await VexStorage.save('sync-records', null); await VexStorage.save('sync-tiles-joined', null); await VexStorage.save('sync-known-devices', null); await VexStorage.save('sync-tombstones', null); }
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
    || source === TABS_SOURCE + state.deviceId
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

  // A device this one has not seen on the account before says so: the email
  // code alone is enough to sign a device in, and the first anyone heard of
  // one they did not sign in was their data changing (audit SY3,
  // 2026-10-10). The devices seen are kept per signed-in device; the first
  // list after signing in is only remembered, since every device on it is new
  // to this one. -> the devices that were new.
  const KNOWN_DEVICES = 'sync-known-devices';
  async function noticeNewDevices(devices) {
    const listed = devices.filter(d => d && typeof d.deviceId === 'string');
    const known = await VexStorage.load(KNOWN_DEVICES);
    const ids = listed.map(d => d.deviceId);
    if (!known || known.self !== state.deviceId || !Array.isArray(known.ids)) {
      await VexStorage.save(KNOWN_DEVICES, { self: state.deviceId, ids });
      return [];
    }
    const fresh = listed.filter(d => d.deviceId !== state.deviceId && !known.ids.includes(d.deviceId));
    if (ids.length !== known.ids.length || fresh.length) await VexStorage.save(KNOWN_DEVICES, { self: state.deviceId, ids });
    for (const d of fresh) {
      const name = String(d.deviceName || 'A device').slice(0, 60);
      const body = name + ' signed in to your sync account. If that was not you, remove it in Settings › Sync: whoever did it could read the sign-in code sent to your email.';
      window.showToast?.(body, 'info', 15000);
      try { await window.vex?.notify?.('A new device signed in to Vex Sync', body); }
      catch (err) { console.error('[Sync] Could not show the new-device notice:', err); }
    }
    return fresh;
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
    let compact = { open: false, waitingOn: [], floor: 0 };
    if (devices) {
      try { await noticeNewDevices(devices); }
      catch (err) { console.error('[Sync] Could not check for a new device on the account:', err); }
      knownDevices = devices.filter(d => d && typeof d.deviceId === 'string');
      const markerOf = d => {
        const marker = doc.records[JSON.stringify([DEVICE_SOURCE + d.deviceId, 'value'])];
        return marker && !marker.deleted && marker.value && typeof marker.value === 'object' ? marker.value : null;
      };
      const others = devices.filter(d => d && d.deviceId !== state.deviceId);
      waitingOn = others.filter(d => !(markerOf(d)?.level >= TILES_LEVEL)).map(d => d.deviceId);
      open = !waitingOn.length;
      // Clearing deleted records away waits for every device to be at level 2,
      // and goes no further than the oldest revision any of them has synced.
      const behind = others.filter(d => !(markerOf(d)?.level >= COMPACT_LEVEL && Number.isSafeInteger(markerOf(d).revision)));
      const floor = Math.min(revision, ...others.filter(d => !behind.includes(d)).map(d => markerOf(d).revision));
      compact = { open: !behind.length, waitingOn: behind.map(d => d.deviceId), floor };
    }
    tileGate = { open, waitingOn };
    compactGate = compact;
    const joined = await VexStorage.load('sync-tiles-joined') === state.deviceId;
    // Shut again (an older device joined): the next time it opens, this
    // device's tiles are added to the account's once more.
    if (!open && joined) await VexStorage.save('sync-tiles-joined', null);
    return { open, join: open && !joined, cloud: doc, compact };
  }

  // ===== DATA COLLECTION =====

  // The web pages open on this device, for the other devices' list: what the
  // saved session holds (no private, Tor or off-the-record tab), web
  // addresses only, at most DEVICE_TABS_MAX.
  async function openTabsToSync() {
    const saved = typeof TabManager !== 'undefined' && Array.isArray(TabManager.tabs)
      ? window.VexTabPolicy.snapshot(TabManager.tabs) : await VexStorage.load('tabs');
    if (!Array.isArray(saved)) return [];
    return saved.filter(tab => tab && /^https?:\/\//i.test(String(tab.url)) && window.VexDataContracts?.url(tab.url, true) !== false)
      .slice(0, DEVICE_TABS_MAX)
      .map(tab => ({ url: tab.url, title: String(tab.title || '').slice(0, 300) }));
  }

  // The tabs the other devices on the account have open, newest list first:
  // [{ deviceId, name, tabs: [{ url, title }] }]. From the last document this
  // device synced; nothing is fetched.
  function otherDeviceTabs() {
    if (!recordDocument || !state.deviceId) return [];
    const values = window.VexSyncRecords.values(recordDocument);
    const out = [];
    for (const [key, value] of Object.entries(values)) {
      const [source, kind] = JSON.parse(key);
      if (kind !== 'value' || !source.startsWith(TABS_SOURCE) || source === TABS_SOURCE + state.deviceId) continue;
      const deviceId = source.slice(TABS_SOURCE.length);
      const listed = knownDevices.find(d => d.deviceId === deviceId);
      // A device removed from the account is not shown.
      if (knownDevices.length && !listed) continue;
      const tabs = (value && Array.isArray(value.tabs) ? value.tabs : [])
        .filter(tab => tab && typeof tab.url === 'string' && /^https?:\/\//i.test(tab.url) && window.VexDataContracts?.url(tab.url, true) !== false)
        .map(tab => ({ url: tab.url, title: String(tab.title || tab.url).slice(0, 300) }));
      if (!tabs.length) continue;
      const at = recordDocument.records[key]?.at || 0;
      out.push({ deviceId, name: deviceName(deviceId, listed), tabs, at });
    }
    return out.sort((a, b) => b.at - a.at);
  }

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
        data['preference:' + key] = key === 'vex.history' ? historyWindow(list) : list;
      } else data['preference:' + key] = raw;
    }
    for (const key of STORE_KEYS) data['storage:' + key] = await VexStorage.load(key);
    data[TABS_SOURCE + state.deviceId] = { tabs: await openTabsToSync() };
    const records = window.VexSyncRecords;
    if (!recordDocument) recordDocument = await VexStorage.load('sync-records') || records.empty();
    const original = recordDocument;
    let before = recordDocument;
    if (gate.compact?.open) before = compactDocument(before, gate.compact.floor, await seenTombstones());
    // The marker says which account revision this device last synced. It is
    // written again only along with another change, or once a day (see
    // MARKER_REFRESH_MS); otherwise the one already in the account stays.
    const markerKey = JSON.stringify([DEVICE_SOURCE + state.deviceId, 'value']);
    const myName = thisDeviceName();
    const freshMarker = { level: SYNC_LEVEL, revision, ...(myName ? { name: myName } : {}) };
    const previous = before.records[markerKey];
    const keepMarker = !!previous && !previous.deleted && previous.value?.level === SYNC_LEVEL
      && Number.isSafeInteger(previous.value.revision) && (previous.value.name || '') === myName
      && Date.now() - (previous.at || 0) < MARKER_REFRESH_MS;
    data[DEVICE_SOURCE + state.deviceId] = keepMarker ? previous.value : freshMarker;
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
    const build = () => {
      const doc = records.capture(before, records.flatten(data), state.deviceId);
      // Records this device leaves exactly as it found them: everything it does
      // not own (ownsRecord), including the tiles while they wait for every
      // device to understand them. capture() marked them deleted, as it does
      // every record missing from its values; they go back unchanged, in place.
      for (const key of Object.keys(doc.records)) {
        if (ownsRecord(key, gate)) continue;
        if (!Object.hasOwn(before.records, key)) throw new Error('Sync tried to write a record it does not own: ' + key);
        doc.records[key] = before.records[key];
      }
      return doc;
    };
    let next = build();
    const changed = Object.keys(next.records).length !== Object.keys(original.records).length
      || Object.keys(next.records).some(key => next.records[key] !== original.records[key]);
    if (keepMarker && changed && previous.value.revision !== revision) {
      data[DEVICE_SOURCE + state.deviceId] = freshMarker;
      next = build();
    }
    recordDocument = next;
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
        sources['storage:' + key] = value;
      }
      data = records.capture(records.empty(), records.flatten(sources), 'legacy');
    }
    records.valid(data);
    const gate = await checkTileGate(data);
    // Read before anything is applied: the visits too old to sync stay here.
    let localHistory = [];
    try { const saved = JSON.parse(localStorage.getItem('vex.history') || '[]'); if (Array.isArray(saved)) localHistory = saved; }
    catch (err) { console.error('[Sync] This device’s history could not be read; only the synced history is kept:', err.message); }
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
    } else {
      // A deleted record this device saw in the account and the account no
      // longer has was cleared away by another device (compactDocument). It
      // goes here too, or this device's next push would bring it back.
      const seen = await seenTombstones();
      const mine = { schema: 2, records: { ...local.records } };
      for (const [key, record] of Object.entries(mine.records)) {
        if (record.deleted && seen[key] != null && !Object.hasOwn(data.records, key)) delete mine.records[key];
      }
      merged = records.merge(mine, data);
    }
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
    if (preferenceKeys().includes('vex.history') && ownsSource('preference:vex.history', gate)) {
      const synced = sources['preference:vex.history'];
      sources['preference:vex.history'] = withOlderHistory(Array.isArray(synced) ? synced : [], localHistory, sources['preference:vex.historyClearedAt']);
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
    if (typeof WorkspaceManager !== 'undefined') WorkspaceManager.reloadSyncedState?.();
    // Only conflicts this merge created. Counting every record that still
    // carried old variants repeated the toast on every sync (found 2026-09-29).
    // A restore copies records as they are and never creates one.
    const conflicts = restore ? 0 : Object.entries(merged.records).filter(([key, r]) => r.conflicts?.length > 1
      && JSON.stringify(r.conflicts) !== JSON.stringify(local.records[key]?.conflicts || [])).length;
    if (conflicts) window.showToast?.(conflicts === 1 ? '1 sync conflict retained in recovery data' : `${conflicts} sync conflicts retained in recovery data`);
    // Tell panels to re-read their state.
    window.dispatchEvent(new CustomEvent('vex-sync-data-applied'));
    return { markerMissing, cloud: data };
  }

  // ===== PUSH/PULL =====

  // A 409 means another device pushed since this one last pulled. The worker
  // refuses the push until we merge, so pull and try once more instead of
  // failing with "Push returned 409" (found 2026-09-29). Auto-push uses this too.
  // One push or pull at a time, in the order asked. The two timers start
  // together, and a pull asked while a push ran returned "not ready" and was
  // dropped, so every other pull was lost and another device's change could
  // take ten minutes to arrive (found 2026-10-09). A round asked while the
  // same kind is already waiting joins it rather than queueing a second.
  let queue = Promise.resolve();
  const waiting = {};
  function serial(kind, run) {
    if (waiting[kind]) return waiting[kind];
    const round = queue.then(() => { waiting[kind] = null; return run(); });
    waiting[kind] = round;
    queue = round.catch(() => {});
    return round;
  }
  const pushNow = () => serial('push', pushRound);
  const pullNow = (options = {}) => serial(options.restore ? 'restore' : 'pull', () => pullRound(options));

  async function pushRound() {
    if (privateWindow()) return { ok: false, reason: PRIVATE_OFF };
    const first = await pushOnce();
    if (!first.conflict) return first;
    const pulled = await pullRound();
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
      const text = canonical(data);
      // Nothing changed since the server got this document: nothing to send.
      if (server && server.revision === revision && server.text === text) return { ok: true, unchanged: true };
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
      // The server takes at most 4 MiB in one upload (SYNC_PROTOCOL.md §1.2).
      if (r.status === 413) throw new Error('Your synced data is too big for the sync server (over 4 MB), so nothing was uploaded. Deleting notes or bookmarks you no longer need makes it smaller.');
      if (!r.ok) throw new Error('Push returned ' + r.status);
      revision = (await r.json()).revision;
      server = { revision, text };
      await noteTombstones(data, revision, data);
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

  async function pullRound({ restore = false } = {}) {
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
      // The revision this device already has: the same document it pushed or
      // applied, so there is nothing new to apply (and nothing to rewrite).
      if (blob && !restore && server && recordDocument && receivedRevision === server.revision && receivedRevision === revision) {
        pullBlocked = false;
        state.lastPullAt = new Date().toISOString();
        state.lastError = null;
        await saveMetaToDisk();
        return { ok: true, unchanged: true };
      }
      if (!blob) {
        // The account is empty (new, or its data was lost while the sessions
        // survived). The next push starts from an empty document and this
        // device's own data; the stored copy of the old document would bring
        // back records, other clients' included, that nobody holds any more
        // (SYNC_PROTOCOL.md §6 rule 3).
        recordDocument = window.VexSyncRecords.empty();
        await VexStorage.save('sync-records', recordDocument);
        tombstones = {};
        await VexStorage.save('sync-tombstones', tombstones);
        revision = receivedRevision;
        server = { revision, text: canonical(recordDocument) };
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
      let applied;
      applying = true;
      try { applied = await applySyncData(decrypted, restore); }
      finally { applying = false; }
      // Only acknowledge a revision after its contents were decrypted and applied.
      // Otherwise a stale or damaged local key could overwrite unreadable cloud data.
      revision = receivedRevision;
      server = { revision, text: canonical(decrypted) };
      if (applied?.cloud) await noteTombstones(applied.cloud, revision, recordDocument);
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

  // A change to something synced goes up about this long after it is made,
  // not on the next two-minute round (found 2026-10-10): a bookmark added just
  // before closing the laptop never reached the phone. Several changes in a
  // row make one upload.
  const CHANGE_PUSH_MS = 5000;
  let changeTimer = null;
  // Set while a pull writes what it brought: those writes are not changes to
  // send back.
  let applying = false;
  function changed(isSynced) {
    if (applying || !state.enabled || privateWindow() || !syncWorkerUrl() || !isSynced) return;
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      changeTimer = null;
      pushNow().then((r) => {
        if (!r.ok && r.reason !== 'not-ready') console.error('[Sync] Could not upload a change: ' + r.reason);
      });
    }, CHANGE_PUSH_MS);
  }
  const syncedPreference = key => preferenceKeys().includes(key) || TILE_LISTS.includes(key);
  function watchChanges() {
    if (typeof PersistentStorage !== 'undefined') PersistentStorage.onChange = key => changed(syncedPreference(String(key)));
    if (typeof VexStorage !== 'undefined') VexStorage.onChange = key => changed(STORE_KEYS.includes(String(key)));
  }
  // The window is closing (js/storage.js): one last upload, so the change made
  // a moment ago and this device's open tabs reach the other devices. At most
  // a few seconds; closing never waits on the network for longer, and a
  // failure is logged, not raised.
  const CLOSE_PUSH_MS = 4000;
  async function pushBeforeClose() {
    clearTimeout(changeTimer); changeTimer = null;
    if (!state.enabled || privateWindow() || !syncWorkerUrl()) return { ok: false, reason: 'off' };
    let timer;
    const late = new Promise(resolve => { timer = setTimeout(() => resolve({ ok: false, reason: 'still uploading when the window closed' }), CLOSE_PUSH_MS); });
    const result = await Promise.race([pushNow().catch(err => ({ ok: false, reason: err.message || String(err) })), late]);
    clearTimeout(timer);
    if (!result.ok) console.error('[Sync] The last upload before closing did not finish: ' + result.reason);
    return result;
  }

  function startAutoSync() {
    if (privateWindow()) return;
    stopAutoSync();
    if (!syncWorkerUrl()) {
      console.log('[Sync] not configured — no push/pull timers started');
      return;
    }
    pushTimer = setInterval(() => pushNow(), 2 * 60 * 1000);
    pullTimer = setInterval(() => pullNow(), 5 * 60 * 1000);
    watchChanges();
  }

  function stopAutoSync() {
    if (pushTimer) clearInterval(pushTimer);
    if (pullTimer) clearInterval(pullTimer);
    if (markerTimer) clearTimeout(markerTimer);
    clearTimeout(changeTimer);
    pushTimer = pullTimer = markerTimer = changeTimer = null;
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
    server = null;
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
    joinPending,
    cancelPendingJoin,
    pendingJoinFor,
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
    // Whether deleted records are being cleared out of the account, and which
    // devices that waits on (an older Vex, or the phone).
    cleanupState: () => ({ open: compactGate.open, waitingOn: [...compactGate.waitingOn] }),
    otherDeviceTabs,
    pushBeforeClose,
    renameDevice,
    thisDeviceName: () => thisDeviceName() || getDefaultDeviceName(),
    // The name to show for a device in the list: its own choice, else the server's.
    nameOf: (device) => (device && device.deviceId === state.deviceId && thisDeviceName()) || deviceName(device && device.deviceId, device),
    isEnabled: () => state.enabled && !privateWindow(),
    // Settings and the sync indicator say so in a private window.
    offInThisWindow: () => (privateWindow() ? PRIVATE_OFF : ''),
    SYNC_KEYS,
    LIST_PREFERENCES
  };
})();

window.SyncEngine = SyncEngine;
