// Live Turkish-leftovers scan (part of scripts/turkish-scan/). See scripts/turkish-scan/run.mjs for the order.
// It starts Vex on a THROWAWAY profile with the interface in Turkish, drives it over the debugging port only (no OS input),
// opens each surface and records every visible text, title, placeholder and aria-label that still reads as English.
// Part 1: shell, New Tab page, Settings (normal + developer), sidebar panels. Run after the wizard on the same profile.
import fs from 'node:fs';
import { mainPage, webviewSessions, scan, save, sleep, results, TL, OUT } from './lib.mjs';
const s = await mainPage();
const ev = (js) => s.eval(js);
const shot = async (name) => { try { await s.shot(`${OUT}/shots/${name}.png`); } catch (e) { console.log('shot failed', name, e.message); } };
fs.mkdirSync(`${OUT}/shots`, { recursive: true });
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('STEP FAILED', name, '-', String(e.message).slice(0, 160)); } };

await ev(`localStorage.setItem('vex.lang','tr')`);
// shell
await step('shell', async () => { await scan(s, 'shell (main window)'); await shot('shell'); });

// New Tab page: the webview (start.html)
await step('newtab', async () => {
  for (const w of await webviewSessions()) {
    if (/start\.html/.test(w.url)) {
      await scan(w.s, 'New Tab page (start.html)');
      const full = await w.s.eval(`(()=>{document.querySelectorAll('details').forEach(d=>d.open=true); return document.body.innerText.length})()`);
      await scan(w.s, 'New Tab page (all folds open)', { wait: 600 });
    }
    w.s.close();
  }
});

// Settings, normal then developer mode
const openSettings = async () => { await ev(`(()=>{ SidebarManager.showPanel('settings'); })()`); await sleep(1500); };
for (const mode of ['simple', 'full']) {
  await step('settings ' + mode, async () => {
    await ev(`VexSimpleMode.set('${mode}')`); await sleep(1200);
    await openSettings();
    await ev(`(()=>{document.querySelectorAll('#panel-settings details').forEach(d=>d.open=true); document.querySelectorAll('#panel-settings [aria-expanded="false"]').forEach(b=>{ if(/rare|more|advanced/i.test(b.textContent)) b.click(); }); })()`);
    await sleep(800);
    await scan(s, `Settings (${mode === 'simple' ? 'Normal' : 'Developer'} mode, visible)`, { root: '#panel-settings' });
    await scan(s, `Settings (${mode === 'simple' ? 'Normal' : 'Developer'} mode, all hidden text too)`, { root: '#panel-settings', all: true });
    await shot('settings-' + mode);
  });
}
save('part1.json');
s.close();
process.exit(0);
