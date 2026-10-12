// @vitest-environment jsdom
//
// check:ui's keyboard and screen-reader scan (a11yScan in scripts/check-ui.js):
// names, Tab stops, dialogs and the focus ring, judged on the live window.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const fresh = (p) => { const r = require.resolve(path.join(ROOT, p)); delete require.cache[r]; return require(r); };

describe('check:ui keyboard scan', () => {
  const src = read('scripts/check-ui.js').replace(/\r/g, '');
  const lib = src.slice(src.indexOf('const PAGE_LIB = `') + 'const PAGE_LIB = `'.length, src.indexOf("'installed';\n`;") + "'installed';\n".length)
    .replace(/\\\\/g, '\\');

  beforeEach(() => {
    document.body.innerHTML = '';
    // jsdom has no layout: every element is a 40x30 box on screen.
    Element.prototype.getBoundingClientRect = function () { return { left: 10, top: 10, right: 50, bottom: 40, width: 40, height: 30, x: 10, y: 10 }; };
    Element.prototype.getClientRects = function () { return [{}]; };
    document.elementFromPoint = () => null;     // not hittable: structure only, no focus sampling
    (0, eval)(lib);
  });

  const scan = (html, { dialog = false } = {}) => {
    document.body.innerHTML = '<div id="root">' + html + '</div>';
    return window.__vexCheckUi.a11yScan([], 'firefox', 'a test', '#root', dialog).findings.map(f => f.check);
  };

  it('is clean for a labelled, reachable control', () => {
    expect(scan('<button aria-label="Close">x</button><label>Name <input></label><button>Save</button>')).toEqual([]);
  });

  it('flags a control with no name, a positive tabindex, a button role that Tab cannot reach, and a focusable inside aria-hidden', () => {
    const found = scan('<button><svg></svg></button><button tabindex="2">T</button><div role="button">x</div><div aria-hidden="true"><button>h</button></div>');
    expect(found).toContain('a11y-unnamed');
    expect(found).toContain('a11y-tabindex');
    expect(found).toContain('a11y-not-focusable');
    expect(found).toContain('a11y-hidden-focusable');
  });

  it('names come from aria-labelledby, a label, an img alt, an svg title and a title', () => {
    expect(scan('<span id="l">Zoom</span><button aria-labelledby="l"></button><button><img alt="Back"></button><button><svg><title>Next</title></svg></button><button title="Stop"></button><input id="i"><label for="i">Find</label>')).toEqual([]);
  });

  it('flags a dialog with no role, no aria-modal, and no name', () => {
    expect(scan('<div class="vex-dialog"><button>OK</button></div>')).toContain('a11y-dialog-role');
    expect(scan('<div class="vex-dialog" role="dialog"><button>OK</button></div>')).toEqual(expect.arrayContaining(['a11y-dialog-modal', 'a11y-dialog-name']));
    expect(scan('<div class="vex-dialog" role="dialog" aria-modal="true" aria-label="Sure?"><button>OK</button></div>')).toEqual([]);
  });

  it('a surface that is a modal by design must carry the dialog role', () => {
    expect(scan('<div class="picker"><button>OK</button></div>', { dialog: true })).toContain('a11y-dialog-role');
    expect(scan('<div class="picker" role="dialog" aria-modal="true" aria-label="Pick"><button>OK</button></div>', { dialog: true })).toEqual([]);
  });

  it('the surfaces that are modals are marked, and the new keyboard surfaces are opened', () => {
    for (const name of ['a dialog', 'the theme picker', 'the font picker', 'the keys sheet', 'the passkey sheet', 'the passkey picker', 'the boost editor', 'the developer dashboard']) {
      expect(src, name).toMatch(new RegExp("name: '" + name + "', dialog: true"));
    }
    for (const name of ['the site panel', 'the AI panel', 'a sidebar button menu']) expect(src).toContain("name: '" + name + "'");
  });

  it('a scan that judged no Tab stop or no ring is a harness failure, not a pass', () => {
    expect(src).toMatch(/if \(!ax\.judged \|\| !ax\.rings\) throw new Error\('judged no Tab stops or no focus ring at '/);
  });
});

describe('the AI panel hint\'s Dismiss button', () => {
  it('is at least 24x24 (WCAG 2.5.8): CI found it 21x18 beside the quick-action buttons', () => {
    const css = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/css/sync-settings.css'), 'utf8');
    const rule = css.match(/\.hint-dismiss \{([^}]*)\}/);
    expect(rule).toBeTruthy();
    expect(rule[1]).toMatch(/min-width:\s*24px/);
    expect(rule[1]).toMatch(/min-height:\s*24px/);
  });
});
