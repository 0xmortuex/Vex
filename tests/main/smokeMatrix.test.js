// @vitest-environment jsdom
//
// T0-003: the parts of the integration smoke matrix (scripts/check-smoke-matrix.js)
// that need no Electron: choosing what to run, the budgets, and the page helpers.
import { describe, it, expect, vi } from 'vitest';
import vm from 'vm';

const M = require('../../scripts/check-smoke-matrix.js');
const { VexFeatures } = require('../../src/renderer/js/feature-catalog.js');

describe('arguments', () => {
  it('has sensible defaults and reads the options', () => {
    const d = M.parseArgs([]);
    expect(d.looks).toEqual(['firefox', 'glass', 'classic']);
    expect(d.cycles).toBe(3);
    const o = M.parseArgs(['--looks=firefox', '--cycles=20', '--only=notes,memory', '--allow=^Clear', '--list']);
    expect(o).toMatchObject({ looks: ['firefox'], cycles: 20, only: ['notes', 'memory'], list: true });
    expect(o.allow.test('Clear history')).toBe(true);
  });
  it('runs the Full tier by default and reads --tiers (Simple and Minimal too)', () => {
    expect(M.parseArgs([]).tiers).toEqual(['full']);
    expect(M.parseArgs(['--tiers=full,simple,minimal']).tiers).toEqual(['full', 'simple', 'minimal']);
    expect(() => M.parseArgs(['--tiers=expert'])).toThrow(/unknown tier/);
    expect(M.TIERS).toEqual(['full', 'simple', 'minimal']);
  });
  it('is part of CI: the sampled three-tier run is an npm script and a workflow step', () => {
    const fs = require('fs'), path = require('path');
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
    expect(pkg.scripts['smoke:matrix:ci']).toMatch(/--tiers=full,simple,minimal/);
    expect(fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'verify.yml'), 'utf8')).toMatch(/npm run smoke:matrix:ci/);
  });
  it('rejects what it does not know', () => {
    expect(() => M.parseArgs(['--looks=win98'])).toThrow(/unknown look/);
    expect(() => M.parseArgs(['--cycles=0'])).toThrow();
    expect(() => M.parseArgs(['--frobnicate'])).toThrow(/unknown argument/);
  });
});

describe('choosing what to run', () => {
  const item = (o) => ({ id: 'x', name: 'X', ...o });
  it('panels, Settings sections and commands run; service panels and manual items do not', () => {
    expect(M.planItem(item({ panel: 'notes' }))).toEqual({ kind: 'panel', panel: 'notes' });
    expect(M.planItem(item({ panel: 'netflix' })).skip).toMatch(/live website/);
    expect(M.planItem(item({ setting: { id: 'setting-x' } }))).toEqual({ kind: 'setting', target: 'setting-x' });
    expect(M.planItem(item({ setting: { section: 'sec' } }))).toEqual({ kind: 'setting', target: 'sec' });
    expect(M.planItem(item({ cmd: 'tasks', name: 'Tasks' }))).toEqual({ kind: 'command', cmd: 'tasks' });
    expect(M.planItem(item({})).skip).toMatch(/manual/);
  });
  it('holds back destructive or outward-reaching commands unless --allow names them', () => {
    for (const name of ['Clear browsing data', 'Quit Vex', 'Sign out', 'Back up everything', 'Take a screenshot', 'Launch Game Control Center', 'Install an extension']) {
      expect(M.planItem(item({ cmd: 'c', name })).skip, name).toMatch(/held back/);
    }
    expect(M.planItem(item({ cmd: 'c', name: 'Clear browsing data' }), { allow: /^Clear/i })).toEqual({ kind: 'command', cmd: 'c' });
  });
  it('on the real catalogue most items run, and nothing destructive slips through', () => {
    const { run, skipped } = M.selectItems(VexFeatures.ITEMS, {});
    expect(run.length).toBeGreaterThan(150);
    expect(run.length + skipped.length).toBe(VexFeatures.ITEMS.length);
    const slipped = run.filter(({ item }) => /clear|delete|quit|restart|uninstall|wipe|reset/i.test([item.name, item.cmd].join(' ')) && item.cmd && !item.panel && !item.setting);
    expect(slipped.map(s => s.item.id)).toEqual([]);
  });
  it('--only and --limit narrow the run', () => {
    expect(M.selectItems(VexFeatures.ITEMS, { only: ['memory-panel'] }).run.map(r => r.item.id)).toEqual(['memory-panel']);
    expect(M.selectItems(VexFeatures.ITEMS, { limit: 5 }).run).toHaveLength(5);
  });
});

