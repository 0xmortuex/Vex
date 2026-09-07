import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(import.meta.url);
const { validateZip, safeEntry, verifyDigest, extractTar, LIMITS } = require('../../src/main/archive-security.js');
const entry = (name, size = 10, compressedSize = 10) => ({ entryName: name, header: { size, compressedSize }, attr: 0 });
it('rejects traversal, NTFS streams, device names, and duplicate Windows paths', () => {
  for (const name of ['../x', '/etc/x', 'x\\y', 'file:stream', 'CON.txt', 'a/../b', 'file.']) expect(() => safeEntry(name)).toThrow();
  expect(() => validateZip({ getEntries: () => [entry('File'), entry('file')] })).toThrow('Duplicate');
});
it('rejects expansion bombs, oversized entries and links before decompression', () => {
  for (const e of [entry('a', 10000, 1), entry('a', LIMITS.entry + 1), { ...entry('a'), attr: 0o120000 << 16 }]) expect(() => validateZip({ getEntries: () => [e] })).toThrow();
});
it('rejects a download when its pinned digest does not match', () => {
  expect(() => verifyDigest(Buffer.from('malicious replacement'), 'a'.repeat(64))).toThrow('integrity');
});
it('extracts a real tar and stops before writing entries that exceed limits', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vex-tar-'));
  try {
    await fs.writeFile(path.join(root, 'one'), '1234567890');
    const file = path.join(root, 'test.tar');
    await require('tar').c({ file, cwd: root }, ['one']);
    await extractTar(file, path.join(root, 'good'));
    expect(await fs.readFile(path.join(root, 'good', 'one'), 'utf8')).toBe('1234567890');
    await expect(extractTar(file, path.join(root, 'bad'), { ...LIMITS, entry: 5 })).rejects.toThrow('expansion');
    await expect(fs.access(path.join(root, 'bad'))).rejects.toThrow();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
it('refuses an existing directory junction in the extraction destination', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vex-tar-link-'));
  try {
    await fs.mkdir(path.join(root, 'source', 'nested'), { recursive: true });
    await fs.writeFile(path.join(root, 'source', 'nested', 'one'), 'content');
    const file = path.join(root, 'test.tar');
    await require('tar').c({ file, cwd: path.join(root, 'source') }, ['nested']);
    await fs.mkdir(path.join(root, 'outside'));
    await fs.mkdir(path.join(root, 'target'));
    await fs.symlink(path.join(root, 'outside'), path.join(root, 'target', 'nested'), 'junction');
    await expect(extractTar(file, path.join(root, 'target'))).rejects.toThrow('contains a link');
    expect(await fs.readdir(path.join(root, 'outside'))).toEqual([]);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
