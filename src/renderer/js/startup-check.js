// === Startup-persistence check (T3-122): what starts when you sign in ============
//
// A read-only list for you to review (src/main/startup-check.js does the reading): the
// Run and RunOnce registry keys, the two Startup folders and the names of Scheduled Tasks.
// Vex's own entries (Open at login, the reminder wake-up tasks) are shown first and marked.
// Entries that were not in the list the last time you pressed "Mark as reviewed" are shown
// as New. Nothing is changed, removed or disabled from here, and nothing is checked for
// a signature: remove or disable an entry in Task Manager > Startup apps, the Startup
// folder, or Task Scheduler yourself.
const VexStartupCheck = {
  ENABLED_KEY: 'vex.startupCheck.enabled',
  LAST_KEY: 'vex.startupCheck.last',
  FEATURE: 'startup-check',

  enabled() {
    try { return localStorage.getItem(this.ENABLED_KEY) === 'true'; }
    catch (err) { console.error('[StartupCheck] the switch could not be read:', err); return false; }
  },
  setEnabled(on) { localStorage.setItem(this.ENABLED_KEY, on ? 'true' : 'false'); this.registerCommands(); },

  // ---- pure -------------------------------------------------------------------------------
  // items: from startup:list. prevIds: ids of the list you reviewed last, or null for a first look.
  // -> { vex:[], fresh:[], other:[], firstLook:boolean }
  group(items, prevIds) {
    const prev = Array.isArray(prevIds) ? new Set(prevIds) : null;
    const out = { vex: [], fresh: [], other: [], firstLook: !prev };
    for (const it of items) {
      if (it.vex) out.vex.push(it);
      else if (prev && !prev.has(it.id)) out.fresh.push(it);
      else out.other.push(it);
    }
    return out;
  },

  last() {
    const raw = localStorage.getItem(this.LAST_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || !Array.isArray(v.ids)) throw new Error('The saved startup list is not readable, so it was not changed');
    return v;
  },

  async scan() {
    if (!window.vex || typeof window.vex.startupList !== 'function') throw new Error('The startup check is not available in this window');
    const r = await window.vex.startupList();
    if (!r || r.ok === false) throw new Error((r && r.error) || 'The startup places could not be read');
    return r;
  },

  _el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; },

  async open() {
    if (!this.enabled()) throw new Error('The startup check is switched off in Settings');
    const { body } = VexSettingsGroups.dialog({ id: 'startup-check', title: 'What starts with Windows', sub: 'Read-only. Vex lists these places; it never changes them.' });
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    body.appendChild(this._el('p', 'setting-info', 'Reading...'));
    const r = await this.scan();
    const prev = this.last();
    const g = this.group(r.items, prev ? prev.ids : null);
    body.textContent = '';
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const section = (title, rows, note) => {
      if (!rows.length) return;
      body.appendChild(this._el('div', 'setting-label', title + ' (' + rows.length + ')'));
      if (note) body.appendChild(this._el('p', 'setting-info', note));
      for (const it of rows) {
        const card = this._el('div', 'ad-page' + (g.fresh.includes(it) ? ' fresh' : ''));
        const head = this._el('div', 'ad-head');
        head.append(this._el('strong', '', it.name), this._el('span', 'ad-state', it.where));
        card.appendChild(head);
        if (it.data) card.appendChild(this._el('div', 'ad-url', it.data));
        body.appendChild(card);
      }
    };
    section('Vex\'s own', g.vex, 'These are Vex: "Open at login" and the Windows wake-up tasks for your reminders.');
    section('New since you last reviewed', g.fresh, 'Not in the list you reviewed last time. If you do not recognise one, look it up before you leave it.');
    section(g.firstLook ? 'Everything else' : 'Unchanged', g.other, g.firstLook ? 'This is the first look, so nothing is marked New yet. Review the list, then press Mark as reviewed.' : '');
    if (!r.items.length) body.appendChild(this._el('p', 'setting-info', 'Nothing was found in these places.'));
    body.appendChild(this._el('p', 'setting-info', r.microsoftTasks + ' Microsoft scheduled tasks are not listed. Entries are not checked for a publisher or signature.'));
    for (const e of r.errors || []) body.appendChild(this._el('p', 'setting-info', 'Could not read: ' + e));
    if (r.truncated) body.appendChild(this._el('p', 'setting-info', 'Only the first entries are shown.'));
    const row = this._el('div', 'ad-actions');
    const mark = this._el('button', 'btn-secondary', 'Mark as reviewed'); mark.type = 'button';
    mark.addEventListener('click', () => {
      try { localStorage.setItem(this.LAST_KEY, JSON.stringify({ at: Date.now(), ids: r.items.map(i => i.id) })); window.showToast?.('Saved. Anything new after this will be marked.'); }
      catch (err) { fail(err); }
    });
    row.appendChild(mark);
    body.appendChild(row);
  },

  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return false;
    VexModuleCommands.set('startup:', this.enabled() ? [
      { id: 'startup:check', label: 'Startup check', icon: 'shield', hint: 'List what starts with Windows, read-only', action: () => { this.open().catch((err) => window.showToast?.((err && err.message) || String(err), 'error')); } },
    ] : []);
    return true;
  },

  settingsRows(body) {
    const S = VexSettingsGroup;
    body.appendChild(S.note('A read-only list of what starts when you sign in to Windows: the Run keys, the Startup folders and the names of scheduled tasks, with Vex\'s own marked and anything new since your last review flagged. Vex only lists them; it never removes or disables anything.'));
    body.appendChild(S.toggle('Startup check', this.enabled(), (on) => { this.setEnabled(on); if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE); }, 'Ctrl+K > Startup check'));
    if (this.enabled()) body.appendChild(S.button('Check now...', () => { this.open().catch((err) => window.showToast?.((err && err.message) || String(err), 'error')); }));
  },
};

if (typeof window !== 'undefined') {
  window.VexStartupCheck = VexStartupCheck;
  VexStartupCheck.registerCommands();
  document.addEventListener('DOMContentLoaded', () => VexStartupCheck.registerCommands());
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'startup-check', title: 'Startup check', keywords: 'startup persistence run key scheduled task malware autostart', before: 'about', render: (body) => VexStartupCheck.settingsRows(body) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexStartupCheck };
