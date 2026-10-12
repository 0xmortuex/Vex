// The checks scripts/release.js and scripts/release-check.js share: is this
// version (or a CHANGELOG heading) already published, and is CI green for the
// commit being released? Both take injected runners (`gh(args)` and `git(args)`
// return stdout as a string, and throw on failure) so tests never touch GitHub.
//
// Why it exists (2026-10-12): v19.91.7 was published while its CI run was red
// on a 5 s test timeout, and the heading of an already-published version was
// renamed twice because nothing stopped the rename.
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const REPO = path.join(__dirname, '..');
const SLUG = '0xmortuex/Vex';
const WORKFLOW = 'Verify Vex';
// How many releases back the "published heading was changed" check looks, and
// how many ancestors are searched for the newest CI run.
const TAG_DEPTH = 15;
const CHAIN_DEPTH = 60;

function defaultGh(args) {
  return execFileSync('gh', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function defaultGit(args) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function ghJson(gh, args, what) {
  let out;
  try { out = gh(args); } catch (e) { throw new Error(`${what}: gh failed: ${String(e.stderr || e.message).trim()}`); }
  try { return JSON.parse(out); } catch { throw new Error(`${what}: gh did not return JSON`); }
}

// Non-draft release tags on GitHub, newest first.
function publishedTags(gh) {
  const rows = ghJson(gh, ['release', 'list', '--repo', SLUG, '--limit', '200', '--json', 'tagName,isDraft'], 'gh release list');
  return rows.filter(r => !r.isDraft).map(r => r.tagName);
}

// "## v1.2.3 (date) — title" lines: Map version -> full heading line.
function headings(changelog) {
  const out = new Map();
  for (const line of String(changelog || '').split(/\r?\n/)) {
    const m = /^## v(\d+\.\d+\.\d+)(?:\s|$)/.exec(line);
    if (m && !out.has(m[1])) out.set(m[1], line.trimEnd());
  }
  return out;
}

// version: the one being cut. changelog: the working-tree CHANGELOG.md text.
// Returns { errors, warnings, tags }.
function checkPublished({ version, changelog, gh = defaultGh, git = defaultGit, depth = TAG_DEPTH }) {
  const errors = [];
  const warnings = [];
  const tags = publishedTags(gh);
  if (version && tags.includes('v' + version)) {
    errors.push(`v${version} is already published on GitHub: it cannot be cut again; pick the next version`);
  }
  const current = headings(changelog);
  for (const tag of tags.slice(0, depth)) {
    const ver = tag.replace(/^v/, '');
    let old;
    try { old = git(['show', `${tag}:CHANGELOG.md`]); } catch {
      warnings.push(`${tag}: CHANGELOG.md not readable at that tag locally (git fetch --tags?); its heading was not compared`);
      continue;
    }
    const was = headings(old).get(ver);
    if (!was) continue;
    const now = current.get(ver);
    // Old releases were renumbered on 2026-10-10 (v2.38.1 became v13.39.9);
    // those entries say "_Released as v2.38.1._" and keep the old tag.
    if (!now && String(changelog).includes(`_Released as ${tag}._`)) continue;
    if (!now) errors.push(`CHANGELOG.md no longer has the heading of published ${tag}: "${was}"`);
    else if (now !== was) errors.push(`the CHANGELOG heading of published ${tag} was changed:\n    published: ${was}\n    now:       ${now}\n  restore it exactly (git show ${tag}:CHANGELOG.md)`);
  }
  return { errors, warnings, tags };
}

// The newest CI run on HEAD or the nearest ancestor that has one.
// Returns { state: 'green'|'red'|'running'|'none', sha, distance, run, errors }.
function ciState({ gh = defaultGh, git = defaultGit, depth = CHAIN_DEPTH } = {}) {
  const runs = ghJson(gh, ['run', 'list', '--repo', SLUG, '--branch', 'main', '--limit', '100', '--json', 'databaseId,headSha,status,conclusion,createdAt,workflowName,event'], 'gh run list')
    .filter(r => r.workflowName === WORKFLOW);
  const chain = git(['rev-list', `--max-count=${depth}`, 'HEAD']).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  for (let i = 0; i < chain.length; i++) {
    const here = runs.filter(r => r.headSha === chain[i]);
    if (!here.length) continue;
    const newest = here.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    let state;
    if (here.some(r => r.status !== 'completed')) state = 'running';
    else state = newest.conclusion === 'success' ? 'green' : 'red';
    return { state, sha: chain[i], distance: i, run: newest };
  }
  return { state: 'none', sha: null, distance: null, run: null };
}

// Turns a ciState into release errors (empty = fine).
function ciErrors(s) {
  const at = s.sha ? `${s.sha.slice(0, 7)}${s.distance ? ` (${s.distance} commit(s) behind HEAD)` : ' (HEAD)'}` : '';
  const url = s.run ? `\n  gh run view ${s.run.databaseId} --repo ${SLUG} --log-failed` : '';
  if (s.state === 'green') {
    return s.distance === 0 ? [] : [`HEAD has no CI run yet: the newest run is on ${at}. Push and wait for CI to pass on HEAD (or --ignore-ci)`];
  }
  if (s.state === 'red') return [`CI is RED on ${at}: do not release a failing build (--ignore-ci to override)${url}`];
  if (s.state === 'running') return [`CI is still running on ${at}: wait for it to finish (--ignore-ci to override)`];
  return [`no "${WORKFLOW}" run found on main within ${CHAIN_DEPTH} commits of HEAD: push and wait for CI (--ignore-ci to override)`];
}

// Everything release.js checks before it moves a file. Returns { errors, warnings }.
function preflight({ version, changelog, ignoreCi = false, gh = defaultGh, git = defaultGit }) {
  const pub = checkPublished({ version, changelog, gh, git });
  const errors = pub.errors.slice();
  const warnings = pub.warnings.slice();
  if (ignoreCi) warnings.push('--ignore-ci: the CI state of HEAD was NOT checked');
  else errors.push(...ciErrors(ciState({ gh, git })));
  return { errors, warnings };
}

module.exports = { preflight, REPO, SLUG, WORKFLOW, defaultGh, defaultGit, publishedTags, headings, checkPublished, ciState, ciErrors };
