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

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

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
    const pending = (items || []).filter(r => !r.firedAt);
    if (!pending.length) return;
    const next = Math.min(...pending.map(r => r.at));
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

  async function fireOne(r, { late = false } = {}) {
    // Mark first, write first. A crash after this point loses at most one
    // toast; a crash before it could show the same toast on every restart.
    r.firedAt = now();
    await persist();

    const body = late ? `Due ${hhmm(r.at)} — ${r.message}` : r.message;
    try {
      await notifier.show({ title: 'Reminder', body, tag: r.id });
      r.delivered = 'toast';
      note(`[Reminders] fired ${r.id}${late ? ' (late)' : ''}`);
    } catch (err) {
      r.delivered = 'failed';
      r.error = err.message;
      note(`[Reminders] toast for ${r.id} failed: ${err.message}`);
    }
    await persist();
    emit({ id: r.id, message: r.message, at: r.at, late, delivered: r.delivered, error: r.error || null });

    if (osScheduler && osScheduler.supported) {
      try { await osScheduler.unregister(r.id); }
      catch (err) { note(`[Reminders] could not remove the Windows task for ${r.id}: ${err.message}`); }
    }
  }

  async function fireDue() {
    await load();
    const t = now();
    // Oldest first, so a backlog reads in order.
    const due = items.filter(r => !r.firedAt && r.at <= t).sort((a, b) => a.at - b.at);
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

    async create({ message, at }) {
      await load();
      const text = String(message || '').trim();
      if (!text) throw new Error('Write what you want to be reminded of.');
      if (text.length > MAX_MESSAGE) throw new Error(`That is longer than ${MAX_MESSAGE} characters.`);
      const when = Number(at);
      if (!Number.isFinite(when)) throw new Error('That is not a real time.');
      if (when - now() < MIN_LEAD_MS) throw new Error('Reminders are set to the minute — choose at least a minute from now.');

      const r = {
        id: 'r' + now().toString(36) + Math.random().toString(36).slice(2, 8),
        message: text,
        at: Math.floor(when / 60000) * 60000,   // to the minute, matching the OS task
        createdAt: now(),
        firedAt: null,
        delivered: null,
        error: null,
        os: { scheduled: false, error: null },
      };
      items.push(r);
      await persist();
      arm();

      // The OS task is what makes the reminder survive Vex being closed. If it
      // cannot be created the reminder still exists here — but the caller is
      // told, in words, rather than finding out on the day.
      if (osScheduler && osScheduler.supported) {
        try {
          await osScheduler.register(r.id, new Date(r.at));
          r.os = { scheduled: true, error: null };
        } catch (err) {
          r.os = { scheduled: false, error: err.message };
        }
      } else {
        r.os = { scheduled: false, error: (osScheduler && !osScheduler.supported)
          ? 'Only Windows can wake Vex for a reminder; this one fires while Vex is running'
          : 'No system scheduler is configured' };
      }
      await persist();
      note(`[Reminders] created ${r.id} for ${new Date(r.at).toISOString()} (os: ${r.os.scheduled ? 'yes' : r.os.error})`);
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
      if (osScheduler && osScheduler.supported && !r.firedAt) {
        try { await osScheduler.unregister(r.id); }
        catch (err) { osError = err.message; note(`[Reminders] could not remove the Windows task for ${r.id}: ${err.message}`); }
      }
      return { ok: true, osError };
    },

    fireDue,

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

module.exports = { createReminders, MAX_MESSAGE, CHECK_MS, MIN_LEAD_MS };
