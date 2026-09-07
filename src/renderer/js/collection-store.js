// === Cross-window safe persistence for id-keyed collections ===
//
// Bookmarks and Read Later load their whole list into memory once at init and
// used to write that snapshot back on every change. With two Vex windows open
// (same session, so same localStorage) the last window to save erased every
// record the other had added since it loaded — and the storage shim then
// mirrored the loss to disk, so it survived a restart.
//
// The fix is to stop writing the snapshot. A window knows what IT changed:
// the ids it removed, and the records it added or edited. Apply only that delta
// onto whatever is persisted right now, so concurrent writes from another window
// survive. Per-record last-writer-wins; whole-array clobbering is gone.
const CollectionStore = {
  _id(item) { return item && item.id != null ? String(item.id) : null; },

  read(key) {
    try { const parsed = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  },

  // baseline: the list as this window last read or wrote it.
  // mine:     the list as this window has it now.
  // current:  the list as it is persisted right now (may include other windows' writes).
  merge(baseline, mine, current) {
    const baseIds = new Set(baseline.map(i => this._id(i)).filter(v => v !== null));
    const mineIds = new Set(mine.map(i => this._id(i)).filter(v => v !== null));
    // Present when we loaded and gone now = this window deleted it. A record
    // absent from baseline was never ours to delete.
    const removed = new Set([...baseIds].filter(v => !mineIds.has(v)));
    const mineById = new Map(mine.map(i => [this._id(i), i]));

    const kept = [];
    const reconciled = new Set();
    for (const item of current) {
      const id = this._id(item);
      if (id !== null && removed.has(id)) continue;
      if (id !== null && mineById.has(id)) { kept.push(mineById.get(id)); reconciled.add(id); continue; }
      kept.push(item);
    }

    // Records this window holds that are not persisted yet. Records without an
    // id are compared by value so a repeated save cannot duplicate them.
    const currentValues = new Set(current.map(i => JSON.stringify(i)));
    const additions = mine.filter(item => {
      const id = this._id(item);
      if (id === null) return !currentValues.has(JSON.stringify(item));
      return !reconciled.has(id);
    });
    // These lists are newest-first and additions are unshifted, so they lead.
    return [...additions, ...kept];
  },

  // --- Map-shaped collections (Annotations: page key -> highlight array) ---

  // Element objects stay shared, which is fine: the baseline is only consulted
  // for id membership. The arrays must be copied, or an in-place push/filter on
  // the live store would silently mutate the baseline too and hide the delta.
  snapshotMap(map) {
    const out = {};
    for (const key of Object.keys(map || {})) out[key] = Array.isArray(map[key]) ? map[key].slice() : map[key];
    return out;
  },

  readMap(key) {
    try { const parsed = JSON.parse(localStorage.getItem(key) || '{}'); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
  },

  mergeMap(baseline, mine, current) {
    const arr = (value) => (Array.isArray(value) ? value : []);
    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const out = {};
    for (const key of new Set([...Object.keys(current), ...Object.keys(mine), ...Object.keys(baseline)])) {
      const inBase = has(baseline, key), inMine = has(mine, key), inCurrent = has(current, key);
      if (inMine) {
        // Merge our page against the persisted one so another window's
        // highlights on the same page survive our write.
        const merged = this.merge(inBase ? arr(baseline[key]) : [], arr(mine[key]), inCurrent ? arr(current[key]) : []);
        if (merged.length) out[key] = merged;
      } else if (inBase) {
        // We dropped the page (its last highlight was removed). Remove only the
        // records that were ours; anything added since stays.
        const merged = this.merge(arr(baseline[key]), [], arr(current[key]));
        if (merged.length) out[key] = merged;
      } else if (inCurrent) {
        out[key] = current[key];   // another window's page, untouched by us
      }
    }
    return out;
  },

  saveMap(key, baseline, mine) {
    const merged = this.mergeMap(baseline || {}, mine || {}, this.readMap(key));
    try { localStorage.setItem(key, JSON.stringify(merged)); } catch {}
    return merged;
  },
  // Persist `mine` without discarding another window's concurrent writes.
  // Returns the merged list, which the caller adopts as its new state.
  save(key, baseline, mine, limit) {
    let merged = this.merge(baseline || [], mine || [], this.read(key));
    if (limit && merged.length > limit) merged = merged.slice(0, limit);
    try { localStorage.setItem(key, JSON.stringify(merged)); } catch {}
    return merged;
  },
};

if (typeof window !== 'undefined') window.CollectionStore = CollectionStore;
if (typeof module !== 'undefined' && module.exports) module.exports = { CollectionStore };
