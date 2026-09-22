// Parse-check every chrome script and confirm index.html only references files
// that exist. The desktop app has scripts/verify-source.js doing this for src/;
// this is the same check for the mobile chrome, which ships the same way (no
// bundler, plain <script> tags in load order).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const www = path.join(root, 'www');
const failures = [];
let checked = 0;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

for (const file of walk(www)) {
  const relative = path.relative(root, file);
  if (file.endsWith('.js')) {
    checked++;
    try { new vm.Script(fs.readFileSync(file, 'utf8'), { filename: relative }); }
    catch (err) { failures.push(relative + ': ' + err.message); }
  }
  if (!file.endsWith('.html')) continue;
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/gi)) {
    const ref = match[1];
    if (/^(?:[a-z]+:|\/\/|#)/i.test(ref)) continue;
    checked++;
    if (!fs.existsSync(path.resolve(path.dirname(file), ref.split(/[?#]/)[0]))) {
      failures.push(relative + ': missing ' + ref);
    }
  }
}

// The Android side: every plugin the bridge calls must exist in Java, or the
// chrome would ship calls into a plugin nobody registered.
const bridge = fs.readFileSync(path.join(www, 'js', 'bridge.js'), 'utf8');
for (const plugin of ['VexTabs', 'VexBlock']) {
  if (!bridge.includes(plugin)) continue;
  const java = walk(path.join(root, 'android', 'app', 'src', 'main', 'java'))
    .some(file => fs.readFileSync(file, 'utf8').includes('name = "' + plugin + '"'));
  checked++;
  if (!java) failures.push('bridge.js calls ' + plugin + ' but no @CapacitorPlugin declares it');
}

if (failures.length) {
  for (const failure of failures) console.error('FAIL ' + failure);
  process.exit(1);
}
console.log('ok — ' + checked + ' checks passed');
