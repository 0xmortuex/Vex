// @vitest-environment jsdom
//
// The developer loop (js/dev-loop.js): CI failures, devlog, endpoint board,
// dependency radar, deploy desk. GitHub and the feeds are local stand-ins; the
// real services are never called.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
let L, vault, attention, calls;

const RUN = (id, extra = {}) => ({ id, name: 'CI', head_branch: 'main', head_sha: 'abcdef1234567', display_title: 'Fix things', html_url: 'https://github.com/o/r/actions/runs/' + id, updated_at: new Date().toISOString(), ...extra });
const LOG = [
  '2026-10-16T10:00:00.0000000Z Run npm test', '2026-10-16T10:00:01.0000000Z > vitest run',
  '2026-10-16T10:00:02.0000000Z \u001b[31mFAIL\u001b[0m tests/a.test.js', '2026-10-16T10:00:03.0000000Z ##[error]Process completed with exit code 1.',
  '2026-10-16T10:00:04.0000000Z token=abcd1234secretvalue',
].join('\n');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  calls = [];
  attention = { osNotify: vi.fn(async () => ({ ok: true })), suggest: vi.fn(() => true) };
  globalThis.VexAttention = attention;
  globalThis.VexProblems = { note: vi.fn() };
  globalThis.VexLedger = { note: vi.fn() };
  window.showToast = vi.fn();
  window.vex = {};
  delete globalThis.Ollama; delete globalThis.AIRouter; delete globalThis.NotesPanel; delete globalThis.HistoryPanel;
  vault = {
    enabled: () => true,
    json: vi.fn(async (p) => { calls.push(p); return vault._json(p); }),
    get: vi.fn(async (p) => { calls.push(p); return vault._get(p); }),
    _json: () => { throw new Error('unexpected ' ); },
    _get: () => { throw new Error('unexpected'); },
  };
  globalThis.GitHubVault = vault;
  L = fresh('../../src/renderer/js/dev-loop.js');
});

describe('redaction and excerpts', () => {
  it('takes tokens and secrets out of text', () => {
    const t = L.devLoopRedact('Bearer abcdefghijklmnop1234 and github_pat_11ABCDEFG0abcdefghijklmnopqrst and password=hunter2 and AKIAABCDEFGHIJKLMNOP and ' + 'Q'.repeat(20) + '1'.repeat(25));
    expect(t).not.toMatch(/abcdefghijklmnop1234|github_pat_11|hunter2|AKIAABCDEFGHIJKLMNOP|QQQQQQQQQQ/);
    expect(t).toContain('[redacted]');
  });
  it('keeps a commit hash and ordinary words', () => {
    expect(L.devLoopRedact('commit ' + 'a'.repeat(40) + ' fixed the build')).toContain('a'.repeat(40));
  });
  it('finds the first error and a redacted excerpt around it', () => {
    expect(L.CiFixLoop.errorLine(LOG)).toBe('Process completed with exit code 1.');
    const ex = L.CiFixLoop.excerpt(LOG);
    expect(ex).toContain('FAIL tests/a.test.js');
    expect(ex).not.toContain('2026-10-16T');
    expect(ex).not.toContain('abcd1234secretvalue');
  });
});

