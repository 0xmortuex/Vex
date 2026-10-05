// Saving settings failed with "Changes could not be saved" when another
// program (Defender, indexing) held the file for a moment: the rename that
// replaces it failed with EPERM and was never retried (found 2026-10-03).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const nodeFs = require('fs');
const { atomicWrite } = require('../../src/main/file-store.js');

const dirs = [];
async function dir() { const d = await fs.mkdtemp(path.join(os.tmpdir(), 'vex-atomic-')); dirs.push(d); return d; }
afterEach(async () => { vi.restoreAllMocks(); for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true }); });

function failing(code, times) {
  const real = nodeFs.promises.rename;
  let left = times;
  return vi.spyOn(nodeFs.promises, 'rename').mockImplementation(async (...args) => {
    if (left-- > 0) { const e = new Error(code + ': locked'); e.code = code; throw e; }
    return real(...args);
  });
}

describe('replacing a file another program holds for a moment', () => {
  for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
    it(`retries ${code} and then writes`, async () => {
      const file = path.join(await dir(), 'prefs.json');
      await fs.writeFile(file, 'old');
      const spy = failing(code, 3);
      await atomicWrite(file, 'new', { retryDelays: [1, 1, 1, 1] });
      expect(await fs.readFile(file, 'utf8')).toBe('new');
      expect(spy).toHaveBeenCalledTimes(4);
      // No temporary file is left behind.
      expect((await fs.readdir(path.dirname(file))).filter(f => f.endsWith('.tmp'))).toEqual([]);
    });
  }

  it('a lock that lasts is still an error, and the old file is untouched', async () => {
    const file = path.join(await dir(), 'prefs.json');
    await fs.writeFile(file, 'old');
    failing('EPERM', 100);
    await expect(atomicWrite(file, 'new', { retryDelays: [1, 1] })).rejects.toMatchObject({ code: 'EPERM' });
    expect(await fs.readFile(file, 'utf8')).toBe('old');
  });

  it('other errors are not retried', async () => {
    const file = path.join(await dir(), 'prefs.json');
    await fs.writeFile(file, 'old');
    const spy = failing('ENOSPC', 1);
    await expect(atomicWrite(file, 'new', { retryDelays: [1, 1, 1] })).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
