const path = require('path');
const fs = require('fs');
const { createHash } = require('crypto');
const LIMITS = { entries: 20000, expanded: 256 * 1024 * 1024, entry: 64 * 1024 * 1024, ratio: 300 };
function verifyDigest(bytes, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected) || createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Artifact integrity verification failed');
}
function safeEntry(name) {
  if (typeof name !== 'string' || name.length > 512 || /[\\:\x00-\x1f]/.test(name) || name.startsWith('/') || name.split('/').some(p => p === '..' || /[. ]$/.test(p) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p))) throw new Error('Unsafe archive path');
  return name;
}
function validateZip(zip, limits = LIMITS) {
  const entries = zip.getEntries();
  if (entries.length > limits.entries) throw new Error('Too many archive entries');
  let total = 0; const names = new Set();
  for (const entry of entries) {
    const name = safeEntry(entry.entryName).toLowerCase().replace(/\/$/, '');
    if (names.has(name)) throw new Error('Duplicate archive path');
    names.add(name);
    const size = entry.header.size, compressed = entry.header.compressedSize;
    if (!Number.isSafeInteger(size) || size < 0 || size > limits.entry || (total += size) > limits.expanded || size / Math.max(1, compressed) > limits.ratio) throw new Error('Archive expansion limit exceeded');
    const mode = (entry.attr >>> 16) & 0o170000;
    if (mode && mode !== 0o100000 && mode !== 0o040000) throw new Error('Archive links/devices are forbidden');
  }
  return entries;
}
async function extractTar(file, destination, limits = LIMITS) {
  const tar = require('tar'); let count = 0, total = 0; const names = new Set(), paths = [];
  const compressed = (await fs.promises.stat(file)).size;
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(file);
    const parser = new tar.Parser({ strict: true, maxDecompressionRatio: limits.ratio, maxMetaEntrySize: 64 * 1024 });
    const finish = error => { clearTimeout(timer); input.destroy(); if (error) reject(error); else resolve(); };
    const timer = setTimeout(() => parser.abort(new Error('Archive validation timed out')), 30000);
    input.on('error', error => parser.abort(error));
    parser.on('error', finish);
    parser.on('end', () => finish());
    parser.on('entry', entry => {
    try {
      const name = safeEntry(entry.path).toLowerCase().replace(/\/$/, '');
      if (names.has(name)) throw new Error('Duplicate archive path');
      names.add(name);
      paths.push(entry.path);
      if (!['File', 'Directory'].includes(entry.type)) throw new Error('Archive links/devices are forbidden');
      if (++count > limits.entries || entry.size > limits.entry || (total += entry.size) > limits.expanded || total / Math.max(1, compressed) > limits.ratio) throw new Error('Archive expansion limit exceeded');
      entry.resume();
    } catch (error) { parser.abort(error); }
    });
    input.pipe(parser);
  });
  // Refuse pre-existing links in extraction paths, including directory junctions.
  const checked = new Set();
  for (const name of paths) {
    let target = path.resolve(destination, name);
    while (!checked.has(target)) {
      checked.add(target);
      try {
        if ((await fs.promises.lstat(target)).isSymbolicLink()) throw new Error('Archive destination contains a link');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const parent = path.dirname(target);
      if (parent === target) break;
      target = parent;
    }
  }
  await fs.promises.mkdir(destination, { recursive: true });
  await tar.x({ file, cwd: path.resolve(destination), strict: true, preservePaths: false, noChmod: true, maxDecompressionRatio: limits.ratio });
}
module.exports = { verifyDigest, safeEntry, validateZip, extractTar, LIMITS };
