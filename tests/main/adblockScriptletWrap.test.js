// YouTube's console showed "Identifier 'JSONPath' has already been declared"
// five times per page and main logged an unhandled "Script failed to execute"
// for each (walkthrough M1, 2026-10-07): @ghostery puts each scriptlet's
// dependencies at the page's top level and injects every scriptlet separately,
// so the second one sharing `class JSONPath` was a SyntaxError and never ran.

import { describe, it, expect, vi } from 'vitest';
import vm from 'vm';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { wrapScriptlet, _cosmeticEvent } = require('../../src/adblocker-engine.js');

// What @ghostery's assembleScript() builds for a scriptlet with a JSONPath dependency.
const scriptlet = (n) => [
  "if (typeof scriptletGlobals === 'undefined') { var scriptletGlobals = {}; }",
  'class JSONPath { static ok() { return true; } }',
  'function safeSelf() { return scriptletGlobals; }',
  `(function(){ safeSelf()['ran${n}'] = JSONPath.ok(); })()`,
].join(';');

describe('scriptlet wrapping', () => {
  it('unwrapped, the second scriptlet in a page is a SyntaxError (the bug)', () => {
    const ctx = vm.createContext({});
    vm.runInContext(scriptlet(1), ctx);
    expect(() => vm.runInContext(scriptlet(2), ctx)).toThrow(/JSONPath/);
  });

  it('wrapped, every scriptlet runs and they still share scriptletGlobals', () => {
    const ctx = vm.createContext({});
    for (const n of [1, 2, 3, 4, 5]) vm.runInContext(wrapScriptlet(scriptlet(n)), ctx);
    expect(vm.runInContext('JSON.stringify(scriptletGlobals)', ctx)).toBe('{"ran1":true,"ran2":true,"ran3":true,"ran4":true,"ran5":true}');
  });
});

describe('the event handed to the library', () => {
  it('runs scriptlets in the frame that asked, wrapped, and catches a failure (logged once)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const frame = { isDestroyed: () => false, executeJavaScript: vi.fn(() => Promise.reject(new Error('Script failed to execute'))) };
    const sender = { insertCSS: vi.fn(() => Promise.resolve()), executeJavaScript: vi.fn() };
    const ev = _cosmeticEvent({ sender, senderFrame: frame, frameId: 1, processId: 2 }, 'https://www.youtube.com/watch?v=x');
    expect(ev.frameId).toBe(1);
    ev.sender.executeJavaScript('var a = 1', true);
    ev.sender.executeJavaScript('var a = 1', true);
    await new Promise(r => setTimeout(r, 0));
    expect(sender.executeJavaScript).not.toHaveBeenCalled();
    expect(frame.executeJavaScript).toHaveBeenCalledWith('{\nvar a = 1\n}', true);
    const lines = err.mock.calls.filter(c => String(c[0]).includes('scriptlet failed on www.youtube.com'));
    expect(lines).toHaveLength(1);
    err.mockRestore();
  });
});
