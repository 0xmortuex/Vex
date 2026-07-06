#!/usr/bin/env node
// One-command release: keeps the repo, the GitHub release, and the website
// badge from ever disagreeing (they have — the badge once advertised a version
// that had no release).
//
// Usage:
//   node scripts/release.js <version> "<title>" [--no-publish] [--no-website] [--dry-run]
//
// What it does, in order (fails loudly at the first problem):
//   1. Verifies CHANGELOG.md already has a "## v<version>" entry (write the
//      changelog first — the script won't invent release notes).
//   2. Bumps "version" in package.json and package-lock.json.
//   3. Commits ONLY those three files (this repo deliberately carries a dirty
//      working tree; nothing else is swept in) and pushes origin main.
//   4. npm run publish — builds, VMP-signs, and publishes the GitHub release
//      (skip with --no-publish; then the release must be published manually
//      BEFORE the website step, or the badge lies).
//   5. Updates the "Latest: vX.Y.Z" badge in ../vex-website, commits, pushes.
//
// Prereqs: gh CLI authed (or GH_TOKEN set) for publish; ../vex-website checked
// out next to this repo.
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const WEBSITE = path.join(REPO, '..', 'vex-website');

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const [version, title] = args.filter(a => !a.startsWith('--'));
const dry = flags.has('--dry-run');

function fail(msg) { console.error('release: ' + msg); process.exit(1); }
function run(cmd, cwd) {
  console.log((dry ? '[dry-run] ' : '$ ') + cmd);
  if (dry) return '';
  return execSync(cmd, { cwd: cwd || REPO, stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
}

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail('usage: node scripts/release.js <x.y.z> "<title>" [--no-publish] [--no-website] [--dry-run]');
if (!title) fail('a release title is required (used as the commit subject)');

// 1. Changelog entry must exist before anything moves.
const changelog = fs.readFileSync(path.join(REPO, 'CHANGELOG.md'), 'utf8');
if (!changelog.includes(`## v${version}`)) fail(`CHANGELOG.md has no "## v${version}" entry — write the release notes first`);

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

// 3. Commit only the release files; push.
run('git add package.json package-lock.json CHANGELOG.md');
run(`git commit -m "v${version} — ${title.replace(/"/g, '\\"')}"`);
run('git push origin main');

// 4. Build + publish the GitHub release.
if (flags.has('--no-publish')) {
  console.log('release: SKIPPING publish (--no-publish). The GitHub release for');
  console.log(`release: v${version} must be published before users can download it:`);
  console.log('release:   npm run publish');
} else {
  run('npm run publish');
}

// 5. Website badge.
if (flags.has('--no-website')) {
  console.log('release: skipping website badge (--no-website)');
} else {
  if (!fs.existsSync(path.join(WEBSITE, 'index.html'))) fail(`website repo not found at ${WEBSITE}`);
  const idx = path.join(WEBSITE, 'index.html');
  const html = fs.readFileSync(idx, 'utf8');
  const updated = html.replace(/Latest: v[\d.]+/, `Latest: v${version}`);
  if (updated === html) fail('website index.html has no "Latest: vX.Y.Z" badge to update');
  if (!dry) fs.writeFileSync(idx, updated);
  console.log(`website badge -> Latest: v${version}`);
  run('git add index.html', WEBSITE);
  run(`git commit -m "Bump latest version badge to v${version}"`, WEBSITE);
  run('git push', WEBSITE);
}

console.log(`release: v${version} done`);
