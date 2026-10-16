// === Permission hygiene: expiry, a guard for prompts nobody asked for, a live indicator (T2-084) ===
//
// Three small rules on top of src/main/permissions.js, all OFF until the person
// switches the feature on (js/permission-hygiene-ui.js pushes the switch):
//
//   expiry      A camera, microphone, location, notification, screen or clipboard
//               grant that the person chose to keep "for ever" lasts N days (30 by
//               default) unless the site is pinned. It uses the "until" record the
//               permission store already has ("Allow for a day"), so past its end the
//               site simply asks again. Grants made before the switch are left alone.
//   trap guard  A notification, location, clipboard or MIDI prompt that fires with no
//               click or key press on the page is not shown: it is answered "no" this
//               once, kept off the saved list, and listed so the person can still
//               allow it. A prompt that follows a click is shown as always.
//   indicator   Which tab has just been given (or used) the camera, microphone,
//               location or screen, and a button to stop it. Chromium tells Electron
//               when a page asks, not when it stops, so the badge says "used in this
//               tab" and clears when the tab navigates or closes.
//
// "A per-site never for clipboard-read and local-network access" already exists:
// a saved Block is never asked again, clipboard-read is in the site panel, and a
// local-network permission is not in the list Vex ever prompts for (it is refused
// unasked). Nothing was added for it.
//
// This file holds the rules only. It reads and writes nothing but its own small
// settings file, and never a cookie, a page or a password.
'use strict';

const fs = require('fs');
const path = require('path');

const DAY_MS = 24 * 60 * 60 * 1000;
// What decays, in the names permissions.js stores them under.
const EXPIRING = new Set(['camera', 'microphone', 'geolocation', 'notifications', 'display-capture', 'clipboard-read', 'midi', 'midiSysex']);
// What a page may not ask for out of nowhere.
const TRAP_GUARDED = new Set(['notifications', 'geolocation', 'clipboard-read', 'midi', 'midiSysex']);
const LIVE_PARTS = new Set(['camera', 'microphone', 'geolocation', 'display-capture']);
const MIN_DAYS = 1;
const MAX_DAYS = 365;
const MAX_QUIETED = 20;

const PLAIN = {
  camera: 'your camera', microphone: 'your microphone', geolocation: 'your location', notifications: 'to send you notifications',
  'display-capture': 'your screen', 'clipboard-read': 'what you copied', midi: 'your MIDI devices', midiSysex: 'your MIDI devices',
};
const LINE = {
  camera: 'your camera', microphone: 'your microphone', geolocation: 'your location', notifications: 'send you notifications',
  'display-capture': 'share your screen', 'clipboard-read': 'read your clipboard', midi: 'use your MIDI devices', midiSysex: 'use your MIDI devices',
};

const DEFAULT_CONFIG = Object.freeze({ enabled: false, expiryDays: 30, expiry: true, trapGuard: true, indicator: true });

function cleanConfig(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('The permission settings have to be an object');
  const out = { ...DEFAULT_CONFIG };
  for (const k of ['enabled', 'expiry', 'trapGuard', 'indicator']) {
    if (c[k] !== undefined) {
      if (typeof c[k] !== 'boolean') throw new Error('Permission setting "' + k + '" is on or off');
      out[k] = c[k];
    }
  }
  if (c.expiryDays !== undefined) {
    if (!Number.isInteger(c.expiryDays) || c.expiryDays < MIN_DAYS || c.expiryDays > MAX_DAYS) throw new Error('Grants can last from ' + MIN_DAYS + ' to ' + MAX_DAYS + ' days');
    out.expiryDays = c.expiryDays;
  }
  return out;
}

// "origin::permission" with any "(in the work container)" label removed: a pin covers the site everywhere.
function pinKey(key) {
  const k = String(key);
  const at = k.indexOf('::');
  if (at < 0) throw new Error('Not a permission key: ' + k);
  const origin = k.slice(0, at).replace(/ \([^()]*\)$/, '');
  return origin + k.slice(at);
}

