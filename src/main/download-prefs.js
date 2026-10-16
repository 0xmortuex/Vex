// Where downloads go: Chrome's two settings, "Location" and "Ask where to save
// each file before downloading" (Settings > Downloads, js/downloads-panel.js).
// Kept here in the main process, in the profile's download-prefs.json: the
// folder is only ever one picked in the system folder dialog (main.js,
// downloads:choose-folder), never a path the interface sends, so a page or a
// script in the window cannot point downloads at a folder of its choosing.
// No folder saved means the Downloads folder, the default.
const path = require('path');

function createDownloadPrefs({ fs, file, defaultFolder }) {
  let prefs = { folder: null, ask: false, resume: false };
  // A file that cannot be read is said in the log and leaves the defaults:
  // Vex must still start, and downloads still land somewhere you know.
  try {
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
      prefs = {
        folder: typeof saved.folder === 'string' && path.isAbsolute(saved.folder) ? saved.folder : null,
        ask: saved.ask === true,
        resume: saved.resume === true,
      };
    }
  } catch (err) { console.error('[Downloads] could not read where downloads go, using the Downloads folder:', err.message); }
  const write = () => fs.writeFileSync(file, JSON.stringify(prefs));

  // What Settings shows: the folder in use, whether it is one the user chose,
  // and whether each file is asked about.
  function get() {
    return { folder: prefs.folder || defaultFolder(), custom: !!prefs.folder, ask: prefs.ask, resume: prefs.resume, defaultFolder: defaultFolder() };
  }
  function setFolder(dir) {
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('Choose a folder on this computer');
    if (!fs.statSync(dir).isDirectory()) throw new Error('That is not a folder');
    // The Downloads folder itself is the default, not a choice to remember.
    prefs.folder = path.resolve(dir) === path.resolve(defaultFolder()) ? null : path.resolve(dir);
    write();
    return get();
  }
  function setAsk(on) {
    if (typeof on !== 'boolean') throw new Error('Ask is on or off');
    prefs.ask = on;
    write();
    return get();
  }
  // "Pick up unfinished downloads after a restart": off until the person turns it on.
  function setResume(on) {
    if (typeof on !== 'boolean') throw new Error('Resume is on or off');
    prefs.resume = on;
    write();
    return get();
  }
  // Settings > Reset to Defaults.
  function reset() {
    prefs = { folder: null, ask: false, resume: false };
    write();
    return get();
  }
  // What a download uses: the folder (null = the Downloads folder) and ask.
  const current = () => ({ folder: prefs.folder, ask: prefs.ask, resume: prefs.resume });
  return { get, setFolder, setAsk, setResume, reset, current };
}

module.exports = { createDownloadPrefs };
