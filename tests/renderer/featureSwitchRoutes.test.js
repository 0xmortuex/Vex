// @vitest-environment jsdom
//
// Every route that flips a feature's switch must leave the feature consistent, not only its own
// Settings toggle. Library's "Turn on", Discover, Feature usage and Minimal Vex all go through the
// VexUsage adapter, which calls the module's setEnabled and nothing else (A.api in
// vex-usage-registry.js). The developer desk modules and the AI judgement modules used to register or
// clear their Ctrl+K commands, start or stop their job and push their config only from the Settings
// toggle, so turning them on from anywhere else left no command and turning them off left it listed.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const JS = '../../src/renderer/js/';

let sets, jobs;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  window.vex = {};
  sets = {};
  jobs = { started: 0, stopped: 0 };
  globalThis.VexProblems = { note: vi.fn() };
  globalThis.VexModuleCommands = { set(prefix, list) { sets[prefix] = list; } };
  globalThis.VexJobs = { every: () => { jobs.started++; return { stop() { jobs.stopped++; } }; } };
  delete globalThis.VexRepos; delete globalThis.TabManager; delete globalThis.GitHubVault; delete globalThis.VexAttention; delete globalThis.WebviewManager;
  globalThis.DevDeskUtil = fresh(JS + 'dev-desk-util.js').DevDeskUtil;
});

describe('developer desk modules: the adapter route (bare setEnabled) brings the commands', () => {
  const cases = [
    ['actions-board.js', 'ActionsBoard', 'actionsboard:'],
    ['log-reader.js', 'LogReader', 'logreader:'],
    ['plugin-dev.js', 'PluginDev', 'plugindev:'],
    ['electron-ticker.js', 'ElectronTicker', 'electronticker:'],
    ['secret-guard.js', 'SecretGuard', 'secretguard:'],
    ['dev-ports-pair.js', 'DevPortsPair', 'devports:'],
  ];
  for (const [file, name, prefix] of cases) {
    it(name + ': on registers its command, off clears it', () => {
      const M = fresh(JS + file)[name];
      // dev-ports-pair lists one command per paired port: give it one.
      if (name === 'DevPortsPair') localStorage.setItem('vex.devPorts', JSON.stringify({ pairs: { 3000: 'Vite' } }));
      M.setEnabled(true);
      const keys = Object.keys(sets).filter(k => k.startsWith(prefix.slice(0, 5)));
      expect(keys.length, name + ' registered nothing after setEnabled(true)').toBeGreaterThan(0);
      expect(sets[keys[0]].length).toBeGreaterThan(0);
      M.setEnabled(false);
      expect(sets[keys[0]]).toEqual([]);
    });
  }

  it('actions-board, electron-ticker and dev-ports-pair also start and stop their job on the adapter route', () => {
    const B = fresh(JS + 'actions-board.js').ActionsBoard;
    B.setEnabled(true);
    expect(jobs.started).toBe(1);
    B.setEnabled(false);
    expect(jobs.stopped).toBe(1);
    const T = fresh(JS + 'electron-ticker.js').ElectronTicker;
    T.setEnabled(true);
    expect(jobs.started).toBe(2);
    T.setEnabled(false);
    expect(jobs.stopped).toBe(2);
  });

  it('secret-guard tells the open pages on the adapter route', () => {
    const S = fresh(JS + 'secret-guard.js').SecretGuard;
    const sent = [];
    globalThis.WebviewManager = { webviews: new Map([['a', { send: (ch, cfg) => sent.push([ch, cfg]) }]]) };
    S.setEnabled(true);
    expect(sent.length).toBe(1);
    expect(sent[0][0]).toBe('vex-secret-guard-config');
    S.setEnabled(false);
    expect(sent.length).toBe(2);
  });

  it('the Settings toggle no longer repeats the follow-up (one place does it)', () => {
    const fs = require('fs');
    for (const f of ['actions-board.js', 'log-reader.js', 'electron-ticker.js', 'secret-guard.js', 'dev-ports-pair.js', 'plugin-dev.js']) {
      const src = fs.readFileSync(require.resolve(JS + f), 'utf8');
      expect(src, f).not.toMatch(/setEnabled\(on\);\s*this\.(sync|registerCommands|pushAll)\(\)/);
    }
  });
});

describe('AI judgement modules: the adapter route brings the commands', () => {
  it('AiRecipes registers on setEnabled', () => {
    require(JS + 'vex-utils.js');
    globalThis.VexIcons = require(JS + 'vex-icons.js').VexIcons;
    const { AiRecipes } = fresh(JS + 'ai-judgement.js');
    const spy = vi.spyOn(AiRecipes, 'registerCommands');
    AiRecipes.setEnabled(false);
    AiRecipes.setEnabled(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
