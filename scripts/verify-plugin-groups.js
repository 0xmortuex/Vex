// Real-Electron, real-click check of the plugin memory tool in a DISPOSABLE profile, against a FAKE local "Discord" page that has a fake
// Vencord (12 plugins, one of which costs a known 120 MB). It proves the mechanics, not the numbers on a real Discord:
//   * the off-feature introduction, then the "load Discord in the background" prompt, on a profile that has neither
//   * the picker, groups mode and the group size, the confirm dialog, the step runner and its results
//   * the drill-down (members ticked, groups of 4), Stop, and that every plugin is back on afterwards
// Every button is pressed with a real mouse event over CDP (never OS input). Run: node scripts/verify-plugin-groups.js
'use strict';
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const harness = require('./lib/probe-harness');
const cdpLib = require('./lib/cdp-client');

const NAMES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Eps', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Mu'];
const COSTLY = 'Beta';                       // 120 MB; every other plugin costs 1 MB
const PAGE = `<!doctype html><meta charset="utf-8"><title>fake discord</title><script>
const KEY = 'fakeVencordSettings';
const names = ${JSON.stringify(NAMES)};
let saved; try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (e) { saved = null; }
if (!saved) saved = Object.fromEntries(names.map(n => [n, { enabled: true }]));
const save = () => localStorage.setItem(KEY, JSON.stringify(saved));
const plugins = new Proxy(saved, { get(t, k) { const v = t[k]; return v && typeof v === 'object' ? new Proxy(v, { set(o, p, val) { o[p] = val; save(); return true; } }) : v; } });
window.Vencord = { Settings: { plugins }, Plugins: { plugins: Object.fromEntries(names.map(n => [n, {}])) } };
let reading = 0;
window.__cost = () => { const base = 400 + names.filter(n => saved[n].enabled).reduce((s, n) => s + (n === ${JSON.stringify(COSTLY)} ? 120 : 1), 0); return base + [-8, 0, 8][reading++ % 3]; };
window.__enabled = () => names.filter(n => saved[n].enabled);
</script><body>fake discord</body>`;

