// Live Turkish-leftovers scan (part of scripts/turkish-scan/). See scripts/turkish-scan/run.mjs for the order.
// It starts Vex on a THROWAWAY profile with the interface in Turkish, drives it over the debugging port only (no OS input),
// opens each surface and records every visible text, title, placeholder and aria-label that still reads as English.
// Part 3: Ctrl+K palette, toolbar menus/popovers, dialogs, library, help, FAQ, theme pickers.
import fs from 'node:fs';
import { mainPage, scan, save, sleep, TL, OUT, run } from './lib.mjs';
import { targets as tg } from './cdp.mjs';
const s = await mainPage();
const ev = (js) => s.eval(js);
fs.mkdirSync(`${OUT}/shots`, { recursive: true });
const shot = async (name) => { try { await s.shot(`${OUT}/shots/${name}.png`); } catch (e) { console.log('shot failed', name, e.message); } };
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('STEP FAILED', name, '-', String(e.message).slice(0, 200)); } };
const key = async (k, code) => { for (const type of ['keyDown', 'keyUp']) await s.send('Input.dispatchKeyEvent', { type, key: k, code: code || k, windowsVirtualKeyCode: k === 'Escape' ? 27 : 0 }); };
const esc = async () => { await key('Escape'); await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await sleep(300); };
const click = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.click(); return true;})()`);
await ev(`localStorage.setItem('vex.lang','tr'); VexSimpleMode.set('full'); SidebarManager.showPanel('start')`);
await sleep(600);
const before = (await tg(run.port)).length;

// Ctrl+K: empty and several queries
await step('ctrlk', async () => {
  await ev(`CommandBar.open()`); await sleep(700);
  await scan(s, 'Ctrl+K palette (empty query)', { root: '#command-bar' });
  await shot('ctrlk-empty');
  const queries = ['>', '> ', 'settings', 'theme', 'tab', 'history', 'download', 'privacy', 'ai', 'sleep', 'note', 'password', 'bookmark', 'clock', 'sync', 'tor', 'game', 'discord', 'language', 'zoom', 'cache', 'focus', 'help', 'update', 'wallpaper', 'extension', 'split', 'reader', 'print', 'translate'];
  for (const q of queries) {
    await ev(`(()=>{const i=document.getElementById('command-input'); i.focus(); i.value=${JSON.stringify(q)}; i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await sleep(500);
    await scan(s, 'Ctrl+K palette (query results)', { root: '#command-bar', wait: 900 });
  }
  await esc();
});

// Toolbar buttons: click, scan, close
const btns = ['workspace-btn', 'btn-all-features', 'btn-notes-top', 'btn-attention', 'btn-downloads-top', 'btn-extensions', 'btn-routing', 'btn-site-rules', 'btn-page-watch', 'btn-ai-news', 'btn-userscripts', 'btn-toggle-ai', 'btn-split', 'btn-dev-dash', 'btn-settings-top', 'btn-profile', 'btn-toolbar-overflow', 'url-site-btn', 'btn-bookmark', 'btn-look-sidebar'];
for (const b of btns) {
  await step('btn ' + b, async () => {
    const ok = await click('#' + b);
    if (!ok) { console.log('no button', b); return; }
    await sleep(900);
    await scan(s, 'Toolbar: ' + b, { wait: 300 });
    if (b === 'btn-attention') {
      for (let i = 0; i < 3; i++) { await ev(`(()=>{const t=[...document.querySelectorAll('[role="tab"], .inbox-tab')]; if(t[${i}]) t[${i}].click();})()`); await sleep(500); await scan(s, `Inbox hub tab ${i}`, { wait: 300 }); }
      await shot('inbox');
    }
    if (b === 'btn-toolbar-overflow') await shot('overflow-menu');
    await esc();
    await esc();
  });
}
const after = (await tg(run.port)).length;
console.log('targets before/after', before, after);
save('part3.json');
s.close();
process.exit(0);
