// Parse first-party JavaScript and check local script/style references.
// No Electron startup, network access, or user profile required.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const failures = [];
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const runtimeVersion = pkg.devDependencies.electron.split('#v')[1];
if (pkg.build.electronDownload.version !== runtimeVersion) failures.push('package.json: packaged Electron differs from development runtime');
let jsCount = 0, inlineCount = 0, refCount = 0, files = 0, lines = 0;
// Documentation drifts silently: the audit found docs still describing Electron 30
// long after the runtime moved on, and a doc that misstates the runtime is how a
// contributor reintroduces a version-specific bug. Any major Electron version a
// doc names must match the one we actually ship.
const runtimeMajor = runtimeVersion.split('.')[0];
let docsChecked = 0;
for (const doc of fs.readdirSync(root).filter(n => n.endsWith('.md')).map(n => path.join(root, n))
  .concat(fs.existsSync(path.join(root, 'docs')) ? fs.readdirSync(path.join(root, 'docs')).filter(n => n.endsWith('.md')).map(n => path.join(root, 'docs', n)) : [])) {
  const relative = path.relative(root, doc).split(path.sep).join('/');
  // CHANGELOG and the audit/progress records are history: they describe what was
  // true at the time and must keep saying so.
  if (/^(CHANGELOG|RELEASE_NOTES|docs[/](codebase-audit|security-audit|recommendations-progress))/.test(relative)) continue;
  docsChecked++;
  const text = fs.readFileSync(doc, 'utf8');
  for (const match of text.matchAll(/Electron[ 	]+`?v?([0-9]+)(?:[.][0-9]+)*/gi)) {
    if (match[1] !== runtimeMajor) failures.push(relative + ': claims Electron ' + match[1] + ' but the runtime is ' + runtimeVersion);
  }
}
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.name === 'vendor') return [];
    const full = path.join(dir, e.name);
    // Build output (the packaged window's chunks); checked through plan() below.
    if (full === path.join(root, 'build', 'window-bundle')) return [];
    return e.isDirectory() ? walk(full) : [full];
  });
}
for (const file of ['src', 'workers', 'scripts', 'build'].flatMap(d => fs.existsSync(path.join(root, d)) ? walk(path.join(root, d)) : [])) {
  if (!/\.(?:js|html|css|json|toml|nsh)$/.test(file)) continue;
  const source = fs.readFileSync(file, 'utf8');
  const relative = path.relative(root, file);
  files++; lines += source.split(/\r?\n/).length;
  if (file.endsWith('.js')) {
    jsCount++;
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) failures.push(relative + ': ' + (result.stderr || result.error));
  }
  if (!file.endsWith('.html')) continue;
  for (const match of source.matchAll(/<(script|link)\b[^>]*?\b(?:src|href)=["']([^"']+)["'][^>]*>/gi)) {
    const ref = match[2];
    if (/^(?:[a-z]+:|\/\/|#)/i.test(ref) || ref.includes('${')) continue;
    refCount++;
    // The PDF viewer's page is served by main/pdf-viewer.js under its own roots (/css, /app, /icons.js and /lib, which is the vendored
    // pdf.js, built by npm run build:vendor and so not in the source tree).
    if (ref.startsWith('/') && relative.replace(/\\/g, '/') === 'src/renderer/pdf-viewer/viewer.html') {
      const roots = [['/css/', 'src/renderer/css/'], ['/app/', 'src/renderer/pdf-viewer/'], ['/icons.js', 'src/renderer/js/vex-icons.js']];
      if (ref.startsWith('/lib/')) continue;
      const hit = roots.find(([from]) => ref.startsWith(from));
      if (!hit || !fs.existsSync(path.join(root, hit[1] + ref.slice(hit[0].length)))) failures.push(relative + ': missing ' + ref);
      continue;
    }
    // The folder browser's page is served by main/folder-viewer.js under its own roots (/css, /app and /icons.js).
    if (ref.startsWith('/') && relative.replace(/\\/g, '/') === 'src/renderer/folder-viewer/viewer.html') {
      const roots = [['/css/', 'src/renderer/css/'], ['/app/', 'src/renderer/folder-viewer/'], ['/icons.js', 'src/renderer/js/vex-icons.js']];
      const hit = roots.find(([from]) => ref.startsWith(from));
      if (!hit || !fs.existsSync(path.join(root, hit[1] + ref.slice(hit[0].length)))) failures.push(relative + ': missing ' + ref);
      continue;
    }
    if (!fs.existsSync(path.resolve(path.dirname(file), ref.split(/[?#]/)[0]))) failures.push(relative + ': missing ' + ref);
  }
  for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=|type\s*=\s*["'](?:module|application\/(?:ld\+)?json)/i.test(match[1]) || !match[2].trim()) continue;
    inlineCount++;
    try { new vm.Script(match[2], { filename: relative }); }
    catch (err) { failures.push(relative + ': ' + err.message); }
  }
}
// The packaged window loads index.html's scripts as concatenated chunks
// (scripts/window-bundle.js). A new script that would behave differently
// bundled (or could not be bundled) fails here, not in the built app.
const windowBundle = require('./window-bundle.js').plan(root);
for (const problem of windowBundle.problems) failures.push('window-bundle: ' + problem);
// Ratchets (scripts/ratchets.js): no new raw setInterval, no new silent catch.
const ratchets = require('./ratchets.js').check(root);
for (const e of ratchets.errors) failures.push('ratchet: ' + e);
for (const n of ratchets.notes) console.log('ratchet note: ' + n);
// Overlays not on the layer manager (scripts/overlay-census.js): the count may not grow.
const overlayCensus = require('./overlay-census.js').census(root);
const overlayBaseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'overlay-census.json'), 'utf8'));
if (overlayCensus.remainingJs > overlayBaseline.remainingJs) failures.push('overlays: ' + overlayCensus.remainingJs + ' position:fixed overlays are not on the layer manager, the baseline is ' + overlayBaseline.remainingJs + ' (build new ones with VexLayer.open/track/popover; node scripts/overlay-census.js lists them)');
else if (overlayCensus.remainingJs < overlayBaseline.remainingJs) console.log('overlay note: ' + overlayCensus.remainingJs + ' remain (baseline ' + overlayBaseline.remainingJs + '); lower it with node scripts/overlay-census.js --write');
// The start-up budget (scripts/startup-budget.js): blocking scripts may not grow past 15 percent of the budget.
const startupBudget = require('./startup-budget.js').check(root);
for (const e of startupBudget.errors) failures.push(e);
for (const n of startupBudget.notes) console.log('note: ' + n);
const bundledScripts =windowBundle.chunks.reduce((n, c) => n + c.files.length, 0);
console.log(JSON.stringify({ files, lines, jsCount, inlineCount, refCount, docsChecked, windowBundle: `${windowBundle.chunks.length} chunks, ${bundledScripts} scripts`, failures }, null, 2));
process.exitCode = failures.length ? 1 : 0;
