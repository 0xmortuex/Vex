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
    // Tab layout (horizontal vs vertical). A browser look decides the layout
    // itself (SettingsUI.resolveTabLayout); the look travels too (below), so
    // every device resolves the same way.
    'vex.tabLayout',
    // The browser look and its colours (js/gui-style.js), the skin
    // (js/skins.js), the interface and code fonts (js/fonts.js), and the
    // reading aids (js/accessibility.js): choices about how Vex looks to you,
    // not about the screen. They stayed on each device while the theme and the
    // tab layout travelled, so a second computer showed the theme in another
    // look (found 2026-10-10). The interface size and spacing (vex.uiScale,
    // vex.uiDensity) stay per device: they depend on the screen. The copies
    // kept for the New Tab page (vex.lookName, vex.lookPalette, vex.fontCss)
    // are rebuilt on each device.
    'vex.guiStyle', 'vex.guiColors',
    'vex.skinPattern', 'vex.skinShape', 'vex.skinGlow', 'vex.skinStrength',
    'vex.font', 'vex.fontMono',
    'vex.a11y',
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
    // Sites never offered a password save (js/passwords.js), and the sites an
    // authenticator code is or is not filled on (js/totp-autofill.js). They
    // travel with the passwords and the authenticator accounts (SYNC_TYPES).
    'vex.pwNever', 'vex.totpSites',
    // The reading queue (js/readlater.js). Off until chosen (SYNC_TYPES,
    // readingQueue); items from a tab with a session of its own, and from
    // sensitive sites, stay on the device (js/live-session.js).
    'vex.readLater',
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
    'vex.customThemes',
    // Sites never offered a password save: host names, like vex.forceDarkHosts.
    'vex.pwNever',
    'vex.readLater'];

  // Settings › Vex Sync › Choose what to sync. Each kind of data can be left
  // out on this device; there was no way to keep, say, history or AI memory
  // on one computer only (found 2026-10-10). The choice is this device's own
  // (CHOICES_KEY, not synced). What a device leaves out it neither sends nor
  // applies: the account's copy is carried as it came, as for a source a
  // newer Vex added, and this device's own copy stays as it is.
  const SYNC_TYPES = [
    { id: 'bookmarks', label: 'Bookmarks', keys: ['vex.bookmarks'] },
    { id: 'history', label: 'History', keys: ['vex.history', 'vex.historyClearedAt'] },
    { id: 'tabs', label: 'Open tabs, sessions and workspaces', keys: ['vex.sessions', 'vex.workspaces', 'vex.autoGroupSuggest', 'vex.autoAddToGroups', 'vex.groupPatterns'] },
    { id: 'notes', label: 'Notes', keys: ['vex.notes'] },
    { id: 'shortcuts', label: 'Shortcut tiles and tools', keys: ['vex.shortcuts', 'vex.startTiles', 'vex.tools'] },
    { id: 'reminders', label: 'Reminders and scheduled tasks', keys: ['vex.reminders', 'vex.schedules'] },
    { id: 'ai', label: 'AI settings, personas and memory', keys: ['vex.agentMode', 'vex.aiIndexingEnabled', 'vex.aiRouting', 'vex.preferLocalAI', 'vex.forceCloudAI', 'vex.personas', 'vex.activePersona', 'vex.aiMemory'] },
    { id: 'look', label: 'Themes, look and fonts', keys: ['vex.theme', 'vex.themeAuto', 'vex.customThemes', 'vex.tabLayout',
      'vex.guiStyle', 'vex.guiColors', 'vex.skinPattern', 'vex.skinShape', 'vex.skinGlow', 'vex.skinStrength', 'vex.font', 'vex.fontMono'] },
    // Saved passwords and authenticator (2FA) accounts. Off until the person
    // turns them on, on each device (OFF_UNLESS_CHOSEN), after Vex asks again
    // (the Vex PIN if set). The main process seals each one with a key
    // derived from the sync key, so this window carries only sealed items
    // (SECRET_SOURCES, main/sync-secrets.js).
    { id: 'passwords', label: 'Passwords', keys: ['vex.pwNever'], secret: true },
    { id: 'authenticator', label: 'Authenticator (2FA codes)', keys: ['vex.totpSites'], secret: true },
    // Passkeys Vex keeps (main/passkeys.js): only those made while this was on.
    { id: 'passkeys', label: 'Passkeys', keys: [], secret: true },
    // One browser across devices (docs/SYNC_PROTOCOL.md §4.10). Both are off
    // until the person turns them on, on each device (optIn): nothing about
    // an open tab beyond its address and title, and no reading queue, leaves
    // a device that has not asked for it. `liveTabs` adds the page icon, the
    // group, pinned, where you were and when it was last used to this
    // device's open-tab list (the Devices view); it has no records of its own.
    { id: 'liveTabs', label: 'Live tabs for the Devices view (icons, groups, pinned, last used)', keys: [], optIn: true },
    { id: 'readingQueue', label: 'Reading queue (Read Later)', keys: ['vex.readLater'], optIn: true },
    // Everything else: site lists, zoom, auto-sleep, keyboard shortcuts...
    { id: 'settings', label: 'Other settings', keys: [] },
  ];
  const OFF_UNLESS_CHOSEN = SYNC_TYPES.filter(t => t.secret || t.optIn).map(t => t.id);
  // The sealed lists: { id, t, s } per saved login or authenticator account
  // (SYNC_PROTOCOL.md §4.9).
  const SECRET_SOURCES = { 'secret:passwords': 'passwords', 'secret:authenticator': 'authenticator', 'secret:passkeys': 'passkeys' };
  const secretSource = source => Object.hasOwn(SECRET_SOURCES, source);
  // How every record key of a sealed list begins (JSON.stringify of the key).
  const SECRET_KEY_START = '["secret:';
  const CHOICES_KEY = 'vex.syncChoices';
  // Kinds turned back on whose first pull has not happened yet (CHOICES_KEY).
  const REJOIN_KEY = 'vex.syncRejoin';
  function readJson(key, fallback) {
    let raw = null;
    try { raw = localStorage.getItem(key); } catch (err) { console.error('[Sync] ' + key + ' could not be read:', err.message); }
    if (raw == null) return fallback;
    try { return JSON.parse(raw); }
    catch (err) { console.error('[Sync] ' + key + ' is not readable; using the default:', err.message); return fallback; }
  }
  function typeOfSource(source) {
    if (secretSource(source)) return SECRET_SOURCES[source];
    if (source.startsWith('sync:tabs:')) return 'tabs';
    if (source === 'storage:theme') return 'look';
    const key = source.startsWith('preference:') ? source.slice(11) : null;
    const type = key && SYNC_TYPES.find(t => t.keys.includes(key));
    return type ? type.id : 'settings';
  }
  function typeOn(id) {
    const choices = readJson(CHOICES_KEY, {});
    const choice = choices && typeof choices === 'object' ? choices[id] : undefined;
    return OFF_UNLESS_CHOSEN.includes(id) ? choice === true : choice !== false;
  }
  const secretsOn = () => SYNC_TYPES.some(t => t.secret && typeOn(t.id));
  // While Vex is locked, nothing syncs on a device that syncs passwords or
  // the authenticator: main refuses them then, and the rest waits with them,
  // so the account never gets half a round. What changed goes up on unlock.
  const LOCKED_WAIT = 'Vex is locked — syncing resumes when you unlock it';
  const waitForUnlock = () => secretsOn() && !!(typeof window !== 'undefined' && window.VexLock && window.VexLock.locked && window.VexLock.locked());
  function rejoining() {
    const list = readJson(REJOIN_KEY, []);
    return Array.isArray(list) ? list.filter(id => typeof id === 'string') : [];
  }

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

  // ===== PROOF OF THE SYNC KEY (SYNC_PROTOCOL.md §2.7) =====
  // One sync email code was enough to overwrite or erase the encrypted
  // account (audit SY3, 2026-10-10). A push or wipe now carries an HMAC over
  // a one-time nonce, keyed by `authKey` (derived from the sync key; the sync
  // key itself never leaves this device). The first proof locks the account
  // to that key.
  let authKey = null;
  // What this device last heard: 'on' (locked since `since`), 'off' (not yet:
  // the next upload locks it), 'unsupported' (a server from before the check).
  let keyLock = { state: null, since: null };
  function setKeyLock(next, since = null) {
    if (keyLock.state === next && keyLock.since === since) return;
    keyLock = { state: next, since };
    stateChanged();
  }
  // -> { headers } to add to the request, or { refused: <the 401 response> }.
  async function proofHeaders(action, details) {
    if (!authKey) throw new Error('This device has no sync key loaded — sign in again');
    const r = await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/sync/challenge`, {
      headers: { 'Authorization': `Bearer ${state.sessionToken}` }
    });
    if (r.status === 401) return { refused: r };
    const body = await r.json().catch(() => null);
    // A server from before the key check has no /sync/challenge: 404, or this
    // 403 for a session that has not synced yet. It takes requests without a
    // proof, and Settings › Vex Sync says the account is not protected.
    if (r.status === 404 || (r.status === 403 && body && body.error === 'This device has not synced yet')) {
      setKeyLock('unsupported');
      return { headers: {} };
    }
    // The AI worker's address in the Sync field answers a GET with 405.
    const why = r.ok ? null : await wrongWorker(r.status, body && body.error);
    if (why) throw new Error(why);
    if (!r.ok || !body || typeof body.nonce !== 'string') throw new Error((body && body.error) || 'Could not start the sync key check (server returned ' + r.status + ')');
    const headers = { 'X-Vex-Proof': body.nonce + '.' + await SyncCrypto.proof(authKey, body.nonce, state.deviceId, action, details) };
    // No lock yet: this proof sets it (trust on first use).
    if (!body.keyCheck) headers['X-Vex-Auth-Key'] = authKey;
    else setKeyLock('on', body.keyCheck.setAt || null);
    return { headers };
  }
  // The server set the lock from this device's proof.
  function lockedByThisDevice() {
    setKeyLock('on', new Date().toISOString());
    window.showToast?.('Your sync account is now locked to your sync key: a sign-in code alone can no longer change it. It can still erase it to start over, which signs every device out and emails you. Devices on an older Vex can still download your data, but must be updated to upload.', 'info', 15000);
  }

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
  // A feature whose data the person set to "never sync" in Settings > Storage (js/storage-ledger.js)
  // is dropped here: the choice can only hold a key back, it never adds one.
  const preferenceKeys = () => SYNC_KEYS.filter(key => !STORE_KEYS.some(store => key === 'vex.' + store)
    && (typeof VexStorageLedger === 'undefined' || VexStorageLedger.syncAllowed(key))
    // A staged feature (switched off, waiting for the person) and an experimental one are neither pushed nor pulled.
    && (typeof VexRegistry === 'undefined' || !VexRegistry.syncHeld(key)));

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
    return createAccount(email, data);
  }

  // A new account on this session: a new key, and the first push, which also
  // locks the account to that key (SYNC_PROTOCOL.md §2.7).
  async function createAccount(email, data) {
    const cryptoKey = await SyncCrypto.generateKey();
    const keyBytes = await SyncCrypto.exportKey(cryptoKey);
    const keyHex = SyncCrypto.keyToHex(keyBytes);
    authKey = await SyncCrypto.authKeyHex(keyBytes);

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

  // The recovery code is lost on every device: erase the account on the
  // server and start a new one here, on the sign-in verifyCode just made (the
  // server takes it only from a sign-in at most ten minutes old). The caller
  // asks the user to confirm first. Every other device is signed out; data on
  // the devices stays.
  const RESET_CONFIRM = 'erase my synced data';
  async function startOver() {
    refuseInPrivate();
    requireSyncUrl();
    if (!pendingJoin) throw new Error('This sign-in has expired — send a new code.');
    const { email, data } = pendingJoin;
    clearPendingJoin();
    const r = await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/sync/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${data.sessionToken}` },
      // The address, for the email the server sends afterwards (SYNC_PROTOCOL.md §2.9).
      body: JSON.stringify({ confirm: RESET_CONFIRM, email })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      await forgetDevice(data.sessionToken, data.deviceId);
      // A server from before the key check has no /sync/reset (a session that
      // has not synced gets this 403 for any path it does not know).
      if (r.status === 403 && err.error === 'This device has not synced yet') throw new Error('Your sync server is too old to start over. Redeploy the sync worker (SELF_HOSTING.md), then try again.');
      throw new Error(err.error || 'Could not start over (server returned ' + r.status + ')');
    }
    return createAccount(email, data);
  }

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
    authKey = await SyncCrypto.authKeyHex(SyncCrypto.hexToKey(cleanHex));
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
    authKey = null;
    keyLock = { state: null, since: null };
    localStorage.removeItem(REJOIN_KEY);
    if (typeof VexStorage !== 'undefined') { await VexStorage.save('sync-records', null); await VexStorage.save('sync-tiles-joined', null); await VexStorage.save('sync-known-devices', null); await VexStorage.save('sync-tombstones', null); await VexStorage.save(OFF_BASE, null); }
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
    || ((source === TABS_SOURCE + state.deviceId
      || preferenceKeys().some(key => source === 'preference:' + key)
      || STORE_KEYS.some(key => source === 'storage:' + key)
      || secretSource(source)
      || (gate.open && TILE_SOURCES.includes(source)))
      && chosen(source, gate));
  // Whether this device sends and applies `source` now (Choose what to sync).
  // A kind just turned back on is joined on the next pull (applySyncData), not
  // by a push: its copy here may lack what other devices added meanwhile, and
  // sent as it is, that would delete it from every device.
  const chosen = (source, gate) => {
    const type = typeOfSource(source);
    return typeOn(type) && (gate.rejoin === true || TILE_SOURCES.includes(source) || !rejoining().includes(type));
  };
  // Tiles sync when every device understands them and this device syncs them.
  const tilesSync = gate => gate.open && typeOn('shortcuts');
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
  // What may leave this device (js/live-session.js shareableTab): not a
  // private, Tor or routed tab, not a sensitive site, not an address with a
  // password or token in it.
  const sensitiveHosts = () => {
    const list = readJson('vex.liveSensitiveHosts', []);
    return Array.isArray(list) ? list.filter(h => typeof h === 'string').slice(0, 200) : [];
  };
  const shareCtx = () => ({
    privateWindow: !!(window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow),
    isRouted: partition => !!(window.VexTabPolicy && window.VexTabPolicy.isRouted(partition)),
    extraHosts: sensitiveHosts(),
  });
  async function openTabsToSync() {
    const saved = typeof TabManager !== 'undefined' && Array.isArray(TabManager.tabs)
      ? window.VexTabPolicy.snapshot(TabManager.tabs) : await VexStorage.load('tabs');
    if (!Array.isArray(saved)) return [];
    const live = window.VexLiveSession;
    const ctx = shareCtx();
    return saved.filter(tab => tab && /^https?:\/\//i.test(String(tab.url)) && window.VexDataContracts?.url(tab.url, true) !== false
      && (!live || live.shareableTab(tab, ctx)))
      .slice(0, DEVICE_TABS_MAX)
      .map(tab => ({ url: tab.url, title: String(tab.title || '').slice(0, 300) }));
  }

  // This device's value of sync:tabs:<id>. Version 1 ({ tabs: [{ url, title }] })
  // unless Live tabs is on; then version 2, a superset of it (SYNC_PROTOCOL.md
  // §4.10): the page icon, group, pinned, where you were, when it was last used,
  // a clock and tombstones for tabs closed since, capped at 24 KB.
  async function ownTabsValue() {
    const legacy = { tabs: await openTabsToSync() };
    const live = window.VexLiveSession;
    if (!live || !typeOn('liveTabs') || typeof TabManager === 'undefined' || !Array.isArray(TabManager.tabs)) return legacy;
    const key = JSON.stringify([TABS_SOURCE + state.deviceId, 'value']);
    const previous = recordDocument && recordDocument.records[key] && !recordDocument.records[key].deleted ? recordDocument.records[key].value : null;
    const groups = Array.isArray(TabManager.groups) ? TabManager.groups : [];
    const snapshot = live.buildSnapshot(TabManager.tabs, {
      ...shareCtx(), prev: previous, now: Date.now(), node: state.deviceId, activeId: TabManager.activeTabId,
      groupName: id => (groups.find(g => g && g.id === id) || {}).name || '',
    });
    // A device that was last seen by a clock far ahead of this one's: keep
    // this device's clock from falling behind what the account has seen.
    return { ...snapshot, tabs: snapshot.tabs.slice(0, DEVICE_TABS_MAX) };
  }

  // The Devices view (js/devices-view.js): every device on the account, with
  // its tabs, from the last document this device synced; nothing is fetched.
  // `listed` is the server's device list as last read.
  function devicesView(now = Date.now()) {
    const live = window.VexLiveSession;
    if (!live || !recordDocument || !state.deviceId) return [];
    const snapshots = {};
    const values = window.VexSyncRecords.values(recordDocument);
    for (const [key, value] of Object.entries(values)) {
      const [source, kind] = JSON.parse(key);
      if (kind === 'value' && source.startsWith(TABS_SOURCE)) snapshots[source.slice(TABS_SOURCE.length)] = value;
    }
    const names = {};
    for (const id of Object.keys(snapshots)) names[id] = deviceName(id, knownDevices.find(d => d.deviceId === id));
    for (const d of knownDevices) if (!(d.deviceId in names)) names[d.deviceId] = deviceName(d.deviceId, d);
    return live.devicesView({ listed: knownDevices, snapshots, names, selfId: state.deviceId, now, extraHosts: sensitiveHosts() });
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

  // A record of a kind being joined again (tiles have a join of their own).
  const rejoinsRecord = (key, rejoin) => {
    const source = sourceOf(key);
    return !TILE_SOURCES.includes(source) && rejoin.includes(typeOfSource(source));
  };

  // What a kind held on this device when it was turned off, per kind:
  // { id: { recordKey: value } } (setTypeSynced, keepEditsMadeWhileOff).
  const OFF_BASE = 'sync-off-base';
  // A kind turned back on: for each record `joins(key)`, this device's copy
  // (`local`) that differs from what it held when the kind was turned off
  // (`before`, { key: value }) was changed here meanwhile. Where the account
  // (`data`) holds another version, the account's stays in use in `merged`
  // and this device's is kept as a conflict to pick in Settings › Vex Sync.
  // The clock moves past the account's, so every device takes the record as
  // it is. -> how many.
  const itemOf = (key, value) => (JSON.parse(key)[1] === 'item' && value && typeof value === 'object' ? value.item : value);
  function keepEditsMadeWhileOff(merged, local, data, before, joins) {
    let kept = 0;
    for (const [key, mine] of Object.entries(local.records)) {
      if (!joins(key) || JSON.parse(key)[1] === 'type' || mine.deleted || !Object.hasOwn(before, key)) continue;
      const account = data.records[key];
      if (!account) continue;
      const same = (a, b) => JSON.stringify(itemOf(key, a)) === JSON.stringify(itemOf(key, b));
      if (same(mine.value, before[key]) || (!account.deleted && same(mine.value, account.value))) continue;
      const clock = { ...account.clock, [state.deviceId]: (account.clock[state.deviceId] || 0) + 1 };
      merged.records[key] = { ...account, clock, conflicts: [{ deleted: account.deleted, value: account.value, at: account.at }, { deleted: false, value: mine.value, at: mine.at }] };
      kept++;
    }
    return kept;
  }

  async function collectSyncData(gate = { open: false }) {
    if (typeof TabManager !== 'undefined') await TabManager.persistTabs();
    if (typeof PersistentStorage !== 'undefined') await PersistentStorage._flush();
    const data = {};
    for (const key of preferenceKeys()) {
      if (!ownsSource('preference:' + key, gate)) continue;
      const raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) continue;
      // Store the raw string so values round-trip byte-for-byte.
      if (LIST_PREFERENCES.includes(key)) {
        let list;
        try { list = JSON.parse(raw); } catch { throw new Error('Invalid ' + key.slice(4) + ' data'); }
        // Sent as anything but a list, every other device would refuse it
        // ("Invalid synced list"); refuse it here, on the device that has it.
        if (!Array.isArray(list)) throw new Error('Invalid ' + key.slice(4) + ' data');
        if (key === 'vex.readLater' && window.VexLiveSession) list = window.VexLiveSession.readingQueueForSync(list, sensitiveHosts()).send;
        data['preference:' + key] = key === 'vex.history' ? historyWindow(list) : list;
      } else data['preference:' + key] = raw;
    }
    for (const key of STORE_KEYS) if (ownsSource('storage:' + key, gate)) data['storage:' + key] = await VexStorage.load(key);
    // Saved passwords and authenticator accounts, sealed by main.
    const secretKinds = Object.entries(SECRET_SOURCES).filter(([source]) => ownsSource(source, gate)).map(([, kind]) => kind);
    if (secretKinds.length) {
      if (!window.vex || typeof window.vex.syncSecretsSeal !== 'function') throw new Error('This window cannot reach saved passwords to sync them');
      const sealed = await window.vex.syncSecretsSeal(secretKinds);
      for (const [source, kind] of Object.entries(SECRET_SOURCES)) if (secretKinds.includes(kind)) data[source] = sealedItems(sealed && sealed[kind], kind);
    }
    if (ownsSource(TABS_SOURCE + state.deviceId, gate)) data[TABS_SOURCE + state.deviceId] = await ownTabsValue();
    const records = window.VexSyncRecords;
    if (!recordDocument) recordDocument = await VexStorage.load('sync-records') || records.empty();
    const original = recordDocument;
    let before = recordDocument;
    if (gate.compact?.open) before = compactDocument(before, gate.compact.floor, await seenTombstones());
    // A kind turned back on (applySyncData joins it): this device's copy is
    // captured as new records, not against the account's records it carried
    // while the kind was off, which would mark everything it lacks deleted.
    const rejoin = gate.rejoin === true ? rejoining() : [];
    if (rejoin.length) before = { schema: 2, records: Object.fromEntries(Object.entries(before.records).filter(([key]) => !rejoinsRecord(key, rejoin))) };
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
    if (tilesSync(gate)) {
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
      const doc = records.capture(before, secretFlat(records.flatten(data)), state.deviceId);
      // A sealed item changed here carries the time it was changed (its own
      // updatedAt), so of two devices' changes to one login the newer wins.
      for (const [key, record] of Object.entries(doc.records)) {
        if (record === before.records[key] || record.deleted || !key.startsWith(SECRET_KEY_START) || !secretSource(sourceOf(key))) continue;
        const t = record.value && record.value.item && record.value.item.t;
        if (Number.isSafeInteger(t) && t > 0) doc.records[key] = { ...record, at: t };
      }
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
    if (gate.join && tilesSync(gate)) await VexStorage.save('sync-tiles-joined', state.deviceId);
    return recordDocument;
  }

  // A sealed list as main hands it over or a merge yields it: [{ id, t, s }].
  function sealedItems(list, kind) {
    const ok = item => item && typeof item === 'object' && typeof item.id === 'string' && /^[a-f0-9]{32}$/.test(item.id)
      && Number.isSafeInteger(item.t) && item.t >= 0 && typeof item.s === 'string' && item.s.length > 0 && item.s.length <= 65536;
    if (!Array.isArray(list) || !list.every(ok)) throw new Error('Invalid synced ' + kind);
    return list.map(({ id, t, s }) => ({ id, t, s }));
  }
  // Sealed items keep index 0: they are kept sorted by id, and a position
  // would make every later item change when one is added.
  function secretFlat(flat) {
    for (const key of Object.keys(flat)) {
      if (!key.startsWith(SECRET_KEY_START)) continue;
      const [source, kind] = JSON.parse(key);
      if (kind === 'item' && secretSource(source)) flat[key] = { index: 0, item: flat[key].item };
    }
    return flat;
  }
  // Joining (a recovery code, or the kind just turned on): a saved login or
  // authenticator account both sides hold is merged, the newer change winning
  // and the other kept for Sync conflicts, instead of the account's copy
  // replacing this device's newer password. One this device holds that the
  // account deleted is kept: a join never removes a saved password.
  function joinSecrets(merged, local, cloud, pick) {
    const records = window.VexSyncRecords;
    for (const [key, mine] of Object.entries(local.records)) {
      if (!pick(key) || !secretSource(sourceOf(key)) || JSON.parse(key)[1] !== 'item' || mine.deleted) continue;
      const theirs = cloud.records[key];
      if (!theirs) continue;
      if (theirs.deleted) {
        const clock = { ...theirs.clock };
        for (const [device, n] of Object.entries(mine.clock)) clock[device] = Math.max(clock[device] || 0, n);
        clock[state.deviceId] = (clock[state.deviceId] || 0) + 1;
        merged.records[key] = { ...mine, clock, conflicts: [] };
      } else merged.records[key] = records.merge({ schema: 2, records: { [key]: mine } }, { schema: 2, records: { [key]: theirs } }).records[key];
    }
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
    const gate = { ...(await checkTileGate(data)), rejoin: true };
    const rejoin = rejoining();
    // Read before anything is applied: the visits too old to sync stay here.
    let localHistory = [];
    try { const saved = JSON.parse(localStorage.getItem('vex.history') || '[]'); if (Array.isArray(saved)) localHistory = saved; }
    catch (err) { console.error('[Sync] This device’s history could not be read; only the synced history is kept:', err.message); }
    // What this device had of each kind being joined again when it was turned
    // off (setTypeSynced): what differs from it was changed here meanwhile.
    const offBase = rejoin.length ? ((await VexStorage.load(OFF_BASE)) || {}) : {};
    const before = Object.assign({}, ...rejoin.map(id => offBase[id] || {}));
    const local = await collectSyncData(gate);
    let merged;
    let rejoinConflicts = 0;
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
      joinSecrets(merged, local, data, () => true);
      // This device's tiles were just added on top of the account's (see
      // collectSyncData), so its tile records are the newer ones.
      if (tilesSync(gate)) Object.assign(merged.records, records.merge(tileRecords(local), tileRecords(data)).records);
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
      // A kind turned back on joins the way a new device does: the account's
      // records win, and what only this device has is added.
      if (rejoin.length) {
        for (const key of Object.keys(merged.records)) if (rejoinsRecord(key, rejoin)) delete merged.records[key];
        for (const [key, record] of Object.entries(data.records)) if (rejoinsRecord(key, rejoin)) merged.records[key] = record;
        for (const [key, record] of Object.entries(local.records)) {
          if (!rejoinsRecord(key, rejoin) || record.deleted || Object.hasOwn(data.records, key)) continue;
          const shape = doc => doc.records[JSON.stringify([sourceOf(key), 'type'])];
          if (shape(data) && !shape(data).deleted && shape(data).value !== shape(local)?.value) continue;
          merged.records[key] = record;
        }
        // Changed on this device while it was off: the account's version stays
        // in use and this one is kept beside it in Sync conflicts. It was
        // dropped without a trace (found 2026-10-11). A copy that only fell
        // behind (as it was when turned off) is not a change.
        rejoinConflicts = keepEditsMadeWhileOff(merged, local, data, before, key => rejoinsRecord(key, rejoin));
        joinSecrets(merged, local, data, key => rejoinsRecord(key, rejoin));
      }
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
    // Saved passwords and authenticator accounts first: main opens and writes
    // them, and refuses while Vex is locked. Nothing else is written until
    // they are.
    const secretLists = {};
    for (const [source, kind] of Object.entries(SECRET_SOURCES)) {
      if (ownsSource(source, gate)) secretLists[kind] = sealedItems(Object.hasOwn(sources, source) ? sources[source] : [], kind);
    }
    if (Object.keys(secretLists).length) await window.vex.syncSecretsApply(secretLists);
    if (preferenceKeys().includes('vex.history') && ownsSource('preference:vex.history', gate)) {
      const synced = sources['preference:vex.history'];
      sources['preference:vex.history'] = withOlderHistory(Array.isArray(synced) ? synced : [], localHistory, sources['preference:vex.historyClearedAt']);
    }
    // Reading-queue items that are held back from the account (their tab had a
    // session of its own, or the site is sensitive) stay on this device.
    if (window.VexLiveSession && ownsSource('preference:vex.readLater', gate)) {
      let localQueue = [];
      try { const saved = JSON.parse(localStorage.getItem('vex.readLater') || '[]'); if (Array.isArray(saved)) localQueue = saved; }
      catch (err) { console.error('[Sync] This device’s reading queue could not be read; only the synced queue is kept:', err.message); }
      const kept = window.VexLiveSession.readingQueueForSync(localQueue, sensitiveHosts()).kept;
      if (kept.length) {
        const synced = sources['preference:vex.readLater'];
        sources['preference:vex.readLater'] = window.VexLiveSession.readingQueueApply(Array.isArray(synced) ? synced : [], kept);
      }
    }
    const lookBefore = lookSnapshot();
    for (const key of preferenceKeys()) {
      const name = 'preference:' + key;
      // Left out on this device (Choose what to sync): its copy stays.
      if (!ownsSource(name, gate)) continue;
      if (Object.hasOwn(sources, name)) localStorage.setItem(key, typeof sources[name] === 'string' ? sources[name] : JSON.stringify(sources[name]));
      else localStorage.removeItem(key);
    }
    // Tiles only while every device understands them; otherwise this device's
    // own tiles stay as they are, whatever the account holds.
    if (tilesSync(gate)) {
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
    if (rejoin.length) {
      localStorage.removeItem(REJOIN_KEY);
      for (const id of rejoin) delete offBase[id];
      await VexStorage.save(OFF_BASE, Object.keys(offBase).length ? offBase : null);
    }
    if (lookSnapshot() !== lookBefore) applyLook();
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
    const conflicts = restore ? 0 : Object.entries(merged.records).filter(([key, r]) => r.conflicts?.length > 1 && !rejoinsRecord(key, rejoin)
      && JSON.stringify(r.conflicts) !== JSON.stringify(local.records[key]?.conflicts || [])).length + rejoinConflicts;
    if (conflicts) window.showToast?.((conflicts === 1 ? 'Another device changed the same thing: both versions are kept' : `Other devices changed the same things: both versions of ${conflicts} are kept`) + ' — Settings › Vex Sync › Sync conflicts');
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
    if (waitForUnlock()) return { ok: false, locked: true, reason: LOCKED_WAIT };
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
      const proofed = await proofHeaders('push', `${revision}\n${await SyncCrypto.sha256Hex(encryptedBlob)}`);
      const r = proofed.refused || await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/sync/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.sessionToken}`,
          ...proofed.headers
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
      if (r.status === 409) {
        if ((await r.json().catch(() => ({}))).keyCheckSet) lockedByThisDevice();
        return { ok: false, conflict: true, reason: 'Another device synced at the same moment — try again' };
      }
      // Refused by the key check: the server's own words say what to do.
      if (r.status === 403) throw new Error((await r.json().catch(() => ({}))).error || 'Push returned 403');
      // The server takes at most 4 MiB in one upload (SYNC_PROTOCOL.md §1.2).
      if (r.status === 413) throw new Error('Your synced data is too big for the sync server (over 4 MB), so nothing was uploaded. Leave something large out in Settings › Vex Sync › Choose what to sync, such as notes, or delete what you no longer need.');
      if (!r.ok) throw new Error('Push returned ' + r.status);
      const saved = await r.json();
      revision = saved.revision;
      if (saved.keyCheckSet) lockedByThisDevice();
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
    if (waitForUnlock()) return { ok: false, locked: true, reason: LOCKED_WAIT };
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
      // A pull names the lock only when the account has one.
      if (result.keyCheck) setKeyLock('on', result.keyCheck.setAt || null);
      else if (keyLock.state === 'on') setKeyLock('off');
      const receivedRevision = result.revision || 0;
      if (!Number.isSafeInteger(receivedRevision) || receivedRevision < 0) throw new Error('Invalid sync revision');
      const blob = result.encryptedBlob;
      // The revision this device already has: the same document it pushed or
      // applied, so there is nothing new to apply (and nothing to rewrite).
      if (blob && !restore && server && recordDocument && receivedRevision === server.revision && receivedRevision === revision && !rejoining().length) {
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
        // Nothing in the account to join: this device's copy goes up as it is.
        localStorage.removeItem(REJOIN_KEY);
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
      // Only names for Sync conflicts: the pull stands without them.
      try { await nameSecretConflicts(); }
      catch (err) { console.error('[Sync] Could not name the saved logins in Sync conflicts:', err); }
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

  // Turns one kind of data on or off for this device. Turning one on joins
  // it on a pull straight away (or the next one, offline).
  async function setTypeSynced(id, on) {
    const type = SYNC_TYPES.find(t => t.id === id);
    if (!type) throw new Error('Unknown kind of sync data: ' + id);
    // Passwords and authenticator codes leave this device only after Vex asks
    // again, as before showing a saved password (the Vex PIN if set).
    if (on && type.secret && !typeOn(id)) {
      if (!window.VexLock || typeof window.VexLock.recheck !== 'function') throw new Error('The PIN check did not load');
      const what = id === 'passwords' ? 'your saved passwords' : id === 'passkeys' ? 'your passkeys' : 'your authenticator (2FA) accounts';
      const asked = await window.VexLock.recheck({ title: 'Sync ' + type.label.toLowerCase(), message: 'Vex asks again before it syncs ' + what + ' to your other devices. They travel end-to-end encrypted with your sync key.', okLabel: 'Turn on' });
      if (!asked) return { ok: false, canceled: true };
    }
    // What this device had of the kind as it is turned off: on turning it back
    // on, what differs from this was changed here meanwhile (keepEditsMadeWhileOff).
    if (!on && !type.secret && typeOn(id) && typeof VexStorage !== 'undefined') {
      const doc = recordDocument || await VexStorage.load('sync-records');
      const base = { ...((await VexStorage.load(OFF_BASE)) || {}) };
      base[id] = doc ? Object.fromEntries(Object.entries(doc.records)
        .filter(([key, record]) => !record.deleted && JSON.parse(key)[1] !== 'type' && rejoinsRecord(key, [id]))
        .map(([key, record]) => [key, record.value])) : {};
      await VexStorage.save(OFF_BASE, base);
    }
    const choices = readJson(CHOICES_KEY, {});
    const next = choices && typeof choices === 'object' && !Array.isArray(choices) ? { ...choices } : {};
    if (on) { if (type.secret || type.optIn) next[id] = true; else delete next[id]; } else next[id] = false;
    localStorage.setItem(CHOICES_KEY, JSON.stringify(next));
    const rejoin = rejoining().filter(type => type !== id);
    if (on) {
      rejoin.push(id);
      // Tiles join through their own gate: their next round adds this
      // device's tiles to the account's.
      if (id === 'shortcuts' && typeof VexStorage !== 'undefined') await VexStorage.save('sync-tiles-joined', null);
    }
    if (rejoin.length) localStorage.setItem(REJOIN_KEY, JSON.stringify(rejoin)); else localStorage.removeItem(REJOIN_KEY);
    if (!on || !state.enabled) return { ok: true };
    const pulled = await pullNow();
    if (!pulled.ok) return { ok: false, reason: pulled.reason };
    return pushNow();
  }

  // ===== THE LOOK =====
  // A look, skin, font or reading aid that arrived is put on screen at once,
  // as the theme is (theme-manager.js applySynced).
  const LOOK_KEYS = ['vex.guiStyle', 'vex.guiColors', 'vex.skinPattern', 'vex.skinShape', 'vex.skinGlow', 'vex.skinStrength', 'vex.font', 'vex.fontMono', 'vex.a11y'];
  const lookSnapshot = () => JSON.stringify(LOOK_KEYS.map(key => localStorage.getItem(key)));
  function applyLook() {
    const G = window.VexGuiStyle;
    if (G && typeof document !== 'undefined' && document.body) {
      const want = G.get(), shown = document.body.dataset.guiStyle || 'classic';
      // Light and dark moves between a look and its dark twin by itself, on
      // each device by its own clock or Windows setting: another device's
      // twin is not worn over this one's.
      const pairs = typeof ThemeAuto !== 'undefined' && ThemeAuto.isOn() ? ThemeAuto.LOOK_PAIRS || {} : {};
      const twins = Object.entries(pairs).some(([light, dark]) => [light, dark].includes(want) && [light, dark].includes(shown));
      if (want !== shown && !twins) Promise.resolve(G.set(want)).catch(err => console.error('[Sync] Could not wear the synced look:', err));
      if ((document.body.dataset.guiColors || 'look') !== G.getColors()) G.setColors(G.getColors());
    }
    window.VexFonts?.apply();
    window.VexSkins?.apply();
    if (window.AccessibilityPack) { window.AccessibilityPack.init(); window.AccessibilityPack.reapplyAll(); }
  }
  // A restored backup brings these back too (js/backup.js).
  if (typeof window !== 'undefined') window.addEventListener('vex-sync-data-applied', (e) => { if (e && e.detail && e.detail.source === 'backup') applyLook(); });

  // ===== CONFLICTS =====
  // Two devices changing the same thing between syncs keep both versions in
  // the record (sync-records.js merge); the newer one, or a deletion, wins.
  // The others were only counted in a toast, and nothing could bring one back
  // (found 2026-10-10, SYNC_PROTOCOL.md Appendix B). These list them and put
  // a chosen one back.
  const itemId = item => String(item?.id ?? (item?.url ? item.url + ':' + (item.time || '') : JSON.stringify(item)));
  function describe(value, deleted) {
    if (deleted) return 'Deleted';
    const v = value && typeof value === 'object' && 'item' in value ? value.item : value;
    if (v && typeof v === 'object') return String(v.title || v.name || v.label || v.url || v.message || JSON.stringify(v)).slice(0, 160);
    return String(v).slice(0, 160);
  }
  // What a sealed version is (its site and username, or its issuer and
  // name), opened by main after each pull that leaves a conflict on one.
  // Never its password or secret. sealed text -> label.
  const secretLabels = new Map();
  async function nameSecretConflicts() {
    const asks = [];
    for (const [key, record] of Object.entries(recordDocument ? recordDocument.records : {})) {
      const [source, kind, id] = JSON.parse(key);
      if (kind !== 'item' || !secretSource(source) || !(record.conflicts?.length > 1)) continue;
      for (const v of record.conflicts) {
        const s = v.value && v.value.item && v.value.item.s;
        if (typeof s === 'string' && !secretLabels.has(s)) asks.push({ kind: SECRET_SOURCES[source], id, s });
      }
    }
    if (!asks.length) return;
    const named = await window.vex.syncSecretsDescribe(asks);
    asks.forEach((ask, i) => {
      if (named[i] && typeof named[i].label === 'string') secretLabels.set(ask.s, named[i].label);
      else console.error('[Sync] A version in Sync conflicts could not be named:', named[i] && named[i].error);
    });
  }
  const secretLabel = value => secretLabels.get(value && value.item && value.item.s) || 'A saved item this device cannot name yet';

  // [{ key, what, versions: [{ deleted, text, at, current }] }], newest edit first.
  function conflictList() {
    if (!recordDocument) return [];
    const gate = { open: tileGate.open, rejoin: false };
    const out = [];
    for (const [key, record] of Object.entries(recordDocument.records)) {
      if (!(record.conflicts?.length > 1) || !ownsRecord(key, gate)) continue;
      const [source, kind] = JSON.parse(key);
      if (kind === 'type' || source.startsWith(DEVICE_SOURCE) || TILE_SOURCES.includes(source)) continue;
      const type = SYNC_TYPES.find(t => t.id === typeOfSource(source));
      const same = v => v.deleted === record.deleted && JSON.stringify(v.value) === JSON.stringify(record.value);
      if (secretSource(source)) {
        if (kind !== 'item') continue;
        out.push({
          key,
          what: type.label + ' › ' + secretLabel(record.deleted ? record.conflicts.find(v => !v.deleted)?.value : record.value),
          at: record.at || 0,
          versions: record.conflicts.map(v => ({ deleted: !!v.deleted, text: v.deleted ? 'Deleted' : secretLabel(v.value), at: v.at || 0, current: same(v) })),
        });
        continue;
      }
      out.push({
        key,
        what: (type ? type.label : 'Settings') + ' › ' + (kind === 'item' ? describe(record.deleted ? record.conflicts.find(v => !v.deleted)?.value : record.value, false) : source.replace(/^preference:vex\.|^storage:/, '')),
        at: record.at || 0,
        versions: record.conflicts.map(v => ({ deleted: !!v.deleted, text: describe(v.value, v.deleted), at: v.at || 0, current: same(v) })),
      });
    }
    return out.sort((a, b) => b.at - a.at);
  }
  // The whole of each version of one conflict, for the side-by-side view
  // (js/sync-conflict-detail.js): conflictList() cuts every version to a line.
  // Nothing sealed is ever returned: a saved login or authenticator account is
  // shown by its label only (`sealed: true`), never its password or secret.
  // -> { key, what, versions: [{ deleted, at, current, sealed, label, value }] } | null
  function conflictDetail(key) {
    const summary = conflictList().find(c => c.key === key);
    const record = recordDocument && recordDocument.records[key];
    if (!summary || !record || !(record.conflicts?.length > 1)) return null;
    const [source] = JSON.parse(key);
    const sealed = secretSource(source);
    const bare = value => (value && typeof value === 'object' && 'item' in value ? value.item : value);
    return {
      key,
      what: summary.what,
      versions: record.conflicts.map((v, i) => ({
        deleted: !!v.deleted,
        at: v.at || 0,
        current: summary.versions[i].current,
        sealed,
        label: summary.versions[i].text,
        value: sealed || v.deleted ? null : structuredClone(bare(v.value)),
      })),
    };
  }
  // Puts back version `index` of the record `key` on this device and makes it
  // the account's, ending the conflict.
  async function resolveConflict(key, index) {
    if (!recordDocument || !recordDocument.records[key]) throw new Error('That conflict is no longer there');
    const record = recordDocument.records[key];
    const version = record.conflicts?.[index];
    if (!version) throw new Error('That version is no longer there');
    if (!ownsRecord(key, { open: tileGate.open, rejoin: false })) throw new Error('This device does not sync that');
    const [source, kind, id] = JSON.parse(key);
    if (secretSource(source)) {
      if (kind !== 'item') throw new Error('That cannot be put back');
      await window.vex.syncSecretsPutBack({ kind: SECRET_SOURCES[source], id, item: version.deleted ? null : sealedItems([version.value && version.value.item], SECRET_SOURCES[source])[0] });
    } else if (source.startsWith('preference:')) {
      const name = source.slice(11);
      if (kind === 'value') {
        if (version.deleted) localStorage.removeItem(name);
        else localStorage.setItem(name, typeof version.value === 'string' ? version.value : JSON.stringify(version.value));
      } else if (kind === 'item') {
        let list = [];
        try { const saved = JSON.parse(localStorage.getItem(name) || '[]'); if (Array.isArray(saved)) list = saved; }
        catch (err) { throw new Error('This device\'s ' + name.slice(4) + ' could not be read: ' + err.message); }
        const at = list.findIndex(item => itemId(item) === id);
        if (version.deleted) { if (at >= 0) list.splice(at, 1); }
        else if (at >= 0) list[at] = version.value.item;
        else list.splice(Math.min(version.value.index, list.length), 0, version.value.item);
        localStorage.setItem(name, JSON.stringify(list));
      } else throw new Error('That cannot be put back');
    } else if (source.startsWith('storage:') && kind === 'value') {
      await VexStorage.save(source.slice(8), version.deleted ? null : version.value);
    } else throw new Error('That cannot be put back');
    // A new edit by this device: it wins over every version, and carries none.
    const clock = { ...record.clock, [state.deviceId]: (record.clock[state.deviceId] || 0) + 1 };
    recordDocument = { schema: 2, records: { ...recordDocument.records, [key]: { clock, deleted: !!version.deleted, value: version.deleted ? null : version.value, at: Date.now(), conflicts: [] } } };
    await VexStorage.save('sync-records', recordDocument);
    window.dispatchEvent(new CustomEvent('vex-sync-data-applied', { detail: { source: 'conflict' } }));
    if (!state.enabled) return { ok: true };
    return pushNow();
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
      // Game mode (js/game-session.js): the change waits, and goes up in one
      // round when the game ends. Closing the window still uploads (pushBeforeClose).
      if (gameHolds()) { owedAfterGame = true; return; }
      pushNow().then((r) => {
        if (!r.ok && r.reason !== 'not-ready' && !r.locked) console.error('[Sync] Could not upload a change: ' + r.reason);
      });
    }, CHANGE_PUSH_MS);
  }
  // Saved passwords and authenticator accounts live in main, which says
  // when one changed (main/sync-secrets.js).
  let secretsWatched = false;
  // Unlocked: what waited goes now (waitForUnlock).
  let unlockWatched = false;
  const syncedPreference = key => (preferenceKeys().includes(key) || TILE_LISTS.includes(key)) && typeOn(typeOfSource('preference:' + key));
  function watchChanges() {
    if (typeof PersistentStorage !== 'undefined') PersistentStorage.onChange = key => changed(syncedPreference(String(key)));
    if (typeof VexStorage !== 'undefined') VexStorage.onChange = key => changed(STORE_KEYS.includes(String(key)) && typeOn(typeOfSource('storage:' + key)));
    if (!secretsWatched && window.vex && typeof window.vex.onSyncSecretsChanged === 'function') {
      secretsWatched = true;
      window.vex.onSyncSecretsChanged(() => changed(secretsOn()));
    }
    if (!unlockWatched) {
      unlockWatched = true;
      window.addEventListener('vex-unlocked', () => {
        if (!state.enabled || privateWindow() || !syncWorkerUrl() || !secretsOn()) return;
        pullNow().then(() => pushNow()).then((r) => {
          if (!r.ok && r.reason !== 'not-ready') console.error('[Sync] Could not sync after Vex was unlocked: ' + r.reason);
        });
      });
    }
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
    pushTimer = setInterval(() => { if (gameHolds()) owedAfterGame = true; else pushNow(); }, 2 * 60 * 1000);
    // On battery (js/battery-mode.js) the pull waits and runs once when the PC is plugged in.
    // The push is not put off: it is how your changes leave.
    pullTimer = setInterval(() => {
      if (gameHolds()) { owedAfterGame = true; return; }
      if (typeof BatteryMode !== 'undefined' && BatteryMode.defer('sync-pull', () => pullNow())) return;
      pullNow();
    }, 5 * 60 * 1000);
    watchChanges();
  }

  // Game mode holds the automatic rounds while a game runs (js/game-session.js).
  // A manual "Sync now" is never held, and neither is the last upload before
  // the window closes.
  let owedAfterGame = false;
  function gameHolds() { return !!(window.GameSession && typeof window.GameSession.holds === 'function' && window.GameSession.holds('sync')) || !!(window.VexExamSafeMode && window.VexExamSafeMode.holds('sync')); }
  // The game ended: whatever was held goes now, as one pull and one push.
  function resumeAfterGame() {
    if (!owedAfterGame) return false;
    owedAfterGame = false;
    if (!state.enabled || privateWindow() || !syncWorkerUrl()) return false;
    pullNow().then(() => pushNow()).then((r) => {
      if (r && !r.ok && r.reason !== 'not-ready') console.error('[Sync] Could not catch up after the game: ' + r.reason);
    }).catch(err => console.error('[Sync] Could not catch up after the game:', err));
    return true;
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
    // The Devices view names and orders devices from this list.
    knownDevices = data.devices.filter(d => d && typeof d.deviceId === 'string');
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
      const proofed = await proofHeaders('wipe', '');
      r = proofed.refused || await (window.VexNet?.fetch || fetch)(`${syncWorkerUrl()}/sync/all`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.sessionToken}`, ...proofed.headers },
        // The address, for the email the server sends afterwards (SYNC_PROTOCOL.md §2.9).
        body: JSON.stringify({ email: state.email })
      });
    } catch (err) { return { ok: false, reason: err.message || String(err) }; }
    if (!r.ok) {
      // Refused by the key check: the server's own words say what to do.
      const refusal = r.status === 403 ? (await r.json().catch(() => ({}))).error : null;
      return { ok: false, reason: refusal || 'Server returned ' + r.status };
    }
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
      authKey = await SyncCrypto.authKeyHex(keyBytes);

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
  // `opts.to` addresses the item to one device (SYNC_PROTOCOL.md §4.10.5): the
  // mailbox has no addressing, so `to` and `hop` travel inside the encrypted
  // payload. A device that is not `to` hands the item on (Handoff.receive),
  // at most DROP_MAX_HOPS times; a device that does not know `to` opens it.
  const DEVICE_ID_RE = /^[a-f0-9]{32}$/;
  async function dropSend(url, title, opts = {}) {
    refuseInPrivate();
    if (!state.enabled || !state.sessionToken) {
      throw new Error('Sign in to Vex Sync first (Settings › Vex Sync)');
    }
    requireSyncUrl();
    if (!/^https?:$/.test(new URL(url).protocol)) throw new Error('Only web URLs can be sent');
    const payload = { url: url.slice(0,2048), title: String(title || '').slice(0,300) };
    if (opts && opts.to != null) {
      if (typeof opts.to !== 'string' || !DEVICE_ID_RE.test(opts.to)) throw new Error('Unknown device to send to');
      payload.to = opts.to;
      const hop = Number.isInteger(opts.hop) ? opts.hop : 0;
      if (hop > 0) payload.hop = Math.min(hop, 9);
    }
    const encryptedBlob = await SyncCrypto.encrypt(payload, state.encryptionKey);
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
        if (typeof payload.url === 'string' && /^https?:$/.test(new URL(payload.url).protocol)) {
          const got = { ...item, url: payload.url, title: String(payload.title || '') };
          // Optional text shared along with the link from a phone's share sheet (docs/PHONE_SHARE.md).
          if (typeof payload.note === 'string' && payload.note.trim()) got.note = payload.note.slice(0, 1000);
          if (typeof payload.to === 'string' && DEVICE_ID_RE.test(payload.to)) {
            got.to = payload.to;
            got.hop = Number.isInteger(payload.hop) && payload.hop > 0 ? Math.min(payload.hop, 9) : 0;
          }
          items.push(got);
        }
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
    startOver,
    // Whether the account is locked to its sync key (SYNC_PROTOCOL.md §2.7).
    keyCheckState: () => ({ ...keyLock }),
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
    // Every device with its tabs, freshness and clock-safe ordering (js/live-session.js).
    devicesView,
    pushBeforeClose,
    resumeAfterGame,
    syncTypes: () => SYNC_TYPES.map(t => ({ id: t.id, label: t.label, on: typeOn(t.id) })),
    conflicts: conflictList,
    conflictDetail,
    resolveConflict,
    setTypeSynced,
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
