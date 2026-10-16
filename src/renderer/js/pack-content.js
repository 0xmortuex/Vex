// === Content from packs: holidays and phrases to copy =========================
//
// Two kinds of pack item have no feature of their own to read them:
//
//   dates     a dated list (the bundled Turkish public holidays 2026-2028). Read here
//             as VexHolidays: is a day a holiday, the next working day, the holidays
//             coming up, and the days that may be bridged. A bayram entry is marked
//             "verify with Diyanet" because the religious calendar is announced by the
//             authority, not computed here; the screens say so.
//   snippets  phrases to copy (the bundled Model UN procedure phrases). Read here as
//             VexSnippets: a searchable list; pressing one copies its text. Nothing is
//             inserted into a page and nothing is sent.
//
// Both only ever show text from packs that are installed (or built in) AND switched on
// (VexPacks.items), through textContent. They keep no data of their own: switch the pack
// off and they are empty. The one switch kept here hides the two commands.
//
// A bridge day is only a hint (the day between a holiday and a weekend): the government
// decides each year whether it is a day off, so it is shown as "ask", never as a fact.
const VexPackContent = {
  KEY: 'vex.packContent.enabled',     // '0' = off
  FEATURE: 'pack-content',
  _snippets: [],
  _dates: [],

  enabled() { try { return localStorage.getItem(this.KEY) !== '0'; } catch (err) { console.error('[PackContent] the switch could not be read:', err.message); return true; } },
  setEnabled(on) { localStorage.setItem(this.KEY, on ? '1' : '0'); this._registerCommands(); },

  // Called by VexPackConsumers with [{ packId, packName, item }].
  setSnippets(list) { this._snippets = Array.isArray(list) ? list.slice(0, 50) : []; return this._snippets.length; },
  setDates(list) { this._dates = Array.isArray(list) ? list.slice(0, 20) : []; this._flat = null; return this._dates.length; },

  // ---- days (plain YYYY-MM-DD, calendar math in UTC so daylight saving never moves one) -------------
  isoOk(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s; },
  addDays(iso, n) {
    if (!this.isoOk(iso)) throw new Error('Not a date: ' + iso);
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  },
  weekday(iso) { if (!this.isoOk(iso)) throw new Error('Not a date: ' + iso); return new Date(iso + 'T00:00:00Z').getUTCDay(); },   // 0 = Sunday
  today(now = new Date()) { const p = (n) => String(n).padStart(2, '0'); return now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate()); },

  // ---- holidays ---------------------------------------------------------------------------------------
  // [{ date, name, kind, verify, pack }] sorted, one row per (date, name).
  all() {
    if (this._flat) return this._flat;
    const seen = new Set();
    const out = [];
    for (const { packName, item } of this._dates) {
      for (const e of item.entries) {
        const k = e.date + '|' + e.name;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ date: e.date, name: e.name, kind: e.kind, verify: !!e.verify, pack: packName });
      }
    }
    out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
    this._flat = out;
    return out;
  },
  available() { return this.enabled() && this.all().length > 0; },
  on(iso) { return this.all().filter(h => h.date === iso); },
  // A whole day off (a half day is not).
  isHoliday(iso) { return this.on(iso).some(h => h.kind !== 'half-day'); },
  isHalfDay(iso) { return !this.isHoliday(iso) && this.on(iso).some(h => h.kind === 'half-day'); },
  isWeekend(iso) { const d = this.weekday(iso); return d === 0 || d === 6; },
  isWorkday(iso) { return !this.isWeekend(iso) && !this.isHoliday(iso); },
  // The first working day on or after `iso`. Throws if no date in the next 30 days is one
  // (a data error, not something to guess around).
  nextWorkday(iso) {
    let d = iso;
    for (let i = 0; i < 30; i++, d = this.addDays(d, 1)) if (this.isWorkday(d)) return d;
    throw new Error('No working day in the 30 days after ' + iso);
  },
  upcoming(fromIso, n = 8) { return this.all().filter(h => h.date >= fromIso && h.kind !== 'half-day').slice(0, n); },
  // Days that sit between a holiday and a weekend: a holiday on a Tuesday leaves the Monday, on a
  // Thursday the Friday. -> [{ date, holiday }]. A hint only: the government decides each year.
  bridgeHints(fromIso, toIso) {
    const out = [];
    for (const h of this.all()) {
      if (h.date < fromIso || h.date > toIso || h.kind === 'half-day') continue;
      const wd = this.weekday(h.date);
      const gap = wd === 2 ? this.addDays(h.date, -1) : wd === 4 ? this.addDays(h.date, 1) : null;
      if (gap && this.isWorkday(gap)) out.push({ date: gap, holiday: h });
    }
    return out;
  },
  dayLabel(iso) {
    const d = new Date(iso + 'T00:00:00');
    try { return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); } catch (err) { console.error('[PackContent] could not format a date:', err.message); return iso; }
  },

  // ---- phrases ---------------------------------------------------------------------------------------------
  // [{ pack, group, label, text }]
  phrases() {
    const out = [];
    for (const { packName, item } of this._snippets) for (const e of item.entries) out.push({ pack: packName, group: item.name, label: e.label, text: e.text });
    return out;
  },
  filter(list, q) {
    const s = String(q || '').trim().toLowerCase();
    return s ? list.filter(p => (p.label + ' ' + p.text + ' ' + p.group).toLowerCase().includes(s)) : list;
  },
  async copy(text) {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('Copying is not available in this window');
    await navigator.clipboard.writeText(String(text));
  },

  // A phrase as one of the person's own text shortcuts (js/text-snippets.js): type :trigger and Tab in a text box.
  // It is added only when they press the button and name the trigger; the phrase stays theirs after the pack goes.
  async saveAsSnippet(p) {
    if (typeof VexSnippets === 'undefined') throw new Error('Text shortcuts are not available in this build');
    if (typeof vexPrompt !== 'function') throw new Error('Vex could not ask you, so nothing was saved');
    const slug = String(p.label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20);
    const trigger = await vexPrompt({ title: 'Make a typing shortcut', label: 'Type this, then Tab, in any text box to get the phrase', value: ':' + slug, okLabel: 'Save' });
    if (trigger == null) return null;
    const saved = VexSnippets.save(trigger, p.text);
    window.showToast?.('Saved ' + saved + ' as a text shortcut');
    return saved;
  },

  // ---- screens ----------------------------------------------------------------------------------------------
  openPhrases() {
    if (typeof VexSettingsGroups === 'undefined') throw new Error('Dialogs are not loaded');
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    const all = this.phrases();
    const { body } = VexSettingsGroups.dialog({ id: 'vex-phrases', title: 'Phrases to copy', sub: 'Press a phrase to copy it. Square brackets are for you to fill in. Check your conference\'s own rules of procedure: they differ.' });
    if (!all.length) { body.appendChild(VexSettingsGroups.note('No phrase pack is switched on. Open Vex Packs and switch on "Model UN procedure phrases".')); return; }
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'set-input';
    search.placeholder = 'Search phrases';
    search.setAttribute('aria-label', 'Search phrases');
    const list = document.createElement('div');
    list.className = 'vexsr-list';
    const draw = () => {
      list.textContent = '';
      let group = null;
      for (const p of this.filter(all, search.value)) {
        if (p.group !== group) { group = p.group; const h = document.createElement('div'); h.className = 'vexsr-mode'; h.textContent = p.pack + ' - ' + p.group; list.appendChild(h); }
        const row = document.createElement('div');
        row.className = 'vexsr-rule';
        const t = document.createElement('span'); t.className = 'vexsr-host'; t.style.wordBreak = 'normal';
        const a = document.createElement('div'); a.textContent = p.label;
        const b = document.createElement('div'); b.className = 'vexsr-mode'; b.style.whiteSpace = 'normal'; b.textContent = p.text;
        t.append(a, b);
        row.appendChild(t);
        row.appendChild(VexSettingsGroups.button('Copy', () => { this.copy(p.text).then(() => window.showToast?.('Copied: ' + p.label), (err) => window.showToast?.(err.message, 'error')); }, { label: 'Copy: ' + p.label }));
        if (typeof VexSnippets !== 'undefined') row.appendChild(VexSettingsGroups.button('Make a :shortcut', () => this.saveAsSnippet(p).catch(err => window.showToast?.(err.message, 'error')), { label: 'Make a typing shortcut for: ' + p.label }));
        list.appendChild(row);
      }
      if (!list.firstChild) { const e = document.createElement('div'); e.className = 'vexsr-mode'; e.textContent = 'No phrase matches.'; list.appendChild(e); }
    };
    search.addEventListener('input', draw);
    body.append(search, list);
    draw();
  },

  openHolidays(now = new Date()) {
    if (typeof VexSettingsGroups === 'undefined') throw new Error('Dialogs are not loaded');
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    const { body } = VexSettingsGroups.dialog({ id: 'vex-holidays', title: 'Public holidays', sub: 'From the holiday pack you switched on. Dates marked "verify" follow the religious calendar: check the official announcement.' });
    const today = this.today(now);
    const rows = this.upcoming(today, 12);
    if (!this.all().length) { body.appendChild(VexSettingsGroups.note('No holiday pack is switched on. Open Vex Packs and switch on "Turkish public holidays".')); return; }
    if (!rows.length) { body.appendChild(VexSettingsGroups.note('The holiday data ends before today. A newer pack is needed.')); return; }
    const hints = this.bridgeHints(today, rows[rows.length - 1].date);
    const list = document.createElement('div');
    list.className = 'vexsr-list';
    for (const h of rows) {
      const row = document.createElement('div');
      row.className = 'vexsr-rule';
      const t = document.createElement('span'); t.className = 'vexsr-host'; t.style.wordBreak = 'normal';
      const a = document.createElement('div'); a.textContent = this.dayLabel(h.date) + ' - ' + h.name;
      t.appendChild(a);
      if (h.verify) { const v = document.createElement('div'); v.className = 'vexsr-mode'; v.textContent = 'Verify with Diyanet before you plan around it.'; t.appendChild(v); }
      const gap = hints.find(x => x.holiday === h);
      if (gap) { const g = document.createElement('div'); g.className = 'vexsr-mode'; g.textContent = 'Possible bridge day: ' + this.dayLabel(gap.date) + '. The government decides each year; ask.'; t.appendChild(g); }
      row.appendChild(t);
      list.appendChild(row);
    }
    body.appendChild(list);
  },

  _registerCommands() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return false;
    CommandBar.commands = CommandBar.commands.filter(c => c.id !== 'pack-phrases' && c.id !== 'pack-holidays');
    if (!this.enabled()) return true;
    CommandBar.commands.push(
      { id: 'pack-phrases', label: 'Phrases to copy', hint: 'Procedure phrases from the packs you switched on (Model UN); press one to copy it', icon: 'clipboard', action: () => this.openPhrases() },
      { id: 'pack-holidays', label: 'Public holidays coming up', hint: 'The next holidays from the holiday pack you switched on, with bridge-day hints', icon: 'calendar', action: () => this.openHolidays() },
    );
    return true;
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Holidays and phrases come from packs. Switch the packs on in Vex Packs (Ctrl+K, "Vex Packs"). This switch only hides the two commands.'));
    const row = document.createElement('label');
    row.className = 'setting-toggle-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = this.enabled();
    cb.addEventListener('change', () => this.setEnabled(cb.checked));
    row.append(cb, document.createTextNode(' Show "Phrases to copy" and "Public holidays coming up" in Ctrl+K'));
    el.appendChild(row);
  },
};

if (typeof window !== 'undefined') {
  window.VexPackContent = VexPackContent;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'pack-content', title: 'Holidays and phrases from packs', keywords: 'holiday bayram turkish diyanet model un mun phrases procedure pack', before: 'about', build: (el) => VexPackContent.group(el) });
  }
  VexPackContent._registerCommands();
  document.addEventListener('DOMContentLoaded', () => VexPackContent._registerCommands());
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPackContent };
