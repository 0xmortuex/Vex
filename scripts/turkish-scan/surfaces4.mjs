// Live Turkish-leftovers scan (part of scripts/turkish-scan/). See scripts/turkish-scan/run.mjs for the order.
// It starts Vex on a THROWAWAY profile with the interface in Turkish, drives it over the debugging port only (no OS input),
// opens each surface and records every visible text, title, placeholder and aria-label that still reads as English.
// Part 4: Library, FAQ, help, pickers, stores, centres, dialogs, tab menu, vex:// pages.
import fs from 'node:fs';
import { mainPage, scan, save, sleep, TL, OUT, run, webviewSessions } from './lib.mjs';
import { targets as tg } from './cdp.mjs';
const s = await mainPage();
const ev = (js) => s.eval(js);
fs.mkdirSync(`${OUT}/shots`, { recursive: true });
const shot = async (name) => { try { await s.shot(`${OUT}/shots/${name}.png`); } catch (e) { console.log('shot failed', name, e.message); } };
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('STEP FAILED', name, '-', String(e.message).slice(0, 200)); } };
const key = async (k) => { for (const type of ['keyDown', 'keyUp']) await s.send('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: k === 'Escape' ? 27 : 0 }); };
const esc = async () => { await key('Escape'); await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await sleep(300); };
await ev(`localStorage.setItem('vex.lang','tr'); VexSimpleMode.set('full'); SidebarManager.showPanel('start')`);
await sleep(600);
const opens = [
  ['All features library', `FeatureLibrary.open()`],
  ['FAQ / Help', `VexFaq.open()`],
  ['DRM help', `typeof VexDrmHelp!=='undefined'?VexDrmHelp.open():DrmHelp.open()`],
  ['Theme picker', `ThemePicker.open()`],
  ['Theme packs', `typeof ThemePackUI!=='undefined'&&ThemePackUI.open()`],
  ['Profiles', `ProfilesUI.open()`],
  ['Inbox hub (Inbox)', `InboxHub.open('notices')`],
  ['Inbox hub (Reminders)', `InboxHub.open('reminders')`],
  ['Unblock centre', `UnblockCentre.openCentre()`],
  ['Site panel', `SitePanel.open()`],
  ['Wallpaper store', `typeof WallpaperStoreUI!=='undefined'&&WallpaperStoreUI.open()`],
  ['Share my look', `typeof ShareLookUI!=='undefined'&&ShareLookUI.open?.()`],
  ['Dialog vexConfirm', `vexConfirm({title:'Delete everything?', message:'This cannot be undone.'})`],
  ['Dialog vexPrompt', `vexPrompt({title:'Name this', label:'Name'})`],
  ['Toast', `window.showToast('Saved', 'info', 20000)`],
];
for (const [name, js] of opens) {
  await step(name, async () => {
    const r = await s.send('Runtime.evaluate', { expression: `(()=>{try{ const p=(${js}); return 'ok'; }catch(e){ return 'ERR '+e.message; }})()`, awaitPromise: false, returnByValue: true });
    console.log(name, '->', r.result.value);
    await sleep(1400);
    await scan(s, name, { wait: 300 });
    await shot('s4-' + name.replace(/\W+/g, '-'));
    await esc(); await esc();
    await ev(`document.querySelectorAll('.vexd-card [data-close], .vexd-card button').forEach(b=>{ if(/cancel|close|iptal|kapat/i.test(b.textContent)) b.click(); })`);
    await sleep(300);
  });
}
console.log('targets now', (await tg(run.port)).length);
save('part4.json');
s.close();
process.exit(0);
