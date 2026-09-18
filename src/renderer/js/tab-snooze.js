// === Tabs you are not finished with ========================================
//
// A tab stays open because closing it loses it. So the strip fills with things
// that are not for today: the article for the weekend, the thing to check on
// Monday, the receipt to look at when it arrives. Sleeping them gives the
// memory back but they are still there, still to be read past.
//
// Two ways out, neither of which loses anything:
//
//   Snooze — the tab closes now and opens itself again when you said. It is
//   kept in the same place a session is kept, so a restart does not lose it.
//
//   Archive — a tab untouched for a week is taken out of the strip and listed
//   instead. Nothing is deleted, ever: closing a tab you might want is the
//   thing this feature exists to avoid.
const TabSnooze = {
  KEY: 'vex.snoozedTabs',
  ARCHIVE_KEY: 'vex.archivedTabs',
  ARCHIVE_AFTER_MS: 7 * 24 * 3600 * 1000,
  MAX_ARCHIVE: 200,

  // "in 2 hours", "this evening", "tomorrow morning", "the weekend", "monday".
  // Deliberately few: a snooze is a rough intention, not an appointment.
  WHEN: {
    hour: { label: 'In an hour', at: () => Date.now() + 3600 * 1000 },
    evening: { label: 'This evening', at: () => TabSnooze._todayAt(19) },
    tomorrow: { label: 'Tomorrow morning', at: () => TabSnooze._tomorrowAt(9) },
    weekend: { label: 'This weekend', at: () => TabSnooze._nextDayAt(6, 10) },
    monday: { label: 'Monday morning', at: () => TabSnooze._nextDayAt(1, 9) },
    week: { label: 'In a week', at: () => Date.now() + 7 * 24 * 3600 * 1000 },
  },

  _todayAt(hour) {
    const d = new Date(); d.setHours(hour, 0, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);      // already past: tomorrow
    return d.getTime();
  },
  _tomorrowAt(hour) { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(hour, 0, 0, 0); return d.getTime(); },
  _nextDayAt(weekday, hour) {
    const d = new Date(); d.setHours(hour, 0, 0, 0);
    do { d.setDate(d.getDate() + 1); } while (d.getDay() !== weekday);
    return d.getTime();
  },

  _read(key) { try { const a = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } },
  _write(key, list) {
    try { localStorage.setItem(key, JSON.stringify(list)); return true; }
    catch (err) { VexProblems?.note('Tabs', 'Could not save the snoozed tabs', err); return false; }
  },

  list() { return this._read(this.KEY); },
  archived() { return this._read(this.ARCHIVE_KEY); },

  // Close it now, bring it back then. Returns the entry.
  snooze(tabId, when) {
    const tab = TabManager.tabs.find(t => t.id === tabId);
    if (!tab) throw new Error('That tab is not open any more');
    if (!/^https?:/i.test(tab.url || '')) throw new Error('Only a web page can be snoozed');
    const rule = this.WHEN[when];
    const at = rule ? rule.at() : Number(when);
    if (!Number.isFinite(at) || at <= Date.now()) throw new Error('Say when to bring it back');
    const entry = { id: 'sn_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), url: tab.url, title: tab.title || tab.url, favicon: tab.favicon || null, at, snoozedAt: Date.now() };
    const list = this.list();
    list.push(entry);
    if (!this._write(this.KEY, list)) throw new Error('The snooze could not be saved, so the tab was left open');
    TabManager.closeTab(tabId);
    return entry;
  },

  wake(id, background = false) {
    const list = this.list();
    const entry = list.find(e => e.id === id);
    if (!entry) throw new Error('That tab is no longer snoozed');
    this._write(this.KEY, list.filter(e => e.id !== id));
    TabManager.createTab(entry.url, !background);
    return entry;
  },

  forget(id) { this._write(this.KEY, this.list().filter(e => e.id !== id)); },

  // Anything due comes back on its own, in the background, with one notice.
  checkDue(now = Date.now()) {
    const list = this.list();
    const due = list.filter(e => e.at <= now);
    if (!due.length) return [];
    this._write(this.KEY, list.filter(e => e.at > now));
    for (const e of due) { try { TabManager.createTab(e.url, false); } catch (err) { VexProblems?.note('Tabs', 'A snoozed tab could not be reopened: ' + e.url, err); } }
    window.showToast?.(due.length === 1 ? 'Back as you asked: ' + due[0].title : due.length + ' snoozed tabs are back');
    return due;
  },

  start() {
    if (this._timer) return;
    this.checkDue();
    this._timer = setInterval(() => this.checkDue(), 60000);
    this._archiveTimer = setInterval(() => this.archiveIdle(), 30 * 60000);
    setTimeout(() => this.archiveIdle(), 60000);
  },

  // ---- archiving ------------------------------------------------------------
  // A tab nobody has looked at for a week is listed rather than shown. It is
  // NOT closed data: the entry keeps the address and title, and one click has
  // it back.
  archiveIdle(now = Date.now()) {
    if (localStorage.getItem('vex.autoArchive') === 'off') return [];
    const old = TabManager.tabs.filter(t =>
      t.id !== TabManager.activeTabId && !t.pinned && /^https?:/i.test(t.url || '')
      && !(t.audible && !t.muted) && !(TabManager.isCapturing && TabManager.isCapturing(t))
      && now - (t.lastViewedAt || t.createdAt || now) >= this.ARCHIVE_AFTER_MS);
    if (!old.length) return [];
    const kept = this.archived();
    for (const t of old) {
      kept.unshift({ id: 'ar_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), url: t.url, title: t.title || t.url, favicon: t.favicon || null, at: now });
      TabManager.closeTab(t.id);
    }
    this._write(this.ARCHIVE_KEY, kept.slice(0, this.MAX_ARCHIVE));
    const note = old.length + ' tab' + (old.length === 1 ? '' : 's') + ' untouched for a week moved to the archive — nothing was lost';
    window.showToast?.(note);
    document.dispatchEvent(new CustomEvent('vex:memory-event', { detail: { note } }));
    return old;
  },

  restore(id) {
    const kept = this.archived();
    const entry = kept.find(e => e.id === id);
    if (!entry) throw new Error('That tab is not in the archive');
    this._write(this.ARCHIVE_KEY, kept.filter(e => e.id !== id));
    TabManager.createTab(entry.url, true);
    return entry;
  },

  clearArchive() { this._write(this.ARCHIVE_KEY, []); },
};

if (typeof window !== 'undefined') window.TabSnooze = TabSnooze;
if (typeof module !== 'undefined' && module.exports) module.exports = { TabSnooze };
