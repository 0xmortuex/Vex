#!/usr/bin/env node
// After `npm run publish`: prove the release is complete, then move the
// website's "Latest" badge to it.
//
// Both steps were done by hand after every release. The check matters more
// than the badge: v2.31.81 went out with no latest.yml and no block map, so no
// installed copy could see it — and nothing said so. A release missing an
// asset, or still a draft, fails here loudly and the badge is NOT moved.
//
// Runs as the npm `postpublish` script. Needs the gh CLI signed in (or
// GH_TOKEN). `--no-website` checks the release and stops there.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const REQUIRED = ['latest.yml', 'Vex-Setup.exe', 'Vex-Setup.exe.blockmap'];

// What is wrong with a release as `gh release view --json` reports it.
function problems(release, tag) {
  const out = [];
  if (!release || release.tagName !== tag) return ['the release for ' + tag + ' was not found'];
  if (release.isDraft) out.push('it is still a draft');
  const assets = Array.isArray(release.assets) ? release.assets : [];
  for (const name of REQUIRED) {
    const a = assets.find(x => x.name === name);
    if (!a) out.push(name + ' is missing');
    else if (!(a.size > 0)) out.push(name + ' is empty');
  }
  return out;
}

// The page with its badge moved to `version`. Throws when there is no badge.
function bumpBadge(html, version) {
  const re = /Latest: v\d+\.\d+\.\d+/;
  if (!re.test(html)) throw new Error('the website has no "Latest: vX.Y.Z" badge to move');
  return html.replace(re, 'Latest: v' + version);
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const tag = 'v' + pkg.version;
  const release = JSON.parse(execFileSync('gh', ['release', 'view', tag, '--json', 'tagName,isDraft,assets'], { cwd: root, encoding: 'utf8' }));
  const wrong = problems(release, tag);
  if (wrong.length) throw new Error(tag + ' is NOT a complete release: ' + wrong.join('; ') + '. Installed copies will not update to it. The website was left alone.');
  console.log('post-publish: ' + tag + ' is complete (' + REQUIRED.join(', ') + ')');

  if (process.argv.includes('--no-website')) return;
  const site = path.join(root, '..', 'vex-website');
  const page = path.join(site, 'index.html');
  if (!fs.existsSync(page)) throw new Error('the website checkout was not found at ' + site);
  const html = fs.readFileSync(page, 'utf8');
  const next = bumpBadge(html, pkg.version);
  if (next === html) { console.log('post-publish: the website already says ' + tag); return; }
  fs.writeFileSync(page, next);
  const git = (args) => execFileSync('git', args, { cwd: site, stdio: 'inherit' });
  git(['add', 'index.html']);                       // this file only, whatever else is dirty there
  git(['commit', '-m', 'Latest: ' + tag, '--', 'index.html']);
  git(['push']);
  console.log('post-publish: the website now says ' + tag);
}

if (require.main === module) {
  try { main(); } catch (err) { console.error('post-publish: ' + ((err && err.message) || err)); process.exit(1); }
}

module.exports = { problems, bumpBadge, REQUIRED };
