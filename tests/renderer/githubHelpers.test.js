// @vitest-environment jsdom
//
// GitHub page helpers (js/github-helpers.js): clipboard text for branch, command, commit message, permalink,
// local path and a prefilled new-issue address. Nothing runs git; the page script is fixed.
import { describe, it, expect } from 'vitest';
const { VexGithubHelpers: G } = require('../../src/renderer/js/github-helpers.js');

const SHA = 'a'.repeat(40);

describe('reading a github.com address', () => {
  it('issue and pull request pages take their title from the page title', () => {
    expect(G.parsePage('https://github.com/0xmortuex/vex/issues/12', 'Fix login crash on start · Issue #12 · 0xmortuex/vex'))
      .toMatchObject({ owner: '0xmortuex', repo: 'vex', kind: 'issue', number: 12, title: 'Fix login crash on start' });
    expect(G.parsePage('https://github.com/a/b/pull/5', 'Add support by someone · Pull Request #5 · a/b'))
      .toMatchObject({ kind: 'pull', number: 5, title: 'Add support' });
  });
  it('file, folder, commit and repository pages', () => {
    expect(G.parsePage('https://github.com/a/b/blob/main/src/x y/file.js', '')).toMatchObject({ kind: 'file', ref: 'main', path: 'src/x y/file.js' });
    expect(G.parsePage('https://github.com/a/b/tree/main/src', '')).toMatchObject({ kind: 'folder', path: 'src' });
    expect(G.parsePage('https://github.com/a/b/commit/' + SHA, '')).toMatchObject({ kind: 'commit' });
    expect(G.parsePage('https://github.com/a/b', '').kind).toBe('repo');
  });
  it('is not a repository page for settings, other hosts or the home page', () => {
    expect(G.parsePage('https://github.com/settings/profile', '')).toBeNull();
    expect(G.parsePage('https://example.com/a/b', '')).toBeNull();
    expect(G.parsePage('https://github.com/', '')).toBeNull();
  });
});

describe('branch name, command, commit message', () => {
  it('the branch is the number and a slug of the title', () => {
    expect(G.branchName({ number: 12, title: 'Fix login crash on start' })).toBe('12-fix-login-crash-on-start');
    expect(G.branchName({ number: 5, title: 'Add İstanbul support!!' })).toBe('5-add-istanbul-support');
    expect(G.branchName({ number: 7, title: '???' })).toBe('7');
  });
  it('a long title is cut at a word', () => {
    const b = G.branchName({ number: 1, title: 'a very long title that goes on and on and on and on forever and ever' });
    expect(b.length).toBeLessThanOrEqual(42);
    expect(b.endsWith('-')).toBe(false);
  });
  it('the switch command is text, and refuses a name that is not safe', () => {
    expect(G.switchCommand('12-fix')).toBe('git switch -c 12-fix');
    expect(() => G.switchCommand('-x; rm -rf')).toThrow(/not a branch name/);
    expect(() => G.switchCommand('a b')).toThrow(/not a branch name/);
  });
  it('the commit message is the title and the number', () => {
    expect(G.commitMessage({ number: 12, title: '  Fix  login\ncrash ' })).toBe('Fix login crash (#12)');
    expect(() => G.commitMessage({ number: 1, title: '' })).toThrow(/no title/);
  });
  it('refuses a page that is not an issue', () => { expect(() => G.branchName({ number: 0, title: 'x' })).toThrow(/issue or pull request/); });
});

describe('permalink and local path', () => {
  const file = { owner: 'a', repo: 'b', kind: 'file', ref: 'main', path: 'src/x y/file.js' };
  it('puts the SHA in place of the branch and keeps the line range', () => {
    expect(G.permalink(file, SHA, '#L10-L20')).toBe('https://github.com/a/b/blob/' + SHA + '/src/x%20y/file.js#L10-L20');
    expect(G.permalink(file, SHA, '#L5')).toContain('#L5');
  });
  it('ignores a hash that is not a line range, and refuses a missing SHA', () => {
    expect(G.permalink(file, SHA, '#<script>')).toBe('https://github.com/a/b/blob/' + SHA + '/src/x%20y/file.js');
    expect(() => G.permalink(file, 'main', '')).toThrow(/SHA/);
    expect(() => G.permalink({ kind: 'issue' }, SHA, '')).toThrow(/file or folder/);
  });
  it('the local path joins the chosen folder and the file path, and never touches the disk', () => {
    expect(G.localPath(file, { path: 'C:\\code\\b\\' })).toBe('C:\\code\\b\\src\\x y\\file.js');
    expect(() => G.localPath(file, null)).toThrow(/no folder/);
    expect(() => G.localPath({ ...file, path: '../../etc' }, { path: 'C:\\x' })).toThrow(/not valid/);
  });
});

describe('a new issue from a selection', () => {
  it('builds a prefilled address and never submits', () => {
    const u = new URL(G.newIssueUrl('a/b', 'Title here', 'body', 'https://x.example/p'));
    expect(u.origin + u.pathname).toBe('https://github.com/a/b/issues/new');
    expect(u.searchParams.get('title')).toBe('Title here');
    expect(u.searchParams.get('body')).toBe('body\n\nSource: https://x.example/p');
  });
  it('is checked: repo name, title, length', () => {
    expect(() => G.newIssueUrl('nope', 't', '', '')).toThrow(/owner\/name/);
    expect(() => G.newIssueUrl('a/b', '  ', '', '')).toThrow(/title/);
    expect(G.newIssueUrl('a/b', 't', 'x'.repeat(20000), '').length).toBeLessThanOrEqual(G.MAX_ISSUE_URL);
  });
  it('the first line is the title and the rest the body', () => {
    expect(G.splitSelection('Short line\nrest of it')).toEqual({ title: 'Short line', body: 'rest of it' });
    const long = G.splitSelection('word '.repeat(40));
    expect(long.title.length).toBeLessThanOrEqual(80);
    expect(long.body.length).toBeGreaterThan(100);
  });
});

describe('the page script', () => {
  it('is one fixed expression with no placeholder, valid JavaScript, returning plain strings', () => {
    expect(G.PAGE_SCRIPT.startsWith('(function(){')).toBe(true);
    expect(() => new Function('return ' + G.PAGE_SCRIPT)).not.toThrow();
    expect(G.PAGE_SCRIPT).not.toMatch(/\$\{|%s|eval\(|Function\(|fetch\(|XMLHttpRequest/);
  });
  it('finds a SHA in a link or in the embedded data, and nothing else', () => {
    const run = (html) => {
      document.body.innerHTML = html;
      return new Function('document', 'location', 'return ' + G.PAGE_SCRIPT)(document, { hash: '#L3' });
    };
    expect(run('<a href="/a/b/blob/' + SHA + '/x.js">p</a>').sha).toBe(SHA);
    expect(run('<script data-target="react-app.embeddedData">{"refInfo":{"currentOid":"' + 'b'.repeat(40) + '"}}</script>').sha).toBe('b'.repeat(40));
    expect(run('<a href="/a/b/blob/main/x.js">p</a>').sha).toBe('');
    expect(run('<a href="/a/b/blob/main/x.js">p</a>').hash).toBe('#L3');
  });
});
