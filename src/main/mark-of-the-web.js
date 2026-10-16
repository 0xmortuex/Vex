// === The "downloaded from the internet" mark, kept where Vex moves a file (T3-111) ==
//
// Windows records where a file came from in an alternate data stream on the file
// itself, "<file>:Zone.Identifier" (the mark of the web). It is what makes
// SmartScreen and Office's Protected View look at a downloaded program before it
// runs. Chromium writes it when a download finishes. This module does not write
// marks of its own making: it only
//
//   - carries the mark across a move or rename Vex does itself (the holding folder
//     to the final place, the downloads tidy-up and its undo), by reading the
//     stream first and, if the move lost it, putting back the very same text;
//   - reports, read-only, which of Vex's downloaded files no longer have one.
//
// A rename on the same drive keeps the stream with the file, so this is normally a
// no-op that proves it. It earns its keep across drives (a copy), on a target that
// is not NTFS (the stream cannot exist there, and that is reported, not hidden),
// and as a check that a later move did not silently drop the protection.
//
// Never written: a file that had no mark to begin with, or any file Vex did not
// move. Never read: the file's contents.
const STREAM = ':Zone.Identifier';

function createMarkOfTheWeb({ fs, platform = process.platform, log = () => {} }) {
  const win = platform === 'win32';
  const streamPath = (file) => String(file) + STREAM;

  // The stream's text, or null when the file has none (or the platform has no such thing).
  function read(file) {
    if (!win) return null;
    try { return fs.readFileSync(streamPath(file), 'utf8'); }
    catch (err) {
      // No mark, or no such file: both are "nothing to carry". Anything else is real.
      if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return null;
      throw new Error('Could not read the mark of the web on ' + file + ': ' + (err && err.message), { cause: err });
    }
  }

  // "ZoneId=3" -> 3. Zone 3 is the Internet, 4 is Restricted; 0-2 are local, intranet, trusted.
  function zoneOf(text) {
    const m = /^\s*ZoneId\s*=\s*(\d)\s*$/im.exec(String(text || ''));
    return m ? Number(m[1]) : null;
  }
  const hasMark = (text) => { const z = zoneOf(text); return z !== null && z >= 3; };

  // Run a move/rename, then make sure the mark survived it.
  // → { carried: false } nothing to carry (no mark before, or not Windows)
  //   { carried: true, kept: true }   the mark came through the move by itself
  //   { carried: true, kept: false, restored: true }  it was lost and put back
  //   { carried: true, kept: false, restored: false, error }  it was lost and could not be put back
  // The move itself is `doMove`; its own errors are not caught here.
  function move(from, to, doMove) {
    const before = read(from);
    doMove();
    if (before === null || !hasMark(before)) return { carried: false };
    let after;
    try { after = read(to); }
    catch (err) { after = null; log('[MarkOfTheWeb] ' + err.message); }
    if (after !== null && hasMark(after)) return { carried: true, kept: true };
    try {
      fs.writeFileSync(streamPath(to), before);
      log('[MarkOfTheWeb] put the mark back on ' + to);
      return { carried: true, kept: false, restored: true };
    } catch (err) {
      const error = 'The file moved but lost its "downloaded from the internet" mark, and it could not be put back (' + ((err && err.message) || err) + ')';
      log('[MarkOfTheWeb] ' + error + ': ' + to);
      return { carried: true, kept: false, restored: false, error };
    }
  }

  // Read-only: how many of these files still carry a mark, and which do not. A file
  // that is gone is counted apart (the panel already says "deleted").
  function check(files) {
    const out = { checked: 0, marked: 0, missingMark: [], gone: 0 };
    if (!win) return { ...out, supported: false };
    for (const file of Array.isArray(files) ? files : []) {
      if (typeof file !== 'string' || !file) continue;
      if (!fs.existsSync(file)) { out.gone++; continue; }
      out.checked++;
      const text = read(file);
      if (text !== null && hasMark(text)) out.marked++;
      else out.missingMark.push(file);
    }
    return { ...out, supported: true };
  }

  return { move, check, read, zoneOf, hasMark, STREAM };
}

module.exports = { createMarkOfTheWeb, STREAM };
