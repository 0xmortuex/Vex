// === The clips folder ======================================================
//
// OBS, ShadowPlay and Discord all drop recordings into a folder and forget
// about them. Finding the clip from last night means opening Explorer, sorting
// by date, and squinting at "Replay 2026-09-19 23-41-02.mp4".
//
// This reads that folder — newest first, with the size and when it was made —
// so the clip can be found, watched and shared from Vex. It only ever reads:
// nothing is moved, renamed or uploaded anywhere.
const fs = require('fs');
const path = require('path');

const VIDEO = /\.(mp4|mkv|webm|mov|avi|m4v)$/i;
const MAX = 200;

// One folder, no walking into subfolders: a clips folder is flat, and a
// recursive read of the wrong folder could take minutes.
function list(dir, { fsImpl = fs, max = MAX } = {}) {
  const entries = fsImpl.readdirSync(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile() || !VIDEO.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    let stat;
    try { stat = fsImpl.statSync(full); } catch { continue; }   // deleted as we looked
    out.push({ name: entry.name, path: full, bytes: stat.size, at: stat.mtimeMs });
  }
  out.sort((a, b) => b.at - a.at);
  return out.slice(0, max);
}

// Where clips usually are, so the first run can offer somewhere rather than an
// empty picker. Only folders that exist are offered.
function guesses(home, { fsImpl = fs } = {}) {
  const maybe = [
    path.join(home, 'Videos'),
    path.join(home, 'Videos', 'Captures'),
    path.join(home, 'Videos', 'Radeon ReLive'),
    path.join(home, 'Documents', 'OBS'),
    path.join(home, 'Movies'),
  ];
  return maybe.filter(p => { try { return fsImpl.statSync(p).isDirectory(); } catch { return false; } });
}

module.exports = { list, guesses, VIDEO, MAX };
