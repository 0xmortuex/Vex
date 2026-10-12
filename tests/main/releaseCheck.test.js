// scripts/release-check.js: the one-screen release summary. gh/git/plan are
// injected, nothing touches GitHub.
import { describe, it, expect } from 'vitest';
const { buildReport } = require('../../scripts/release-check.js');

const CL = '# Changelog\n\n## v1.1.0 (2026-10-11) — Second\n## v1.0.0 (2026-10-10) — First\n';
const OLD = CL;

function deps({ releases = ['v1.1.0', 'v1.0.0'], runs, rows, changelog = CL, packageVersion = '1.1.0' } = {}) {
  return {
    packageVersion,
    changelog,
    gh: args => JSON.stringify(args[0] === 'release' ? releases.map(t => ({ tagName: t, isDraft: false })) : (runs || [
      { databaseId: 7, headSha: 'c3', status: 'completed', conclusion: 'success', createdAt: '2026-10-12T10:00:00Z', workflowName: 'Verify Vex' },
    ])),
    git: args => (args[0] === 'rev-list' ? 'c3\nc2\n' : OLD),
    plan: () => {
      const r = rows || [{ hash: 'aaaaaaa1', subject: 'A fix', rank: 'fix-small-some', points: 10 }];
      return { tag: 'v1.1.0', current: '1.1.0', rows: r, total: r.reduce((n, x) => n + x.points, 0), unranked: r.filter(x => !x.rank) };
    },
  };
}

describe('release-check', () => {
  it('is blocked until the next version has a CHANGELOG entry', () => {
    const r = buildReport(deps());
    expect(r.next).toBe('1.2.0');
    expect(r.blockers.join('\n')).toMatch(/no "## v1.2.0 " entry/);
    expect(r.lines.join('\n')).toMatch(/package\.json\s+v1\.1\.0\s+published/);
    expect(r.lines).toContain('BLOCKED');
  });

  it('is ready when the entry exists and CI is green on HEAD', () => {
    const r = buildReport(deps({ changelog: '## v1.2.0 (2026-10-13) — New\n' + CL }));
    expect(r.blockers).toEqual([]);
    expect(r.lines.join('\n')).toMatch(/READY to release v1.2.0/);
    expect(r.lines.join('\n')).toMatch(/CI\s+GREEN on c3/);
  });

  it('blocks on a red CI run', () => {
    const red = [{ databaseId: 9, headSha: 'c3', status: 'completed', conclusion: 'failure', createdAt: '2026-10-12T10:00:00Z', workflowName: 'Verify Vex' }];
    const r = buildReport(deps({ runs: red, changelog: '## v1.2.0 (x) — New\n' + CL }));
    expect(r.blockers.join('\n')).toMatch(/CI is RED/);
  });

  it('blocks on unranked commits and says so', () => {
    const r = buildReport(deps({ rows: [{ hash: 'bbbbbbb2', subject: 'No rank', rank: null, points: 0 }] }));
    expect(r.blockers.join('\n')).toMatch(/no rank/);
    expect(r.lines.join('\n')).toMatch(/UNRANKED/);
  });

  it('reports nothing to release when nothing scores', () => {
    const r = buildReport(deps({ rows: [{ hash: 'ccccccc3', subject: 'Tests', rank: 'none', points: 0 }] }));
    expect(r.next).toBe(null);
    expect(r.lines).toContain('NOTHING TO RELEASE');
  });
});
