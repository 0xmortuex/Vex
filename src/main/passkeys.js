// === Passkeys: Vex as a WebAuthn authenticator =============================
//
// A page asks for a passkey (navigator.credentials.create / get with a
// `publicKey`); the guest preload (src/preload-passkeys.js) hands the request
// here; Vex asks the person in its own window (js/passkeys.js) and, only if
// they agree, creates or signs in THIS process. The private key is made here,
// kept encrypted with the operating system's key store (safeStorage, like the
// password vault), and never leaves this process: not to the page, not to the
// window, not to a log, a backup or a problem report. Only the finished
// signature does.
//
// What a page can and cannot do (the asking frame is main's own, never the
// page's word):
//   - the origin in clientDataJSON is the frame's real URL as this process
//     sees it; the rp id must be that host or a domain above it;
//   - nothing is created or signed without the person's click in Vex's window;
//   - a private, Tor or burner tab is refused, and so is a locked Vex;
//   - the page learns "NotAllowedError" for a refusal, a cancel and "no
//     passkey here" alike, so it cannot tell which accounts exist.
const crypto = require('crypto');
const path = require('path');
const pc = require('./passkey-crypto');
const { PasskeyError } = pc;

const MAX_REQUEST_MS = 10 * 60 * 1000;
const DEFAULT_REQUEST_MS = 5 * 60 * 1000;
const UNDO_MS = 2 * 60 * 1000;
const MAX_RECORDS = 2000;
const NATIVE_TRANSPORTS = new Set(['usb', 'nfc', 'ble']);

const isB64u = (s, max = 4096) => typeof s === 'string' && s.length <= max && /^[A-Za-z0-9_-]*$/.test(s) && s.length % 4 !== 1;
const text = (s, max) => typeof s === 'string' && s.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s);

// Should this request go to the browser's own flow (a hardware security key,
// a phone) instead of Vex? Decided from what the site asked for.
function wantsNative(op, req) {
  const hints = Array.isArray(req.hints) ? req.hints : [];
  if (hints[0] === 'security-key' || hints[0] === 'hybrid') return true;
  if (op === 'create') return req.authenticatorSelection?.authenticatorAttachment === 'cross-platform';
  const allow = Array.isArray(req.allowCredentials) ? req.allowCredentials : [];
  return allow.length > 0 && allow.every(c => Array.isArray(c.transports) && c.transports.length > 0 && c.transports.every(t => NATIVE_TRANSPORTS.has(t)));
}

