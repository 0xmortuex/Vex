// One temp root per test run, deleted when the run ends.
//
// A dozen test files make temp folders (vex-sidebar-cfg-*, vex-vault-*,
// vex-vencord-*, …) and three of them never removed theirs. After two weeks
// there were 4,761 such folders — 8.5 GB — in the user's Temp. Rather than
// trust every test, present and future, to clean up, the whole run gets its
// own root: os.tmpdir() reads TEMP/TMP/TMPDIR, the workers inherit them, and
// the root goes when the run does.
import fs from 'fs';
import os from 'os';
import path from 'path';

const PREFIX = 'vex-tests-';
const STALE_MS = 60 * 60 * 1000;
const rm = (dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });

export default function setup() {
  const real = os.tmpdir();
  // A run that was killed never reached its teardown: sweep roots over an hour old.
  for (const name of fs.readdirSync(real)) {
    if (!name.startsWith(PREFIX)) continue;
    const dir = path.join(real, name);
    try { if (Date.now() - fs.statSync(dir).mtimeMs > STALE_MS) rm(dir); } catch { /* in use by another run, or already gone */ }
  }
  const root = fs.mkdtempSync(path.join(real, PREFIX));
  const saved = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  process.env.TEMP = process.env.TMP = process.env.TMPDIR = root;
  return () => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rm(root);
  };
}
