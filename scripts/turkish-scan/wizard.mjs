// Live Turkish-leftovers scan (part of scripts/turkish-scan/). See scripts/turkish-scan/run.mjs for the order.
// It starts Vex on a THROWAWAY profile with the interface in Turkish, drives it over the debugging port only (no OS input),
// opens each surface and records every visible text, title, placeholder and aria-label that still reads as English.
// Walk the setup wizard (Turkish) step by step, scanning each step. Run on a FRESH profile.
import { mainPage, scan, save, sleep, results } from './lib.mjs';
const mode = process.argv[2] || 'full';   // 'full' | 'short'
const s = await mainPage();
const click = (sel) => s.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.click(); return true;})()`);
const stepNo = () => s.eval(`(()=>{const o=document.getElementById('vex-onboarding'); if(!o) return null; const m=/(\\d+)\\s*[\\/]\\s*(\\d+)|(\\d+) of (\\d+)/.exec(o.innerText); return m?m[0]:o.innerText.slice(0,20);})()`);
await s.eval(`localStorage.setItem('vex.lang','tr')`);
await click('#ob-lang button:nth-child(2)');
await sleep(500);
await scan(s, 'wizard 0 privacy gate');
await click('#ob-next');
await sleep(700);
// step 1 chooses short vs full length
await scan(s, 'wizard 1 length choice');
await s.eval(`(()=>{const b=[...document.querySelectorAll('#vex-onboarding button')].filter(b=>/${mode === 'short' ? 'Yalnızca' : 'Her şey'}/.test(b.textContent)); if(b[0]) b[0].click();})()`);
await sleep(300);
await click('#ob-next');
await sleep(800);
let last = null;
for (let i = 2; i < 40; i++) {
  const no = await stepNo();
  if (no === null) { console.log('wizard finished before step', i); break; }
  await scan(s, `wizard ${mode} step ${i} (${no})`);
  const dump = await s.eval(`document.getElementById('vex-onboarding').innerText.replace(/\\s+/g,' ').slice(0,90)`);
  console.log(i, no, '|', dump);
  await click('#ob-next');
  await sleep(900);
  let after = await stepNo();
  if (after === no) { await click('#ob-skip'); await sleep(900); after = await stepNo(); }
  if (after === no) { console.log('STUCK at', no); break; }
}
save('wizard-' + mode + '.json');
s.close();
process.exit(0);
