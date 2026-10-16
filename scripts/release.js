#!/usr/bin/env node
// One-command release: bumps the version, commits, pushes, and (unless told
// not to) publishes. Keeps the repo, the GitHub release, and the website badge
// from disagreeing (they have — the badge once advertised a version that had
// no release).
//
// Usage:
//   node scripts/release.js <version> "<title>" [--no-publish] [--dry-run] [--any-version] [--ignore-ci]
//   node scripts/release.js --prepare ["<title>"] [--write]
//
// --prepare is the bookkeeping, worked out and shown (scripts/release-prepare.js):
// the points, the release-ranks lines for commits that are plainly bookkeeping,
// the version, the package.json lines and a DRAFT CHANGELOG entry. It prints what
// it would change and writes nothing; with --write it writes only CHANGELOG.md and
// release-ranks.txt, uncommitted. It never commits, tags, pushes or publishes.
//
// It refuses (exit 1, no file changed) when v<version> is already a GitHub
// release, when the CHANGELOG heading of a published release was changed, or
// when the "Verify Vex" CI run for HEAD (or its nearest ancestor with a run) is
// red, still running, or missing. --ignore-ci skips only the CI part; use it
// when you have read the failure and decided it is unrelated.
// `node scripts/release-check.js` prints the same checks in one screen.
// The publish itself is run by the owner with scripts/publish-all.ps1.
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

// --prepare: show the bookkeeping and stop. Before anything below can change a file or reach the network.
if (flags.has('--prepare')) {
  let code;
  try { code = require('./release-prepare.js').main(args); } catch (e) { console.error('release --prepare: ' + e.message); code = 1; }
  process.exit(code);
}

function fail(msg) { console.error('release: ' + msg); process.exit(1); }
function run(cmd, opts) {
  console.log((dry ? '[dry-run] ' : '$ ') + cmd);
  if (dry) return '';
  // `inherit` shows a long build as it runs and has no output-size limit.
  return execSync(cmd, { cwd: REPO, stdio: (opts && opts.inherit) ? 'inherit' : ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
}

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail('usage: node scripts/release.js <x.y.z> "<title>" [--no-publish] [--dry-run] [--any-version] [--ignore-ci]');
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
// A draft from --prepare still carries its marker comments: reword them away first.
{
  const start = changelog.indexOf(`## v${version} `);
  const next = changelog.indexOf('\n## v', start + 1);
  if (changelog.slice(start, next < 0 ? undefined : next).includes('<!-- DRAFT')) fail(`the CHANGELOG entry for v${version} is still a draft (it has "<!-- DRAFT" lines from --prepare): reword each line and delete the comment`);
}

// 1a. DRM gate, first half: can this machine sign and verify the castLabs VMP
//     signature at all? Checked before any file changes, so a release that
//     would ship "DRM failed" stops now, not after the build. The second half
//     (the built app's signature and Widevine) is in `npm run publish`.
{
  try { console.log('release: DRM gate - ' + require('./verify-drm.js').preflight()); }
  catch (err) { fail('DRM gate: ' + err.message); }
}

// 1b. Refuse (before any file changes) when the version, or the CHANGELOG
//     heading of a published release, is already on GitHub, or when CI is red
//     or still running for HEAD. scripts/release-guard.js; read-only gh calls.
{
  const guard = require('./release-guard.js');
  const g = guard.preflight({ version, changelog, ignoreCi: flags.has('--ignore-ci') });
  for (const w of g.warnings) console.warn('release: warning: ' + w);
  if (g.errors.length) fail('refusing to release v' + version + ':\n  - ' + g.errors.join('\n  - '));
}

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
