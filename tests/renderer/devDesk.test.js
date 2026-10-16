// @vitest-environment jsdom
//
// The developer desk (js/dev-desk.js, dev-ports-pair.js, actions-board.js, log-reader.js,
// electron-ticker.js, secret-guard.js). GitHub, the ports and the editor are local stand-ins.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fs = require('fs');
const path = require('path');
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const JS = '../../src/renderer/js/';

let U, D, P, B, L, T, S;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  window.vex = {};
  globalThis.VexProblems = { note: vi.fn() };
  delete globalThis.VexRepos; delete globalThis.TabManager; delete globalThis.GitHubVault; delete globalThis.VexAttention;
  U = fresh(JS + 'dev-desk-util.js').DevDeskUtil;
  globalThis.DevDeskUtil = U;
  D = fresh(JS + 'dev-desk.js').DevDesk;
  P = fresh(JS + 'dev-ports-pair.js').DevPortsPair;
  B = fresh(JS + 'actions-board.js').ActionsBoard;
  L = fresh(JS + 'log-reader.js').LogReader;
  T = fresh(JS + 'electron-ticker.js').ElectronTicker;
  S = fresh(JS + 'secret-guard.js').SecretGuard;
});

describe('every desk feature is off until switched on', () => {
  it('starts off', () => {
    for (const f of [P, B, L, T, S]) expect(f.enabled()).toBe(false);
    expect(D.enabled()).toBe(false);
  });
  it('switches on and off', () => {
    for (const f of [P, B, L, T, S]) { f.setEnabled(true); expect(f.enabled()).toBe(true); f.setEnabled(false); expect(f.enabled()).toBe(false); }
  });
});

describe('T2-019 stack trace references', () => {
  it('reads Node, Python, C and Rust style lines', () => {
    expect(D.parseTrace('    at run (C:\\code\\vex\\src\\a.js:12:34)')).toEqual([{ path: 'C:\\code\\vex\\src\\a.js', line: 12, col: 34, relative: false }]);
    expect(D.parseTrace('  File "C:\\p\\app.py", line 7, in main')[0]).toMatchObject({ path: 'C:\\p\\app.py', line: 7, relative: false });
    expect(D.parseTrace('C:/w/x.c:5:9: error: nope')[0]).toMatchObject({ path: 'C:\\w\\x.c', line: 5, col: 9 });
    expect(D.parseTrace('  --> src/main.rs:20:5')[0]).toMatchObject({ path: 'src\\main.rs', line: 20, col: 5, relative: true });
  });
  it('ignores addresses, escapes and absurd line numbers, and repeats', () => {
    expect(D.parseTrace('at https://example.com/app.js:10:2')).toEqual([]);
    expect(D.parseTrace('see ..\\..\\secret.js:3')).toEqual([]);
    expect(D.parseTrace('C:\\a.js:99999999999')).toEqual([]);
    expect(D.parseTrace('C:\\a.js:1\nC:\\a.js:1')).toHaveLength(1);
  });
  it('resolves a relative path against the granted folders', () => {
    D._cfg = { enabled: true, roots: ['C:\\code\\vex'] };
    const [ref] = D.parseTrace('src/main.rs:20');
    expect(D.candidates(ref)).toEqual(['C:\\code\\vex\\src\\main.rs']);
  });
  it('shows menu rows only when switched on and an editor is chosen', () => {
    expect(D.selectionItems('C:\\a.js:1')).toEqual([]);
    D._cfg = { enabled: true, editor: 'vscode', roots: [] };
    expect(D.selectionItems('C:\\a.js:1')[0].label).toBe('Open in editor: a.js:1');
  });
  it('tries the next folder when a relative file is not in the first', async () => {
    D._cfg = { enabled: true, editor: 'vscode', roots: ['C:\\one', 'C:\\two'] };
    const open = vi.fn(async ({ path }) => { if (path.startsWith('C:\\one')) throw new Error('That file does not exist'); return { ok: true }; });
    window.vex.devdeskOpenFile = open;
    await D.openRef(D.parseTrace('lib/x.py:3')[0]);
    expect(open).toHaveBeenCalledTimes(2);
  });
  it('does not hide a real failure', async () => {
    D._cfg = { enabled: true, editor: 'vscode', roots: ['C:\\one', 'C:\\two'] };
    window.vex.devdeskOpenFile = vi.fn(async () => { throw new Error('Visual Studio Code was not found on this computer'); });
    await expect(D.openRef(D.parseTrace('lib/x.py:3')[0])).rejects.toThrow(/was not found/);
  });
});

describe('T2-005 dev ports', () => {
  it('knows a localhost port', () => {
    expect(P.portOf('http://localhost:5173/a')).toBe(5173);
    expect(P.portOf('http://127.0.0.1:8000')).toBe(8000);
    expect(P.portOf('https://localhost:5173')).toBe(0);
    expect(P.portOf('http://example.com:5173')).toBe(0);
    expect(P.portOf('http://localhost:80')).toBe(0);
  });
  it('pairs and unpairs, with limits', () => {
    P.pair(5173, '0xmortuex/vex');
    expect(P.pairs()).toEqual({ 5173: '0xmortuex/vex' });
    expect(() => P.pair(80, 'a/b')).toThrow(/1024 to 65535/);
    expect(() => P.pair(5174, '')).toThrow(/Name the repository/);
    P.unpair(5173);
    expect(P.pairs()).toEqual({});
    expect(() => P.unpair(5173)).toThrow(/not paired/);
  });
  it('isolates only a paired port, only when switched on, only an ordinary tab', () => {
    P.pair(8000, 'a/b');
    expect(P.reroute('http://localhost:8000/', null)).toBe(null);
    P.setEnabled(true); P.setIsolating(true);
    expect(P.reroute('http://localhost:8000/', null)).toBe('persist:container-devport-8000');
    expect(P.reroute('http://localhost:8001/', null)).toBe(null);
    expect(P.reroute('http://localhost:8000/', 'persist:container-work')).toBe('persist:container-work');
    expect(P.reroute('https://example.com/', null)).toBe(null);
  });
  it('reloads a tab once when its port comes back, and records it', async () => {
    P.pair(5173, 'a/b'); P.setEnabled(true);
    const reload = vi.fn();
    globalThis.TabManager = { tabs: [{ id: 't1', url: 'http://localhost:5173/' }] };
    globalThis.WebviewManager = { webviews: new Map([['t1', { reload }]]) };
    globalThis.VexLedger = { record: vi.fn() };
    let open = [];
    window.vex.devdeskPorts = vi.fn(async () => open);
    await P.tick();           // first look: down, nothing to reload
    await P.tick();
    expect(reload).not.toHaveBeenCalled();
    open = [5173];
    await P.tick();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(globalThis.VexLedger.record).toHaveBeenCalledTimes(1);
    await P.tick();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('T2-010 Actions board', () => {
  const run = (o = {}) => ({ id: 5, status: 'completed', conclusion: 'failure', name: 'CI', head_branch: 'main', updated_at: new Date().toISOString(), html_url: 'https://github.com/o/r/actions/runs/5', ...o });
  it('judges runs', () => {
    expect(B.verdict(B.summarize(run()))).toBe('failed');
    expect(B.verdict(B.summarize(run({ conclusion: 'success' })))).toBe('passed');
    expect(B.verdict(B.summarize(run({ status: 'in_progress', conclusion: null })))).toBe('running');
    expect(B.summarize(run({ html_url: 'https://evil.example/x' })).url).toBe('');
  });
  it('is red only for a failure that is new since the last look', () => {
    const r = B.summarize(run());
    expect(B.isRed('o/r', r, {})).toBe(true);
    expect(B.isRed('o/r', r, { 'o/r': 5 })).toBe(false);
    expect(B.isRed('o/r', B.summarize(run({ id: 6 })), { 'o/r': 5 })).toBe(true);
  });
  it('reads default branch then the newest run, read-only, and tells once', async () => {
    B.setEnabled(true);
    B.addRepo('https://github.com/o/r');
    const calls = [];
    globalThis.GitHubVault = { json: vi.fn(async (p) => { calls.push(p); return p === '/repos/o/r' ? { default_branch: 'trunk' } : { workflow_runs: [run()] }; }), quotaText: () => '' };
    globalThis.VexAttention = { suggest: vi.fn(() => true) };
    await B.refresh();
    expect(calls).toEqual(['/repos/o/r', '/repos/o/r/actions/runs?branch=trunk&per_page=1']);
    await B.refresh();
    expect(globalThis.VexAttention.suggest).toHaveBeenCalledTimes(1);
    B.markSeen();
    expect(B.isRed('o/r', B.state().rows['o/r'], B.state().seen)).toBe(false);
  });
  it('keeps one repository\'s error without stopping the others', async () => {
    B.setEnabled(true); B.addRepo('o/a'); B.addRepo('o/b');
    globalThis.GitHubVault = { json: vi.fn(async (p) => { if (p.includes('o/a')) throw new Error('GitHub cannot show that'); return p === '/repos/o/b' ? { default_branch: 'main' } : { workflow_runs: [] }; }) };
    await B.refresh();
    expect(B.state().errors['o/a']).toMatch(/cannot show/);
    expect(Object.keys(B.state().branches)).toEqual(['o/b']);
  });
  it('refuses to read while switched off', async () => {
    globalThis.GitHubVault = { json: vi.fn() };
    await expect(B.refresh()).rejects.toThrow(/switched off/);
  });
});

describe('T2-011 log reader', () => {
  const LOG = [
    '2026-10-15T12:00:00.0000000Z ##[group]Run npm test',
    '2026-10-15T12:00:01.0000000Z > vitest',
    '2026-10-15T12:00:02.0000000Z \u001b[31mFAIL\u001b[0m a.test.js',
    '2026-10-15T12:00:03.0000000Z ##[error]Process completed with exit code 1.',
    '2026-10-15T12:00:04.0000000Z ##[endgroup]',
    '2026-10-15T12:00:05.0000000Z warning: deprecated thing',
    '2026-10-15T12:00:06.0000000Z plain line',
  ].join('\n');
  it('folds groups, finds errors and warnings, keeps time stamps apart', () => {
    const p = L.parse(LOG);
    expect(p.groups).toEqual([{ id: 0, title: 'Run npm test', start: 0, end: 4, hasError: true }]);
    expect(p.errors).toEqual([2, 3]);
    expect(p.warnings).toEqual([5]);
    expect(p.lines[1].ts).toBe('2026-10-15T12:00:01.0000000Z');
    expect(p.lines[1].plain).toBe('> vitest');
  });
  it('draws ANSI colours as segments and strips them from plain text', () => {
    const segs = L.parse(LOG).lines[2].segs;
    expect(segs[0].text).toBe('FAIL');
    expect(segs[0].fg).toMatch(/danger/);
    expect(segs[1].fg).toBe('');
    expect(L.parse(LOG).lines[2].plain).toBe('FAIL a.test.js');
  });
  it('jumps to the next error and wraps', () => {
    const p = L.parse(LOG);
    expect(L.nextIn(p.errors, -1)).toBe(2);
    expect(L.nextIn(p.errors, 2)).toBe(3);
    expect(L.nextIn(p.errors, 3)).toBe(2);
    expect(L.nextIn([], 0)).toBe(-1);
  });
  it('searches plain text, not patterns', () => {
    const p = L.parse(LOG);
    expect(L.search(p, 'FAIL')).toEqual([2]);
    expect(L.search(p, '(.*)+')).toEqual([]);
    expect(L.search(p, '')).toEqual([]);
  });
  it('copies one section as plain text', () => {
    const p = L.parse(LOG);
    expect(L.sectionText(p, 0)).toContain('FAIL a.test.js');
    expect(() => L.sectionText(p, 9)).toThrow(/does not exist/);
  });
  it('refuses a log that is too big and cuts a long one', () => {
    expect(() => L.parse('x'.repeat(L.MAX_BYTES + 1))).toThrow(/MB/);
    const many = L.parse(Array(L.MAX_LINES + 5).fill('a').join('\n'));
    expect(many.truncated).toBe(true);
    expect(many.lines).toHaveLength(L.MAX_LINES);
  });
});

describe('T2-038 Electron ticker text', () => {
  it('says what it knows', () => {
    expect(T.describe(null)).toBe('Not checked yet');
    const s = T.describe({ pinned: '42.11.0', chrome: '148.0.1', behind: 2, latestSameMajor: '42.14.0', latest: '43.0.0', newerMajor: 1, pinnedListed: true });
    expect(s).toContain('2 behind');
    expect(s).toContain('Chromium 148');
    expect(s).toContain('a newer major exists (43.0.0)');
    expect(T.describe({ pinned: '42.14.0', behind: 0, newerMajor: 0, pinnedListed: true, latestSameMajor: '42.14.0', latest: '42.14.0' })).toContain('up to date');
  });
  it('tells the inbox once per new number, never a toast', async () => {
    T.setEnabled(true);
    globalThis.VexAttention = { suggest: vi.fn(() => true) };
    window.vex.castlabsBehind = vi.fn(async () => ({ pinned: '42.11.0', behind: 2, latestSameMajor: '42.14.0', latest: '42.14.0', newerMajor: 0, pinnedListed: true }));
    await T.check(); await T.check();
    expect(globalThis.VexAttention.suggest).toHaveBeenCalledTimes(1);
    expect(window.showToast).not.toHaveBeenCalled();
  });
  it('raises a failed check', async () => {
    T.setEnabled(true);
    window.vex.castlabsBehind = vi.fn(async () => { throw new Error('GitHub answered 500'); });
    await expect(T.check()).rejects.toThrow(/500/);
  });
});

describe('T2-047 secret guard', () => {
  const GH = 'ghp_' + 'a1B2c3D4e5'.repeat(4);
  it('finds keys by kind and count and never returns the match', () => {
    const found = S.detect('use ' + GH + ' and AKIAABCDEFGHIJKLMNOP then @everyone and @everyone');
    expect(found).toEqual([{ kind: 'GitHub token', count: 1 }, { kind: 'AWS access key', count: 1 }, { kind: 'Mass mention', count: 2 }]);
    expect(JSON.stringify(found)).not.toContain(GH);
    expect(S.detect('an ordinary sentence with sk-learn and a hash ' + 'a'.repeat(40))).toEqual([]);
  });
  it('finds a private key block and an Anthropic key', () => {
    expect(S.detect('-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----')[0].kind).toBe('Private key');
    expect(S.detect('sk-ant-api03-' + 'x'.repeat(40))[0].kind).toBe('OpenAI or Anthropic key');
  });
  it('redacts secrets, mass mentions and user folders', () => {
    const r = S.redact('token ' + GH + ' at C:\\Users\\fadi\\code\\x.js ping @everyone');
    expect(r.text).toBe('token <redacted: GitHub token> at ~\\code\\x.js ping (everyone)');
    expect(r.count).toBe(2);
    expect(r.paths).toBe(1);
  });
  it('asks before an AI prompt with a secret leaves, and sends nothing on no', async () => {
    S.setEnabled(true);
    globalThis.vexConfirm = vi.fn(async () => true);
    expect(await S.guardPrompt('hello')).toBe('hello');
    expect(globalThis.vexConfirm).not.toHaveBeenCalled();
    expect(await S.guardPrompt('key ' + GH)).toBe('key <redacted: GitHub token>');
    globalThis.vexConfirm = vi.fn(async () => false);
    expect(await S.guardPrompt('key ' + GH)).toBe(null);
  });
  it('does nothing while off', async () => {
    expect(await S.guardPrompt('key ' + GH)).toBe('key ' + GH);
  });
  it('holds a paste, asks with kinds only, and answers the page', async () => {
    S.setEnabled(true);
    globalThis.vexConfirm = vi.fn(async () => true);
    const send = vi.fn();
    await S.onPaste({ send }, { id: 4, kinds: [{ kind: 'GitHub token', count: 1 }], host: 'chat.example' });
    const asked = JSON.stringify(globalThis.vexConfirm.mock.calls);
    expect(asked).toContain('GitHub token');
    expect(send).toHaveBeenCalledWith('vex-secret-paste-decision', { id: 4, action: 'redact' });
    globalThis.vexConfirm = vi.fn(async () => false);
    await S.onPaste({ send }, { id: 5, kinds: [{ kind: 'Mass mention', count: 1 }], host: 'x.example' });
    expect(send).toHaveBeenLastCalledWith('vex-secret-paste-decision', { id: 5, action: 'cancel' });
  });
  it('keeps an allowed-sites list the page hook is told about', () => {
    S.setEnabled(true);
    expect(S.allow('WWW.GitHub.com')).toBe('github.com');
    expect(() => S.allow('not a site')).toThrow(/site name/);
    const send = vi.fn();
    S.push({ send });
    expect(send).toHaveBeenCalledWith('vex-secret-guard-config', { on: true, allow: ['github.com'] });
    S.disallow('github.com');
    expect(S.allowed()).toEqual([]);
  });
  it('uses the very same patterns in the page-side hook', () => {
    const block = (text) => /\/\/ BEGIN vex-secret-patterns\n([\s\S]*?)\/\/ END vex-secret-patterns/.exec(text.replace(/\r\n/g, '\n'))[1];
    const host = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/js/secret-guard.js'), 'utf8');
    const guest = fs.readFileSync(path.resolve(__dirname, '../../src/preload-webview.js'), 'utf8');
    expect(block(guest)).toBe(block(host));
  });
});