async function main() {
  const gate = spawnSync(process.execPath, [path.join(__dirname, 'heavy-gate.js'), 'verify-plugin-groups'], { stdio: 'inherit' });
  if (gate.status !== 0) return gate.status || 1;
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(PAGE); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const probe = await harness.launchWithPort({ args: ['-r', path.join(__dirname, 'check-ui-probe.js'), '-r', path.join(__dirname, 'lib/probe-main-hook.js'), '.'], env: { VEX_SKIP_VMP_VERIFY: '1' } });
  let cdp;
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (!ok && detail !== undefined ? '  ' + JSON.stringify(detail) : '')); };
  try {
    require('fs').writeFileSync(path.join(probe.userDataDir, 'vex-persist.json'), JSON.stringify(cdpLib.seededPreferences()));
    const target = await cdpLib.waitForTarget(probe.port, 60000); cdp = await cdpLib.connect(target.webSocketDebuggerUrl);
    const consoleErrors = [];
    cdp.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') consoleErrors.push((p.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 250)); });
    await cdp.send('Runtime.enable', {});
    await cdpLib.waitForRenderer(cdp, 60000);
    const deadline = Date.now() + 90000;
    while (!await cdpLib.evaluate(cdp, '!!window.VexBoot?.marks.settled')) { if (Date.now() > deadline) throw new Error('Late modules did not settle'); await cdpLib.sleep(500); }
    const ev = (expr) => cdpLib.evaluate(cdp, expr);
    const sleep = cdpLib.sleep;

    // ---- helpers: a REAL mouse click on a visible button with this text (inside `scope`), after checking nothing covers it ----
    const press = async (text, scope = 'document', { timeout = 20000 } = {}) => {
      const t0 = Date.now();
      for (;;) {
        const at = await ev(`(() => {
          const root = ${scope === 'document' ? 'document' : 'document.querySelector(' + JSON.stringify(scope) + ')'};
          if (!root) return null;
          const b = [...root.querySelectorAll('button')].filter(x => x.textContent.trim() === ${JSON.stringify(text)}).find(x => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(x).visibility !== 'hidden'; });
          if (!b) return null;
          b.scrollIntoView({ block: 'center' });
          const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
          const top = document.elementFromPoint(x, y);
          return { x, y, covered: !(top === b || b.contains(top)), by: top ? (top.id || top.className || top.tagName) : null };
        })()`);
        // A dialog fades and slides in: a click aimed at a button that is still moving lands beside it. Wait until the
        // button has stayed where it is for two looks, then click where it is now.
        if (at && !at.covered) {
          await sleep(180);
          const again = await ev(`(() => {
            const root = ${scope === 'document' ? 'document' : 'document.querySelector(' + JSON.stringify(scope) + ')'};
            const b = root && [...root.querySelectorAll('button')].filter(x => x.textContent.trim() === ${JSON.stringify(text)}).find(x => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
            if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          })()`);
          if (!again || Math.abs(again.x - at.x) > 1 || Math.abs(again.y - at.y) > 1) { await sleep(150); continue; }
        }
        if (at && at.covered) throw new Error('"' + text + '" is covered by ' + at.by);
        if (at) {
          for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
          return true;
        }
        if (Date.now() - t0 > timeout) throw new Error('no visible "' + text + '" button within ' + timeout / 1000 + ' s');
        await sleep(200);
      }
    };
    const dump = async () => JSON.stringify(await ev(`({
      toasts: (window.__toasts || []).slice(-6),
      run: DiscordMeasure._run && { finished: DiscordMeasure._run.finished, cancelled: DiscordMeasure._run.cancelled },
      busy: DiscordPluginRam._busy, windowOpen: DiscordPluginRam._windowOpen,
      overlays: ['vex-discord-measure', 'vex-discord-plugin-ram', 'vex-activation'].filter(i => document.getElementById(i)),
      measureText: ((document.getElementById('vex-discord-measure') || {}).textContent || '').slice(0, 400),
      pluginWinText: ((document.getElementById('vex-discord-plugin-ram') || {}).textContent || '').slice(0, 200),
      discordLoaded: !!DiscordMemory.webview(), problems: (window.VexProblems && VexProblems.list ? VexProblems.list().slice(-3).map(p => p.what || p.message) : null)
    })`));
    const waitFor = async (expr, what, ms = 240000) => { const t0 = Date.now(); for (;;) { const v = await ev(expr); if (v) return v; if (Date.now() - t0 > ms) { console.log('DIAG at "' + what + '": ' + await dump()); console.log('DIAG console errors: ' + JSON.stringify(consoleErrors.slice(-5))); throw new Error('timed out waiting for ' + what); } await sleep(500); } };
    const text = (id) => ev(`(document.getElementById(${JSON.stringify(id)}) || {}).textContent || ''`);
    const fakeState = () => ev(`(async () => { const wv = DiscordMemory.webview(); if (!wv) return null; return await window.vexGuestEval(wv, 'window.__enabled()', false, 4000); })()`);
    const pending = () => ev('DiscordMemory.care().pluginPending');
    const selectOption = (label, value) => ev(`(() => { const s = [...document.querySelectorAll('#vex-discord-measure select')].find(x => x.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!s) return false; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    const closeWindows = () => ev(`(() => { for (const id of ['vex-discord-measure', 'vex-discord-plugin-ram', 'vex-activation']) document.getElementById(id)?.remove(); return true; })()`);

    // ---- set the test up: the fake page is the Discord panel; seconds instead of minutes; readings from the fake page ----
    await ev(`(() => {
      SidebarManager.panelConfigs.discord.url = ${JSON.stringify(url)};
      const R = DiscordPluginRam;
      window.__toasts = []; const _t = window.showToast; window.showToast = (...a) => { window.__toasts.push(String(a[0]).slice(0, 200)); return _t && _t(...a); };
      R.SETTLE_MS = 400; R.GAP_MS = 200; R.READY_MS = 40000;
      const orig = R.realDeps.bind(R);
      R.realDeps = (run, extra) => {
        const d = orig(run, extra);
        d.sample = async () => { const wv = DiscordMemory.webview(); const c = await window.vexGuestEval(wv, 'window.__cost()', false, 4000); return { heapMB: c, wsMB: c * 2 }; };
        return d;
      };
      return true;
    })()`);

    // ---- 1: a fresh profile: the feature is off, and Discord is not loaded ----
    await ev(`(() => { const c = CommandBar.commands.find(x => x.id === 'discord-plugin-ram'); setTimeout(() => CommandBar._execute(c), 0); return !!c; })()`);
    const intro = await waitFor(`(document.getElementById('vex-activation') || {}).textContent`, 'the feature introduction').catch(() => null);
    if (intro) {
      check('the switched-off feature is introduced first (not refused)', /switched off/.test(intro) && /Turn on and open/.test(intro), intro.slice(0, 120));
      await press('Turn on and open', '#vex-activation');
    } else check('the feature was already on in this profile (introduction skipped)', true);
    await waitFor(`/Load Discord in the background/.test(document.body.textContent)`, 'the load-Discord prompt');
    check('with Discord asleep the tool asks to load it in the background instead of refusing', true);
    await press('Load Discord and continue');
    await waitFor(`!!document.getElementById('vex-discord-plugin-ram')`, 'the plugin memory window');
    check('after a yes, Discord (the fake page) is loaded hidden and the measuring window opens', !!(await fakeState()), await fakeState());
    check('Discord was not brought to the front', await ev(`SidebarManager.activePanel !== 'discord'`));

    // ---- 2: groups of 8, everything ----
    await press('One at a time...', '#vex-discord-plugin-ram');
    await waitFor(`!!document.getElementById('vex-discord-measure') && document.querySelectorAll('#vex-discord-measure select').length >= 2`, 'the picker');
    const listed = await ev(`[...document.querySelectorAll('#vex-discord-measure input[type=checkbox]')].map(b => b.value)`);
    check('the picker lists all 12 plugins (read from the fake Vencord table)', listed.length === 12, listed);
    await selectOption('How to test', 'groups');
    await selectOption('Group size', '8');
    const est = await text('vex-discord-measure');
    check('groups of 8 over 12 plugins is 2 steps', /12 selected in 2 steps/.test(est), est.slice(0, 400));
    await press('Continue', '#vex-discord-measure');
    await waitFor(`/Measure plugin memory in groups/.test(document.body.textContent)`, 'the confirm dialog');
    await press('Start');
    await waitFor(`/Done\\./.test((document.getElementById('vex-discord-measure') || {}).textContent || '')`, 'run 1 to finish', 300000);
    const slow1 = await ev(`JSON.stringify((() => { const s = DiscordPluginRam.last.slow; const sum = DiscordPluginRam.summarize(s); return { steps: s.plugins.map(p => p.name), partial: s.partial, error: s.error && s.error.message, rows: sum.rows.map(r => ({ name: r.name, members: r.members, heap: r.heapDelta, sig: r.sig })) }; })())`).then(JSON.parse);
    check('run 1: two group steps ran, no error', slow1.steps.length === 2 && !slow1.error && !slow1.partial, slow1);
    const hot = slow1.rows.filter(r => r.sig);
    check('run 1: only the group holding the 120 MB plugin stands out, by about 120 MB', hot.length === 1 && hot[0].members.includes(COSTLY) && Math.abs(hot[0].heap - 119) < 10, hot);
    check('run 1: every plugin is back on, and nothing is left pending', (await fakeState()).length === 12 && (await pending()).length === 0, { on: await fakeState(), pending: await pending() });
    const report1 = await text('vex-discord-measure');
    check('run 1: the report names the members of the group to look into', /Groups that made a difference/.test(await ev(`DiscordPluginRam.sectionText({ fast: null, slow: DiscordPluginRam.last.slow }, null)`)) || /Group 1/.test(report1));

    // ---- 3: the drill-down ----
    await closeWindows();
    await ev(`(() => { const c = CommandBar.commands.find(x => x.id === 'discord-plugin-ram'); setTimeout(() => CommandBar._execute(c), 0); return true; })()`);
    await waitFor(`!!document.getElementById('vex-discord-plugin-ram')`, 'the plugin memory window (second time)');
    await press('One at a time...', '#vex-discord-plugin-ram');
    try { await waitFor(`!!document.getElementById('vex-discord-measure') && document.querySelectorAll('#vex-discord-measure select').length >= 2`, 'the picker (drill-down)', 25000); }
    catch (e) { console.log('DIAG', JSON.stringify(await ev(`({ toasts: window.__toasts.slice(-6), run: DiscordMeasure._run && { finished: DiscordMeasure._run.finished, cancelled: DiscordMeasure._run.cancelled }, busy: DiscordPluginRam._busy, windowOpen: DiscordPluginRam._windowOpen, overlays: ['vex-discord-measure','vex-discord-plugin-ram','vex-activation'].filter(i => document.getElementById(i)), measureText: ((document.getElementById('vex-discord-measure') || {}).textContent || '').slice(0, 300), consoleHint: 'see below' })`)), consoleErrors.slice(-5)); throw e; }
    const drill = await ev(`(() => { const sel = [...document.querySelectorAll('#vex-discord-measure select')]; return { how: sel[0].value, size: sel[1].value, ticked: [...document.querySelectorAll('#vex-discord-measure input[type=checkbox]')].filter(b => b.checked).map(b => b.value), text: document.getElementById('vex-discord-measure').textContent }; })()`);
    check('drill-down: it opens on groups of 4 with only the group’s 8 members ticked', drill.how === 'groups' && drill.size === '4' && drill.ticked.length === 8 && drill.ticked.includes(COSTLY), drill);
    check('drill-down: it says 2 steps', /8 selected in 2 steps/.test(drill.text), drill.text.slice(0, 300));
    await press('Continue', '#vex-discord-measure');
    await waitFor(`/Measure plugin memory in groups/.test(document.body.textContent)`, 'the confirm dialog (drill-down)');
    await press('Start');
    await waitFor(`/Done\\./.test((document.getElementById('vex-discord-measure') || {}).textContent || '')`, 'run 2 to finish', 300000);
    const slow2 = await ev(`JSON.stringify((() => { const s = DiscordPluginRam.last.slow; return DiscordPluginRam.summarize(s).rows.map(r => ({ members: r.members, heap: r.heapDelta, sig: r.sig })); })())`).then(JSON.parse);
    const hot2 = slow2.filter(r => r.sig);
    check('drill-down: it halves the group: one half of 4 holds the costly plugin, the other is clear', slow2.length === 2 && hot2.length === 1 && hot2[0].members.length === 4 && hot2[0].members.includes(COSTLY), slow2);
    check('drill-down: every plugin is back on again', (await fakeState()).length === 12 && (await pending()).length === 0);

    // ---- 4: Stop puts everything back ----
    await closeWindows();
    await ev(`(() => { const c = CommandBar.commands.find(x => x.id === 'discord-plugin-ram'); setTimeout(() => CommandBar._execute(c), 0); return true; })()`);
    await waitFor(`!!document.getElementById('vex-discord-plugin-ram')`, 'the window (third time)');
    await press('One at a time...', '#vex-discord-plugin-ram');
    await waitFor(`!!document.getElementById('vex-discord-measure') && document.querySelectorAll('#vex-discord-measure select').length >= 2`, 'the picker (stop test)');
    await selectOption('How to test', 'groups');
    await selectOption('Group size', '4');
    await press('Continue', '#vex-discord-measure');
    await waitFor(`/Measure plugin memory in groups/.test(document.body.textContent)`, 'the confirm dialog (stop test)');
    await press('Start');
    await waitFor(`/off: (reloading|settling|reading)/.test((document.getElementById('vex-discord-measure') || {}).textContent || '') && DiscordMemory.care().pluginPending.length > 0`, 'a group to be switched off');
    const midOff = (await pending()).length;
    check('while a group is off its members are recorded as pending (so a crash can put them back)', midOff >= 1, midOff);
    // "Hide and keep running": the window goes away, the run goes on, and the rest of Vex can be clicked.
    await press('Hide and keep running', '#vex-discord-measure');
    const hid = await ev(`(() => { const o = document.getElementById('vex-discord-measure'); const at = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return { overlayShown: !!o && o.style.display !== 'none', chip: !!document.getElementById('vex-measure-chip'), busy: !!DiscordPluginRam._busy, blocked: !!(at && at.closest('#vex-discord-measure')) }; })()`);
    check('Hide: the window is gone, a small chip is shown, the run is still going and does not block the page', !hid.overlayShown && hid.chip && hid.busy && !hid.blocked, hid);
    await press('Show', '#vex-measure-chip');
    const shown = await ev(`(() => { const o = document.getElementById('vex-discord-measure'); return { overlayShown: !!o && o.style.display !== 'none', chip: !!document.getElementById('vex-measure-chip') }; })()`);
    check('Show: the window comes back and the chip goes', shown.overlayShown && !shown.chip, shown);
    await press('Hide and keep running', '#vex-discord-measure');
    await press('Stop', '#vex-measure-chip');
    await waitFor(`/Stopped/.test((document.getElementById('vex-discord-measure') || {}).textContent || '')`, 'the run to stop', 120000);
    check('Stop from the chip: the chip is gone', await ev(`!document.getElementById('vex-measure-chip')`));
    await sleep(1500);
    check('Stop: every plugin is back on and nothing is left pending', (await fakeState()).length === 12 && (await pending()).length === 0, { on: await fakeState(), pending: await pending() });

    const bad = consoleErrors.filter(e => /could not be built|is not defined|Could not tell the page it is hidden/.test(e));
    check('no Settings section failed to build and no "could not tell the page" problem appeared', bad.length === 0, bad.slice(0, 3));
  } finally {
    if (cdp) cdp.close();
    harness.dispose(probe);
    server.close();
  }
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  return failed.length ? 1 : 0;
}
if (require.main === module) main().then(code => { process.exitCode = code; }, err => { console.error(err); process.exitCode = 2; });
module.exports = { main };
