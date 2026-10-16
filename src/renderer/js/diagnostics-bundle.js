// === One-click diagnostics bundle (T3-012) ======================================
//
// "It is slow" or "it broke" needs no back and forth when one button puts the
// facts in a text you can read, edit and paste: Vex's version and tier, which
// features are on, the job table, what Vex did by itself (the ledger), its
// recent problems and crashes, the crash trend, and where the storage went.
//
// What is NOT in it, by construction: web addresses (every one becomes
// "[url]"), page titles or text, notes, names, anything the ledger said in
// words (only which feature acted, when, and whether it can be undone),
// tokens, emails, your Windows user folder (the Report a problem scrubber
// does those, js/report-problem.js). Nothing is sent: the text is shown first,
// and only the buttons Copy and Save write it anywhere, on this computer.
//
// build(parts) is pure over plain data (tested without a window); gather()
// reads the live modules; open() shows the dialog.
const VexDiagBundle = {
  MAX_LEDGER: 50,
  MAX_PROBLEMS: 40,
  MAX_CRASHES: 20,
  MAX_JOBS: 40,
  MAX_STORAGE_OWNERS: 12,

  // ---- scrubbing ------------------------------------------------------------
  // Addresses go entirely: a bundle has no business knowing where you browse.
  // Then the Report a problem rules (folders, emails, tokens, query strings).
  scrub(text) {
    let out = String(text == null ? '' : text);
    out = out.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>()]+/gi, '[url]');
    if (typeof VexReport === 'undefined' || typeof VexReport.scrub !== 'function') {
      throw new Error('The diagnostics bundle needs the problem-report scrubber (js/report-problem.js) and it is not loaded');
    }
    return VexReport.scrub(out).replace(/\s+/g, ' ').trim();
  },

  _when(at) {
    try { return new Date(at).toISOString().replace('T', ' ').slice(0, 16); } catch { return '?'; }
  },
  _ago(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '?';
    const m = Math.round(ms / 60000);
    if (m < 90) return m + ' min ago';
    const h = Math.round(m / 60);
    if (h < 48) return h + ' h ago';
    return Math.round(h / 24) + ' days ago';
  },

  // ---- the text -----------------------------------------------------------
  // parts = { env, features, jobs, ledger, problems, crashes, trend, storage, costs, now }
  // Every list is plain data; build() cuts and scrubs it.
  build(parts = {}) {
    const p = parts;
    const now = Number.isFinite(p.now) ? p.now : Date.now();
    const s = (v) => this.scrub(v);
    const out = [];
    const env = p.env || {};
    out.push('# Vex diagnostics', '');
    out.push('Made ' + this._when(now) + ' UTC. It holds no web addresses, page text, notes or secrets. Read it before you share it.', '');

    out.push('## Vex');
    out.push('- Version: ' + s(env.version || '?'));
    out.push('- Electron ' + s(env.electron || '?') + ', Chromium ' + s(env.chrome || '?'));
    out.push('- Windows: ' + s(env.os || '?') + (env.arch ? ' (' + s(env.arch) + ')' : ''));
    out.push('- Look: ' + s(env.look || '?') + ', theme: ' + s(env.theme || '?'));
    out.push('- Tier: ' + s(env.tier || 'standard'));
    if (env.safeMode) out.push('- Started in safe mode');
    if (Number.isFinite(env.bootFails) && env.bootFails > 0) out.push('- Failed starts in a row: ' + env.bootFails);
    if (Number.isFinite(env.uptimeMs)) out.push('- Running for ' + Math.round(env.uptimeMs / 60000) + ' min');
    if (env.widevine) out.push('- Widevine: ' + s(typeof env.widevine === 'string' ? env.widevine : JSON.stringify(env.widevine)).slice(0, 160));
    out.push('');

    const features = Array.isArray(p.features) ? p.features : [];
    out.push('## Features (' + features.length + ')');
    const off = features.filter(f => f.running && f.on === false);
    const tripped = features.filter(f => f.tripped);
    out.push('- On: ' + features.filter(f => f.running && f.on !== false).length + ', off: ' + off.length + ', switched off after failing: ' + tripped.length);
    if (tripped.length) out.push('- Switched off after failing: ' + tripped.map(f => s(f.id)).join(', '));
    if (off.length) out.push('- Off: ' + off.map(f => s(f.id) + (f.maturity !== 'stable' ? ' (' + f.maturity + ')' : '')).join(', '));
    out.push('');

    const jobs = (Array.isArray(p.jobs) ? p.jobs : []).slice().sort((a, b) => (b.totalMs || 0) - (a.totalMs || 0)).slice(0, this.MAX_JOBS);
    out.push('## Background jobs (' + jobs.length + ' busiest)');
    if (!jobs.length) out.push('- None are registered.');
    for (const j of jobs) out.push('- ' + s(j.name) + (j.feature ? ' [' + s(j.feature) + ']' : '') + ': ' + (j.runs || 0) + ' runs, ' + Math.round(j.totalMs || 0) + ' ms in all, longest ' + Math.round(j.maxMs || 0) + ' ms' + (j.held ? ', ' + j.held + ' held back' : ''));
    out.push('');

    const costs = (Array.isArray(p.costs) ? p.costs : []).filter(c => c && c.over && c.over.length).slice(0, 10);
    if (costs.length) {
      out.push('## Features over their budget');
      for (const c of costs) out.push('- ' + s(c.id) + ': ' + c.over.map(o => s(o.item) + ' ' + o.used + ' of ' + o.budget + (o.unit ? ' ' + s(o.unit) : '')).join('; '));
      out.push('');
    }

    const ledger = (Array.isArray(p.ledger) ? p.ledger : []).slice(0, this.MAX_LEDGER);
    out.push('## What Vex did by itself (last ' + ledger.length + ', newest first)');
    if (!ledger.length) out.push('- Nothing recorded.');
    // Only who, when and whether it can be undone: the words of a ledger line can be a page title.
    for (const e of ledger) out.push('- ' + this._when(e.at) + ' ' + s(e.feature) + (e.undone ? ' (undone)' : e.undo ? ' (can be undone)' : ''));
    out.push('');

    const problems = (Array.isArray(p.problems) ? p.problems : []).slice(0, this.MAX_PROBLEMS);
    out.push('## Problems Vex noted (' + problems.length + ' newest)');
    if (!problems.length) out.push('- None.');
    for (const x of problems) out.push('- ' + this._when(x.at) + ' ' + s(x.area) + ': ' + s(x.message).slice(0, 200) + (x.n > 1 ? ' (x' + x.n + ')' : ''));
    out.push('');

    const crashes = (Array.isArray(p.crashes) ? p.crashes : []).slice(-this.MAX_CRASHES);
    out.push('## Crashes and hangs (' + crashes.length + ' newest)');
    if (!crashes.length) out.push('- None.');
    for (const c of crashes) out.push('- ' + this._when(c.at) + ' ' + s(c.kind) + (c.version ? ' (v' + s(c.version) + ')' : '') + (c.detail ? ': ' + s(c.detail).slice(0, 160) : ''));
    if (p.trend) {
      const t = p.trend;
      out.push('- Trend: ' + s(typeof t === 'string' ? t : JSON.stringify(t)).slice(0, 300));
    }
    out.push('');

    const storage = (Array.isArray(p.storage) ? p.storage : []).slice(0, this.MAX_STORAGE_OWNERS);
    out.push('## Where the stored data is (largest first)');
    if (!storage.length) out.push('- Not measured.');
    for (const r of storage) out.push('- ' + s(r.owner) + ': ' + Math.round((r.bytes || 0) / 102.4) / 10 + ' KB in ' + (r.keys || 0) + ' key' + (r.keys === 1 ? '' : 's'));
    out.push('');
    return out.join('\n');
  },

  // ---- the live data ------------------------------------------------------------
  async gather() {
    let d = {};
    if (typeof window !== 'undefined' && window.vex && typeof window.vex.diagnostics === 'function') d = await window.vex.diagnostics();
    const gs = (typeof window !== 'undefined' && window.VexGuiStyle) || null;
    let tier = 'standard';
    try { if (localStorage.getItem('vex.minimalMode')) tier = 'minimal'; }
    catch (err) { throw new Error('Could not read the tier: ' + err.message); }
    const parts = {
      now: Date.now(),
      env: {
        version: d.version, electron: d.electron, chrome: d.chrome, os: d.os, arch: d.arch, safeMode: d.safeMode, bootFails: d.bootFails,
        uptimeMs: d.uptimeMs, widevine: d.widevine, tier,
        look: gs && typeof gs.get === 'function' ? gs.get() : '',
        theme: (typeof ThemeManager !== 'undefined' && ThemeManager.currentTheme) || '',
      },
      features: typeof VexRegistry !== 'undefined' ? VexRegistry.diagnostics() : [],
      jobs: typeof VexJobs !== 'undefined' ? VexJobs.timings() : [],
      costs: typeof VexCost !== 'undefined' ? VexCost.report() : [],
      ledger: typeof VexLedger !== 'undefined' ? VexLedger.list(this.MAX_LEDGER) : [],
      problems: typeof VexProblems !== 'undefined' ? VexProblems.all() : [],
      crashes: Array.isArray(d.crashHistory) ? d.crashHistory : [],
      trend: d.crashTrend || null,
      storage: typeof VexStorageLedger !== 'undefined' ? VexStorageLedger.byOwner() : [],
    };
    return parts;
  },

  async text() { return this.build(await this.gather()); },

  async copy() {
    const text = await this.text();
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('This window cannot write to the clipboard');
    await navigator.clipboard.writeText(text);
    if (typeof VexUsage !== 'undefined') VexUsage.touch('diagnostics-bundle');
    return text;
  },

  fileName(now = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return 'vex-diagnostics-' + now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate()) + '.md';
  },

  async save() {
    const text = await this.text();
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = this.fileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return text;
  },

  // ---- the screen ---------------------------------------------------------------
  async open() {
    if (typeof VexSettingsGroups === 'undefined') throw new Error('The platform dialog is not loaded');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-diag-bundle', title: 'Diagnostics', sub: 'Exactly what would be copied or saved. Change or delete anything you would rather not share. Nothing is sent by Vex.' });
    const box = document.createElement('textarea');
    box.className = 'vexsr-input';
    box.style.cssText = 'width:100%;min-height:340px;font-family:var(--font-mono,monospace);font-size:11.5px';
    box.setAttribute('aria-label', 'Diagnostics text');
    box.readOnly = false;
    box.value = 'Gathering…';
    const msg = VexSettingsGroups.note('');
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap';
    const say = (t) => { msg.textContent = t; };
    bar.append(
      VexSettingsGroups.button('Copy', async () => {
        try { await navigator.clipboard.writeText(box.value); say('Copied. Paste it where you were asked for it.'); }
        catch (err) { say('Could not copy: ' + err.message); }
      }, { primary: true }),
      VexSettingsGroups.button('Save as a file', () => {
        try {
          const url = URL.createObjectURL(new Blob([box.value], { type: 'text/markdown' }));
          const a = document.createElement('a');
          a.href = url; a.download = this.fileName();
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
          say('Saved to your Downloads folder.');
        } catch (err) { say('Could not save: ' + err.message); }
      }),
    );
    body.append(box, bar, msg);
    try { box.value = await this.text(); }
    catch (err) {
      box.value = '';
      say('Could not put the diagnostics together: ' + err.message);
      if (typeof VexProblems !== 'undefined') VexProblems.note('Diagnostics bundle', 'Could not put it together', err);
    }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('diagnostics-bundle');
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('A text with your Vex version, which features are on, what is slow, what Vex did by itself, its recent problems and crashes and where the stored data is. No web addresses, page text or secrets. You read it first; nothing is sent.'));
    el.appendChild(VexSettingsGroups.button('Show diagnostics', () => this.open().catch(err => window.showToast?.(err.message, 'error')), { primary: true }));
    el.appendChild(VexSettingsGroups.button('Copy diagnostics', () => this.copy().then(() => window.showToast?.('Diagnostics copied', 'success')).catch(err => window.showToast?.('Could not copy: ' + err.message, 'error'))));
  },
};

if (typeof window !== 'undefined') {
  window.VexDiagBundle = VexDiagBundle;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'diagnostics-bundle', title: 'Diagnostics', keywords: 'diagnostics report problem slow support copy bundle versions crash log', before: 'about', build: (el) => VexDiagBundle.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'diagnostics-bundle', label: 'Copy diagnostics', hint: 'Versions, features, slow jobs, problems and crashes as a text you read first. No addresses or page text', icon: 'clipboard', action: () => VexDiagBundle.open().catch(err => window.showToast?.(err.message, 'error')) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDiagBundle };
