// === Start-up budget: boot marks and the modules that load after start-up (T3-066) ===
//
// index.html parses ~490 blocking scripts before the window is usable. Each new
// feature added another one. Two things keep that from growing without end:
//
//   1. BUDGET (scripts/startup-budget.js, run by `npm run check:source`): the
//      number and size of the blocking scripts may not grow more than 15
//      percent past scripts/startup-budget.json. A new feature that does not
//      need to be there at first paint goes in LATE_MODULES below instead.
//   2. LATE_MODULES: files that only register a Settings section, a Ctrl+K
//      command and their switch when they load, and that nothing reads while
//      the window is coming up, are loaded after the window's load event, at an
//      idle moment (VexLazy.afterIdle, js/lazy.js). Their index.html tag is
//      gone; the bundle step leaves them as separate files, as it does for
//      every lazily loaded file, so load order of the rest is untouched.
//      A module belongs here only if NO other file reads its global at load
//      time and its VexUsage switch (if any) is listed in `usage` so it joins
//      the registry when it arrives.
//
// Three boot marks (milliseconds since navigation start) are kept for the last
// ten starts on this computer, for the diagnostics and the budget check:
//   scripts   all blocking scripts have run (this file is the last of them)
//   ready     the window's load event
//   settled   every late module has loaded (or failed)
const VexBoot = {
  KEY: 'vex.boot.marks',
  KEEP: 10,
  LATE_MODULES: [
    { src: 'js/release-checklist.js', usage: ['release-check'] },
    { src: 'js/diagnostics-bundle.js', usage: [] },
    { src: 'js/your-data.js', usage: [] },
  ],
  marks: {},

  mark(name) {
    if (typeof performance === 'undefined') return null;
    const t = Math.round(performance.now());
    this.marks[name] = t;
    if (typeof window !== 'undefined' && window.VexStartup) window.VexStartup.marks = { ...this.marks };
    return t;
  },

  _history() {
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); }
    catch (err) { throw new Error('The boot marks could not be read: ' + err.message); }
    if (!raw) return [];
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; }
    catch (err) { throw new Error('The boot marks are not readable: ' + err.message); }
  },

  // Keeps this start's marks (called once all three are in).
  record(at = Date.now()) {
    const list = this._history();
    list.push({ at, ...this.marks });
    while (list.length > this.KEEP) list.shift();
    localStorage.setItem(this.KEY, JSON.stringify(list));
    return list;
  },

  // Median of each mark over the kept starts, for the diagnostics.
  summary() {
    const list = this._history();
    const med = (name) => {
      const v = list.map(e => e[name]).filter(Number.isFinite).sort((a, b) => a - b);
      return v.length ? v[Math.floor(v.length / 2)] : null;
    };
    return { starts: list.length, scripts: med('scripts'), ready: med('ready'), settled: med('settled') };
  },

  start() {
    this.mark('scripts');
    const onLoad = () => this.mark('ready');
    if (document.readyState === 'complete') onLoad(); else window.addEventListener('load', onLoad, { once: true });
    const loads = this.LATE_MODULES.map(m => VexLazy.afterIdle(m.src, { usage: m.usage }).then(() => true, () => false));
    Promise.all(loads).then(() => {
      this.mark('settled');
      try { this.record(); }
      catch (err) { if (typeof VexProblems !== 'undefined') VexProblems.note('Start-up', 'Could not keep the boot marks', err); else console.error('[Boot]', err); }
    });
  },
};

if (typeof window !== 'undefined') {
  window.VexBoot = VexBoot;
  if (typeof VexLazy !== 'undefined') VexBoot.start();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexBoot };
