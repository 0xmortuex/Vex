// === Undo instead of "Are you sure?" ===
//
// Something that can be put back exactly is done at once, and a toast says
// what happened with an Undo button (app.js showToast, the one toast system):
//
//   VexUndo.offer({ message: 'Deleted “Groceries”', undo: () => putItBack() })
//
// The toast stays about ten seconds, longer while the pointer or the focus is
// on it. Undo is its button, or Ctrl+Z anywhere in Vex's own window that is
// not a text box (the newest offer first). When the toast goes unused the
// action simply stays done: everything offered here is already saved the
// moment it happens, so quitting Vex with a toast on screen leaves the action
// complete, never half done.
//
// One thing is not done at once: an extension's uninstall. It is switched off
// straight away and removed for good only when its toast goes (`commit`), so
// Undo brings it back with its data. Main finishes any such removal that a
// quit or a crash interrupted (main.js, extensions:uninstall-later).
//
// Lists put back an item where it was: by the record that came before it,
// else the one after it, else its old position (takeOut/putBack below).
const VexUndo = (() => {
  const DEFAULT_MS = 10000;
  const live = [];   // newest last
  let seq = 0;

  function offer({ message, undo, commit, ms } = {}) {
    if (typeof message !== 'string' || !message.trim()) throw new Error('An undo offer needs a message');
    if (typeof undo !== 'function') throw new Error('An undo offer needs something to undo');
    if (typeof window.showToast !== 'function') throw new Error('The toast system is not loaded');
    const entry = { id: ++seq, message, undo, commit: typeof commit === 'function' ? commit : null, settled: false, toast: null };
    live.push(entry);
    entry.toast = window.showToast(message, 'undo', ms || DEFAULT_MS, {
      action: { label: 'Undo', title: 'Undo (Ctrl+Z)', run: () => { runUndo(entry); } },
      onExpire: () => settle(entry),
    }) || null;
    return { id: entry.id, undo: () => runUndo(entry), settle: () => settle(entry) };
  }

  function drop(entry) {
    const i = live.indexOf(entry);
    if (i >= 0) live.splice(i, 1);
  }

  // The toast went unused: what was done stays done; a deferred step runs now.
  function settle(entry) {
    if (entry.settled) return;
    entry.settled = true;
    drop(entry);
    if (entry.toast) entry.toast.dismiss();
    if (!entry.commit) return;
    Promise.resolve().then(entry.commit).catch(err => {
      console.error('[Undo] could not finish "' + entry.message + '":', err);
      window.showToast('Could not finish: ' + ((err && err.message) || String(err)), 'error', 6000);
    });
  }

  async function runUndo(entry) {
    if (entry.settled) return false;
    entry.settled = true;
    drop(entry);
    if (entry.toast) entry.toast.dismiss();
    try {
      await entry.undo();
      return true;
    } catch (err) {
      console.error('[Undo] could not undo "' + entry.message + '":', err);
      window.showToast('Could not undo: ' + ((err && err.message) || String(err)), 'error', 6000);
      return false;
    }
  }

  function undoLatest() {
    const entry = live[live.length - 1];
    if (!entry) return null;
    return runUndo(entry);
  }

  function pending() { return live.map(e => ({ id: e.id, message: e.message })); }

  // Where Ctrl+Z belongs to the text, not to Vex.
  function isTextTarget(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return !el.readOnly && !el.disabled;
    if (el.tagName === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      return !['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset', 'image'].includes(type) && !el.readOnly && !el.disabled;
    }
    // A page in a tab: its own Ctrl+Z is the page's.
    return el.tagName === 'WEBVIEW' || el.tagName === 'IFRAME';
  }

  function onKeyDown(e) {
    if (!live.length || e.defaultPrevented) return;
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    if (e.code !== 'KeyZ' && String(e.key).toLowerCase() !== 'z') return;
    const active = document.activeElement;
    const onToast = !!(active && active.closest && active.closest('#toast-container'));
    if (!onToast) {
      if (isTextTarget(active)) return;
      // A dialog that is open owns the keyboard.
      if (document.querySelector('.vex-dialog-overlay')) return;
    }
    e.preventDefault();
    e.stopPropagation();
    undoLatest();
  }

  // --- lists ---------------------------------------------------------------
  // Take the first record matching `match` out of `list` (in place) and note
  // where it was. Returns null when there is none.
  function takeOut(list, match, idOf = defaultId) {
    const index = list.findIndex(match);
    if (index < 0) return null;
    const [item] = list.splice(index, 1);
    return {
      item, index,
      prevId: index > 0 ? idOf(list[index - 1]) : null,
      nextId: index < list.length ? idOf(list[index]) : null,
    };
  }

  // Put a record taken out back into `list` (in place), beside the record it
  // was next to if that is still there. Returns the index it went to.
  function putBack(list, removed, idOf = defaultId) {
    const id = idOf(removed.item);
    if (id != null) {
      const already = list.findIndex(x => idOf(x) === id);
      if (already >= 0) return already;   // came back some other way (sync)
    }
    let at = -1;
    if (removed.prevId != null) {
      const p = list.findIndex(x => idOf(x) === removed.prevId);
      if (p >= 0) at = p + 1;
    }
    if (at < 0 && removed.nextId != null) {
      const n = list.findIndex(x => idOf(x) === removed.nextId);
      if (n >= 0) at = n;
    }
    if (at < 0) at = Math.min(Math.max(0, removed.index), list.length);
    list.splice(at, 0, removed.item);
    return at;
  }

  // Several at once (a "clear the old ones"): taken out last-first so every
  // index stays true, put back first-first.
  function takeOutAll(list, match, idOf = defaultId) {
    const out = [];
    for (let i = list.length - 1; i >= 0; i--) {
      if (!match(list[i])) continue;
      out.unshift(takeOut(list, (_x, j) => j === i, idOf));
    }
    return out;
  }
  function putBackAll(list, removedList, idOf = defaultId) {
    for (const removed of removedList) putBack(list, removed, idOf);
  }
  // Records already back in `list` but somewhere else (a store that puts
  // everything new at the top, collection-store.js): moved to where they were.
  function reposition(list, removedList, idOf = defaultId) {
    const ids = new Set(removedList.map(r => idOf(r.item)));
    const found = new Map();
    for (let i = list.length - 1; i >= 0; i--) {
      const id = idOf(list[i]);
      if (id != null && ids.has(id)) found.set(id, list.splice(i, 1)[0]);
    }
    for (const removed of removedList) {
      const id = idOf(removed.item);
      if (found.has(id)) putBack(list, { ...removed, item: found.get(id) }, idOf);
    }
  }

  function defaultId(x) { return x && x.id != null ? x.id : null; }

  if (typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown, true);
  // The window going: whatever is still on offer stays done, and a deferred
  // step is started now (main also finishes an uninstall at quit and start).
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('pagehide', () => { for (const entry of live.slice()) settle(entry); });
  }

  return { offer, undoLatest, pending, takeOut, putBack, takeOutAll, putBackAll, reposition, DEFAULT_MS, _isTextTarget: isTextTarget, _onKeyDown: onKeyDown };
})();

if (typeof window !== 'undefined') window.VexUndo = VexUndo;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexUndo };
