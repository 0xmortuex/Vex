// Live Turkish-leftovers scan (part of scripts/turkish-scan/). See scripts/turkish-scan/run.mjs for the order.
// It starts Vex on a THROWAWAY profile with the interface in Turkish, drives it over the debugging port only (no OS input),
// opens each surface and records every visible text, title, placeholder and aria-label that still reads as English.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { targets, Session, sleep } from './cdp.mjs';
import { looksEnglish } from './english.mjs';

export const TL = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'));   // this folder
export const OUT = process.env.TURKISH_SCAN_OUT || path.join(os.tmpdir(), 'vex-turkish-scan');   // run.json, results, screenshots
fs.mkdirSync(OUT, { recursive: true });
export const WT = path.resolve(TL, '..', '..');   // the repo this was started from
const require = createRequire(import.meta.url);
// The Turkish table, loaded from the worktree (module.exports works without a window).
const { VexI18nUI } = require(WT + '/src/renderer/js/i18n-ui.js');
export const TABLE = VexI18nUI.TABLE.tr;
export const lookupTr = (t) => VexI18nUI.lookup(t, 'tr');
export const trValues = new Set(Object.values(TABLE));   // text that is already Turkish (a word like Notlar is plain ASCII)
const SCAN = fs.readFileSync(path.join(TL, 'scan-inpage.js'), 'utf8');

export const run = (fs.existsSync(path.join(OUT, 'run.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'run.json'))) : null);
export async function mainPage() {
  const t = await targets(run.port);
  const page = t.find(x => x.type === 'page' && /index\.html/.test(x.url));
  return new Session(page.webSocketDebuggerUrl).open();
}
export async function webviewSessions() {
  const t = await targets(run.port);
  const out = [];
  for (const x of t.filter(x => x.type === 'webview' || (x.type === 'page' && !/index\.html|devtools/.test(x.url)))) {
    try { out.push({ url: x.url, s: await new Session(x.webSocketDebuggerUrl).open() }); } catch { /* target went away */ }
  }
  return out;
}

export const results = [];     // {surface, k, t, sc, w, c, cls}
const seenGlobal = new Set();
// cls: 'table-not-applied' (entry exists but shown English) | 'no-entry'
export function classify(it) {
  if (!looksEnglish(it.t) || trValues.has(it.t)) return null;
  const tr = lookupTr(it.t);
  if (tr != null && tr !== it.t) return 'table-not-applied';
  return 'no-entry';
}
export async function scan(sess, surface, extra = {}) {
  await sleep(extra.wait || 450);
  // The observer translates on the next animation frame, and a window that is hidden behind others gets none: run the same pass by hand.
  try { await sess.eval('window.VexI18nUI ? VexI18nUI.apply() : 0'); } catch { /* not a Vex document */ }
  const items = await sess.eval(SCAN + '(' + JSON.stringify({ root: extra.root, all: extra.all }) + ')');
  let n = 0, total = items.length;
  for (const it of items) {
    const cls = classify(it);
    if (!cls) continue;
    const key = surface + '|' + it.k + '|' + it.t;
    if (seenGlobal.has(key)) continue;
    seenGlobal.add(key);
    results.push({ surface, ...it, cls, ...extra });
    n++;
  }
  console.log(`[scan] ${surface}: ${total} strings, ${n} English`);
  return n;
}
export function save(file = 'results.json') { fs.writeFileSync(path.join(OUT, file), JSON.stringify(results, null, 1)); }
export { sleep };
