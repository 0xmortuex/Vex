// === Developer desk: the small parts its features share ======================
//
// Loaded before dev-ports-pair.js, actions-board.js, log-reader.js, plugin-dev.js,
// electron-ticker.js, secret-guard.js and dev-desk.js (which draws their one Settings
// section). Every feature of the desk is OFF until the owner switches it on.
const DevDeskUtil = {
  // A switch kept in its own localStorage key: 'on' / anything else = off. Off by default
  // because these features arrive for existing profiles switched off (staged enablement).
  switchFor(key) {
    return {
      enabled() {
        try { return localStorage.getItem(key) === 'on'; }
        catch (err) { console.error('[DevDesk] the switch ' + key + ' could not be read:', err.message); return false; }
      },
      // A module spreads this into itself and may define followEnabled(on): its commands, its background
      // job, whatever it pushes elsewhere. It runs on EVERY route that flips the switch (the Settings
      // toggle, Library's Turn on, Discover, Feature usage, Minimal Vex), not only the Settings toggle.
      setEnabled(on) {
        localStorage.setItem(key, on ? 'on' : 'off');
        if (typeof this.followEnabled === 'function') this.followEnabled(on);
      },
    };
  },
  // A JSON object kept in localStorage. A record that cannot be read is reported and started again.
  read(key, fallback) {
    let raw = null;
    try { raw = localStorage.getItem(key); }
    catch (err) { console.error('[DevDesk] ' + key + ' could not be read:', err.message); return fallback(); }
    if (raw == null) return fallback();
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
      throw new Error('not an object');
    } catch (err) {
      console.error('[DevDesk] ' + key + ' is not readable and is started again:', err.message);
      if (typeof VexProblems !== 'undefined') VexProblems.note('Developer desk', key + ' was not readable and was started again', err);
      return fallback();
    }
  },
  write(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
  el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  },
  fail(what, err) {
    console.error('[DevDesk] ' + what + ':', err);
    if (typeof window !== 'undefined') window.showToast?.(what + ': ' + ((err && err.message) || err), 'error');
  },
  // The preload function `name`, or an error that says what is missing.
  bridge(name) {
    const v = typeof window !== 'undefined' ? window.vex : null;
    if (!v || typeof v[name] !== 'function') throw new Error('This window cannot do that (' + name + ' is not available)');
    return v[name].bind(v);
  },
  ago(ms) {
    const m = Math.round((Date.now() - ms) / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago';
  },
  touch(feature) { if (typeof VexUsage !== 'undefined') VexUsage.touch(feature); },
};

if (typeof window !== 'undefined') window.DevDeskUtil = DevDeskUtil;
if (typeof module !== 'undefined' && module.exports) module.exports = { DevDeskUtil };
