// === Vex Mobile — reminders ===
//
// "Bring this page back this evening." The desktop asks Windows to wake Vex
// (src/main/os-schedule.js); the phone asks Android for an alarm, and gets a
// notification that opens the page even if Vex is not running.
//
// The list lives here; the alarm lives in the system. That means a reminder
// survives Vex being killed, and a reminder deleted here is cancelled there.

const VexRemind = (() => {
  const PRESETS = [
    { id: 'hour', label: 'In an hour', minutes: 60 },
    { id: 'evening', label: 'This evening', at: () => atHour(19) },
    { id: 'tomorrow', label: 'Tomorrow morning', at: () => atHour(9, 1) },
    { id: 'weekend', label: 'At the weekend', at: () => atWeekend() },
    { id: 'week', label: 'In a week', minutes: 60 * 24 * 7 }
  ];

  function atHour(hour, addDays = 0) {
    const when = new Date();
    when.setDate(when.getDate() + addDays);
    when.setHours(hour, 0, 0, 0);
    if (when.getTime() <= Date.now()) when.setDate(when.getDate() + 1);
    return when.getTime();
  }

  function atWeekend() {
    const when = new Date();
    const days = (6 - when.getDay() + 7) % 7 || 7;      // the coming Saturday
    when.setDate(when.getDate() + days);
    when.setHours(10, 0, 0, 0);
    return when.getTime();
  }

  function all() {
    const stored = VexStore.get('vex.reminders', []);
    return Array.isArray(stored) ? stored : [];
  }

  return {
    PRESETS,
    all,

    pending() { return all().filter(entry => entry.at > Date.now()).sort((a, b) => a.at - b.at); },

    async add({ url, title, note, at }) {
      if (!url || !at) return null;
      const entry = {
        id: VexCollections.id('rem_'),
        url, title: title || url, note: note || '', at, madeAt: Date.now()
      };
      const result = await VexBridge.scheduleReminder(entry);
      entry.exact = !!(result && result.exact);
      await VexStore.set('vex.reminders', [...all(), entry].slice(-100));
      return entry;
    },

    async remove(id) {
      await VexBridge.cancelReminder(id);
      await VexStore.set('vex.reminders', all().filter(entry => entry.id !== id));
    },

    // Native keeps its own copy and re-arms it as the phone boots; this is
    // for a list that changed without it (restored from a backup, say).
    async rearm() {
      const live = this.pending();
      for (const entry of live) await VexBridge.scheduleReminder(entry);
      // Drop the ones that have already gone off.
      const stale = all().filter(entry => entry.at <= Date.now());
      if (stale.length) await VexStore.set('vex.reminders', live);
      return live.length;
    },

    describe(at) {
      const when = new Date(at);
      const today = new Date().toDateString() === when.toDateString();
      const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      return today ? 'today at ' + time : when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' at ' + time;
    }
  };
})();

if (typeof window !== 'undefined') window.VexRemind = VexRemind;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexRemind };
