// @vitest-environment jsdom
//
// Wave 1 integration: every feature the six Wave 1 branches added has a manifest, and every
// one of them that can be switched has a row in the VexUsage table, so Minimal Vex can turn it
// off and put it back. (The runtime off/on round trip for modules loaded together is in
// usageRegistry.test.js.)
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

const WAVE1 = [
  'game-flush', 'game-warmdown', 'game-pitstop', 'game-checklist', 'ai-sensitivity',
  'github-vault', 'ci-fix-loop', 'devlog-drafter', 'endpoint-board', 'dependency-radar', 'deploy-desk', 'dev-loop-repos',
  'repo-registry', 'search-bangs', 'copy-as-request', 'github-helpers', 'snippet-translator', 'selection-decoder', 'reference-sets',
  'dueness', 'first-open', 'inbox-unified', 'next-step', 'park-resume', 'copy-source', 'deadline-extractor',
  'panel-capture', 'vip-rules', 'needs-me', 'panel-state', 'away-mode', 'attention-digest', 'close-protect',
  'tab-mru', 'tab-search', 'nav-history-menu', 'strip-actions', 'night-coach', 'announce-desk',
];

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  delete window.__vexUsageQueue;
  globalThis.VexRegistry = fresh(JS + 'feature-registry.js').VexRegistry;
  globalThis.VexUsage = fresh(JS + 'vex-usage.js').VexUsage;
  fresh(JS + 'feature-manifests.js');
  globalThis.VexUsageRegistry = fresh(JS + 'vex-usage-registry.js').VexUsageRegistry;
});

describe('Wave 1 features and Minimal Vex', () => {
  it('every Wave 1 feature has exactly one manifest', () => {
    for (const id of WAVE1) expect(VexRegistry.has(id), id).toBe(true);
  });

  it('every Wave 1 feature that can be switched has a VexUsage row', () => {
    const rows = new Set(VexUsageRegistry.table().map(([id]) => id));
    for (const id of WAVE1) {
      if (VexRegistry.get(id).killSwitch === 'none') expect(rows.has(id), id + ' is always on, so it has no row').toBe(false);
      else expect(rows.has(id), id).toBe(true);
    }
  });

  it('the new game, dev-loop and daily-flow features arrive as new, not stable', () => {
    for (const id of ['game-flush', 'github-vault', 'ci-fix-loop', 'dueness', 'night-coach', 'announce-desk']) expect(VexRegistry.get(id).maturity, id).toBe('new');
  });
});
