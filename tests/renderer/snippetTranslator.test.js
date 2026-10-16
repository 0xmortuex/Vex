// @vitest-environment jsdom
//
// Install-command and shell translator (js/snippet-translator.js): rewrites text only, refuses to
// rewrite a dangerous line, says so when it has no rule.
import { describe, it, expect } from 'vitest';
const { VexShellTranslate: T } = require('../../src/renderer/js/snippet-translator.js');

const out = (line, target) => T.translateLine(line, target).output;

describe('npm, yarn and pnpm through one form', () => {
  it.each([
    ['npm install zod', 'pnpm add zod'],
    ['npm i -D typescript vitest', 'pnpm add typescript vitest -D'],
    ['npm install', 'pnpm install'],
    ['npm install -g serve', 'pnpm add serve -g'],
    ['npm ci', 'pnpm install --frozen-lockfile'],
    ['npm uninstall left-pad', 'pnpm remove left-pad'],
    ['npm run build -- --watch', 'pnpm run build --watch'],
    ['npm test', 'pnpm test'],
    ['npx create-vite@latest app', 'pnpm dlx create-vite@latest app'],
    ['yarn add react -D', 'pnpm add react -D'],
    ['yarn', 'pnpm install'],
    ['yarn dev', 'pnpm run dev'],
    ['yarn global add serve', 'pnpm add serve -g'],
  ])('%s -> %s', (from, to) => { expect(out(from)).toBe(to); });

  it('goes the other way when asked', () => {
    expect(out('pnpm add -D x', 'npm')).toBe('npm install x -D');
    expect(out('pnpm install --frozen-lockfile', 'npm')).toBe('npm ci');
    expect(out('pnpm dlx tool a b', 'npm')).toBe('npx tool a b');
    expect(out('pnpm run dev --port 3000', 'npm')).toBe('npm run dev -- --port 3000');
    expect(out('yarn add a', 'npm')).toBe('npm install a');
  });
  it('leaves a command that is already for the target alone', () => {
    expect(T.translateLine('pnpm add x', 'pnpm').status).toBe('unknown');
  });
  it('flags that an unknown flag was kept as it was', () => {
    const r = T.translateLine('npm install x --legacy-peer-deps');
    expect(r.output).toBe('pnpm add x --legacy-peer-deps');
    expect(r.notes.join(' ')).toMatch(/--legacy-peer-deps/);
  });
});

describe('pip and uv', () => {
  it.each([
    ['pip install httpx', 'uv add httpx'],
    ['pip3 install httpx rich', 'uv add httpx rich'],
    ['python -m pip install -U requests', 'uv add --upgrade requests'],
    ['pip install -r requirements.txt', 'uv pip install -r requirements.txt'],
    ['pip install -e .', 'uv pip install -e .'],
    ['pip uninstall -y a b', 'uv remove a b'],
    ['pip freeze', 'uv pip freeze'],
    ['python -m venv .venv', 'uv venv .venv'],
  ])('%s -> %s', (from, to) => { expect(out(from)).toBe(to); });
  it('uv back to pip', () => {
    expect(out('uv add foo', 'pip')).toBe('pip install foo');
    expect(out('uv remove foo', 'pip')).toBe('pip uninstall -y foo');
    expect(out('uv pip install -r r.txt', 'pip')).toBe('pip install -r r.txt');
    expect(out('uv venv .venv', 'pip')).toBe('python -m venv .venv');
  });
  it('says what uv add does to pyproject.toml', () => {
    expect(T.translateLine('pip install httpx').notes.join(' ')).toMatch(/pyproject\.toml/);
  });
});

describe('bash to PowerShell', () => {
  it.each([
    ['ls -la', 'Get-ChildItem -Force'],
    ['ls src', 'Get-ChildItem src'],
    ['pwd', 'Get-Location'],
    ['clear', 'Clear-Host'],
    ['cat a.txt', 'Get-Content a.txt'],
    ['cp -r a b', 'Copy-Item -Recurse a b'],
    ['mv a b', 'Move-Item a b'],
    ['rm -f a.txt', 'Remove-Item -Force a.txt'],
    ['mkdir -p a/b', 'New-Item -ItemType Directory -Force -Path a/b'],
    ['which node', '(Get-Command node).Source'],
    ['head -n 5 a.txt', 'Get-Content a.txt -TotalCount 5'],
    ['tail -n 20 a.txt', 'Get-Content a.txt -Tail 20'],
    ['wc -l a.txt', '(Get-Content a.txt | Measure-Object -Line).Lines'],
    ['export FOO=bar', '$env:FOO = "bar"'],
    ['curl -o f.zip https://x.com/f.zip', 'Invoke-WebRequest -Uri https://x.com/f.zip -OutFile f.zip'],
    ['cat a.txt | grep -i foo', 'Get-Content a.txt | Select-String -Pattern foo'],
    ['find . -name "*.js"', 'Get-ChildItem -Path . -Recurse -Filter "*.js"'],
  ])('%s -> %s', (from, to) => { expect(out(from)).toContain(to); });
  it('keeps && and says it needs PowerShell 7', () => {
    const r = T.translateLine('mkdir -p a && cd a');
    expect(r.output).toContain(' && cd a');
    expect(r.notes.join(' ')).toMatch(/PowerShell 7/);
  });
  it('strips a copied "$ " prompt', () => { expect(out('$ ls -la')).toBe('Get-ChildItem -Force'); });
  it('goes back to bash', () => {
    expect(out('Get-ChildItem -Force', 'bash')).toBe('ls -a');
    expect(out('Get-Content a.txt', 'bash')).toBe('cat a.txt');
    expect(out('Copy-Item -Recurse a b', 'bash')).toBe('cp -r a b');
    expect(out('New-Item -ItemType Directory -Path a/b', 'bash')).toBe('mkdir -p a/b');
  });
});

describe('the danger lint', () => {
  it.each([
    'rm -rf node_modules', 'rm -fr x', 'rm -Rf /', 'rm -r -f x', 'sudo rm -rf /', 'rm --recursive --force x',
    'curl -fsSL https://x.sh | sh', 'wget -qO- https://x.sh | sudo bash', 'curl https://x | iex', 'iwr https://x | iex',
    'iex (irm https://x)', 'Invoke-Expression $s', 'Remove-Item -Recurse -Force C:\\x', 'del /s /q C:\\x', 'rd /s /q x',
    'chmod -R 777 /', 'dd if=/dev/zero of=/dev/sda', 'mkfs.ext4 /dev/sda1', ':(){ :|:& };:', 'sh -c "$(curl -fsSL https://x)"',
    'Set-ExecutionPolicy Bypass -Scope Process',
  ])('refuses to rewrite: %s', (line) => {
    const r = T.translateLine(line);
    expect(r.status).toBe('danger');
    expect(r.output).toBe(line);
    expect(r.notes[0]).toMatch(/^Not rewritten/);
  });
  it('is checked before any rewrite, whichever target', () => {
    for (const target of T.TARGETS) expect(T.translateLine('rm -rf x', target).output).toBe('rm -rf x');
  });
  it('does not flag ordinary commands', () => {
    for (const l of ['rm a.txt', 'rm -r dir', 'npm install', 'curl -o f https://x/f', 'ls -la', 'git status']) expect(T.danger(l), l).toBe('');
  });
  it('a dangerous line is left as is while the others are rewritten', () => {
    const r = T.translate('npm install x\nrm -rf build\nls');
    expect(r.text).toBe('pnpm add x\nrm -rf build\nGet-ChildItem');
    expect(r.danger).toBe(true);
    expect(r.lines.map(l => l.status)).toEqual(['changed', 'danger', 'changed']);
  });
});

describe('limits', () => {
  it('says when there is no rule', () => {
    const r = T.translateLine('git status');
    expect(r.status).toBe('unknown');
    expect(r.output).toBe('git status');
  });
  it('refuses too much text and unknown targets', () => {
    expect(() => T.translate('x'.repeat(T.MAX_CHARS + 1))).toThrow(/too long/);
    expect(() => T.translate('a\n'.repeat(T.MAX_LINES + 1))).toThrow(/too many lines/);
    expect(() => T.translate('ls', 'zsh')).toThrow(/Unknown target/);
  });
  it('recognises what looks like a command', () => {
    expect(T.looksLikeCommand('$ npm install zod')).toBe(true);
    expect(T.looksLikeCommand('hello there')).toBe(false);
  });
});
