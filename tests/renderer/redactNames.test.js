// redact-tool.js (the picture tool) and redact.js (redactUrl / redactText for bug reports) used to share
// the name VexRedact: the first declared a top-level const, the second set window.VexRedact. A bare
// VexRedact then meant the tool (bug-bundle.js: no redactUrl, so "Copy bug report" threw) and
// window.VexRedact meant the other object (capture-tools.js: no pickAndStrip). Each now has its own name.
// The scripts run here in ONE shared script scope, in the order index.html loads them, as a browser does.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.resolve(__dirname, '../../src/renderer/js');
const read = (f) => fs.readFileSync(path.join(JS, f), 'utf8');
const html = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/index.html'), 'utf8');

describe('the two redact scripts have separate names', () => {
  it('index.html loads redact-tool.js before redact.js, and bug-bundle.js after redact.js', () => {
    const at = (f) => html.indexOf('<script src="js/' + f + '"></script>');
    expect(at('redact-tool.js')).toBeGreaterThan(0);
    expect(at('redact.js')).toBeGreaterThan(at('redact-tool.js'));
    expect(at('bug-bundle.js')).toBeGreaterThan(at('redact.js'));
  });

  it('what bug-bundle.js and capture-tools.js call resolves to functions once both scripts are loaded', () => {
    const sandbox = {};
    sandbox.window = sandbox;
    const ctx = vm.createContext(sandbox);
    for (const f of ['redact-tool.js', 'redact.js']) vm.runInContext(read(f), ctx, { filename: f });
    // bug-bundle.js uses the bare name; capture-tools.js and screenshot.js use the picture tool.
    expect(read('bug-bundle.js')).toMatch(/\bVexRedact\.redactUrl\(/);
    expect(read('bug-bundle.js')).toMatch(/\bVexRedact\.redactText\(/);
    expect(read('capture-tools.js')).toMatch(/window\.VexPictureRedact\.pickAndStrip\(/);
    expect(vm.runInContext('typeof VexRedact.redactUrl', ctx)).toBe('function');
    expect(vm.runInContext('typeof VexRedact.redactText', ctx)).toBe('function');
    expect(vm.runInContext('typeof window.VexPictureRedact.pickAndStrip', ctx)).toBe('function');
    expect(vm.runInContext('typeof VexPictureRedact.open', ctx)).toBe('function');
    expect(vm.runInContext('VexRedact === VexPictureRedact', ctx)).toBe(false);
  });
});
