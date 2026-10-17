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
// motw (main/mark-of-the-web.js), when given, copies the archive's "downloaded from the internet" mark onto every
// extracted file, so SmartScreen still looks at a program that came out of a downloaded archive.
// -> { files: number, motw: the propagate() result or null }
async function extractTar(file, destination, limits = LIMITS, { motw = null } = {}) {
  const tar = require('tar'); let count = 0, total = 0; const names = new Set(), paths = [], fileNames = [];
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
      if (entry.type === 'File') fileNames.push(entry.path);
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
  const result = { files: fileNames.length, motw: null };
  if (motw) result.motw = motw.propagate(file, fileNames.map(n => path.resolve(destination, n)));
  return result;
}
// How many files and bytes a .zip holds, after the same checks that extraction makes (unsafe names, links, too many
// entries, an expansion bomb all throw). -> { count, bytes }
function inspectZip(file, limits = LIMITS, { AdmZip = require('adm-zip') } = {}) {
  const entries = validateZip(new AdmZip(file), limits);
  let bytes = 0, count = 0;
  for (const e of entries) if (!e.isDirectory) { count++; bytes += e.header.size; }
  return { count, bytes };
}

// The place an archive entry is written, which must stay under root: it may not leave it, and no folder on the way may be a link.
async function checkedTarget(root, name) {
  const target = path.resolve(root, name);
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Archive path escapes the destination');
  let dir = path.dirname(target);
  while (dir.length >= root.length) {
    try { if ((await fs.promises.lstat(dir)).isSymbolicLink()) throw new Error('Archive destination contains a link'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return target;
}

// Unpacks a .zip into destination (T3-111): the same limits as validateZip, every entry kept under the destination
// (zip-slip), nothing overwritten (an existing file stops it), links and devices refused. motw (main/mark-of-the-web.js),
// when given, copies the archive's "downloaded from the internet" mark onto every file written, as extractTar does.
// -> { files: number, motw: the propagate() result or null }
async function extractZip(file, destination, limits = LIMITS, { motw = null, AdmZip = require('adm-zip') } = {}) {
  const entries = validateZip(new AdmZip(file), limits);
  const root = path.resolve(destination);
  await fs.promises.mkdir(root, { recursive: true });
  const written = [];
  for (const entry of entries) {
    const target = await checkedTarget(root, entry.entryName);
    if (entry.isDirectory) { await fs.promises.mkdir(target, { recursive: true }); continue; }
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, entry.getData(), { flag: 'wx' });
    written.push(target);
  }
  const result = { files: written.length, motw: null };
  if (motw) result.motw = motw.propagate(file, written);
  return result;
}

module.exports = { verifyDigest, safeEntry, validateZip, extractTar, extractZip, inspectZip, LIMITS };
