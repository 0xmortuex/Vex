// === When all downloads finish: sleep or shut down the PC ====================
//
// Start a big download, go to bed, and have the computer put itself to sleep or
// switch off once it is done. This is a system-level effect, so it is guarded
// in every way that matters:
//
//   * it is OFF, and has to be ARMED on purpose each time ("do nothing" is the
//     default). It disarms itself after it fires, after 12 hours, when you
//     cancel it, when a download in the batch fails, and when Vex quits. It is
//     never saved, so a restart always begins disarmed;
//   * when the last active download finishes there is a 60 second countdown with
//     a Cancel. It does NOT fire when any download of the batch failed or was
//     interrupted (you are told why), when you cancel, or when a new download
//     starts during the countdown (the wait starts over);
//   * the command is run by an injected runner, with an argument list (no shell
//     string). Tests never run a real shutdown or sleep.
//
// The state machine knows nothing about Electron: downloads.js reports
// { type: 'start' | 'end', id, state } and everything else (timers, the runner,
// telling the person) is passed in.
'use strict';

const ACTIONS = Object.freeze(['sleep', 'shutdown']);
const COUNTDOWN_MS = 60 * 1000;
const ARM_TTL_MS = 12 * 60 * 60 * 1000;

// Windows commands as argument lists. `rundll32 powrprof.dll,SetSuspendState 0,1,0` sleeps (it hibernates instead on a PC where hibernation is
// switched on: that is a Windows quirk of this call). `shutdown /s /t 0` closes programs politely: one with unsaved work can still stop it.
function commandFor(action, platform = process.platform) {
  if (!ACTIONS.includes(action)) throw new Error('Unknown action after downloads: ' + String(action));
  if (platform !== 'win32') throw new Error('Sleeping or shutting down after downloads is only available on Windows');
  if (action === 'sleep') return { file: 'rundll32.exe', args: ['powrprof.dll,SetSuspendState', '0,1,0'] };
  return { file: 'shutdown', args: ['/s', '/t', '0'] };
}

// The real runner. `spawn` is passed in so a test hands it a fake; nothing here runs a shell.
function createCommandRunner({ spawn, platform = process.platform, onError = () => {} }) {
  if (typeof spawn !== 'function') throw new TypeError('createCommandRunner needs spawn');
  return function run(action) {
    const { file, args } = commandFor(action, platform);
    const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true, shell: false });
    child.on('error', (err) => onError(err, action));
    if (typeof child.unref === 'function') child.unref();
  };
}

function reasonText(failed) {
  const names = failed.slice(0, 3).join(', ');
  return 'A download did not finish' + (names ? ' (' + names + ')' : '') + ', so Vex did not touch your computer.';
}

// run(action): starts the command. notify(event): tells the person (event.kind below). setTimer/clearTimer/now: injected.
function createAfterDownloads({ run, notify = () => {}, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, countdownMs = COUNTDOWN_MS, ttlMs = ARM_TTL_MS, platform = process.platform }) {
  if (typeof run !== 'function') throw new TypeError('createAfterDownloads needs a runner');
  let action = null;           // 'sleep' | 'shutdown' while armed
  let phase = 'off';           // 'off' | 'waiting' | 'countdown'
  let active = new Set();      // ids of downloads running now
  let finished = 0;            // completed in this armed batch
  let failed = [];             // names/ids that failed or were interrupted in this batch
  let ttlTimer = null;
  let countTimer = null;
  let fireAt = 0;
  let expiresAt = 0;
  const names = new Map();     // id -> display name, when the caller gave one

  const say = (event) => { try { notify({ ...event, action }); } catch (err) { console.error('[AfterDownloads] could not tell the person:', err.message); } };
  const stopCount = () => { if (countTimer) { clearTimer(countTimer); countTimer = null; } fireAt = 0; };
  function disarm(why, { silent = false } = {}) {
    const was = action;
    stopCount();
    if (ttlTimer) { clearTimer(ttlTimer); ttlTimer = null; }
    if (was && !silent) notify({ kind: 'disarmed', why, action: was });
    action = null; phase = 'off'; finished = 0; failed = []; expiresAt = 0;
  }

  function arm(next) {
    if (!ACTIONS.includes(next)) throw new Error('Choose sleep or shut down');
    commandFor(next, platform); // refuses a platform that cannot do it, now rather than 12 hours from now
    disarm('re-armed', { silent: true });
    action = next; phase = 'waiting'; finished = 0; failed = [];
    expiresAt = now() + ttlMs;
    ttlTimer = setTimer(() => { ttlTimer = null; if (action) disarm('expired'); }, ttlMs);
    if (ttlTimer && typeof ttlTimer.unref === 'function') ttlTimer.unref();
    say({ kind: 'armed', active: active.size });
    return state();
  }

  function startCountdown() {
    phase = 'countdown';
    fireAt = now() + countdownMs;
    countTimer = setTimer(fire, countdownMs);
    if (countTimer && typeof countTimer.unref === 'function') countTimer.unref();
    say({ kind: 'countdown', seconds: Math.round(countdownMs / 1000), fireAt });
  }
  function fire() {
    countTimer = null;
    const what = action;
    if (!what || phase !== 'countdown') return;
    // Disarmed before the command runs: even if it throws, it cannot run twice.
    disarm('fired', { silent: true });
    try { run(what); say({ kind: 'fired', action: what }); }
    catch (err) { notify({ kind: 'error', action: what, message: err.message }); }
  }

  // A download began (or was already running when something asked us to know).
  function noteStart(id, name) {
    active.add(id);
    if (name) names.set(id, name);
    if (phase === 'countdown') {
      stopCount();
      phase = 'waiting';
      say({ kind: 'restarted', active: active.size });
    }
  }
  // A download is over. state: 'completed' | 'interrupted' | 'cancelled'. byPerson: the person pressed Cancel on it.
  function noteEnd(id, state, byPerson = false, name) {
    active.delete(id);
    const label = name || names.get(id) || '';
    names.delete(id);
    if (!action) return;
    if (state === 'completed') finished++;
    else if (!(state === 'cancelled' && byPerson)) failed.push(label || String(id));
    if (active.size > 0) return;
    // The batch is over.
    if (failed.length) {
      const why = reasonText(failed);
      const was = action;
      const count = failed.length;
      disarm('failed', { silent: true });
      notify({ kind: 'blocked', why, action: was, failed: count });
      return;
    }
    if (finished > 0) startCountdown();
    // Nothing completed (the person cancelled them all): stay armed and keep waiting.
  }

  function cancel() {
    if (phase !== 'countdown') { if (action) disarm('cancelled'); return state(); }
    disarm('cancelled');
    return state();
  }

  // Vex is quitting: nothing may fire afterwards.
  function dispose() { disarm('quit', { silent: true }); }

  function state() {
    return { armed: !!action, action, phase, active: active.size, finished, failed: failed.length, fireAt, expiresAt, countdownMs };
  }

  return { arm, disarm: () => { disarm('disarmed'); return state(); }, cancel, noteStart, noteEnd, dispose, state };
}

module.exports = { createAfterDownloads, createCommandRunner, commandFor, ACTIONS, COUNTDOWN_MS, ARM_TTL_MS };
