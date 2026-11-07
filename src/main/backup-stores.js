// === The settings files only the main process keeps, in the backup ===========
//
// Settings > Backup always carried what the window keeps (localStorage and the
// settings file). Four things the main process keeps in files of its own were
// not in it, so a reinstall put back the theme and lost the per-site rules:
//
//   site-rules    site-rules.json   per-site switches (JavaScript, cookies ...)
//   permissions   permissions.json  what each site was allowed or refused, plus
//                 permissions-containers.json (containers and routes), shown
//                 as one list with the container named in the key
//   reminders     reminders.json   the reminders that have not fired yet
//   extensions    extensions/.disabled  which installed extensions are off
//                 (the extensions themselves are NOT in a backup)
//
// Restoring is never a raw file copy. Each store goes back through the cleaner
// its normal load uses (SiteRules.clean, the permission cleaner below, the
// reminders' own importList, the installed-folder filter), so a hand-edited or
// damaged file cannot put in anything a normal start would have refused. A
// restore adds to and overwrites what is there; what the file does not have is
// left as it is (the same rule as the rest of the backup), and the state from
// just before is kept in memory so the restore can be undone.
//
// Everything here is injected so it can be tested without Electron.
'use strict';

const nodeFs = require('fs');
const nodeOs = require('os');
const nodePath = require('path');

const STORE_NAMES = ['site-rules', 'permissions', 'reminders', 'extensions'];
const MAX_DECISIONS = 5000;
const MAX_REMINDERS = 500;

// ---- cleaners (pure) -------------------------------------------------------

// A permission decision key is "origin::permission" (or "origin (in the work
// container)::permission"); the value is 'allow' or 'deny'. __until__ holds
// end times for "allow for a day". Returns { clean, dropped }.
function cleanDecisions(input, now = Date.now()) {
  const clean = {};
  let dropped = 0;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { clean, dropped: 0 };
  let n = 0;
  for (const [key, value] of Object.entries(input)) {
    if (key === '__until__') continue;
    if (typeof key !== 'string' || key.length > 400 || !key.includes('::') || (value !== 'allow' && value !== 'deny') || n >= MAX_DECISIONS) { dropped++; continue; }
    clean[key] = value;
    n++;
  }
  const until = {};
  const given = input.__until__;
  if (given && typeof given === 'object' && !Array.isArray(given)) {
    for (const [key, end] of Object.entries(given)) {
      if (!(key in clean)) { dropped++; continue; }
      if (!Number.isFinite(end) || end <= now) { delete clean[key]; dropped++; continue; }   // a decision that already ran out is not one
      until[key] = end;
    }
  }
  if (Object.keys(until).length) clean.__until__ = until;
  return { clean, dropped };
}

const countDecisions = (d) => Object.keys(d || {}).filter(k => k !== '__until__').length;

// Folder names of extensions switched off. Only a plain folder name: never a path.
function cleanDisabled(list, installed = null) {
  const out = [];
  let dropped = 0;
  for (const name of Array.isArray(list) ? list : []) {
    if (typeof name !== 'string' || !name || name.length > 200 || /[\\/]|\.\./.test(name)) { dropped++; continue; }
    if (installed && !installed.has(name)) { dropped++; continue; }   // not installed here: nothing to switch off
    if (!out.includes(name)) out.push(name);
  }
  return { clean: out, dropped };
}

function cleanReminderItems(list) {
  const out = [];
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || typeof r.message !== 'string') continue;
    if (r.firedAt && !r.repeat) continue;
    if (r.kind === 'review') continue;     // each machine has its own (reminders.importList)
    out.push(r);
    if (out.length >= MAX_REMINDERS) break;
  }
  return out;
}

