#!/usr/bin/env node
// One screen before a release: what is published, what CI says about HEAD,
// which commits are unreleased and what they score, the next version, and
// whether CHANGELOG.md is ready for it. Read-only (gh release list / run list,
// git log); changes nothing.
//
//   node scripts/release-check.js            exit 0 = ready, 1 = blocked
//
// The same checks scripts/release.js enforces (scripts/release-guard.js).
'use strict';

const fs = require('fs');
const path = require('path');
const guard = require('./release-guard.js');
const points = require('./version-points.js');

// deps are injectable for tests: { gh, git, plan, packageVersion, changelog }.
function buildReport(deps = {}) {
  const gh = deps.gh || guard.defaultGh;
  const git = deps.git || guard.defaultGit;
  const changelog = deps.changelog !== undefined ? deps.changelog : fs.readFileSync(path.join(guard.REPO, 'CHANGELOG.md'), 'utf8');
  const changelogTr = deps.changelogTr !== undefined ? deps.changelogTr : (fs.existsSync(path.join(guard.REPO, 'CHANGELOG.tr.md')) ? fs.readFileSync(path.join(guard.REPO, 'CHANGELOG.tr.md'), 'utf8') : '');
  const packageVersion = deps.packageVersion || JSON.parse(fs.readFileSync(path.join(guard.REPO, 'package.json'), 'utf8')).version;
  const plan = deps.plan ? deps.plan() : points.plan();
  const lines = [];
  const blockers = [];

  const tags = guard.publishedTags(gh);
  const published = tags.includes('v' + packageVersion);
  lines.push(`package.json   v${packageVersion}  ${published ? 'published on GitHub' : 'NOT published yet'}`);
  lines.push(`latest release ${tags[0] || '(none)'}   last tag in git: ${plan.tag}`);

  const ci = guard.ciState({ gh, git });
  const at = ci.sha ? `${ci.sha.slice(0, 7)}${ci.distance ? ` (${ci.distance} behind HEAD)` : ' (HEAD)'}` : '';
  lines.push(`CI             ${ci.state.toUpperCase()}${at ? ' on ' + at : ''}${ci.run ? `  run ${ci.run.databaseId}` : ''}`);

  lines.push('');
  lines.push(`Unreleased since ${plan.tag}${plan.current !== plan.tag.slice(1) ? ` (counts as ${plan.current})` : ''}: ${plan.rows.length} commit(s), ${plan.total} points`);
  for (const r of plan.rows) lines.push(`  ${String(r.points).padStart(3)}  ${(r.rank || 'UNRANKED').padEnd(26)} ${r.hash.slice(0, 7)} ${r.subject.slice(0, 80)}`);

  let next = null;
  if (plan.unranked.length) blockers.push(`${plan.unranked.length} commit(s) have no rank (Rank: line or release-ranks.txt)`);
  else if (!(plan.total > 0)) lines.push('Next version   nothing ranked above none: nothing to release');
  else next = points.nextVersion(plan.current, plan.total);
  if (next) {
    lines.push(`Next version   v${next}`);
    const has = changelog.includes(`## v${next} `);
    lines.push(`CHANGELOG      ${has ? `has a "## v${next} " entry` : `NO entry for v${next} yet`}`);
    if (!has) blockers.push(`CHANGELOG.md has no "## v${next} " entry`);
    const hasTr = changelogTr.includes(`## v${next} `);
    lines.push(`CHANGELOG.tr   ${hasTr ? `has a "## v${next} " entry (Turkish release notes)` : `NO Turkish entry for v${next} yet`}`);
    if (!hasTr) blockers.push(`CHANGELOG.tr.md has no "## v${next} " entry (the Turkish release notes)`);
    if (tags.includes('v' + next)) blockers.push(`v${next} is already published`);
  }

  const pub = guard.checkPublished({ version: next, changelog, gh, git });
  blockers.push(...pub.errors);
  for (const w of pub.warnings) lines.push('warning: ' + w);
  if (next) blockers.push(...guard.ciErrors(ci)); // only matters when there is something to release

  lines.push('');
  lines.push(blockers.length ? 'BLOCKED' : (next ? `READY to release v${next}` : 'NOTHING TO RELEASE'));
  for (const b of blockers) lines.push('  - ' + b);
  return { lines, blockers, next };
}

if (require.main === module) {
  try {
    const r = buildReport();
    console.log(r.lines.join('\n'));
    process.exit(r.blockers.length ? 1 : 0);
  } catch (e) { console.error('release-check: ' + e.message); process.exit(1); }
}

module.exports = { buildReport };
