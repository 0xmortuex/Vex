// === The text clips inbox ===================================================
//
// A line typed into the quick-capture box with Ctrl+Enter lands here, in main,
// and nowhere else. It does not go through Vex's window: the box can be open
// over a game, Vex minimised or busy, and the line is still kept. The window
// is told afterwards (if it is there) so the Clips inbox and Universal search
// show it, but nothing is brought forward.
//
// One small JSON file, written whole through a temp file and a rename so a
// crash mid-write cannot leave half of it. Everything is injected so it can be
// tested without Electron.
const fs = require('fs');
const path = require('path');

const MAX_ITEMS = 500;
const MAX_TEXT = 4000;

function createCaptureInbox({ file, fsImpl = fs, now = Date.now, randomId = () => Math.random().toString(36).slice(2, 8) } = {}) {
  if (!file) throw new Error('createCaptureInbox: no file');
  let items = null;

  function load() {
    if (items) return items;
    let raw;
    try { raw = fsImpl.readFileSync(file, 'utf8'); }
    catch (err) {
      if (err && err.code === 'ENOENT') { items = []; return items; }
      throw new Error('Could not read the clips inbox: ' + err.message, { cause: err });
    }
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (err) { throw new Error('The clips inbox file is not valid JSON: ' + err.message, { cause: err }); }
    items = Array.isArray(parsed) ? parsed.filter(i => i && typeof i.id === 'string' && typeof i.text === 'string') : [];
    return items;
  }

  function persist() {
    const temp = file + '.tmp';
    fsImpl.mkdirSync(path.dirname(file), { recursive: true });
    fsImpl.writeFileSync(temp, JSON.stringify(items));
    fsImpl.renameSync(temp, file);
  }

  function add(text, { source = 'capture' } = {}) {
    const t = String(text == null ? '' : text).trim().slice(0, MAX_TEXT);
    if (!t) throw new Error('There is nothing to save');
    const list = load();
    const entry = { id: 'cl_' + now().toString(36) + randomId(), text: t, at: now(), source: String(source).slice(0, 40) };
    list.unshift(entry);
    if (list.length > MAX_ITEMS) list.length = MAX_ITEMS;
    persist();
    return { entry, count: list.length };
  }

  // The page a clip was kept from, filled in shortly after (the window knows which tab was in front when the clip
  // landed; main does not). Only an entry that has no stamp yet, only for a little while, only a web address.
  // -> the entry, or null when it was not stamped.
  function stamp(id, meta, { maxAgeMs = 120000 } = {}) {
    const list0 = load();
    const entry = list0.find(x => x.id === id);
    if (!entry || entry.from) return null;
    if (now() - entry.at > maxAgeMs) return null;
    const m = meta && typeof meta === 'object' ? meta : {};
    if (!m.url) return null;
    let u;
    try { u = new URL(String(m.url)); } catch { throw new Error('The page address of that clip is not valid'); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only a web page can be recorded as the source of a clip');
    u.username = ''; u.password = ''; u.hash = '';
    entry.from = { url: u.href.slice(0, 500), title: String(m.title == null ? '' : m.title).replace(/\s+/g, ' ').trim().slice(0, 200) };
    persist();
    return entry;
  }

  function list() { return load().slice(); }

  function remove(id) {
    const list0 = load();
    const i = list0.findIndex(x => x.id === id);
    if (i < 0) return false;
    list0.splice(i, 1);
    persist();
    return true;
  }

  function clear() { load(); items = []; persist(); }

  return { add, list, remove, clear, stamp, MAX_ITEMS, MAX_TEXT };
}

module.exports = { createCaptureInbox, MAX_ITEMS, MAX_TEXT };
