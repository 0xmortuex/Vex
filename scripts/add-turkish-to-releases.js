#!/usr/bin/env node
// Put the Turkish release notes (CHANGELOG.tr.md) on the GitHub release pages that are already published.
//
//   node scripts/add-turkish-to-releases.js            what it would change (nothing is edited)
//   node scripts/add-turkish-to-releases.js --apply    edit the pages (needs GH_TOKEN, or `gh` signed in)
//   node scripts/add-turkish-to-releases.js --only=v36.69.1,v37.21.0   just those
//
// New releases get their Turkish notes from scripts/write-release-notes.js when they are published; this is for the ones that went out
// before. A page that already has the "Türkçe" section is left alone, so it can be run again. It edits public pages, so it only edits with
// --apply, and it says what it did for every release. The format is the one write-release-notes.js writes:
//   <English body> + "\n\n---\n\n## Türkçe — <Turkish title>\n\n" + <Turkish body>
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const MARK = '\n## Türkçe';

// -> { title, body } of one version's entry in a changelog, or null. The heading is dropped from the body.
function entryOf(md, version) {
  md = String(md || '').replace(/\r/g, '');
  const start = md.indexOf(`## v${version} `);
  if (start === -1) return null;
  const rest = md.slice(start);
  const next = rest.indexOf('\n## v', 1);
  const entry = (next === -1 ? rest : rest.slice(0, next)).trim();
  return { title: entry.split('\n')[0], body: entry.split('\n').slice(1).join('\n').trim() };
}

// Older releases were published under the numbers Vex used then (v2.32.53); the changelog now numbers them in points (v9.78.3) and says so in
// a line "_Released as v2.32.53._" under the heading. -> Map of tag -> the changelog version whose notes belong to that tag.
function aliases(enMd) {
  const out = new Map();
  const md = String(enMd || '').replace(/\r/g, '');
  const heads = [...md.matchAll(/^## (v\d\S*) /gm)];
  heads.forEach((h, i) => {
    const text = md.slice(h.index, i + 1 < heads.length ? heads[i + 1].index : undefined);
    const m = /^_Released as (v\d+\.\d+\.\d+)\._\s*$/m.exec(text);
    if (m && !out.has(m[1])) out.set(m[1], h[1]);
  });
  return out;
}

// The page body with the Turkish section added, or null when there is nothing to add (no Turkish entry, or the page already has it).
function withTurkish(pageBody, trMd, version) {
  const body = String(pageBody || '');
  if ((`\n${body}`).includes(MARK)) return null;
  const tr = entryOf(trMd, version);
  if (!tr || !tr.body) return null;
  const title = (/—\s*(.+)$/.exec(tr.title) || [])[1];
  return body.replace(/\s+$/, '') + '\n\n---\n\n## Türkçe' + (title ? ' — ' + title : '') + '\n\n' + tr.body + '\n';
}

// releases: [{ tag, body }]. -> [{ tag, body: newBody }] for the pages that change, and counts of the ones that do not.
function plan(releases, trMd, only, alias) {
  const edits = [], skipped = { noTurkish: 0, already: 0, empty: 0 };
  for (const r of releases) {
    if (only && !only.includes(r.tag)) continue;
    if (!String(r.body || '').trim()) { skipped.empty++; continue; }
    if ((`\n${r.body}`).includes(MARK)) { skipped.already++; continue; }
    const wanted = (alias && alias.get(r.tag)) || r.tag;
    const next = withTurkish(r.body, trMd, String(wanted).replace(/^v/, ''));
    if (next === null) { skipped.noTurkish++; continue; }
    edits.push({ tag: r.tag, body: next });
  }
  return { edits, skipped };
}

function gh(args, opts = {}) {
  const r = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('gh ' + args.slice(0, 3).join(' ') + ' failed: ' + String(r.stderr || '').trim().slice(0, 300));
  return r.stdout;
}

function main(argv) {
  const apply = argv.includes('--apply');
  const onlyArg = argv.find(a => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice(7).split(',').map(s => s.trim()).filter(Boolean) : null;
  const trMd = fs.readFileSync(path.join(REPO, 'CHANGELOG.tr.md'), 'utf8');
  const alias = aliases(fs.readFileSync(path.join(REPO, 'CHANGELOG.md'), 'utf8'));
  const list = JSON.parse(gh(['release', 'list', '--limit', '1000', '--json', 'tagName,isDraft']))
    .filter(r => !r.isDraft).map(r => r.tagName);
  console.log(`${list.length} published release(s) on GitHub${only ? `, ${only.length} asked for` : ''}`);
  const releases = [];
  for (const tag of list) {
    if (only && !only.includes(tag)) continue;
    releases.push({ tag, body: JSON.parse(gh(['release', 'view', tag, '--json', 'body'])).body });
  }
  const { edits, skipped } = plan(releases, trMd, only, alias);
  console.log(`would add the Turkish notes to ${edits.length} page(s); left alone: ${skipped.already} already have them, ${skipped.noTurkish} have no Turkish entry yet, ${skipped.empty} have an empty page`);
  if (!apply) { for (const e of edits.slice(0, 8)) console.log('  ' + e.tag); if (edits.length > 8) console.log(`  … and ${edits.length - 8} more`); console.log('nothing was edited (use --apply)'); return 0; }
  let done = 0;
  const tmp = path.join(require('os').tmpdir(), `vex-release-body-${process.pid}.md`);
  try {
    for (const e of edits) {
      fs.writeFileSync(tmp, e.body, 'utf8');
      gh(['release', 'edit', e.tag, '--notes-file', tmp]);
      done++;
      console.log(`  edited ${e.tag} (${done}/${edits.length})`);
    }
  } finally { try { fs.rmSync(tmp, { force: true }); } catch (err) { console.warn('could not remove ' + tmp + ': ' + err.message); } }
  console.log(`edited ${done} release page(s)`);
  return 0;
}

if (require.main === module) {
  try { process.exit(main(process.argv.slice(2))); }
  catch (err) { console.error('add-turkish-to-releases: ' + err.message); process.exit(1); }
}
module.exports = { entryOf, withTurkish, plan, aliases };
