// === "I clicked something": the one thing the checklist looks at on disk (T2-090) ==========
//
// The incident playbook asks Vex to look at the NAMES of what is in the downloads
// folder. Only names, sizes and dates: no file is opened, read or hashed, and nothing
// is scanned for viruses (that is Windows Security's job; the checklist has a step that
// opens it). A name is flagged for what it shows on its face:
//   - a program or script ending (exe, msi, scr, bat, cmd, ps1, vbs, js, jar, lnk ...),
//   - a program hidden behind a picture or document ending ("invoice.pdf.exe"),
//   - a name with text-reversing characters, which hide the real ending.
'use strict';

const { KIND_BY_EXT } = require('./web-safety');

const DECOY_EXT = /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|bmp|txt|rtf|mp3|mp4|avi|mkv|zip|rar|7z|csv|html?)\.(exe|scr|bat|cmd|com|pif|js|jse|vbs|vbe|ps1|msi|lnk|hta|cpl|jar|wsf)$/i;
const BIDI = /[‪-‮⁦-⁩]/;
const DAY_MS = 24 * 3600 * 1000;
const MAX_FILES = 600;
const MAX_FLAGGED = 60;
const WORD = { program: 'a program', script: 'a script', macro: 'a document with macros', installer: 'an installer or disk image' };

function extOf(name) {
  const m = /\.([A-Za-z0-9]{1,12})\s*$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

// files: [{ name, mtimeMs, size }]. -> { total, recent, flagged:[{ name, kind, why, at, size }] }
function scanNames(files, now = Date.now(), days = 30) {
  const list = Array.isArray(files) ? files : [];
  const since = now - days * DAY_MS;
  const flagged = [];
  let recent = 0;
  for (const f of list) {
    const name = String(f && f.name || '');
    if (!name) continue;
    const at = Number.isFinite(f.mtimeMs) ? Math.round(f.mtimeMs) : 0;
    if (at >= since) recent++;
    let kind = null, why = '';
    if (BIDI.test(name)) { kind = 'disguised'; why = 'Its name hides its real ending behind reversed text.'; }
    else if (DECOY_EXT.test(name)) { kind = 'disguised'; why = 'It looks like a picture or document but ends as a program or script.'; }
    else {
      const k = KIND_BY_EXT[extOf(name)];
      if (k === 'program' || k === 'script') { kind = k; why = 'It is ' + WORD[k] + '.'; }
      else if (k === 'macro' || k === 'installer') { kind = k; why = 'It is ' + WORD[k] + '.'; }
    }
    if (!kind) continue;
    // Old programs you chose to keep are not the question after a click; the last
    // `days` days are. A disguised name is always listed.
    if (kind !== 'disguised' && at < since) continue;
    flagged.push({ name, kind, why, at, size: Number.isFinite(f.size) ? f.size : 0 });
  }
  flagged.sort((a, b) => (a.kind === 'disguised' ? 0 : 1) - (b.kind === 'disguised' ? 0 : 1) || b.at - a.at);
  return { total: list.length, recent, days, flagged: flagged.slice(0, MAX_FLAGGED), more: Math.max(0, flagged.length - MAX_FLAGGED) };
}

// fsMod: node:fs (a test gives a stand-in). Reads the directory listing and each entry's
// size and date only.
function scanFolder(dir, fsMod, now = Date.now()) {
  if (typeof dir !== 'string' || !dir) throw new Error('There is no downloads folder to look at');
  const names = fsMod.readdirSync(dir).slice(0, MAX_FILES);
  const files = [];
  for (const name of names) {
    let st;
    try { st = fsMod.statSync(require('path').join(dir, name)); }
    catch (err) { if (err.code === 'ENOENT') continue; throw err; }
    if (st.isFile()) files.push({ name, mtimeMs: st.mtimeMs, size: st.size });
  }
  return { folder: dir, ...scanNames(files, now) };
}

function registerIncidentScan({ ipcMain, fs, folder, isLocked = () => false }) {
  ipcMain.handle('hygiene:downloads-scan', () => {
    if (isLocked()) throw new Error('Vex is locked');
    return scanFolder(folder(), fs);
  });
}

module.exports = { scanNames, scanFolder, registerIncidentScan };
