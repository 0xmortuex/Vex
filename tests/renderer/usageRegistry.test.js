// @vitest-environment jsdom
//
// js/vex-usage-registry.js: every feature module that is in the build registers
// with VexUsage with a real switch, Minimal Vex turns each one off, and turning
// Minimal Vex off puts back exactly what was there (a feature that was off stays
// off, a mode comes back as the mode it was).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

const MODULES = [
  'vex-usage.js', 'feature-registry.js', 'feature-manifests.js', 'vex-settings-groups.js', 'vex-minimal-mode.js',
  'brief-actions.js', 'delights.js', 'resume-workday.js', 'citation-tracker.js', 'knowledge.js',
  'link-triage.js', 'listen-reader.js', 'one-box.js', 'workspace-metrics.js', 'vex-expression.js',
  'vex-fortune.js', 'fun/fun-core.js', 'vex-fun.js', 'living-core.js',
  'distraction-budget.js', 'smart-bookmarks.js', 'search-again.js', 'command-aliases.js',
  'meeting-prep.js', 'routine-detect.js', 'tab-cleanup.js',
  // The attention work: the master level, the inbox and the New Tab grid are features too.
  'vex-defaults.js', 'attention-state.js', 'attention-inbox.js', 'vex-playfulness.js', 'newtab-slots.js',
  'vex-usage-registry.js',
];

let ids;

function loadAll() {
  vi.resetModules();
  delete window.__vexUsageQueue;
  for (const f of MODULES) {
    const m = fresh(JS + f);
    for (const k of Object.keys(m)) globalThis[k] = m[k];
  }
}

const tick = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="panel-settings"><div class="settings-content"></div></div>';
  loadAll();
});

describe('feature registry', () => {
  it('registers the new feature modules that are present, each with a way to read its switch', () => {
    ids = VexUsageRegistry.register();
    expect(ids.length).toBeGreaterThan(20);
    for (const f of VexUsage.features()) expect(typeof f.isEnabled, f.id).toBe('function');
    for (const must of ['brief-mail-triage', 'delight-mood-themes', 'workflow-ask-tabs', 'citations', 'listen-reader', 'play-tetris', 'distraction-budget', 'playfulness', 'attention-inbox', 'newtab-slots']) {
      expect(ids, must).toContain(must);
    }
  });

  it('Minimal Vex switches every registered feature off and back exactly', async () => {
    ids = VexUsageRegistry.register();
    // Put every feature that can be on, on, then also a mixed state below.
    for (const f of VexUsage.features()) { await f.enable(); expect(f.isEnabled(), 'on ' + f.id).toBe(true); }
    const before = Object.fromEntries(VexUsage.features().map(f => [f.id, f.isEnabled()]));
    const r = await VexMinimalMode.enter();
    expect(r.failed).toEqual([]);
    // The manifests keep the app's own housekeeping on in Minimal Vex (tiers.minimal).
    for (const f of VexUsage.features()) expect(f.isEnabled(), 'off ' + f.id).toBe(VexRegistry.tierDefault(f.id, 'minimal'));
    await VexMinimalMode.leave();
    await tick();
    const after = Object.fromEntries(VexUsage.features().map(f => [f.id, f.isEnabled()]));
    expect(after).toEqual(before);
  });

  it('a feature that was off before Minimal Vex is still off after, and a mode returns as it was', async () => {
    ids = VexUsageRegistry.register();
    const prep = VexUsage.features().find(f => f.id === 'meeting-prep');
    const tetris = VexUsage.features().find(f => f.id === 'play-tetris');
    const clean = VexUsage.features().find(f => f.id === 'tab-cleanup');
    MeetingPrep.setMode('auto');
    TabCleanup.setMode('ask');
    await tetris.disable();
    const initial = Object.fromEntries(VexUsage.features().map(f => [f.id, f.isEnabled()]));
    await VexMinimalMode.enter();
    expect(prep.isEnabled()).toBe(false);
    expect(clean.isEnabled()).toBe(false);
    await VexMinimalMode.leave();
    await tick();
    expect(MeetingPrep.mode()).toBe('auto');
    expect(TabCleanup.mode()).toBe('ask');
    expect(tetris.isEnabled()).toBe(false);
    const after = Object.fromEntries(VexUsage.features().map(f => [f.id, f.isEnabled()]));
    expect(after).toEqual(initial);
  });

  it('a module that is not in the build is simply not registered', () => {
    delete globalThis.TabCleanup;
    delete globalThis.MeetingPrep;
    ids = VexUsageRegistry.register();
    expect(ids).not.toContain('tab-cleanup');
    expect(ids).not.toContain('meeting-prep');
  });
});
