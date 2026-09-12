// === Keeping exactly one Vencord build =====================================
//
// Installing a Vencord build drops it in a new `vencord-<timestamp>` folder.
// Several can pile up, and Chromium will happily load a stale one alongside
// the new one — which is how "install my build" appeared to do nothing for a
// user while the old June build kept winning.
//
// The rule, in order:
//   1. A folder with no manifest.json cannot load at all (disabled, half
//      extracted, corrupt). Remove it outright. This matters because such a
//      folder can have a NEWER modification time than the working build — the
//      original keep-newest logic kept the dead one and deleted the good one.
//   2. Of what remains, keep the most recently modified and remove the rest.
//
// Taking a filesystem and a log keeps it testable: the bug was in the ordering
// rule, not in any Electron behaviour.
function dedupeVencordFolders({ fs, path, dir, log }) {
  const say = typeof log === 'function' ? log : () => {};
  const removed = [];
  let kept = null;
  try {
    const all = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.startsWith('vencord-'))
      .map(e => ({ name: e.name, path: path.join(dir, e.name) }));

    // 1. Anything that cannot load goes, whatever its timestamp.
    const valid = [];
    for (const v of all) {
      if (fs.existsSync(path.join(v.path, 'manifest.json'))) { valid.push(v); continue; }
      try { fs.rmSync(v.path, { recursive: true, force: true }); removed.push(v.name); say(`dedupe: removed manifest-less ${v.name}`); }
      catch (e) { say(`dedupe: could NOT remove manifest-less ${v.name} (${e.message})`); }
    }

    if (valid.length <= 1) { kept = valid[0] ? valid[0].name : null; return { kept, removed }; }

    // 2. Newest valid build wins.
    valid.sort((a, b) => {
      try { return fs.statSync(b.path).mtimeMs - fs.statSync(a.path).mtimeMs; } catch { return 0; }
    });
    kept = valid[0].name;
    say(`dedupe: ${valid.length} valid vencord folders; keeping ${kept}`);
    for (let i = 1; i < valid.length; i++) {
      try { fs.rmSync(valid[i].path, { recursive: true, force: true }); removed.push(valid[i].name); say(`dedupe: removed ${valid[i].name}`); }
      catch (e) { say(`dedupe: could NOT remove ${valid[i].name} (${e.message})`); }
    }
  } catch (e) { say(`dedupe error: ${e.message}`); }
  return { kept, removed };
}

module.exports = { dedupeVencordFolders };
