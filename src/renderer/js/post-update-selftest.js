// === Check after an update ====================================================
//
// On the first start of a new version Vex looks at itself once, a little after
// the window is up, and says so only if something is wrong:
//
//   - features that failed to start: every place in Vex that starts a feature
//     and catches the failure notes "Could not start" in the problem list
//     (js/problems.js); those of THIS version are counted here, by feature.
//     They are not running, which is what "they are off" means. Nothing is
//     switched off or changed by this check.
//   - the health check (Settings › Health check, src/main/health-check.js),
//     scanned only: it repairs nothing.
//   - crash kinds that are new in this version: kinds recorded in crash-log.json
//     under this version that no earlier version has (app:diagnostics).
//
// When something is wrong a card names it, with three one-click ways on: a
// problem report (js/report-problem.js: shown in full, edited by you, sent
// nowhere until you press Open on GitHub), the settings from before the update
// (js/update-safety-net.js), and the Health check. A quiet result is saved and
// shown in Settings › Update self-test, and there is no toast for it.
//
// It never runs an installer or an updater, and it runs once per version.
const VexSelfTest = {
  VERSION_KEY: 'vex.selfTest.version',
  LAST_KEY: 'vex.selfTest.last',
  ENABLED_KEY: 'vex.selfTest.enabled',
  DELAY_MS: 20000,
  // "Could not start", "did not start", "failed to start": how the start-up
  // sites word it (app.js, VexProblems.note(area, 'Could not start', err)).
  START_FAILURE: /\b(?:could not|couldn't|did not|didn't|failed to|unable to)\s+(?:start|initiali[sz]e)\b/i,

  enabled() {
    try { return localStorage.getItem(this.ENABLED_KEY) !== '0'; } catch { return true; }
  },
  setEnabled(on) {
    localStorage.setItem(this.ENABLED_KEY, on ? '1' : '0');
  },

  // The features of this version that failed to start, one row each:
  // [{ area, detail, n }]. `problems` is VexProblems.current() by default.
  startFailures(problems) {
    const list = problems || (typeof VexProblems !== 'undefined' ? VexProblems.current() : []);
    const byArea = new Map();
    for (const p of list) {
      if (!p || !this.START_FAILURE.test(String(p.message || ''))) continue;
      const area = String(p.area || 'Vex');
      const seen = byArea.get(area);
      if (seen) seen.n += p.n || 1;
      else byArea.set(area, { area, detail: String(p.detail || ''), n: p.n || 1 });
    }
    return [...byArea.values()].sort((a, b) => a.area.localeCompare(b.area));
  },

  // What a scan found that is worth a line: errors only (warnings are Health's own business).
  healthErrors(scan) {
    if (!scan || !Array.isArray(scan.findings)) return [];
    return scan.findings.filter(f => f && f.severity === 'error').map(f => ({ id: String(f.id), title: String(f.title || f.id) }));
  },

  // One sentence per kind of trouble; empty when all is well.
  lines(result) {
    const out = [];
    const n = result.failed.length;
    if (n) out.push(n + (n === 1 ? ' feature' : ' features') + ' failed to start; ' + (n === 1 ? 'it is' : 'they are') + ' off: ' + result.failed.map(f => f.area).join(', ') + '.');
    if (result.health.length) out.push('The health check found ' + result.health.length + (result.health.length === 1 ? ' problem' : ' problems') + ': ' + result.health.map(h => h.title).slice(0, 3).join('; ') + '.');
    if (result.crashKinds.length) out.push('New since the last version, crashes of a kind not seen before: ' + result.crashKinds.map(k => k.kind + (k.n > 1 ? ' (x' + k.n + ')' : '')).join(', ') + '.');
    return out;
  },

  // The check itself. -> the result { version, at, failed, health, crashKinds, errors, ok }.
  // A part that could not be read is in `errors` (and noted as a problem), not skipped.
  async check() {
    const vex = window.vex || {};
    const version = String(await vex.getAppVersion());
    const result = { version, at: Date.now(), failed: this.startFailures(), health: [], crashKinds: [], errors: [] };
    try {
      if (!vex.health || typeof vex.health.scan !== 'function') throw new Error('The health check is not available in this window');
      const scan = await vex.health.scan();
      if (!scan || !scan.ok) throw new Error((scan && scan.error) || 'The health check did not answer');
      result.health = this.healthErrors(scan);
    } catch (err) {
      result.errors.push('Health check: ' + err.message);
      if (typeof VexProblems !== 'undefined') VexProblems.note('Update self-test', 'The health check could not be run', err);
    }
    try {
      if (typeof vex.diagnostics !== 'function') throw new Error('Diagnostics are not available in this window');
      const d = await vex.diagnostics();
      result.crashKinds = Array.isArray(d && d.crashKindsNew) ? d.crashKindsNew.map(k => ({ kind: String(k.kind), n: Number(k.n) || 1 })) : [];
    } catch (err) {
      result.errors.push('Crash kinds: ' + err.message);
      if (typeof VexProblems !== 'undefined') VexProblems.note('Update self-test', 'The crash record could not be read', err);
    }
    result.ok = !result.failed.length && !result.health.length && !result.crashKinds.length;
    return result;
  },

  last() {
    try { return JSON.parse(localStorage.getItem(this.LAST_KEY) || 'null'); } catch { return null; }
  },

  // Once per version, after start-up. -> the result, or null when it was not due.
  async maybeRun() {
    if (!this.enabled()) return null;
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return null;
    if (!window.vex || typeof window.vex.getAppVersion !== 'function') return null;
    const version = String(await window.vex.getAppVersion());
    if (localStorage.getItem(this.VERSION_KEY) === version) return null;
    const result = await this.check();
    // Saved before anything is shown, so a card that fails to draw does not
    // bring the check back at every start.
    localStorage.setItem(this.VERSION_KEY, version);
    localStorage.setItem(this.LAST_KEY, JSON.stringify(result));
    if (!result.ok) this.announce(result);
    return result;
  },

  announce(result) {
    const lines = this.lines(result);
    if (!lines.length) return false;
    if (typeof VexAttention !== 'undefined' && !VexAttention.gate('update-self-test', result.version)) return false;
    window.showToast?.(lines[0], 'error', 12000, {
      action: { label: 'See what failed', title: 'What the check after the update found, and what to do', run: () => this.open(result) },
    });
    return true;
  },

  open(result) {
    const r = result || this.last();
    const dlg = VexSettingsGroups.dialog({
      id: 'vex-selftest-dialog',
      title: 'After the update',
      sub: 'Vex looked at itself on the first start of ' + (r ? r.version : 'this version') + '. Nothing was changed.',
    });
    const { body } = dlg;
    if (!r) { body.appendChild(VexSettingsGroups.note('The check has not run yet. It runs once, on the first start of each version.')); return dlg; }
    const lines = this.lines(r);
    if (!lines.length) body.appendChild(VexSettingsGroups.note('All good: every feature started, the health check is clean, and there are no new kinds of crash.'));
    for (const l of lines) body.appendChild(VexSettingsGroups.note(l));
    for (const e of r.errors) body.appendChild(VexSettingsGroups.note('Could not check: ' + e));
    if (r.failed.length) {
      const detail = r.failed.map(f => f.area + (f.detail ? ' — ' + f.detail : '')).join('\n');
      body.appendChild(VexSettingsGroups.note(detail));
    }
    const actions = document.createElement('div');
    actions.className = 'vexsr-actions';
    if (typeof VexReport !== 'undefined') {
      actions.appendChild(VexSettingsGroups.button('Report this problem', () => {
        VexReport.open().catch(err => window.showToast?.(err.message || String(err), 'error', 6000));
      }, { primary: true }));
    }
    if (typeof VexUpdateSafetyNet !== 'undefined') {
      actions.appendChild(VexSettingsGroups.button('Go back to the settings from before the update', () => { dlg.close(); VexUpdateSafetyNet.open(); }));
    }
    if (typeof VexHealth !== 'undefined') {
      actions.appendChild(VexSettingsGroups.button('Open the health check', () => { dlg.close(); VexHealth.open(); }));
    }
    body.appendChild(actions);
    return dlg;
  },

  group(el) {
    const r = this.last();
    el.appendChild(VexSettingsGroups.note(r
      ? 'Last check: Vex ' + r.version + ', ' + new Date(r.at).toLocaleString() + (r.ok ? ' - all good.' : ' - ' + this.lines(r).length + ' thing(s) to look at.')
      : 'On the first start of each version Vex checks that its features started, runs the health check and looks for new kinds of crash. It says something only if there is a problem.'));
    el.appendChild(VexSettingsGroups.button('Run the check now', async () => {
      try {
        const result = await this.check();
        localStorage.setItem(this.LAST_KEY, JSON.stringify(result));
        this.open(result);
      } catch (err) { window.showToast?.(err.message || String(err), 'error', 6000); }
    }));
    el.appendChild(VexSettingsGroups.button('Show the last result', () => this.open()));
  },
};

if (typeof window !== 'undefined') {
  window.VexSelfTest = VexSelfTest;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'update-self-test',
      title: 'Update self-test',
      keywords: 'update self test check after update features failed to start health crash new version broke',
      before: 'about',
      build: (el) => VexSelfTest.group(el),
    });
  }
  // Not at once: the features need their seconds to start, and the update cover
  // and the what's-new card get the first ones.
  window.addEventListener('load', () => setTimeout(() => {
    VexSelfTest.maybeRun().catch(err => {
      console.error('[SelfTest]', err);
      if (typeof VexProblems !== 'undefined') VexProblems.note('Update self-test', 'The check after the update could not run', err);
    });
  }, VexSelfTest.DELAY_MS));
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSelfTest };
