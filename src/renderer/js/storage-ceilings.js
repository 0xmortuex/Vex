// === What each feature keeps, against what it may keep (T2-004) =================
//
// Every feature manifest (js/feature-manifests.js) already says which storage keys
// it owns and a storageKB budget. This page puts the two side by side so the numbers
// are visible, and carries the one cap that was a real problem: Recall's page index
// (recall.json), which is now bounded by size, page count and how long pages are kept
// (set in src/main.js, changed here), and no longer writes a second copy (.bak).
//
//   StorageCeilings.usage()        -> [{ id, title, bytes, budgetKB, over, keys }] biggest first
//   StorageCeilings.recall()       -> the index numbers from main { pages, bytes, maxBytes, retainMs ... }
//   StorageCeilings.limits()       -> { days, maxMB, maxPages } the saved Recall limits
//   StorageCeilings.setLimits(l)   -> saves them and applies them now (the oldest pages go first)
//   StorageCeilings.sendLimits()   -> told to main at start
//
// Nothing is deleted from the feature rows: a feature over its budget is shown, and its
// own page (Settings, or the feature) is where it is trimmed. Only Recall's index trims
// itself, because it is rebuilt from the pages read.
const StorageCeilings = {
  KEY: 'vex.storage.recallLimits',
  // The preference store's volatile split (T0-012, src/main/storage.js): history-like keys in a second file so the
  // settings file stays small. Read by main at start, so a change takes effect the next time Vex starts.
  SPLIT_KEY: 'vex.volatileSplit',
  splitOn() { return localStorage.getItem(this.SPLIT_KEY) === '1'; },
  setSplit(on) {
    if (on) localStorage.setItem(this.SPLIT_KEY, '1'); else localStorage.removeItem(this.SPLIT_KEY);
    return this.splitOn();
  },
  DEFAULT_LIMITS: { days: 90, maxMB: 12, maxPages: 3000 },
  RANGE: { days: [7, 3650], maxMB: [1, 64], maxPages: [100, 10000] },

  _note(what, err) { window.VexProblems?.note('Storage', what, err); },

  limits() {
    const raw = localStorage.getItem(this.KEY);
    if (raw === null) return { ...this.DEFAULT_LIMITS };
    let o;
    try { o = JSON.parse(raw); } catch (err) { throw new Error('The saved Recall limits could not be read', { cause: err }); }
    return { ...this.DEFAULT_LIMITS, ...(o && typeof o === 'object' ? o : {}) };
  },
  setLimits(l) {
    const next = { ...this.limits(), ...l };
    for (const k of Object.keys(this.RANGE)) {
      const [lo, hi] = this.RANGE[k];
      if (!(Number.isFinite(next[k]) && next[k] >= lo && next[k] <= hi)) throw new Error('Recall ' + ({ days: 'days kept', maxMB: 'size (MB)', maxPages: 'pages' }[k]) + ' has to be between ' + lo + ' and ' + hi);
    }
    if (!Number.isInteger(next.days) || !Number.isInteger(next.maxPages)) throw new Error('Days kept and pages have to be whole numbers');
    const clean = { days: next.days, maxMB: next.maxMB, maxPages: next.maxPages };
    localStorage.setItem(this.KEY, JSON.stringify(clean));
    return clean;
  },
  async sendLimits() {
    const b = window.vex;
    if (!b || typeof b.recallLimits !== 'function') throw new Error('Recall limits cannot be applied in this window');
    return b.recallLimits(this.limits());
  },
  async recall() {
    const b = window.vex;
    if (!b || typeof b.recallStats !== 'function') throw new Error('Recall numbers are not available in this window');
    return b.recallStats();
  },

  // Bytes held under a manifest's keys (a key ending in "." is a prefix). Counted as stored text.
  bytesOf(keys) {
    let total = 0;
    for (const k of keys) {
      if (k.endsWith('.')) {
        for (let i = 0; i < localStorage.length; i++) { const name = localStorage.key(i); if (name.startsWith(k)) total += name.length + (localStorage.getItem(name) || '').length; }
      } else {
        const v = localStorage.getItem(k);
        if (v !== null) total += k.length + v.length;
      }
    }
    return total;
  },
  usage() {
    if (typeof VexRegistry === 'undefined') throw new Error('The feature records are not loaded');
    return VexRegistry.all().map((m) => {
      const bytes = this.bytesOf(m.storageKeys);
      const budgetKB = m.budget.storageKB;
      return { id: m.id, title: m.title, bytes, budgetKB, over: bytes > budgetKB * 1024, keys: m.storageKeys.length };
    }).filter(r => r.bytes > 0).sort((a, b) => b.bytes - a.bytes);
  },

  // === Ceilings for what the other features keep (T2-004) =====================================
  //
  // Each feature below keeps a growing list in this window's storage. Each gets a cap in kilobytes and a
  // retention in days (90 unless its owner says otherwise). Nothing is dropped without notice:
  //   1. the first review that finds a feature over a limit warns (Attention Inbox: what is over, how much
  //      would go, "Trim now") and notes the day;
  //   2. a later review, at least GRACE_DAYS after the warning, trims it, oldest first (the way Recall's
  //      index trims), unless the person pressed "Keep for 30 days" in Settings > Storage;
  //   3. every trim is written to the ledger with an undo, and the removed part is kept in
  //      vex.storage.trimmed (the last trim of each feature, up to 256 KB) so Undo puts it back.
  // A curated list (AI memory: facts the person wrote) is only ever trimmed by "Trim now", never by a review.
  // Off by default on an existing profile (feature 'storage-retention', staged); the numbers stay on show.
  //
  //   StorageCeilings.policies()          -> [{ id, title, key, retainDays, maxKB, curated, shape }]
  //   StorageCeilings.plan(id, now)       -> { bytes, count, dropAge, dropSize, drop, keep } what a trim would do (read only)
  //   StorageCeilings.review(now)         -> { warned: [ids], trimmed: [ids] } one pass
  //   StorageCeilings.trim(id)            -> trims now (the person asked); returns { dropped, bytesBefore, bytesAfter }
  //   StorageCeilings.undoTrim(id)        -> puts the last trim back
  //   StorageCeilings.setPolicy(id, { retainDays, maxKB }) / keepFor(id, days)
  RETENTION_KEY: 'vex.storage.retention',
  STATE_KEY: 'vex.storage.ceilings',
  TRIMMED_KEY: 'vex.storage.trimmed',
  FEATURE: 'storage-retention',
  GRACE_DAYS: 3,
  KEEP_DAYS: 30,
  UNDO_MAX_BYTES: 256 * 1024,
  REVIEW_EVERY_MS: 6 * 3600 * 1000,
  RANGE_POLICY: { retainDays: [7, 3650], maxKB: [16, 20480] },

  // shape 'list': the stored JSON is an array; 'listIn': an object whose `path` holds the array; 'map': an object of items.
  // time: the item's timestamp (ms) as a field name, or (key, item) => ms. load/store: for a module that keeps its list in memory.
  _POLICIES: [
    { id: 'journal', title: 'Daily journal', key: 'vex.journal', shape: 'map', time: (k) => Date.parse(k), retainDays: 90, maxKB: 1024 },
    { id: 'ledger', title: 'What Vex did (ledger)', key: 'vex.ledger', shape: 'listIn', path: 'entries', time: 'at', retainDays: 90, maxKB: 256,
      load: () => (typeof VexLedger !== 'undefined' ? VexLedger._load().slice() : null),
      store: (list) => { VexLedger._entries = list; if (!VexLedger._save()) throw new Error('The ledger could not be saved'); VexLedger._emit(); } },
    { id: 'game-log', title: 'Game log', key: 'vex.gameLog', shape: 'list', time: 'start', retainDays: 90, maxKB: 256 },
    { id: 'timeline', title: 'Session timeline', key: 'vex.timeline.log', shape: 'list', time: 't', retainDays: 90, maxKB: 1024 },
    { id: 'captures', title: 'Screenshots and capture log', key: 'vex.captureLog', shape: 'list', time: 'start', retainDays: 90, maxKB: 512 },
    { id: 'digest-cache', title: 'Reading digest cache', key: 'vex.readingDigestCache', shape: 'map', time: (k, v) => (v && v.at) || 0, retainDays: 90, maxKB: 1024 },
    { id: 'ai-memory', title: 'AI memory', key: 'vex.aiMemory', shape: 'listIn', path: 'facts', time: 'at', retainDays: 0, maxKB: 256, curated: true,
      load: () => (typeof AIMemory !== 'undefined' && AIMemory.data && Array.isArray(AIMemory.data.facts) ? AIMemory.data.facts.slice() : null),
      store: (list) => { AIMemory.data.facts = list; AIMemory.save(); } },
  ],
  // Features that keep nothing of the kind: clipboard history is in memory only (its pins are capped at 100 by the
  // module), and OCR text is shown and copied, never stored (it lands in Notes or Recall, which have their own limits).

  retentionEnabled() { try { return localStorage.getItem(this.RETENTION_KEY) !== '0'; } catch (err) { throw new Error('The retention switch could not be read: ' + err.message, { cause: err }); } },
  setRetentionEnabled(on) { localStorage.setItem(this.RETENTION_KEY, on ? '1' : '0'); },

  _state() {
    const raw = localStorage.getItem(this.STATE_KEY);
    let o = null;
    if (raw) { try { o = JSON.parse(raw); } catch (err) { throw new Error('The saved storage limits could not be read', { cause: err }); } }
    const ok = o && typeof o === 'object' && o.v === 1;
    return { v: 1, limits: ok && o.limits && typeof o.limits === 'object' ? o.limits : {}, warned: ok && o.warned && typeof o.warned === 'object' ? o.warned : {}, keepUntil: ok && o.keepUntil && typeof o.keepUntil === 'object' ? o.keepUntil : {} };
  },
  _saveState(st) { localStorage.setItem(this.STATE_KEY, JSON.stringify(st)); },

  policies() {
    const st = this._state();
    return this._POLICIES.map((p) => {
      const l = st.limits[p.id] || {};
      return { id: p.id, title: p.title, key: p.key, shape: p.shape, curated: !!p.curated,
        retainDays: Number.isFinite(l.retainDays) ? l.retainDays : p.retainDays, maxKB: Number.isFinite(l.maxKB) ? l.maxKB : p.maxKB };
    });
  },
  _policy(id) {
    const p = this.policies().find(x => x.id === id);
    if (!p) throw new Error('Not a storage policy: ' + id);
    return p;
  },
  setPolicy(id, { retainDays, maxKB }) {
    const p = this._policy(id);
    const next = { retainDays: retainDays === undefined ? p.retainDays : retainDays, maxKB: maxKB === undefined ? p.maxKB : maxKB };
    if (!Number.isInteger(next.retainDays) || (next.retainDays !== 0 && (next.retainDays < this.RANGE_POLICY.retainDays[0] || next.retainDays > this.RANGE_POLICY.retainDays[1]))) throw new Error('Days kept is 0 (no age limit) or between ' + this.RANGE_POLICY.retainDays.join(' and '));
    if (!Number.isInteger(next.maxKB) || next.maxKB < this.RANGE_POLICY.maxKB[0] || next.maxKB > this.RANGE_POLICY.maxKB[1]) throw new Error('The size limit is between ' + this.RANGE_POLICY.maxKB.join(' and ') + ' KB');
    const st = this._state();
    st.limits[id] = next;
    delete st.warned[id];
    this._saveState(st);
    return next;
  },
  keepFor(id, days = this.KEEP_DAYS, now = Date.now()) {
    this._policy(id);
    const st = this._state();
    st.keepUntil[id] = now + days * 86400000;
    delete st.warned[id];
    this._saveState(st);
    return st.keepUntil[id];
  },

  // The stored items of a policy as [key, item] pairs in the policy's own shape; null when the feature stores nothing.
  _read(p) {
    const full = this._POLICIES.find(x => x.id === p.id);
    if (full.load) {
      const list = full.load();
      return list ? { full, items: list.map((it, i) => [i, it]), isMap: false } : null;
    }
    const text = localStorage.getItem(full.key);
    if (text === null) return null;
    let v;
    try { v = JSON.parse(text); } catch (err) { throw new Error(full.title + ' is not readable and was left as it is (' + full.key + ')', { cause: err }); }
    if (full.shape === 'map') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(full.title + ' has an unexpected shape and was left as it is');
      return { full, items: Object.entries(v), isMap: true };
    }
    const arr = full.shape === 'listIn' ? (v && v[full.path]) : v;
    if (!Array.isArray(arr)) throw new Error(full.title + ' has an unexpected shape and was left as it is');
    return { full, items: arr.map((it, i) => [i, it]), isMap: false, wrapper: full.shape === 'listIn' ? v : null };
  },
  _timeOf(full, key, item) {
    const t = typeof full.time === 'function' ? full.time(key, item) : (item && item[full.time]);
    return Number.isFinite(t) ? t : 0;
  },
  _bytes(items, isMap) {
    return JSON.stringify(isMap ? Object.fromEntries(items) : items.map(x => x[1])).length;
  },
  _write(r, items) {
    const full = r.full;
    if (full.store) full.store(items.map(x => x[1]));
    else if (r.isMap) localStorage.setItem(full.key, JSON.stringify(Object.fromEntries(items)));
    else if (full.shape === 'listIn') localStorage.setItem(full.key, JSON.stringify({ ...(r.wrapper || {}), [full.path]: items.map(x => x[1]) }));
    else localStorage.setItem(full.key, JSON.stringify(items.map(x => x[1])));
  },

  // What a trim would do to one feature. Oldest first: first what is older than the retention, then the oldest of the
  // rest until the size is under the cap. An item with no timestamp counts as the oldest for the size cap and is never
  // dropped by age. Read only: nothing is changed.
  plan(id, now = Date.now()) {
    const p = this._policy(id);
    const r = this._read(p);
    if (!r) return { id, bytes: 0, count: 0, dropAge: 0, dropSize: 0, drop: [], keep: [], policy: p };
    const sorted = r.items.map(([k, it]) => ({ k, it, t: this._timeOf(r.full, k, it) })).sort((a, b) => a.t - b.t);
    const drop = [];
    let rest = sorted;
    const cutoff = p.retainDays > 0 ? now - p.retainDays * 86400000 : null;
    if (cutoff !== null) { drop.push(...rest.filter(x => x.t > 0 && x.t < cutoff)); rest = rest.filter(x => !(x.t > 0 && x.t < cutoff)); }
    const dropAge = drop.length;
    const cap = p.maxKB * 1024;
    let size = this._bytes(rest.map(x => [x.k, x.it]), r.isMap);
    let dropSize = 0;
    while (rest.length > 1 && size > cap) {
      const out = rest.shift();
      size -= JSON.stringify(out.it).length + (r.isMap ? String(out.k).length + 4 : 1);
      drop.push(out); dropSize++;
    }
    return { id, bytes: this._bytes(r.items, r.isMap), count: r.items.length, dropAge, dropSize, drop: drop.map(x => x.k), keep: rest.map(x => x.k), policy: p };
  },

  // Writes the kept part back, and keeps the removed part for Undo.
  _apply(id, now = Date.now()) {
    const p = this._policy(id);
    const pl = this.plan(id, now);
    if (!pl.drop.length) return { dropped: 0, bytesBefore: pl.bytes, bytesAfter: pl.bytes, undoable: false };
    const r = this._read(p);
    const gone = new Set(pl.drop);
    const removed = r.items.filter(([k]) => gone.has(k));
    const kept = r.items.filter(([k]) => !gone.has(k));
    this._write(r, kept);
    const bytesAfter = this._bytes(kept, r.isMap);
    const slot = JSON.stringify({ at: now, map: r.isMap, items: removed });
    const undoable = slot.length <= this.UNDO_MAX_BYTES;
    const all = this._trimmed();
    if (undoable) all[id] = JSON.parse(slot); else delete all[id];
    localStorage.setItem(this.TRIMMED_KEY, JSON.stringify(all));
    if (typeof VexLedger !== 'undefined') {
      VexLedger.note({
        feature: this.FEATURE,
        what: 'Removed ' + removed.length + ' older entr' + (removed.length === 1 ? 'y' : 'ies') + ' from ' + r.full.title,
        why: 'It was over its limit (' + p.maxKB + ' KB' + (p.retainDays ? ', kept ' + p.retainDays + ' days' : '') + '), and you were told before.',
        undo: undoable ? { kind: 'storage-trim', id } : undefined,
      });
    }
    return { dropped: removed.length, bytesBefore: pl.bytes, bytesAfter, undoable };
  },
  _trimmed() {
    const raw = localStorage.getItem(this.TRIMMED_KEY);
    if (!raw) return {};
    try { const o = JSON.parse(raw); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; }
    catch (err) { throw new Error('The kept copy of trimmed entries is not readable', { cause: err }); }
  },

  // The person asked: trims now, curated or not.
  trim(id, now = Date.now()) {
    const st = this._state();
    delete st.warned[id]; delete st.keepUntil[id];
    this._saveState(st);
    return this._apply(id, now);
  },
  undoTrim(id) {
    const p = this._policy(id);
    const all = this._trimmed();
    const slot = all[id];
    if (!slot) throw new Error('There is nothing kept to put back for ' + p.title);
    const r = this._read(p) || { full: this._POLICIES.find(x => x.id === id), items: [], isMap: slot.map, wrapper: null };
    let merged = r.items.concat(slot.items);
    if (!r.isMap) merged = merged.map(([k, it]) => ({ k, it, t: this._timeOf(r.full, k, it) })).sort((a, b) => a.t - b.t).map(x => [x.k, x.it]);
    this._write(r, merged);
    delete all[id];
    localStorage.setItem(this.TRIMMED_KEY, JSON.stringify(all));
    const st = this._state();
    st.keepUntil[id] = Date.now() + this.KEEP_DAYS * 86400000;     // not trimmed again straight away
    this._saveState(st);
    return slot.items.length;
  },

  // One pass. Warns first; trims only what was warned about at least GRACE_DAYS ago and not kept; never a curated list.
  review(now = Date.now()) {
    const out = { warned: [], trimmed: [] };
    if (!this.retentionEnabled()) return out;
    const st = this._state();
    for (const p of this.policies()) {
      let pl;
      try { pl = this.plan(p.id, now); }
      catch (err) { this._note('Could not check ' + p.title, err); continue; }
      if (!pl.drop.length) { delete st.warned[p.id]; continue; }
      if (st.keepUntil[p.id] && st.keepUntil[p.id] > now) continue;
      if (!st.warned[p.id]) {
        this._warn(p, pl);
        st.warned[p.id] = now; out.warned.push(p.id);
        continue;
      }
      if (p.curated) continue;
      if (now - st.warned[p.id] < this.GRACE_DAYS * 86400000) continue;
      try { this._apply(p.id, now); out.trimmed.push(p.id); delete st.warned[p.id]; }
      catch (err) { this._note('Could not trim ' + p.title, err); }
    }
    this._saveState(st);
    return out;
  },
  _warn(p, pl) {
    const age = pl.dropAge ? pl.dropAge + ' older than ' + p.retainDays + ' days' : '';
    const size = pl.dropSize ? pl.dropSize + ' over the ' + p.maxKB + ' KB limit' : '';
    const text = p.title + ' keeps ' + this.fmt(pl.bytes) + '. ' + [age, size].filter(Boolean).join(' and ') + ' would be removed, oldest first'
      + (p.curated ? ' (only if you press Trim now)' : ', in ' + this.GRACE_DAYS + ' days') + '. Settings > Storage can keep it.';
    if (typeof VexAttention === 'undefined') throw new Error('VexAttention is not loaded, so the warning for ' + p.title + ' cannot be shown');
    VexAttention.suggest({ feature: this.FEATURE, label: 'Storage', id: 'trim-' + p.id, title: p.title + ' is over its limit', body: text, action: { label: 'Trim now', key: 'trim:' + p.id } });
  },

  fmt(bytes) { return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB'; },

  group(section) {
    const el = document.createElement('div');
    section.appendChild(el);
    const mk = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
    const draw = async () => {
      el.textContent = '';
      el.appendChild(mk('p', 'setting-info muted', 'What each feature keeps in this window\'s storage, against the budget its record gives it. A feature over its budget is shown, not trimmed: trim it where it lives.'));
      // The preference file layout (applied at the next start)
      const splitRow = mk('label', 'setting-toggle-row', 'Keep history-like data in a second file ');
      const splitBox = mk('input'); splitBox.type = 'checkbox'; splitBox.checked = this.splitOn(); splitBox.setAttribute('aria-label', 'Keep history-like data in a second file');
      splitBox.addEventListener('change', () => {
        try { this.setSplit(splitBox.checked); window.showToast?.(splitBox.checked ? 'The second file is used from the next start' : 'The two files are merged again at the next start'); }
        catch (err) { this._note('Could not change the file layout', err); window.showToast?.(err.message, 'error'); splitBox.checked = this.splitOn(); }
      });
      splitRow.appendChild(splitBox);
      el.appendChild(splitRow);
      el.appendChild(mk('p', 'setting-info muted', 'Browsing history, downloads, caches and logs go to vex-persist-volatile.json, so your settings file is not rewritten every time a page loads. Applied at the next start; switching it off merges the files again. A copy of the old file is kept until the new layout has read back cleanly.'));
      // Recall's index
      const recall = mk('div', 'storage-recall');
      el.appendChild(recall);
      try {
        const s = await this.recall();
        recall.appendChild(mk('p', 'setting-info', 'Recall index: ' + (s.pages || 0).toLocaleString() + ' pages, ' + this.fmt(s.bytes || 0) + (s.maxBytes ? ' of ' + this.fmt(s.maxBytes) : '') + (s.retainMs ? ', kept ' + Math.round(s.retainMs / 86400000) + ' days' : '') + '. No second copy is written.'));
      } catch (err) { recall.appendChild(mk('p', 'setting-info muted', err.message)); }
      let lim;
      try { lim = this.limits(); } catch (err) { el.appendChild(mk('p', 'setting-info muted', err.message)); lim = { ...this.DEFAULT_LIMITS }; }
      const row = mk('div', 'setting-toggle-row');
      const inputs = {};
      for (const [k, label, step] of [['days', 'Days kept', 1], ['maxMB', 'Size, MB', 1], ['maxPages', 'Pages', 100]]) {
        const lab = mk('label', null, label + ' ');
        const inp = mk('input'); inp.type = 'number'; inp.value = String(lim[k]); inp.step = String(step); inp.min = String(this.RANGE[k][0]); inp.max = String(this.RANGE[k][1]); inp.setAttribute('aria-label', 'Recall ' + label);
        lab.appendChild(inp); inputs[k] = inp; row.appendChild(lab);
      }
      const apply = mk('button', 'btn-secondary', 'Apply'); apply.type = 'button';
      apply.addEventListener('click', async () => {
        try {
          this.setLimits({ days: Number(inputs.days.value), maxMB: Number(inputs.maxMB.value), maxPages: Number(inputs.maxPages.value) });
          const r = await this.sendLimits();
          window.showToast?.(r && r.dropped ? 'Recall trimmed: ' + r.dropped + ' older page' + (r.dropped === 1 ? '' : 's') + ' removed' : 'Recall limits saved');
        } catch (err) { this._note('Could not apply the Recall limits', err); window.showToast?.(err.message, 'error'); }
        draw();
      });
      row.appendChild(apply);
      el.appendChild(row);
      // What the other features keep, with their limits (T2-004)
      el.appendChild(mk('p', 'setting-info muted', 'Limits for what features keep. Over a limit, Vex tells you first and removes the oldest entries only after ' + this.GRACE_DAYS + ' days, unless you keep them. Every removal is in "What Vex did", with Undo.'));
      const retRow = mk('label', 'setting-toggle-row', 'Remove the oldest entries of a feature once it stays over its limit ');
      const retBox = mk('input'); retBox.type = 'checkbox'; retBox.checked = this.retentionEnabled(); retBox.setAttribute('aria-label', 'Remove the oldest entries of a feature once it stays over its limit');
      retBox.addEventListener('change', () => { try { this.setRetentionEnabled(retBox.checked); } catch (err) { this._note('Could not change the retention switch', err); window.showToast?.(err.message, 'error'); } });
      retRow.appendChild(retBox);
      el.appendChild(retRow);
      let pols = [];
      try { pols = this.policies(); } catch (err) { el.appendChild(mk('p', 'setting-info muted', err.message)); }
      for (const p of pols) {
        let pl;
        try { pl = this.plan(p.id); } catch (err) { el.appendChild(mk('p', 'setting-info muted', p.title + ': ' + err.message)); continue; }
        const line = mk('div', 'setting-toggle-row');
        line.appendChild(mk('span', null, p.title + ': ' + this.fmt(pl.bytes) + ' of ' + p.maxKB + ' KB' + (p.retainDays ? ', kept ' + p.retainDays + ' days' : '') + (pl.drop.length ? ' (' + pl.drop.length + ' to remove)' : '')));
        const kb = mk('input'); kb.type = 'number'; kb.value = String(p.maxKB); kb.min = String(this.RANGE_POLICY.maxKB[0]); kb.max = String(this.RANGE_POLICY.maxKB[1]); kb.setAttribute('aria-label', p.title + ' size limit in KB');
        const dy = mk('input'); dy.type = 'number'; dy.value = String(p.retainDays); dy.min = '0'; dy.max = String(this.RANGE_POLICY.retainDays[1]); dy.setAttribute('aria-label', p.title + ' days kept (0 for no age limit)');
        const save = mk('button', 'btn-secondary', 'Set'); save.type = 'button';
        save.addEventListener('click', () => { try { this.setPolicy(p.id, { maxKB: Number(kb.value), retainDays: Number(dy.value) }); } catch (err) { window.showToast?.(err.message, 'error'); } draw(); });
        line.append(kb, dy, save);
        if (pl.drop.length) {
          const keep = mk('button', 'btn-secondary', 'Keep ' + this.KEEP_DAYS + ' days'); keep.type = 'button';
          keep.addEventListener('click', () => { try { this.keepFor(p.id); window.showToast?.(p.title + ' will not be trimmed for ' + this.KEEP_DAYS + ' days'); } catch (err) { window.showToast?.(err.message, 'error'); } draw(); });
          const now = mk('button', 'btn-secondary', 'Trim now'); now.type = 'button';
          now.addEventListener('click', () => { try { const r = this.trim(p.id); window.showToast?.('Removed ' + r.dropped + ' older entr' + (r.dropped === 1 ? 'y' : 'ies') + (r.undoable ? '. Undo is in What Vex did.' : '')); } catch (err) { this._note('Could not trim ' + p.title, err); window.showToast?.(err.message, 'error'); } draw(); });
          line.append(keep, now);
        }
        el.appendChild(line);
      }
      // Features
      let rows = [];
      try { rows = this.usage(); } catch (err) { el.appendChild(mk('p', 'setting-info muted', err.message)); }
      for (const r of rows.slice(0, 25)) {
        el.appendChild(mk('div', 'setting-info' + (r.over ? '' : ' muted'), r.title + ': ' + this.fmt(r.bytes) + ' of ' + r.budgetKB + ' KB' + (r.over ? ' (over its budget)' : '')));
      }
    };
    draw();
  },

  init() {
    if (this._wired) return false;
    this._wired = true;
    // Main starts with the defaults; the saved ones are sent once the window is up.
    this.sendLimits().catch((err) => this._note('Could not send the Recall limits', err));
    // The warn-then-trim review (T2-004): the inbox button, the undo, and a pass every few hours.
    if (typeof AttentionInbox !== 'undefined') AttentionInbox.handle(this.FEATURE, (key) => {
      if (!key.startsWith('trim:')) throw new Error('Unknown storage action: ' + key);
      try { const r = this.trim(key.slice(5)); window.showToast?.('Removed ' + r.dropped + ' older entr' + (r.dropped === 1 ? 'y' : 'ies')); }
      catch (err) { this._note('Could not trim', err); window.showToast?.(err.message, 'error'); }
    });
    if (typeof VexLedger !== 'undefined') VexLedger.registerUndo('storage-trim', (token) => { const n = this.undoTrim(token.id); return 'Put back ' + n + ' entr' + (n === 1 ? 'y' : 'ies'); });
    if (typeof VexJobs !== 'undefined') {
      VexJobs.every('Storage retention review', this.REVIEW_EVERY_MS, () => this.review(), { when: 'background', feature: this.FEATURE });
      setTimeout(() => { try { this.review(); } catch (err) { this._note('The storage review failed', err); } }, 45000);
    }
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.StorageCeilings = StorageCeilings;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'storage-ceilings', title: 'Storage',
      keywords: 'storage space size disk recall index cap retention days megabytes budget how much split file volatile history settings file layout',
      before: 'about',
      build: (el) => StorageCeilings.group(el),
    });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => StorageCeilings.init());
    else StorageCeilings.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { StorageCeilings };
