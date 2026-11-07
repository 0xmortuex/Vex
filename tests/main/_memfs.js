// A tiny in-memory stand-in for the parts of `fs` the agent audit log, the policy file and the hook state use.
// Only what those modules call exists here, so a test that needs something else fails loudly.
function enoent(file) { const e = new Error('ENOENT: no such file ' + file); e.code = 'ENOENT'; return e; }

function createMemFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    mkdirSync() {},
    readFileSync(file) { if (!files.has(file)) throw enoent(file); return files.get(file); },
    writeFileSync(file, data) { files.set(file, String(data)); },
    appendFileSync(file, data) { files.set(file, (files.get(file) || '') + String(data)); },
    statSync(file) { if (!files.has(file)) throw enoent(file); return { size: Buffer.byteLength(files.get(file)) }; },
    rmSync(file) { files.delete(file); },
    renameSync(from, to) { if (!files.has(from)) throw enoent(from); files.set(to, files.get(from)); files.delete(from); },
    openSync(file) { files.set(file, ''); return file; },
    closeSync() {},
    fsyncSync() {},
    copyFileSync(from, to) { if (!files.has(from)) throw enoent(from); files.set(to, files.get(from)); },
  };
}

// Stands in for file-store.atomicWriteSync: replaces the whole file with the bytes.
const memAtomicWriteSync = (file, bytes, { fsImpl }) => { fsImpl.writeFileSync(file, bytes); };

module.exports = { createMemFs, memAtomicWriteSync };