// ---- the service -----------------------------------------------------------
//
// siteRules:   { get() -> rules, set(rules) -> Promise|void }   (set cleans and saves like siterules:set)
// permissions: { combined() -> decisions, mainAndContainers() -> { main, containers }, merge(combined) , restoreStores({main, containers}) }
// reminders:   { list() -> Promise<[]>, importList(items) -> Promise<{added}>, delete(id) }
// extensions:  { readDisabled() -> Set|array, writeDisabled(list), installed() -> Set of folder names }
function createBackupStores({ siteRules, permissions, reminders, extensions, SiteRules, now = () => Date.now() }) {
  if (!SiteRules || typeof SiteRules.clean !== 'function') throw new Error('createBackupStores needs the site rules cleaner');
  let undoState = null;

  async function collect() {
    const main = {};
    main['site-rules'] = { rules: SiteRules.clean(siteRules.get()) };
    main.permissions = { decisions: cleanDecisions(permissions.combined(), now()).clean };
    try { main.reminders = { items: cleanReminderItems(await reminders.list()) }; }
    catch (err) { throw new Error('Reminders could not be read for the backup: ' + err.message, { cause: err }); }
    main.extensions = { disabled: cleanDisabled([...extensions.readDisabled()]).clean };
    return main;
  }

  // How many things each store holds in a collected/parsed main object.
  function counts(main) {
    const m = main || {};
    return {
      'site-rules': Object.keys((m['site-rules'] && m['site-rules'].rules) || {}).length,
      permissions: countDecisions(m.permissions && m.permissions.decisions),
      reminders: ((m.reminders && m.reminders.items) || []).length,
      extensions: ((m.extensions && m.extensions.disabled) || []).length,
    };
  }

  // Put the stores in `main` back. Returns { written, notes }. Remembers what
  // was there for undo(). Each store is independent: one that fails is named
  // and the others still go back (a partial restore is reported as partial).
  async function apply(main) {
    if (!main || typeof main !== 'object') throw new Error('There are no site rules or permissions in that backup');
    const notes = [];
    const failed = [];
    const before = {
      siteRules: SiteRules.clean(siteRules.get()),
      stores: permissions.mainAndContainers(),
      disabled: [...extensions.readDisabled()],
      addedReminders: [],
    };
    let written = 0;

    if (main['site-rules'] && typeof main['site-rules'] === 'object') {
      try {
        const incoming = SiteRules.clean(main['site-rules'].rules);
        const merged = SiteRules.clean({ ...before.siteRules, ...incoming });
        await siteRules.set(merged);
        written += Object.keys(incoming).length;
        const lost = Object.keys((main['site-rules'].rules) || {}).length - Object.keys(incoming).length;
        if (lost > 0) notes.push(lost + ' site rule(s) were not valid and were left out');
      } catch (err) { failed.push('site rules: ' + err.message); }
    }

    if (main.permissions && typeof main.permissions === 'object') {
      try {
        const { clean, dropped } = cleanDecisions(main.permissions.decisions, now());
        const skipped = (await permissions.merge(clean)) || 0;
        written += countDecisions(clean) - skipped;
        if (dropped) notes.push(dropped + ' site permission(s) were not valid or had run out and were left out');
        if (skipped) notes.push(skipped + ' site permission(s) belong to a container or route this Vex does not know and were left out');
      } catch (err) { failed.push('site permissions: ' + err.message); }
    }

    if (main.reminders && typeof main.reminders === 'object') {
      try {
        const have = new Set((await reminders.list()).map(r => r.id));
        const incoming = cleanReminderItems(main.reminders.items);
        const r = await reminders.importList(incoming);
        const mine = (await reminders.list()).map(x => x.id).filter(id => !have.has(id));
        before.addedReminders = mine;
        written += r.added || 0;
        notes.push('Restored reminders fire while Vex is open; Windows is not woken for them');
      } catch (err) { failed.push('reminders: ' + err.message); }
    }

    if (main.extensions && typeof main.extensions === 'object') {
      try {
        const installed = extensions.installed();
        const { clean, dropped } = cleanDisabled(main.extensions.disabled, installed);
        const union = [...new Set([...before.disabled, ...clean])];
        if (union.length !== before.disabled.length) extensions.writeDisabled(union);
        written += clean.length;
        if (dropped) notes.push(dropped + ' switched-off extension(s) are not installed here, so nothing was changed for them');
      } catch (err) { failed.push('extensions: ' + err.message); }
    }

    undoState = before;
    if (failed.length) throw new Error('Part of the restore failed (' + failed.join('; ') + '). Undo puts back what was changed.', { cause: { written, notes, failed } });
    return { written, notes };
  }

  async function undo() {
    if (!undoState) throw new Error('Nothing has been restored to undo');
    const s = undoState;
    const problems = [];
    try { await siteRules.set(s.siteRules); } catch (err) { problems.push('site rules: ' + err.message); }
    try { await permissions.restoreStores(s.stores); } catch (err) { problems.push('site permissions: ' + err.message); }
    for (const id of s.addedReminders) {
      try { await reminders.delete(id); } catch (err) { problems.push('a reminder: ' + err.message); }
    }
    try { extensions.writeDisabled(s.disabled); } catch (err) { problems.push('extensions: ' + err.message); }
    undoState = null;
    if (problems.length) throw new Error('Some of it could not be put back (' + problems.join('; ') + ')');
    return true;
  }

  return { collect, counts, apply, undo, hasUndo: () => !!undoState };
}

