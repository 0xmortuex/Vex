// === Deadline ledger with a countdown =========================================
//
// An exam on the 24th, an assignment on Friday, a release at the end of the
// month, a book due back in three weeks. Each is an entry with a day and,
// when the work can be counted, how much is left of it:
//
//   Linear Algebra exam   12 days left   40 pages a day   cards due now: 8
//
// "A day" is the share of the work left divided by the days left, today
// counted. The counting is yours (pages, cards, tasks, hours: you say the unit
// and move "done" forward); nothing is read from a book or a deck.
//
// It feeds What is due (and so the Morning Brief) through VexDueness.addSource
// for anything due in the next 7 days, and offers dailyShare() to anything that
// draws a load meter. "Cards due now" is the count in Vex's Flashcards, shown on
// an entry you flagged for it.
//
//   VexDeadlineLedger.make({...})            pure: a validated entry
//   VexDeadlineLedger.daysLeft(e, now)       pure: calendar days, 0 = today, negative = late
//   VexDeadlineLedger.share(e, now)          pure: { left, perDay, unit } or null
//   VexDeadlineLedger.dailyShare(now)        what the open entries ask of today, per unit

const VexDeadlineLedger = {
  KEY: 'vex.deadlineLedger',
  PREF: 'vex.deadlineLedger.enabled',   // 'off' hides the command and stops feeding What is due
  DAY: 24 * 3600 * 1000,
  MAX: 100,
  KINDS: ['exam', 'assignment', 'release', 'book', 'other'],
  KIND_LABEL: { exam: 'Exam', assignment: 'Assignment', release: 'Release', book: 'Book', other: 'Other' },
  UNITS: ['pages', 'cards', 'tasks', 'hours', 'items'],

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    return !!on;
  },

  // ---- pure ---------------------------------------------------------------------------
  _parseDay(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) throw new Error('Pick the day it is due');
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) throw new Error('That is not a day: ' + s);
    return d;
  },
  make({ title, kind, due, unit, total, done, withCards, url, now = Date.now(), id } = {}) {
    const name = String(title == null ? '' : title).replace(/\s+/g, ' ').trim();
    if (!name) throw new Error('Give the deadline a name');
    if (name.length > 100) throw new Error('Keep the name to 100 characters');
    const k = kind || 'other';
    if (!this.KINDS.includes(k)) throw new Error('Unknown kind: ' + kind);
    this._parseDay(due);
    let work = null;
    if (total != null && total !== '') {
      const t = Number(total), dn = Number(done || 0);
      if (!Number.isFinite(t) || t <= 0 || t > 1000000) throw new Error('The amount of work must be a positive number');
      if (!Number.isFinite(dn) || dn < 0) throw new Error('"Done" cannot be negative');
      if (dn > t) throw new Error('"Done" is more than the total');
      const u = unit || 'items';
      if (!this.UNITS.includes(u)) throw new Error('Unknown unit: ' + unit);
      work = { unit: u, total: t, done: dn };
    }
    let link = '';
    if (url) {
      let u;
      try { u = new URL(String(url)); } catch { throw new Error('That is not a web address'); }
      if (!/^https?:$/.test(u.protocol)) throw new Error('Only a web address can be attached');
      link = u.href.slice(0, 2048);
    }
    return { id: id || 'dl_' + now.toString(36) + Math.random().toString(36).slice(2, 6), title: name, kind: k, due, work, withCards: !!withCards, url: link, doneAt: 0 };
  },
  daysLeft(e, now = Date.now()) {
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    return Math.round((this._parseDay(e.due).getTime() - today.getTime()) / this.DAY);
  },
  share(e, now = Date.now()) {
    if (!e.work) return null;
    const left = Math.max(0, e.work.total - e.work.done);
    const days = Math.max(1, this.daysLeft(e, now));
    return { left, perDay: left ? Math.ceil(left / days) : 0, unit: e.work.unit, days };
  },
  status(e, now = Date.now()) {
    if (e.doneAt) return 'done';
    const d = this.daysLeft(e, now);
    return d < 0 ? 'late' : d === 0 ? 'today' : d <= 3 ? 'soon' : 'ok';
  },
  label(e, now = Date.now()) {
    const d = this.daysLeft(e, now);
    return d < 0 ? Math.abs(d) + ' day' + (d === -1 ? '' : 's') + ' late' : d === 0 ? 'due today' : d === 1 ? '1 day left' : d + ' days left';
  },
  // What the open entries ask of today, summed per unit: { pages: 40, cards: 20 }.
  dailyShare(now = Date.now(), entries = this.list()) {
    const out = {};
    for (const e of entries) {
      if (e.doneAt) continue;
      const s = this.share(e, now);
      if (s && s.perDay) out[s.unit] = (out[s.unit] || 0) + s.perDay;
    }
    return out;
  },
  // What the open entries ask on one given day, spread evenly from today to each due day: { hours: 2, cards: 20 }.
  // A day after an entry's due day asks nothing of it. dayStart is the local midnight of that day.
  shareOn(dayStart, now = Date.now(), entries = this.list()) {
    const out = {};
    for (const e of entries) {
      if (e.doneAt || this._parseDay(e.due).getTime() < dayStart) continue;
      const s = this.share(e, now);
      if (s && s.perDay) out[s.unit] = (out[s.unit] || 0) + s.perDay;
    }
    return out;
  },
  cardsDue(now = Date.now()) {
    if (typeof Flashcards === 'undefined' || typeof Flashcards.due !== 'function') return null;
    return Flashcards.due(now).length;
  },

  // ---- storage ---------------------------------------------------------------------------
  list() {
    const raw = localStorage.getItem(this.KEY);
    if (raw == null) return [];
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('Your deadlines could not be read: ' + err.message); }
    return (Array.isArray(v) ? v : []).filter(x => x && x.id && typeof x.title === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.due || ''));
  },
  _save(items) {
    try { localStorage.setItem(this.KEY, JSON.stringify(items.slice(0, this.MAX))); }
    catch (err) { throw new Error('Your deadlines could not be saved: ' + err.message); }
  },
  add(fields) {
    const items = this.list();
    if (items.length >= this.MAX) throw new Error('That is ' + this.MAX + ' deadlines; remove some first');
    const e = this.make(fields);
    items.push(e);
    this._save(items);
    if (typeof VexUsage !== 'undefined') VexUsage.touch('deadline-ledger');
    return e;
  },
  // A deadline the finder (js/deadline-extractor.js) read from a page and you confirmed.
  addFromFound(found, { title, url } = {}) {
    if (!found || !Number.isFinite(found.dueAt)) throw new Error('That deadline has no day');
    const d = new Date(found.dueAt);
    const due = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return this.add({ title: title || String(found.sentence || found.phrase || '').slice(0, 100), due, url });
  },
  setProgress(id, done) {
    const items = this.list();
    const e = items.find(x => x.id === id);
    if (!e) throw new Error('That deadline is gone');
    if (!e.work) throw new Error('This deadline has no amount of work to move forward');
    const dn = Number(done);
    if (!Number.isFinite(dn) || dn < 0 || dn > e.work.total) throw new Error('"Done" must be between 0 and ' + e.work.total);
    e.work.done = dn;
    this._save(items);
    return e;
  },
  finish(id, now = Date.now()) {
    const items = this.list();
    const e = items.find(x => x.id === id);
    if (!e) throw new Error('That deadline is gone');
    e.doneAt = now;
    this._save(items);
    return e;
  },
  remove(id) {
    const items = this.list();
    if (!items.some(x => x.id === id)) throw new Error('That deadline is gone');
    this._save(items.filter(x => x.id !== id));
  },

  // ---- What is due ---------------------------------------------------------------------------
  _dueRows(now) {
    const rows = [];
    for (const e of this.list()) {
      if (e.doneAt) continue;
      const s = this.share(e, now);
      const day = this._parseDay(e.due);
      rows.push({ id: 'deadline:' + e.id, kind: 'deadline', text: e.title + ' (' + this.label(e, now) + ')', at: day.getTime(), hasTime: false, sub: s && s.perDay ? s.perDay + ' ' + s.unit + ' a day' : this.KIND_LABEL[e.kind] });
    }
    return rows;
  },

  // ---- the screen ------------------------------------------------------------------------------
  open() {
    if (!this.enabled()) { window.showToast?.('The deadline ledger is switched off in Settings', 'info'); return; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('deadline-ledger');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-deadline-ledger', title: 'Deadlines', sub: 'Days left and the share of work for each day. You enter the work and move it forward; nothing is read from a book or a deck.' });
    const draw = () => {
      body.textContent = '';
      const mk = (tag, props = {}) => Object.assign(document.createElement(tag), props);
      const form = mk('div'); form.className = 'vexsr-rule'; form.style.flexWrap = 'wrap';
      const title = mk('input', { type: 'text', placeholder: 'Linear Algebra exam', maxLength: 100 }); title.setAttribute('aria-label', 'Name');
      const kind = mk('select'); kind.setAttribute('aria-label', 'Kind');
      for (const k of this.KINDS) kind.append(new Option(this.KIND_LABEL[k], k));
      const due = mk('input', { type: 'date' }); due.setAttribute('aria-label', 'Due day');
      const total = mk('input', { type: 'number', min: '1', placeholder: 'Total work', step: '1' }); total.setAttribute('aria-label', 'Total amount of work (optional)'); total.style.width = '90px';
      const unit = mk('select'); unit.setAttribute('aria-label', 'Unit');
      for (const u of this.UNITS) unit.append(new Option(u, u));
      const cards = mk('input', { type: 'checkbox' }); cards.setAttribute('aria-label', 'Show the cards due now');
      const cl = mk('label'); cl.append(cards, document.createTextNode(' show cards due'));
      form.append(title, kind, due, total, unit, cl, VexSettingsGroups.button('Add', () => {
        try { this.add({ title: title.value, kind: kind.value, due: due.value, total: total.value, unit: unit.value, withCards: cards.checked }); draw(); }
        catch (err) { window.showToast?.(err.message, 'error'); }
      }, { primary: true }));
      body.appendChild(form);

      let items;
      try { items = this.list(); } catch (err) { body.appendChild(VexSettingsGroups.note(err.message)); return; }
      const now = Date.now();
      const open = items.filter(e => !e.doneAt).sort((a, b) => a.due.localeCompare(b.due));
      if (!open.length) body.appendChild(VexSettingsGroups.note('No deadlines yet. Add one above, or press Add to deadlines on a row in Find deadlines.'));
      const today = this.dailyShare(now, open);
      if (Object.keys(today).length) body.appendChild(VexSettingsGroups.note('Today asks for ' + Object.entries(today).map(([u, n]) => n + ' ' + u).join(' and ') + ' across your deadlines.'));
      for (const e of open) {
        const row = mk('div'); row.className = 'vexsr-rule'; row.style.flexWrap = 'wrap';
        const chip = mk('span', { textContent: this.label(e, now) }); chip.className = 'vexsr-mode'; chip.style.minWidth = '100px';
        const s = this.share(e, now);
        const cd = e.withCards ? this.cardsDue(now) : null;
        const text = mk('span', { textContent: e.title + '  (' + this.KIND_LABEL[e.kind] + (s ? ', ' + s.left + ' ' + s.unit + ' left' + (s.perDay ? ', ' + s.perDay + ' a day' : '') : '') + (cd != null ? ', cards due now: ' + cd : '') + ')' });
        text.className = 'vexsr-host'; text.style.wordBreak = 'normal';
        row.append(chip, text);
        if (e.work) {
          const dn = mk('input', { type: 'number', min: '0', max: String(e.work.total), value: String(e.work.done) }); dn.setAttribute('aria-label', 'Done so far for ' + e.title); dn.style.width = '80px';
          row.append(dn, VexSettingsGroups.button('Save', () => { try { this.setProgress(e.id, dn.value); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }, { label: 'Save progress for ' + e.title }));
        }
        row.append(
          VexSettingsGroups.button('Done', () => { try { this.finish(e.id); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }, { primary: true, label: 'Mark done: ' + e.title }),
          VexSettingsGroups.button('Remove', () => { try { this.remove(e.id); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }, { danger: true, label: 'Remove: ' + e.title }),
        );
        body.appendChild(row);
      }
    };
    draw();
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Exams, assignments, releases and books with a countdown, and the share of work to do each day. Anything due this week also shows in What is due and the Morning Brief.'));
    el.appendChild(VexSettingsGroups.button('Open the deadlines', () => this.open(), { primary: true }));
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    if (typeof VexDueness !== 'undefined' && typeof VexDueness.addSource === 'function') {
      VexDueness.addSource('deadline-ledger', { kind: 'deadline', label: 'Deadline' }, (now) => (this.enabled() ? this._dueRows(now) : []));
    }
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.VexDeadlineLedger = VexDeadlineLedger;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'deadline-ledger', title: 'Deadlines', keywords: 'deadline countdown exam assignment release book pages per day reading pace days left', before: 'about', build: (el) => VexDeadlineLedger.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'deadline-ledger', label: 'Deadlines with countdown', hint: 'Days left, the share of work per day and cards due for exams, assignments, releases and books', icon: 'flag', action: () => VexDeadlineLedger.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDeadlineLedger };
