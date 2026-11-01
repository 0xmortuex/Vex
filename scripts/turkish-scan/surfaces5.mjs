// Live Turkish-leftovers scan (part of scripts/turkish-scan/). See scripts/turkish-scan/run.mjs for the order.
// It starts Vex on a THROWAWAY profile with the interface in Turkish, drives it over the debugging port only (no OS input),
// opens each surface and records every visible text, title, placeholder and aria-label that still reads as English.
// Part 5: right-click menus (tab strip, page: plain / link / image / selection / text box / video), omnibox dropdown.
import fs from 'node:fs';
import { mainPage, scan, save, sleep, TL, OUT } from './lib.mjs';
const s = await mainPage();
const ev = (js) => s.eval(js);
fs.mkdirSync(`${OUT}/shots`, { recursive: true });
const shot = async (name) => { try { await s.shot(`${OUT}/shots/${name}.png`); } catch (e) { console.log('shot failed', name, e.message); } };
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('STEP FAILED', name, '-', String(e.message).slice(0, 200)); } };
await ev(`localStorage.setItem('vex.lang','tr'); VexSimpleMode.set('full'); SidebarManager.showPanel('start')`);
await sleep(800);
const closeMenus = () => ev(`document.querySelectorAll('.tab-context-menu, .tab-group-context-menu, .context-menu-overlay').forEach(m => m.remove())`);

await step('tab menu', async () => {
  const r = await ev(`(()=>{ const el = document.querySelector('#top-tabs-list [data-tab-id], .tab-item[data-tab-id], .tab[data-tab-id]'); if(!el) return 'no tab element'; const b = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:b.left+20,clientY:b.top+10})); return 'ok'; })()`);
  console.log('tab menu', r);
  await sleep(500);
  await scan(s, 'Tab context menu', { root: '.tab-context-menu', wait: 300 });
  await shot('tab-menu');
  await closeMenus();
});

// A new tab with a real page to right-click: use the start tab's webview
const variants = {
  'plain page': `{x:300,y:300}`,
  'link': `{x:300,y:300,linkURL:'https://example.com/a',linkText:'a link',selectionText:''}`,
  'image': `{x:300,y:300,mediaType:'image',srcURL:'https://example.com/a.png',hasImageContents:true}`,
  'selected text': `{x:300,y:300,selectionText:'some selected words',editFlags:{canCopy:true}}`,
  'text box': `{x:300,y:300,isEditable:true,editFlags:{canCut:true,canCopy:true,canPaste:true,canSelectAll:true,canUndo:true,canRedo:true}}`,
  'misspelled word': `{x:300,y:300,isEditable:true,misspelledWord:'teh',dictionarySuggestions:['the','ten']}`,
  'video': `{x:300,y:300,mediaType:'video',srcURL:'https://example.com/v.mp4'}`,
};
for (const [name, params] of Object.entries(variants)) {
  await step('page menu ' + name, async () => {
    const r = await ev(`(()=>{ const wv = document.querySelector('webview[data-tab-id]'); if(!wv) return 'no webview'; try { WebviewManager.showContextMenu({ params: ${params} }, wv); } catch (e) { return 'ERR ' + e.message; } return 'ok'; })()`);
    console.log('page menu', name, r);
    await sleep(500);
    await scan(s, 'Page context menu (' + name + ')', { root: '.tab-context-menu', wait: 300 });
    if (name === 'link') await shot('page-menu-link');
    await closeMenus();
  });
}

await step('omnibox', async () => {
  await ev(`(()=>{ CommandBar.open(); const i = document.getElementById('command-input'); i.focus(); i.value = 'exam'; i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await sleep(900);
  await scan(s, 'Address bar dropdown', { wait: 300 });
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
});
save('part5.json');
s.close();
process.exit(0);
