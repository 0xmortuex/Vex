// === Game mode: the main-process half ========================================
//
// While a game runs, Vex gets out of its way. The renderer decides WHEN (the
// user's choice, js/game-session.js); this file holds the two things only main
// can do:
//
//   Notice a game by its process name. The full-screen watch (game-watch.js)
//   sees a game that has the screen; this sees one the user NAMED in Settings,
//   whether it is full screen or not. It reads the list of running program
//   names — what Task Manager shows — and nothing else: it never opens, reads,
//   attaches to or touches the game's process.
//
//   Lower Vex's own appetite. Vex's page processes (and its graphics process)
//   are set to "below normal" priority for the length of the game and put back
//   exactly as they were when it ends. Only Vex's own processes: that is the
//   OS call every program may make on itself. A page that is playing sound is
//   left at its normal priority, so music never stutters.
//
// Everything here lives in memory. Nothing is written to disk, so a crash or a
// forced close leaves nothing to undo — a new Vex process starts at Windows'
// default priority, and a fresh session starts with no holds.

const MISSES_TO_END = 2;         // polls without the game before it counts as over
const LOWERED_TYPES = new Set(['Tab', 'GPU']);

// "C:\Games\Foo\FooClient.EXE", "fooclient.exe" and "FooClient" are one name.
function normalizeExe(value) {
  return String(value || '').trim().toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, '');
}

// `tasklist /FO CSV /NH` lines look like: "Code.exe","1234","Console","1","50,000 K"
function parseTasklist(csv) {
  const names = new Set();
  for (const line of String(csv || '').split(/\r?\n/)) {
    const m = /^"([^"]+)"/.exec(line);
    if (m) names.add(normalizeExe(m[1]));
  }
  return names;
}

function cleanGames(list) {
  if (!Array.isArray(list)) throw new Error('The game list must be a list');
  const out = [];
  for (const g of list) {
    if (!g || typeof g !== 'object') throw new Error('Each game needs a name and a program name');
    const exe = normalizeExe(g.exe);
    if (!exe) throw new Error('A game in the list has no program name');
    out.push({ id: String(g.id || exe), name: String(g.name || exe), exe });
  }
  return out;
}

