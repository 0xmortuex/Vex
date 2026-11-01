// Live Turkish-leftovers scan (part of scripts/turkish-scan/). See scripts/turkish-scan/run.mjs for the order.
// It starts Vex on a THROWAWAY profile with the interface in Turkish, drives it over the debugging port only (no OS input),
// opens each surface and records every visible text, title, placeholder and aria-label that still reads as English.
// Part 2: sidebar panels, toolbar tooltips, overlays/dialogs. Same profile, Turkish.
import fs from 'node:fs';
import { mainPage, scan, save, sleep, results, TL, OUT } from './lib.mjs';
const s = await mainPage();
const ev = (js) => s.eval(js);
fs.mkdirSync(`${OUT}/shots`, { recursive: true });
const shot = async (name) => { try { await s.shot(`${OUT}/shots/${name}.png`); } catch (e) { console.log('shot failed', name, e.message); } };
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('STEP FAILED', name, '-', String(e.message).slice(0, 200)); } };
const esc = async () => { await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); document.activeElement && document.activeElement.blur && document.activeElement.blur();`); await sleep(250); };
await ev(`localStorage.setItem('vex.lang','tr'); VexSimpleMode.set('full')`);
await sleep(500);

// shell again with everything settled (toolbar titles, tab strip)
await step('shell2', async () => { await scan(s, 'shell (settled)', { wait: 1500 }); });

// Sidebar panels (Vex's own, not the web apps)
const panels = ['start', 'notes', 'library', 'annotations', 'recall', 'memory', 'queue', 'downloads', 'bookmarks', 'feeds', 'history', 'authenticator', 'privacy', 'clock', 'devtools-dash', 'shortcuts'];
for (const p of panels) {
  await step('panel ' + p, async () => {
    await ev(`SidebarManager.showPanel('${p}')`);
    await sleep(1200);
    await scan(s, `Sidebar panel: ${p}`, { root: '#panel-' + p, wait: 400 });
    if (['clock', 'privacy', 'library', 'downloads', 'history'].includes(p)) {
      // open each tab/chip of the panel
      const tabs = await ev(`[...document.querySelectorAll('#panel-${p} [role="tab"], #panel-${p} .clock-tab, #panel-${p} .tab-btn, #panel-${p} .panel-tab')].map((b,i)=>i)`);
      for (const i of tabs.slice(0, 12)) {
        await ev(`[...document.querySelectorAll('#panel-${p} [role="tab"], #panel-${p} .clock-tab, #panel-${p} .tab-btn, #panel-${p} .panel-tab')][${i}].click()`);
        await sleep(500);
        await scan(s, `Sidebar panel: ${p} (tab ${i})`, { root: '#panel-' + p, wait: 300 });
      }
    }
    if (p === 'clock') await shot('panel-clock');
  });
}
await step('close panel', async () => { await ev(`SidebarManager.showPanel('start')`); await sleep(500); });
save('part2.json');
s.close();
process.exit(0);
