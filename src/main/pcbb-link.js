// === Telling Game Control Center which tab was busy =========================
//
// Game Control Center (GCC) keeps a local "PC Black Box": newline-delimited
// JSON files in %LOCALAPPDATA%\PCBlackBox. With the person's say-so, Vex adds
// one kind of line to it, `perf.tabcost`: which SITE's tab was using the
// processor over the last few minutes. GCC reads it to say "a browser tab on
// example.com was using about 30% of a core" next to a lag spike.
//
// This module is the only writer. The library (./pcbb/pcbb.cjs) is GCC's own
// file, exported by its scripts/export-pcbb.mjs and kept unchanged, so both
// apps agree on the format and on the masking.
//
// What it will NOT do:
//   - create the folder. GCC creates it; if it is not there, nothing is written.
//     (The library's writer would mkdir it, so the check runs in `enabled`,
//     immediately before every write.)
//   - write unless the person turned it on. The switch lives in the renderer
//     (Settings); the renderer tells main on every start, and a restart of
//     Vex without that call leaves this OFF.
//   - write more than one line a minute, whatever the renderer asks.
//   - read GCC's own Black Box on/off switch: that file belongs to GCC.
//     Deleting the PCBlackBox folder (or switching Vex's setting off) stops it.
//   - throw into the app on a failed append: the library reports it, and this
//     module returns the reason so the caller can say it.
const fs = require('fs');

const MIN_GAP_MS = 55 * 1000;   // the renderer asks every 60 s; a little slack for jitter

function createPcbbLink({ pcbb, env = process.env, now = () => Date.now(), log = () => {}, statDir } = {}) {
  if (!pcbb || typeof pcbb.createWriter !== 'function' || typeof pcbb.resolveDir !== 'function') throw new TypeError('createPcbbLink: the pcbb library is required');
  const stat = statDir || ((d) => { try { return fs.statSync(d).isDirectory(); } catch (err) { if (err && err.code === 'ENOENT') return false; throw err; } });
  let enabled = false;
  let lastWriteAt = 0;
  let writer = null;
  let writerDir = null;

  // Resolved each time: PCBB_DIR may be set by a probe, and an unresolvable
  // folder (no %LOCALAPPDATA%) is an explicit refusal, never a guessed path.
  function dir() { return pcbb.resolveDir(env); }

  function ensureWriter(d) {
    if (writer && writerDir === d) return writer;
    writerDir = d;
    writer = pcbb.createWriter({
      dir: d,
      src: 'vex',
      // Checked by the library on every emit, right before it would create the folder.
      enabled: () => enabled && stat(d),
      onProblem: (m) => log('[pcbb] ' + m),
    });
    return writer;
  }

  return {
    MIN_GAP_MS,
    setEnabled(on) {
      if (typeof on !== 'boolean') throw new TypeError('setEnabled needs true or false');
      enabled = on;
      return this.state();
    },
    // What Settings shows: is it on, and is there a folder to write to.
    state() {
      let d = null, folder = false, problem = '';
      try { d = dir(); folder = stat(d); } catch (err) { problem = err.message; }
      return { enabled, folderFound: folder, folder: d, problem };
    },
    // One perf.tabcost line. Returns { written: true, id } or { written: false, reason }.
    // `reason` is one of 'off' | 'no-folder' | 'too-soon'; an invalid payload throws.
    write(data) {
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TypeError('perf.tabcost needs an object');
      if (!enabled) return { written: false, reason: 'off' };
      const d = dir();
      if (!stat(d)) return { written: false, reason: 'no-folder' };
      const t = now();
      if (lastWriteAt && t - lastWriteAt < MIN_GAP_MS) return { written: false, reason: 'too-soon' };
      const r = ensureWriter(d).emit({ kind: 'perf.tabcost', data, t: new Date(t) });
      if (!r.ok) {
        if (r.reason === 'off') return { written: false, reason: 'no-folder' };   // the folder vanished between the check and the write
        throw new Error('The Black Box line was not written: ' + r.reason);
      }
      lastWriteAt = t;
      return { written: true, id: r.id };
    },
  };
}

// pcbb:link-set [boolean] -> state     pcbb:link-state [] -> state
// pcbb:tabcost  [object]  -> { written, id? | reason? }
// The 466 KB library is loaded the first time one of these is used, not at start.
function registerPcbbLink({ ipcMain, env = process.env, log = () => {}, load = () => require('./pcbb/pcbb.cjs') }) {
  let link = null;
  const get = () => link || (link = createPcbbLink({ pcbb: load(), env, log }));
  ipcMain.handle('pcbb:link-set', (_e, on) => get().setEnabled(on));
  ipcMain.handle('pcbb:link-state', () => get().state());
  ipcMain.handle('pcbb:tabcost', (_e, data) => get().write(data));
}

module.exports = { createPcbbLink, registerPcbbLink, MIN_GAP_MS };
