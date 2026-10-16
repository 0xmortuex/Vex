// scripts/release-prepare.js, `--prepare` on release.js and version-points.js, and the
// commit-msg Rank check (T1-013). It must print what it would change, write nothing
// unless asked and then only two text files, and never publish or push.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const prep = require('../../scripts/release-prepare.js');
const points = require('../../scripts/version-points.js');
const { problem } = require('../../scripts/check-commit-rank.js');

const ROOT = path.resolve(__dirname, '../..');
const commit = (hash, subject, body = '') => ({ hash, subject, body });

describe('which commits are plainly bookkeeping', () => {
  const none = (subject, files = []) => prep.bookkeepingRank(commit('a'.repeat(40), subject), files);
  it('a CHANGELOG commit, a version bump, a Ranks commit and a merge count as nothing', () => {
    expect(none('CHANGELOG: v22.24.6 entry for the Ctrl+K still-mode fix')).toBe('none');
    expect(none('v22.22.1 — AI News in English by default')).toBe('none');
    expect(none('The v22.22.1 version bump counts no points of its own')).toBe('none');
    expect(none('Ranks: the two earlier Wave 0 merges count none')).toBe('none');
    expect(none("Merge branch 'w0-registry' into integration-3")).toBe('none');
  });
  it('a commit that touches only bookkeeping files, only tests, or only docs counts as nothing', () => {
    expect(none('Tidy', ['CHANGELOG.md', 'release-ranks.txt'])).toBe('none');
    expect(none('More tests', ['tests/renderer/a.test.js', 'tests/main/b.test.js'])).toBe('none');
    expect(none('Words', ['docs/x.md', 'README.md'])).toBe('none');
  });
  it('anything else needs a person', () => {
    expect(none('Fix the thing', ['src/main.js'])).toBeNull();
    expect(none('Fix the thing and its test', ['src/main.js', 'tests/main/a.test.js'])).toBeNull();
    expect(none('Feature', [])).toBeNull();
    expect(none('Docs in the app', ['src/renderer/help.md'])).toBeNull();
  });
});

describe('the CHANGELOG draft', () => {
  const rows = [
    { hash: 'aaaaaaa1', subject: 'Tab search: a list of every open tab.', rank: 'feature-mid-some', kind: 'feature', points: 50 },
    { hash: 'bbbbbbb2', subject: 'Back list', rank: 'improvement-small-some', kind: 'improvement', points: 15 },
    { hash: 'ccccccc3', subject: 'Crash on close', rank: 'fix-high-everyone', kind: 'fix', points: 75 },
    { hash: 'ddddddd4', subject: 'Merge branch x', rank: 'none', kind: 'none', points: 0 },
    { hash: 'eeeeeee5', subject: 'Secure thing', rank: 'security-small-some', kind: 'security', points: 40 },
  ];
  it('groups the ranked commits under New, Improved and Fixed and leaves out the ones that count nothing', () => {
    const g = prep.groupForChangelog(rows);
    expect(g.New.map(r => r.hash)).toEqual(['aaaaaaa1', 'eeeeeee5']);   // biggest first (50, then 40)
    expect(g.Improved.map(r => r.hash)).toEqual(['bbbbbbb2']);
    expect(g.Fixed.map(r => r.hash)).toEqual(['ccccccc3']);
  });
  it('writes a heading in the CHANGELOG style and marks every line as a draft', () => {
    const text = prep.draftEntry({ version: '22.30.1', date: '2026-10-17', title: '', rows });
    const lines = text.split('\n');
    expect(lines[0]).toBe('## v22.30.1 (2026-10-17) — Crash on close');
    expect(text).toContain('### New');
    expect(text).toContain('- **Tab search: a list of every open tab.** <!-- DRAFT from aaaaaaa (feature-mid-some)');
    expect(text.match(/<!-- DRAFT/g)).toHaveLength(4);
    expect(text).not.toContain('Merge branch');
  });
  it('takes the title it is given', () => {
    expect(prep.draftEntry({ version: '1.0.0', date: '2026-01-01', title: 'My release', rows: [] }).split('\n')[0]).toBe('## v1.0.0 (2026-01-01) — My release');
  });
});