describe('CI failure loop', () => {
  beforeEach(() => {
    L.DevLoopRepos.add('o/r');
    let runs = [RUN(100)];
    vault._json = (p) => {
      if (p.includes('/actions/runs?')) return { workflow_runs: runs };
      if (p.endsWith('/jobs?per_page=30')) return { jobs: [{ id: 7, name: 'test', conclusion: 'failure', steps: [{ name: 'Set up', conclusion: 'success' }, { name: 'Run tests', conclusion: 'failure' }] }] };
      throw new Error('unexpected ' + p);
    };
    vault._get = (p) => { if (/jobs\/7\/logs$/.test(p)) return { ok: true, status: 200, authed: true, text: LOG }; throw new Error('unexpected ' + p); };
    vault.setRuns = (r) => { runs = r; };
  });
  it('the first look is the baseline, not news', async () => {
    expect(await L.CiFixLoop.checkAll()).toEqual([]);
    expect(attention.osNotify).not.toHaveBeenCalled();
    expect(L.CiFixLoop.state().seen['o/r']).toBe(100);
  });
  it('a new failed run becomes a card with the failing step, and one notice', async () => {
    await L.CiFixLoop.checkAll();
    vault.setRuns([RUN(101), RUN(100)]);
    const made = await L.CiFixLoop.checkAll();
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ repo: 'o/r', runId: 101, step: 'Run tests', job: 'test', sha: 'abcdef1', errorLine: 'Process completed with exit code 1.' });
    expect(made[0].excerpt).not.toContain('abcd1234secretvalue');
    expect(attention.osNotify).toHaveBeenCalledTimes(1);
    expect(attention.osNotify.mock.calls[0][0]).toMatchObject({ feature: 'ci-fix-loop', urgency: 'useful' });
    expect(globalThis.VexLedger.note).toHaveBeenCalled();
    // the same run is not told twice
    expect(await L.CiFixLoop.checkAll()).toEqual([]);
    expect(L.CiFixLoop.cards()).toHaveLength(1);
  });
  it('only reads: every GitHub request is a list, jobs or logs path', async () => {
    await L.CiFixLoop.checkAll();
    vault.setRuns([RUN(102)]);
    await L.CiFixLoop.checkAll();
    for (const p of calls) expect(p).toMatch(/^\/repos\/o\/r\/actions\/(runs\?|runs\/\d+\/jobs|jobs\/\d+\/logs)/);
  });
  it('says on the card when the log cannot be read', async () => {
    vault._get = () => ({ ok: false, status: 404, authed: false, text: '' });
    const card = await L.CiFixLoop.inspect('o/r', RUN(103));
    expect(card.logNote).toMatch(/needs a GitHub token/);
    expect(card.excerpt).toBe('');
    expect(card.step).toBe('Run tests');
  });
  it('reports a repository it could not read, and goes on', async () => {
    L.DevLoopRepos.add('o/two');
    const orig = vault._json;
    vault._json = (p) => { if (p.includes('/repos/o/r/')) throw new Error('GitHub answered 500'); return orig(p); };
    await L.CiFixLoop.checkAll();
    expect(L.CiFixLoop.state().errors['o/r']).toMatch(/500/);
    expect(globalThis.VexProblems.note).toHaveBeenCalled();
  });
  it('does nothing while switched off', async () => {
    L.CiFixLoop.setEnabled(false);
    expect(await L.CiFixLoop.checkAll()).toEqual([]);
    expect(vault.json).not.toHaveBeenCalled();
  });
  it('drafts a fix prompt only with a local model, and sends the redacted excerpt', async () => {
    const card = await L.CiFixLoop.inspect('o/r', RUN(104));
    await expect(L.CiFixLoop.draftFixPrompt(card)).rejects.toThrow(/never sent to a cloud model/);
    globalThis.AIRouter = { isOllamaAvailable: () => true, getModel: () => 'qwen' };
    globalThis.Ollama = { generate: vi.fn(async () => 'Fix the failing test in tests/a.test.js') };
    expect(await L.CiFixLoop.draftFixPrompt(card)).toMatch(/failing test/);
    const [model, prompt] = globalThis.Ollama.generate.mock.calls[0];
    expect(model).toBe('qwen');
    expect(prompt).toContain('Run tests');
    expect(prompt).not.toContain('abcd1234secretvalue');
  });
});

describe('devlog drafter', () => {
  beforeEach(() => {
    L.DevLoopRepos.add('o/r'); L.DevLoopRepos.add('o/empty');
    vault._json = (p) => {
      if (p.startsWith('/repos/o/r/commits?')) return [{ sha: 'aaaaaaa111', commit: { message: 'Add the board\n\nbody', author: { date: '2026-10-16T09:00:00Z' } } }, { sha: 'bbbbbbb222', commit: { message: 'Merge pull request #4 from x/y' } }];
      if (p.startsWith('/repos/o/empty/commits?')) return [];
      throw new Error('unexpected ' + p);
    };
  });
  it('makes a devlog from the commits, without merge commits', async () => {
    const d = await L.DevlogDrafter.draft({ date: new Date(2026, 9, 16, 12) });
    expect(d.method).toBe('plain list');
    expect(d.markdown).toContain('# Devlog 2026-10-16');
    expect(d.markdown).toContain('- Add the board (`aaaaaaa`)');
    expect(d.markdown).not.toContain('Merge pull request');
    expect(d.markdown).not.toContain('o/empty');
  });
  it('asks only for commits since the start of the day, by the user if one is set', async () => {
    L.DevlogDrafter.setAuthor('0xmortuex');
    await L.DevlogDrafter.draft({ date: new Date(2026, 9, 16, 12) });
    const q = vault.json.mock.calls.map(c => c[0]).find(p => p.startsWith('/repos/o/r/commits'));
    expect(q).toContain('author=0xmortuex');
    expect(q).toMatch(/since=\d{4}-\d{2}-\d{2}T/);
  });
  it('refuses to polish without a local model and says which method made the text when it does', async () => {
    await expect(L.DevlogDrafter.draft({ polish: true })).rejects.toThrow(/never sent to a cloud model/);
    globalThis.AIRouter = { isOllamaAvailable: () => true, getModel: () => 'qwen' };
    globalThis.Ollama = { generate: vi.fn(async () => 'Today I added the board.') };
    const d = await L.DevlogDrafter.draft({ polish: true, style: 'standup' });
    expect(d.method).toBe('local model');
    expect(d.markdown.startsWith('Today I added the board.')).toBe(true);
  });
  it('needs a repository and rejects a bad user name', async () => {
    L.DevLoopRepos.remove('o/r'); L.DevLoopRepos.remove('o/empty');
    await expect(L.DevlogDrafter.draft()).rejects.toThrow(/repository/);
    expect(() => L.DevlogDrafter.setAuthor('a b;c')).toThrow();
  });
  it('saves to Notes and never writes anywhere else', () => {
    globalThis.NotesPanel = { notes: [], save: vi.fn(), renderList: vi.fn() };
    const n = L.DevlogDrafter.saveToNotes({ day: '2026-10-16', markdown: '# x' });
    expect(globalThis.NotesPanel.notes[0]).toBe(n);
    expect(n.tags).toContain('devlog');
    expect(globalThis.NotesPanel.save).toHaveBeenCalled();
  });
});

describe('endpoint board', () => {
  const E = () => L.EndpointBoard;
  it('refuses credentials, secrets in the address, http and private networks', () => {
    for (const bad of ['http://w.example.com/', 'https://u:p@w.example.com/', 'https://w.example.com/?token=1', 'https://localhost/', 'https://192.168.0.2/', 'https://[::1]/', 'nonsense']) expect(() => E().add({ url: bad }), bad).toThrow();
    expect(E().items()).toHaveLength(0);
  });
  it('adds, rejects a duplicate, and caps the list', () => {
    E().add({ name: 'sync', url: 'https://sync.example.workers.dev/health' });
    expect(() => E().add({ url: 'https://sync.example.workers.dev/health' })).toThrow(/already/);
    for (let i = 0; i < 19; i++) E().add({ url: 'https://w' + i + '.example.com/' });
    expect(() => E().add({ url: 'https://one-too-many.example.com/' })).toThrow(/At most/);
  });
  it('judges an answer by status, field and speed', () => {
    const item = { expectStatus: 0, expectField: 'status', expectValue: 'ok' };
    expect(E().evaluate(item, { ok: true, status: 200, ms: 50, text: '{"status":"ok"}' }).state).toBe('up');
    expect(E().evaluate(item, { ok: true, status: 200, ms: 50, text: '{"status":"bad"}' }).state).toBe('down');
    expect(E().evaluate(item, { ok: true, status: 200, ms: 50, text: 'not json' }).state).toBe('down');
    expect(E().evaluate({}, { ok: true, status: 200, ms: 5000, text: '' }).state).toBe('slow');
    expect(E().evaluate({}, { ok: false, status: 500, ms: 10, text: '', error: '' }).state).toBe('down');
    expect(E().evaluate({ expectStatus: 401 }, { ok: false, status: 401, ms: 10, text: '' }).state).toBe('up');
    expect(E().evaluate({}, { ok: false, status: 0, ms: 10, text: '', error: 'ECONNREFUSED' }).why).toBe('ECONNREFUSED');
  });
  it('says it is down after two failed looks, once, and says when it is back', async () => {
    const item = E().add({ name: 'bot', url: 'https://bot.example.com/health', versionField: 'version' });
    let answer = { ok: true, status: 200, ms: 40, error: '', text: '{"version":"1.2.3"}' };
    window.vex.devfeedsPing = vi.fn(async () => answer);
    expect((await E().checkOne(item)).version).toBe('1.2.3');
    answer = { ok: false, status: 0, ms: 8000, error: 'timed out', text: '' };
    await E().checkOne(item);
    expect(attention.osNotify).not.toHaveBeenCalled();
    await E().checkOne(item);
    expect(attention.osNotify).toHaveBeenCalledTimes(1);
    expect(attention.osNotify.mock.calls[0][0]).toMatchObject({ feature: 'endpoint-board', title: 'bot is down' });
    await E().checkOne(item);
    expect(attention.osNotify).toHaveBeenCalledTimes(1);
    expect(E().summary()).toEqual({ total: 1, down: 1 });
    answer = { ok: true, status: 200, ms: 30, error: '', text: '{}' };
    await E().checkOne(item);
    expect(attention.osNotify).toHaveBeenCalledTimes(2);
    expect(attention.osNotify.mock.calls[1][0].title).toBe('bot is back');
    expect(E().summary().down).toBe(0);
    expect(E().state().results[item.id].history.length).toBeLessThanOrEqual(20);
  });
});

