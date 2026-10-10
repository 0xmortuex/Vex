#!/usr/bin/env node
// The next version comes from what changed, not from a habit of +0.0.1.
// Every commit since the last release tag carries a rank, and its points move
// the version (agreed with the owner 2026-10-10):
//
//   points = size x kind x reach, rounded
//     size:  small 1, mid 2, high 4, critical 7   (how much it matters, not lines)
//     kind:  security 2, feature 2, improvement 1.5, performance 1.5, fix 1, polish 0.5
//     reach: everyone 1.5, some 1, rare 0.5       (who actually notices)
//   `none` scores 0: tests, changelog, refactors, reverts, and a bug made and
//   fixed inside the same unreleased batch (users never saw it).
//
// The middle and last numbers are one counter: 2.39.0 is 390, and 47 points
// make it 437, so v2.43.7. The first number moves only by hand.
//
// A commit is ranked by a line in its message, `Rank: fix-mid-some`, or by a
// line in release-ranks.txt, `<hash> <rank>`, which wins (so a rank can be
// changed before a release without rewriting history).
//
// A line `base <tag> <version>` says what that release counts as. The owner
// had every commit up to v2.38.1 ranked once (ranks-history.txt, 1106 points
// from 2.0.0), so v2.38.1 counts as 2.110.6 and the next release jumps from
// there; older releases and their tags keep their numbers.
//
// Usage: node scripts/version-points.js   prints the table and the version.
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const SIZE = { small: 1, mid: 2, high: 4, critical: 7 };
const KIND = { security: 2, feature: 2, improvement: 1.5, performance: 1.5, fix: 1, polish: 0.5 };
const REACH = { everyone: 1.5, some: 1, rare: 0.5 };

function parseRank(text) {
  const s = String(text || '').trim().toLowerCase();
  if (s === 'none') return { kind: 'none', points: 0 };
  const [kind, size, reach, extra] = s.split('-');
  if (extra !== undefined || !(kind in KIND) || !(size in SIZE) || !(reach in REACH)) {
    throw new Error(`bad rank "${text}": use none, or <${Object.keys(KIND).join('|')}>-<${Object.keys(SIZE).join('|')}>-<${Object.keys(REACH).join('|')}>`);
  }
  return { kind, size, reach, points: Math.round(SIZE[size] * KIND[kind] * REACH[reach]) };
}

function nextVersion(current, points) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!m) throw new Error(`not a version: ${current}`);
  if (!(points > 0)) throw new Error('no points since the last release: nothing ranked above none');
  const counter = Number(m[2]) * 10 + Number(m[3]) + points;
  // An old patch above 9 (v2.32.65) carries into the middle number, so it still goes up.
  return `${m[1]}.${Math.floor(counter / 10)}.${counter % 10}`;
}

// Reads `<hash> <rank>` lines; # starts a comment; base lines are readBases'.
function readOverrides(text) {
  const out = new Map();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line || /^base\s/.test(line)) continue;
    const [hash, rank] = line.split(/\s+/);
    if (!/^[0-9a-f]{7,40}$/i.test(hash) || !rank) throw new Error(`release-ranks.txt: cannot read "${raw.trim()}"`);
    parseRank(rank);
    out.set(hash.toLowerCase(), rank);
  }
  return out;
}

// Reads `base <tag> <version>` lines: what a release counts as.
function readBases(text) {
  const out = new Map();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!/^base\s/.test(line)) continue;
    const [, tag, version] = line.split(/\s+/);
    if (!/^v\d+\.\d+\.\d+$/.test(tag || '') || !/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error(`release-ranks.txt: cannot read "${raw.trim()}"`);
    out.set(tag, version);
  }
  return out;
}

// commits: [{ hash, subject, body }] since the last release.
function score(commits, overrides) {
  const rows = commits.map(c => {
    const hit = [...overrides.keys()].find(h => c.hash.toLowerCase().startsWith(h));
    const line = /^Rank:\s*(\S+)\s*$/im.exec(c.body || '');
    const text = hit ? overrides.get(hit) : line && line[1];
    return { ...c, rank: text || null, ...(text ? parseRank(text) : { points: 0 }) };
  });
  return { rows, total: rows.reduce((n, r) => n + r.points, 0), unranked: rows.filter(r => !r.rank) };
}

function git(cmd) { return execSync('git ' + cmd, { cwd: REPO, encoding: 'utf8' }); }

function plan() {
  const tag = git('describe --tags --abbrev=0 --match "v*"').trim();
  const log = git(`log --reverse --format=%H%x1f%s%x1f%b%x1e ${tag}..HEAD`);
  const commits = log.split('\x1e').map(s => s.trim()).filter(Boolean).map(s => {
    const [hash, subject, body] = s.split('\x1f');
    return { hash, subject, body };
  });
  const file = path.join(REPO, 'release-ranks.txt');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const current = readBases(text).get(tag) || tag.replace(/^v/, '');
  return { tag, current, ...score(commits, readOverrides(text)) };
}

if (require.main === module) {
  try {
    const p = plan();
    console.log(`Since ${p.tag}${p.current !== p.tag.slice(1) ? ` (counts as ${p.current})` : ''}:`);
    for (const r of p.rows) console.log(`${String(r.points).padStart(3)}  ${(r.rank || 'UNRANKED').padEnd(26)} ${r.hash.slice(0, 7)} ${r.subject.slice(0, 90)}`);
    console.log(`Total ${p.total} points`);
    if (p.unranked.length) { console.error(`${p.unranked.length} commit(s) have no rank: add "Rank: ..." lines to release-ranks.txt`); process.exit(1); }
    console.log(`Next version: ${nextVersion(p.current, p.total)}`);
  } catch (e) { console.error('version-points: ' + e.message); process.exit(1); }
}

module.exports = { parseRank, nextVersion, readOverrides, readBases, score, plan };
