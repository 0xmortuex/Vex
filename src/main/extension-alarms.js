// === chrome.alarms for extensions, kept by main ===
// Electron 42 has a chrome.alarms that takes alarms and moves them on when
// they are due, but never tells the extension: onAlarm did not fire, in a
// service worker or a page (found 2026-10-10, EX5). Extensions that sync,
// refresh a filter list or remind on a timer did nothing. Main keeps the
// alarms here instead, one set per extension per session (a container's copy
// is a separate extension), saves them so they outlive a restart as Chrome's
// do, and fires them through the stand-ins (main.js _extDispatch,
// 'alarms.onAlarm'), which wakes a sleeping service worker.
//
// Chrome's rules: an alarm is named ('' by default) and a new one replaces
// one of the same name; `when` (ms since 1970) or `delayInMinutes` sets the
// first time, `periodInMinutes` repeats it (and is the first delay when
// neither is given); nothing sooner than 30 seconds. An alarm missed while
// Vex was closed fires once soon after it starts.

const MIN_MINUTES = 0.5;
const MISSED_DELAY_MS = 15000;      // after start, so the extension is loaded
const RETRY_MS = 60000;             // the extension's session is not made yet
const MAX_PER_EXTENSION = 500;
const MAX_TIMER_MS = 2 ** 31 - 1;   // setTimeout's own limit

function createExtensionAlarms({ now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, load, save, fire }) {
  // key ('<partition>|<extension id>') -> Map(name -> alarm)
  const byKey = new Map();
  const timers = new Map();   // key + '\n' + name -> timer

  const copy = (a) => {
    const out = { name: a.name, scheduledTime: a.scheduledTime };
    if (a.periodInMinutes) out.periodInMinutes = a.periodInMinutes;
    return out;
  };
  const persist = () => {
    const data = {};
    for (const [key, alarms] of byKey) if (alarms.size) data[key] = [...alarms.values()].map(copy);
    save(data);
  };
  const timerKey = (key, name) => key + '\n' + name;

  function arm(key, alarm) {
    const tk = timerKey(key, alarm.name);
    if (timers.has(tk)) clearTimer(timers.get(tk));
    const wait = Math.min(Math.max(0, alarm.scheduledTime - now()), MAX_TIMER_MS);
    const t = setTimer(() => { timers.delete(tk); due(key, alarm.name); }, wait);
    if (t && typeof t.unref === 'function') t.unref();
    timers.set(tk, t);
  }

  async function due(key, name) {
    const alarms = byKey.get(key);
    const alarm = alarms && alarms.get(name);
    if (!alarm) return;
    if (alarm.scheduledTime > now()) { arm(key, alarm); return; }   // a long wait, in pieces
    let outcome;
    try { outcome = await fire(key, copy(alarm)); }
    catch (err) { outcome = 'failed'; console.error(`[Extensions] alarm "${name}" for ${key} did not reach it:`, err.message); }
    if (alarms.get(name) !== alarm) return;   // replaced or cleared meanwhile
    if (outcome === 'later') {                // its session is not made yet
      alarm.scheduledTime = now() + RETRY_MS;
      arm(key, alarm);
    } else if (outcome === 'gone' || !alarm.periodInMinutes) {
      alarms.delete(name);
      if (!alarms.size) byKey.delete(key);
    } else {
      const period = alarm.periodInMinutes * 60000;
      alarm.scheduledTime += period * Math.max(1, Math.ceil((now() - alarm.scheduledTime) / period));
      arm(key, alarm);
    }
    persist();
  }

  function minutes(v, what) {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`${what} must be a number of minutes`);
    return Math.max(MIN_MINUTES, v);
  }

  function create(key, name, info) {
    name = name == null ? '' : String(name);
    const i = info && typeof info === 'object' ? info : {};
    const period = minutes(i.periodInMinutes, 'periodInMinutes');
    const delay = minutes(i.delayInMinutes, 'delayInMinutes');
    if (i.when !== undefined && (typeof i.when !== 'number' || !Number.isFinite(i.when))) throw new Error('when must be a time in milliseconds');
    if (i.when !== undefined && delay !== undefined) throw new Error('Cannot set both when and delayInMinutes');
    let scheduledTime;
    if (i.when !== undefined) scheduledTime = Math.max(i.when, now() + MIN_MINUTES * 60000);
    else if (delay !== undefined) scheduledTime = now() + delay * 60000;
    else if (period !== undefined) scheduledTime = now() + period * 60000;
    else throw new Error('An alarm needs when, delayInMinutes or periodInMinutes');
    let alarms = byKey.get(key);
    if (!alarms) { alarms = new Map(); byKey.set(key, alarms); }
    if (!alarms.has(name) && alarms.size >= MAX_PER_EXTENSION) throw new Error(`An extension can have at most ${MAX_PER_EXTENSION} alarms`);
    const alarm = { name, scheduledTime };
    if (period !== undefined) alarm.periodInMinutes = period;
    alarms.set(name, alarm);
    arm(key, alarm);
    persist();
  }

  function get(key, name) {
    const a = byKey.get(key) && byKey.get(key).get(name == null ? '' : String(name));
    return a ? copy(a) : undefined;
  }
  function getAll(key) { return byKey.has(key) ? [...byKey.get(key).values()].map(copy) : []; }
  function clear(key, name) {
    name = name == null ? '' : String(name);
    const alarms = byKey.get(key);
    if (!alarms || !alarms.has(name)) return false;
    alarms.delete(name);
    const tk = timerKey(key, name);
    if (timers.has(tk)) { clearTimer(timers.get(tk)); timers.delete(tk); }
    if (!alarms.size) byKey.delete(key);
    persist();
    return true;
  }
  function clearAll(key) {
    const alarms = byKey.get(key);
    if (!alarms || !alarms.size) return false;
    for (const name of [...alarms.keys()]) clear(key, name);
    return true;
  }

  // The saved alarms; one missed while Vex was closed fires soon after start.
  function restore() {
    const data = load() || {};
    if (typeof data !== 'object' || Array.isArray(data)) throw new Error('the saved alarms are not a list by extension');
    const soonest = now() + MISSED_DELAY_MS;
    for (const [key, list] of Object.entries(data)) {
      if (!Array.isArray(list)) continue;
      const alarms = new Map();
      for (const a of list) {
        if (!a || typeof a.name !== 'string' || typeof a.scheduledTime !== 'number') continue;
        const alarm = { name: a.name, scheduledTime: Math.max(a.scheduledTime, soonest) };
        if (typeof a.periodInMinutes === 'number' && a.periodInMinutes > 0) alarm.periodInMinutes = Math.max(MIN_MINUTES, a.periodInMinutes);
        alarms.set(alarm.name, alarm);
      }
      if (!alarms.size) continue;
      byKey.set(key, alarms);
      for (const alarm of alarms.values()) arm(key, alarm);
    }
  }

  return { create, get, getAll, clear, clearAll, restore };
}

module.exports = { createExtensionAlarms, MIN_MINUTES };
