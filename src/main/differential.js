// Smaller updates: which parts of the new installer Vex already has.
//
// Every release publishes Vex-Setup.exe.blockmap next to the installer
// (electron-builder, app-builder-lib/out/targets/blockmap): gzip'd JSON
//   { version: "2", files: [{ name: "file", offset: 0, checksums: [...], sizes: [...] }] }
// that cuts the installer into content-defined blocks (8-32 KB) and gives
// each block's checksum and size, in file order.
//
// With the blockmap of the installer that is already on disk (the one that
// installed the running version) and the blockmap of the new one, every
// block of the new file whose checksum and size are in the old file is copied
// from the old file; the rest is downloaded with HTTP Range requests. The
// assembled file is then checked against latest.yml's sha512 and size, the
// same as a full download, so nothing here has to be trusted: a wrong copy or
// a wrong range only makes the check fail (src/main/updates.js).
//
// The same idea as electron-updater's DifferentialDownloader
// (downloadPlanBuilder.computeOperations), written small for Vex.
const zlib = require('zlib');

const MAX_BLOCKMAP_JSON = 32 * 1024 * 1024;

// A blockmap file (gzip, or raw deflate as the embedded kind uses), checked
// enough that the plan built from it can only describe real byte ranges.
function parseBlockMap(buf) {
  let json;
  try {
    const raw = buf[0] === 0x1f && buf[1] === 0x8b
      ? zlib.gunzipSync(buf, { maxOutputLength: MAX_BLOCKMAP_JSON })
      : zlib.inflateRawSync(buf, { maxOutputLength: MAX_BLOCKMAP_JSON });
    json = JSON.parse(raw.toString('utf8'));
  } catch (err) { throw new Error('the blockmap could not be read (' + err.message + ')', { cause: err }); }
  const file = json && Array.isArray(json.files) && json.files.length === 1 ? json.files[0] : null;
  if (!file || typeof json.version !== 'string') throw new Error('the blockmap is not one Vex knows (expected one file)');
  const { checksums, sizes } = file;
  if (!Array.isArray(checksums) || !Array.isArray(sizes) || !checksums.length || checksums.length !== sizes.length) throw new Error('the blockmap lists its blocks wrongly');
  let total = 0;
  for (let i = 0; i < sizes.length; i++) {
    if (!Number.isSafeInteger(sizes[i]) || sizes[i] < 1) throw new Error('the blockmap gives a block an impossible size');
    if (typeof checksums[i] !== 'string' || !checksums[i]) throw new Error('the blockmap gives a block no checksum');
    total += sizes[i];
  }
  const offset = file.offset == null ? 0 : file.offset;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('the blockmap gives an impossible offset');
  return { version: json.version, offset, checksums, sizes, total };
}

// What to copy from the old file and what to download, in new-file order.
// Each step is { kind: 'copy', start, end, from } (from = offset in the old
// file) or { kind: 'download', start, end }; neighbours of one kind merge.
function planDownload(oldMap, newMap) {
  if (oldMap.version !== newMap.version) throw new Error(`the two blockmaps are of different kinds (${oldMap.version} and ${newMap.version})`);
  const old = new Map();
  for (let i = 0, at = oldMap.offset; i < oldMap.checksums.length; at += oldMap.sizes[i], i++) {
    // The first copy of a repeated block is enough: same checksum, same bytes.
    if (!old.has(oldMap.checksums[i])) old.set(oldMap.checksums[i], { at, size: oldMap.sizes[i] });
  }
  const steps = [];
  let downloadBytes = 0, copyBytes = 0;
  for (let i = 0, at = newMap.offset; i < newMap.checksums.length; at += newMap.sizes[i], i++) {
    const size = newMap.sizes[i];
    const found = old.get(newMap.checksums[i]);
    const last = steps[steps.length - 1];
    if (found && found.size === size) {
      copyBytes += size;
      if (last && last.kind === 'copy' && last.from + (last.end - last.start) === found.at) last.end += size;
      else steps.push({ kind: 'copy', start: at, end: at + size, from: found.at });
    } else {
      downloadBytes += size;
      if (last && last.kind === 'download') last.end += size;
      else steps.push({ kind: 'download', start: at, end: at + size });
    }
  }
  // The blocks start at the map's offset; anything before it (none, for the
  // installer) is downloaded too, so the plan always covers the whole file.
  if (newMap.offset > 0) { steps.unshift({ kind: 'download', start: 0, end: newMap.offset }); downloadBytes += newMap.offset; }
  return { steps, downloadBytes, copyBytes, size: newMap.offset + newMap.total };
}

module.exports = { parseBlockMap, planDownload };
