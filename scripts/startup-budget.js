// The start-up budget (T3-066), run by `npm run check:source` (scripts/verify-source.js).
//
// Every blocking <script src> in src/renderer/index.html is parsed and run before
// the window is usable. This counts them and adds up their bytes, and fails when
// either has grown more than 15 percent past the figures in
// scripts/startup-budget.json. A feature that does not have to exist at first
// paint is listed in VexBoot.LATE_MODULES (js/lazy-boot.js) instead, and loads
// after the window's load event.
//
// It also checks the late list itself: every file exists, none is also a
// blocking tag (it would load twice), and the usage ids it names are in the
// usage registry.
//
//   node scripts/startup-budget.js            check
//   node scripts/startup-budget.js --tighten  write the current figures (only ever lower)
//
// Pure functions are exported for tests/main/startupBudget.test.js.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUDGET_FILE = path.join(__dirname, 'startup-budget.json');
const GROWTH = 0.15;

function blockingScripts(html) {
  const out = [];
  const stripped = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of stripped.matchAll(/<script\b([^>]*)>\s*<\/script\s*>/gi)) {
    const src = /^\s*src="([^"]+)"\s*$/.exec(m[1]);
    if (src && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(src[1])) out.push(src[1]);
  }
  return out;
}

function measure(root = ROOT) {
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const scripts = blockingScripts(html);
  let bytes = 0;
  for (const s of scripts) {
    const file = path.join(root, 'src/renderer', s);
    if (!fs.existsSync(file)) throw new Error('index.html loads ' + s + ', which does not exist');
    bytes += fs.statSync(file).size;
  }
  return { scripts: scripts.length, bytes, list: scripts };
}

// The late list, read from the source (no code is run).
function lateModules(root = ROOT) {
  const src = fs.readFileSync(path.join(root, 'src/renderer/js/lazy-boot.js'), 'utf8');
  const out = [];
  for (const m of src.matchAll(/\{\s*src:\s*'(js\/[^']+)'\s*,\s*usage:\s*\[([^\]]*)\]\s*\}/g)) {
    out.push({ src: m[1], usage: [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1]) });
  }
  return out;
}

function check(root = ROOT, budget) {
  const errors = [];
  const notes = [];
  const b = budget || JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'));
  const now = measure(root);
  for (const [name, label] of [['scripts', 'blocking scripts'], ['bytes', 'bytes of blocking scripts']]) {
    const limit = Math.floor(b[name] * (1 + GROWTH));
    if (now[name] > limit) errors.push('start-up budget: ' + now[name] + ' ' + label + ' is more than 15% over the budget of ' + b[name] + ' (limit ' + limit + '). Load the new feature late (VexBoot.LATE_MODULES in js/lazy-boot.js) or lower something else.');
    else if (now[name] < b[name] * 0.95) notes.push('start-up budget: ' + label + ' are ' + now[name] + ', under the budget of ' + b[name]  + '; run node scripts/startup-budget.js --tighten');
  }
  const late = lateModules(root);
  if (!late.length) errors.push('start-up budget: could not read VexBoot.LATE_MODULES from js/lazy-boot.js');
  const usageSrc = fs.readFileSync(path.join(root, 'src/renderer/js/vex-usage-registry.js'), 'utf8');
  for (const m of late) {
    if (!fs.existsSync(path.join(root, 'src/renderer', m.src))) errors.push('start-up budget: the late module ' + m.src + ' does not exist');
    if (now.list.includes(m.src)) errors.push('start-up budget: ' + m.src + ' is in the late list AND a blocking tag in index.html: it would load twice');
    for (const id of m.usage) if (!usageSrc.includes("['" + id + "'")) errors.push('start-up budget: the late module ' + m.src + ' names usage id "' + id + '", which the usage registry does not have');
  }
  return { errors, notes, now, late };
}

function tighten(root = ROOT) {
  const now = measure(root);
  const old = fs.existsSync(BUDGET_FILE) ? JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8')) : null;
  const next = { scripts: old ? Math.min(old.scripts, now.scripts) : now.scripts, bytes: old ? Math.min(old.bytes, now.bytes) : now.bytes };
  fs.writeFileSync(BUDGET_FILE, JSON.stringify(next, null, 2) + '\n');
  return next;
}

if (require.main === module) {
  if (process.argv.includes('--tighten')) { console.log('budget now', JSON.stringify(tighten())); }
  else {
    const r = check();
    for (const n of r.notes) console.log(n);
    for (const e of r.errors) console.error(e);
    console.log(JSON.stringify({ scripts: r.now.scripts, bytes: r.now.bytes, late: r.late.map(m => m.src) }));
    process.exitCode = r.errors.length ? 1 : 0;
  }
}

module.exports = { blockingScripts, measure, lateModules, check, tighten, GROWTH };
