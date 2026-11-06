// === Global switches that shape every page: Lite mode, and skipping tracking redirects ======
//
//   lite    Lite mode (slow Wi-Fi, a hotspot): every web page loses its pictures and web fonts (the request hook the per-site
//           'images' switch uses, src/main/ad-verdict.js) and its tab is built so sound and video start only on a click
//           (js/site-rules-ui.js autoplayOff, js/webview.js). A site can be left out with its own 'lite' switch.
//   unwrap  a link to a known redirect wrapper (google.com/url?q=..., facebook.com/l.php?u=...) goes straight to the real page
//           (src/main/nav-unwrap.js). null until the window has decided the default for this profile (on for a new profile, off
//           for one that already had data); true or false after.
//
// Kept in the profile (nav-privacy.json) so the first request of the next start is already covered.
const DEFAULTS = { lite: false, unwrap: null };

function clean(raw) {
  const out = { ...DEFAULTS };
  if (raw && typeof raw === 'object') {
    if (typeof raw.lite === 'boolean') out.lite = raw.lite;
    if (typeof raw.unwrap === 'boolean') out.unwrap = raw.unwrap;
  }
  return out;
}

// -> the saved state. A missing file is a new profile; a damaged one is said so and starts from the defaults.
function load(fs, file, log = console) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (err) {
    if (err && err.code === 'ENOENT') return clean(null);
    log.error('[NavPrivacy] could not read ' + file + ', starting from the defaults:', err && err.message);
    return clean(null);
  }
  try { return clean(JSON.parse(text)); }
  catch (err) { log.error('[NavPrivacy] ' + file + ' is not readable, starting from the defaults:', err.message); return clean(null); }
}

function save(fs, file, state) {
  fs.writeFileSync(file, JSON.stringify(clean(state)));
}

// A change from the window: only keys it may send, each checked. -> the new state, or throws.
function apply(state, change) {
  if (!change || typeof change !== 'object' || Array.isArray(change)) throw new Error('A change to these settings is an object');
  const next = { ...state };
  for (const key of Object.keys(change)) {
    if (key === 'lite') {
      if (typeof change.lite !== 'boolean') throw new Error('Lite mode is on or off');
      next.lite = change.lite;
    } else if (key === 'unwrap') {
      if (typeof change.unwrap !== 'boolean') throw new Error('Skipping redirects is on or off');
      next.unwrap = change.unwrap;
    } else {
      throw new Error('Unknown setting: ' + key);
    }
  }
  return next;
}

module.exports = { DEFAULTS, clean, load, save, apply };
