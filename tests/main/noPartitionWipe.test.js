import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// <userData>\Partitions\<name> is where Electron keeps the session 'persist:<name>'.
// Deleting one at launch signs the user out of everything in it (the Netflix /
// Prime Video / Disney+ panel was wiped on every start until 2026-10-17).
const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');

describe('launch never deletes a live browsing session', () => {
  it('does not remove anything under the Partitions folder', () => {
    expect(main).not.toMatch(/path\.join\([^)]*['"]Partitions['"][^)]*\)/);
  });
  it('does not rmSync a partition', () => {
    expect(main).not.toMatch(/rmSync\([^)]*[Pp]artition/);
  });
});