// → { setGames, start, stop, poll, state }
//   list()      → Promise<Set<string>> of normalized running program names
//   onChange    → called with { game, app, id } when a listed game starts or ends
function createProcessWatch({ list, onChange, intervalMs = 10000, setTimer = setTimeout, clearTimer = clearTimeout, log = () => {} }) {
  if (typeof list !== 'function') throw new TypeError('createProcessWatch: list is required');
  let games = [];
  let timer = null;
  let running = false;          // between start() and stop()
  let polling = null;
  let misses = 0;
  let current = { game: false, app: '', id: '' };

  function publish(next) {
    const changed = next.game !== current.game || next.id !== current.id;
    current = next;
    if (changed && typeof onChange === 'function') {
      try { onChange({ ...current }); } catch (err) { log('[GameMode] listener failed: ' + err.message); }
    }
  }

  async function pollOnce() {
    if (!games.length) { misses = 0; publish({ game: false, app: '', id: '' }); return current; }
    let names;
    try { names = await list(); }
    catch (err) { log('[GameMode] could not read the running programs: ' + err.message); return current; }   // state unknown: keep what it was
    const hit = games.find(g => names.has(g.exe));
    if (hit) { misses = 0; publish({ game: true, app: hit.name, id: hit.id }); }
    else if (current.game && ++misses >= MISSES_TO_END) { misses = 0; publish({ game: false, app: '', id: '' }); }
    return current;
  }

  function poll() {
    if (polling) return polling;
    polling = pollOnce().finally(() => { polling = null; });
    return polling;
  }

  function arm() {
    if (timer) clearTimer(timer);
    timer = null;
    if (!running || !games.length) return;
    timer = setTimer(async () => { timer = null; await poll(); arm(); }, intervalMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  return {
    // Replacing the list re-checks at once: a game added while it is running
    // is noticed now, not ten seconds from now.
    setGames(next) {
      games = cleanGames(next);
      if (running) poll().then(arm).catch((err) => log('[GameMode] ' + err.message));
      return games.length;
    },
    start() { if (running) return poll(); running = true; return poll().then(() => { arm(); return current; }); },
    stop() {
      running = false;
      if (timer) clearTimer(timer);
      timer = null;
      misses = 0;
      publish({ game: false, app: '', id: '' });
    },
    poll,
    state: () => ({ ...current }),
    games: () => games.map(g => ({ ...g })),
  };
}

// → { begin, end, rescan, active, held, state }
//   os           { setPriority(pid, level), getPriority(pid), constants.priority }
//   processes()  → [{ pid, type }]   (app.getAppMetrics())
//   audiblePids()→ Set<number>       pages playing sound right now
function createGameModeSession({ os, processes, audiblePids = () => new Set(), ownPid = process.pid, rescanMs = 20000, setTimer = setTimeout, clearTimer = clearTimeout, log = () => {} }) {
  for (const k of ['setPriority', 'getPriority']) if (typeof os[k] !== 'function') throw new TypeError('createGameModeSession: os.' + k + ' is required');
  if (typeof processes !== 'function') throw new TypeError('createGameModeSession: processes is required');
  const LOW = os.constants.priority.PRIORITY_BELOW_NORMAL;
  let active = false;
  let app = '';
  let holds = new Set();
  let timer = null;
  const lowered = new Map();        // pid → the priority it had before
  let failed = 0;

  function lower() {
    const skip = audiblePids();
    for (const p of processes()) {
      if (!p || !LOWERED_TYPES.has(p.type) || p.pid === ownPid || lowered.has(p.pid) || skip.has(p.pid)) continue;
      try {
        const before = os.getPriority(p.pid);
        os.setPriority(p.pid, LOW);
        lowered.set(p.pid, before);
      } catch (err) {
        failed++;
        log('[GameMode] could not lower the priority of ' + p.type + ' process ' + p.pid + ': ' + err.message);
      }
    }
  }

  function arm() {
    if (timer) clearTimer(timer);
    timer = null;
    if (!active) return;
    // Pages open during the game are lowered too; ones that started making
    // sound are put back so they never stutter.
    timer = setTimer(() => { timer = null; rescan(); arm(); }, rescanMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function raiseAudible() {
    const sound = audiblePids();
    for (const pid of [...lowered.keys()]) {
      if (!sound.has(pid)) continue;
      try { os.setPriority(pid, lowered.get(pid)); } catch (err) { if (!/ESRCH|no such process/i.test(err.message)) log('[GameMode] could not restore process ' + pid + ': ' + err.message); }
      lowered.delete(pid);
    }
  }

  function rescan() {
    if (!active) return state();
    raiseAudible();
    lower();
    return state();
  }

  function begin({ app: name = '', holds: kinds = [] } = {}) {
    app = String(name || '');
    holds = new Set(kinds);
    if (active) { rescan(); return state(); }
    active = true;
    failed = 0;
    lower();
    arm();
    return state();
  }

  function end() {
    if (timer) clearTimer(timer);
    timer = null;
    const wasActive = active;
    active = false;
    app = '';
    holds = new Set();
    for (const [pid, before] of lowered) {
      try { os.setPriority(pid, before); }
      catch (err) { if (!/ESRCH|no such process/i.test(err.message)) log('[GameMode] could not restore process ' + pid + ': ' + err.message); }
    }
    lowered.clear();
    return { ...state(), wasActive };
  }

  function state() { return { active, app, lowered: lowered.size, failed, holds: [...holds] }; }

  return { begin, end, rescan, active: () => active, held: (kind) => active && holds.has(kind), state };
}

module.exports = { createProcessWatch, createGameModeSession, normalizeExe, parseTasklist, cleanGames, MISSES_TO_END, LOWERED_TYPES };