describe('findings', () => {
  it('ignores network noise but not Vex errors', () => {
    expect(M.consoleIsIgnorable('Failed to load resource: net::ERR_INTERNET_DISCONNECTED')).toBe(true);
    expect(M.consoleIsIgnorable('TypeError: Cannot read properties of undefined (reading "x")')).toBe(false);
  });
  it('flags growth over budget only', () => {
    expect(M.leakBreaches({ nodes: 1000, listeners: 100, intervals: 4 }, { nodes: 1100, listeners: 120, intervals: 4 })).toEqual([]);
    const b = M.leakBreaches({ nodes: 1000, listeners: 100, intervals: 4 }, { nodes: 1500, listeners: 400, intervals: 6 });
    expect(b).toHaveLength(3);
    expect(b[0]).toMatch(/nodes grew by 500/);
  });
  it('reports only the layers that are new', () => {
    expect(M.newLayers(['#a<div>', '#b<div>'], ['#a<div>', '#b<div>', '#c.vex-dialog-overlay<div>'])).toEqual(['#c.vex-dialog-overlay<div>']);
  });
});

describe('the page helpers', () => {
  it('compile, install once, and see layers, intervals and a visible element', async () => {
    expect(() => new vm.Script(M.PAGE_SETUP)).not.toThrow();
    document.body.innerHTML = '<div id="top-bar">x</div><div class="a b c"></div>';
    expect(window.eval(M.PAGE_SETUP)).toBe('installed');
    expect(window.eval(M.PAGE_SETUP)).toBe('already');
    expect(window.__smoke.layers()).toEqual(['#top-bar.<div>', '.a.b<div>']);
    const id = window.setInterval(() => {}, 1000);
    expect(window.__smoke.intervals()).toBe(1);
    window.clearInterval(id);
    expect(window.__smoke.intervals()).toBe(0);
    const extra = document.createElement('div');
    extra.className = 'vex-dialog-overlay';
    document.body.appendChild(extra);
    expect(M.newLayers(['#top-bar.<div>', '.a.b<div>'], window.__smoke.layers())).toEqual(['.vex-dialog-overlay<div>']);
  });
  it('opening a panel through SidebarManager reports whether it became visible', async () => {
    document.body.innerHTML = '<div id="panel-notes"></div>';
    window.eval(M.PAGE_SETUP);
    const el = document.getElementById('panel-notes');
    el.getBoundingClientRect = () => ({ width: 100, height: 100, left: 0, top: 0 });
    window.eval('window.SidebarManager = { openPanel() {}, activePanel: null, hideActivePanel() {}, sidePanel: null, closeBeside() {} }');
    const r = await window.__smoke.open({ kind: 'panel', panel: 'notes' });
    expect(r).toEqual({ opened: true, what: 'panel-notes' });
    const missing = await window.__smoke.open({ kind: 'command', cmd: 'nope' });
    expect(missing).toMatchObject({ opened: false, missing: true });
  });
  it('reset closes the tabs an item opened (Container tabs) and keeps the ones that were there', async () => {
    document.body.innerHTML = '';
    window.eval(M.PAGE_SETUP);
    window.eval(`window.TabManager = { tabs: [{ id: 'a' }], closed: [], closeTab(id) { this.closed.push(id); this.tabs = this.tabs.filter(t => t.id !== id); } }`);
    window.eval(`window.CommandBar = { commands: [{ id: 'container-work', action: () => { TabManager.tabs.push({ id: 'c' + TabManager.tabs.length }); } }] }`);
    const plan = { kind: 'command', cmd: 'container-work' };
    for (let i = 0; i < 4; i++) {
      await window.__smoke.open(plan);
      expect(window.TabManager.tabs.length).toBe(2);
      expect(window.__smoke.reset()).toBe('ok');
      expect(window.TabManager.tabs.map(t => t.id)).toEqual(['a']);
    }
    expect(window.TabManager.closed.length).toBe(4);
  });
});

describe('safety', () => {
  it('the matrix script starts Vex only through the harness and sends no OS input', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'scripts', 'check-smoke-matrix.js'), 'utf8');
    expect(src).toMatch(/probe-harness/);
    expect(src).not.toMatch(/\bspawn\(/);
    expect(src).toMatch(/heavy-gate/);
  });
});
