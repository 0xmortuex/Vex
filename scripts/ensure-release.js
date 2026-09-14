#!/usr/bin/env node
// Create the GitHub release for the current version before electron-builder
// publishes into it.
//
// With differential packages on, electron-builder runs two publish tasks
// (installer + block map) that BOTH try to create the release when it does
// not exist. One wins; the other gets a 422 "Published releases must have a
// valid tag" and the whole publish aborts — with the block map and latest.yml
// never uploaded, so installed copies cannot see the release (v2.31.81 went
// out that way and was patched by hand). An existing release takes the
// "release exists" path in both tasks, so it is created here first, with the
// notes scripts/write-release-notes.js just wrote.
//
// Needs the gh CLI signed in (or GH_TOKEN, which gh honours). Run by
// `npm run publish`; harmless when the release already exists.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const tag = 'v' + pkg.version;
const notes = path.join(root, 'build', 'release-notes.md');
const gh = (args, opts = {}) => execFileSync('gh', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

function main() {
  let exists = false;
  try { gh(['release', 'view', tag, '--json', 'tagName']); exists = true; }
  catch (err) {
    const msg = String(err.stderr || err.message);
    if (!/release not found|could not find|not found/i.test(msg)) throw new Error(`gh release view ${tag} failed: ${msg.trim()}`);
  }
  if (exists) { console.log(`ensure-release: ${tag} already exists`); return; }

  // The tag must be on GitHub: scripts/release.js pushed main with the
  // version commit, but the tag itself is what the release hangs off.
  const remoteTag = execFileSync('git', ['ls-remote', '--tags', 'origin', tag], { cwd: root, encoding: 'utf8' }).trim();
  if (!remoteTag) {
    execFileSync('git', ['tag', '-f', tag], { cwd: root, stdio: 'inherit' });
    execFileSync('git', ['push', 'origin', tag], { cwd: root, stdio: 'inherit' });
  }
  const args = ['release', 'create', tag, '--title', pkg.version, '--latest'];
  if (fs.existsSync(notes)) args.push('--notes-file', notes);
  else args.push('--notes', `Vex ${pkg.version}`);
  gh(args, { stdio: 'inherit' });
  console.log(`ensure-release: created ${tag}`);
}

try { main(); }
catch (err) {
  console.error('ensure-release: ' + err.message);
  process.exit(1);
}
