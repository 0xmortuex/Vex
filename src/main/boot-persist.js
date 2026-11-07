// === vex-persist.json, read ONCE before the app is ready ===================
//
// Two launch switches (Memory Saver, smooth scrolling) can only be set before Electron is ready, so they read the
// persisted settings file straight from disk. That file can be ~2.5 MB, and it used to be read and JSON.parsed
// twice, synchronously, on the start-up path. It is read and parsed once here and both switches share the result.
//
// Behaviour is exactly what the two separate reads did:
//   * Memory Saver: any failure (no file, unreadable, not JSON, not an object) means "off", silently.
//   * Smooth scrolling: no file (ENOENT) is normal and silent; any other failure is returned as a warning
//     for the caller to log.

// -> { data, error }: the parsed file, or the error that stopped it.
function readBootPersist({ fs, path, userData }) {
  if (!fs || !path || !userData) throw new Error('readBootPersist needs fs, path and the profile folder');
  try {
    return { data: JSON.parse(fs.readFileSync(path.join(userData, 'vex-persist.json'), 'utf-8')), error: null };
  } catch (error) {
    return { data: null, error };
  }
}

function memorySaverOn(boot) {
  if (boot.error) return false;
  try { return boot.data['vex.memorySaver'] === '1' || boot.data['vex.memorySaver'] === 1; }
  catch { return false; }           // a file holding null is "not set"
}

// -> { off, warning }: whether smooth scrolling was switched off, and a line to log when the file could not be read.
function smoothScrollChoice(boot) {
  const warn = (err) => (err && err.code === 'ENOENT' ? null : '[Startup] could not read the smooth scrolling choice: ' + (err && err.message));
  if (boot.error) return { off: false, warning: warn(boot.error) };
  try { return { off: boot.data['vex.smoothScroll'] === 'off', warning: null }; }
  catch (err) { return { off: false, warning: warn(err) }; }
}

module.exports = { readBootPersist, memorySaverOn, smoothScrollChoice };
