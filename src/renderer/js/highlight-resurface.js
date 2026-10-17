// === Resurface old highlights and notes (T2-064) ==================================
//
// A highlight you made is worth most when it comes back once or twice. Passively,
// not as a quiz: a highlight returns 1, 3, 7 and 21 days after you made it, and a
// note you wrote last week returns once. They arrive as ONE row in the Attention
// Inbox ("Do you remember?"), never a pop-up, and only through the Attention
// Budget (so not in Game mode, a meeting or quiet hours, and a person who said
// "Never" is not asked again).
//
// Bounded: at most 3 highlights and 1 note a day, each step of each item at most
// once, an item can be stopped for good, and the whole thing can be switched off.
// Local only: it reads the highlights (Annotations) and notes you already keep.
const HighlightResurface = {
  STATE_KEY: 'vex.resurface',
  PREFS_KEY: 'vex.resurface.prefs',
  DAYS: [1, 3, 7, 21],
  NOTE_DAYS: 7,
  NOTE_MAX_DAYS: 14,
  MAX_HIGHLIGHTS: 3,
  MAX_NOTES: 1,
  DAY_MS: 24 * 3600 * 1000,

  // ---- state ---------------------------------------------------------------------
  _read(key, def) { const raw = localStorage.getItem(key); if (raw === null) return def; const v = JSON.parse(raw); return v && typeof v === 'object' ? v : def; },
  prefs() { const p = this._read(this.PREFS_KEY, {}); return { enabled: p.enabled !== false }; },
  enabled() { return this.prefs().enabled; },
  setEnabled(on) { localStorage.setItem(this.PREFS_KEY, JSON.stringify({ ...this.prefs(), enabled: !!on })); this._job(); },
  state() { const s = this._read(this.STATE_KEY, {}); return { seen: s.seen && typeof s.seen === 'object' ? s.seen : {}, lastDay: String(s.lastDay || ''), pending: Array.isArray(s.pending) ? s.pending.filter(x => typeof x === 'string').slice(0, 10) : [] }; },
  _save(s) {
    // Bounded: the oldest finished entries go first.
    const ids = Object.keys(s.seen);
    if (ids.length > 1500) for (const id of ids.sort((a, b) => (s.seen[a].at || 0) - (s.seen[b].at || 0)).slice(0, ids.length - 1500)) delete s.seen[id];
    localStorage.setItem(this.STATE_KEY, JSON.stringify(s));
  },
  stop(id) { const s = this.state(); s.seen[id] = { ...(s.seen[id] || {}), step: 99, at: Date.now(), stopped: true }; this._save(s); },

  // ---- pure ----------------------------------------------------------------------
  // Items: { id, kind: 'highlight' | 'note', at (when made), text, title, url? }.
  // -> the ones due at `now`, oldest-made first, within the daily bounds.
  due(items, seen, now = Date.now()) {
    const out = { highlights: [], notes: [] };
    for (const it of items || []) {
      if (!it || !it.id || !it.at) continue;
      const rec = seen[it.id] || { step: 0 };
      const age = (now - it.at) / this.DAY_MS;
      if (it.kind === 'note') {
        if (rec.step >= 1) continue;
        if (age >= this.NOTE_DAYS && age <= this.NOTE_MAX_DAYS) out.notes.push(it);
      } else {
        if (rec.step >= this.DAYS.length) continue;
        if (age >= this.DAYS[rec.step]) out.highlights.push({ ...it, step: rec.step });
      }
    }
    out.highlights.sort((a, b) => a.at - b.at);
    out.notes.sort((a, b) => b.at - a.at);
    out.highlights = out.highlights.slice(0, this.MAX_HIGHLIGHTS);
    out.notes = out.notes.slice(0, this.MAX_NOTES);
    return out;
  },
  mark(seen, picked, now = Date.now()) {
    for (const h of picked.highlights) seen[h.id] = { step: h.step + 1, at: now };
    for (const n of picked.notes) seen[n.id] = { step: 1, at: now };
    return seen;
  },
  dayKey(now = Date.now()) { return new Date(now).toISOString().slice(0, 10); },
  snippet(text, n = 90) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  },

  // ---- what the person has ----------------------------------------------------------
  items() {
    const out = [];
    const store = typeof Annotations !== 'undefined' && Annotations.store ? Annotations.store : {};
    for (const list of Object.values(store)) {
      for (const h of Array.isArray(list) ? list : []) {
        if (h && h.id && h.text && h.at) out.push({ id: 'h:' + h.id, kind: 'highlight', at: h.at, text: h.text, title: h.title || '', url: h.url || '', note: h.note || '' });
      }
    }
    const notes = typeof OpenTasks !== 'undefined' && typeof OpenTasks.notes === 'function' ? OpenTasks.notes() : [];
    for (const n of notes || []) {
      const at = Date.parse(n.createdAt || n.updatedAt || '');
      if (n && n.id && n.content && Number.isFinite(at)) out.push({ id: 'n:' + n.id, kind: 'note', at, text: n.content, title: n.title || '' });
    }
    return out;
  },

  // Today's pick, marked as shown. Once a day. -> { highlights, notes } or null
  pickToday(now = Date.now()) {
    const s = this.state();
    const day = this.dayKey(now);
    if (s.lastDay === day) return null;
    const picked = this.due(this.items(), s.seen, now);
    if (!picked.highlights.length && !picked.notes.length) return null;
    return { picked, commit: () => { this.mark(s.seen, picked, now); s.lastDay = day; s.pending = [...picked.highlights, ...picked.notes].map(x => x.id); this._save(s); } };
  },

  // The daily check: one Attention Inbox row.
  check(now = Date.now()) {
    if (!this.enabled()) return false;
    const got = this.pickToday(now);
    if (!got) return false;
    if (typeof VexAttention === 'undefined') throw new Error('The Attention Budget is not loaded');
    const { picked } = got;
    const first = picked.highlights[0] || picked.notes[0];
    const total = picked.highlights.length + picked.notes.length;
    const ok = VexAttention.suggest({
      feature: 'resurface', id: this.dayKey(now),
      title: 'Do you remember? ' + this.snippet(first.title || first.text, 60),
      body: total + ' thing' + VexPlural.s(total) + ' you highlighted or wrote, back for a second look.',
      action: { label: 'Look', key: 'open' },
    });
    // Counted as shown only when it reached the inbox (a muted feature is asked again on no day).
    if (ok) got.commit();
    return ok;
  },

  // ---- the look ---------------------------------------------------------------------
  async open(now = Date.now()) {
    const s = this.state();
    // What the inbox row announced, else whatever is due now.
    let all;
    let picked = null;
    if (s.pending.length) {
      const byId = new Map(this.items().map(i => [i.id, i]));
      all = s.pending.map(id => byId.get(id)).filter(Boolean);
      s.pending = [];
      this._save(s);
    } else {
      picked = this.due(this.items(), s.seen, now);
      all = [...picked.highlights, ...picked.notes];
    }
    const { body, close } = window.PageExport._sheet('Do you remember?', 'vex-resurface-overlay');
    const btn = 'font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer';
    const mk = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.style.cssText = btn; b.textContent = label; b.addEventListener('click', fn); return b; };
    if (!all.length) {
      const p = document.createElement('div');
      p.style.cssText = 'padding:14px;font-size:12.5px;color:var(--text-muted)';
      p.textContent = 'Nothing is due. Highlights come back 1, 3, 7 and 21 days after you make them; a note from last week comes back once.';
      body.append(p);
      return close;
    }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('resurface');
    for (const it of all) {
      const box = document.createElement('div');
      box.style.cssText = 'padding:10px 14px;border-bottom:1px solid var(--border)';
      const t = document.createElement('div'); t.style.cssText = 'font-size:12.5px;font-weight:600;color:var(--text)'; t.textContent = (it.kind === 'note' ? 'Note: ' : '') + (it.title || this.snippet(it.text, 50));
      const q = document.createElement('div'); q.style.cssText = 'margin:6px 0;font-size:12.5px;color:var(--text);display:none;white-space:pre-wrap'; q.textContent = this.snippet(it.text, 600) + (it.note ? '\n— ' + it.note : '');
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
      row.append(mk('Show it', () => { q.style.display = 'block'; }));
      if (it.url && typeof TabManager !== 'undefined') row.append(mk('Open the page', () => TabManager.createTab(it.url, true)));
      row.append(mk('Stop these', () => { this.stop(it.id); box.remove(); }));
      box.append(t, q, row);
      body.append(box);
    }
    // Looking at them counts as having been reminded.
    if (picked) {
      this.mark(s.seen, picked, now);
      s.lastDay = this.dayKey(now);
      this._save(s);
    }
    return close;
  },

  _job() {
    if (typeof VexJobs === 'undefined') return;
    if (this.enabled()) {
      if (!this._jobHandle) this._jobHandle = VexJobs.every('Resurface highlights', 3 * 3600 * 1000, () => this.check(), { feature: 'resurface' });
    } else if (this._jobHandle) { this._jobHandle.stop(); this._jobHandle = null; }
  },
  start() {
    this._job();
    if (typeof AttentionInbox !== 'undefined') AttentionInbox.handle('resurface', () => this.open());
  },
};

if (typeof window !== 'undefined') window.HighlightResurface = HighlightResurface;
if (typeof module !== 'undefined' && module.exports) module.exports = { HighlightResurface };
