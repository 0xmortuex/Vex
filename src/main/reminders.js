// === Reminders, owned by the main process ==================================
//
// "Paste what you have to do, say when, and Vex tells you later" only works if
// the telling is reliable. Reminders used to be renderer-side scheduler tasks
// whose notification path was dead (see notify.js), and which could not fire
// at all unless the window was open and the renderer alive. Now:
//
//   * The timer lives here, in the main process. A renderer reload, a closed
//     panel or a frozen tab cannot lose it.
//   * The toast is Electron's own Notification, which works — and reports
//     whether it showed. A refused toast is recorded and reported, not lost.
//   * On Windows, Task Scheduler holds a matching one-shot task that launches
//     Vex at the time if it is not running. On startup, anything already due
//     fires at once, marked with the time it was due.
//   * Nothing fires twice: a reminder is marked fired before its toast is
//     shown, and the store is written before anything else happens.
//
// State is a JsonStore key ('reminders') under userData — atomic, backed up,
// versioned like the rest of Vex's files. Everything is injected for tests.
const MAX_MESSAGE = 2000;
const CHECK_MS = 60 * 1000;      // how often the safety-net check runs
const MIN_LEAD_MS = 60 * 1000;   // reminders are set to the minute
const REPEATS = ['daily', 'weekdays', 'weekly'];
const KINDS = ['reminder', 'alarm', 'timer'];

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// The next occurrence of a repeating reminder, from local wall-clock fields
// so 09:00 stays 09:00 across a clock change. Always strictly after `after`.
// `repeat` is daily | weekdays | weekly, or an array of weekdays (0 = Sunday)
// — the alarm-clock form, "Mon Wed Fri".
function nextRepeat(atMs, repeat, after) {
  const d = new Date(atMs);
  const days = Array.isArray(repeat) ? repeat : null;
  if (days && !days.length) throw new Error('An alarm needs at least one day.');
  const step = () => {
    d.setDate(d.getDate() + (repeat === 'weekly' ? 7 : 1));
    if (repeat === 'weekdays') while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    if (days) while (!days.includes(d.getDay())) d.setDate(d.getDate() + 1);
  };
  step();
  while (d.getTime() <= after) step();
  return d.getTime();
}

// First occurrence of an alarm: today at HH:MM if still ahead and today is an
// allowed day, else the next allowed day.
function firstAlarmAt(hour, minute, days, now) {
  const d = new Date(now); d.setHours(hour, minute, 0, 0);
  const allowed = (Array.isArray(days) && days.length) ? days : [0, 1, 2, 3, 4, 5, 6];
  if (d.getTime() <= now || !allowed.includes(d.getDay())) {
    do { d.setDate(d.getDate() + 1); } while (!allowed.includes(d.getDay()));
  }
  return d.getTime();
}

