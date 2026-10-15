// === Quiet hours for notifications =========================================
//
// Every desktop toast Vex sends passes through notify.js's `show`. This sits in
// front of it: between the start and end of the quiet window, toasts are held
// instead of shown, and released together — one digest toast when the window
// ends, and optionally at set times inside it.
//
// What always gets through, by design:
//   * reminders and alarms (kind 'reminder'): you set them to be told;
//   * a toast marked `urgent`;
//   * a toast from a VIP site (matched on the site's host, subdomains
//     included, or on the exact source name an extension gave).
//
// A held toast is kept in the profile (small JsonStore key) so a restart
// inside the window does not lose it. Nothing here leaves the machine.
// Everything is injected so the module is testable without Electron.
'use strict';

const CONFIG_KEY = 'quiet-hours';
const HELD_KEY = 'quiet-hours-held';
const MAX_HELD = 200;
const MAX_VIP = 50;
const MAX_TIMES = 6;
const DEFAULTS = { enabled: false, start: '22:00', end: '07:00', digestTimes: [], vip: [] };

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMin = (s) => { const m = HHMM.exec(s); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

function normalizeVip(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase().replace(/^\*\./, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9][a-z0-9 ._-]{0,99}$/.test(s)) throw new Error('"' + clip(v, 40) + '" is not a site name');
  return s;
}

function validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('Quiet hours settings must be an object');
  const out = { ...DEFAULTS };
  if ('enabled' in cfg) { if (typeof cfg.enabled !== 'boolean') throw new Error('Quiet hours must be on or off'); out.enabled = cfg.enabled; }
  for (const k of ['start', 'end']) {
    if (k in cfg) { if (typeof cfg[k] !== 'string' || toMin(cfg[k]) === null) throw new Error('Quiet hours ' + k + ' must be a time like 22:00'); out[k] = cfg[k]; }
  }
  if ('digestTimes' in cfg) {
    if (!Array.isArray(cfg.digestTimes) || cfg.digestTimes.length > MAX_TIMES) throw new Error('At most ' + MAX_TIMES + ' release times');
    out.digestTimes = [...new Set(cfg.digestTimes.map(t => { if (typeof t !== 'string' || toMin(t) === null) throw new Error('Release times look like 12:30'); return t; }))].sort();
  }
  if ('vip' in cfg) {
    if (!Array.isArray(cfg.vip) || cfg.vip.length > MAX_VIP) throw new Error('At most ' + MAX_VIP + ' VIP sites');
    out.vip = [...new Set(cfg.vip.map(normalizeVip))];
  }
  return out;
}

