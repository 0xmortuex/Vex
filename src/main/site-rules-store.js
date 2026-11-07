'use strict';
// === Reading site-rules.json without ever dropping it silently ================
//
// The per-site switches (JavaScript, cookies, user agent, session timers ...) are one small file. It used to be
// read with `catch { _siteRules = {} }`: a file cut by a power loss meant every rule was gone, and the next save
// wrote the empty list over the damaged file. Now:
//   readable                 -> used as it is
//   missing                  -> no rules yet (nothing to report)
//   damaged, .bak is valid   -> the damaged file is kept aside (.corrupt-*), the backup is put back, and the
//                               person is told rules may be missing since the backup
//   damaged, no usable .bak  -> the damaged file is kept aside, Vex starts with no rules, and the person is told
//                               (the copy is there to recover by hand)
// The result says which of these happened; the caller posts the notice (main/attention-notes.js).
const fs = require('fs');
const { atomicWriteSync, readJsonRecoverSync, keepCorruptCopy } = require('./file-store');

function loadSiteRules({ file, clean, fsImpl = fs, now = Date.now() }) {
  if (typeof clean !== 'function') throw new Error('loadSiteRules needs the clean function');
  let r = readJsonRecoverSync(file, { fsImpl, now });
  let cleaned = null;
  if (r.data !== null) {
    try { cleaned = clean(r.data); }
    catch (error) {
      // Parses, but is not rules: treated like a damaged file.
      const corruptCopy = r.corruptCopy || keepCorruptCopy(file, now);
      r = { data: null, source: 'lost', error, corruptCopy };
    }
  }
  if (r.source === 'file') return { rules: cleaned, outcome: 'ok' };
  if (r.source === 'missing') return { rules: {}, outcome: 'missing' };
  if (r.source === 'backup') {
    // The backup becomes the file again. backup:false keeps the .bak as it is (copying the damaged file over it
    // would destroy the only good copy); the damaged file is already kept as .corrupt-*.
    atomicWriteSync(file, JSON.stringify(cleaned), { backup: false, fsImpl });
    return { rules: cleaned, outcome: 'restored', corruptCopy: r.corruptCopy, error: r.error };
  }
  return { rules: {}, outcome: 'lost', corruptCopy: r.corruptCopy, error: r.error };
}

// What to tell the owner for an outcome, or null when there is nothing to tell. Plain English; the window
// translates it (js/i18n-ui.js).
function siteRulesNote(outcome) {
  if (outcome === 'restored') {
    return { feature: 'site-rules', id: 'restored', label: 'Site rules', title: 'Your per-site rules were restored from a backup', body: 'The saved per-site rules could not be read, so Vex put back the last good copy. A change made just before may be missing.' };
  }
  if (outcome === 'lost') {
    return { feature: 'site-rules', id: 'lost', label: 'Site rules', title: 'Your per-site rules could not be read', body: 'Vex started with no per-site rules. The unreadable file was kept next to the original, so it can be recovered by hand.' };
  }
  return null;
}

module.exports = { loadSiteRules, siteRulesNote };
