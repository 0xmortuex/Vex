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
    if (!fs.existsSync(path.resolve(path.dirname(file), ref.split(/[?#]/)[0]))) failures.push(relative + ': missing ' + ref);
  }
  for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=|type\s*=\s*["'](?:module|application\/(?:ld\+)?json)/i.test(match[1]) || !match[2].trim()) continue;
    inlineCount++;
    try { new vm.Script(match[2], { filename: relative }); }
    catch (err) { failures.push(relative + ': ' + err.message); }
  }
}
console.log(JSON.stringify({ files, lines, jsCount, inlineCount, refCount, docsChecked, failures }, null, 2));
process.exitCode = failures.length ? 1 : 0;
