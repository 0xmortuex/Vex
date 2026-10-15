// === Time capsule ===========================================================
//
// Save a page, or a note to yourself, to be handed back on a date you choose.
// On that morning the reminder fires through the main process (the same
// reminders every other feature uses, so it survives a closed Vex) and the
// capsule shows in the brief until it is opened or put away.
//
// A capsule is { id, kind: 'page' | 'note', url?, title, text?, dueOn:
// 'YYYY-MM-DD', createdAt, openedAt?, reminderId? }, kept under
// 'vex.timeCapsules' on this PC. Nothing is sent anywhere.
//
// Off until switched on in Settings > Little surprises (js/delights.js).
const VexTimeCapsule = {
  KEY: 'vex.timeCapsules',
  MAX: 200,
  MAX_TEXT: 2000,
  DUE_HOUR: 9,

  // ---- pure helpers ---------------------------------------------------------
  dayKey(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  },
  // 'YYYY-MM-DD' -> local Date at hour, or null when it is not a real date.
  parseDay(s, hour = 0) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
    const d = new Date(y, mo - 1, da, hour, 0, 0, 0);
    if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;
    return d;
  },
  // Today plus N days, as a day key (the default for the prompt).
  inDays(n, now = new Date()) { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n); return this.dayKey(d); },

  isDue(c, now = new Date()) { return !c.openedAt && c.dueOn <= this.dayKey(now); },

  // ---- storage ----------------------------------------------------------------
  list() {
    const raw = localStorage.getItem(this.KEY);
    if (raw == null) return [];
    let a;
    try { a = JSON.parse(raw); } catch (err) { throw new Error('Your time capsules could not be read', { cause: err }); }
    return Array.isArray(a) ? a.filter(c => c && typeof c.id === 'string' && typeof c.dueOn === 'string') : [];
  },
  _save(list) {
    localStorage.setItem(this.KEY, JSON.stringify(list));
    try { document.dispatchEvent(new CustomEvent('vex:brief-changed')); } catch { /* no document */ }
  },

  due(now = new Date()) { return this.list().filter(c => this.isDue(c, now)).sort((a, b) => a.dueOn.localeCompare(b.dueOn)); },
  upcoming(now = new Date()) { return this.list().filter(c => !c.openedAt && !this.isDue(c, now)).sort((a, b) => a.dueOn.localeCompare(b.dueOn)); },

  // ---- actions ------------------------------------------------------------------
  // input: { url?, title?, text?, dueOn }. Throws a message a person can read.
  async add(input, now = new Date()) {
    const dueOn = String(input.dueOn || '').trim();
    const due = this.parseDay(dueOn, this.DUE_HOUR);
    if (!due) throw new Error('Give the date as YYYY-MM-DD, for example ' + this.inDays(30, now));
    if (dueOn <= this.dayKey(now)) throw new Error('Pick a day after today, the capsule is for later');
    const url = input.url ? String(input.url) : '';
    if (url && !/^https?:\/\//i.test(url)) throw new Error('Only web pages can go in a capsule');
    const text = String(input.text || '').trim().slice(0, this.MAX_TEXT);
    if (!url && !text) throw new Error('A capsule needs a page or a note');
    const list = this.list();
    if (list.filter(c => !c.openedAt).length >= this.MAX) throw new Error('That is ' + this.MAX + ' capsules waiting already');
    const title = String(input.title || text.split('\n')[0] || url).slice(0, 200);
    const cap = { id: window.vexId ? window.vexId('cap') : 'cap-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), kind: url ? 'page' : 'note', title, dueOn, createdAt: now.getTime() };
    if (url) cap.url = url;
    if (text) cap.text = text;
    // The reminder is what wakes Vex on the day; failing to make it is an
    // error, not a capsule that silently never opens.
    const b = window.vex && window.vex.reminders;
    if (!b || typeof b.create !== 'function') throw new Error('Reminders are not available here, so the capsule cannot wake you');
    const r = await b.create('Time capsule: ' + title, due.getTime(), url ? { url } : undefined);
    if (r && r.id) cap.reminderId = r.id;
    list.push(cap);
    this._save(list);
    return cap;
  },

  async remove(id) {
    const list = this.list();
    const i = list.findIndex(c => c.id === id);
    if (i < 0) throw new Error('That capsule is gone');
    const [cap] = list.splice(i, 1);
    this._save(list);
    const b = window.vex && window.vex.reminders;
    if (cap.reminderId && b && typeof b.delete === 'function') {
      try { await b.delete(cap.reminderId); } catch (err) { console.error('[TimeCapsule] could not remove its reminder:', err.message); }
    }
    return cap;
  },

  // Open: pages open in a tab, notes are shown; either way it is marked opened.
  async open(id) {
    const list = this.list();
    const cap = list.find(c => c.id === id);
    if (!cap) throw new Error('That capsule is gone');
    if (cap.url && typeof TabManager !== 'undefined' && typeof TabManager.createTab === 'function') TabManager.createTab(cap.url, true);
    cap.openedAt = Date.now();
    this._save(list);
    const b = window.vex && window.vex.reminders;
    if (cap.reminderId && b && typeof b.ack === 'function') {
      try { await b.ack(cap.reminderId); } catch (err) { console.error('[TimeCapsule] could not acknowledge its reminder:', err.message); }
    }
    if (cap.kind === 'note' && typeof window.vexAlert === 'function') {
      await window.vexAlert({ title: 'A note from ' + new Date(cap.createdAt).toLocaleDateString(), message: cap.text || cap.title });
    }
    try { document.dispatchEvent(new CustomEvent('vex:medal-signal', { detail: { id: 'time-capsule-opened' } })); } catch (err) { console.error('[TimeCapsule] medal signal failed:', err.message); }
    return cap;
  },

  // The guided way in, from the command bar: this page or a note.
  async create({ page = null } = {}) {
    const tab = page || ((typeof TabManager !== 'undefined' && TabManager.getActiveTab) ? TabManager.getActiveTab() : null);
    const usePage = !!(tab && tab.url && /^https?:\/\//i.test(tab.url));
    const text = usePage ? '' : await window.vexPrompt({ title: 'Note for your future self', label: 'What should it say?', multiline: true, okLabel: 'Next' });
    if (!usePage && !text) return null;
    const when = await window.vexPrompt({ title: 'Open it on', label: 'Date (YYYY-MM-DD)', value: this.inDays(30), okLabel: 'Seal it' });
    if (!when) return null;
    const cap = await this.add({ url: usePage ? tab.url : '', title: usePage ? (tab.title || tab.url) : '', text, dueOn: when });
    window.showToast?.('Sealed until ' + cap.dueOn, 'info', 2500);
    return cap;
  },

  // ---- brief section ---------------------------------------------------------
  section: {
    id: 'time-capsule',
    title: 'Time capsules',
    icon: 'timer',
    order: 95,
    defaultOn: false,
    isEnabled() { return typeof VexDelights !== 'undefined' && VexDelights.isOn('capsule'); },
    build() {
      const due = VexTimeCapsule.due();
      if (!due.length) return null;
      return {
        summary: due.length === 1 ? 'A capsule you sealed is ready.' : due.length + ' capsules you sealed are ready.',
        items: due.slice(0, 5).map(c => ({
          text: c.title,
          sub: c.kind === 'note' ? 'Note from ' + new Date(c.createdAt).toLocaleDateString() : (c.url || ''),
          url: c.url || undefined,
          when: c.dueOn,
        })),
        note: 'Open them from Command Bar > Open Time Capsules. Nothing else is asked of you.',
      };
    },
  },

  command: {
    id: 'time-capsule-new',
    label: 'Seal a Time Capsule',
    hint: 'Save this page or a note to be handed back on a date you choose',
    icon: 'timer',
    action: async () => {
      try {
        if (typeof VexDelights !== 'undefined' && !VexDelights.isOn('capsule')) throw new Error('Turn on Time capsules in Settings > Little surprises first');
        await VexTimeCapsule.create();
      } catch (err) { window.showToast?.(err.message, 'error'); }
    },
  },
  openCommand: {
    id: 'time-capsule-open',
    label: 'Open Time Capsules',
    hint: 'The capsules that are ready, and the ones still sealed',
    icon: 'timer',
    action: async () => {
      try {
        if (typeof VexDelights !== 'undefined' && !VexDelights.isOn('capsule')) throw new Error('Turn on Time capsules in Settings > Little surprises first');
        const due = VexTimeCapsule.due();
        if (!due.length) { const n = VexTimeCapsule.upcoming().length; window.showToast?.(n ? 'Nothing is ready yet. ' + n + ' still sealed.' : 'No capsules yet', 'info'); return; }
        await VexTimeCapsule.open(due[0].id);
      } catch (err) { window.showToast?.(err.message, 'error'); }
    },
  },
};

if (typeof window !== 'undefined') window.VexTimeCapsule = VexTimeCapsule;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTimeCapsule };
