// Live Turkish-leftovers scan (part of scripts/turkish-scan/). See scripts/turkish-scan/run.mjs for the order.
// Part 6: the sidebar panels the first parts skip (web-app panels, AI panel), the site panel, the tab and page right-click menus,
// the address-bar dropdown, the inbox hub, the clock tabs and the "More from the creator" screen. Same profile, Turkish.
import fs from 'node:fs';
import { mainPage, scan, save, sleep, OUT } from './lib.mjs';
const s = await mainPage();
const ev = (js) => s.eval(js);
fs.mkdirSync(`${OUT}/shots`, { recursive: true });
const shot = async (name) => { try { await s.shot(`${OUT}/shots/${name}.png`); } catch (e) { console.log('shot failed', name, e.message); } };
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('STEP FAILED', name, '-', String(e.message).slice(0, 200)); } };
const esc = async () => { await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); document.activeElement && document.activeElement.blur && document.activeElement.blur();`); await sleep(250); };
await ev(`localStorage.setItem('vex.lang','tr'); VexSimpleMode.set('full')`);
await sleep(500);

for (const p of ['whatsapp', 'spotify', 'netflix', 'discord', 'github', 'claude', 'roblox']) {
  await step('panel ' + p, async () => {
    await ev(`SidebarManager.showPanel('${p}')`);
    await sleep(1500);
    await scan(s, `Sidebar panel: ${p}`, { root: '#panel-' + p, wait: 400 });
    await shot('panel-' + p);
  });
}
await ev(`SidebarManager.showPanel('start')`); await sleep(500);

// AI panel
await step('ai panel', async () => {
  await ev(`document.getElementById('btn-toggle-ai').click()`); await sleep(1200);
  await scan(s, 'AI panel', { wait: 500 });
  await shot('ai-panel');
  await ev(`document.getElementById('btn-toggle-ai').click()`); await sleep(500);
});

// Inbox hub: three tabs
await step('inbox hub', async () => {
  await ev(`(()=>{const b=document.getElementById('btn-attention'); if(b){ b.hidden=false; b.click(); }})()`); await sleep(900);
  await scan(s, 'Inbox hub', { wait: 400 });
  for (let i = 0; i < 4; i++) { await ev(`(()=>{const t=[...document.querySelectorAll('[role="tab"]')]; if(t[${i}]) t[${i}].click();})()`); await sleep(500); await scan(s, `Inbox hub tab ${i}`, { wait: 300 }); }
  await shot('inbox-hub');
  await esc(); await esc();
});

// Clock panel: every tab, with the Reminders tab
await step('clock', async () => {
  await ev(`SidebarManager.showPanel('clock')`); await sleep(1000);
  const n = await ev(`document.querySelectorAll('#panel-clock button').length`);
  const labels = await ev(`[...document.querySelectorAll('#panel-clock button')].map(b => (b.textContent||b.title||'').trim().slice(0,30))`);
  console.log('clock buttons', n, JSON.stringify(labels));
  for (let i = 0; i < Math.min(n, 14); i++) {
    await ev(`(()=>{const b=document.querySelectorAll('#panel-clock button')[${i}]; if(b && !/delete|clear|remove|sil|temizle/i.test((b.textContent||'')+(b.title||''))) b.click();})()`);
    await sleep(350);
    await scan(s, `Clock panel (button ${i})`, { root: '#panel-clock', wait: 250 });
  }
  await ev(`SidebarManager.showPanel('start')`);
});

// Site panel (the lock icon in the address bar)
await step('site panel', async () => {
  await ev(`typeof SitePanel !== 'undefined' && SitePanel.open()`); await sleep(900);
  await scan(s, 'Site panel', { wait: 400 });
  await ev(`document.querySelectorAll('.site-panel button, .site-panel summary').forEach((b,i)=>{ if (i<8 && b.tagName==='SUMMARY') b.click(); })`);
  await scan(s, 'Site panel (expanded)', { wait: 400 });
  await shot('site-panel');
  await esc(); await esc();
});

// Right-click menu on a tab
await step('tab context menu', async () => {
  await ev(`(()=>{const t=document.querySelector('.tab'); if(t) t.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:200,clientY:60,button:2}));})()`);
  await sleep(600);
  await scan(s, 'Tab context menu', { wait: 300 });
  await shot('tab-context-menu');
  await esc(); await esc();
});

// Address-bar dropdown
await step('address bar', async () => {
  await ev(`(()=>{const i=document.getElementById('url-input'); i.focus(); i.value='ex'; i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(900);
  await scan(s, 'Address bar dropdown', { wait: 300 });
  await shot('address-dropdown');
  await esc();
});

// More from the creator / library / help
await step('creator', async () => {
  await ev(`(()=>{ const f=[...document.querySelectorAll('button,a')].find(b=>/creator/i.test(b.textContent||b.title||'')); if(f) f.click(); })()`);
  await sleep(900);
  await scan(s, 'More from the creator', { wait: 300 });
  await esc(); await esc();
});

save('part6.json');
s.close();
process.exit(0);
