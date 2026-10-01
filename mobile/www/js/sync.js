// === Vex Mobile — Vex Sync ===
//
// The same encrypted account the desktop uses, against the same worker
// (workers/vex-sync-worker): sign in with an emailed code, and every device
// shares one AES-256-GCM-encrypted document the worker cannot read. The key
// is the recovery code — 64 hex digits, no derivation — shown once on the
// device that made it and typed on the others.
//
// The account document belongs to every device at once, and a push REPLACES
// it. So the one rule this file is built around: the phone changes only what
// it owns and sends every other record back exactly as it received it. It owns
//
//   preference:vex.bookmarks   item by item, both ways
//   preference:vex.notes       item by item, both ways (the desktop's notes —
//                              not the phone's page passages, which stay here)
//   sync:device:<this id>      its marker: { level: 1 }
//
// Everything else — the desktop's tabs, settings, theme, history, tiles, other
// devices' markers, sources added by a newer Vex — is copied through record by
// record, untouched, and never written. storage:tabs in particular is read
// (for "open on your PC") and never written.
//
// The crypto and the record merge are the desktop's own files, copied verbatim
// (www/js/shared, `npm run shared`); so are the desktop's data contracts, which
// everything the phone writes is checked against before it is sent — a value
// a desktop would refuse stops sync on every desktop.
//
// How a round goes (the desktop's sync-engine.js, applied to the phone's part):
//   pull     GET /sync/pull → decrypt → merge what changed here into it →
//            apply the merged lists here. The revision is taken only once the
//            blob has been read and applied, and nothing is pushed while a
//            blob could not be read (pullBlocked).
//   push     capture this phone's lists onto the last document it read →
//            validate → encrypt → POST with baseRevision. 409: another device
//            got there first — pull, merge, push again (desktops push every two
//            minutes, so this is routine). 401: this device was signed out.

