// === Which Vencord plugin costs how many MB in Discord's panel ====================================
//
// Discord's panel is one renderer and every Vencord plugin lives in it, so the operating system reports ONE number.
// The Vencord fork's plugin profiler gives time scores; this gives megabytes, two ways that complement each other:
//
//   1. Allocation attribution (fast, about a minute). Main attaches Chromium's debugger to the Discord page for a
//      window you choose, reads the SAMPLING HEAP PROFILE of objects that were allocated in that window and are still
//      alive, and adds them up per plugin through the Vencord build's line map (src/main/discord-heap.js). It sees
//      what each plugin ALLOCATED AND KEPT during the window; it cannot see memory allocated before the window, and
//      native memory (images, emoji, video) is not attributed per plugin at all. Code that Vencord patches into
//      Discord's own modules counts as Discord's.
//   2. One plugin at a time (slow, opt-in, about 5 minutes per plugin). A baseline with everything on, then for each
//      chosen plugin: turn it off in Vencord's own settings, reload the hidden Discord panel, settle three minutes,
//      take three readings 30 seconds apart (JS heap after a garbage collection, and the process working set), turn it
//      back on; a second baseline at the end shows how much the page drifted by itself. The difference is that plugin's
//      MARGINAL cost, with a +/- from the spread of the readings and of the two baselines; a smaller difference than
//      that is reported as "within noise". Patches stay in Discord until it reloads, which is why each step reloads.
//
// Every plugin is put back: after each step, at the end, when the window closes, on an error, and (if Vex was closed
// in the middle) at the next start - the names are kept in vex.discordCare.pluginPending until they are back on.
//
// Both only run while Discord is hidden and not in a call, a screen share or using the microphone or camera
// (DiscordMemory.reasonToWait), never touch Discord's token or messages, and send nothing anywhere.
const DiscordPluginRam = {
  FEATURE: 'discord-memory-care',
  RESTORE_JOB: 'Discord plugin restore',
  WINDOWS: [15, 30, 60, 120],                // seconds of the allocation window
  DEFAULT_WINDOW_S: 60,
  // The names main accepts for attribution (src/main/discord-heap.js cleanNames). A plugin whose name is outside it
  // (a symbol, a very long name) cannot be followed by name: its allocations are counted as Discord's, and it is
  // left out of the list sent, so one odd name no longer stops the whole measurement.
  NAME_OK: /^[A-Za-z0-9_$][A-Za-z0-9_$ .-]{0,63}$/,
  END_WAIT_MS: 150000,                       // how long the end of a window may take before it is given up
  MAX_DEFAULT: 6,                            // plugins per one-at-a-time session, unless chosen otherwise
  MAX_LIMIT: 20,
  GROUP_SIZES: [8, 4, 2],                    // the choices; smaller groups narrow a group that made a difference down
  GROUP_SIZE: 8,                             // plugins turned off together in one step of a group test
  MAX_UNITS: 24,                             // steps in one group test
  SETTLE_MS: 3 * 60000,
  SAMPLES: 3,
  GAP_MS: 30000,
  RELOAD_MS: 60000,                          // what one reload to a ready page is assumed to take, for the estimate only
  READY_MS: 120000,                          // how long a reloaded page may take before the test gives up
  MAX_IN_USE_MS: 15 * 60000,                 // how long a step waits for Discord to be hidden and out of a call
  last: { fast: null, slow: null, profiler: null },
  _busy: false,
  _restoreJob: null,

  // ---- pure: statistics, plan, estimate -------------------------------------------------------------------------
  mean(v) { return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; },
  spread(v) { return v.length ? Math.max(...v) - Math.min(...v) : 0; },
  _r1(n) { return Math.round(n * 10) / 10; },

  // rows: [{ name, enabled, canDisable, reason }]. The heavy ones first (in the HEAVY list's order), then the rest by name.
  planOrder(rows, { heavy = [], max = this.MAX_DEFAULT } = {}) {
    const cap = Math.max(1, Math.min(this.MAX_LIMIT, Math.floor(Number(max)) || this.MAX_DEFAULT));
    const ok = rows.filter(r => r.enabled && r.canDisable);
    const first = heavy.map(h => ok.find(r => r.name === h)).filter(Boolean);
    const rest = ok.filter(r => !first.includes(r)).sort((a, b) => a.name.localeCompare(b.name));
    const ordered = first.concat(rest).map(r => r.name);
    return {
      ordered, chosen: ordered.slice(0, cap), cap,
      skipped: rows.filter(r => r.enabled && !r.canDisable).map(r => ({ name: r.name, reason: r.reason || 'it cannot be turned off' })),
    };
  },
  // Minutes for n plugins: (n + 2 baselines) x (reload + settle + the gaps between readings).
  estimateMinutes(n, cfg = {}) {
    const c = { settleMs: this.SETTLE_MS, samples: this.SAMPLES, gapMs: this.GAP_MS, reloadMs: this.RELOAD_MS, ...cfg };
    const perStep = c.reloadMs + c.settleMs + Math.max(0, c.samples - 1) * c.gapMs;
    return Math.ceil(((n + 2) * perStep) / 60000);
  },

  // ---- pure: groups -------------------------------------------------------------------------------------------------
  // A group test turns several plugins off TOGETHER and reads the page once: most plugins are tiny, so testing them one by
  // one spends five minutes each to learn nothing. The known-heavy plugins stay alone (they are the suspects); everything
  // else goes in groups of `size`. A small last group joins the one before it. Returns units: a name, or an array of names.
  planGroups(names, { heavy = [], size = this.GROUP_SIZE } = {}) {
    const solo = names.filter(n => heavy.includes(n));
    const rest = names.filter(n => !heavy.includes(n));
    const groups = [];
    for (let i = 0; i < rest.length; i += size) groups.push(rest.slice(i, i + size));
    if (groups.length > 1 && groups[groups.length - 1].length < size / 2) { const last = groups.pop(); groups[groups.length - 1].push(...last); }
    return [...solo, ...groups];
  },
  groupLabel(members, n) {
    return 'Group ' + n + ' (' + members.length + ' plugins: ' + members.slice(0, 3).join(', ') + (members.length > 3 ? ', ...' : '') + ')';
  },

  // ---- pure: one-at-a-time results ------------------------------------------------------------------------------
  _noiseText(noise) { return 'within noise (< ' + Math.max(1, Math.ceil(noise)) + ' MB)'; },
  _classify(delta, noise) {
    if (Math.abs(delta) <= noise) return { sig: false, neg: false, text: this._noiseText(noise) };
    return { sig: true, neg: delta < 0, text: delta > 0 ? 'about ' + Math.round(delta) + ' MB' : 'LESS with the plugin on, by ' + Math.round(-delta) + ' MB (page drift, not the plugin)' };
  },
  // slow = { baselines: [{ heap: [], ws: [] }], plugins: [{ name, heap: [], ws: [] }] }
  summarize(slow) {
    if (!slow || !slow.baselines || !slow.baselines.length) return { rows: [], drift: null };
    const bHeap = slow.baselines.flatMap(b => b.heap);
    const bWs = slow.baselines.flatMap(b => b.ws);
    const rows = (slow.plugins || []).map(p => {
      const heapDelta = this.mean(bHeap) - this.mean(p.heap);
      const wsDelta = this.mean(bWs) - this.mean(p.ws);
      const heapNoise = Math.max(this.spread(bHeap), this.spread(p.heap));
      const wsNoise = Math.max(this.spread(bWs), this.spread(p.ws));
      const h = this._classify(heapDelta, heapNoise), w = this._classify(wsDelta, wsNoise);
      let verdict;
      if (w.sig) verdict = w.neg ? w.text : w.text + ' of process memory';
      else if (h.sig) verdict = h.neg ? h.text : h.text + ' of JavaScript heap; process memory ' + w.text;
      else verdict = this._noiseText(Math.max(heapNoise, wsNoise));
      return { name: p.name, members: p.members || null, heapDelta: this._r1(heapDelta), wsDelta: this._r1(wsDelta), heapNoise: this._r1(heapNoise), wsNoise: this._r1(wsNoise),
        verdict, sig: w.sig || h.sig, wsSig: w.sig, heapSig: h.sig };
    });
    let drift = null;
    if (slow.baselines.length >= 2) {
      const a = slow.baselines[0], b = slow.baselines[slow.baselines.length - 1];
      drift = { heap: this._r1(this.mean(b.heap) - this.mean(a.heap)), ws: this._r1(this.mean(b.ws) - this.mean(a.ws)) };
    }
    return { rows, drift };
  },

  // The merged table: one row per plugin seen by either method, biggest first.
  tableRows(last, profiler) {
    const byName = new Map();
    const row = (name) => { let r = byName.get(name); if (!r) { r = { name, allocMB: null, selfMB: null, slow: null, timeMs: null }; byName.set(name, r); } return r; };
    if (last.fast) for (const p of last.fast.plugins) { const r = row(p.name); r.allocMB = this._r1(p.kb / 1024); r.selfMB = this._r1(p.selfKB / 1024); }
    if (last.slow) for (const s of this.summarize(last.slow).rows) row(s.name).slow = s;
    if (profiler && Array.isArray(profiler.rows)) for (const p of profiler.rows) if (byName.has(p.name)) byName.get(p.name).timeMs = Math.round(p.totalMs || 0);
    const cost = (r) => Math.max(r.allocMB || 0, r.slow && r.slow.wsSig ? r.slow.wsDelta : 0, r.slow && r.slow.heapSig ? r.slow.heapDelta : 0);
    return [...byName.values()].sort((a, b) => cost(b) - cost(a) || a.name.localeCompare(b.name));
  },

  // The report section as plain text. Pure: the same data gives the same words (tested).
  sectionText(last, profiler) {
    const out = ['Plugin memory (what each Vencord plugin costs inside Discord’s panel)'];
    if (!last || (!last.fast && !last.slow)) {
      out.push('  Not measured yet. Settings > Performance > "Measure plugin memory" (about a minute) or "One at a time..." (about 5 minutes per plugin), or Ctrl+K > Plugin memory.');
      out.push(...this.limits().map(l => '  ' + l));
      return out.join('\n');
    }
    const when = (t) => new Date(t).toLocaleString();
    if (last.fast) {
      const f = last.fast;
      out.push('  Allocation attribution: ' + f.plugins.length + ' plugins allocated memory that was still alive after a ' + Math.round(f.windowMs / 1000) + ' s window (' + when(f.at) + '). JS heap in use ' + f.heap.beforeMB + ' -> ' + f.heap.afterMB + ' MB of ' + f.heap.totalMB + ' MB reserved.');
      const m = f.map || {};
      if (m.status !== 'ok') out.push('  WARNING: no usable plugin line map (' + (m.why || m.status) + '); plugins were matched by name only, which finds far less. Install the Vencord build from the w6-plugin-ram branch.');
    }
    if (last.slow) {
      const s = this.summarize(last.slow);
      const tested = last.slow.plugins.reduce((n, p) => n + (p.members ? p.members.length : 1), 0);
      const grouped = last.slow.plugins.some(p => p.members);
      out.push('  ' + (grouped ? 'In groups' : 'One at a time') + ': ' + tested + ' plugin' + VexPlural.s(tested) + (grouped ? ' in ' + last.slow.plugins.length + ' steps' : '') + ' tested (' + when(last.slow.at) + ')' + (last.slow.partial ? ' - STOPPED EARLY' : '') + '.' + (s.drift ? ' Baseline drift between the first and last run: heap ' + (s.drift.heap >= 0 ? '+' : '') + s.drift.heap + ' MB, process ' + (s.drift.ws >= 0 ? '+' : '') + s.drift.ws + ' MB.' : ' No second baseline was reached, so drift is unknown.'));
      if (last.slow.skipped && last.slow.skipped.length) out.push('  Not tested (cannot be turned off): ' + last.slow.skipped.map(x => x.name).join(', ') + '.');
    }
    out.push('');
    const rows = this.tableRows(last, profiler);
    const pad = (s, n) => String(s).padEnd(n);
    const nameW = Math.min(32, Math.max(30, ...rows.map(r => r.name.length)));
    out.push('  ' + pad('plugin', nameW) + pad('by allocation', 15) + pad('one at a time: heap / process', 31) + pad('+/- (heap / process)', 22) + pad('verdict', 44) + 'time score (old)');
    for (const r of rows) {
      const alloc = r.allocMB == null ? '-' : r.allocMB + ' MB';
      const one = r.slow ? (r.slow.heapDelta + ' / ' + r.slow.wsDelta + ' MB') : '-';
      const pm = r.slow ? ('±' + r.slow.heapNoise + ' / ±' + r.slow.wsNoise) : '-';
      const verdict = r.slow ? r.slow.verdict : (r.allocMB != null ? 'kept ' + r.allocMB + ' MB in the window' : '-');
      out.push('  ' + pad(r.name.slice(0, nameW), nameW) + pad(alloc, 15) + pad(one, 31) + pad(pm, 22) + pad(verdict.slice(0, 43), 44) + (r.timeMs == null ? '-' : r.timeMs + ' ms'));
    }
    if (last.fast) {
      out.push('  ' + pad('Vencord core (not a plugin)', nameW) + pad(this._r1(last.fast.coreKB / 1024) + ' MB', 15));
      out.push('  ' + pad('Discord itself / unattributed', nameW) + pad(this._r1(last.fast.otherKB / 1024) + ' MB', 15));
    }
    const bigGroups = last.slow ? this.summarize(last.slow).rows.filter(r => r.members && ((r.wsSig && r.wsDelta > 0) || (r.heapSig && r.heapDelta > 0))) : [];
    if (bigGroups.length) {
      out.push('', '  Groups that made a difference (the plugin is among the members; "One at a time..." will have them ticked for you):');
      for (const g of bigGroups) out.push('  - ' + g.name.replace(/\s*\(.*$/, '') + ': ' + g.verdict + ' -> ' + g.members.join(', '));
    }
    out.push('', ...this.limits().map(l => '  ' + l));
    return out.join('\n');
  },
  limits() {
    return [
      'What the numbers mean:',
      '- "by allocation": MB of JavaScript objects the plugin’s code allocated during the window that were still alive at its end (Chromium’s sampling heap profiler, attributed through the Vencord build’s line map). It does not see memory allocated before the window. Code Vencord patches into Discord’s own modules counts as Discord’s. Native memory (images, emoji, video) is NOT attributed per plugin.',
      '- "one at a time": how much SMALLER the page is with that plugin off, after a reload, three minutes of settling and three readings (JavaScript heap after a garbage collection / the whole process). The ± is the largest spread among the readings and the two baselines; a smaller difference than that is "within noise". Noise is tens of MB and depends on the server and channel Discord has open.',
      '- "in groups": several plugins are turned off together and the page is read once per group. A group that drops by more than the noise holds a costly plugin (its members are listed); a group that does not drop clears all of its plugins in one step.',
      '- JavaScript heap is only part of the process; the rest is the page tree, decoded images and the compositor. Patches stay in Discord until it reloads: the one-at-a-time test reloads for every plugin, the allocation method cannot undo patches.',
      '- "time score (old)": the PluginProfiler plugin’s time spent, not memory; shown only for comparison.',
    ];
  },

  // ---- Discord side: the plugin list and the on/off switch ---------------------------------------------------------
  // The VexPluginRam plugin (Vencord fork, branch w6-plugin-ram) answers with the full list and refuses unsafe
  // switches. Without it only Vencord's own settings are available, and then only the known heavy plugins are offered.
  LIST_CODE: `(() => {
    const api = window.VexPluginRam;
    if (api && typeof api.list === 'function') return { via: 'api', rows: api.list().map(r => ({ name: String(r.name), enabled: !!r.enabled, canDisable: !!r.canDisable, reason: String(r.reason || ''), requiresRestart: !!r.requiresRestart })) };
    const p = window.Vencord && Vencord.Settings && Vencord.Settings.plugins;
    if (!p) return null;
    const names = Object.keys(p).filter(n => p[n] && typeof p[n].enabled === 'boolean');
    // Vencord's own plugin table says which plugins are required and which need which, so the helper plugin is not needed
    // to know what is safe to turn off. Without that table nothing is known about dependencies.
    const defs = window.Vencord.Plugins && window.Vencord.Plugins.plugins;
    if (!defs || typeof defs !== 'object') return { via: 'settings', rows: names.map(n => ({ name: n, enabled: p[n].enabled, canDisable: null, reason: '', requiresRestart: true })) };
    const neededBy = {};
    for (const n of names) {
      if (!p[n].enabled) continue;
      const d = defs[n] && defs[n].dependencies;
      if (Array.isArray(d)) for (const dep of d) (neededBy[dep] = neededBy[dep] || []).push(n);
    }
    return { via: 'settings', deps: true, rows: names.map(n => {
      const def = defs[n];
      let canDisable = true, reason = '';
      if (!def) { canDisable = false; reason = 'it is not part of this Vencord build'; }
      else if (def.required) { canDisable = false; reason = 'Vencord needs it'; }
      else if (n.charAt(0) === '_') { canDisable = false; reason = 'it is one of Vencord\u2019s own parts'; }
      else if (neededBy[n] && neededBy[n].length) { canDisable = false; reason = 'these plugins need it: ' + neededBy[n].slice(0, 4).join(', '); }
      return { name: n, enabled: p[n].enabled, canDisable, reason, requiresRestart: true };
    }) };
  })()`,
  setCode(name, on) {
    return `((name, on) => {
      const api = window.VexPluginRam;
      if (api && typeof api.setEnabled === 'function') return api.setEnabled(name, on);
      const p = window.Vencord && Vencord.Settings && Vencord.Settings.plugins;
      if (!p || !p[name]) throw new Error('Vencord has no saved settings for ' + name);
      p[name].enabled = on;
      if (!!p[name].enabled !== on) throw new Error('Vencord did not keep the change for ' + name);
      return { name, enabled: !!p[name].enabled, requiresRestart: true };
    })(${JSON.stringify(String(name))}, ${on ? 'true' : 'false'})`;
  },
  async listPlugins() {
    const wv = DiscordMemory.webview();
    if (!wv) throw new Error('Discord is not loaded (asleep, or not opened yet), so there is nothing to measure');
    const got = await window.vexGuestEval(wv, this.LIST_CODE, false, 8000);
    if (!got) throw new Error('Vencord is not running in Discord, so it has no plugins to measure');
    const heavy = DiscordMemory.HEAVY_PLUGINS;
    // Without the plugin API nothing is known about dependencies: only the heavy plugins are offered.
    const known = got.via === 'api' || got.deps === true;
    const rows = got.rows.map(r => known ? r : { ...r, canDisable: heavy.includes(r.name), reason: heavy.includes(r.name) ? '' : 'install the Vencord build with the VexPluginRam plugin to test every plugin' });
    return { via: got.deps ? 'settings-deps' : got.via, rows };
  },
  async setPlugin(name, on) {
    const wv = DiscordMemory.webview();
    if (!wv) throw new Error('Discord is not loaded, so ' + name + ' cannot be switched');
    const r = await window.vexGuestEval(wv, this.setCode(name, on), false, 8000);
    if (!r || r.enabled !== on) throw new Error('Vencord did not keep ' + name + ' ' + (on ? 'on' : 'off'));
    return r;
  },
  async profilerRows() {
    const wv = DiscordMemory.webview();
    if (!wv || (typeof WebviewManager !== 'undefined' && typeof WebviewManager.scriptsOffIn === 'function' && WebviewManager.scriptsOffIn(wv))) return null;
    return window.vexGuestEval(wv, `(() => {
      const b = window.VexPluginProfiler;
      if (!b || typeof b.snapshot !== 'function') return null;
      return { seconds: typeof b.measuredFor === 'function' ? b.measuredFor() : 0, rows: b.snapshot().map(r => ({ name: String(r.name).slice(0, 64), totalMs: Math.round(r.totalMs || 0) })) };
    })()`, false, 5000);
  },
  // What the "Why is Discord big?" report needs: the last results and the old time scores. Reads the page, changes nothing.
  async reportData() {
    let profiler = null;
    try { profiler = await this.profilerRows(); } catch (err) { window.VexProblems?.note('Discord plugin RAM', 'The PluginProfiler scores could not be read', err); }
    this.last.profiler = profiler;
    return { fast: this.last.fast, slow: this.last.slow, profiler };
  },

  _wvId() {
    const wv = DiscordMemory.webview();
    if (!wv) throw new Error('Discord is not loaded (asleep, or not opened yet), so there is nothing to measure');
    let id;
    try { id = wv.getWebContentsId(); } catch (err) { throw new Error('Discord has no process yet: ' + err.message, { cause: err }); }
    return id;
  },
  _wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); },

  // ---- method 1: allocation attribution -----------------------------------------------------------------------------
  // say(text); isCancelled(): bool. Throws with the reason when it cannot or must not run.
  async measureFast({ windowSec = this.DEFAULT_WINDOW_S, say = () => {}, isCancelled = () => false, wait = (ms) => this._wait(ms), now = () => Date.now() } = {}) {
    if (!this.WINDOWS.includes(windowSec)) throw new Error('The window is one of ' + this.WINDOWS.join(', ') + ' seconds');
    if (!window.vex || typeof window.vex.discordHeapBegin !== 'function') throw new Error('This build of Vex cannot measure plugins');
    const why = await DiscordMemory.reasonToWait(Date.now(), { ignoreGap: true });
    if (why) throw new Error('Not measured: ' + why);
    const id = this._wvId();
    let names = [];
    const wv = DiscordMemory.webview();
    const got = await window.vexGuestEval(wv, this.LIST_CODE, false, 8000);
    let skipped = 0;
    if (got) {
      const all = got.rows.map(r => r.name);
      names = all.filter(n => this.NAME_OK.test(n)).slice(0, 600);
      skipped = all.length - names.length;
    }
    say('Starting the allocation window (' + windowSec + ' s). Discord pauses for a moment while memory is collected...' + (skipped ? ' (' + skipped + ' plugin' + VexPlural.s(skipped) + ' with an unusual name cannot be followed by name and count as Discord\u2019s.)' : ''));
    await window.vex.discordHeapBegin(id, names);
    const started = now();
    let abort = null;
    try {
      while (now() - started < windowSec * 1000) {
        await wait(Math.min(5000, windowSec * 1000));
        if (isCancelled()) { abort = 'Stopped'; break; }
        const w = await DiscordMemory.reasonToWait(Date.now(), { ignoreGap: true });
        if (w) { abort = 'Stopped: ' + w; break; }
        say('Sampling allocations... ' + Math.max(0, Math.round(windowSec - (now() - started) / 1000)) + ' s left');
      }
    } catch (err) {
      await this._endQuietly(id);
      throw err;
    }
    if (abort) { await this._endQuietly(id); throw new Error(abort + '. Nothing was kept.'); }
    say('The window is over. Collecting memory and reading the profile; this can take up to a minute...');
    let timer = null;
    const giveUp = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Discord did not hand over the profile in ' + Math.round(this.END_WAIT_MS / 1000) + ' seconds, so nothing was kept.')), this.END_WAIT_MS); });
    let r;
    try { r = await Promise.race([window.vex.discordHeapEnd(id, true), giveUp]); }
    catch (err) { await this._endQuietly(id); throw err; }
    finally { clearTimeout(timer); }
    this.last.fast = { ...r, at: Date.now(), windowSec };
    return this.last.fast;
  },
  async _endQuietly(id) {
    try { await window.vex.discordHeapEnd(id, false); }
    catch (err) {
      // Main closes the window itself when its end fails (a timeout, a page that went away): nothing left to end.
      if (/No Discord measurement is running/.test(String(err && err.message))) return;
      window.VexProblems?.note('Discord plugin RAM', 'The sampling window could not be closed cleanly (it ends by itself after six minutes)', err); }
  },

  // ---- method 2: one plugin at a time ------------------------------------------------------------------------------
  // deps: { setEnabled(name, on), reload(), sample() -> { heapMB, wsMB }, wait(ms), guard() -> reason | null,
  //         isCancelled(), persist(names), say(text) }. Every plugin it turned off is turned back on before it returns,
  // whatever happened; the returned state says what was measured and what went wrong.
  async runOneAtATime(deps, plan, cfg = {}) {
    const c = { settleMs: this.SETTLE_MS, samples: this.SAMPLES, gapMs: this.GAP_MS, maxInUseMs: this.MAX_IN_USE_MS, ...cfg };
    const st = { at: Date.now(), baselines: [], plugins: [], skipped: plan.skipped || [], partial: false, error: null, restoreError: null };
    const off = new Set();
    let pageHasPluginOff = false;
    const CANCEL = Symbol('cancelled');
    const check = () => { if (deps.isCancelled()) throw CANCEL; };
    const sleep = async (ms) => { let left = ms; while (left > 0) { const part = Math.min(left, 10000); await deps.wait(part); left -= part; check(); } };
    // Waits (checking for a cancel) until Discord is hidden and not in a call; gives up after maxInUseMs.
    const untilClear = async () => {
      let waited = 0;
      for (;;) {
        check();
        const why = await deps.guard();
        if (!why) return;
        deps.say('Waiting: ' + why);
        if (waited >= c.maxInUseMs) throw new Error('Stopped: ' + why + ' for too long');
        await deps.wait(c.gapMs); waited += c.gapMs;
      }
    };
    const step = async (label, offName) => {
      await untilClear();
      deps.say(label + ': reloading Discord...');
      await deps.reload();
      pageHasPluginOff = !!offName;
      deps.say(label + ': settling for ' + Math.round(c.settleMs / 60000) + ' minutes...');
      await sleep(c.settleMs);
      const heap = [], ws = [];
      for (let i = 0; i < c.samples; i++) {
        if (i) await sleep(c.gapMs);
        await untilClear();
        const s = await deps.sample();
        heap.push(s.heapMB); ws.push(s.wsMB);
        deps.say(label + ': reading ' + (i + 1) + ' of ' + c.samples + ' - heap ' + s.heapMB + ' MB, process ' + s.wsMB + ' MB');
      }
      return { heap, ws };
    };
    try {
      st.baselines.push(await step('Baseline (everything on)', null));
      let groupNo = 0;
      for (const unit of plan.chosen) {
        check();
        // A unit is one plugin, or (a group test) several that are turned off together.
        const members = Array.isArray(unit) ? unit : [unit];
        const name = Array.isArray(unit) ? this.groupLabel(unit, ++groupNo) : unit;
        // Every name is written down BEFORE any is switched, so a crash in between still leaves a record to put them back from.
        for (const m of members) off.add(m);
        deps.persist([...off]);
        for (const m of members) await deps.setEnabled(m, false);
        const r = await step(name + ' off', name);
        st.plugins.push({ name, ...(Array.isArray(unit) ? { members } : {}), ...r });
        for (const m of members) { await deps.setEnabled(m, true); off.delete(m); }
        deps.persist([...off]);
      }
      st.baselines.push(await step('Baseline again (everything on)', null));
    } catch (err) {
      if (err === CANCEL) st.partial = true;
      else { st.error = err; st.partial = true; }
    }
    for (const name of [...off]) {
      try { await deps.setEnabled(name, true); off.delete(name); }
      catch (err) { st.restoreError = err; }
    }
    deps.persist([...off]);                  // still non-empty only if a switch back failed: the next start tries again
    if (pageHasPluginOff && !off.size) {
      try { await deps.reload(); } catch (err) { st.reloadError = err; }
    }
    return st;
  },

  // The real dependencies of a run in Vex.
  realDeps(run, extra = {}) {
    return {
      setEnabled: (name, on) => this.setPlugin(name, on),
      reload: async () => {
        DiscordMemory.refresh(null);
        const t0 = Date.now();
        // The new page is ready when Vencord has loaded in it.
        for (;;) {
          await this._wait(3000);
          if (Date.now() - t0 > this.READY_MS) throw new Error('Discord did not finish loading after the reload');
          try {
            const wv = DiscordMemory.webview();
            if (wv && await window.vexGuestEval(wv, '!!(window.Vencord && Vencord.Settings && Vencord.Plugins)', false, 4000)) return;
          } catch (err) { /* vex-allow-empty-catch: the new page is not ready to answer yet, which is why this loop waits */ void err; }
        }
      },
      sample: async () => {
        const id = this._wvId();
        const u = await window.vex.discordHeapUsage(id);
        const wsMB = await DiscordMemory.sizeMB();
        if (wsMB == null) throw new Error('Discord’s process memory could not be read');
        return { heapMB: u.usedMB, wsMB };
      },
      wait: (ms) => this._wait(ms),
      guard: () => DiscordMemory.reasonToWait(Date.now(), { ignoreGap: true }),
      isCancelled: () => !!run.cancelled,
      persist: (names) => DiscordMemory._saveCare({ pluginPending: names }),
      say: (t) => run.say(t),
      ...extra,
    };
  },

  // The dialog flow, called by DiscordMeasure.open({ plugins: true }) with its run object (overlay, say, results, show, cancelled).
  async runFromDialog(run, body, measure) {
    if (this._busy) throw new Error('A plugin memory measurement is already running');
    if (!window.vex || typeof window.vex.discordHeapUsage !== 'function') throw new Error('This build of Vex cannot measure plugins');
    const why = await DiscordMemory.reasonToWait(Date.now(), { ignoreGap: true });
    if (why) throw new Error('Not started: ' + why);
    const { via, rows } = await this.listPlugins();
    const heavy = DiscordMemory.HEAVY_PLUGINS;
    const full = this.planOrder(rows, { heavy, max: this.MAX_LIMIT });
    if (!full.ordered.length) throw new Error('No plugin can be tested: ' + (via === 'settings' ? 'none of the heavy plugins is on, and the VexPluginRam plugin is not installed' : 'none is both on and allowed to be turned off'));
    // The picker: heavy ones first and ticked, up to the cap; the person can tick others or untick these.
    const choice = await this._pick(run, body, full, via);
    if (!choice) { run.say('Cancelled before anything was changed.'); return null; }
    const grouped = choice.mode === 'groups';
    const units = grouped ? this.planGroups(choice.names, { heavy, size: choice.size || this.GROUP_SIZE }).slice(0, this.MAX_UNITS) : choice.names;
    const plan = { chosen: units, skipped: full.skipped };
    const minutes = this.estimateMinutes(units.length);
    const members = units.reduce((n, u) => n + (Array.isArray(u) ? u.length : 1), 0);
    const what = units.slice(0, 4).map(u => Array.isArray(u) ? u.length + ' plugins' : u).join(', ') + (units.length > 4 ? ', ...' : '');
    const ok = await measure._confirm({ title: grouped ? 'Measure plugin memory in groups' : 'Measure plugin memory one at a time', okLabel: 'Start',
      message: 'This takes about ' + minutes + ' minutes (' + (units.length + 2) + ' fresh Discord pages, hidden; it stays signed in). ' + (grouped ? members + ' plugins in ' + units.length + ' steps (' + what + '): each step turns its plugins off together in Vencord, ' : 'For each of ' + units.length + ' plugin' + VexPlural.s(units.length) + ' (' + what + ') it is turned off in Vencord, ') + 'Discord reloads, and its memory is read after 3 minutes; then they are turned back on. Every plugin is put back when it ends, when you close this window, on an error, and at the next start of Vex. Do not use Discord meanwhile; a call pauses it.' });
    if (!ok) { run.say('Cancelled before anything was changed.'); return null; }
    this._busy = true;
    try {
      const st = await this.runOneAtATime(this.realDeps(run), plan);
      this.last.slow = st;
      // The members of any group that made a difference are ticked for the next, one-at-a-time, run.
      this._suggest = this.summarize(st).rows.filter(r => r.members && ((r.wsSig && r.wsDelta > 0) || (r.heapSig && r.heapDelta > 0))).flatMap(r => r.members);
      run.results.push(this.sectionText({ fast: null, slow: st }, null));
      if (st.restoreError) {
        window.VexProblems?.note('Discord plugin RAM', 'A plugin could not be turned back on; Vex will try again at its next start', st.restoreError);
        window.showToast?.('A plugin could not be turned back on: ' + st.restoreError.message + '. Vex will try again at its next start.', 'error');
      }
      if (st.error) throw st.error;
      run.say(st.partial ? 'Stopped. Every plugin was put back.' : 'Done. Every plugin is back on.');
      return st;
    } finally { this._busy = false; }
  },

  // The picker inside the open dialog; resolves with the chosen names, or null (cancelled / window closed).
  _pick(run, body, full, via) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      const intro = VexSettingsGroups.note('Pick the plugins to test (the known heavy ones first). ' + (via === 'settings' ? 'Only the heavy plugins are offered because the VexPluginRam plugin is not installed in this Vencord. ' : via === 'settings-deps' ? 'Every plugin that is on, that Vencord does not require and that no other plugin needs is offered (read from Vencord itself). ' : '') + 'Up to ' + this.MAX_LIMIT + ' per session; each takes about ' + Math.round((this.RELOAD_MS + this.SETTLE_MS + (this.SAMPLES - 1) * this.GAP_MS) / 60000) + ' minutes.');
      wrap.appendChild(intro);
      // How to test: the ticked plugins one by one, or in groups (much faster: most plugins cost nothing).
      const suggested = Array.isArray(this._suggest) && this._suggest.length ? this._suggest.slice() : null;
      const how = document.createElement('select');
      how.setAttribute('aria-label', 'How to test');
      for (const [v, t] of [['one', 'One at a time: the ticked plugins (about 5 minutes each)'], ['groups', 'In groups: every ticked plugin, the known heavy ones alone (much faster)']]) {
        const o = document.createElement('option'); o.value = v; o.textContent = t; how.appendChild(o);
      }
      wrap.appendChild(how);
      // How many plugins go off together in one step. Smaller groups narrow a group that made a difference down.
      const sizeSel = document.createElement('select');
      sizeSel.setAttribute('aria-label', 'Group size');
      for (const n of this.GROUP_SIZES) {
        const o = document.createElement('option');
        o.value = String(n);
        o.textContent = 'Groups of ' + n + (n === this.GROUP_SIZE ? ' (to find the costly ones)' : n === 4 ? ' (to narrow a group of 8 down)' : ' (to narrow a group of 4 down)');
        sizeSel.appendChild(o);
      }
      sizeSel.value = String(suggested ? 4 : this.GROUP_SIZE);
      wrap.appendChild(sizeSel);
      const showSize = () => { sizeSel.style.display = how.value === 'groups' ? '' : 'none'; };
      if (suggested) {
        how.value = 'groups';
        wrap.appendChild(VexSettingsGroups.note('The members of the groups that made a difference last time are ticked, to be tested in smaller groups (halving a group of 8 takes 2 steps). Choose "One at a time" to test each member alone.'));
      }
      showSize();
      const boxes = [];
      full.ordered.forEach((name, i) => {
        const label = document.createElement('label');
        label.style.display = 'block';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = suggested ? suggested.includes(name) : i < this.MAX_DEFAULT; cb.value = name;
        label.append(cb, document.createTextNode(' ' + name));
        wrap.appendChild(label);
        boxes.push(cb);
      });
      const est = VexSettingsGroups.note('');
      const upd = () => {
        const ticked = boxes.filter(b => b.checked).map(b => b.value);
        const grouped = how.value === 'groups';
        const units = grouped ? Math.min(this.MAX_UNITS, this.planGroups(ticked, { heavy: DiscordMemory.HEAVY_PLUGINS, size: Number(sizeSel.value) }).length) : ticked.length;
        est.textContent = ticked.length + ' selected' + (grouped ? ' in ' + units + ' steps' : '') + ', about ' + this.estimateMinutes(units) + ' minutes in all (' + (units + 2) + ' page loads of ' + Math.round((this.RELOAD_MS + this.SETTLE_MS + (this.SAMPLES - 1) * this.GAP_MS) / 60000) + ' minutes each).';
      };
      how.addEventListener('change', () => {
        // Groups: everything is ticked, or just the leads when arriving from a group result. One at a time: the usual few.
        boxes.forEach((b, i) => { b.checked = how.value === 'groups' ? (suggested ? suggested.includes(b.value) : true) : (suggested ? suggested.includes(b.value) : i < this.MAX_DEFAULT); });
        showSize();
        upd();
      });
      sizeSel.addEventListener('change', upd);
      boxes.forEach(b => b.addEventListener('change', () => { if (how.value !== 'groups' && boxes.filter(x => x.checked).length > this.MAX_LIMIT) b.checked = false; upd(); }));
      upd();
      wrap.appendChild(est);
      let poll = null;
      const go = VexSettingsGroups.button('Continue', () => {
        const names = boxes.filter(b => b.checked).map(b => b.value);
        if (poll) poll.disconnect();
        wrap.remove();
        this._suggest = null;
        resolve(names.length ? { mode: how.value, names, size: Number(sizeSel.value) } : null);
      }, { primary: true });
      wrap.appendChild(go);
      body.prepend(wrap);
      // Closing the window or pressing Stop before choosing is a no.
      poll = new MutationObserver(() => { if (!run.overlay.isConnected || run.cancelled) { poll.disconnect(); resolve(null); } });
      poll.observe(document.body, { childList: true });
    });
  },

  // ---- put back what an interrupted test turned off ----------------------------------------------------------------
  // Called at start. The plugin choice lives in the Discord page's Vencord settings, so it can only be put back once
  // that page exists: a job tries every 20 seconds until it has, then stops itself.
  watchPending() {
    let names = [];
    try { names = DiscordMemory.care().pluginPending; }
    catch (err) { window.VexProblems?.note('Discord plugin RAM', 'The pending plugin restore could not be read', err); return false; }
    if (!names.length || this._restoreJob) return false;
    if (typeof VexJobs === 'undefined') throw new Error('VexJobs is not loaded, so the plugins turned off by an unfinished test cannot be put back');
    let lastNote = '';
    this._restoreJob = VexJobs.every(this.RESTORE_JOB, 20000, async () => {
      try {
        const done = await this.restorePending();
        if (done) { this._restoreJob.stop(); this._restoreJob = null; }
      } catch (err) {
        if (String(err.message) !== lastNote) { lastNote = String(err.message); window.VexProblems?.note('Discord plugin RAM', 'Plugins turned off by an unfinished test could not be put back yet', err); }
      }
    }, { when: 'background', feature: this.FEATURE });
    return true;
  },
  // True when nothing is left to put back. False when Discord is not loaded yet (try again later). Throws on a real failure.
  async restorePending() {
    const names = DiscordMemory.care().pluginPending;
    if (!names.length) return true;
    if (!DiscordMemory.webview()) return false;
    for (const name of names) await this.setPlugin(name, true);
    DiscordMemory._saveCare({ pluginPending: [] });
    window.showToast?.('Vencord plugins left off by an unfinished measurement are back on: ' + names.join(', '));
    const wait = await DiscordMemory.reasonToWait(Date.now(), { ignoreGap: true });
    if (!wait) DiscordMemory.refresh(null);
    else window.showToast?.('Reload Discord to use them again (' + wait + ' now)');
    return true;
  },

  // ---- the "Measure plugin memory" window --------------------------------------------------------------------------
  async openFast() {
    if (typeof VexSettingsGroups === 'undefined') throw new Error('The measuring window is not loaded');
    if (this._busy) throw new Error('A plugin memory measurement is already running');
    if (!(await DiscordMemory.ensureLoaded())) return;           // asleep: offered to load it in the background; a no ends here
    const { overlay, body } = VexSettingsGroups.dialog({ id: 'vex-discord-plugin-ram', title: 'Plugin memory', sub: 'Memory numbers only, on this computer. Discord must be hidden and not in a call.' });
    // While this window is open Discord is kept as it is (js/discord-memory.js measurementHold): it must not sleep or
    // refresh between opening the window and pressing Start, or during the run.
    this._windowOpen = true;
    const gone = new MutationObserver(() => { if (!overlay.isConnected) { this._windowOpen = false; gone.disconnect(); } });
    gone.observe(document.body, { childList: true });
    const status = VexSettingsGroups.note('Choose how long to watch Discord, then press Start. Use Discord normally in the background if you like: only memory that stays allocated is counted.');
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', 'Length of the allocation window');
    for (const s of this.WINDOWS) { const o = document.createElement('option'); o.value = String(s); o.textContent = s + ' seconds'; if (s === this.DEFAULT_WINDOW_S) o.selected = true; sel.appendChild(o); }
    const pre = document.createElement('pre');
    pre.className = 'vex-platform-note';
    pre.style.whiteSpace = 'pre-wrap';
    let cancelled = false;
    const show = async () => { const data = await this.reportData(); pre.textContent = this.sectionText({ fast: data.fast, slow: data.slow }, data.profiler); };
    const start = VexSettingsGroups.button('Start', async () => {
      start.disabled = true;
      this._busy = true;
      try {
        await this.measureFast({ windowSec: Number(sel.value), say: (t) => { status.textContent = t; }, isCancelled: () => cancelled || !overlay.isConnected });
        status.textContent = 'Done.';
        await show();
      } catch (err) {
        status.textContent = err.message;
        window.VexProblems?.note('Discord plugin RAM', 'The allocation measurement stopped', err);
      } finally { this._busy = false; start.disabled = false; }
    }, { primary: true });
    const stop = VexSettingsGroups.button('Stop', () => { cancelled = true; status.textContent = 'Stopping...'; });
    const one = VexSettingsGroups.button('One at a time...', () => {
      if (typeof DiscordMeasure === 'undefined') { window.showToast?.('The measuring tool is not loaded', 'error'); return; }
      overlay.remove();
      DiscordMeasure.open({ plugins: true }).catch(err => window.showToast?.(err.message, 'error'));
    });
    const copy = VexSettingsGroups.button('Copy', async () => {
      try { await navigator.clipboard.writeText(pre.textContent); window.showToast?.('Copied'); }
      catch (err) { window.showToast?.('Could not copy: ' + err.message, 'error'); }
    });
    body.append(status, sel, start, stop, one, copy, pre);
    await show();
    return true;
  },
};

if (typeof window !== 'undefined') window.DiscordPluginRam = DiscordPluginRam;
if (typeof module !== 'undefined' && module.exports) module.exports = { DiscordPluginRam };