// The request the preload sends, checked field by field; anything off is a
// TypeError to the page (as a browser's own parsing would raise).
function normalizeRequest(req) {
  const bad = (m) => new PasskeyError('TypeError', m);
  if (!req || typeof req !== 'object' || Array.isArray(req)) throw bad('Invalid passkey request');
  if (req.op !== 'create' && req.op !== 'get') throw bad('Invalid passkey request');
  if (!isB64u(req.id, 64) || !req.id) throw bad('Invalid passkey request id');
  const pk = req.publicKey;
  if (!pk || typeof pk !== 'object') throw bad('publicKey is missing');
  if (!isB64u(pk.challenge, 4096) || !pk.challenge) throw bad('The challenge is missing');
  const out = { op: req.op, id: req.id, mediation: req.mediation === 'conditional' ? 'conditional' : 'optional', challenge: pk.challenge };
  out.timeoutMs = Number.isFinite(pk.timeout) && pk.timeout > 0 ? Math.min(pk.timeout, MAX_REQUEST_MS) : DEFAULT_REQUEST_MS;
  out.hasTimeout = Number.isFinite(pk.timeout) && pk.timeout > 0;
  out.userVerification = ['required', 'preferred', 'discouraged'].includes(pk.userVerification) ? pk.userVerification : 'preferred';
  out.hints = Array.isArray(pk.hints) ? pk.hints.filter(h => typeof h === 'string').slice(0, 5) : [];
  const list = (arr) => {
    if (arr === undefined || arr === null) return [];
    if (!Array.isArray(arr) || arr.length > 64) throw bad('The credential list is not valid');
    return arr.map(c => {
      if (!c || !isB64u(c.id, 1400) || !c.id) throw bad('A credential id is not valid');
      return { id: c.id, transports: Array.isArray(c.transports) ? c.transports.filter(t => typeof t === 'string').slice(0, 6) : [] };
    });
  };
  if (req.op === 'get') {
    if (pk.rpId !== undefined && pk.rpId !== null && typeof pk.rpId !== 'string') throw bad('rpId is not valid');
    out.rpId = pk.rpId ?? undefined;
    out.allowCredentials = list(pk.allowCredentials);
    return out;
  }
  const rp = pk.rp, user = pk.user;
  if (!rp || typeof rp !== 'object' || !text(rp.name, 512)) throw bad('rp.name is not valid');
  if (rp.id !== undefined && rp.id !== null && typeof rp.id !== 'string') throw bad('rp.id is not valid');
  if (!user || typeof user !== 'object' || !isB64u(user.id, 128) || !user.id || Buffer.from(user.id, 'base64url').length > 64) throw bad('user.id must be 1 to 64 bytes');
  if (!text(user.name, 512) || !text(user.displayName ?? '', 512)) throw bad('The user name is not valid');
  out.rp = { id: rp.id ?? undefined, name: rp.name };
  out.user = { id: user.id, name: user.name, displayName: user.displayName || '' };
  const params = Array.isArray(pk.pubKeyCredParams) ? pk.pubKeyCredParams : null;
  if (!params || params.length > 32) throw bad('pubKeyCredParams is not valid');
  out.algs = params.filter(p => p && p.type === 'public-key' && Number.isInteger(p.alg)).map(p => p.alg);
  out.excludeCredentials = list(pk.excludeCredentials);
  const sel = pk.authenticatorSelection && typeof pk.authenticatorSelection === 'object' ? pk.authenticatorSelection : {};
  out.authenticatorSelection = { authenticatorAttachment: ['platform', 'cross-platform'].includes(sel.authenticatorAttachment) ? sel.authenticatorAttachment : undefined };
  if (sel.userVerification && ['required', 'preferred', 'discouraged'].includes(sel.userVerification)) out.userVerification = sel.userVerification;
  out.wantsCredProps = !!(pk.extensions && pk.extensions.credProps === true);
  return out;
}