const VexSync = (() => {
  const SYNC_LEVEL = 1;                // what the desktop's marker says (2.34.3+)
  const DEVICE_SOURCE = 'sync:device:';
  const BOOKMARKS = 'preference:vex.bookmarks';
  const NOTES = 'preference:vex.notes';
  const PUSH_ATTEMPTS = 4;             // first try + three pull-merge-retries
  const DOC_BLOB = 'syncRecords';      // VexDB 'blobs' row with the document

  const state = {
    email: null,
    token: null,
    deviceId: null,
    deviceName: null,
    key: null,                 // CryptoKey
    enabled: false,
    revision: 0,
    lastPullAt: null,
    lastPushAt: null,
    lastError: null,
    syncing: false,
    remoteTabs: [],
    conflicts: 0
  };

  // A session the worker issued but the phone has not settled yet: waiting on
  // a recovery code. The worker lets it push, pull or delete itself, nothing
  // else (403), and it must be deleted if the sign-in is abandoned, or it would
  // stay in the account's device list as a ghost.
  let pending = null;
  let recordDocument = null;           // the account document as last read/sent
  let pullBlocked = false;
  let pushTimer = null;
  let pullTimer = null;
  let queue = Promise.resolve();

  const records = () => window.VexSyncRecords;
  const contracts = () => window.VexDataContracts;

  // One network round at a time: a pull and a push interleaving would each
  // start from a document the other is about to replace.
  function exclusive(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  // ── The worker ────────────────────────────────────────────────────────────

  function url() { return String(VexStore.get('vex.syncWorkerUrl', '') || '').trim().replace(/\/+$/, ''); }

  // https, or plain http to this machine — a worker run locally for testing
  // (scripts/sync-stand-in.mjs). Never plain http to anywhere else: the session
  // token travels in a header.
  function acceptableUrl(value) {
    return /^https:\/\/[^\s/]+/i.test(value)
      || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.0\.2\.2)(:\d+)?(\/|$)/i.test(value);
  }

  function configured() { return acceptableUrl(url()); }

  // Answers { status, body }; it is the caller that decides what 401, 403 and
  // 409 mean, because they mean different things to different calls.
  async function request(path, { method = 'GET', body, token = state.token } = {}) {
    if (!configured()) throw new Error('Add your Sync Worker URL in Settings → Sync.');
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetch(url() + path, {
        method, headers, signal: controller.signal,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      });
    } catch {
      throw new Error(controller.signal.aborted ? 'The sync worker did not answer.' : 'Could not reach the sync worker.');
    } finally {
      clearTimeout(timer);
    }
    const answer = await response.json().catch(() => ({}));
    return { status: response.status, ok: response.ok, body: answer || {} };
  }

  function failure(response, fallback) {
    return new Error((response.body && response.body.error) || (fallback + ' (the worker returned ' + response.status + ')'));
  }

  // The worker's device ids are hex; the record clocks are keyed by them, and
  // both sides validate the shape.
  function deviceId() {
    const id = String(state.deviceId || '');
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('This phone has no valid sync device id');
    return id;
  }

  // ── What the phone owns ──────────────────────────────────────────────────
  // Each owned list is read from and written to a store here, and compared
  // with the account's copy field by field: an item the phone did not change
  // is sent back as the account's own object, with every field it carries —
  // including ones this version of Vex has never heard of.

  const itemId = item => String(item?.id ?? (item?.url ? item.url + ':' + (item.time || '') : JSON.stringify(item)));
  const hasId = item => !!item && typeof item === 'object' && typeof item.id === 'string' && item.id !== '';

  // Deletions are recorded when you delete, not inferred from absence. An item
  // the account has and the phone's list lacks for any other reason — a crash
  // between two writes, cleared app data, a restored backup — is put back here,
  // never deleted from every device. vex.syncDeletions: { source: [ids] }.
  function deletions(source) {
    const all = VexStore.get('vex.syncDeletions', {});
    const list = all && typeof all === 'object' && Array.isArray(all[source]) ? all[source] : [];
    return new Set(list.map(String));
  }

  async function setDeletions(source, ids) {
    const all = Object.assign({}, VexStore.get('vex.syncDeletions', {}) || {});
    if (ids.size) all[source] = [...ids].slice(-5000);
    else delete all[source];
    await VexStore.set('vex.syncDeletions', all);
  }

  /** Forget deletions the document already carries out (tombstoned or gone). */
  async function pruneDeletions(doc) {
    for (const source of OWNED) {
      const ids = deletions(source);
      if (!ids.size) continue;
      const live = new Set(accountList(doc, source).filter(hasId).map(itemId));
      const still = new Set([...ids].filter(id => live.has(id)));
      if (still.size !== ids.size) await setDeletions(source, still);
    }
  }

  const ADAPTERS = {
    [BOOKMARKS]: {
      local: () => VexCollections.bookmarks.all(),
      // What the desktop accepts in vex.bookmarks (data-contracts.js storage
      // 'bookmarks'): a web address, an id of word characters, text fields.
      // Anything else stays on the phone and is never sent.
      syncable(item) {
        const check = contracts();
        if (!hasId(item) || !check.id(item.id) || !check.url(item.url, true)) return false;
        try { check.storage('bookmarks', [this.toAccount(item, null)]); return true; } catch { return false; }
      },
      same: (local, account) => local.url === account.url
        && String(local.title || '') === String(account.title || '')
        && String(local.folder || '') === String(account.folder || ''),
      // An edit keeps the account item's other fields and their order.
      toAccount(local, account) {
        if (account) return { ...account, url: local.url, title: String(local.title || local.url), folder: String(local.folder || '') };
        return { id: local.id, url: local.url, title: String(local.title || local.url), folder: String(local.folder || ''), at: Number(local.at) || Date.now() };
      },
      // Back here: the account's item, plus what only the phone keeps (its icon).
      fromAccount: (item, old) => ({ ...item, icon: (old && old.icon) || item.icon || '' }),
      save: list => VexStore.set('vex.bookmarks', list)
    },
    [NOTES]: {
      local: () => {
        const list = VexStore.get('vex.syncNotes', []);
        return Array.isArray(list) ? list : [];
      },
      syncable: note => hasId(note) && contracts().id(note.id)
        && typeof note.title === 'string' && typeof note.content === 'string',
      // Notes are kept here exactly as the desktop wrote them, so the account's
      // object is what an edit started from: compare it whole.
      same: (local, account) => JSON.stringify(local) === JSON.stringify(account),
      toAccount: (local, account) => (account ? { ...account, ...local } : { ...local }),
      fromAccount: item => item,
      save: list => VexStore.set('vex.syncNotes', list)
    }
  };
  const OWNED = Object.keys(ADAPTERS);
  const marker = () => DEVICE_SOURCE + deviceId();
  const sourceOf = key => { try { return JSON.parse(key)[0]; } catch { return null; } };

  /**
   * Which owned lists may be written. One the account holds in another shape
   * (an older Vex that still sends notes as one value) is left exactly as it
   * is: rewriting it item by item would replace that device's whole list.
   */
  function writable(doc) {
    return OWNED.filter(source => {
      const type = doc.records[JSON.stringify([source, 'type'])];
      return !type || type.deleted || type.value === 'array';
    });
  }

  function accountList(doc, source) {
    const own = { schema: 2, records: {} };
    for (const [key, record] of Object.entries(doc.records)) if (sourceOf(key) === source) own.records[key] = record;
    const list = records().unflatten(records().values(own))[source];
    return Array.isArray(list) ? list : [];
  }

  /**
   * This phone's version of an owned list, in the account's order: items the
   * account has and the phone kept (unchanged ones as the account's own
   * objects), then the phone's new ones at the end, where they move no other
   * item's index. An account item with no id cannot be matched to anything
   * here, so it is passed through as it is rather than read as deleted.
   */
  // What each owned list held when it was last captured, by id, so applying a
  // pull can tell an edit made while the round was on the network (kept) from
  // the stale copy it is replacing.
  const snapshots = {};

  function outgoing(source, doc, { joining = false } = {}) {
    const adapter = ADAPTERS[source];
    const account = accountList(doc, source);
    const all = adapter.local();
    snapshots[source] = new Map(all.filter(hasId).map(item => [itemId(item), JSON.stringify(item)]));
    const locals = all.filter(item => adapter.syncable(item));
    const byId = new Map(locals.map(item => [itemId(item), item]));
    const deleted = joining ? new Set() : deletions(source);
    const out = [];
    const seen = new Set();
    for (const item of account) {
      if (!hasId(item)) { out.push(item); continue; }
      const id = itemId(item);
      const local = byId.get(id);
      // Joining: the account's copy wins for everything it has.
      if (joining) { out.push(item); seen.add(id); continue; }
      if (!local) {
        // Deleted here — or merely missing, which is no reason to delete it
        // from every device: the account's copy stands and comes back here.
        if (!deleted.has(id)) { out.push(item); seen.add(id); }
        continue;
      }
      seen.add(id);
      out.push(adapter.same(local, item) ? item : adapter.toAccount(local, item));
    }
    // Joining, a bookmark the account already has under another id is the
    // same bookmark: the account's copy stands.
    const accountUrls = joining && source === BOOKMARKS ? new Set(account.map(item => item && item.url)) : null;
    for (const local of locals) {
      const id = itemId(local);
      if (seen.has(id)) continue;
      if (accountUrls && accountUrls.has(local.url)) continue;
      seen.add(id);
      out.push(adapter.toAccount(local, null));
    }
    return out;
  }

  /**
   * The document with this phone's lists captured onto it: the owned records
   * changed where the phone changed them (new clock entries from this device),
   * this device's marker set, and every other record the very same object it
   * was. capture() marks any key it is not given as deleted, which is why it
   * only ever sees the phone's own part of the document.
   */
  function captureOwned(doc, options) {
    const R = records();
    R.valid(doc);
    const lists = writable(doc);
    const values = {};
    for (const source of lists) {
      const list = outgoing(source, doc, options);
      const known = Object.keys(doc.records).some(key => sourceOf(key) === source);
      // An empty list the account has never had is not worth a record.
      if (list.length || known) values[source] = list;
    }
    values[marker()] = { level: SYNC_LEVEL };
    const mine = new Set([...lists, marker()]);
    const part = { schema: 2, records: {} };
    for (const [key, record] of Object.entries(doc.records)) if (mine.has(sourceOf(key))) part.records[key] = record;
    const captured = R.capture(part, R.flatten(values), deviceId());
    return { schema: 2, records: { ...doc.records, ...captured.records } };
  }

  const ownedKey = (key, lists) => {
    const source = sourceOf(key);
    return lists.includes(source) || source === marker();
  };

  /**
   * Merge what changed here into what was pulled. Owned records go through the
   * desktop's version-vector merge; every other record is the pulled one, the
   * same object, in the pulled order — the phone never had a say in them.
   */
  function mergeIntoPulled(local, pulled) {
    const R = records();
    const merged = R.merge(local, pulled);
    const lists = writable(pulled);
    const out = { schema: 2, records: {} };
    for (const [key, record] of Object.entries(pulled.records)) {
      out.records[key] = ownedKey(key, lists) ? merged.records[key] : record;
    }
    for (const [key, record] of Object.entries(merged.records)) {
      if (!Object.hasOwn(out.records, key) && ownedKey(key, lists)) out.records[key] = record;
    }
    return out;
  }

  /** What the desktop would refuse, refused here first. */
  function check(doc) {
    const R = records();
    R.valid(doc);
    const lists = {};
    for (const source of OWNED) {
      const own = { schema: 2, records: {} };
      for (const [key, record] of Object.entries(doc.records)) if (sourceOf(key) === source) own.records[key] = record;
      Object.assign(lists, R.unflatten(R.values(own)));
    }
    contracts().sources(lists);
    contracts().json(lists);
    for (const source of OWNED) {
      if (Object.hasOwn(lists, source) && !Array.isArray(lists[source]) && writable(doc).includes(source)) {
        throw new Error('Invalid synced list: ' + source);
      }
    }
  }

  /**
   * Put the account's owned lists into the phone's stores — without losing
   * anything done here while the round was on the network: an item edited
   * since it was captured keeps the edit (the next push sends it), one added
   * meanwhile has no record in the account and stays, and one deleted
   * meanwhile is in the deletions and does not come back. Only a deletion the
   * account carries (a tombstone) removes an item here.
   */
  async function applyOwned(doc, { joining = false } = {}) {
    for (const source of writable(doc)) {
      const adapter = ADAPTERS[source];
      const account = accountList(doc, source).filter(item => item && typeof item === 'object');
      const current = adapter.local();
      const byId = new Map(current.filter(hasId).map(item => [itemId(item), item]));
      const snapshot = snapshots[source] || new Map();
      const deleted = deletions(source);
      const accountIds = new Set(account.map(itemId));
      const next = [];
      for (const item of account) {
        const id = itemId(item);
        if (hasId(item) && deleted.has(id)) continue;
        const now = byId.get(id);
        const editedMeanwhile = now && snapshot.has(id) && JSON.stringify(now) !== snapshot.get(id);
        next.push(editedMeanwhile ? now : adapter.fromAccount(item, now));
      }
      // Joining, the phone's copy of a page the account already has is the
      // account's: the duplicate goes.
      const accountUrls = joining && source === BOOKMARKS ? new Set(account.map(item => item.url)) : null;
      for (const item of current) {
        const id = itemId(item);
        if (accountIds.has(id)) continue;
        if (doc.records[JSON.stringify([source, 'item', id])]) continue;   // deleted in the account
        if (accountUrls && adapter.syncable(item) && accountUrls.has(item.url)) continue;
        next.push(item);
      }
      await adapter.save(next);
    }
  }

  // ── Read-only views of what other devices sync ─────────────────────────────

  function readOnly(doc) {
    // storage:tabs is a list, so it is kept item by item like any other.
    const tabs = accountList(doc, 'storage:tabs');
    state.remoteTabs = Array.isArray(tabs)
      ? tabs.filter(tab => tab && typeof tab.url === 'string' && /^https?:/i.test(tab.url))
        .map(tab => ({ url: tab.url, title: String(tab.title || '') })).slice(0, 200)
      : [];
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  async function saveMeta() {
    await VexStore.set('vex.sync', {
      email: state.email,
      deviceId: state.deviceId,
      deviceName: state.deviceName,
      enabled: state.enabled,
      revision: state.revision,
      lastPullAt: state.lastPullAt,
      lastPushAt: state.lastPushAt
    });
  }

  async function saveDocument(doc) {
    recordDocument = doc;
    await VexDB.put('blobs', { name: DOC_BLOB, at: Date.now(), doc });
  }

  async function loadDocument() {
    if (recordDocument) return recordDocument;
    const row = await VexDB.get('blobs', DOC_BLOB).catch(() => null);
    recordDocument = row && row.doc ? row.doc : null;
    return recordDocument;
  }

  async function forget() {
    stopTimers();
    state.email = null;
    state.token = null;
    state.deviceId = null;
    state.deviceName = null;
    state.key = null;
    state.enabled = false;
    state.revision = 0;
    state.remoteTabs = [];
    state.lastPullAt = null;
    state.lastPushAt = null;
    recordDocument = null;
    pullBlocked = false;
    pending = null;
    await VexBridge.vaultSet('vex.syncToken', '');
    await VexBridge.vaultSet('vex.syncKey', '');
    await VexDB.delete('blobs', DOC_BLOB).catch(() => {});
    await saveMeta();
  }

  /** Remove a device the server knows by this token — this one, usually. */
  async function deleteDevice(token, id) {
    if (!token || !id) return false;
    try {
      const response = await request('/sync/devices/' + encodeURIComponent(id), { method: 'DELETE', token });
      return response.ok;
    } catch { return false; }
  }

  async function signedOutByServer() {
    await forget();
    state.lastError = 'This phone was signed out of Vex Sync — it was removed from another device, or the account was wiped. Sign in again.';
    if (window.VexUI && VexUI.toast) VexUI.toast(state.lastError, 6000);
  }

  // ── Pull and push ──────────────────────────────────────────────────────────

  /**
   * One pull. `joining`: the first one on this phone, with the account's copy
   * winning for everything it has and the phone's own additions added on top.
   */
  async function pullOnce({ joining = false } = {}) {
    const response = await request('/sync/pull');
    if (response.status === 401) { await signedOutByServer(); return { ok: false, signedOut: true, reason: 'Signed out' }; }
    if (!response.ok) throw failure(response, 'Could not pull');
    const revision = response.body.revision || 0;
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('The worker sent an invalid revision');

    let pulled;
    if (!response.body.encryptedBlob) {
      pulled = records().empty();
    } else {
      pullBlocked = true;
      try {
        pulled = await SyncCrypto.decrypt(response.body.encryptedBlob, state.key);
      } catch (error) {
        if (error && error.name === 'OperationError') {
          state.lastError = 'This key doesn’t unlock this account’s data';
          return { ok: false, badKey: true, reason: state.lastError };
        }
        throw error;
      }
      // A document from a Vex older than item-by-item sync. The desktop
      // converts it; the phone does not write over what it cannot read the
      // way its writer meant, and waits for that desktop to be updated.
      if (!pulled || pulled.schema !== 2) throw new Error('The account was last written by an older Vex — update the desktop app, then sync again');
      records().valid(pulled);
    }

    // Without the document this phone last read, it cannot tell what it
    // changed from what it never had: the account's copy wins, as on joining,
    // and only what the phone has on top is added.
    const stored = joining ? null : await loadDocument();
    const base = stored || pulled;
    const local = captureOwned(base, { joining: joining || !stored });
    const merged = mergeIntoPulled(local, pulled);
    check(merged);
    await applyOwned(merged, { joining: joining || !stored });
    readOnly(merged);
    // Conflicts this merge kept as recovery data, owned records only.
    state.conflicts = Object.entries(merged.records).filter(([key, record]) => record.conflicts && record.conflicts.length > 1
      && JSON.stringify(record.conflicts) !== JSON.stringify((pulled.records[key] || {}).conflicts || [])).length;

    await saveDocument(merged);
    await pruneDeletions(merged);
    state.revision = revision;
    pullBlocked = false;
    state.lastPullAt = new Date().toISOString();
    state.lastError = null;
    await saveMeta();

    // Whether the account lacks something this phone has: a change made here,
    // or its marker (an older Vex marks every record it does not know deleted).
    const lists = writable(pulled);
    const differs = Object.keys(merged.records).some(key => ownedKey(key, lists)
      && JSON.stringify(merged.records[key]) !== JSON.stringify(pulled.records[key]));
    // An older Vex marks every record it does not know as deleted, this
    // phone's marker among them, and the merge rightly takes that. Put back
    // at once (the desktop's markerMissing): until it is, desktops hold their
    // tiles back waiting for this phone.
    const own = merged.records[JSON.stringify([marker(), 'value'])];
    const markerMissing = !(own && !own.deleted && own.value && own.value.level >= SYNC_LEVEL);
    return { ok: true, empty: !response.body.encryptedBlob, needsPush: differs || markerMissing };
  }

  async function pushOnce() {
    if (pullBlocked) return { ok: false, reason: 'What is synced could not be read here — that has to be sorted before anything is sent' };
    const base = await loadDocument();
    if (!base) return { ok: false, needsPull: true };
    const doc = captureOwned(base);
    check(doc);
    const blob = await SyncCrypto.encrypt(doc, state.key);
    const response = await request('/sync/push', {
      method: 'POST',
      body: { encryptedBlob: blob, updatedAt: new Date().toISOString(), baseRevision: state.revision }
    });
    if (response.status === 401) { await signedOutByServer(); return { ok: false, signedOut: true, reason: 'Signed out' }; }
    if (response.status === 409) return { ok: false, conflict: true };
    if (!response.ok) throw failure(response, 'Could not push');
    const revision = response.body.revision;
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('The worker sent an invalid revision');
    await saveDocument(doc);
    await pruneDeletions(doc);
    state.revision = revision;
    state.lastPushAt = new Date().toISOString();
    state.lastError = null;
    await saveMeta();
    return { ok: true };
  }

  /** Push, pulling and merging first whenever another device got there first. */
  async function pushWithRetry() {
    for (let attempt = 0; attempt < PUSH_ATTEMPTS; attempt++) {
      const pushed = await pushOnce();
      if (pushed.ok || pushed.signedOut) return pushed;
      if (!pushed.conflict && !pushed.needsPull) return pushed;
      const pulled = await pullOnce();
      if (!pulled.ok) return pulled;
    }
    return { ok: false, reason: 'Other devices kept syncing at the same moment — it will try again shortly' };
  }

  async function round(task) {
    if (!state.enabled || !state.key) return { ok: false, reason: 'not-signed-in' };
    return exclusive(async () => {
      if (!state.enabled) return { ok: false, reason: 'not-signed-in' };
      state.syncing = true;
      try { return await task(); }
      catch (error) {
        state.lastError = error.message || String(error);
        return { ok: false, reason: state.lastError };
      } finally {
        state.syncing = false;
      }
    });
  }

  // ── Timers ─────────────────────────────────────────────────────────────────

  function stopTimers() {
    clearTimeout(pushTimer);
    clearInterval(pullTimer);
    pushTimer = null;
    pullTimer = null;
  }

  function startTimers() {
    stopTimers();
    // Every five minutes while Vex is open, as the desktop does; pulling on
    // its own pushes when something here differs.
    pullTimer = setInterval(() => { VexSync.syncNow(); }, 5 * 60 * 1000);
  }

  // ── Signing in ─────────────────────────────────────────────────────────────

  function deviceName() {
    return 'Vex on Android-' + Date.now().toString(36).slice(-4).toUpperCase();
  }

  async function settle(session, keyHex) {
    state.email = session.email;
    state.token = session.token;
    state.deviceId = session.deviceId;
    state.deviceName = session.deviceName;
    state.key = await SyncCrypto.importKey(SyncCrypto.hexToKey(keyHex));
    state.enabled = true;
    state.revision = 0;
    recordDocument = null;
    pullBlocked = false;
  }

  async function keep(keyHex) {
    await VexBridge.vaultSet('vex.syncToken', state.token);
    await VexBridge.vaultSet('vex.syncKey', keyHex);
    await saveMeta();
  }

  /** Give up on a half-finished sign-in, leaving nothing behind on the server. */
  async function abandon(session) {
    if (session) await deleteDevice(session.token, session.deviceId);
    pending = null;
    await forget();
  }

  /** Join an account that has data, with its recovery code. */
  async function join(session, recoveryCode) {
    let keyHex;
    try { keyHex = SyncCrypto.parseRecoveryCode(recoveryCode); SyncCrypto.hexToKey(keyHex); }
    catch { throw new Error('That isn’t a recovery code — it is 64 characters, in 8 groups of 8'); }
    await settle(session, keyHex);
    const pulled = await round(() => pullOnce({ joining: true }));
    if (!pulled.ok) {
      // The first pull put this phone in the account's device list; a wrong
      // code must not leave it there.
      await abandon(session);
      if (pulled.badKey) throw new Error('This recovery code doesn’t unlock this account’s data — check it and try again');
      throw new Error('Could not join: ' + (pulled.reason || 'the first sync failed'));
    }
    await keep(keyHex);
    pending = null;
    const pushed = await round(pushWithRetry);
    startTimers();
    return { ok: true, pushError: pushed.ok ? null : pushed.reason };
  }

  /** Start a new account from this phone: a new key, and the first document. */
  async function create(session) {
    const key = await SyncCrypto.generateKey();
    const keyHex = SyncCrypto.keyToHex(await SyncCrypto.exportKey(key));
    await settle(session, keyHex);
    // The account was empty when the code was checked; pull anyway, so a
    // device that started it meanwhile is found (and refused) rather than
    // overwritten.
    const pulled = await round(() => pullOnce({ joining: true }));
    if (!pulled.ok || !pulled.empty) {
      await abandon(session);
      throw new Error(pulled.ok ? 'Another device started this account a moment ago — sign in again with its recovery code' : 'Could not start sync: ' + pulled.reason);
    }
    const pushed = await round(pushWithRetry);
    if (!pushed.ok) {
      await abandon(session);
      throw new Error('Could not start sync: ' + pushed.reason);
    }
    await keep(keyHex);
    pending = null;
    startTimers();
    return { ok: true, recoveryCode: SyncCrypto.formatRecoveryCode(keyHex) };
  }

  return {
    state,
    SYNC_LEVEL,
    OWNED,
    configured,
    acceptableUrl,
    workerUrl: url,

    async setWorkerUrl(value) {
      const clean = String(value || '').trim().replace(/\/+$/, '');
      if (clean && !acceptableUrl(clean)) throw new Error('The sync worker URL has to be https://');
      await VexStore.set('vex.syncWorkerUrl', clean);
    },

    /** Bring the saved session back at boot. */
    async restore() {
      const meta = VexStore.get('vex.sync', null);
      if (!meta || !meta.email || !meta.enabled) return false;
      const token = await VexBridge.vaultGet('vex.syncToken');
      const keyHex = await VexBridge.vaultGet('vex.syncKey');
      if (!token || !keyHex) return false;
      try {
        state.key = await SyncCrypto.importKey(SyncCrypto.hexToKey(keyHex));
      } catch { return false; }
      state.email = meta.email;
      state.token = token;
      state.deviceId = meta.deviceId;
      state.deviceName = meta.deviceName || null;
      state.revision = meta.revision || 0;
      state.lastPullAt = meta.lastPullAt || null;
      state.lastPushAt = meta.lastPushAt || null;
      state.enabled = true;
      // Nothing is pushed until a pull has read the account (the desktop's
      // initFromDisk does the same).
      pullBlocked = true;
      await loadDocument();
      startTimers();
      return true;
    },

    async requestCode(email) {
      const clean = String(email || '').trim();
      if (!/^[^\s@]+@[^\s@]+$/.test(clean)) throw new Error('That is not an email address');
      const response = await request('/auth/request-code', { method: 'POST', body: { email: clean }, token: null });
      if (!response.ok) throw failure(response, 'Could not send a code');
      return response.body;
    },

    /**
     * Check the emailed code. An account with no data yet is started here, with
     * a new key: { created, recoveryCode }. One that has data needs its
     * recovery code: { needsRecoveryCode } — then call join(code), or abandon().
     * Given the recovery code up front, it joins straight away.
     */
    async signIn(email, code, recoveryCode = '') {
      const clean = String(email || '').trim();
      const response = await request('/auth/verify-code', {
        method: 'POST', token: null,
        body: { email: clean, code: String(code || '').trim(), deviceName: deviceName() }
      });
      if (!response.ok) throw failure(response, 'That code did not work');
      const { sessionToken, deviceId: id, hasEncryptedData } = response.body;
      if (!sessionToken || !id) throw new Error('The worker did not return a session');
      const session = { email: clean, token: sessionToken, deviceId: id, deviceName: deviceName() };
      if (recoveryCode) return { joined: true, ...(await join(session, recoveryCode)) };
      if (hasEncryptedData !== false) {
        pending = session;
        return { needsRecoveryCode: true };
      }
      return { created: true, ...(await create(session)) };
    },

    /** The recovery code, for the account signIn() said has data. */
    async join(recoveryCode) {
      if (!pending) throw new Error('Sign in with your email first');
      const session = pending;
      return join(session, recoveryCode);
    },

    /** Walk away from a sign-in waiting on its recovery code. */
    async abandon() { await abandon(pending); },

    pendingSignIn() { return !!pending; },

    /** Sign out here; `removeFromServer` also takes this phone off the account. */
    async signOut(removeFromServer = true) {
      if (removeFromServer && state.token && state.deviceId) await deleteDevice(state.token, state.deviceId);
      if (pending) await deleteDevice(pending.token, pending.deviceId);
      await forget();
      await VexStore.set('vex.syncDeletions', {});
    },

    async recoveryCode() {
      const hex = await VexBridge.vaultGet('vex.syncKey');
      return hex ? SyncCrypto.formatRecoveryCode(hex) : '';
    },

    pull() { return round(() => pullOnce()); },
    push() { return round(pushWithRetry); },

    /** Pull, and push if anything here differs from what was pulled. */
    syncNow() {
      return round(async () => {
        const pulled = await pullOnce();
        if (!pulled.ok) return pulled;
        if (pulled.needsPush) return pushWithRetry();
        return pulled;
      });
    },

    /** After a change here: batched, so a burst of edits is one upload. */
    schedulePush(delay = 4000) {
      if (!state.enabled) return;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => { pushTimer = null; VexSync.syncNow(); }, delay);
    },

    async devices() {
      const response = await request('/sync/devices');
      if (response.status === 401) { await signedOutByServer(); throw new Error('This phone is no longer signed in'); }
      if (response.status === 403) return [];          // not synced yet
      if (!response.ok) throw failure(response, 'Could not list your devices');
      if (!Array.isArray(response.body.devices)) throw new Error('Could not list your devices');
      return response.body.devices;
    },

    async forgetDevice(id) {
      const response = await request('/sync/devices/' + encodeURIComponent(id), { method: 'DELETE' });
      if (!response.ok) throw failure(response, 'Could not remove that device');
      if (id === state.deviceId) await forget();
      return true;
    },

    /** Wipe the account for every device; this phone is signed out with it. */
    async deleteEverything() {
      const response = await request('/sync/all', { method: 'DELETE' });
      if (!response.ok) throw failure(response, 'Could not delete the synced data');
      await forget();
    },

    // ── Send to My Devices (the worker's drop mailbox) ──────────────────────
    async sendToDevices(address, title = '') {
      if (!state.enabled) throw new Error('Sign in to Vex Sync first (Settings → Sync)');
      let parsed;
      try { parsed = new URL(address); } catch { throw new Error('Only web addresses can be sent'); }
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('Only web addresses can be sent');
      const encryptedBlob = await SyncCrypto.encrypt({ url: String(address).slice(0, 2048), title: String(title || '').slice(0, 300) }, state.key);
      const response = await request('/sync/drop', { method: 'POST', body: { encryptedBlob } });
      if (response.status === 401) { await signedOutByServer(); throw new Error('This phone is no longer signed in'); }
      if (response.status === 403) throw new Error('Sync once before sending — this phone has not synced yet');
      if (!response.ok) throw failure(response, 'Could not send');
      return true;
    },

    /** What other devices sent here. The worker hands each item over once. */
    async receiveFromDevices() {
      if (!state.enabled || !state.key) return [];
      let response;
      try { response = await request('/sync/drop'); } catch { return []; }
      if (!response.ok) return [];
      const items = [];
      for (const item of response.body.items || []) {
        if (!item || !item.encryptedBlob) continue;
        // One unreadable item must not lose the others: the server has
        // already handed them over.
        try {
          const payload = await SyncCrypto.decrypt(item.encryptedBlob, state.key);
          if (payload && typeof payload.url === 'string' && /^https?:$/.test(new URL(payload.url).protocol)) {
            items.push({ url: payload.url, title: String(payload.title || ''), from: String(item.fromDeviceName || ''), at: item.at });
          }
        } catch { /* skipped */ }
      }
      return items;
    },

    remoteTabs() { return state.remoteTabs; },

    /** You deleted these here: the next push deletes them on every device. */
    async noteDeleted(source, ids) {
      if (!OWNED.includes(source)) return;
      const set = deletions(source);
      for (const id of ids) if (id) set.add(String(id));
      await setDeletions(source, set);
    },

    /** Undo of a deletion that has not been sent yet. */
    async noteRestored(source, ids) {
      if (!OWNED.includes(source)) return;
      const set = deletions(source);
      for (const id of ids) set.delete(String(id));
      await setDeletions(source, set);
    },

    // For tests and the diagnostics page.
    _document: () => recordDocument
  };
})();

if (typeof window !== 'undefined') window.VexSync = VexSync;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSync };
