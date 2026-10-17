// @vitest-environment jsdom
//
// Wave 5 additions to the developer loop: the CI card's "Open in editor" (T1-002), the devlog's extra sources
// (T1-029), the endpoint board's New Tab card with a drawn line (T1-030) and the dependency radar's release notes
// (T1-031). GitHub, the editor and the feeds are local stand-ins.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const JS = '../../src/renderer/js/';
let L, vault;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  globalThis.VexAttention = { osNotify: vi.fn(async () => ({ ok: true })), suggest: vi.fn(() => true) };
  globalThis.VexProblems = { note: vi.fn() };
  globalThis.VexLedger = { note: vi.fn() };
  window.showToast = vi.fn();
  window.vex = {};
  delete globalThis.NotesPanel; delete globalThis.HistoryPanel; delete globalThis.DevDesk; delete globalThis.NewTabSlots;
  vault = { enabled: () => true, status: vi.fn(async () => ({ has: true })), json: vi.fn(async (p) => vault._json(p)), get: vi.fn(), _json: () => { throw new Error('unexpected'); } };
  globalThis.GitHubVault = vault;
  L = fresh(JS + 'dev-loop.js');
});

describe('T1-002: open the failing file from the CI card', () => {
  const card = { repo: 'o/r', errorLine: 'x', excerpt: 'FAIL  /home/runner/work/r/r/tests/a.test.js:12:5\n  at D:\\a\\r\\r\\src\\b.js:7:1\nError: boom' };
  it('turns runner checkout paths into repository-relative references that name the repo', () => {
    globalThis.DevDeskUtil = fresh(JS + 'dev-desk-util.js').DevDeskUtil;
    globalThis.DevDesk = fresh(JS + 'dev-desk.js').DevDesk;
    const refs = L.CiFixLoop.editorRefs(card);
    expect(refs.map(r => r.path + ':' + r.line)).toEqual(['.\\tests\\a.test.js:12', '.\\src\\b.js:7']);
    expect(refs.every(r => r.relative && r.repo === 'o/r')).toBe(true);
  });
  it('opens the first reference through the desk, and says why when there is none or the desk is missing', async () => {
    const openRef = vi.fn(async () => ({ ok: true }));
    globalThis.DevDesk = { parseTrace: (t) => (/a\.test/.test(t) ? [{ path: '.\\tests\\a.test.js', line: 12, col: 5, relative: true }] : []), openRef };
    await L.CiFixLoop.openInEditor(card);
    expect(openRef.mock.calls[0][0]).toMatchObject({ line: 12, repo: 'o/r' });
    await expect(L.CiFixLoop.openInEditor({ repo: 'o/r', errorLine: '', excerpt: 'nothing here' })).rejects.toThrow(/No file and line/);
    delete globalThis.DevDesk;
    expect(() => L.CiFixLoop.editorRefs(card)).toThrow(/not available/);
  });
  it('DevDesk looks in the folder of the named repository first', () => {
    globalThis.DevDeskUtil = fresh(JS + 'dev-desk-util.js').DevDeskUtil;
    const D = fresh(JS + 'dev-desk.js').DevDesk;
    globalThis.VexRepos = { get: (n) => (n === 'o/r' ? { path: 'C:\\code\\r' } : null) };
    expect(D.candidates({ path: '.\\src\\b.js', relative: true, repo: 'o/r' })[0]).toBe('C:\\code\\r\\src\\b.js');
    delete globalThis.VexRepos;
  });
});

describe('T1-029: the devlog also lists pull requests, edited notes and page titles', () => {
  const day = new Date(2026, 9, 16, 12);
  beforeEach(() => {
    L.DevLoopRepos.add('o/r');
    vault._json = (p) => {
      if (p.startsWith('/repos/o/r/commits?')) return [{ sha: 'aaaaaaa111', commit: { message: 'Add the board' } }];
      if (p.startsWith('/repos/o/r/pulls?')) return [
        { number: 7, title: 'Board', state: 'closed', merged_at: '2026-10-16T10:00:00Z', updated_at: '2026-10-16T10:00:00Z', user: { login: 'me' }, html_url: 'https://github.com/o/r/pull/7' },
        { number: 5, title: 'Old', state: 'open', updated_at: '2026-09-01T10:00:00Z', user: { login: 'me' } },
        { number: 8, title: 'Theirs', state: 'open', updated_at: '2026-10-16T10:00:00Z', user: { login: 'other' } },
      ];
      throw new Error('unexpected ' + p);
    };
    L.DevlogDrafter.setAuthor('me');
  });
  it('adds the day\'s pull requests of the author when the vault holds a token', async () => {
    const d = await L.DevlogDrafter.draft({ date: day });
    expect(d.markdown).toContain('## Pull requests');
    expect(d.markdown).toContain('o/r#7 Board (merged)');
    expect(d.markdown).not.toContain('Old');
    expect(d.markdown).not.toContain('Theirs');
    expect(d.counts.prs).toBe(1);
  });
  it('leaves pull requests out without a token, so the requests go to the commits', async () => {
    vault.status = vi.fn(async () => ({ has: false }));
    const d = await L.DevlogDrafter.draft({ date: day });
    expect(d.markdown).not.toContain('Pull requests');
    expect(vault.json.mock.calls.some(c => c[0].includes('/pulls'))).toBe(false);
  });
  it('page titles and edited notes only when asked for, titles without addresses, private visits left out', async () => {
    globalThis.HistoryPanel = { list: () => [
      { url: 'https://secret.example/a', title: 'The docs page', visitedAt: day.toISOString() },
      { url: 'https://x.example', title: 'Private one', visitedAt: day.toISOString(), ownSession: true },
      { url: 'https://y.example', title: 'Yesterday', visitedAt: new Date(2026, 9, 14).toISOString() },
    ] };
    globalThis.NotesPanel = { notes: [{ title: 'Plan', updatedAt: day.toISOString(), tags: [] }, { title: 'Devlog 2026-10-15', updatedAt: day.toISOString(), tags: ['devlog'] }, { title: 'Old note', updatedAt: new Date(2026, 9, 1).toISOString() }] };
    const off = await L.DevlogDrafter.draft({ date: day });
    expect(off.markdown).not.toContain('The docs page');
    const on = await L.DevlogDrafter.draft({ date: day, sources: { pages: true, notes: true } });
    expect(on.markdown).toContain('## Pages I read\n\n- The docs page');
    expect(on.markdown).toContain('## Notes I edited\n\n- Plan');
    for (const bad of ['secret.example', 'Private one', 'Yesterday', 'Old note', 'Devlog 2026-10-15']) expect(on.markdown).not.toContain(bad);
  });
  it('the choice is kept, and asking for pages without a history raises instead of skipping', async () => {
    L.DevlogDrafter.setSources({ pages: true });
    expect(L.DevlogDrafter.sources()).toEqual({ prs: true, pages: true, notes: false });
    await expect(L.DevlogDrafter.draft({ date: day })).rejects.toThrow(/history is not available/);
  });
});