function createPasskeyService({
  safeStorage, ipcMain, atomicWrite, userDataPath,
  isLocked = () => false,
  hasPin = () => false,
  verifyPin = async () => ({ ok: false, error: 'No PIN' }),
  ownerOf = () => null,
  partitionOf = () => '',
  isTorContents = () => false,
  suppressedFor = () => false,
  syncOn = () => false,
  windowSend = () => false,
  onChange = () => {},
  now = () => Date.now(),
  random = (n) => crypto.randomBytes(n),
}) {
  if (!safeStorage || !ipcMain || typeof atomicWrite !== 'function' || !userDataPath) throw new Error('createPasskeyService: missing dependency');
  const FILE = () => path.join(userDataPath, 'passkeys.dat');
  const fs = require('fs');
  let cache = null;
  let writes = Promise.resolve();
  const trash = new Map();               // undo token -> { record, timer }
  const pending = new Map();             // webContents id -> { id, cancel(reason) }
  const asks = new Map();                // ask id -> { resolve, wcId, handler }
  const conditional = new Map();         // request id -> { wcId, ctx }

  // --- Storage --------------------------------------------------------------
  function load() {
    if (isLocked()) throw new PasskeyError('NotAllowedError', 'Vex is locked');
    if (cache) return cache.map(r => ({ ...r }));
    if (!fs.existsSync(FILE())) { cache = []; return []; }
    let arr;
    try { arr = JSON.parse(safeStorage.decryptString(fs.readFileSync(FILE()))); }
    catch (err) { console.error('[Passkeys] load failed:', err.message); throw new Error('Cannot read the encrypted passkey store; it has been left as it is', { cause: err }); }
    if (!Array.isArray(arr)) throw new Error('Invalid passkey store');
    cache = arr;
    return arr.map(r => ({ ...r }));
  }
  async function save(list) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption unavailable');
    if (list.length > MAX_RECORDS) throw new Error('There are too many passkeys');
    const bytes = safeStorage.encryptString(JSON.stringify(list));
    const before = cache;
    cache = list.map(r => ({ ...r }));
    writes = writes.catch(() => {}).then(() => atomicWrite(FILE(), bytes));
    try { await writes; } catch (err) { cache = before; throw err; }
    onChange();
  }
  const publicView = (r) => ({
    credentialId: r.credentialId, rpId: r.rpId, rpName: r.rpName, userName: r.userName, userDisplayName: r.userDisplayName,
    nickname: r.nickname || '', createdAt: r.createdAt, lastUsedAt: r.lastUsedAt || null, deviceOnly: !r.backupEligible,
  });

  // --- Who is asking --------------------------------------------------------
  // Refused: a private window, a Tor tab, a burner or off-the-record tab (a
  // partition that is not persistent), and anything routed through Tor.
  function whyRefused(wc) {
    const owner = ownerOf(wc);
    if (!owner) return 'This page is not in a Vex tab';
    if (owner.privatePartition) return 'Passkeys are not used in private windows';
    const partition = String(partitionOf(wc) || '');
    if (!partition.startsWith('persist:')) return 'Passkeys are not used in private, burner or temporary tabs';
    if (partition === 'persist:route-tor' || partition.startsWith('persist:container-tor-') || isTorContents(wc)) return 'Passkeys are not used in Tor tabs';
    return null;
  }
  function toast(wc, message, kind = 'warning') {
    const owner = ownerOf(wc);
    if (owner && owner.win && !owner.win.isDestroyed()) windowSend(owner.win, 'passkeys:notice', { message, kind });
  }

  // --- Asking the person ----------------------------------------------------
  // Shows the sheet in the window that owns the tab and waits for its answer.
  // `handler(answer)` may return { error } to keep the sheet open (a wrong PIN).
  function ask(wc, payload, handler, timeoutMs) {
    const owner = ownerOf(wc);
    if (!owner || !owner.win || owner.win.isDestroyed()) return Promise.reject(new PasskeyError('NotAllowedError', 'There is no Vex window to ask in'));
    const askId = random(12).toString('base64url');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(null, new PasskeyError('NotAllowedError', 'The passkey request timed out')), timeoutMs);
      const entry = { wcId: wc.id, handler, finish };
      function finish(value, err) {
        if (!asks.has(askId)) return;
        clearTimeout(timer);
        asks.delete(askId);
        windowSend(owner.win, 'passkeys:ask-cancel', { id: askId });
        if (err) reject(err); else resolve(value);
      }
      asks.set(askId, entry);
      entry.cancel = (err) => finish(null, err);
      if (!windowSend(owner.win, 'passkeys:ask', { id: askId, wcId: wc.id, ...payload })) finish(null, new PasskeyError('NotAllowedError', 'The Vex window could not be reached'));
    });
  }

  // The window's answer (UI frame only; see ipc-policy UI_ONLY_CHANNELS).
  async function answer(id, a) {
    const entry = asks.get(id);
    if (!entry) return { ok: false, gone: true };
    if (!a || typeof a !== 'object') throw new Error('Invalid answer');
    if (a.action === 'cancel') { entry.finish({ action: 'cancel' }); return { ok: true }; }
    if (isLocked()) { entry.finish(null, new PasskeyError('NotAllowedError', 'Vex is locked')); return { ok: false, gone: true }; }
    const r = await entry.handler(a);
    if (r && r.error) return { ok: false, error: r.error };
    entry.finish(r);
    return { ok: true };
  }

  // PIN as user verification. Returns { uv } or { error }.
  async function checkUv(mode, pin) {
    const pinSet = hasPin();
    if (mode === 'discouraged') return { uv: false };
    if (typeof pin === 'string' && pin) {
      if (!pinSet) return { error: 'There is no Vex PIN to check' };
      const r = await verifyPin(pin);
      if (!r.ok) return { error: r.error || 'Wrong PIN' };
      return { uv: true };
    }
    if (mode === 'required') return { error: pinSet ? 'Enter your Vex PIN to continue' : 'This site needs a PIN. Set a Vex PIN in Settings › Privacy & Security first.' };
    return { uv: false };
  }

  // --- The requests ---------------------------------------------------------
  function cancelAsks(wcId, err) { for (const [, e] of [...asks]) if (e.wcId === wcId) e.cancel(err); }
  function supersede(wc, id, ctxCancel) {
    const prior = pending.get(wc.id);
    if (prior) prior.cancel(new PasskeyError('AbortError', 'The request was replaced by a newer one'));
    pending.set(wc.id, { id, cancel: ctxCancel });
    const drop = () => { const p = pending.get(wc.id); if (p && p.id === id) pending.delete(wc.id); };
    return drop;
  }

  // A page that keeps asking after the person said no is stopped: three
  // refusals in a minute and it is refused outright for the next minute,
  // so a page cannot wear anyone down with sheets.
  const declined = new Map();           // "<tab>|<rp id>" -> times of the person's refusals
  const DECLINE_WINDOW_MS = 60 * 1000, DECLINE_LIMIT = 3;
  const recent = (key) => { const t = now(); const list = (declined.get(key) || []).filter(x => t - x < DECLINE_WINDOW_MS); declined.set(key, list); return list; };
  const noteDeclined = (wc, site) => { const key = wc.id + '|' + site.rpId; recent(key).push(now()); };
  const askedTooOften = (wc, site) => recent(wc.id + '|' + site.rpId).length >= DECLINE_LIMIT;

  // A tab that navigates or closes takes its pending requests with it.
  const watched = new WeakSet();
  function watch(wc) {
    if (watched.has(wc) || typeof wc.on !== 'function') return;
    watched.add(wc);
    const id = wc.id;
    wc.on('did-navigate', () => forgetContents(id));
    wc.once('destroyed', () => forgetContents(id));
  }

  async function handleRequest(event, raw) {
    const wc = event.sender;
    const frame = event.senderFrame;
    if (!frame || frame !== wc.mainFrame) throw new PasskeyError('NotAllowedError', 'Passkeys are handled for the top page only');
    const req = normalizeRequest(raw);
    // A security key or phone: not Vex's to answer.
    if (wantsNative(req.op, req)) return { fallback: true };
    let site;
    try { site = pc.resolveRpId(req.op === 'create' ? req.rp.id : req.rpId, frame.url); }
    catch (err) { throw err instanceof PasskeyError ? err : new PasskeyError('SecurityError', err.message); }
    if (suppressedFor(site.host)) throw new PasskeyError('NotAllowedError', 'Passkeys are turned off for this site in Vex');
    const refused = whyRefused(wc);
    if (refused) { toast(wc, refused + '. Use the site’s other sign-in methods.'); throw new PasskeyError('NotAllowedError', 'The request is not allowed'); }
    if (isLocked()) { toast(wc, 'Vex is locked. Unlock it to use a passkey.'); throw new PasskeyError('NotAllowedError', 'Vex is locked'); }
    watch(wc);
    if (req.mediation !== 'conditional' && askedTooOften(wc, site)) {
      toast(wc, site.host + ' asked for a passkey too many times, so Vex stopped asking for a minute.');
      throw new PasskeyError('NotAllowedError', 'The request is not allowed');
    }
    if (req.op === 'create') return create(wc, req, site);
    return get(wc, req, site);
  }

  async function create(wc, req, site) {
    if (!req.algs.includes(pc.ALG_ES256)) throw new PasskeyError('NotSupportedError', 'Vex passkeys use the ES256 algorithm, which this site does not accept');
    const records = load();
    const own = records.filter(r => r.rpId === site.rpId);
    const excluded = req.excludeCredentials.find(c => own.some(r => r.credentialId === c.id));
    const sameUser = own.find(r => r.userHandle === req.user.id);
    const drop = supersede(wc, req.id, (err) => cancelAsks(wc.id, err));
    const pinMode = req.userVerification;
    try {
      if (excluded) {
        // Per spec the site is told this device already has a credential only
        // after the person has been shown it.
        await ask(wc, { kind: 'exists', host: site.host, rpId: site.rpId, rpName: req.rp.name, userName: req.user.name }, async () => ({ action: 'ok' }), req.timeoutMs);
        throw new PasskeyError('InvalidStateError', 'A passkey for this account already exists on this device');
      }
      const wantPin = pinMode === 'required' || (pinMode === 'preferred' && hasPin());
      const answerP = ask(wc, {
        kind: 'create', host: site.host, rpId: site.rpId, rpName: req.rp.name, userName: req.user.name, userDisplayName: req.user.displayName,
        existing: own.map(publicView), replaces: sameUser ? publicView(sameUser) : null,
        uv: pinMode === 'required' ? 'required' : (wantPin ? 'optional' : 'none'), hasPin: hasPin(), syncOn: syncOn(),
      }, async (a) => {
        if (a.action === 'never') return { action: 'never' };
        if (a.action !== 'save') throw new Error('Invalid answer');
        const uv = await checkUv(pinMode, a.pin);
        if (uv.error) return { error: uv.error };
        const nickname = typeof a.nickname === 'string' ? a.nickname.trim().slice(0, 80) : '';
        return { action: 'save', uv: uv.uv, nickname };
      }, req.timeoutMs);
      const a = await answerP;
      if (!a || a.action === 'cancel' || a.action === 'never') { noteDeclined(wc, site); throw new PasskeyError('NotAllowedError', 'The passkey was not saved'); }
      return await finishCreate(req, site, a);
    } finally { drop(); }
  }

  async function finishCreate(req, site, a) {
    const key = pc.generateCredentialKey();
    const credentialId = random(32);
    const backupEligible = syncOn();
    const authData = pc.buildAuthData({
      rpId: site.rpId, userPresent: true, userVerified: !!a.uv, backupEligible, backupState: backupEligible,
      signCount: 0, credentialId, coseKey: pc.coseKeyEs256(key.x, key.y),
    });
    const clientDataJSON = pc.buildClientDataJSON({ type: 'webauthn.create', challenge: req.challenge, origin: site.origin });
    const stamp = new Date(now()).toISOString();
    const record = {
      credentialId: pc.b64u(credentialId), rpId: site.rpId, rpName: req.rp.name, userHandle: req.user.id,
      userName: req.user.name, userDisplayName: req.user.displayName, ...(a.nickname ? { nickname: a.nickname } : {}),
      privateKeyPkcs8: pc.b64u(key.privateKeyPkcs8), publicKeySpki: pc.b64u(key.publicKeySpki),
      createdAt: stamp, lastUsedAt: stamp, updatedAt: stamp, signCount: 0, backupEligible,
    };
    // One passkey per account at a site: a new one for the same user replaces it.
    const list = load().filter(r => !(r.rpId === site.rpId && r.userHandle === req.user.id));
    list.push(record);
    await save(list);
    return {
      ok: true, kind: 'create',
      credential: {
        id: record.credentialId, rawId: record.credentialId,
        clientDataJSON: pc.b64u(clientDataJSON), attestationObject: pc.b64u(pc.attestationObjectNone(authData)),
        authenticatorData: pc.b64u(authData), publicKey: record.publicKeySpki, publicKeyAlgorithm: pc.ALG_ES256,
        transports: ['internal'], authenticatorAttachment: 'platform',
        clientExtensionResults: req.wantsCredProps ? { credProps: { rk: true } } : {},
      },
    };
  }

  function candidatesFor(req, site) {
    const own = load().filter(r => r.rpId === site.rpId);
    if (!req.allowCredentials.length) return own;
    const ids = new Set(req.allowCredentials.map(c => c.id));
    return own.filter(r => ids.has(r.credentialId));
  }

  async function signFor(req, site, record, uv) {
    const authData = pc.buildAuthData({
      rpId: site.rpId, userPresent: true, userVerified: !!uv,
      backupEligible: !!record.backupEligible, backupState: !!record.backupEligible && syncOn(),
      // A synced passkey reports 0 for ever (a counter cannot be kept in step
      // across devices); a device-only one counts up.
      signCount: record.backupEligible ? 0 : (record.signCount || 0) + 1,
    });
    const clientDataJSON = pc.buildClientDataJSON({ type: 'webauthn.get', challenge: req.challenge, origin: site.origin });
    const signature = pc.signAssertion(pc.fromB64u(record.privateKeyPkcs8), authData, clientDataJSON);
    const list = load();
    const mine = list.find(r => r.credentialId === record.credentialId);
    if (!mine) throw new PasskeyError('NotAllowedError', 'That passkey is no longer on this device');
    mine.lastUsedAt = new Date(now()).toISOString();
    if (!record.backupEligible) mine.signCount = (mine.signCount || 0) + 1;
    await save(list);
    return {
      ok: true, kind: 'get',
      credential: {
        id: record.credentialId, rawId: record.credentialId, clientDataJSON: pc.b64u(clientDataJSON),
        authenticatorData: pc.b64u(authData), signature: pc.b64u(signature), userHandle: record.userHandle,
        authenticatorAttachment: 'platform', clientExtensionResults: {},
      },
    };
  }

  async function get(wc, req, site) {
    const mode = req.userVerification;
    if (req.mediation === 'conditional') return getConditional(wc, req, site);
    const drop = supersede(wc, req.id, (err) => cancelAsks(wc.id, err));
    try {
      const wantPin = mode === 'required' || (mode === 'preferred' && hasPin());
      const matches = candidatesFor(req, site);
      const answerP = ask(wc, {
        kind: 'get', host: site.host, rpId: site.rpId,
        accounts: matches.map(publicView),
        uv: mode === 'required' ? 'required' : (wantPin ? 'optional' : 'none'), hasPin: hasPin(),
      }, async (a) => {
        if (a.action === 'native') return { action: 'native' };
        if (a.action !== 'use') throw new Error('Invalid answer');
        const record = matches.find(r => r.credentialId === a.credentialId);
        if (!record) return { error: 'That passkey is not available' };
        const uv = await checkUv(mode, a.pin);
        if (uv.error) return { error: uv.error };
        return { action: 'use', record, uv: uv.uv };
      }, req.timeoutMs);
      const a = await answerP;
      if (!a || a.action === 'cancel') { noteDeclined(wc, site); throw new PasskeyError('NotAllowedError', 'The request was cancelled'); }
      if (a.action === 'native') return { fallback: true };
      return await signFor(req, site, a.record, a.uv);
    } finally { drop(); }
  }

  // Conditional mediation: no sheet; the request waits until the person picks
  // a passkey from the list under a field marked autocomplete="webauthn"
  // (or the page aborts / leaves).
  function getConditional(wc, req, site) {
    return new Promise((resolve, reject) => {
      const ctx = { wcId: wc.id, req, site, uvMode: req.userVerification };
      let done = false;
      const settle = (fn, value) => {
        if (done) return;
        done = true;
        clearTimeout(ctx.expire);
        conditional.delete(req.id);
        drop();
        fn(value);
      };
      const drop = supersede(wc, req.id, (err) => settle(reject, err));
      ctx.resolve = (value) => settle(resolve, value);
      ctx.reject = (err) => settle(reject, err);
      // A field's list waits as long as the page is open unless the site gave a timeout.
      if (req.hasTimeout) {
        ctx.expire = setTimeout(() => ctx.reject(new PasskeyError('NotAllowedError', 'The passkey request timed out')), req.timeoutMs);
        ctx.expire.unref?.();
      }
      ctx.matches = () => candidatesFor(req, site);
      conditional.set(req.id, ctx);
    });
  }

  // The list for a field's chooser (guest preload asks; only for this tab's
  // own pending request).
  function conditionalList(event, id) {
    const ctx = conditional.get(String(id));
    if (!ctx || ctx.wcId !== event.sender.id) return { accounts: [] };
    return { accounts: ctx.matches().map(publicView), uv: ctx.uvMode, hasPin: hasPin() };
  }
  async function conditionalChoose(id, credentialId, pin) {
    const ctx = conditional.get(String(id));
    if (!ctx) return { ok: false, error: 'That request is gone' };
    if (isLocked()) { ctx.reject(new PasskeyError('NotAllowedError', 'Vex is locked')); return { ok: false, error: 'Vex is locked' }; }
    const record = ctx.matches().find(r => r.credentialId === credentialId);
    if (!record) return { ok: false, error: 'That passkey is not available' };
    const uv = await checkUv(ctx.uvMode, pin);
    if (uv.error) return { ok: false, error: uv.error, needsPin: ctx.uvMode === 'required' || hasPin() };
    clearTimeout(ctx.expire);
    try { ctx.resolve(await signFor(ctx.req, ctx.site, record, uv.uv)); return { ok: true }; }
    catch (err) { ctx.reject(err); return { ok: false, error: err.message }; }
  }
  function cancelRequest(event, id) {
    const p = pending.get(event.sender.id);
    if (p && p.id === String(id)) p.cancel(new PasskeyError('AbortError', 'The request was aborted'));
  }
  // The tab navigated or closed: nothing it asked for is still wanted.
  function forgetContents(wcId) {
    const p = pending.get(wcId);
    if (p) p.cancel(new PasskeyError('AbortError', 'The page went away'));
    cancelAsks(wcId, new PasskeyError('AbortError', 'The page went away'));
  }

  // --- Settings -------------------------------------------------------------
  function list() { return load().map(publicView).sort((a, b) => a.rpId.localeCompare(b.rpId) || a.userName.localeCompare(b.userName)); }
  async function remove(credentialId) {
    const all = load();
    const record = all.find(r => r.credentialId === credentialId);
    if (!record) return { ok: false, error: 'That passkey is already gone' };
    await save(all.filter(r => r.credentialId !== credentialId));
    const token = random(16).toString('base64url');
    const timer = setTimeout(() => trash.delete(token), UNDO_MS);
    timer.unref?.();
    trash.set(token, { record, timer });
    return { ok: true, undo: token };
  }
  async function undoRemove(token) {
    const t = trash.get(token);
    if (!t) return { ok: false, error: 'It is too late to undo that' };
    clearTimeout(t.timer);
    trash.delete(token);
    const all = load();
    if (!all.some(r => r.credentialId === t.record.credentialId)) { all.push({ ...t.record, updatedAt: new Date(now()).toISOString() }); await save(all); }
    return { ok: true };
  }
  async function rename(credentialId, nickname) {
    const all = load();
    const r = all.find(x => x.credentialId === credentialId);
    if (!r) return { ok: false, error: 'That passkey is gone' };
    const name = String(nickname || '').trim().slice(0, 80);
    if (name) r.nickname = name; else delete r.nickname;
    r.updatedAt = new Date(now()).toISOString();
    await save(all);
    return { ok: true };
  }

  // The synced subset, as the sync-secrets "passkeys" store: only passkeys
  // made while sync was on (backup eligible) travel.
  const syncStore = {
    load: () => load().filter(r => r.backupEligible),
    save: async (next) => {
      const keep = load().filter(r => !r.backupEligible);
      const byId = new Map(load().map(r => [r.credentialId, r]));
      const merged = next.map(n => ({ ...n, backupEligible: true, signCount: 0, lastUsedAt: byId.get(n.credentialId)?.lastUsedAt || null }));
      await save([...keep, ...merged]);
    },
  };

  // A record arriving through sync must be a working key pair.
  function validateRecord(entry) {
    const derived = crypto.createPublicKey(crypto.createPrivateKey({ key: pc.fromB64u(entry.privateKeyPkcs8), format: 'der', type: 'pkcs8' }))
      .export({ format: 'der', type: 'spki' });
    if (!derived.equals(pc.fromB64u(entry.publicKeySpki))) throw new Error('A synced passkey\'s keys do not match');
  }

  function register() {
    ipcMain.handle('passkeys:request', async (event, req) => {
      try { return await handleRequest(event, req); }
      catch (err) {
        if (err instanceof PasskeyError) return { ok: false, name: err.name, message: err.message };
        console.error('[Passkeys] request failed:', err && err.message);
        return { ok: false, name: 'NotAllowedError', message: 'The passkey request failed' };
      }
    });
    ipcMain.on('passkeys:cancel', (event, id) => cancelRequest(event, id));
    ipcMain.handle('passkeys:conditional-list', (event, id) => conditionalList(event, id));
    ipcMain.handle('passkeys:conditional-choose', (_e, id, credentialId, pin) => conditionalChoose(id, credentialId, pin));
    ipcMain.handle('passkeys:answer', (_e, id, a) => answer(id, a));
    ipcMain.handle('passkeys:list', () => list());
    ipcMain.handle('passkeys:delete', (_e, credentialId) => remove(credentialId));
    ipcMain.handle('passkeys:undo-delete', (_e, token) => undoRemove(token));
    ipcMain.handle('passkeys:rename', (_e, credentialId, nickname) => rename(credentialId, nickname));
  }

  return { register, load, save, list, remove, undoRemove, rename, syncStore, handleRequest, answer, forgetContents, conditionalList, conditionalChoose, publicView, whyRefused, validateRecord };
}

module.exports = { createPasskeyService, normalizeRequest, wantsNative };
