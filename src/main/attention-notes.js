'use strict';
// === Telling the owner something from the main process =========================
//
// The Attention Inbox lives in the window (js/attention-inbox.js). The main process finds some things the owner
// has to hear - "your per-site rules could not be read and were restored from the backup", "every extension was
// switched off because the on/off list was unreadable", "the disk is nearly full" - often before any window
// exists. A note posted here waits (and is kept in a small file in the profile, so a quit before the window was
// ready does not lose it) until the window says it is ready, and is then sent once as inbox rows.
//
// It never decides anything: it only carries the words. Nothing is dropped silently: a note that cannot be saved
// or sent is logged and stays in memory for the next try.
const fs = require('fs');
const { atomicWriteSync, readJsonRecoverSync } = require('./file-store');

const MAX_NOTES = 20;
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

// One note as the window expects an inbox row: { feature, id, label, title, body, action? }.
function cleanNote(note) {
  if (!note || typeof note !== 'object') throw new Error('A note needs to be an object');
  const feature = clip(note.feature, 60).trim();
  const title = clip(note.title, 140).trim();
  if (!feature) throw new Error('A note needs a feature');
  if (!title) throw new Error('A note needs a title');
  const out = { feature, id: clip(note.id, 80), label: clip(note.label || feature, 60), title, body: clip(note.body, 300) };
  if (note.action && typeof note.action.key === 'string' && note.action.label) out.action = { label: clip(note.action.label, 30), key: clip(note.action.key, 40) };
  return out;
}

// file: where unseen notes are kept. send(rows) -> true when the window took them. fsImpl is injectable.
function createAttentionNotes({ file, send, fsImpl = fs, log = console }) {
  if (typeof send !== 'function') throw new Error('createAttentionNotes needs a send function');
  let pending = null;       // loaded on first use
  let ready = false;

  function load() {
    if (pending) return pending;
    pending = [];
    if (!file) return pending;
    const r = readJsonRecoverSync(file, { fsImpl });
    if (r.source === 'lost') log.error('[AttentionNotes] the saved notes could not be read and were kept aside (' + r.corruptCopy + '):', r.error && r.error.message);
    if (Array.isArray(r.data)) for (const n of r.data) { try { pending.push(cleanNote(n)); } catch (err) { log.error('[AttentionNotes] a saved note was skipped:', err.message); } }
    return pending;
  }
  function save() {
    if (!file) return;
    try { atomicWriteSync(file, JSON.stringify(pending), { fsImpl }); }
    catch (err) { log.error('[AttentionNotes] could not save the waiting notes (they stay in memory):', err.message); }
  }

  function deliver() {
    const list = load();
    if (!ready || !list.length) return 0;
    let took;
    try { took = send(list.map(n => ({ ...n }))); }
    catch (err) { log.error('[AttentionNotes] the window did not take the notes; they will be sent again:', err.message); return 0; }
    if (took !== true) return 0;
    const n = list.length;
    list.length = 0;
    save();
    return n;
  }

  // Adds a note (the same feature + id replaces the earlier one) and sends it if the window is ready.
  function post(note) {
    const row = cleanNote(note);
    const list = load();
    const at = list.findIndex(n => n.feature === row.feature && n.id === row.id);
    if (at >= 0) list.splice(at, 1);
    list.push(row);
    while (list.length > MAX_NOTES) list.shift();
    log.warn('[AttentionNotes] ' + row.feature + ': ' + row.title);
    save();
    deliver();
    return row;
  }

  // The window can take notes now (and again, if it was reloaded).
  function markReady(isReady = true) { ready = isReady === true; return deliver(); }
  function waiting() { return load().map(n => ({ ...n })); }

  return { post, markReady, deliver, waiting };
}

module.exports = { createAttentionNotes, cleanNote, MAX_NOTES };
