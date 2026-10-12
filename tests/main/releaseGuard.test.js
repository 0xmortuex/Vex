// scripts/release-guard.js: release.js refuses a version that is already
// published, a renamed heading of a published release, and a red or running CI
// (2026-10-12: v19.91.7 went out on a red run; a published heading was renamed
// twice). All gh/git calls are injected; nothing here touches GitHub.
import { describe, it, expect } from 'vitest';
const { preflight, checkPublished, ciState, ciErrors, headings } = require('../../scripts/release-guard.js');

const CHANGELOG = [
  '# Changelog',
  '',
  '## v2.0.0 (2026-10-12) — The next one',
  '- new',
  '## v1.1.0 (2026-10-11) — Second',
  '## v1.0.0 (2026-10-10) — First',
].join('\n');

const OLD = '# Changelog\n\n## v1.1.0 (2026-10-11) — Second\n## v1.0.0 (2026-10-10) — First\n';

// gh/git fakes. releases: tag names; runs: gh run list rows; chain: rev-list.
function fakes({ releases = ['v1.1.0', 'v1.0.0'], runs = [], chain = ['c3', 'c2', 'c1'], atTag = {} } = {}) {
  return {
    gh(args) {
      if (args[0] === 'release') return JSON.stringify(releases.map(t => ({ tagName: t, isDraft: false })));
      if (args[0] === 'run') return JSON.stringify(runs);
      throw new Error('unexpected gh ' + args.join(' '));
    },
    git(args) {
      if (args[0] === 'rev-list') return chain.join('\n') + '\n';
      if (args[0] === 'show') {
        const tag = args[1].split(':')[0];
        if (tag in atTag) return atTag[tag];
        return OLD;
      }
      throw new Error('unexpected git ' + args.join(' '));
    },
  };
}
const run = (sha, status, conclusion, createdAt = '2026-10-12T10:00:00Z', id = 1) =>
  ({ databaseId: id, headSha: sha, status, conclusion, createdAt, workflowName: 'Verify Vex', event: 'push' });

