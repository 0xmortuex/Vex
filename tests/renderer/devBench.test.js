// @vitest-environment jsdom
//
// Developer bench (js/dev-bench.js and the eight tools): the parts that decide what is shown, saved or sent.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
// vexId is a global of vex-utils.js in the app; stored ids come from it.
globalThis.vexId = (p) => p + Math.random().toString(36).slice(2, 8);
let B, Bug, Log, Err, Docs, Pkg, Lib, Sel, Redact;

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  for (const k of ['VexBench', 'VexRedact', 'VexTabPolicy', 'McpClient', 'vexConfirm']) delete globalThis[k];
  Redact = require(JS + 'redact.js'); globalThis.VexRedact = Redact;
  B = require(JS + 'dev-bench.js').VexBench; globalThis.VexBench = B;
  Bug = require(JS + 'bug-bundle.js').VexBugBundle;
  Log = require(JS + 'log-tailer.js').VexLogTailer;
  Err = require(JS + 'error-memory.js').VexErrorMemory;
  Docs = require(JS + 'docs-pin.js').VexDocsPin;
  Pkg = require(JS + 'pkg-card.js').VexPkgCard;
  Lib = require(JS + 'code-library.js').VexCodeLibrary;
  Sel = require(JS + 'selection-tools.js').VexSelectionTools;
  require(JS + 'response-overrides-ui.js');
});

describe('the bench', () => {
  it('registers all eight tools, every one off by default', () => {
    expect(B.features().map(f => f.id).sort()).toEqual(['bug-bundle', 'code-library', 'docs-pin', 'error-memory', 'log-tailer', 'pkg-card', 'response-overrides', 'selection-tools']);
    expect(B.features().every(f => f.enabled() === false)).toBe(true);
  });
  it('offers no menu rows while a tool is off, and its rows when it is on', () => {
    globalThis.VexTabPolicy = { canReadWebview: () => true };
    const wv = { getURL: () => 'https://example.com/a', getTitle: () => 'A' };
    expect(B.pageItems(wv)).toEqual([]);
    Bug.setEnabled(true);
    expect(B.pageItems(wv).map(i => i.label)).toEqual(['Copy bug report']);
  });
  it('refuses to read a private, Tor or routed tab', () => {
    globalThis.VexTabPolicy = { canReadWebview: () => false };
    expect(B.canRead({})).toBe(false);
  });
});

describe('redaction', () => {
  it('cleans console text of tokens, keys, e-mail and the Windows user name', () => {
    const out = Redact.redactText('fail Bearer abcdefgh12345678 for me@x.com at C:\\Users\\Fadi\\app.js ghp_' + 'a'.repeat(30) + ' https://a.test/p?token=zzz');
    expect(out).not.toMatch(/abcdefgh12345678|me@x\.com|Fadi|ghp_a|token=zzz/);
    expect(out).toContain('C:\\Users\\~');
  });
});

describe('bug report', () => {
  it('formats versions, errors and failed requests as markdown', () => {
    const md = Bug.format({ url: 'https://a.test/x?token=secret&n=1#h', appVersion: '22.22.1', userAgent: 'UA', platform: 'Win32', now: Date.UTC(2026, 9, 16),
      errors: [{ message: 'TypeError: x is undefined', where: 'https://a.test/app.js:3' }],
      requests: [{ method: 'GET', status: 404, url: 'https://a.test/missing', type: 'xhr' }, { method: 'POST', status: null, error: 'net::ERR_FAILED', url: 'https://a.test/p', type: '' }] });
    expect(md).toContain('https://a.test/x?token=[redacted]&n=1');
    expect(md).toContain('2026-10-16T00:00:00.000Z');
    expect(md).toContain('Console errors (1');
    expect(md).toContain('GET 404 `https://a.test/missing` (xhr)');
    expect(md).toContain('net::ERR_FAILED');
    expect(md).not.toContain('token=secret');
  });
  it('collects only errors, only while on, and keeps the last 20', () => {
    Bug.note(1, { level: 3, message: 'early' }, null);
    expect(Bug.errorsFor(1)).toEqual([]);
    Bug.setEnabled(true);
    Bug.note(1, { level: 1, message: 'info' }, null);
    for (let i = 0; i < 25; i++) Bug.note(1, { level: 3, message: 'e' + i }, null);
    expect(Bug.errorsFor(1)).toHaveLength(20);
    expect(Bug.errorsFor(1)[19].message).toBe('e24');
    Bug.reset(1);
    expect(Bug.errorsFor(1)).toEqual([]);
  });
});

describe('log tailer helpers', () => {
  it('turns ANSI colours into segments and drops other escapes', () => {
    const segs = Log.ansiSegments('\x1b[31mred\x1b[0m plain \x1b[1;32mbold green\x1b[0m\x1b[2K');
    expect(segs.map(s => s.text)).toEqual(['red', ' plain ', 'bold green']);
    expect(segs[0].color).toBe(Log.ANSI_COLOURS[31]);
    expect(segs[2]).toMatchObject({ bold: true, color: Log.ANSI_COLOURS[32] });
  });
  it('marks crashes, folds repeats, filters and builds an issue block', () => {
    expect(Log.isPanic('\x1b[31mKernel panic - not syncing\x1b[0m')).toBe(true);
    expect(Log.isPanic('#PF at 0xdeadbeef')).toBe(true);
    expect(Log.isPanic('all fine')).toBe(false);
    expect(Log.fold(['a', 'a', 'a', 'b']).map(e => [e.raw, e.count])).toEqual([['a', 3], ['b', 1]]);
    expect(Log.filter(Log.fold(['Alpha', 'beta']), 'ALP').map(e => e.raw)).toEqual(['Alpha']);
    const block = Log.panicBlock(['boot', 'ok', 'PANIC: bad', 'rip=1'], 'serial.log');
    expect(block).toContain('serial.log');
    expect(block).toContain('PANIC: bad');
    expect(Log.panicBlock(['fine'], 'x')).toBeNull();
  });
  it('keeps a partial last line for the next piece', () => {
    let s = Log.splitLines('', 'abc\nde');
    expect(s).toEqual({ lines: ['abc'], carry: 'de' });
    s = Log.splitLines(s.carry, 'f\n');
    expect(s).toEqual({ lines: ['def'], carry: '' });
  });
});

describe('error memory', () => {
  it('knows search addresses and error-looking words', () => {
    expect(Err.searchQuery('https://www.google.com/search?q=TypeError+cannot+read+properties')).toBe('TypeError cannot read properties');
    expect(Err.searchQuery('https://example.com/?q=x')).toBe('');
    expect(Err.looksLikeError('TypeError: cannot read properties of undefined')).toBe(true);
    expect(Err.looksLikeError('best pizza near me')).toBe(false);
  });
  it('treats the same error with other numbers, paths and ids as one', () => {
    const a = Err.normalise('Error: ENOENT no such file C:\\Users\\a\\x.js line 12 0xdeadbeef');
    const b = Err.normalise('error: enoent no such file C:\\Users\\b\\y.js line 99 0xcafe');
    expect(a).toBe(b);
  });
  it('remembers an answer and finds it again, newest first, capped', () => {
    Err.remember('TypeError: x is undefined at 12', [{ url: 'https://stackoverflow.com/q/1', title: 'Q' }], 1000);
    expect(Err.find('typeerror: x is undefined at 99').pages[0].url).toBe('https://stackoverflow.com/q/1');
    expect(() => Err.remember('boom', [{ url: 'file:///x' }])).toThrow(/no page/);
    for (let i = 0; i < 210; i++) Err.remember('error number ' + 'x'.repeat(i % 7) + ' z' + 'q'.repeat(i), [{ url: 'https://a.test/' + i }]);
    expect(Err.list().length).toBeLessThanOrEqual(200);
  });
  it('refuses to overwrite an unreadable list', () => {
    localStorage.setItem(Err.KEY, '{"oops":1}');
    expect(() => Err.remember('some error text here', [{ url: 'https://a.test/' }])).toThrow(/not readable/);
    expect(localStorage.getItem(Err.KEY)).toBe('{"oops":1}');
  });
});

describe('docs pinning and answer age', () => {
  it('reads the version of four docs hosts and swaps it', () => {
    expect(Docs.parse('https://docs.djangoproject.com/en/4.2/topics/db/')).toEqual({ product: 'django', title: 'Django', version: '4.2' });
    expect(Docs.switchTo('https://docs.djangoproject.com/en/4.2/topics/db/', 'django', '5.1')).toBe('https://docs.djangoproject.com/en/5.1/topics/db/');
    expect(Docs.parse('https://docs.python.org/3.9/library/os.html').version).toBe('3.9');
    expect(Docs.switchTo('https://docs.python.org/3.9/library/os.html', 'python', '3.12')).toBe('https://docs.python.org/3.12/library/os.html');
    expect(Docs.parse('https://nodejs.org/docs/latest-v18.x/api/fs.html').version).toBe('18');
    expect(Docs.switchTo('https://nodejs.org/docs/latest-v18.x/api/fs.html', 'node', '22')).toBe('https://nodejs.org/docs/latest-v22.x/api/fs.html');
    expect(Docs.parse('https://doc.rust-lang.org/1.70.0/std/vec/').version).toBe('1.70.0');
    expect(Docs.switchTo('https://doc.rust-lang.org/stable/std/vec/', 'rust', 'stable')).toBeNull();
    expect(Docs.parse('http://docs.djangoproject.com/en/4.2/')).toBeNull();
  });
  it('keeps pins per project and refuses a bad version', () => {
    Docs.setPin('site', 'django', '5.1');
    expect(Docs.pinFor('django')).toBe('5.1');
    expect(() => Docs.setPin('site', 'django', '5.1; drop')).toThrow(/version/);
    expect(() => Docs.setPin('site', 'cobol', '1')).toThrow(/Unknown/);
    Docs.removePin('site', 'django');
    expect(Docs.pinFor('django')).toBeNull();
  });
  it('summarises answer ages and finds the newest good answer', () => {
    const now = Date.parse('2026-10-16T00:00:00Z');
    const s = Docs.summarize({ question: '2015-01-01T00:00:00Z', answers: [
      { id: '1', iso: '2015-02-01T00:00:00Z', score: 100, accepted: true },
      { id: '2', iso: '2024-02-01T00:00:00Z', score: 60, accepted: false },
      { id: '3', iso: '2026-01-01T00:00:00Z', score: 1, accepted: false },
    ] }, now);
    expect(s.accepted.id).toBe('1');
    expect(s.newestGood.id).toBe('2');
    expect(Math.round(s.questionAge)).toBe(12);
  });
});

describe('package card', () => {
  it('builds the card from a result', () => {
    expect(Pkg.parse('https://www.npmjs.com/package/zod')).toEqual({ eco: 'npm', name: 'zod' });
    const spec = Pkg.spec({ name: 'zod', version: '3.0.0', lastPublish: '2026-09-01T00:00:00Z', ageDays: 45, license: 'MIT', downloadsWeek: 1234567, deprecated: null,
      advisoriesChecked: true, advisories: [], notes: [], addCommand: 'pnpm add zod', safety: { level: 'ok', reasons: ['nothing above looked wrong'] } });
    expect(spec.tone).toBe('ok');
    expect(spec.rows.find(r => r[0] === 'Advisories')[1]).toBe('none found');
    expect(spec.actions[0].copy).toBe('pnpm add zod');
  });
  it('says advisories were not checked rather than none', () => {
    const spec = Pkg.spec({ name: 'serde', version: '1', lastPublish: null, ageDays: null, license: '', downloadsWeek: null, deprecated: null,
      advisoriesChecked: false, advisories: null, notes: ['x'], addCommand: 'cargo add serde', safety: { level: 'caution', reasons: ['no licence is declared'] } });
    expect(spec.rows.find(r => r[0] === 'Advisories')[1]).toBe('not checked');
  });
});

