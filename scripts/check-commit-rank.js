#!/usr/bin/env node
// commit-msg check: a commit message must carry a valid `Rank:` line (T1-013).
//
// Every commit is ranked (size x kind x reach, or `Rank: none`) because the
// version is the sum of the ranks (scripts/version-points.js). A commit with no
// Rank line is the bookkeeping problem: it has to be ranked later in
// release-ranks.txt by hand. This refuses it at commit time instead.
//
// Not switched on by this file. To use it: git config core.hooksPath .githooks
// (the hook there calls this). Merge commits, fixup!/squash! commits and the
// message git writes for an unfinished rebase are let through.
//
// Usage: node scripts/check-commit-rank.js <path to the commit message file>
'use strict';

const fs = require('fs');
const points = require('./version-points.js');

// → null when the message is fine, else why not.
function problem(message) {
  const text = String(message || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n').filter(l => !l.startsWith('#'));
  const subject = (lines[0] || '').trim();
  if (!subject) return null;   // an empty message is git's to refuse
  if (/^(Merge |fixup! |squash! |amend! )/.test(subject)) return null;
  const rank = lines.map(l => /^Rank:\s*(\S+)\s*$/i.exec(l)).filter(Boolean).pop();
  if (!rank) return 'the message has no "Rank:" line. Add one, like "Rank: fix-mid-some" (kind-size-reach), or "Rank: none" for tests, docs and bookkeeping.';
  try { points.parseRank(rank[1]); } catch (err) { return err.message; }
  return null;
}

module.exports = { problem };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('check-commit-rank: pass the commit message file'); process.exit(2); }
  const why = problem(fs.readFileSync(file, 'utf8'));
  if (why) { console.error('check-commit-rank: ' + why); process.exit(1); }
}
