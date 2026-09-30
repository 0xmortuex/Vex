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

// The Android side: every plugin method the bridge calls has to exist, in the
// plugin it calls it on. A chrome that ships a call into a method nobody wrote
// fails at runtime, on a device, with "no such method" — which is exactly the
// class of mistake a check can catch for free.
const bridge = fs.readFileSync(path.join(www, 'js', 'bridge.js'), 'utf8');
const javaFiles = walk(path.join(root, 'android', 'app', 'src', 'main', 'java'))
  .map(file => fs.readFileSync(file, 'utf8'));

const nativeMethods = new Map();   // plugin name -> Set of @PluginMethod names
for (const source of javaFiles) {
  const plugin = source.match(/@CapacitorPlugin\(name = "(\w+)"\)/);
  if (!plugin) continue;
  const methods = new Set([...source.matchAll(/@PluginMethod[\s\S]{0,160}?public void (\w+)\s*\(/g)].map(match => match[1]));
  nativeMethods.set(plugin[1], methods);
}

// call('VexBlock', 'setEnabled', …) and the tabs()/system() shorthands.
const calls = [
  ...[...bridge.matchAll(/call\('(\w+)',\s*'(\w+)'/g)].map(match => [match[1], match[2]]),
  ...[...bridge.matchAll(/\btabs\('(\w+)'/g)].map(match => ['VexTabs', match[1]]),
  ...[...bridge.matchAll(/\bsystem\('(\w+)'/g)].map(match => ['VexSystem', match[1]]),
  ...[...bridge.matchAll(/plugins\.(\w+)\.(\w+)\(\{/g)].map(match => [match[1], match[2]])
];

for (const [plugin, method] of calls) {
  if (['addListener', 'removeAllListeners'].includes(method)) continue;
  checked++;
  const methods = nativeMethods.get(plugin);
  if (!methods) { failures.push('bridge.js calls ' + plugin + '.' + method + '() but no @CapacitorPlugin declares ' + plugin); continue; }
  if (!methods.has(method)) failures.push('bridge.js calls ' + plugin + '.' + method + '() but ' + plugin + ' has no such @PluginMethod');
}

if (failures.length) {
  for (const failure of failures) console.error('FAIL ' + failure);
  process.exit(1);
}
console.log('ok — ' + checked + ' checks passed');
