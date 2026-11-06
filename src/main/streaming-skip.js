// === Streaming sites: which ones may have their Skip / Next buttons pressed ===
//
// The per-site switches for "Skip intro / recap / next episode / still watching"
// (the scanner itself and the selector table are in src/site-tweaks.js). Every site
// is OFF until the person turns it on. This file keeps the switches and the "last
// matched" note, in a small file in the profile folder; it makes no network request.
//
// "Last matched" is what makes a broken selector noticeable: a site that has been
// on for a while and shows "not matched yet" is probably a page Vex's table no
// longer fits.

const KINDS = ['intro', 'recap', 'next', 'continue'];

function createStreamingSkipStore({ fs, file, table, now = () => Date.now() } = {}) {
  if (!fs || !file) throw new Error('createStreamingSkipStore needs fs and a file');
  if (!table || !table.sites) throw new Error('createStreamingSkipStore needs the selector table');
  const ids = Object.keys(table.sites);
  let data = { sites: {} };
  if (fs.existsSync(file)) {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (err) { console.error('[StreamingSkip] the saved switches could not be read, so every site is off:', err.message); raw = null; }
    if (raw && typeof raw === 'object' && raw.sites && typeof raw.sites === 'object') {
      for (const id of ids) {
        const s = raw.sites[id];
        if (!s || typeof s !== 'object') continue;
        const last = s.last && KINDS.includes(s.last.kind) && Number.isFinite(s.last.at) ? { kind: s.last.kind, at: s.last.at } : null;
        data.sites[id] = { enabled: s.enabled === true, last };
      }
    }
  }
  const entry = (id) => (data.sites[id] || (data.sites[id] = { enabled: false, last: null }));
  function save() {
    try { fs.writeFileSync(file, JSON.stringify(data)); }
    catch (err) { throw new Error('Could not save the streaming switches: ' + err.message, { cause: err }); }
  }
  function check(id) { if (!ids.includes(id)) throw new Error('Unknown streaming site: ' + String(id)); }

  return {
    // The sites that are on: what a page's preload is told.
    enabledSites() { return ids.filter((id) => data.sites[id] && data.sites[id].enabled); },
    set(id, on) {
      check(id);
      if (typeof on !== 'boolean') throw new Error('A streaming switch is on or off');
      const e = entry(id);
      e.enabled = on;
      save();
      return this.state();
    },
    // A button was pressed on a page: only a site that is on can say so.
    recordMatch(id, kind) {
      check(id);
      if (!KINDS.includes(kind)) throw new Error('Unknown button kind: ' + String(kind));
      const e = entry(id);
      if (!e.enabled) return false;
      e.last = { kind, at: now() };
      save();
      return true;
    },
    state() {
      return {
        version: table.version, updated: table.updated, verified: table.verified === true,
        sites: ids.map((id) => ({ id, label: table.sites[id].label, enabled: !!(data.sites[id] && data.sites[id].enabled), last: (data.sites[id] && data.sites[id].last) || null })),
      };
    },
  };
}

module.exports = { createStreamingSkipStore, KINDS };