function createQuietHours({ store, show, now = () => Date.now(), log, setIntervalFn = setInterval, clearIntervalFn = clearInterval, tickMs = 30000 }) {
  if (typeof show !== 'function') throw new Error('createQuietHours needs the notifier\'s show function');
  const note = typeof log === 'function' ? log : () => {};
  let config = null;
  let held = null;
  let lastRelease = 0;
  let timer = null;
  let ready = null;

  function init() {
    if (!ready) {
      ready = Promise.all([store.read(CONFIG_KEY), store.read(HELD_KEY)]).then(([c, h]) => {
        config = c ? { ...DEFAULTS, ...validateConfig({ ...DEFAULTS, ...c }) } : { ...DEFAULTS };
        held = Array.isArray(h) ? h.filter(x => x && typeof x.title === 'string') : [];
        lastRelease = now();
      });
    }
    return ready;
  }

  const minutesNow = () => { const d = new Date(now()); return d.getHours() * 60 + d.getMinutes(); };
  function inWindow(cfg = config, minute = minutesNow()) {
    const a = toMin(cfg.start), b = toMin(cfg.end);
    if (a === null || b === null || a === b) return false;
    return a < b ? (minute >= a && minute < b) : (minute >= a || minute < b);
  }

  function isVip(site) {
    if (!site) return false;
    const s = String(site).trim().toLowerCase();
    return config.vip.some(v => s === v || s.endsWith('.' + v));
  }

  // Why a toast is let through (or held), for the interface and for tests.
  function verdict(opts = {}) {
    if (!config.enabled) return { pass: true, why: 'off' };
    if (opts.kind === 'reminder') return { pass: true, why: 'reminder' };
    if (opts.urgent === true) return { pass: true, why: 'urgent' };
    if (isVip(opts.site)) return { pass: true, why: 'vip' };
    if (!inWindow()) return { pass: true, why: 'outside' };
    return { pass: false, why: 'quiet' };
  }

  function saveHeld() { return store.write(HELD_KEY, held); }

  // The function that replaces notifier.show.
  async function gated(opts = {}) {
    await init();
    const v = verdict(opts);
    if (v.pass) return show(opts);
    if (!String(opts.title || '').trim()) throw new Error('A notification needs a title');
    held.push({
      title: clip(opts.title, 200), body: clip(opts.body, 1000), tag: opts.tag ? clip(opts.tag, 64) : undefined,
      kind: opts.kind, silent: !!opts.silent, actions: !!opts.actions, site: opts.site ? clip(opts.site, 100) : undefined, at: now(),
    });
    while (held.length > MAX_HELD) held.shift();
    await saveHeld();
    note('[QuietHours] held: ' + clip(opts.title, 60));
    return { ok: true, held: true, tag: opts.tag || null };
  }

  // One toast for everything held (or the toast itself when there is one).
  async function release() {
    await init();
    if (!held.length) return { released: 0 };
    const batch = held.splice(0, held.length);
    lastRelease = now();
    await saveHeld();
    try {
      if (batch.length === 1) {
        const { title, body, tag, kind, silent, actions } = batch[0];
        await show({ title, body, tag, kind, silent, actions });
      } else {
        const lines = batch.slice(0, 5).map(b => b.title);
        const more = batch.length > 5 ? '\nand ' + (batch.length - 5) + ' more' : '';
        await show({ title: batch.length + ' notifications held while you were away', body: lines.join('\n') + more });
      }
    } catch (err) {
      // The toast was refused: they are not lost, the interface can list them.
      held.unshift(...batch);
      await saveHeld();
      throw err;
    }
    return { released: batch.length };
  }

  // The release rule, run on a timer: the window just ended, or a release
  // time inside the window has passed since the last release.
  async function tick() {
    await init();
    if (!config.enabled || !held.length) return { released: 0 };
    if (!inWindow()) return release();
    const m = minutesNow();
    const d = new Date(now());
    const todayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    for (const t of config.digestTimes) {
      const at = todayStart + toMin(t) * 60000;
      if (at <= now() && at > lastRelease && m >= toMin(t)) return release();
    }
    return { released: 0 };
  }

  function start() {
    if (timer) return;
    timer = setIntervalFn(() => { tick().catch(err => note('[QuietHours] release failed: ' + err.message)); }, tickMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }
  function stop() { if (timer) { clearIntervalFn(timer); timer = null; } }

  async function getConfig() { await init(); return { ...config, inWindow: config.enabled && inWindow(), held: held.length }; }
  async function setConfig(cfg) {
    await init();
    const next = validateConfig({ ...config, ...cfg });
    config = next;
    await store.write(CONFIG_KEY, next);
    // Turning it off puts out what was held rather than keeping it hostage.
    if (!next.enabled && held.length) await release();
    return getConfig();
  }
  async function heldList() { await init(); return held.map(h => ({ title: h.title, body: h.body, at: h.at, site: h.site || null })); }
  async function dropHeld() { await init(); const n = held.length; held = []; await saveHeld(); return { dropped: n }; }

  return { gated, release, tick, start, stop, getConfig, setConfig, heldList, dropHeld, verdict, inWindow, init };
}

module.exports = { createQuietHours, validateConfig, normalizeVip, DEFAULTS };