describe('prepare', () => {
  const plan = {
    tag: 'v22.22.1', current: '22.22.1',
    rows: [], total: 0, unranked: [],
  };
  function scored(commits, ranksText = '') {
    const s = points.score(commits, points.readOverrides(ranksText));
    return { tag: 'v22.22.1', current: '22.22.1', ...s };
  }
  const HEAD = '## v22.22.1 (2026-10-15) — x';
  // `show --name-only` lists a commit's files; `show <tag>:CHANGELOG.md` is the published CHANGELOG.
  const git = (map) => (args) => {
    if (args[0] === 'show' && args[1] === '--name-only') return (map[args[3]] || []).join('\n');
    if (args[0] === 'show' && /:CHANGELOG\.md$/.test(args[1])) return HEAD + '\n';
    throw new Error('unexpected git call: ' + args.join(' '));
  };
  const published = { gh: () => JSON.stringify([{ tagName: 'v22.22.1', isDraft: false }]) };

  it('works out the version, proposes `none` for bookkeeping, and lists the commits it cannot rank', () => {
    const commits = [
      commit('1111111111111111111111111111111111111111', 'Tab search', 'Rank: feature-mid-some'),
      commit('2222222222222222222222222222222222222222', 'CHANGELOG: v22.30.0 entry'),
      commit('3333333333333333333333333333333333333333', 'Fix something big'),
    ];
    const r = prep.prepare({ plan: scored(commits), git: git({ [commits[2].hash]: ['src/main.js'], [commits[1].hash]: ['CHANGELOG.md'] }), changelog: '# Changelog\n\n' + HEAD + '\n', ranksText: '', ...published });
    expect(r.suggestions.map(s => [s.hash.slice(0, 4), s.rank])).toEqual([['2222', 'none'], ['3333', null]]);
    expect(r.stillUnranked).toHaveLength(1);
    expect(r.version).toBeNull();
    expect(r.notes.join(' ')).toMatch(/1 commit\(s\) still have no rank/);
    expect(r.changes.map(c => c.file)).toEqual(['release-ranks.txt']);
    expect(r.changes[0].add[0]).toMatch(/^2222222222 none    # CHANGELOG: v22\.30\.0 entry/);
    expect(prep.format(r)).toContain('It would change:');
  });
  it('with everything ranked it names the version, the two package lines and a draft entry', () => {
    const commits = [
      commit('1111111111111111111111111111111111111111', 'Tab search', 'Rank: feature-mid-some'),
      commit('2222222222222222222222222222222222222222', 'Version bump', ''),
    ];
    const r = prep.prepare({ plan: scored(commits), git: git({ [commits[1].hash]: ['package.json'] }), changelog: '# Changelog\n\n' + HEAD + '\n', ranksText: '', now: new Date(2026, 9, 17), title: 'Tabs', ...published });
    expect(r.stillUnranked).toEqual([]);
    expect(r.total).toBe(50);
    expect(r.version).toBe('22.27.1');   // 22.22.1 + 50 points = 22271 -> 22.27.1
    const files = r.changes.map(c => c.file);
    expect(files).toEqual(['release-ranks.txt', 'package.json', 'package-lock.json', 'CHANGELOG.md']);
    expect(r.changes[3].add[0]).toBe('## v22.27.1 (2026-10-17) — Tabs');
    expect(r.errors).toEqual([]);
  });
  it('leaves an entry that already exists alone', () => {
    const commits = [commit('1111111111111111111111111111111111111111', 'Tab search', 'Rank: feature-mid-some')];
    const r = prep.prepare({ plan: scored(commits), git: git({}), changelog: '# Changelog\n\n## v22.27.1 (x) — mine\n\n' + HEAD + '\n', ranksText: '', ...published });
    expect(r.changes.map(c => c.file)).toEqual(['package.json', 'package-lock.json']);
    expect(r.notes.join(' ')).toMatch(/already has "## v22\.27\.1 "/);
  });
  it('reports a published-heading change as REFUSED', () => {
    const commits = [commit('1111111111111111111111111111111111111111', 'Tab search', 'Rank: feature-mid-some')];
    const r = prep.prepare({
      plan: scored(commits), ranksText: '',
      git: (args) => (args[0] === 'show' && args[1].endsWith(':CHANGELOG.md') ? '## v22.22.1 (2026-10-15) — original\n' : ''),
      changelog: '# Changelog\n\n## v22.22.1 (2026-10-15) — RENAMED\n',
      gh: () => JSON.stringify([{ tagName: 'v22.22.1', isDraft: false }]),
    });
    expect(r.errors.join(' ')).toMatch(/heading of published v22\.22\.1 was changed/);
    expect(prep.format(r)).toContain('REFUSED:');
  });
});

describe('--write', () => {
  function tmp() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-prep-'));
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\r\n\r\n## v1.0.0 (x) — old\r\n- a\r\n');
    fs.writeFileSync(path.join(dir, 'release-ranks.txt'), '# ranks\nbase v1.0.0 1.0.0\n');
    return dir;
  }
  it('writes the two text files, in the working tree, and keeps the line ending', () => {
    const dir = tmp();
    const r = { errors: [], changes: [
      { file: 'release-ranks.txt', what: 'add', add: ['1234567890 none    # x'] },
      { file: 'package.json', what: 'version' },
      { file: 'CHANGELOG.md', what: 'add a draft', add: ['## v1.0.1 (2026-10-17) — t', '- **x.** <!-- DRAFT from 1234567 (fix-small-some): y -->', ''] },
    ] };
    const done = prep.write(r, { changelogPath: path.join(dir, 'CHANGELOG.md'), ranksPath: path.join(dir, 'release-ranks.txt') });
    expect(done).toEqual(['release-ranks.txt', 'CHANGELOG.md']);
    expect(fs.readFileSync(path.join(dir, 'release-ranks.txt'), 'utf8')).toBe('# ranks\nbase v1.0.0 1.0.0\n1234567890 none    # x\n');
    const cl = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
    expect(cl.startsWith('# Changelog\r\n\r\n## v1.0.1 (2026-10-17) — t\r\n')).toBe(true);
    expect(cl.endsWith('## v1.0.0 (x) — old\r\n- a\r\n')).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('refuses to write when the check found a problem', () => {
    expect(() => prep.write({ errors: ['published heading changed'], changes: [] })).toThrow(/refusing to write/);
  });
});

describe('it never publishes or pushes', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'release-prepare.js'), 'utf8');
  it('has no way to commit, tag, push, publish or build', () => {
    expect(src).not.toMatch(/'(push|commit|tag|add|publish)'/);
    expect(src).not.toMatch(/npm run|electron-builder|\bgh', \['release', '(create|upload|delete)/);
    expect(src).not.toMatch(/execSync|spawn|exec\(/);
  });
  it('release.js stops at --prepare before it can change a file or reach the network', () => {
    const rel = fs.readFileSync(path.join(ROOT, 'scripts', 'release.js'), 'utf8');
    const prepare = rel.indexOf("flags.has('--prepare')");
    expect(prepare).toBeGreaterThan(0);
    expect(rel.slice(prepare, prepare + 400)).toMatch(/process\.exit\(code\)/);
    for (const step of ['writeFileSync', "run('git", "run('npm run publish'", 'preflight(']) expect(rel.indexOf(step)).toBeGreaterThan(prepare);
  });
  it('a refusing draft cannot be released: release.js stops on a CHANGELOG entry that still has DRAFT markers', () => {
    const rel = fs.readFileSync(path.join(ROOT, 'scripts', 'release.js'), 'utf8');
    expect(rel).toMatch(/<!-- DRAFT/);
    expect(rel).toMatch(/is still a draft/);
  });
  it('version-points.js delegates --prepare after its exports exist', () => {
    const vp = fs.readFileSync(path.join(ROOT, 'scripts', 'version-points.js'), 'utf8');
    expect(vp.indexOf("require('./release-prepare.js')")).toBeGreaterThan(vp.indexOf('module.exports'));
  });
});