describe('T1-030: an endpoint that is down appears on the New Tab with a drawn line', () => {
  const down = () => {
    const item = L.EndpointBoard.add({ name: 'worker', url: 'https://w.example.com/h' });
    const s = L.EndpointBoard.state();
    s.results[item.id] = { state: 'down', why: 'answered 500', status: 500, ms: 90, at: Date.now(), history: [40, 60, 90, 8000], fails: 2, since: 1 };
    L.EndpointBoard.save(s);
    return item;
  };
  it('has nothing to show while every endpoint is up, so it is never an always-on card', () => {
    expect(L.VexBriefEndpointHealth.available()).toBe(false);
    expect(L.VexBriefEndpointHealth.build()).toBeNull();
  });
  it('builds a red "down" line with the latest times as numbers for the page to draw', () => {
    down();
    expect(L.VexBriefEndpointHealth.available()).toBe(true);
    const b = L.VexBriefEndpointHealth.build();
    expect(b.lines[0]).toMatchObject({ text: 'worker', state: 'down', spark: [40, 60, 90, 8000] });
    const BI = fresh(JS + 'brief-integration.js').BriefIntegration;
    const p = BI.toPayload('endpoint-health', b);
    expect(p.items[0]).toMatchObject({ badge: 'down', spark: [40, 60, 90, 8000] });
  });
  it('one failed look is not enough, and the switch turns the card off', () => {
    const item = down();
    const s = L.EndpointBoard.state(); s.results[item.id].fails = 1; L.EndpointBoard.save(s);
    expect(L.VexBriefEndpointHealth.available()).toBe(false);
    s.results[item.id].fails = 2; L.EndpointBoard.save(s);
    L.EndpointBoard.setEnabled(false);
    expect(L.VexBriefEndpointHealth.available()).toBe(false);
  });
  it('competes for a New Tab slot with a high priority', () => {
    const reg = vi.fn();
    globalThis.NewTabSlots = { list: () => [], register: reg };
    expect(L.VexBriefEndpointHealth.registerSlot()).toBe(true);
    expect(reg.mock.calls[0][0]).toMatchObject({ id: 'brief-endpoint-health', slot: 'card', briefSection: 'endpoint-health', priority: 90 });
  });
  it('the brief page payload keeps at most 20 finite, bounded numbers per line', () => {
    const { VexBrief } = fresh(JS + 'brief.js');
    const v = VexBrief.normalise({ id: 'x', title: 'x', icon: 'x', maxItems: 6 }, { items: [{ text: 't', spark: [1, 'a', NaN, -3, 9e9, ...Array(30).fill(5)] }] });
    expect(v.items[0].spark.length).toBeLessThanOrEqual(20);
    expect(v.items[0].spark.every(n => Number.isFinite(n) && n >= 0 && n <= 600000)).toBe(true);
  });
});

describe('T1-031: release notes in the dependency radar', () => {
  const dep = { name: 'vitest', eco: 'npm', have: '2.0.0', latest: '3.0.0', gap: 'major' };
  it('asks main for the notes between the two versions, flags BREAKING, and caches them', async () => {
    window.vex.devfeedsNotes = vi.fn(async () => ({ name: 'vitest', repo: 'vitest-dev/vitest', note: '', releases: [{ version: '3.0.0', name: 'v3', url: 'https://github.com/x', breaking: true, breakingLines: ['BREAKING: node 18 dropped'], body: 'b' }] }));
    const n = await L.DependencyRadar.notes(dep);
    expect(window.vex.devfeedsNotes).toHaveBeenCalledWith('npm', 'vitest', '2.0.0', '3.0.0');
    expect(n.breaking).toBe(true);
    await L.DependencyRadar.notes(dep);
    expect(window.vex.devfeedsNotes).toHaveBeenCalledTimes(1);
  });
  it('raises when this build cannot read notes, and points castLabs to its releases page', async () => {
    await expect(L.DependencyRadar.notes(dep)).rejects.toThrow(/not available in this build/);
    const c = await L.DependencyRadar.notes({ ...dep, castlabs: true });
    expect(c.note).toContain('castlabs/electron-releases');
  });
  it('the dep rows remember their ecosystem', async () => {
    L.DevLoopRepos.add('o/r');
    vault._json = (p) => {
      if (p.startsWith('/repos/o/r/contents/package.json')) return { encoding: 'base64', content: btoa(JSON.stringify({ devDependencies: { vitest: '^2.0.0' } })) };
      throw new Error('unexpected ' + p);
    };
    window.vex.devfeedsLatest = vi.fn(async () => ({ version: '3.0.0' }));
    window.vex.devfeedsAdvisories = vi.fn(async () => ({ count: 0 }));
    const r = await L.DependencyRadar.scanRepo('o/r');
    expect(r.deps[0]).toMatchObject({ name: 'vitest', eco: 'npm', gap: 'major' });
  });
});
