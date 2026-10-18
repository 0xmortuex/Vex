// Read-only catalogue destination audit in a fresh real-Electron profile.
// It opens Settings, inspects targets and runtime flags; it never runs feature commands.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const harness = require('./lib/probe-harness');
const cdpLib = require('./lib/cdp-client');
async function main() {
  const gate = spawnSync(process.execPath, [path.join(__dirname, 'heavy-gate.js'), 'feature-audit'], { stdio: 'inherit' });
  if (gate.status !== 0) return gate.status || 1;
  const probe = await harness.launchWithPort({ args: ['-r', path.join(__dirname, 'check-ui-probe.js'), '-r', path.join(__dirname, 'lib/probe-main-hook.js'), '.'], env: { VEX_SKIP_VMP_VERIFY: '1' } });
  let cdp;
  try {
    fs.writeFileSync(path.join(probe.userDataDir, 'vex-persist.json'), JSON.stringify(cdpLib.seededPreferences()));
    const target = await cdpLib.waitForTarget(probe.port, 60000); cdp = await cdpLib.connect(target.webSocketDebuggerUrl);
    await cdpLib.waitForRenderer(cdp, 60000);
    const deadline = Date.now() + 90000;
    while (!await cdpLib.evaluate(cdp, '!!window.VexBoot?.marks.settled')) { if (Date.now() > deadline) throw new Error('Late modules did not settle'); await cdpLib.sleep(500); }
    await cdpLib.evaluate(cdp, `(async () => { await VexLazy.ensure('js/feature-details.js'); SidebarManager.openPanel('settings'); SettingsUI.enhance(); return true; })()`);
    await cdpLib.sleep(1500);
    const report = await cdpLib.evaluate(cdp, `(() => {
      const rows = VexFeatures.ITEMS.map(f => {
        const target = f.setting && (f.setting.id || f.setting.section), el = target && document.getElementById(target);
        const controls = el && [...el.querySelectorAll('input,select,button')].map(n => ({tag:n.tagName,type:n.type,label:n.getAttribute('aria-label') || n.textContent.trim().slice(0,100),checked:n.type==='checkbox'?n.checked:undefined}));
        const featureId = f.feature || f.id, registered = !!VexUsage.get(featureId);
        const flags = registered ? {id:featureId,on:VexUsage.isEnabled(featureId)} : null;
        const off = VexFeatures.offState(f);
        const missing = [];
        if (target && !el) missing.push('setting');
        const commandHeldOff = !!(f.cmd && !VexFeatures.command(f) && flags && !flags.on);
        if (f.cmd && !VexFeatures.command(f) && !commandHeldOff) missing.push('command');
        if (f.panel && !document.getElementById('panel-'+f.panel)) missing.push('panel');
        if (f.sel && !document.querySelector(f.sel)) missing.push('control');
        if (!FeatureDetails[f.id]) missing.push('detail');
        if (registered && !flags.on && !off) missing.push('off-state');
        return {id:f.id,name:VexFeatures.nameOf(f),target:target||null,controls,flags,off:off?.reason||null,commandHeldOff,missing};
      });
      const settingsGroups = [...document.querySelectorAll('#panel-settings .setting-group[id]')].map(g => ({id:g.id,title:(g.querySelector(':scope > .setting-label')?.textContent || '').trim()}));
      return {scope:'Read-only destinations, rendered Settings controls and runtime discovery state; commands and external integrations were not executed.',total:rows.length,settingsGroups,lateLoadFailures:VexBoot.failed,findings:rows.filter(r=>r.missing.length),rows};
    })()`);
    report.libraryEnableCheck = await cdpLib.evaluate(cdp, `(async () => {
      await VexLazy.ensure('js/feature-library.js');
      const host = document.createElement('section');
      host.style.cssText = 'position:fixed;inset:80px;background:var(--bg-primary);z-index:2147483000;overflow:auto';
      document.body.append(host);
      const prior = FeatureLibrary._query; FeatureLibrary._query = 'Why is this tab open'; FeatureLibrary.render(host);
      const button = host.querySelector('[data-feature-enable="tab-intent"]');
      if (!button) throw new Error('Off feature has no Library enable button');
      const r = button.getBoundingClientRect(), s = getComputedStyle(button);
      const visible = r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      // The shared introduction comes first: looking at it and reading it must enable nothing.
      const pending = FeatureLibrary.enableFeature('tab-intent', button);
      await new Promise(r => setTimeout(r, 400));
      const dialog = document.getElementById('vex-activation');
      const introduced = !!dialog && /switched off/.test(dialog.textContent) && /Turn on and open/.test(dialog.textContent) && !VexUsage.isEnabled('tab-intent');
      const confirm = [...document.querySelectorAll('#vex-activation button')].find(b => /^Turn on/.test(b.textContent));
      if (!confirm) throw new Error('The introduction has no Turn on button');
      confirm.click();
      await pending;
      const enabled = VexUsage.isEnabled('tab-intent');
      const stateCleared = !host.querySelector('[data-feature-enable="tab-intent"]');
      host.remove(); FeatureLibrary._query = prior;
      SidebarManager.openPanel('settings'); SettingsUI.enhance();
      const controls = [...document.querySelectorAll('[data-tab-intent-switch]')];
      const settingAgrees = controls.length > 0 && controls.every(n => n.checked === enabled);
      return {visible,introduced,enabled,stateCleared,settingAgrees};
    })()`);
    if (!Object.values(report.libraryEnableCheck).every(Boolean)) throw new Error('Library enable check failed: ' + JSON.stringify(report.libraryEnableCheck));
    const out = path.join(__dirname, '../test-output/feature-destinations.json'); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({total:report.total,findings:report.findings.map(r=>({id:r.id,missing:r.missing})),commandsHeldOff:report.rows.filter(r=>r.commandHeldOff).length,libraryEnableCheck:report.libraryEnableCheck,lateLoadFailures:report.lateLoadFailures,report:out}, null, 2));
    return report.findings.length || report.lateLoadFailures.length ? 1 : 0;
  } finally {
    if (cdp) cdp.close(); harness.dispose(probe);
  }
}
if (require.main === module) main().then(code => { process.exitCode = code; }, err => { console.error(err); process.exitCode = 2; });
module.exports = { main };
