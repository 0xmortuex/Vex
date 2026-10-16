// === Game Control Center -> Vex: the one small file ==========================
//
// T2-068. Game Control Center (GCC) is the owner's other app. It tells Vex what
// it is doing the simplest way two programs of one person can: GCC writes ONE
// small JSON file, Vex reads it. Vex never writes to it, never starts GCC from
// here (that is main/game-control-center.js), and GCC is not modified by this.
//
// THE CONTRACT (also in docs/gcc-bridge.md, for GCC's side to implement):
//
//   Path   <APPDATA>\game-control-center\vex-bridge.json   (Vex reads exactly this path)
//   Write  atomically (write a temp file beside it, rename over it), at most once a second
//   Shape  {
//            "version": 1,
//            "updatedAt": "2026-10-16T18:03:11Z",             ISO time of this write
//            "game":     { "name": "Marvel Rivals", "exe": "Marvel-Win64-Shipping.exe", "running": true } | null,
//            "profile":  "Competitive" | null,                 GCC's active profile, shown by name
//            "streamer": false,                                GCC says the screen is being shared
//            "capture":  false,                                GCC is recording right now
//            "clipsDir": "C:\\Users\\me\\Videos\\GCC" | null,  where GCC puts clips (absolute)
//            "recentClips": [ { "file": "clip1.mp4", "game": "Marvel Rivals", "session": "ranked night", "at": "2026-10-16T18:20:00Z" } ]
//          }                                                    optional, newest last, at most 50; "file" is a name inside clipsDir
//   Stale  a file not updated for STALE_MS counts as "GCC is not running": game.running is
//          then false, whatever it says (a crash must not leave Game mode on forever)
//
// A missing file is normal (GCC not installed or not running): { present: false }.
// A file that is there but wrong is an ERROR with the reason, never "fixed".
const fs = require('fs');
const path = require('path');

const FILE_NAME = 'vex-bridge.json';
const FOLDER = 'game-control-center';
const MAX_BYTES = 64 * 1024;
const STALE_MS = 2 * 60 * 1000;
const VERSION = 1;
const MAX_CLIPS = 50;

function bridgePath(appData) {
  if (typeof appData !== 'string' || !appData) throw new Error('The application data folder is not known');
  return path.join(appData, FOLDER, FILE_NAME);
}

function text(v, name, max, { nullable = true } = {}) {
  if (v == null) { if (nullable) return null; throw new Error('"' + name + '" is required'); }
  if (typeof v !== 'string') throw new Error('"' + name + '" must be text');
  if (v.length > max || /[\u0000-\u001f]/.test(v)) throw new Error('"' + name + '" is not usable text');
  return v;
}

function flag(v, name) {
  if (v == null) return false;
  if (typeof v !== 'boolean') throw new Error('"' + name + '" must be true or false');
  return v;
}

// Parse and check the file's text. now: ms. -> the cleaned state.
function parse(raw, now = Date.now()) {
  if (typeof raw !== 'string' || raw.length > MAX_BYTES) throw new Error('The Game Control Center file is too large');
  let j;
  try { j = JSON.parse(raw); } catch (err) { throw new Error('The Game Control Center file is not valid JSON', { cause: err }); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('The Game Control Center file is not an object');
  if (j.version !== VERSION) throw new Error('The Game Control Center file is version ' + j.version + '; Vex reads version ' + VERSION);
  const at = Date.parse(j.updatedAt);
  if (!Number.isFinite(at)) throw new Error('"updatedAt" is not a date');
  let game = null;
  if (j.game != null) {
    if (typeof j.game !== 'object' || Array.isArray(j.game)) throw new Error('"game" must be an object or null');
    game = {
      name: text(j.game.name, 'game.name', 120, { nullable: false }),
      exe: text(j.game.exe, 'game.exe', 260),
      running: flag(j.game.running, 'game.running'),
    };
  }
  const clipsDir = text(j.clipsDir, 'clipsDir', 1024);
  if (clipsDir && !path.win32.isAbsolute(clipsDir)) throw new Error('"clipsDir" must be a full path');
  const recentClips = [];
  if (j.recentClips != null) {
    if (!Array.isArray(j.recentClips) || j.recentClips.length > MAX_CLIPS) throw new Error('"recentClips" must be a list of at most ' + MAX_CLIPS);
    for (const c of j.recentClips) {
      if (!c || typeof c !== 'object') throw new Error('A "recentClips" entry must be an object');
      const file = text(c.file, 'recentClips.file', 260, { nullable: false });
      if (/[\\/]/.test(file)) throw new Error('"recentClips.file" is a file name, not a path');
      let when = null;
      if (c.at != null) {
        when = Date.parse(c.at);
        if (!Number.isFinite(when)) throw new Error('"recentClips.at" is not a date');
      }
      recentClips.push({ file, game: text(c.game, 'recentClips.game', 120), session: text(c.session, 'recentClips.session', 120), at: when });
    }
  }
  const stale = now - at > STALE_MS;
  if (game && stale) game = { ...game, running: false };
  return {
    version: VERSION,
    updatedAt: at,
    stale,
    game,
    profile: text(j.profile, 'profile', 80),
    streamer: stale ? false : flag(j.streamer, 'streamer'),
    capture: stale ? false : flag(j.capture, 'capture'),
    clipsDir,
    recentClips,
  };
}

// -> { present:false } | { present:true, ...state }. Throws if it is there but wrong.
function read(file, { fsImpl = fs, now = Date.now() } = {}) {
  let raw;
  try {
    const st = fsImpl.statSync(file);
    if (!st.isFile()) throw new Error('The Game Control Center bridge path is not a file');
    if (st.size > MAX_BYTES) throw new Error('The Game Control Center file is too large');
    raw = fsImpl.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { present: false };
    throw err;
  }
  return { present: true, ...parse(raw, now) };
}

module.exports = { bridgePath, parse, read, FILE_NAME, FOLDER, STALE_MS, VERSION, MAX_BYTES };
