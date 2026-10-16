#!/usr/bin/env node
// `--prepare`: the release bookkeeping, worked out and shown (T1-013).
//
// About one commit in eight is release bookkeeping: a CHANGELOG heading, a
// release-ranks.txt line for a commit nobody ranked, a version bump to count as
// nothing. This does the arithmetic and prints exactly what it WOULD change:
//
//   1. the commits since the last release and their points (version-points.js),
//   2. for every unranked commit that is plainly bookkeeping (a CHANGELOG-only
//      commit, a version bump, a merge, tests only, docs only) the release-ranks
//      line `<hash> none` that would count it as nothing; the others stay
//      unranked and are listed, because only a person knows how big they were,
//   3. the version those points make and the two lines it would change in
//      package.json and package-lock.json,
//   4. a DRAFT of the CHANGELOG entry from the ranked commits (the headline of
//      each commit under New / Improved / Fixed), for you to reword, or the note
//      that the entry already exists and is left alone,
//   5. whether a published release's CHANGELOG heading would be disturbed (the same
//      read-only `gh release list` check release.js makes).
//
// Nothing is written unless --write is given, and then only the two text files
// (release-ranks.txt, CHANGELOG.md), in the working tree, uncommitted. It never
// stages, commits, tags, pushes or publishes: those are release.js's steps, run
// by you. The module has no way to do them (it only reads git and gh).
//
// Usage:
//   node scripts/release.js --prepare ["<title>"] [--write]
//   node scripts/version-points.js --prepare [--write]
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const points = require('./version-points.js');

const REPO = path.join(__dirname, '..');

// Files whose change alone is bookkeeping.
const BOOKKEEPING_FILES = new Set(['CHANGELOG.md', 'release-ranks.txt', 'ranks-history.txt', 'package.json', 'package-lock.json']);

function defaultGit(args) { return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }

// → 'none' when the commit is plainly bookkeeping and counts for nothing, else null.
// `files`: the paths the commit touched.
function bookkeepingRank(commit, files) {
  const s = String(commit.subject || '');
  if (/^CHANGELOG\b/i.test(s)) return 'none';
  if (/^Ranks?\b[:\s]/i.test(s)) return 'none';
  if (/^v\d+\.\d+\.\d+\s*[—–-]/.test(s) || /version bump/i.test(s)) return 'none';
  if (/^Merge (branch|pull request|remote-tracking)/i.test(s)) return 'none';
  if (files.length) {
    if (files.every(f => BOOKKEEPING_FILES.has(f))) return 'none';
    if (files.every(f => /^tests\//.test(f))) return 'none';
    if (files.every(f => /\.md$/i.test(f) && !/^src\//.test(f))) return 'none';
  }
  return null;
}

// The commits `plan.rows` has no rank for, with the line that would rank each (or null).
function suggestRanks(unranked, git = defaultGit) {
  return unranked.map(c => {
    const files = git(['show', '--name-only', '--format=', c.hash]).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    return { hash: c.hash, subject: c.subject, rank: bookkeepingRank(c, files), files: files.length };
  });
}

const SECTION = { security: 'New', feature: 'New', improvement: 'Improved', performance: 'Improved', polish: 'Improved', fix: 'Fixed' };

// The ranked commits under New / Improved / Fixed, biggest first in each.
function groupForChangelog(rows) {
  const out = { New: [], Improved: [], Fixed: [] };
  for (const r of rows) {
    if (!r.rank || r.kind === 'none') continue;
    out[SECTION[r.kind]].push(r);
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => b.points - a.points);
  return out;
}

function headline(subject) {
  return String(subject || '').replace(/\s+/g, ' ').trim().replace(/[.:;,\s]+$/, '');
}

// The text of a CHANGELOG entry for `version`, as a draft. `title` falls back to the biggest commit's headline.
function draftEntry({ version, date, title, rows }) {
  const groups = groupForChangelog(rows);
  const biggest = rows.filter(r => r.rank && r.kind !== 'none').sort((a, b) => b.points - a.points)[0];
  const heading = '## v' + version + ' (' + date + ') — ' + (title || (biggest ? headline(biggest.subject) : 'Release'));
  const parts = [heading, ''];
  for (const [name, list] of Object.entries(groups)) {
    if (!list.length) continue;
    parts.push('### ' + name);
    for (const r of list) parts.push('- **' + headline(r.subject) + '.** <!-- DRAFT from ' + r.hash.slice(0, 7) + ' (' + r.rank + '): say what changes for the person using Vex -->');
    parts.push('');
  }
  return parts.join('\n');
}

function today(now = new Date()) {
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}

// Everything `--prepare` would do, as data. Reads files and git; writes nothing.
// opts: { title, now, git, gh, plan (injected for tests), changelog, ranksText, pkg, lock }
function prepare(opts = {}) {
  const git = opts.git || defaultGit;
  const p = opts.plan || points.plan();
  const suggestions = suggestRanks(p.unranked, git);
  const changelog = opts.changelog !== undefined ? opts.changelog : fs.readFileSync(path.join(REPO, 'CHANGELOG.md'), 'utf8');
  const ranksText = opts.ranksText !== undefined ? opts.ranksText : fs.readFileSync(path.join(REPO, 'release-ranks.txt'), 'utf8');

  // The points as they would stand once the suggested `none` lines are in.
  const rescored = points.score(
    p.rows.map(r => ({ hash: r.hash, subject: r.subject, body: r.body })),
    new Map([...points.readOverrides(ranksText), ...suggestions.filter(s => s.rank).map(s => [s.hash.toLowerCase(), s.rank])]),
  );
  const stillUnranked = rescored.unranked;
  const result = { tag: p.tag, current: p.current, rows: rescored.rows, total: rescored.total, suggestions, stillUnranked, version: null, versionError: '', changes: [], notes: [], warnings: [], errors: [] };

  if (stillUnranked.length) {
    result.notes.push(stillUnranked.length + ' commit(s) still have no rank, so the version is not worked out yet: give each a line in release-ranks.txt');
  } else {
    try { result.version = points.nextVersion(p.current, rescored.total); }
    catch (err) { result.versionError = err.message; }
  }

  // release-ranks.txt: the lines that would be added.
  // (An unranked commit has no override and no Rank line, by definition.)
  const newLines = suggestions.filter(s => s.rank);
  if (newLines.length) {
    result.changes.push({
      file: 'release-ranks.txt',
      what: 'add ' + newLines.length + ' line(s) that count bookkeeping commits as nothing',
      add: newLines.map(s => s.hash.slice(0, 10) + ' ' + s.rank + '    # ' + headline(s.subject).slice(0, 70)),
    });
  }

  if (result.version) {
    const v = result.version;
    const date = today(opts.now);
    result.changes.push({ file: 'package.json', what: '"version" -> "' + v + '"' }, { file: 'package-lock.json', what: '"version" (and packages[""].version) -> "' + v + '"' });
    if (changelog.includes('## v' + v + ' ')) {
      result.notes.push('CHANGELOG.md already has "## v' + v + ' ": left as it is');
    } else {
      result.changes.push({ file: 'CHANGELOG.md', what: 'add a DRAFT entry at the top, to be reworded', add: draftEntry({ version: v, date, title: opts.title, rows: rescored.rows }).split('\n') });
    }
    // Published headings: read-only, through the same check release.js makes.
    try {
      const guard = require('./release-guard.js');
      const g = guard.checkPublished({ version: v, changelog, ...(opts.gh ? { gh: opts.gh } : {}), ...(opts.git ? { git: opts.git } : {}) });
      result.errors.push(...g.errors);
      result.warnings.push(...g.warnings);
    } catch (err) {
      result.warnings.push('the published CHANGELOG headings were not compared: ' + err.message);
    }
  }
  return result;
}

function format(r) {
  const out = [];
  out.push('release --prepare (nothing is written, staged, committed, pushed or published)');
  out.push('');
  out.push('Since ' + r.tag + (r.current !== r.tag.slice(1) ? ' (counts as ' + r.current + ')' : '') + ':');
  for (const row of r.rows) out.push(String(row.points).padStart(4) + '  ' + (row.rank || 'UNRANKED').padEnd(26) + ' ' + row.hash.slice(0, 7) + ' ' + row.subject.slice(0, 80));
  out.push('Total ' + r.total + ' points');
  if (r.suggestions.length) {
    out.push('');
    out.push('Unranked commits:');
    for (const s of r.suggestions) out.push('  ' + s.hash.slice(0, 7) + '  ' + (s.rank ? 'would count as ' + s.rank : 'needs a rank from you').padEnd(26) + ' ' + s.subject.slice(0, 70));
  }
  out.push('');
  if (r.version) out.push('Next version: v' + r.version);
  else out.push('Next version: not worked out' + (r.versionError ? ' (' + r.versionError + ')' : ''));
  for (const n of r.notes) out.push('Note: ' + n);
  for (const w of r.warnings) out.push('Warning: ' + w);
  for (const e of r.errors) out.push('REFUSED: ' + e);
  if (r.changes.length) {
    out.push('');
    out.push('It would change:');
    for (const c of r.changes) {
      out.push('  ' + c.file + ': ' + c.what);
      for (const line of c.add || []) out.push('      + ' + line);
    }
    out.push('');
    out.push('Apply the two text files with --write (working tree only); then review, and run release.js yourself.');
  }
  out.push('');
  out.push('To refuse a commit with no Rank line when it is made (this script does not set it): git config core.hooksPath .githooks');
  return out.join('\n');
}

// --write: the two text files only. No git. Refuses if the prepare found errors.
function write(r, { changelogPath = path.join(REPO, 'CHANGELOG.md'), ranksPath = path.join(REPO, 'release-ranks.txt') } = {}) {
  if (r.errors.length) throw new Error('refusing to write: ' + r.errors.join(' / '));
  const done = [];
  for (const c of r.changes) {
    if (c.file === 'release-ranks.txt') {
      const text = fs.readFileSync(ranksPath, 'utf8');
      fs.writeFileSync(ranksPath, text.replace(/\s*$/, '\n') + c.add.join('\n') + '\n');
      done.push(c.file);
    } else if (c.file === 'CHANGELOG.md') {
      const text = fs.readFileSync(changelogPath, 'utf8');
      const nl = text.includes('\r\n') ? '\r\n' : '\n';
      const at = text.search(/^## v/m);
      if (at < 0) throw new Error('CHANGELOG.md has no entry to put the draft above');
      fs.writeFileSync(changelogPath, text.slice(0, at) + c.add.join(nl) + nl + text.slice(at));
      done.push(c.file);
    }
  }
  return done;
}

// The shared entry point of `release.js --prepare` and `version-points.js --prepare`.
function main(argv) {
  const flags = new Set(argv.filter(a => a.startsWith('--')));
  const title = argv.filter(a => !a.startsWith('--'))[0] || '';
  const r = prepare({ title });
  console.log(format(r));
  if (flags.has('--write')) {
    const done = write(r);
    console.log('\nWritten (uncommitted): ' + (done.join(', ') || 'nothing to write'));
  }
  return r.errors.length || r.stillUnranked.length ? 1 : 0;
}

module.exports = { bookkeepingRank, suggestRanks, groupForChangelog, draftEntry, prepare, format, write, main, headline };

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (e) { console.error('release --prepare: ' + e.message); process.exitCode = 1; }
}
