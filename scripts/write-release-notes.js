#!/usr/bin/env node
// Put the changelog entry for the version being published onto the GitHub
// release page.
//
// electron-builder creates the release, and with no releaseNotes configured it
// creates it with an EMPTY body — which is what happened to v2.31.55, .56 and
// .58. The only releases in this repo that carry notes are the ones that were
// written by hand afterwards.
//
// This runs as part of `npm run publish`, so the notes always come from the
// version in package.json at the moment of publishing, not from whenever
// scripts/release.js last ran. package.json points electron-builder at the file
// it writes (build.releaseInfo.releaseNotesFile).
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const OUT = path.join(REPO, 'build', 'release-notes.md');

function fail(msg) {
  console.error(`release-notes: ${msg}`);
  process.exit(1);
}

const { version } = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
const changelog = fs.readFileSync(path.join(REPO, 'CHANGELOG.md'), 'utf8');

// The entry runs from its own "## vX.Y.Z" heading to the next "## v" heading.
const start = changelog.indexOf(`## v${version} `);
if (start === -1) fail(`CHANGELOG.md has no "## v${version}" entry — refusing to publish a release with no notes`);
const rest = changelog.slice(start);
const nextIdx = rest.indexOf('\n## v', 1);
const entry = (nextIdx === -1 ? rest : rest.slice(0, nextIdx)).trim();

// Drop the heading itself; the release page already shows the version + title.
const body = entry.split('\n').slice(1).join('\n').trim();
if (!body) fail(`the CHANGELOG entry for v${version} has a heading but no content`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, body + '\n', 'utf8');
console.log(`release-notes: wrote ${path.relative(REPO, OUT)} for v${version} (${body.length} chars)`);
