#!/usr/bin/env node
// Overlay census (T2-014): how many script files that build a position:fixed overlay are on the layer manager
// (js/vex-layer.js) and how many are not yet, counted from the source. A script is "on the layer manager" when it
// references VexLayer itself. Overlays built through a shared helper are on it at the helper, in one place, and
// need nothing in the files that call the helper:
//   vexConfirm / vexAlert / vexPrompt   dialogs (js/vex-dialog.js, tier dialog)
//   showToast                           the toast container (js/app.js, tier toast)
//   _attachMenuDismissal                context menus and their click-catching backdrop (js/tabs.js, tier menu)
//   VexSettingsGroups.dialog            Settings dialogs (js/vex-settings-groups.js, tier dialog)
// The scripts listed as NOT on it still hold their own z-index and their own cleanup; the click sweep
// (node scripts/check-ui.js --sweep) is what catches one that is left behind.
//
//   node scripts/overlay-census.js           the totals and the files not on the layer manager
//   node scripts/overlay-census.js --json    the same as JSON
//   node scripts/overlay-census.js --check   fails when the number of overlays not on the layer manager GROWS
//                                            past scripts/overlay-census.json (a ratchet: lower it with --write)
//   node scripts/overlay-census.js --write   rewrites the baseline from the tree
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['src/renderer/js', 'src/renderer/css'];
const BASELINE = path.join(__dirname, 'overlay-census.json');
const FIXED = /position\s*:\s*fixed/g;
const HELPERS = /\bVexLayer\b/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

function census(root = ROOT) {
  const rows = [];
  for (const d of DIRS) {
    for (const file of walk(path.join(root, d))) {
      const src = fs.readFileSync(file, 'utf8');
      const n = (src.match(FIXED) || []).length;
      if (!n) continue;
      const rel = path.relative(root, file).replace(/\\/g, '/');
      const isJs = rel.endsWith('.js');
      rows.push({ file: rel, fixed: n, onLayer: isJs && HELPERS.test(src) });
    }
  }
  const sum = (f) => rows.filter(f).reduce((a, r) => a + r.fixed, 0);
  return {
    total: sum(() => true),
    onLayer: sum(r => r.onLayer),
    // JS files that build an overlay and are not on the layer manager, and stylesheets (the rules those overlays use).
    remainingJs: sum(r => !r.onLayer && r.file.endsWith('.js')),
    remainingJsFiles: rows.filter(r => !r.onLayer && r.file.endsWith('.js')).length,
    css: sum(r => r.file.endsWith('.css')),
    rows,
  };
}

if (require.main === module) {
  const arg = process.argv[2] || '';
  const c = census();
  if (arg === '--json') console.log(JSON.stringify(c, null, 2));
  else if (arg === '--write') { fs.writeFileSync(BASELINE, JSON.stringify({ remainingJs: c.remainingJs, remainingJsFiles: c.remainingJsFiles }, null, 2) + '\n'); console.log('baseline written', c.remainingJs, c.remainingJsFiles); }
  else if (arg === '--check') {
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    if (c.remainingJs > base.remainingJs) { console.error(`overlay census: ${c.remainingJs} position:fixed overlays are not on the layer manager, the baseline is ${base.remainingJs}. Build new overlays through VexLayer (open/track/popover) or a helper that does.`); process.exit(1); }
    console.log(`overlay census ok: ${c.remainingJs} not on the layer manager (baseline ${base.remainingJs})`);
  } else {
    console.log(`position:fixed in the renderer: ${c.total} (${c.css} in stylesheets)`);
    console.log(`script files that reference VexLayer (position:fixed counted there): ${c.onLayer}`);
    console.log(`not on the layer manager yet: ${c.remainingJs} in ${c.remainingJsFiles} script files (overlays built through the shared dialog, toast and context-menu helpers are on it at the helper)`);
    for (const r of c.rows.filter(x => !x.onLayer && x.file.endsWith('.js')).sort((a, b) => b.fixed - a.fixed)) console.log(`  ${String(r.fixed).padStart(3)}  ${r.file}`);
  }
}

module.exports = { census };
