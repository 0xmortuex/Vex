// Every feature the guide can offer has to point at something that still
// exists: a live command, a control on screen, a panel, or a Settings switch.
// Without this, "Vex can do that — press Ctrl+K and choose X" survives the
// deletion of X, and the guide sends people to a button that is not there.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');
const { VexFeatures } = require('../../src/renderer/js/feature-catalog.js');

const read = (p) => fs.readFileSync(path.join(__dirname, '../../src/renderer/', p), 'utf8');
const html = read('index.html');
const commandSrc = read('js/command.js');
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const classes = new Set([...html.matchAll(/\sclass="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)));

// A selector the guide can point at: an id or class that is in the page, or
// one the code creates at runtime (those are listed here on purpose, so a
// typo still fails).
const RUNTIME = new Set(['.tab-item', '.top-tab', '#gui-shortcuts-bar', '#settings-backups', '.vts-card']);
function selectorExists(sel) {
  if (RUNTIME.has(sel)) return true;
  const first = sel.split(/[\s>,:[]/)[0];
  if (first.startsWith('#')) return ids.has(first.slice(1));
  if (first.startsWith('.')) return classes.has(first.slice(1));
  return true;                                   // a tag name; nothing to check
}

describe('every catalogue entry points at something real', () => {
  it('each named command exists in the command bar', () => {
    const missing = VexFeatures.ITEMS.filter(f => f.cmd && !new RegExp("id: '" + f.cmd + "'").test(commandSrc)).map(f => f.id + ' → ' + f.cmd);
    expect(missing).toEqual([]);
  });

  it('each control it would point at is in the page', () => {
    const missing = VexFeatures.ITEMS.filter(f => f.sel && !selectorExists(f.sel)).map(f => f.id + ' → ' + f.sel);
    expect(missing).toEqual([]);
  });

  it('each Settings switch it would open is in the page', () => {
    const missing = VexFeatures.ITEMS.filter(f => f.setting && f.setting.id && !ids.has(f.setting.id)).map(f => f.id + ' → ' + f.setting.id);
    expect(missing).toEqual([]);
  });

  it('each walkthrough step points at a control that is in the page', () => {
    const missing = [];
    for (const f of VexFeatures.ITEMS) for (const s of f.steps || []) if (s.sel && !selectorExists(s.sel)) missing.push(f.id + ' → ' + s.sel);
    expect(missing).toEqual([]);
  });

  it('every entry can be reached somehow, and says what it is for', () => {
    const stranded = VexFeatures.ITEMS.filter(f => !f.cmd && !f.sel && !f.panel && !f.setting && !f.keys && !f.manual).map(f => f.id);
    expect(stranded).toEqual([]);
    expect(VexFeatures.ITEMS.filter(f => !f.what || f.what.length < 20).map(f => f.id)).toEqual([]);
  });
});
