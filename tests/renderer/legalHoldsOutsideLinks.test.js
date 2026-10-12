// @vitest-environment jsdom
//
// A link opened from another program (Vex as the default browser, a second
// start with a link, macOS open-url) opened a tab behind the required
// agreement (the setup's "Before you start" step, or the "privacy policy and
// terms have changed" dialog). Every such link reaches the window through
// main's 'open-url' (src/main.js), so the window holds them while the
// agreement is outstanding and opens them, in order, right after "I agree";
// "Quit Vex" quits with them unopened.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
const path = require('path');

require('../../src/renderer/js/vex-utils.js');
const { VexLegal } = require('../../src/renderer/js/legal.js');

beforeEach(() => {
  localStorage.clear();
  VexLegal._heldLinks.length = 0;
  delete window.VexTabPolicy;
});

describe('links from other programs wait for the agreement', () => {
  it('held while it has not been agreed to, opened in order on "I agree"', () => {
    const open = vi.fn();
    expect(VexLegal.openFromOutside('https://one.example/', open)).toBe(false);
    expect(VexLegal.openFromOutside('https://two.example/', open)).toBe(false);
    expect(open).not.toHaveBeenCalled();
    VexLegal.accept();
    expect(open.mock.calls.map(c => c[0])).toEqual(['https://one.example/', 'https://two.example/']);
    VexLegal.accept();   // nothing is opened twice
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('the "documents changed" case: agreed to an older version only, so still held', () => {
    localStorage.setItem(VexLegal.KEY, String(VexLegal.VERSION - 1));
    const open = vi.fn();
    expect(VexLegal.openFromOutside('https://later.example/', open)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('agreed already: opened at once', () => {
    localStorage.setItem(VexLegal.KEY, String(VexLegal.VERSION));
    const open = vi.fn();
    expect(VexLegal.openFromOutside('https://now.example/', open)).toBe(true);
    expect(open).toHaveBeenCalledWith('https://now.example/');
  });

  it('a link that fails to open does not stop the ones after it', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const opened = [];
    VexLegal.openFromOutside('bad', () => { throw new Error('boom'); });
    VexLegal.openFromOutside('https://good.example/', (u) => opened.push(u));
    VexLegal.accept();
    expect(opened).toEqual(['https://good.example/']);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("the window's open-url handler goes through it", () => {
    const app = fs.readFileSync(path.resolve('src/renderer/js/app.js'), 'utf8');
    const at = app.indexOf('window.vex.onOpenUrl?.((url) => {');
    expect(at).toBeGreaterThan(0);
    expect(app.slice(at, at + 1400)).toMatch(/VexLegal\.openFromOutside\(url, /);
  });
});
