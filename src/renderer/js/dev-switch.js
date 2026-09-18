// === The same page, somewhere else =========================================
//
// Working on a site means the same path in three places: the live one, a
// staging copy, and whatever is running on this machine. Moving between them
// is retyping a URL by hand — with the path, the query and the fragment, which
// is exactly where a typo costs ten minutes.
//
// This keeps everything after the host and swaps only the host, and it knows
// which local port that site is on because Vex can see what is listening.
const DevSwitch = {
  KEY: 'vex.devEnvironments',     // { [liveHost]: { staging, local } }

  map() { try { const m = JSON.parse(localStorage.getItem(this.KEY) || '{}'); return (m && typeof m === 'object') ? m : {}; } catch { return {}; } },
  _save(m) {
    try { localStorage.setItem(this.KEY, JSON.stringify(m)); return true; }
    catch (err) { VexProblems?.note('Environments', 'Could not save the environments', err); return false; }
  },

  // A group is remembered under whichever of its hosts you are on, so it works
  // in both directions without asking which one is "the" site.
  groupFor(url) {
    let host;
    try { host = new URL(String(url)).host; } catch { return null; }
    const m = this.map();
    if (m[host]) return { key: host, ...m[host] };
    for (const [key, group] of Object.entries(m)) {
      if (group && (group.staging === host || group.local === host)) return { key, ...group };
    }
    return null;
  },

  // { live, staging, local } — any may be empty; empty removes that one.
  remember(url, group) {
    let host;
    try { host = new URL(String(url)).host; } catch { throw new Error('That tab has no address'); }
    const key = (group && group.live) || host;
    const m = this.map();
    const clean = {};
    for (const which of ['staging', 'local']) {
      const v = String((group && group[which]) || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
      if (v) clean[which] = v;
    }
    if (!Object.keys(clean).length) delete m[key]; else m[key] = clean;
    if (!this._save(m)) throw new Error('The environments could not be saved');
    return { key, ...clean };
  },

  // The same path on another host. Everything after the host is kept exactly —
  // path, query and fragment — because that is the part worth not retyping.
  swap(url, toHost) {
    const u = new URL(String(url));
    const target = String(toHost || '').replace(/^https?:\/\//i, '').replace(/\/$/, '');
    if (!target) throw new Error('There is nowhere to switch to');
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(target);
    // A local server is almost never on https, and a browser that insists on it
    // turns "switch to local" into a blank page and a puzzled minute.
    u.protocol = local ? 'http:' : 'https:';
    // Setting `host` without a port KEEPS the old one, so switching back from
    // localhost:5173 gave shop.example:5173 — a real address that is not the
    // site. Set the two halves explicitly.
    const [hostname, port = ''] = target.split(':');
    u.hostname = hostname;
    u.port = port;
    return u.href;
  },

  // What this address could switch to, including any dev server that is up.
  // → [{ label, host, url, running }]
  async options(url) {
    let here;
    try { here = new URL(String(url)); } catch { return []; }
    const group = this.groupFor(url) || {};
    const out = [];
    const add = (label, host, running) => {
      if (!host || host === here.host) return;
      out.push({ label, host, url: this.swap(here.href, host), running: !!running });
    };
    add('Live', group.key, true);
    add('Staging', group.staging, true);
    add('Local', group.local, true);

    // Whatever is actually listening, so a port you never wrote down still
    // appears (main/dev-ports.js).
    let servers = [];
    try { servers = (window.vex && window.vex.devPorts) ? await window.vex.devPorts() : []; }
    catch (err) { VexProblems?.note('Environments', 'Could not look for dev servers', err); }
    for (const s of servers) {
      const host = 'localhost:' + s.port;
      if (out.some(o => o.host === host)) continue;
      add('localhost:' + s.port + (s.guess ? ' — ' + s.guess : ''), host, true);
    }
    return out;
  },
};

if (typeof window !== 'undefined') window.DevSwitch = DevSwitch;
if (typeof module !== 'undefined' && module.exports) module.exports = { DevSwitch };