describe('the commit-msg Rank check', () => {
  it('accepts a valid rank, none, merges and fixups', () => {
    expect(problem('Add a thing\n\nBody\n\nRank: feature-mid-some\n')).toBeNull();
    expect(problem('Tests\n\nRank: none')).toBeNull();
    expect(problem("Merge branch 'x' into y")).toBeNull();
    expect(problem('fixup! Add a thing')).toBeNull();
    expect(problem('Windows\r\n\r\nRank: fix-small-rare\r\n')).toBeNull();
  });
  it('refuses a commit with no Rank line or a bad one', () => {
    expect(problem('Add a thing\n\nBody')).toMatch(/no "Rank:" line/);
    expect(problem('Add a thing\n\nRank: low')).toMatch(/bad rank/);
    expect(problem('Add a thing\n\nRank: feat-mid-some')).toMatch(/bad rank/);
    expect(problem('Add a thing\n\nRank: feature-mid')).toMatch(/bad rank/);
  });
  it('ignores a comment line git adds to the message', () => {
    expect(problem('# Rank: none\nAdd a thing')).toMatch(/no "Rank:" line/);
  });
  it('has a hook that calls it, which is not switched on by itself', () => {
    const hook = fs.readFileSync(path.join(ROOT, '.githooks', 'commit-msg'), 'utf8');
    expect(hook).toMatch(/check-commit-rank\.js/);
  });
});