describe('published check', () => {
  it('passes for a new version with untouched published headings', () => {
    const r = checkPublished({ version: '2.0.0', changelog: CHANGELOG, ...fakes() });
    expect(r.errors).toEqual([]);
  });

  it('refuses a version that already has a GitHub release', () => {
    const r = checkPublished({ version: '1.1.0', changelog: CHANGELOG, ...fakes() });
    expect(r.errors.join('\n')).toMatch(/v1\.1\.0 is already published/);
  });

  it('ignores a draft release', () => {
    const f = fakes();
    const gh = args => args[0] === 'release' ? JSON.stringify([{ tagName: 'v2.0.0', isDraft: true }]) : f.gh(args);
    const r = checkPublished({ version: '2.0.0', changelog: CHANGELOG, gh, git: () => { throw new Error('x'); } });
    expect(r.errors).toEqual([]);
  });

  it('refuses a published heading that was renamed', () => {
    const renamed = CHANGELOG.replace('— Second', '— Second, renamed');
    const r = checkPublished({ version: '2.0.0', changelog: renamed, ...fakes() });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/heading of published v1\.1\.0 was changed/);
    expect(r.errors[0]).toContain('— Second, renamed');
  });

  it('refuses a published heading that was removed', () => {
    const r = checkPublished({ version: '2.0.0', changelog: CHANGELOG.replace(/## v1\.0\.0.*\n?/, ''), ...fakes() });
    expect(r.errors.join('\n')).toMatch(/no longer has the heading of published v1\.0\.0/);
  });

  it('accepts a renumbered release that is marked "_Released as <tag>._"', () => {
    const cl = CHANGELOG.replace('## v1.0.0 (2026-10-10) — First', '## v9.0.0 (2026-10-10) — First\n_Released as v1.0.0._');
    const r = checkPublished({ version: '2.0.0', changelog: cl, ...fakes() });
    expect(r.errors).toEqual([]);
  });

  it('warns, not fails, when a tag is not available locally', () => {
    const f = fakes();
    const git = args => { if (args[0] === 'show') throw new Error('bad object'); return f.git(args); };
    const r = checkPublished({ version: '2.0.0', changelog: CHANGELOG, gh: f.gh, git });
    expect(r.errors).toEqual([]);
    expect(r.warnings.length).toBe(2);
  });

  it('raises when gh itself fails instead of assuming nothing is published', () => {
    const gh = () => { const e = new Error('x'); e.stderr = 'HTTP 502'; throw e; };
    expect(() => checkPublished({ version: '2.0.0', changelog: CHANGELOG, gh, git: () => '' })).toThrow(/gh release list: gh failed: HTTP 502/);
  });

  it('reads the first heading of each version', () => {
    expect([...headings(CHANGELOG).keys()]).toEqual(['2.0.0', '1.1.0', '1.0.0']);
  });
});

describe('CI check', () => {
  it('is green when HEAD has a successful run', () => {
    const s = ciState(fakes({ runs: [run('c3', 'completed', 'success')] }));
    expect(s).toMatchObject({ state: 'green', sha: 'c3', distance: 0 });
    expect(ciErrors(s)).toEqual([]);
  });

  it('is red when the newest run failed', () => {
    const s = ciState(fakes({ runs: [run('c3', 'completed', 'failure')] }));
    expect(s.state).toBe('red');
    expect(ciErrors(s)[0]).toMatch(/CI is RED on c3/);
  });

  it('uses the newest run of a sha: a green re-run clears an earlier red', () => {
    const s = ciState(fakes({ runs: [run('c3', 'completed', 'failure', '2026-10-12T09:00:00Z', 1), run('c3', 'completed', 'success', '2026-10-12T11:00:00Z', 2)] }));
    expect(s.state).toBe('green');
  });

  it('is running while a run has not completed', () => {
    const s = ciState(fakes({ runs: [run('c3', 'in_progress', null)] }));
    expect(s.state).toBe('running');
    expect(ciErrors(s)[0]).toMatch(/still running/);
  });

  it('walks to the nearest ancestor with a run, and says HEAD has none', () => {
    const s = ciState(fakes({ runs: [run('c2', 'completed', 'success')] }));
    expect(s).toMatchObject({ state: 'green', sha: 'c2', distance: 1 });
    expect(ciErrors(s)[0]).toMatch(/HEAD has no CI run yet/);
  });

  it('reports a red ancestor when HEAD has no run', () => {
    const s = ciState(fakes({ runs: [run('c1', 'completed', 'failure')] }));
    expect(s.state).toBe('red');
    expect(s.distance).toBe(2);
  });

  it('ignores runs of other workflows and finds none', () => {
    const other = { ...run('c3', 'completed', 'success'), workflowName: 'Something else' };
    const s = ciState(fakes({ runs: [other] }));
    expect(s.state).toBe('none');
    expect(ciErrors(s)[0]).toMatch(/no "Verify Vex" run found/);
  });
});

describe('preflight', () => {
  it('collects publish and CI problems together', () => {
    const r = preflight({ version: '1.1.0', changelog: CHANGELOG, ...fakes({ runs: [run('c3', 'completed', 'failure')] }) });
    expect(r.errors).toHaveLength(2);
  });

  it('--ignore-ci skips only the CI check and says so', () => {
    const r = preflight({ version: '2.0.0', changelog: CHANGELOG, ignoreCi: true, ...fakes({ runs: [run('c3', 'completed', 'failure')] }) });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join('\n')).toMatch(/--ignore-ci/);
  });

  it('--ignore-ci still refuses a published version', () => {
    const r = preflight({ version: '1.0.0', changelog: CHANGELOG, ignoreCi: true, ...fakes() });
    expect(r.errors).toHaveLength(1);
  });
});
