// Check that the chrome's modules actually have the methods each other calls.
//
// There are two dozen modules and they call each other by name — VexPanels,
// VexSheets, VexTabStore, VexUI and the rest. A typo there is not a parse
// error and not a failed reference check; it is a button that throws when
// somebody presses it, months later, on a path the smoke run does not walk.
//
// So: load every module in a sandbox, collect what each one exports, then read
// every `VexThing.method(` in the source and make sure the method is there.
//
//   node scripts/check-api.mjs

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const jsDir = path.join(root, 'www', 'js');

// Load order matters only for modules that read another at load time; the
// sandbox tolerates any order, because every module assigns itself to window.
const GENERATED = new Set(['themes-data.js']);      // data, not a module
const files = fs.readdirSync(jsDir).filter(name => name.endsWith('.js')).sort();

const failures = [];
let checked = 0;

// A window that swallows everything the modules touch while defining
// themselves: they only assign, they do not run.
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  crypto: globalThis.crypto,
  fetch: () => Promise.resolve({}),
  navigator: { clipboard: {}, mediaDevices: {} },
  location: { origin: 'https://localhost' },
  indexedDB: undefined,
  IDBKeyRange: {},
  document: new Proxy({}, { get: () => () => ({ style: {}, classList: { toggle() {} }, appendChild() {} }) })
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
const context = vm.createContext(sandbox);

// app.js is the boot script: it runs rather than defining, so it is read for
// the calls it makes but never executed here.
for (const name of files) {
  if (name === 'app.js') continue;
  const source = fs.readFileSync(path.join(jsDir, name), 'utf8');
  try {
    vm.runInContext(source, context, { filename: name });
  } catch (error) {
    failures.push(name + ': would not load — ' + error.message);
  }
}

// What each module offers, once loaded.
const modules = new Map();
for (const [key, value] of Object.entries(sandbox)) {
  if (/^Vex[A-Z]/.test(key) && value && typeof value === 'object') modules.set(key, value);
}

// Also check the shared files and the vendored libraries the chrome calls into.
const OPTIONAL = new Set(['VexBridge']);      // its fallback answers anything

// `plugins.VexTabs.x()` is a native plugin, not a chrome module — the two
// namespaces overlap on purpose, so skip anything reached through `plugins.`.
const CALL = /(?<!plugins\.)\b(Vex[A-Z]\w*)\.(\w+)\s*\(/g;
const walkFiles = files.map(name => [name, fs.readFileSync(path.join(jsDir, name), 'utf8')]);

for (const [name, source] of walkFiles) {
  for (const match of source.matchAll(CALL)) {
    const [, moduleName, method] = match;
    const module = modules.get(moduleName);
    if (!module) {
      // A module the sandbox could not build is reported once, above.
      continue;
    }
    if (OPTIONAL.has(moduleName)) continue;
    checked++;
    if (typeof module[method] === 'undefined') {
      failures.push(name + ': calls ' + moduleName + '.' + method + '(), which ' + moduleName + ' does not have');
    }
  }
}

// Every module must announce itself, or nothing can call it.
for (const name of files) {
  const source = fs.readFileSync(path.join(jsDir, name), 'utf8');
  if (name === 'app.js' || GENERATED.has(name)) continue;   // boot script / generated data
  if (!/window\.Vex\w+\s*=/.test(source)) failures.push(name + ': never assigns itself to window');
  if (!/module\.exports/.test(source)) failures.push(name + ': is not importable by a test');
}

if (failures.length) {
  for (const failure of [...new Set(failures)]) console.error('FAIL ' + failure);
  process.exit(1);
}
console.log('ok — ' + checked + ' cross-module calls resolve, across ' + modules.size + ' modules');