describe('dependency radar', () => {
  const D = () => L.DependencyRadar;
  it('reads versions out of ranges and compares them', () => {
    expect(D().minVersion('^3.2.4')).toBe('3.2.4');
    expect(D().minVersion('github:castlabs/electron-releases#v42.11.0+wvcus')).toBe('42.11.0');
    expect(D().minVersion('>=2.1')).toBe('2.1.0');
    expect(D().minVersion('latest')).toBe('');
    expect(D().compare('2.0.0', '3.0.0')).toBe('major');
    expect(D().compare('3.1.0', '3.2.0')).toBe('minor');
    expect(D().compare('3.2.1', '3.2.4')).toBe('patch');
    expect(D().compare('3.2.4', '3.2.4')).toBe('current');
    expect(D().compare('4.0.0', '3.2.4')).toBe('ahead');
  });
  it('reads package.json and pyproject.toml', () => {
    expect(D().parseManifest('{"dependencies":{"a":"^1.0.0"},"devDependencies":{"vitest":"^3.0.0"}}')).toEqual({ eco: 'npm', deps: { a: '^1.0.0', vitest: '^3.0.0' } });
    const py = D().parseManifest('[project]\nname="x"\ndependencies = [\n  "requests>=2.31",\n  "uv==0.4.0",\n]\n', 'pyproject.toml');
    expect(py.eco).toBe('pypi');
    expect(py.deps).toMatchObject({ requests: '>=2.31', uv: '==0.4.0' });
  });
  it('scans a repo: npm latest, castLabs electron, advisories for what is behind, and counts repos behind', async () => {
    L.DevLoopRepos.add('o/r'); L.DevLoopRepos.add('o/current');
    const pkg = (deps) => ({ encoding: 'base64', content: btoa(JSON.stringify({ devDependencies: deps })) });
    vault._json = (p) => {
      if (p === '/repos/o/r/contents/package.json') return pkg({ vitest: '^2.0.0', electron: 'github:castlabs/electron-releases#v42.5.2+wvcus', left: '1.0.0' });
      if (p === '/repos/o/current/contents/package.json') return pkg({ vitest: '^3.2.4' });
      if (p.startsWith('/repos/castlabs/electron-releases/releases')) return [{ tag_name: 'v43.0.0-beta.1+wvcus', prerelease: true }, { tag_name: 'v42.11.0+wvcus' }];
      throw new Error('unexpected ' + p);
    };
    window.vex.devfeedsLatest = vi.fn(async (eco, name) => ({ name, version: '3.2.4' }));
    window.vex.devfeedsAdvisories = vi.fn(async () => ({ count: 2 }));
    const out = await D().scanAll();
    const r = out.find(x => x.repo === 'o/r');
    expect(r.deps.find(d => d.name === 'vitest')).toMatchObject({ have: '2.0.0', latest: '3.2.4', gap: 'major', advisories: 2 });
    expect(r.deps.find(d => d.name === 'electron')).toMatchObject({ have: '42.5.2', latest: '42.11.0', gap: 'minor', castlabs: true, advisories: 0 });
    expect(r.deps.find(d => d.name === 'left')).toBeUndefined();   // not a key package
    expect(D().behindCount()).toBe(1);
    expect(D().summaryText()).toBe('1 repo behind');
    expect(attention.suggest).toHaveBeenCalledWith(expect.objectContaining({ feature: 'dependency-radar' }));
    // the second scan uses the cache for latest versions
    window.vex.devfeedsLatest.mockClear();
    await D().scanAll();
    expect(window.vex.devfeedsLatest).not.toHaveBeenCalled();
  });
  it('records a repo it could not read instead of stopping', async () => {
    L.DevLoopRepos.add('o/r');
    vault._json = () => { throw new Error('GitHub cannot show that (a private repository needs the token)'); };
    const out = await D().scanAll();
    expect(out[0].error).toMatch(/no package.json/);
  });
  it('rejects bad package names for the key list', () => {
    expect(() => D().setKeys(['ok', 'bad name'])).toThrow(/package name/);
    D().setKeys(['electron', '@scope/pkg']);
    expect(D().state().keys).toEqual(['electron', '@scope/pkg']);
  });
});