// ---- "Test this backup": a restore rehearsal in a temp profile --------------
//
// Parses a backup text into a throwaway profile folder (a copy of how the real
// files are laid out), reads it back the way a start would, runs the same
// cleaners, and reports per store what the backup holds against what the live
// profile holds. It never opens, writes or locks anything in the live profile:
// it only reads the live COUNTS it is handed. The temp folder is removed even
// when the rehearsal fails.
//
// live: { items: n, stores: { settings: n, userscripts: n }, main: { 'site-rules': n, ... } }
function drillBackup({ text, live = {}, VexBackup, SiteRules, fs = nodeFs, os = nodeOs, path = nodePath }) {
  const notes = [];
  let data;
  try { data = JSON.parse(String(text)); }
  catch { return { ok: false, error: 'That file is not readable as a Vex backup (it is not valid JSON)' }; }
  const seen = VexBackup.describe(data);
  if (!seen) return { ok: false, error: 'That is not a Vex backup file' };
  let integrity;
  try { integrity = VexBackup.verify(data); }
  catch (err) { return { ok: false, error: err.message, integrity: 'damaged' }; }

  let tmp = null;
  const rows = [];
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-drill-'));
    const put = (rel, value) => {
      const file = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(value), 'utf8');
      return file;
    };
    const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
    const row = (name, label, inBackup, liveCount) => {
      const l = Number.isFinite(liveCount) ? liveCount : null;
      rows.push({ name, label, backup: inBackup, live: l, diff: l === null ? null : inBackup - l });
    };

    // The window's own settings: written as the persisted preference file.
    const keys = Object.entries(data.items).filter(([k, v]) => k.startsWith('vex.') && !VexBackup._blocked(k) && typeof v === 'string');
    const persisted = read(put('vex-persist.json', Object.fromEntries(keys)));
    row('items', 'Settings and data', Object.keys(persisted).length, live.items);

    for (const name of VexBackup.STORES.concat(...Object.values(VexBackup.OPTIONAL_STORES))) {
      const value = data.stores && data.stores[name];
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const back = read(put(path.join('data', name + '.json'), value));
      row(name, name === 'settings' ? 'Settings file' : 'Userscripts', Object.keys(back).length, live.stores && live.stores[name]);
    }

    const main = data.main && typeof data.main === 'object' ? data.main : {};
    const liveMain = live.main || {};
    if (main['site-rules']) {
      const back = SiteRules.clean(read(put('site-rules.json', main['site-rules'].rules || {})));
      const given = Object.keys(main['site-rules'].rules || {}).length;
      row('site-rules', 'Site rules', Object.keys(back).length, liveMain['site-rules']);
      if (given !== Object.keys(back).length) notes.push((given - Object.keys(back).length) + ' site rule(s) would be left out as invalid');
    }
    if (main.permissions) {
      const { clean, dropped } = cleanDecisions(read(put('permissions.json', main.permissions.decisions || {})));
      row('permissions', 'Site permissions', countDecisions(clean), liveMain.permissions);
      if (dropped) notes.push(dropped + ' site permission(s) would be left out as invalid or expired');
    }
    if (main.reminders) {
      const items = cleanReminderItems(read(put('reminders.json', main.reminders.items || [])));
      row('reminders', 'Reminders', items.length, liveMain.reminders);
    }
    if (main.extensions) {
      const { clean } = cleanDisabled(read(put(path.join('extensions', '.disabled.json'), main.extensions.disabled || [])));
      row('extensions', 'Switched-off extensions', clean.length, liveMain.extensions);
    }
  } catch (err) {
    return { ok: false, error: 'The rehearsal failed: ' + err.message, integrity };
  } finally {
    if (tmp) {
      try { fs.rmSync(tmp, { recursive: true, force: true }); }
      catch (err) { notes.push('The temporary folder could not be removed: ' + err.code); }
    }
  }
  return {
    ok: true, integrity, when: data.at || null, app: data.app || '', version: data.v, rows, notes,
    missingMain: data.v >= 2 ? [] : STORE_NAMES,
  };
}

module.exports = { createBackupStores, drillBackup, cleanDecisions, cleanDisabled, cleanReminderItems, countDecisions, STORE_NAMES };