// A host pattern for "next time I open …": the bare host, lower case, no www.
function siteKey(s) {
  let h = String(s || '').trim().toLowerCase();
  try { if (/^[a-z][a-z0-9+.-]*:\/\//.test(h)) h = new URL(h).hostname; } catch { /* keep as typed */ }
  return h.replace(/^www\./, '').replace(/\/.*$/, '');
}

function createReminders({ store, notifier, osScheduler, now = () => Date.now(), setTimeout: setT = setTimeout, clearTimeout: clearT = clearTimeout, onFired, log }) {
  if (!store || typeof store.update !== 'function') throw new Error('createReminders needs a JsonStore');
  if (!notifier || typeof notifier.show !== 'function') throw new Error('createReminders needs a notifier');
  const note = typeof log === 'function' ? log : () => {};
  const emit = (payload) => { try { if (typeof onFired === 'function') onFired(payload); } catch (err) { note(`[Reminders] onFired threw: ${err.message}`); } };

  let items = null;      // in-memory copy of the store
  let timer = null;
  let stopped = false;
  let inflight = Promise.resolve();   // the most recent due-check, awaitable

  async function load() {
    if (items) return items;
    const data = await store.read('reminders');
    items = Array.isArray(data) ? data.filter(r => r && typeof r.id === 'string') : [];
    return items;
  }

  async function persist() {
    await store.write('reminders', items);
  }

  // ---- the timer --------------------------------------------------------
  //
  // One self-rearming timeout aimed at the nearest unfired reminder, never
  // further away than CHECK_MS. Exact for the next one, and a safety net for a
  // clock that jumped (sleep, resume, a manual time change).
  function arm() {
    if (stopped) return;
    if (timer) { clearT(timer); timer = null; }
    const pending = (items || []).filter(r => !r.firedAt && r.at != null);
    if (!pending.length) return;
    // Under a hold, aim at the end of the hold so the batch goes out on time.
    const next = Math.max(Math.min(...pending.map(r => r.at)), holdUntil);
    const delay = Math.max(0, Math.min(CHECK_MS, next - now()));
    // The callback returns the check's promise. A real setTimeout ignores it;
    // an injected one (tests, a future scheduler) can await the whole chain —
    // toast, store write and all — instead of racing it.
    timer = setT(() => {
      timer = null;
      inflight = fireDue().catch(err => note(`[Reminders] fireDue failed: ${err.message}`));
      return inflight;
    }, delay);
  }

  // Everything a toast or the interface might want to know about a firing.
  const payloadOf = (r, late) => ({
    id: r.id, message: r.message, at: r.at, late, delivered: r.delivered, error: r.error || null,
    url: r.url || null, site: r.site || null, repeat: r.repeat || null, urgent: !!r.urgent,
    kind: r.kind || 'reminder', sound: !!r.sound,
  });

  async function registerOs(r) {
    if (!(osScheduler && osScheduler.supported) || r.at == null) return;
    try { await osScheduler.register(r.id, new Date(r.at)); r.os = { scheduled: true, error: null }; }
    catch (err) { r.os = { scheduled: false, error: err.message }; }
  }

  async function fireOne(r, { late = false } = {}) {
    // Mark first, write first. A crash after this point loses at most one
    // toast; a crash before it could show the same toast on every restart.
    // A repeating reminder is not "fired" — it moves to its next occurrence.
    const firedAt = now();
    const wasDueAt = r.at;
    if (r.repeat && r.at != null) {
      r.lastFiredAt = firedAt;
      r.at = nextRepeat(r.at, r.repeat, firedAt);
      r.ackedAt = null;   // a repeating alarm rings again until dismissed again
    } else {
      r.firedAt = firedAt;
    }
    await persist();

    const body = (late && wasDueAt != null ? `Due ${hhmm(wasDueAt)} — ` : '') + r.message;
    try {
      await notifier.show({ title: r.urgent ? 'Reminder — urgent' : 'Reminder', body, tag: r.id });
      r.delivered = 'toast';
      note(`[Reminders] fired ${r.id}${late ? ' (late)' : ''}${r.repeat ? ' (repeats ' + r.repeat + ')' : ''}`);
    } catch (err) {
      r.delivered = 'failed';
      r.error = err.message;
      note(`[Reminders] toast for ${r.id} failed: ${err.message}`);
    }
    await persist();
    emit(payloadOf({ ...r, at: wasDueAt }, late));

    if (osScheduler && osScheduler.supported && wasDueAt != null) {
      try { await osScheduler.unregister(r.id); }
      catch (err) { note(`[Reminders] could not remove the Windows task for ${r.id}: ${err.message}`); }
      // The next occurrence needs its own wake-up task.
      if (r.repeat) { await registerOs(r); await persist(); }
    }
  }

  // While a focus session runs, reminders wait — unless marked urgent — and
  // fire as a batch when it ends. The renderer sets and clears this.
  let holdUntil = 0;

  async function fireDue() {
    await load();
    const t = now();
    const held = t < holdUntil;
    // Oldest first, so a backlog reads in order. Site reminders have no time.
    const due = items
      .filter(r => !r.firedAt && r.at != null && r.at <= t && (!held || r.urgent))
      .sort((a, b) => a.at - b.at);
    for (const r of due) {
      // "Late" means missed by more than a check interval — Vex was closed or
      // asleep, and the person deserves to know when it was actually due.
      await fireOne(r, { late: t - r.at > CHECK_MS * 2 });
    }
    arm();
    return due.length;
  }

  // ---- the public surface ----------------------------------------------
  return {
    MAX_MESSAGE,

    async init() {
      await load();
      // Prune what has been fired and is old enough that nobody will ask.
      const keep = items.filter(r => !r.firedAt || now() - r.firedAt < 7 * 24 * 3600 * 1000);
      if (keep.length !== items.length) { items = keep; await persist(); }
      const fired = await fireDue();
      note(`[Reminders] ready: ${items.filter(r => !r.firedAt).length} pending, ${fired} fired on startup`);
      return items;
    },

    async list() {
      await load();
      return items.slice().sort((a, b) => a.at - b.at).map(r => ({ ...r }));
    },

    // A reminder is one of:
    //   at a time      { message, at }              optionally repeat: daily | weekdays | weekly
    //   at a site      { message, site }            fires next time a tab opens that host
    // Either may carry `url` (the page it is about) and `urgent` (fires even
    // during a focus session).
    // `kind` is reminder (default), alarm or timer — the clock panel's items
    // are reminders with a sound and, for alarms, a set of days. `repeat` is
    // daily | weekdays | weekly, or an array of weekdays for an alarm.
    async create({ message, at, url, repeat, site, urgent, kind, sound }) {
      await load();
      const text = String(message || '').trim();
      if (!text) throw new Error('Write what you want to be reminded of.');
      if (text.length > MAX_MESSAGE) throw new Error(`That is longer than ${MAX_MESSAGE} characters.`);
      if (kind != null && !KINDS.includes(kind)) throw new Error('Kind must be reminder, alarm or timer.');

      const host = site ? siteKey(site) : '';
      if (site && !host) throw new Error('Say which site — a host like github.com.');
      let when = null;
      if (!host) {
        when = Number(at);
        if (!Number.isFinite(when)) throw new Error('That is not a real time.');
        if (when - now() < MIN_LEAD_MS) throw new Error('Reminders are set to the minute — choose at least a minute from now.');
        when = Math.floor(when / 60000) * 60000;   // to the minute, matching the OS task
      }
      if (Array.isArray(repeat)) {
        repeat = [...new Set(repeat.map(Number))].filter(d => Number.isInteger(d) && d >= 0 && d <= 6).sort();
        if (!repeat.length) throw new Error('Pick at least one day for the alarm to repeat on.');
      } else if (repeat != null && repeat !== '' && !REPEATS.includes(repeat)) {
        throw new Error('Repeat must be daily, weekdays or weekly.');
      }
      if (repeat && host) throw new Error('A site reminder fires when you open the site; it cannot also repeat on a schedule.');
      let link = '';
      if (url) {
        try { const u = new URL(String(url)); if (!/^https?:$/.test(u.protocol)) throw 0; link = u.href; }
        catch { throw new Error('The page link must be an http or https address.'); }
      }

      const r = {
        id: 'r' + now().toString(36) + Math.random().toString(36).slice(2, 8),
        message: text,
        at: when,
        site: host || null,
        repeat: repeat || null,
        url: link || null,
        urgent: !!urgent,
        kind: kind || 'reminder',
        sound: !!sound,
        ackedAt: null,
        createdAt: now(),
        firedAt: null,
        lastFiredAt: null,
        delivered: null,
        error: null,
        os: { scheduled: false, error: null },
      };
      items.push(r);
      await persist();
      arm();

      // The OS task is what makes a timed reminder survive Vex being closed.
      // If it cannot be created the reminder still exists here — but the
      // caller is told, in words, rather than finding out on the day. A site
      // reminder has no time, so there is nothing for Windows to wake Vex for.
      if (host) {
        r.os = { scheduled: false, error: null, kind: 'site' };
      } else if (osScheduler && osScheduler.supported) {
        await registerOs(r);
      } else {
        r.os = { scheduled: false, error: (osScheduler && !osScheduler.supported)
          ? 'Only Windows can wake Vex for a reminder; this one fires while Vex is running'
          : 'No system scheduler is configured' };
      }
      await persist();
      note(`[Reminders] created ${r.id} ${host ? 'for site ' + host : 'for ' + new Date(r.at).toISOString()}${r.repeat ? ' repeating ' + r.repeat : ''} (os: ${r.os.scheduled ? 'yes' : (r.os.error || r.os.kind || 'no')})`);
      return { ...r };
    },

    async delete(id) {
      await load();
      const i = items.findIndex(r => r.id === id);
      if (i === -1) throw new Error('That reminder no longer exists.');
      const [r] = items.splice(i, 1);
      await persist();
      arm();
      let osError = null;
      if (osScheduler && osScheduler.supported && !r.firedAt && r.at != null) {
        try { await osScheduler.unregister(r.id); }
        catch (err) { osError = err.message; note(`[Reminders] could not remove the Windows task for ${r.id}: ${err.message}`); }
      }
      return { ok: true, osError };
    },

    fireDue,

    // A tab opened `host`. Any pending site reminder for it (or a parent
    // domain of it) fires now. Returns how many did.
    async visited(host) {
      await load();
      const h = siteKey(host);
      if (!h) return 0;
      const hits = items.filter(r => !r.firedAt && r.site && (h === r.site || h.endsWith('.' + r.site)));
      for (const r of hits) await fireOne(r);
      return hits.length;
    },

    // The person dismissed an alarm's ringing (or any fired item). Recorded so
    // a Vex started later does not ring for something already dealt with.
    async ack(id) {
      await load();
      const r = items.find(x => x.id === id);
      if (!r) throw new Error('That reminder no longer exists.');
      r.ackedAt = now();
      await persist();
      return { ok: true };
    },

    // Hold non-urgent reminders until `untilMs` (0 clears). Anything that fell
    // due meanwhile fires as a batch when the hold ends.
    hold(untilMs) {
      holdUntil = Math.max(0, Number(untilMs) || 0);
      arm();
      if (!holdUntil) { inflight = fireDue().catch(err => note(`[Reminders] fireDue after hold failed: ${err.message}`)); }
      return holdUntil;
    },

    // Resolves once any due-check in progress — toast and store write — has
    // finished. Nothing to observe otherwise.
    flush() { return inflight; },

    stop() {
      stopped = true;
      if (timer) { clearT(timer); timer = null; }
      return inflight;
    },
  };
}

module.exports = { createReminders, nextRepeat, firstAlarmAt, siteKey, REPEATS, KINDS, MAX_MESSAGE, CHECK_MS, MIN_LEAD_MS };