function createPermissionHygiene({ file = null, now = () => Date.now(), emit = () => {}, log = () => {} } = {}) {
  let config = { ...DEFAULT_CONFIG };
  let pins = {};
  if (file) {
    let raw = null;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw new Error('Permission hygiene settings could not be read: ' + err.message); }
    if (raw) {
      const saved = JSON.parse(raw);
      config = cleanConfig(saved.config || {});
      pins = saved.pins && typeof saved.pins === 'object' && !Array.isArray(saved.pins) ? saved.pins : {};
    }
  }
  const quieted = [];
  const live = new Map();       // contents id -> { origin, parts: Set, at }
  const watched = new WeakSet();

  function persist() {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ config, pins }, null, 1));
  }

  const on = () => config.enabled === true;

  return {
    getConfig() { return { ...config }; },
    setConfig(next) { config = cleanConfig({ ...config, ...next }); persist(); return { ...config }; },

    // ---- expiry ---------------------------------------------------------------
    isPinned(origin, permission) { return !!pins[origin + '::' + permission]; },
    pinned() { return { ...pins }; },
    setPinned(key, value) {
      const k = pinKey(key);
      if (value) pins[k] = now(); else delete pins[k];
      persist();
      return !!value;
    },
    // When a grant kept for ever, made now, should end: a time in ms, or null for "never".
    expiryFor(origin, permission) {
      if (!on() || !config.expiry || !EXPIRING.has(permission) || pins[origin + '::' + permission]) return null;
      return now() + config.expiryDays * DAY_MS;
    },

    // ---- trap guard -------------------------------------------------------------
    // -> null (ask as usual) or { id, origin, permission, at }, the entry that was kept.
    trap({ origin, permission, gesture, contentsId = null }) {
      if (!on() || !config.trapGuard || gesture || !TRAP_GUARDED.has(permission)) return null;
      const entry = { id: 'q' + now().toString(36) + Math.random().toString(36).slice(2, 6), origin, permission, at: now(), contentsId };
      quieted.unshift(entry);
      if (quieted.length > MAX_QUIETED) quieted.length = MAX_QUIETED;
      emit('quieted', entry);
      return entry;
    },
    quieted() { return quieted.map(q => ({ ...q })); },
    takeQuieted(id) {
      const i = quieted.findIndex(q => q.id === id);
      if (i < 0) throw new Error('That request is no longer in the list');
      return quieted.splice(i, 1)[0];
    },

    // ---- indicator ---------------------------------------------------------------
    // contents: the page; parts: the permission names it was given or used.
    noteUse(contents, origin, parts) {
      if (!on() || !config.indicator || !contents) return false;
      const used = (Array.isArray(parts) ? parts : []).filter(p => LIVE_PARTS.has(p));
      if (!used.length) return false;
      const id = contents.id;
      const rec = live.get(id) || { origin, parts: new Set(), at: now() };
      rec.origin = origin;
      rec.at = now();
      for (const p of used) rec.parts.add(p);
      live.set(id, rec);
      if (!watched.has(contents)) {
        watched.add(contents);
        const end = () => { if (live.delete(id)) emit('live', { contentsId: id, origin: '', parts: [] }); };
        contents.on('did-navigate', end);
        contents.once('destroyed', end);
      }
      emit('live', { contentsId: id, origin, parts: [...rec.parts] });
      return true;
    },
    liveFor(contentsId) {
      const r = live.get(contentsId);
      return r ? { contentsId, origin: r.origin, parts: [...r.parts], at: r.at } : null;
    },
    liveAll() { return [...live].map(([contentsId, r]) => ({ contentsId, origin: r.origin, parts: [...r.parts], at: r.at })); },
    clearLive(contentsId) { if (live.delete(contentsId)) emit('live', { contentsId, origin: '', parts: [] }); },

    log,
  };
}

// ---- the list in Settings (pure) ----------------------------------------------------
// decisions: what loadPermissionDecisions() returns (keys "origin::permission", or
// "origin (in the work container)::permission", plus __until__). -> rows and the lines.
function summarize(decisions, pins, now, soonDays = 3) {
  const until = (decisions && decisions.__until__) || {};
  const rows = [];
  for (const [key, value] of Object.entries(decisions || {})) {
    if (key === '__until__' || (value !== 'allow' && value !== 'deny')) continue;
    const at = key.indexOf('::');
    if (at < 0) continue;
    const permission = key.slice(at + 2);
    if (!EXPIRING.has(permission)) continue;
    const end = Number.isFinite(until[key]) ? until[key] : null;
    if (end !== null && end < now) continue;       // already over: the site asks again
    const label = /^(.*?) \(([^()]+)\)$/.exec(key.slice(0, at));
    rows.push({
      key, origin: label ? label[1] : key.slice(0, at), where: label ? label[2] : '', permission, decision: value,
      until: end, pinned: !!(pins && pins[pinKey(key)]),
    });
  }
  rows.sort((a, b) => (a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : a.permission < b.permission ? -1 : 1));
  const allowed = rows.filter(r => r.decision === 'allow');
  const soon = allowed.filter(r => r.until !== null && r.until - now <= soonDays * DAY_MS && !r.pinned);
  const lines = [];
  for (const p of ['microphone', 'camera', 'geolocation', 'display-capture', 'clipboard-read', 'notifications']) {
    const sites = new Set(allowed.filter(r => r.permission === p).map(r => r.origin));
    if (!sites.size) continue;
    const n = sites.size;
    lines.push(n + (n === 1 ? ' site can ' : ' sites can ') + (p === 'notifications' ? 'send you notifications' : p === 'display-capture' ? 'share your screen' : p === 'clipboard-read' ? 'read your clipboard' : 'use ' + PLAIN[p]));
  }
  return { rows, soon, lines };
}

// What the person is told about the one grant that is about to end.
function soonLine(row, now) {
  const days = Math.max(0, Math.ceil((row.until - now) / DAY_MS));
  return row.origin + ' can ' + (row.permission === 'notifications' ? 'send you notifications' : 'use ' + (PLAIN[row.permission] || row.permission)) + (days ? ' for ' + days + ' more day' + (days === 1 ? '' : 's') : ' only until today');
}

// Wires the Settings and indicator channels. Deps are passed in so a test can
// give stand-ins; main.js passes the real ones.
function registerPermissionHygiene({ ipcMain, hygiene, loadDecisions, saveDecisions, setPageDecision, getContents, ownerOf, isLocked = () => false, now = () => Date.now() }) {
  const guard = () => { if (isLocked()) throw new Error('Vex is locked'); };
  ipcMain.handle('hygiene:perm-config', (_e, next) => { guard(); return next ? hygiene.setConfig(next) : hygiene.getConfig(); });
  ipcMain.handle('hygiene:perm-summary', () => {
    guard();
    const sum = summarize(loadDecisions(), hygiene.pinned(), now());
    return { config: hygiene.getConfig(), ...sum, soonLines: sum.soon.map(r => soonLine(r, now())), quieted: hygiene.quieted(), live: hygiene.liveAll() };
  });
  // Pin: the grant never ends. Unpin: it ends N days from now (when expiry is on).
  ipcMain.handle('hygiene:perm-pin', async (_e, key, value) => {
    guard();
    const d = loadDecisions();
    if (!Object.hasOwn(d, key)) throw new Error('That permission is no longer saved');
    hygiene.setPinned(key, !!value);
    const until = { ...(d.__until__ || {}) };
    const [origin, permission] = [pinKey(key).split('::')[0], pinKey(key).split('::')[1]];
    if (value) delete until[key];
    else { const end = hygiene.expiryFor(origin, permission); if (end) until[key] = end; }
    if (Object.keys(until).length) d.__until__ = until; else delete d.__until__;
    await saveDecisions(d);
    return { ok: true };
  });
  // A request the trap guard answered "no" to: allow it (saved for the site) or block it for good.
  ipcMain.handle('hygiene:perm-decide', async (e, id, decision) => {
    guard();
    if (decision !== 'allow' && decision !== 'deny') throw new Error('Allow or block');
    const q = hygiene.takeQuieted(id);
    const page = q.contentsId == null ? null : getContents(q.contentsId);
    if (!page) throw new Error('The tab that asked is closed. Open ' + q.origin + ' again and use the site panel to allow it.');
    if (ownerOf(page) !== ownerOf(e.sender)) throw new Error('That tab belongs to another window');
    await setPageDecision(page, q.origin, q.permission, decision);
    return { ok: true };
  });
  ipcMain.handle('hygiene:perm-live', () => { guard(); return hygiene.liveAll(); });
  // Stop: block what the tab was given and reload it, which ends the stream.
  ipcMain.handle('hygiene:perm-stop', async (e, contentsId) => {
    guard();
    const page = getContents(contentsId);
    if (!page) throw new Error('That tab is gone');
    if (ownerOf(page) !== ownerOf(e.sender)) throw new Error('That tab belongs to another window');
    const rec = hygiene.liveFor(contentsId);
    if (!rec) throw new Error('Nothing is using your devices in that tab');
    for (const p of rec.parts) await setPageDecision(page, rec.origin, p, 'deny');
    hygiene.clearLive(contentsId);
    page.reload();
    return { ok: true, blocked: rec.parts };
  });
}

module.exports = { createPermissionHygiene, registerPermissionHygiene, summarize, soonLine, cleanConfig, pinKey, EXPIRING, TRAP_GUARDED, LIVE_PARTS, DEFAULT_CONFIG, DAY_MS, LINE };
