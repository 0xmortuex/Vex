#!/usr/bin/env node
// One-command release: bumps the version, commits, pushes, and (unless told
// not to) publishes. Keeps the repo, the GitHub release, and the website badge
// from disagreeing (they have — the badge once advertised a version that had
// no release).
//
// Usage:
//   node scripts/release.js <version> "<title>" [--no-publish] [--dry-run] [--any-version]
//
// The version must be the one scripts/version-points.js works out from the
// commits' ranks (run it first to see the table); --any-version skips that,
// for a release whose version the owner picked by hand.
//
// What it does, in order (fails loudly at the first problem):
//   1. Verifies CHANGELOG.md already has a "## v<version> " entry (write the
//      changelog first — the script won't invent release notes).
//   2. Bumps "version" in package.json and package-lock.json.
//   3. Commits ONLY those three files (this repo deliberately carries a dirty
//      working tree; nothing else is swept in) and pushes origin main.
//   4. npm run publish — write-release-notes, build, verify-packaged-boot,
//      ensure-release, upload-release, then postpublish (post-publish.js),
//      which checks the release is complete and only THEN moves the website's
//      "Latest: vX.Y.Z" badge. Skip with --no-publish and run
//      `npm run publish` yourself; the badge moves when that finishes.
//
// This script never touches the website itself: moving the badge before the
// release exists is exactly the "badge lies" case above.
//
// Prereqs: gh CLI authed (or GH_TOKEN set) for publish; ../vex-website checked
// out next to this repo (post-publish pushes it); no Vex running from dist\
// (scripts/check-dist-free.js stops the build if one is).
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const [version, title] = args.filter(a => !a.startsWith('--'));
const dry = flags.has('--dry-run');

function fail(msg) { console.error('release: ' + msg); process.exit(1); }
function run(cmd, opts) {
  console.log((dry ? '[dry-run] ' : '$ ') + cmd);
  if (dry) return '';
  // `inherit` shows a long build as it runs and has no output-size limit.
  return execSync(cmd, { cwd: REPO, stdio: (opts && opts.inherit) ? 'inherit' : ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
}

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail('usage: node scripts/release.js <x.y.z> "<title>" [--no-publish] [--dry-run] [--any-version]');
if (!title) fail('a release title is required (used as the commit subject)');
if (flags.has('--no-website')) fail('--no-website is gone: this script no longer touches the website. post-publish.js moves the badge after `npm run publish` proves the release.');

// 0. The ranked commits decide the version.
if (!flags.has('--any-version')) {
  const points = require('./version-points.js');
  const p = points.plan();
  if (p.unranked.length) fail(`${p.unranked.length} commit(s) since ${p.tag} have no rank — run node scripts/version-points.js`);
  const expected = points.nextVersion(p.current, p.total);
  if (version !== expected) fail(`the ranked commits make this v${expected}, not v${version} (${p.total} points since ${p.tag}); --any-version to override`);
}

// 1. Changelog entry must exist before anything moves. The trailing space keeps
//    2.36.1 from matching "## v2.36.10" (same check as write-release-notes.js).
const changelog = fs.readFileSync(path.join(REPO, 'CHANGELOG.md'), 'utf8');
if (!changelog.includes(`## v${version} `)) fail(`CHANGELOG.md has no "## v${version} " entry — write the release notes first`);

// 2. Bump version in package.json + package-lock.json.
for (const file of ['package.json', 'package-lock.json']) {
  const p = path.join(REPO, file);
  const json = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (json.version === version) { console.log(`${file} already at ${version}`); continue; }
  json.version = version;
  if (file === 'package-lock.json' && json.packages && json.packages['']) json.packages[''].version = version;
  if (!dry) fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n');
  console.log(`${file}: version -> ${version}`);
}

// 3. Commit only the release files (the pathspec ignores anything else that
//    happens to be staged); push.
run('git add package.json package-lock.json CHANGELOG.md');
run(`git commit -m "v${version} — ${title.replace(/"/g, '\\"')}" -- package.json package-lock.json CHANGELOG.md`);
run('git push origin main');

// 4. Build + publish the GitHub release; postpublish moves the website badge.
if (flags.has('--no-publish')) {
  console.log('release: SKIPPING publish (--no-publish). Publish it yourself:');
  console.log('release:   npm run publish');
  console.log('release: post-publish moves the website badge once the release is verified.');
} else {
  run('npm run publish', { inherit: true });
}

console.log(`release: v${version} done`);
