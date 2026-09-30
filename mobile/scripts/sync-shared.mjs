// Copy the files the phone and the desktop must agree on byte for byte.
//
// Sync is end-to-end encrypted and conflict-resolved with version vectors. If
// the phone's copy of either the crypto or the record merge drifts from the
// desktop's, the failure is not a build error — it is a device that silently
// cannot read the other's data, or worse, one that writes records the other
// discards. So they are copied, not reimplemented, and `npm run check` fails
// when the copy is stale.
//
//   node scripts/sync-shared.mjs [--check]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const from = path.join(root, '..', 'src', 'renderer', 'js');
const to = path.join(root, 'www', 'js', 'shared');

const FILES = ['sync-crypto.js', 'sync-records.js'];

const header = name => '// Copied verbatim from src/renderer/js/' + name + ' by scripts/sync-shared.mjs.\n'
  + '// Do not edit here — the phone and the desktop have to agree on this file\n'
  + '// exactly, or they cannot read each other’s synced data.\n';

fs.mkdirSync(to, { recursive: true });
let stale = [];
for (const name of FILES) {
  const source = fs.readFileSync(path.join(from, name), 'utf8');
  const wanted = header(name) + source;
  const target = path.join(to, name);
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  if (current === wanted) continue;
  if (process.argv.includes('--check')) stale.push(name);
  else fs.writeFileSync(target, wanted);
}

if (process.argv.includes('--check')) {
  if (stale.length) {
    console.error('FAIL shared sync files are stale (' + stale.join(', ') + ') — run `npm run shared`');
    process.exit(1);
  }
  console.log('ok — shared sync files match the desktop');
} else {
  console.log('wrote ' + FILES.length + ' shared files into www/js/shared');
}