describe('deploy desk', () => {
  const NOW = Date.UTC(2026, 9, 16);
  const h = (url, daysAgo, title = '') => ({ url, title, time: NOW - daysAgo * 86400000 });
  it('builds groups from history host counts only', () => {
    const entries = [
      h('https://github.com/o/r/actions/runs/1', 1, 'CI run'), h('https://github.com/o/r/actions/runs/2', 0, 'CI run 2'), h('https://github.com/o/r', 2, 'repo'), h('https://github.com/o/r', 3, 'repo'),
      h('https://railway.com/project/abc', 1, 'Railway'), h('https://railway.app/project/abc', 2, 'Railway'),
      h('https://pypi.org/project/x/', 4, 'x'),                     // only once: left out
      h('https://vercel.com/old', 90),                               // outside the 60 days
      h('https://example.com/', 0), h('http://github.com/insecure', 0),
    ];
    const g = L.DeployDesk.build(entries, NOW);
    expect(g.map(x => x.id)).toEqual(['github', 'railway']);
    expect(g[0].count).toBe(4);
    expect(g[0].links[0].deep).toBe(true);
    expect(g[0].links[0].url).toBe('https://github.com/o/r/actions/runs/2');
  });
  it('groups hosts including subdomains', () => {
    expect(L.DeployDesk.groupOf('dash.cloudflare.com').id).toBe('cloudflare');
    expect(L.DeployDesk.groupOf('www.supabase.com').id).toBe('supabase');
    expect(L.DeployDesk.groupOf('notgithub.com')).toBeNull();
    expect(L.DeployDesk.groupOf('github.com.evil.example')).toBeNull();
  });
  it('pins only pages of the deploy hosts', () => {
    L.DeployDesk.pin('railway', 'https://railway.com/project/abc');
    expect(L.DeployDesk.state().pins.railway).toEqual(['https://railway.com/project/abc']);
    expect(() => L.DeployDesk.pin('railway', 'https://evil.example/x')).toThrow();
    expect(() => L.DeployDesk.pin('railway', 'http://railway.com/x')).toThrow();
  });
  it('notes when a GitHub watch finishes', () => {
    L.DeployDesk.start();
    document.dispatchEvent(new CustomEvent('vex:github-watch', { detail: { text: 'Deploy passed - o/r' } }));
    expect(L.DeployDesk.state().finished).toBe('Deploy passed - o/r');
    L.DeployDesk.setEnabled(false);
    document.dispatchEvent(new CustomEvent('vex:github-watch', { detail: { text: 'Other' } }));
    expect(L.DeployDesk.state().finished).toBe('Deploy passed - o/r');
  });
});

describe('the repository list', () => {
  it('parses owner/repo and github addresses', () => {
    const R = L.DevLoopRepos;
    expect(R.parse('0xmortuex/Vex')).toBe('0xmortuex/Vex');
    expect(R.parse('https://github.com/0xmortuex/Vex/actions')).toBe('0xmortuex/Vex');
    expect(R.parse('https://github.com/o/r.git')).toBe('o/r');
    expect(R.parse('../x')).toBeNull();
    expect(R.parse('just-a-word')).toBeNull();
    expect(() => R.add('nope')).toThrow(/owner\/repo/);
  });
  it('uses a repo registry when there is one, and a plain list otherwise', () => {
    L.DevLoopRepos.add('o/plain');
    expect(L.DevLoopRepos.list()).toEqual(['o/plain']);
    L.DevLoopRepos.addSource(() => [{ owner: 'o', repo: 'reg' }, 'o/plain', { nonsense: 1 }]);
    expect(L.DevLoopRepos.list().sort()).toEqual(['o/plain', 'o/reg']);
    expect(() => L.DevLoopRepos.addSource('nope')).toThrow(/function/);
  });
  it('starts again from a damaged record and says so', () => {
    localStorage.setItem('vex.devLoop.repos', '{not json');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(L.DevLoopRepos.list()).toEqual([]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
