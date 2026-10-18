// Real-Electron verification of the 2026-10 feature audit fixes, in a disposable profile (never the owner's).
//   1. tab-reason mounts before tab-intent, yet its Settings section shows the command switch and the button
//   2. the two copies of the Tab-intent switch stay in step, and the revisit reminder is independent
//   3. the New Tab "Open Autopilot" click travels the real VEX_CMD console channel to the Autopilot panel
//   4. a switched-off feature is introduced; reading/cancelling enables nothing; "Turn on and open" enables and opens once
//   5. the weather picker finds 34852 in Turkiye (one real request to OpenStreetMap) and the app's user agent names Vex
//   6. each new Settings section renders and its switch flips the same runtime flag the feature reads
//   7. switching one feature of a shared Settings section off keeps the section; both off hides it
// Run: npx electron-free harness  ->  node scripts/verify-audit-ui.js   (refuses under the heavy gate)
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const harness = require('./lib/probe-harness');
const cdpLib = require('./lib/cdp-client');

async function main() {
  const gate = spawnSync(process.execPath, [path.join(__dirname, 'heavy-gate.js'), 'verify-audit-ui'], { stdio: 'inherit' });
  if (gate.status !== 0) return gate.status || 1;
  const probe = await harness.launchWithPort({ args: ['-r', path.join(__dirname, 'check-ui-probe.js'), '-r', path.join(__dirname, 'lib/probe-main-hook.js'), '.'], env: { VEX_SKIP_VMP_VERIFY: '1' } });
  let cdp;
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail && !ok ? '  ' + JSON.stringify(detail) : '')); };
  try {
    require('fs').writeFileSync(path.join(probe.userDataDir, 'vex-persist.json'), JSON.stringify(cdpLib.seededPreferences()));
    const target = await cdpLib.waitForTarget(probe.port, 60000); cdp = await cdpLib.connect(target.webSocketDebuggerUrl);
    // Console from the very start (Runtime.enable replays what was already logged): a Settings section that cannot be built logs
    // an error at every start and nothing else shows it.
    const consoleErrors = [];
    cdp.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') consoleErrors.push((p.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 300)); });
    cdp.on('Runtime.exceptionThrown', (p) => consoleErrors.push('uncaught: ' + ((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text).slice(0, 300)));
    await cdp.send('Runtime.enable', {});
    await cdpLib.waitForRenderer(cdp, 60000);
    const deadline = Date.now() + 90000;
    while (!await cdpLib.evaluate(cdp, '!!window.VexBoot?.marks.settled')) { if (Date.now() > deadline) throw new Error('Late modules did not settle'); await cdpLib.sleep(500); }
    const ev = (expr) => cdpLib.evaluate(cdp, expr);

    // ---- 1 + 2: tab reasons ----
    await ev(`(async () => { SidebarManager.openPanel('settings'); SettingsUI.enhance(); return true; })()`);
    await cdpLib.sleep(1200);
    const tr = await ev(`(() => {
      const idx = [...document.scripts].map(s => s.getAttribute('src') || '');
      const reasonFirst = idx.findIndex(s => /tab-reason\\.js/.test(s)) < idx.findIndex(s => /tab-intent\\.js/.test(s));
      const sec = document.getElementById('settings-tabreason');
      const sw = sec ? [...sec.querySelectorAll('[data-tab-intent-switch]')] : [];
      const btn = sec ? [...sec.querySelectorAll('button')].map(b => b.textContent) : [];
      const all = [...document.querySelectorAll('[data-tab-intent-switch]')];
      return { reasonFirst, hasSection: !!sec, switches: sw.length, button: btn.includes('Say why the current tab is open'), copies: all.length };
    })()`);
    check('tab-reason script loads before tab-intent (the order that caused the bug)', tr.reasonFirst, tr);
    check('on a fresh start the tab-reason section already shows the command switch and the button', tr.hasSection && tr.switches === 1 && tr.button, tr);
    const sync = await ev(`(async () => {
      const copies = () => [...document.querySelectorAll('[data-tab-intent-switch]')];
      const revisit = () => [...document.querySelectorAll('#settings-tabreason input[type=checkbox]')].find(i => i.getAttribute('aria-label') === 'Ask about a tab I come back to after a while');
      const before = { intent: copies().map(c => c.checked), revisit: revisit().checked };
      const first = copies()[0]; first.checked = !first.checked; first.dispatchEvent(new Event('change', { bubbles: true }));
      const mid = { intent: copies().map(c => c.checked), flag: VexTabIntent.enabled(), revisit: revisit().checked };
      const r = revisit(); r.checked = !r.checked; r.dispatchEvent(new Event('change', { bubbles: true }));
      const end = { intent: copies().map(c => c.checked), flag: VexTabIntent.enabled(), revisit: revisit().checked };
      return { before, mid, end, copies: copies().length };
    })()`);
    check('flipping one copy of the switch changes the flag and every copy', sync.mid.intent.every(v => v === sync.mid.flag) && sync.mid.flag !== sync.before.intent[0], sync);
    check('the revisit reminder is independent of the command switch (both directions)', sync.mid.revisit === sync.before.revisit && sync.end.flag === sync.mid.flag && sync.end.revisit !== sync.mid.revisit, sync);

    // ---- 3: Open Autopilot through the real console channel ----
    const ap = await ev(`(async () => {
      const wvs = [...WebviewManager.webviews.values()];
      const tab = TabManager.getActiveTab();
      const wv = WebviewManager.webviews.get(tab.id);
      if (!wv) return { error: 'no webview for the active tab', url: tab.url };
      VexBrief._last = { sections: [{ items: [], action: { label: 'Open Autopilot', cmd: { type: 'autopilot-open' } } }] };
      document.querySelector('.vex-autopilot-overlay')?.remove();
      await wv.executeJavaScript("console.log('VEX_CMD:' + JSON.stringify({type:'autopilot-open'}))");
      for (let i = 0; i < 40 && !document.querySelector('.vex-autopilot-overlay'); i++) await new Promise(r => setTimeout(r, 100));
      const o = document.querySelector('.vex-autopilot-overlay');
      const out = { url: tab.url, opened: !!o, title: o ? (o.querySelector('.ap-title')||{}).textContent : null, hasMail: !!(o && o.querySelector('[data-mail]')) };
      o?.remove();
      return out;
    })()`);
    check('clicking Open Autopilot on the New Tab page opens the Autopilot panel (with its Mail checkbox)', ap.opened && ap.hasMail, ap);

    // ---- 4: introduction and activation ----
    const act = await ev(`(async () => {
      const id = 'tab-intent', tick = (ms) => new Promise(r => setTimeout(r, ms));
      if (VexUsage.isEnabled(id)) await VexUsage.disable(id);
      const out = {};
      // opening Settings and the Library card must enable nothing
      SidebarManager.openPanel('settings'); SettingsUI.enhance(); await tick(300);
      out.settingsOpenEnabledNothing = !VexUsage.isEnabled(id);
      // Cancel path
      let p = FeatureLibrary.open(id, 'command'); await tick(500);
      let d = document.getElementById('vex-activation');
      out.introduced = !!d && /switched off/.test(d.textContent);
      out.explains = !!d && /What it does/.test(d.textContent) && /How to use it/.test(d.textContent) && /Turning it off again/.test(d.textContent);
      out.buttons = d ? [...d.querySelectorAll('button')].map(b => b.textContent) : [];
      out.notEnabledWhileOpen = !VexUsage.isEnabled(id);
      [...d.querySelectorAll('button')].find(b => b.textContent === 'Cancel').click(); await p;
      out.cancelKeptOff = !VexUsage.isEnabled(id) && !document.getElementById('vex-activation');
      // Turn on and open path: the requested action (the Why-is-this-tab-open prompt) must appear exactly once
      p = FeatureLibrary.open(id, 'command'); await tick(500);
      d = document.getElementById('vex-activation');
      [...d.querySelectorAll('button')].find(b => b.textContent === 'Turn on and open').click();
      for (let i = 0; i < 40 && !VexUsage.isEnabled(id); i++) await tick(100);
      await p; await tick(600);
      out.enabledAfterConfirm = VexUsage.isEnabled(id);
      const prompts = [...document.querySelectorAll('*')].filter(n => n.children.length === 0 && /Why is this tab open\\?/.test(n.textContent || ''));
      out.requestedActionOpened = prompts.length > 0;
      document.querySelectorAll('.vex-dialog-overlay, .vex-confirm-overlay, [role=dialog]').forEach(n => { if (/Why is this tab open/.test(n.textContent)) n.querySelector('button')?.click(); });
      return out;
    })()`);
    check('opening Settings or reading an off feature enables nothing', act.settingsOpenEnabledNothing && act.notEnabledWhileOpen, act);
    check('the introduction explains the feature and offers Turn on and open / Open settings / Cancel', act.introduced && act.explains && ['Turn on and open', 'Open settings', 'Cancel'].every(b => act.buttons.includes(b)), act);
    check('Cancel leaves the feature off', act.cancelKeptOff, act);
    check('Turn on and open enables the feature and then opens what was asked for', act.enabledAfterConfirm && act.requestedActionOpened, act);

    // ---- 5: weather postcode ----
    const sent = new Map();
    await cdp.send('Network.enable', {});
    cdp.on('Network.requestWillBeSent', (p) => { if (/nominatim\.openstreetmap\.org/.test(p.request.url)) sent.set(p.requestId, { url: p.request.url, headers: p.request.headers, extra: null }); });
    cdp.on('Network.requestWillBeSentExtraInfo', (p) => { const r = sent.get(p.requestId); if (r) r.extra = p.headers; });
    const wx = await ev(`(async () => {
      const tick = (ms) => new Promise(r => setTimeout(r, ms));
      SidebarManager.openPanel('settings'); SettingsUI.enhance(); await tick(300);
      const input = document.getElementById('setting-weather-input'), sel = document.getElementById('setting-weather-country'), btn = document.getElementById('setting-weather-search');
      if (!input || !sel || !btn) return { error: 'weather controls missing', input: !!input, sel: !!sel, btn: !!btn };
      sel.value = 'TR'; sel.dispatchEvent(new Event('change'));
      input.value = '34852'; btn.click();
      let loc = null;
      for (let i = 0; i < 100; i++) { await tick(200); try { loc = JSON.parse(localStorage.getItem('vex.weatherLoc') || 'null'); } catch {} if (loc) break; }
      const status = (document.getElementById('setting-weather-status') || {}).textContent;
      return { loc, status, ua: navigator.userAgent.match(/Vex\\/[0-9.]+/)?.[0] || null };
    })()`);
    check('weather picker with Turkiye selected finds postcode 34852 as Zumrutevler, Istanbul', wx.loc && /Zümrütevler/.test(wx.loc.city) && /İstanbul|Istanbul/.test(wx.loc.city), wx);
    check('its coordinates are in Istanbul (Maltepe), not the wrong point', wx.loc && Math.abs(wx.loc.lat - 40.94) < 0.1 && Math.abs(wx.loc.lon - 29.15) < 0.1, wx);
    await cdpLib.sleep(500);
    const req = [...sent.values()][0] || null;
    const uaSent = req && ((req.extra && (req.extra['User-Agent'] || req.extra['user-agent'])) || '');
    check('exactly one request went to OpenStreetMap, for the postcode, in Turkiye', sent.size === 1 && req && /postalcode=34852/.test(req.url) && /country=tr/.test(req.url), { n: sent.size, url: req && req.url });
    check('that request identified Vex in its User-Agent (as the header actually sent)', /^Vex\/[0-9.]+ \(\+https:\/\/github\.com\/0xmortuex\/Vex\)$/.test(uaSent), { uaSent, rendererUa: wx.ua });

    // ---- 6: new Settings sections ----
    const sections = await ev(`(async () => {
      const tick = (ms) => new Promise(r => setTimeout(r, ms));
      SidebarManager.openPanel('settings'); SettingsUI.enhance(); await tick(500);
      const spec = [
        ['vex-sg-credential-interlock', 'Ask before I type a password on a lookalike address', () => CredentialInterlock.enabled(), 'credential-interlock'],
        ['vex-sg-update-self-test', 'Check after each update', () => VexSelfTest.enabled(), 'update-self-test'],
        ['vex-sg-signout-why', 'Say why, once, after a saved password signs me in again', () => VexSignoutWhy.enabled(), 'signout-why'],
        ['vex-sg-release-check', 'Use the release check', () => VexReleaseChecklist.enabled(), 'release-check'],
        ['vex-sg-signed-in', 'Use this tool', () => VexSignedIn.enabled(), 'signed-in'],
        ['vex-sg-incident-playbooks', 'Use the checklists', () => VexIncident.enabled(), 'incident-playbooks'],
        ['vex-sg-feature-sheet', 'Show a short card the first time I use a new feature', () => VexFeatureSheet.enabled(), 'first-use-sheet'],
        ['vex-sg-longdoc-engine', 'Read long texts in pieces', () => VexLongDoc.enabled(), 'longdoc-engine'],
        ['vex-sg-answer-citations', 'Check answers against their sources', () => VexAnswerCitations.enabled(), 'answer-citations'],
        ['vex-sg-site-volume', 'Remember the volume for each site', () => MasterVolume.siteMemoryEnabled(), 'site-audio-memory'],
      ];
      const rows = [];
      for (const [secId, label, read, feat] of spec) {
        const el = document.getElementById(secId);
        const box = el && [...el.querySelectorAll('input[type=checkbox]')].find(i => i.getAttribute('aria-label') === label);
        if (!box) { rows.push({ secId, rendered: !!el, switchFound: false }); continue; }
        const before = read(); box.checked = !box.checked; box.dispatchEvent(new Event('change', { bubbles: true })); const mid = read();
        box.checked = !box.checked; box.dispatchEvent(new Event('change', { bubbles: true })); const end = read();
        const link = FeatureLibrary ? !!VexFeatures.ITEMS.find(f => (f.feature || f.id) === feat && f.setting && (f.setting.section === secId || f.setting.id === secId)) : null;
        rows.push({ secId, rendered: true, switchFound: true, flips: mid !== before && end === before, catalogueLinksHere: link });
      }
      return rows;
    })()`);
    for (const r of sections) check('Settings section ' + r.secId + ' renders and its switch flips the flag the feature reads', r.rendered && r.switchFound && r.flips, r);
    const links = sections.filter(r => r.catalogueLinksHere === false).map(r => r.secId);
    console.log('INFO sections whose catalogue entry points elsewhere: ' + (links.join(', ') || 'none'));

    // ---- 7: shared sections keep their siblings ----
    const shared = await ev(`(async () => {
      const tick = (ms) => new Promise(r => setTimeout(r, ms));
      const byGroup = new Map();
      for (const f of VexUsage.features()) { if (!f.group) continue; (byGroup.get(f.group) || byGroup.set(f.group, []).get(f.group)).push(f); }
      const group = [...byGroup.entries()].find(([g, fs]) => fs.length >= 2 && [...document.querySelectorAll('#panel-settings .setting-group > .setting-label')].some(l => l.textContent.trim().startsWith(g)));
      if (!group) return { error: 'no shared group with a rendered section' };
      const [name, fs] = group, [a] = fs;
      const wasOn = new Map(fs.map(f => [f.id, VexUsage.isEnabled(f.id)]));
      for (const f of fs) if (!VexUsage.isEnabled(f.id)) { try { await VexUsage.enable(f.id); } catch (e) { return { error: 'could not enable ' + f.id + ': ' + e.message }; } }
      const heading = () => [...document.querySelectorAll('#panel-settings .setting-group')].find(g => (g.querySelector(':scope > .setting-label')?.textContent || '').trim().startsWith(name));
      const shown = () => { const g = heading(); return !!g && getComputedStyle(g).display !== 'none' && g.getBoundingClientRect().height > 0; };
      SettingsUI.enhance(); await tick(300);
      const both = shown();
      await VexUsage.disable(a.id); await tick(200);
      const oneOff = shown();
      for (const f of fs) await VexUsage.disable(f.id);
      await tick(200);
      const allOff = shown();
      for (const f of fs) if (wasOn.get(f.id)) await VexUsage.enable(f.id);
      return { group: name, features: fs.length, both, oneOff, allOff };
    })()`);
    check('with one feature of a shared Settings section off the section (and its siblings) stays visible; with every feature off it is hidden', shared.both && shared.oneOff && shared.allOff === false, shared);

    // ---- Library button goes through the shared dispatcher ----
    const disp = await ev(`(async () => {
      const f = VexFeatures.get('keep-awake');
      const real = CommandBar._execute; let calls = 0; CommandBar._execute = function (item, o) { calls++; return undefined; };
      try { await FeatureLibrary.open('keep-awake', 'command'); } finally { CommandBar._execute = real; }
      return { calls, haveCommand: !!VexFeatures.command(f) };
    })()`);
    check('a Library button runs its command through CommandBar._execute (so the off-gate applies)', disp.calls === 1 && disp.haveCommand, disp);
    // ---- console ----
    const unbuilt = consoleErrors.filter(e => /could not be built|is not defined/.test(e));
    check('no Settings section failed to build, and nothing reported a missing global, from start-up to the end of this run', unbuilt.length === 0, unbuilt.slice(0, 3));
    const other = consoleErrors.filter(e => !unbuilt.includes(e) && !/favicon|Failed to load resource|net::ERR_/.test(e));
    console.log('INFO other console errors: ' + (other.length ? '\n  ' + other.slice(0, 8).join('\n  ') : 'none'));
  } finally {
    if (cdp) cdp.close(); harness.dispose(probe);
  }
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  return failed.length ? 1 : 0;
}
if (require.main === module) main().then(code => { process.exitCode = code; }, err => { console.error(err); process.exitCode = 2; });
module.exports = { main };
