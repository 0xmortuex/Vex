// === What the person has let an extension do beyond its manifest (2026-10-28) ===
//
// Chrome gives an extension the permissions it names when it is installed. Vex keeps the ones that hand over the most behind a switch of
// their own on the extension's card, off until the person turns it on: today "debugger" ("Allow it to control other tabs": the
// extension drives any tab of its session through the DevTools protocol, which is how the Claude extension browses for you).
// One small file in the extensions folder: { "debugger": { "<folder>": true } }. A missing file means nothing is allowed; an unreadable
// one is an error that says so (the caller keeps everything off), never a silent allow.
const fs = require('fs');
const path = require('path');

const FILE = 'extension-grants.json';
const GRANTS = Object.freeze(['debugger']);

const filePath = (dir) => path.join(dir, FILE);

function read(dir) {
  const file = filePath(dir);
  const empty = () => Object.fromEntries(GRANTS.map(g => [g, {}]));
  if (!fs.existsSync(file)) return empty();
  const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The extension grants file is corrupt: expected an object');
  const out = empty();
  for (const g of GRANTS) {
    const o = parsed[g];
    if (o && typeof o === 'object' && !Array.isArray(o)) for (const [folder, v] of Object.entries(o)) if (v === true) out[g][folder] = true;
  }
  return out;
}

function write(dir, state) {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath(dir) + '.new';
  fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(GRANTS.map(g => [g, (state && state[g]) || {}])), null, 2));
  fs.renameSync(tmp, filePath(dir));
}

function has(state, grant, folder) { return !!(state && state[grant] && state[grant][folder] === true); }

// Returns the new state; unknown grants are refused.
function set(state, grant, folder, on) {
  if (!GRANTS.includes(grant)) throw new Error('Unknown grant ' + String(grant));
  if (typeof folder !== 'string' || !folder) throw new Error('A grant needs an extension');
  const next = { ...state, [grant]: { ...(state && state[grant]) } };
  if (on) next[grant][folder] = true; else delete next[grant][folder];
  return next;
}

module.exports = { read, write, has, set, GRANTS, FILE };
