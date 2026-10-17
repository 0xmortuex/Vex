// === Measure Discord over ten minutes =========================================
//
// The owner measured the Discord panel at about 1.6 GB against about 750 MB in the real Discord app, which has
// no Vencord. A report of settings (discord-memory.js, "Why is Discord big?") cannot say which part is which;
// a measurement can. Two modes, both opened from Settings > Performance:
//
//   Measure over 10 minutes        samples the Discord process's working set and its JS heap every 30 seconds
//                                  WHILE DISCORD IS HIDDEN (a sample taken while it is open, or in a call, is
//                                  skipped), then shows the trend. Changes nothing. Ends by itself.
//   Measure with Vencord, then     reloads Discord (hidden, signed in) and samples 10 minutes with Vencord, then,
//   without                        after a second question, turns the Vencord extension off, reloads Discord and
//                                  samples 10 minutes again, then turns Vencord back on. Both are FRESH pages
//                                  measured the same way after the same 3 minute settling, so the age of the page is
//                                  not part of the difference. Vencord is turned back on when it ends, when the
//                                  window is closed, and (if Vex was closed in the middle) at the next start.
//
// Memory only: no content, nothing is sent. The sampling is a VexJobs job that stops itself.
const DiscordMeasure = {
  FEATURE: 'discord-memory-care',
  JOB: 'Discord measure',
  SAMPLE_MS: 30000,
  SETTLE_MIN: 3,
  MINUTES: 10,
  _run: null,

  // ---- one sample ---------------------------------------------------------------
  async sample() {
    const mb = await DiscordMemory.sizeMB();
    let heapMB = null;
    const wv = DiscordMemory.webview();
    if (wv && typeof window.vexGuestEval === 'function') {
      const scriptsOff = typeof WebviewManager !== 'undefined' && typeof WebviewManager.scriptsOffIn === 'function' && WebviewManager.scriptsOffIn(wv);
      if (!scriptsOff) {
        const h = await window.vexGuestEval(wv, '(() => { const m = performance.memory; return m ? m.usedJSHeapSize : null; })()', false, 5000);
        if (typeof h === 'number') heapMB = Math.round(h / 1048576);
      }
    }
    if (mb == null) throw new Error('Discord’s memory could not be read (is it loaded?)');
    return { at: Date.now(), wsMB: mb, heapMB };
  },

  // ---- pure: the numbers and the words --------------------------------------------
  stats(samples, key) {
    const v = samples.map(s => s[key]).filter(n => typeof n === 'number');
    if (!v.length) return null;
    const mean = Math.round(v.reduce((a, b) => a + b, 0) / v.length);
    return { n: v.length, first: v[0], last: v[v.length - 1], delta: v[v.length - 1] - v[0], min: Math.min(...v), max: Math.max(...v), mean };
  },
  _size(mb) { return mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : mb + ' MB'; },
  _sign(n) { return (n >= 0 ? '+' : '-') + Math.abs(n); },
  trendText(label, samples) {
    const ws = this.stats(samples, 'wsMB');
    if (!ws) return label + ': no sample could be taken (Discord was open, in a call, or not loaded the whole time).';
    const hp = this.stats(samples, 'heapMB');
    const t0 = samples[0].at;
    const out = [label + ' - ' + ws.n + ' samples over ' + Math.max(1, Math.round((samples[samples.length - 1].at - t0) / 60000)) + ' minutes'];
    out.push('  Process memory: ' + ws.first + ' -> ' + ws.last + ' MB (' + this._sign(ws.delta) + '), range ' + ws.min + '-' + ws.max + ', average ' + ws.mean + ' MB.');
    if (hp) out.push('  JavaScript heap in use: ' + hp.first + ' -> ' + hp.last + ' MB (' + this._sign(hp.delta) + '), range ' + hp.min + '-' + hp.max + ', average ' + hp.mean + ' MB.');
    else out.push('  JavaScript heap: could not be read.');
    out.push('  Trend (process memory):');
    const step = Math.max(1, Math.ceil(samples.length / 10));
    for (let i = 0; i < samples.length; i += step) {
      const s = samples[i];
      const m = Math.floor((s.at - t0) / 60000), sec = Math.round(((s.at - t0) % 60000) / 1000);
      const bar = '#'.repeat(Math.max(1, Math.round((s.wsMB / Math.max(1, ws.max)) * 30)));
      out.push('    ' + m + ':' + String(sec).padStart(2, '0') + '  ' + String(s.wsMB).padStart(5) + ' MB  ' + bar);
    }
    out.push('  ' + this._verdict(ws));
    return out.join('\n');
  },
  _verdict(ws) {
    if (ws.delta > Math.max(50, ws.first * 0.05)) return 'It grew while hidden: something in the page keeps allocating.';
    if (ws.delta < -Math.max(50, ws.first * 0.05)) return 'It shrank while hidden: the page released memory (idle mode or the garbage collector).';
    return 'It stayed flat while hidden: the size is what the page holds, not a leak in these minutes.';
  },
  compare(withV, without) {
    const a = this.stats(withV, 'wsMB'), b = this.stats(without, 'wsMB');
    if (!a || !b) return 'The two runs cannot be compared: one of them has no sample.';
    const ha = this.stats(withV, 'heapMB'), hb = this.stats(without, 'heapMB');
    const out = ['Difference (with Vencord minus without), by the average of each run:'];
    const d = a.mean - b.mean;
    out.push('  Process memory: ' + a.mean + ' MB with, ' + b.mean + ' MB without = ' + this._sign(d) + ' MB' + (b.mean ? ' (' + Math.round((d / b.mean) * 100) + '% of the Vencord-free size)' : '') + '.');
    if (ha && hb) out.push('  JavaScript heap: ' + ha.mean + ' MB with, ' + hb.mean + ' MB without = ' + this._sign(ha.mean - hb.mean) + ' MB.');
    out.push('  Both were fresh Discord pages measured the same way, so this is Vencord and its plugins, not page age. A page that has run all day is bigger than either: that growth is what the memory limit and refresh are for.');
    out.push('  For the real Discord app’s ~750 MB, compare the "without" figure here: whatever remains above it is Discord in a Vex panel (Vex’s own scripts, the other extensions loaded into this session, the visibility disguise).');
    return out.join('\n');
  },

  // ---- running -----------------------------------------------------------------------
  _wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); },

  // Collects for `minutes`; `keep` false = settling (samples are not kept). Skips a sample when Discord is
  // open, in a call, or using the microphone/camera. Ends by itself; a run that never gets to be hidden gives up
  // after twice the time.
  _phase(run, { label, minutes, keep }) {
    return new Promise((resolve, reject) => {
      const want = Math.ceil((minutes * 60000) / this.SAMPLE_MS);
      const t0 = Date.now();
      let got = 0, skipped = 0, busy = false, done = false;
      const samples = [];
      const handle = { stop: () => {} };
      const finish = (err) => {
        if (done) return;
        done = true;
        handle.stop();
        if (err) reject(err); else resolve(samples);
      };
      const tick = async () => {
        if (done || busy) return;
        busy = true;
        try {
          if (run.cancelled) { finish(); return; }
          if (!run.overlay.isConnected) { run.cancelled = true; finish(); return; }
          const why = await DiscordMemory.reasonToWait(Date.now(), { ignoreGap: true });
          if (why) { skipped++; run.say(label + ': skipped a sample (' + why + ')'); }
          else {
            const s = await this.sample();
            got++;
            if (keep) samples.push(s);
            run.say(label + ': sample ' + got + ' of ' + want + ' - ' + s.wsMB + ' MB' + (s.heapMB != null ? ', heap ' + s.heapMB + ' MB' : ''));
          }
          if (got >= want || Date.now() - t0 > minutes * 120000) finish();
        } catch (err) { finish(err); }
        finally { busy = false; }
      };
      const job = VexJobs.every(this.JOB, this.SAMPLE_MS, tick, { when: 'background', feature: this.FEATURE });
      handle.stop = () => job.stop();
      tick();
    });
  },

  async _confirm(o) {
    if (typeof window.vexConfirm !== 'function') throw new Error('The confirm dialog is not loaded');
    return window.vexConfirm(o);
  },

  // The A/B. Vencord is turned back on whatever happens.
  async _runAB(run) {
    const v = await DiscordMemory.vencordState();
    if (!v.installed || !v.enabled) throw new Error('Vencord has to be installed and on to compare with and without it');
    const first = await this._confirm({ title: 'Measure with Vencord, then without', okLabel: 'Start',
      message: 'This takes about 27 minutes and reloads Discord twice (hidden; it stays signed in). First 10 minutes with Vencord, then I ask again before turning Vencord off for the next 10. Vencord is turned back on at the end, even if you close this window. Do not use Discord during the measurement; a call pauses it.' });
    if (!first) { run.say('Cancelled before anything was changed.'); return null; }
    const wait = await DiscordMemory.reasonToWait(Date.now(), { ignoreGap: true });
    if (wait) throw new Error('Not started: ' + wait);
    const before = await DiscordMemory.sizeMB();
    DiscordMemory.refresh(before);
    run.say('Reloaded Discord with Vencord; letting it settle for ' + this.SETTLE_MIN + ' minutes...');
    await this._phase(run, { label: 'Settling (with Vencord)', minutes: this.SETTLE_MIN, keep: false });
    if (run.cancelled) return null;
    const withV = await this._phase(run, { label: 'With Vencord', minutes: this.MINUTES, keep: true });
    run.results.push(this.trendText('With Vencord (a fresh Discord page' + (before ? '; before this test it was ' + this._size(before) : '') + ')', withV));
    run.show();
    if (run.cancelled) return null;
    const second = await this._confirm({ title: 'Turn Vencord off for 10 minutes?', okLabel: 'Turn it off',
      message: 'Vencord, its plugins and themes will be off in Discord until the measurement ends (about 13 minutes). Discord is reloaded without it. It is turned back on by itself.' });
    if (!second) { run.say('Stopped before turning Vencord off.'); return null; }
    DiscordMemory._saveCare({ abPending: v.folder });
    run.vencordOff = v.folder;
    await DiscordMemory.setVencord(false);
    run.say('Vencord is off; Discord reloaded. Settling for ' + this.SETTLE_MIN + ' minutes...');
    await this._phase(run, { label: 'Settling (without Vencord)', minutes: this.SETTLE_MIN, keep: false });
    if (run.cancelled) return null;
    const without = await this._phase(run, { label: 'Without Vencord', minutes: this.MINUTES, keep: true });
    run.results.push(this.trendText('Without Vencord (a fresh Discord page)', without));
    run.results.push(this.compare(withV, without));
    return true;
  },

  async _restoreVencord(run) {
    if (!run.vencordOff) return;
    try {
      const s = await DiscordMemory.vencordState();
      if (!s.enabled) await DiscordMemory.setVencord(true);
      DiscordMemory._saveCare({ abPending: '' });
      run.vencordOff = null;
      run.say('Vencord is back on and Discord has been reloaded with it.');
    } catch (err) {
      // Left pending on purpose: the next start of Vex tries again.
      window.VexProblems?.note('Discord measure', 'Vencord could not be turned back on; Vex will try again at its next start', err);
      window.showToast?.('Vencord could not be turned back on: ' + err.message + '. Turn it on in Settings > Extensions.', 'error');
    }
  },

  async open({ ab = false } = {}) {
    if (typeof VexSettingsGroups === 'undefined') throw new Error('The measuring window is not loaded');
    if (this._run && !this._run.finished) throw new Error('A measurement is already running');
    if (!DiscordMemory.webview()) throw new Error('Discord is not loaded (asleep, or not opened yet), so there is nothing to measure');
    const { overlay, body } = VexSettingsGroups.dialog({ id: 'vex-discord-measure', title: ab ? 'Measure Discord with and without Vencord' : 'Measure Discord for 10 minutes',
      sub: 'Memory only, on this computer. Samples every 30 seconds while Discord is hidden. Closing this window stops it' + (ab ? ' and turns Vencord back on.' : '.') });
    const status = VexSettingsGroups.note('Starting...');
    const pre = document.createElement('pre');
    pre.className = 'vex-platform-note';
    pre.style.whiteSpace = 'pre-wrap';
    const run = { overlay, cancelled: false, finished: false, results: [], vencordOff: null,
      say: (t) => { status.textContent = t; },
      show: () => { pre.textContent = run.results.join('\n\n'); } };
    this._run = run;
    body.append(status, pre);
    body.appendChild(VexSettingsGroups.button('Stop', () => { run.cancelled = true; status.textContent = 'Stopping...'; }));
    body.appendChild(VexSettingsGroups.button('Copy result', async () => {
      try { await navigator.clipboard.writeText(pre.textContent); window.showToast?.('Result copied'); }
      catch (err) { window.showToast?.('Could not copy: ' + err.message, 'error'); }
    }));
    // Closing the window is a Stop: the job ends, and Vencord comes back.
    const watcher = new MutationObserver(() => { if (!overlay.isConnected) { run.cancelled = true; watcher.disconnect(); } });
    watcher.observe(document.body, { childList: true });
    try {
      if (ab) {
        const ok = await this._runAB(run);
        if (ok) run.say('Done. Vencord is back on.');
      } else {
        const wait = await DiscordMemory.reasonToWait(Date.now(), { ignoreGap: true });
        if (wait && /call|microphone|camera/i.test(wait)) throw new Error('Not started: ' + wait);
        const samples = await this._phase(run, { label: 'Measuring', minutes: this.MINUTES, keep: true });
        run.results.push(this.trendText('Discord, now (a page that has been running for a while)', samples));
        run.say(run.cancelled ? 'Stopped.' : 'Done.');
      }
    } catch (err) {
      run.say('Stopped: ' + err.message);
      window.VexProblems?.note('Discord measure', 'The measurement stopped', err);
    } finally {
      watcher.disconnect();
      await this._restoreVencord(run);
      run.finished = true;
      run.show();
    }
    return run.results;
  },
};

if (typeof window !== 'undefined') window.DiscordMeasure = DiscordMeasure;
if (typeof module !== 'undefined' && module.exports) module.exports = { DiscordMeasure };
