// === The small shared helpers of the community and chat tools =================
//
// Ten small features (timezone helper, unread-to-task, meeting links, noise rules,
// announcement composer, community metrics, link harvester, Discord status line,
// moderator kit, Vencord bridge) each keep ONE preference/data record in
// localStorage and each need the same few things: read it without hiding a damaged
// record, write it, switch on/off, trim text, and tell the rest of the window.
// This holds those, and nothing else. It owns no storage key itself.
//
// None of these features reads a third-party site on its own, sends, posts or
// changes anything there. They work on text the person pastes or selects, on
// what Vex already holds (kept panel notifications, the calendar), and on data the
// person types in.
const CommsStore = {
  // A damaged record is reported, never replaced by an empty one behind the person's back.
  read(key, fallback, label) {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    let v;
    try { v = JSON.parse(raw); }
    catch (err) { throw new Error('The saved ' + (label || key) + ' is not readable', { cause: err }); }
    return v == null ? fallback : v;
  },
  write(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
  // A record that is a plain object, with these defaults filled in.
  record(key, defaults, label) {
    const v = this.read(key, null, label);
    if (v === null) return { ...defaults };
    if (typeof v !== 'object' || Array.isArray(v)) throw new Error('The saved ' + (label || key) + ' is not in a form Vex knows');
    return { ...defaults, ...v };
  },
  emit(name, detail) {
    try { document.dispatchEvent(new CustomEvent(name, { detail: detail || null })); }
    catch { /* vex-allow-empty-catch: no document: a test */ }
  },
  // Tidy one line of text: collapsed spaces, a length.
  line(v, n) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n); },
  // Tidy text that keeps its line breaks.
  block(v, n) { return String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, n); },
  id(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },
  // The first web addresses in a piece of text, each once, in order, without the punctuation a sentence puts after them.
  links(text, max = 50) {
    const found = [];
    for (const m of String(text == null ? '' : text).matchAll(/https?:\/\/[^\s<>"'\])}]+/gi)) {
      const url = m[0].replace(/[.,;:!?)]+$/, '');
      try { new URL(url); } catch { continue; }
      if (!found.includes(url)) found.push(url);
      if (found.length >= max) break;
    }
    return found;
  },
  // A safe copy to the clipboard: reports instead of failing quietly.
  async copy(text) {
    if (typeof navigator === 'undefined' || !navigator.clipboard) throw new Error('The clipboard is not available');
    await navigator.clipboard.writeText(String(text));
  },
  // Not in a private window: these records would outlive it.
  privateWindow() { return typeof window !== 'undefined' && !!(window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow); },
  needKept(what) { if (this.privateWindow()) throw new Error(what + ' is not kept in a private window'); },
};

if (typeof window !== 'undefined') window.CommsStore = CommsStore;
if (typeof module !== 'undefined' && module.exports) module.exports = { CommsStore };