describe('code library', () => {
  it('detects the licence hint and the language', () => {
    expect(Lib.detectLicense('https://stackoverflow.com/q/1', 'x')).toMatch(/CC BY-SA/);
    expect(Lib.detectLicense('https://github.com/a/b', '// SPDX-License-Identifier: MIT\nint x;')).toBe('MIT');
    expect(Lib.detectLicense('https://blog.test/p', 'x')).toMatch(/unknown/);
    expect(Lib.detectLanguage('def f():\n    return 1', '')).toBe('python');
    expect(Lib.detectLanguage('x', 'language-rust')).toBe('rust');
  });
  it('saves with its source, de-duplicates, searches and copies with a comment in the right style', () => {
    const e = Lib.save({ code: 'def f():\n    return 1\n', url: 'https://stackoverflow.com/q/1', title: 'How to f', langHint: 'language-python' }, Date.UTC(2026, 9, 16));
    expect(e.lang).toBe('python');
    expect(Lib.save({ code: 'def f():\n    return 1', url: 'https://stackoverflow.com/q/1' }).id).toBe(e.id);
    expect(Lib.list()).toHaveLength(1);
    expect(Lib.search(Lib.list(), 'HOW TO')).toHaveLength(1);
    expect(Lib.search(Lib.list(), 'nothing')).toHaveLength(0);
    const text = Lib.withAttribution(e);
    expect(text.startsWith('# Source: https://stackoverflow.com/q/1 (How to f), saved 2026-10-16, licence: CC BY-SA')).toBe(true);
    expect(Lib.attribution({ ...e, lang: 'rust' }).startsWith('// Source:')).toBe(true);
    expect(Lib.attribution({ ...e, lang: 'html' }).endsWith('-->')).toBe(true);
  });
  it('refuses empty code, huge code and a page without an address', () => {
    expect(() => Lib.save({ code: '  ', url: 'https://a.test/' })).toThrow(/no code/);
    expect(() => Lib.save({ code: 'x'.repeat(20001), url: 'https://a.test/' })).toThrow(/larger/);
    expect(() => Lib.save({ code: 'x = 1', url: 'about:blank' })).toThrow(/web address/);
  });
});

describe('selection to my own MCP tools', () => {
  it('pins at most five and builds the exact request', () => {
    for (let i = 0; i < 5; i++) Sel.pin({ serverId: 's1', tool: 't' + i, arg: 'query' });
    expect(() => Sel.pin({ serverId: 's1', tool: 'extra', arg: 'query' })).toThrow(/Five/);
    const pin = Sel.list()[0];
    expect(Sel.payload(pin, 'acpi _CRS')).toEqual({ method: 'tools/call', params: { name: 't0', arguments: { query: 'acpi _CRS' } } });
    expect(Sel.payload(pin, 'x'.repeat(5000)).params.arguments.query).toHaveLength(4000);
  });
  it('asks before sending, shows the exact request, and sends nothing if declined', async () => {
    const pin = Sel.pin({ serverId: 's1', tool: 'lookup', arg: 'query', label: 'Spec' });
    const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'answer' }] }));
    globalThis.McpClient = { list: () => [{ id: 's1', name: 'Mine', url: 'http://localhost:8123/mcp' }], session: () => ({ tools: [] }), connect: vi.fn(), callTool };
    globalThis.VexTabPolicy = { canReadWebview: () => true };
    globalThis.vexConfirm = vi.fn(async () => false);
    expect(await Sel.send(pin, 'hello', {})).toBeNull();
    expect(globalThis.vexConfirm.mock.calls[0][0].html).toContain('http://localhost:8123/mcp');
    expect(globalThis.vexConfirm.mock.calls[0][0].html).toContain('hello');
    expect(callTool).not.toHaveBeenCalled();
  });
  it('never sends a selection from a private tab', async () => {
    const pin = Sel.pin({ serverId: 's1', tool: 'lookup', arg: 'query' });
    globalThis.McpClient = { list: () => [], session: () => null };
    globalThis.VexTabPolicy = { canReadWebview: () => false };
    await expect(Sel.send(pin, 'secret', {})).rejects.toThrow(/never sent/);
  });
});
