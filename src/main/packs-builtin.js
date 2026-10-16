// === Vex Packs: the packs that ship inside Vex ================================
//
// Some content rides the pack mechanism (docs/packs.md): a prompt library, more
// "something went wrong" checklists, a set of Model UN phrases, Turkish public
// holidays. They are ordinary packs (same format, same validator, no code), kept as
// files in src/main/builtin-packs/ and generated from scripts/build-builtin-packs.js.
//
// Why they are not signed, and why that is safe (the choice is documented in
// docs/packs.md, "Built-in packs"):
//   - A signature needs a private key somewhere. Putting one in the repository would
//     make every signature worthless, and a key held only by the owner would make
//     every content fix wait for the owner. So these carry no signature.
//   - Their trust comes from WHERE they are read: this loader opens exactly the files
//     named in pins.js, from the folder next to this one (inside the packaged app,
//     read-only), never from the user's data folder, and never lists a folder.
//   - Each file must hash to the value pinned in pins.js (generated with the files, so
//     a reviewer sees both change together), must parse with the built-in id prefix
//     (which parsePack refuses for any other source), and must be unsigned.
//   - A pack a person opens or drops can never use the "vex-builtin." id prefix
//     (packs.js: reserved-id), so nothing a user can write poses as a built-in or
//     replaces one; and a built-in is never written to the installed folder.
// Anything wrong throws, naming the file: a damaged built-in is a build error, not
// something to skip silently.
'use strict';

const nodePath = require('node:path');
const packs = require('./packs');

function loadBuiltinPacks({ fs, dir = nodePath.join(__dirname, 'builtin-packs'), pins = require('./builtin-packs/pins') } = {}) {
  if (!fs || typeof fs.readFileSync !== 'function') throw new Error('The built-in loader needs the fs module');
  const out = [];
  for (const id of Object.keys(pins)) {
    if (!id.startsWith(packs.BUILTIN_PREFIX)) throw new Error('Pinned built-in id ' + id + ' does not start with ' + packs.BUILTIN_PREFIX);
    const file = nodePath.join(dir, id + '.vexpack');
    if (!file.startsWith(dir + nodePath.sep)) throw new Error('The built-in pack id ' + id + ' points outside the built-in folder');
    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (err) { throw new Error('Could not read the built-in pack ' + id + ': ' + err.message, { cause: err }); }
    let parsed;
    try { parsed = packs.parsePack(text, { builtin: true }); }
    catch (err) { throw new Error('The built-in pack ' + id + ' is not valid: ' + err.message, { cause: err }); }
    if (parsed.pack.id !== id) throw new Error('The built-in pack file ' + id + ' holds the pack ' + parsed.pack.id);
    if (parsed.pack.signature) throw new Error('The built-in pack ' + id + ' must be unsigned (its trust comes from where it is read)');
    if (parsed.hash !== pins[id]) throw new Error('The built-in pack ' + id + ' does not match its pinned hash, so it was changed without regenerating pins.js');
    out.push(parsed);
  }
  return out;
}

module.exports = { loadBuiltinPacks };
