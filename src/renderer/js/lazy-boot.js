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
    { src: 'js/page-recorder.js', usage: [] },
    { src: 'js/agent-task-panel.js', usage: [] },
    { src: 'js/shopping-clip.js', usage: [] },
    { src: 'js/dev-loop-ui.js', usage: [] },
    { src: 'js/clipboard-pipeline.js', usage: [] },
    { src: 'js/vex-mini-games.js', usage: [] },
    { src: 'js/play-room.js', usage: [] },
    { src: 'js/vex-tab-tetris.js', usage: [] },
    { src: 'js/vex-medals-profile.js', usage: [] },
    { src: 'js/privacy-report-card.js', usage: [] },
    { src: 'js/security-helpers.js', usage: [] },
    { src: 'js/timeline-actions.js', usage: [] },
    { src: 'js/extension-audit-view.js', usage: [] },
    { src: 'js/vex-usage-ui.js', usage: [] },
    { src: 'js/fun/fun-settings.js', usage: [] },
    { src: 'js/attention-settings.js', usage: [] },
    { src: 'js/quiet-hours-ui.js', usage: [] },
    { src: 'js/tabs-nav-settings.js', usage: [] },
    { src: 'js/capture-tools.js', usage: [] },
    // Wave 6: features that sit in the usage record and that nothing reads while the window comes up. Each registers its
    // switch when it arrives and the staging pass runs again (VexRegistry.restageLate), so a profile that already existed
    // still gets them switched off.
    { src: 'js/links-windows.js', usage: ['mini-window', 'window-set'] },
    { src: 'js/embedding-manager.js', usage: ['embedding-manager'] },
    { src: 'js/response-overrides-ui.js', usage: ['response-overrides'] },
    { src: 'js/selection-tools.js', usage: ['selection-tools'] },
    { src: 'js/log-tailer.js', usage: ['log-tailer'] },
    { src: 'js/docs-pin.js', usage: ['docs-pin'] },
    { src: 'js/pkg-card.js', usage: ['pkg-card'] },
    { src: 'js/code-library.js', usage: ['code-library'] },
    { src: 'js/paper-brief.js', usage: ['paper-brief'] },
    { src: 'js/mun-dossier.js', usage: ['mun-dossier'] },
    { src: 'js/game-scenes.js', usage: ['game-scenes'] },
    { src: 'js/second-screen.js', usage: ['second-screen'] },
    { src: 'js/receipt-locker.js', usage: ['receipt-locker'] },
    { src: 'js/day-shape.js', usage: ['day-shape'] },
    { src: 'js/whats-new-me.js', usage: ['whats-new-me'] },
    { src: 'js/media-control.js', usage: ['media-control'] },
    { src: 'js/pdf-highlights.js', usage: ['pdf-highlights'] },
    { src: 'js/pdf-tools-ui.js', usage: ['pdf-tools'] },
    { src: 'js/reading-aids-lists.js', usage: [] },
    { src: 'js/turkish-lemma.js', usage: [] },
    { src: 'js/reading-aids.js', usage: ['reading-aids'] },
  ],
  marks: {},
  failed: [],      // late modules that could not load (also in the Problems log)

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
    Promise.all(loads).then((results) => {
      this.failed = this.LATE_MODULES.filter((_, i) => !results[i]).map(m => m.src);
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
