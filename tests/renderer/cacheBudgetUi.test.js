// @vitest-environment node
//
// The cache budget's window side (js/cache-budget-ui.js) and its wiring. The main side is tests/main/cacheBudget.test.js.
import { describe, it, expect } from 'vitest';
const fs = require('fs'), path = require('path');
const { VexCacheBudgetUI: UI } = require('../../src/renderer/js/cache-budget-ui.js');

const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('what the Settings section shows', () => {
  it('writes sizes short, with a non-breaking space before the unit', () => {
    expect(UI.sizeText(0)).toBe('0\u00a0KB');
    expect(UI.sizeText(1)).toBe('1\u00a0KB');
    expect(UI.sizeText(2048)).toBe('2\u00a0KB');
    expect(UI.sizeText(5 * 1048576)).toBe('5\u00a0MB');
    expect(UI.sizeText(1.5 * 1073741824)).toBe('1.50\u00a0GB');
  });
  it('lists the biggest clearable cache first and keeps offline storage apart', () => {
    const rows = UI.rowsFor({ parts: [
      { label: 'claude', cache: 5, code: 600, cacheStorage: 0 },
      { label: 'discord', cache: 100, code: 700, cacheStorage: 300, partial: true },
      { label: 'empty', cache: 0, code: 0, cacheStorage: 50 },
    ] });
    expect(rows.map(r => r.label)).toEqual(['discord', 'claude', 'empty']);
    expect(rows[0]).toEqual({ label: 'discord', clearable: 800, offline: 300, partial: true });
    expect(UI.rowsFor(undefined)).toEqual([]);
  });
});

describe('the wiring', () => {
  it('is a late module (no blocking tag) with a Settings section and a Ctrl+K command', () => {
    expect(read('src/renderer/js/lazy-boot.js')).toMatch(/js\/cache-budget-ui\.js/);
    expect(read('src/renderer/index.html')).not.toMatch(/cache-budget-ui\.js/);
    const src = read('src/renderer/js/cache-budget-ui.js');
    expect(src).toMatch(/VexSettingsGroups\.register\(/);
    expect(src).toMatch(/VexModuleCommands\.set\('cachebudget:'/);
  });
  it('the three channels have a schema, a preload call, a handler and are closed to pages and private windows', () => {
    const schemas = read('src/main/ipc-schemas.js');
    const preload = read('src/preload.js');
    const main = read('src/main.js');
    const policy = read('src/main/ipc-policy.js');
    for (const c of ['cachebudget:status', 'cachebudget:set', 'cachebudget:run']) {
      expect(schemas, c).toContain(c);
      expect(preload, c).toContain("ipcRenderer.invoke('" + c + "'");
      expect(main, c).toContain("ipcMain.handle('" + c + "'");
      expect(policy, c).toContain("'" + c + "'");
    }
    expect(policy).toMatch(/PRIVATE_DISABLED = \/\^\(\?:cachebudget:\(\?:set\|run\)\|/);
  });
  it('is off by default and registered as a feature', () => {
    expect(read('src/main/cache-budget.js')).toMatch(/enabled: false, limitGB: DEFAULT_GB/);
    expect(read('src/renderer/js/feature-catalog.js')).toMatch(/id: 'cache-budget'/);
    expect(read('src/renderer/js/feature-manifests.js')).toMatch(/id: 'cache-budget'/);
    expect(read('src/renderer/js/feature-details.js')).toMatch(/'cache-budget':/);
  });
  it('has Turkish for the heading, the command and the main sentences', () => {
    const tr = read('src/renderer/js/i18n-ui.js');
    for (const en of ['Storage: Vex cache size', 'Keep Vex’s Cache Under a Size', 'Keep the cache under a size', 'Clear now', 'Measure again']) expect(tr, en).toContain("'" + en + "':");
  });
});
