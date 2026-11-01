// @vitest-environment jsdom
//
// "This site" (js/this-site.js): a front door onto the commands that already
// exist for the site in front. Checked here: every row runs its existing
// handler (a Ctrl+K command by id, or the site panel at a section), nothing
// shows on Vex's own pages, the old phrases still find the command, and the
// menu works from the keyboard.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fs = require('fs');
const path = require('path');
const FILE = path.resolve(__dirname, '../../src/renderer/js/this-site.js');
const fresh = () => { delete require.cache[FILE]; return require(FILE).VexThisSite; };

function setup({ web = true, tor = false } = {}) {
  document.body.innerHTML = '<div id="url-bar"><button id="url-site-btn" type="button"></button></div>';
  window.showToast = vi.fn();
  globalThis.VexIcons = { svg: (n) => `<svg data-icon="${n}"></svg>` };
  const ctx = { web, host: web ? 'news.example' : '', tor, ephemeral: false };
  globalThis.SitePanel = { context: () => ctx, open: vi.fn() };
  const ids = ['siteprofiles', 'siterules', 'site-routes', 'sitebroken', 'sitedata', 'clearsite', 'boost', 'userscripts', 'translate-side', 'pinsite', 'remind', 'watch', 'readlater', 'archive-page', 'save-page'];
  const actions = {};
  globalThis.CommandBar = { commands: ids.map(id => (actions[id] = vi.fn(), { id, action: actions[id] })) };
  globalThis.VexExtras = { registerCommand: vi.fn((c) => { globalThis.CommandBar.commands.push(c); return true; }) };
  return { actions, ctx };
}

describe('This site', () => {
  let ts;
  beforeEach(() => { ts = fresh(); });

  it('every row with a command runs that Ctrl+K command, and every panel row opens the site panel at its section', () => {
    const { actions } = setup();
    for (const r of ts.ROWS.filter(x => x.cmd)) { ts.run(r); expect(actions[r.cmd]).toHaveBeenCalledTimes(1); }
    for (const r of ts.ROWS.filter(x => x.panel)) { ts.run(r); expect(SitePanel.open).toHaveBeenCalledWith({ section: r.panel }); }
  });

  it('rows point only at command ids that exist in the real command list', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/js/command.js'), 'utf8');
    for (const r of ts.ROWS.filter(x => x.cmd)) expect(src.includes(`id: '${r.cmd}'`), r.cmd).toBe(true);
  });

  it('a row whose command is missing says so out loud', () => {
    setup();
    globalThis.CommandBar.commands = [];
    expect(() => ts.run({ cmd: 'sitebroken' })).toThrow(/not in this build/);
  });

  it('shows no rows on Vex pages and local files, and a short note instead', () => {
    const { ctx } = setup({ web: false });
    expect(ts.rowsFor(ctx)).toEqual([]);
    ts.open();
    expect(document.querySelectorAll('.ts-row').length).toBe(0);
    expect(document.querySelector('.ts-empty')).toBeTruthy();
  });

  it('leaves the route row out of a Tor tab and keeps no empty group heading', () => {
    const { ctx } = setup({ tor: true });
    const rows = ts.rowsFor(ctx);
    expect(rows.some(r => r.cmd === 'site-routes')).toBe(false);
    rows.forEach((r, i) => { if (r.group) expect(rows[i + 1] && !rows[i + 1].group).toBeTruthy(); });
  });

  it('clicking a row closes the menu and runs the command', () => {
    const { actions } = setup();
    ts.open();
    document.querySelector('.ts-row[data-i]').click();
    expect(document.getElementById('vex-this-site')).toBeNull();
    expect(actions.siteprofiles).toHaveBeenCalled();
  });

  it('is a menu: role=menu, role=menuitem, arrows move, Escape closes and gives focus back to the site icon', () => {
    setup();
    const btn = document.getElementById('url-site-btn');
    const menu = ts.open();
    expect(menu.getAttribute('role')).toBe('menu');
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
    expect(items.length).toBeGreaterThan(10);
    expect(document.activeElement).toBe(items[0]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[1]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(items[items.length - 1]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('vex-this-site')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it('registers Ctrl+K "This site" with the old phrases as keywords, and a right-click on the site icon opens it', () => {
    setup();
    ts = fresh();
    ts.init();
    ts.init();
    expect(VexExtras.registerCommand).toHaveBeenCalledTimes(1);
    const cmd = VexExtras.registerCommand.mock.calls[0][0];
    expect(cmd).toMatchObject({ id: 'this-site', label: 'This site' });
    for (const phrase of ['site rules', 'site permissions', 'site settings', 'pin site', 'clear site data', 'this site is broken', 'zoom for this site', 'userscripts']) expect(cmd.keywords).toContain(phrase);
    document.getElementById('url-site-btn').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(document.getElementById('vex-this-site')).toBeTruthy();
    cmd.action();
  });

  it('is loaded late, not at first paint', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/js/lazy-boot.js'), 'utf8');
    expect(src).toContain("'js/this-site.js'");
  });
});
