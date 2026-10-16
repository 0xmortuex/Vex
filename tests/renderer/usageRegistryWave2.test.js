// @vitest-environment jsdom
//
// Wave 2 integration: every feature the Wave 2 branches added has exactly one manifest, and every
// manifest that is not marked always-on has a row in the VexUsage table, so Minimal Vex can turn
// it off and put it back. (The runtime off/on round trip for modules loaded together is in
// usageRegistry.test.js.)
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

const WAVE2 = [
  'actions-board', 'ai-route-control', 'answer-citations', 'break-prompts', 'bug-bundle', 'bypass-doctor', 'carry-forward', 'chores',
  'close-day', 'code-library', 'course-spaces', 'credential-interlock', 'day-shape', 'dev-desk', 'dev-ports-pair', 'docs-pin',
  'draft-in-field', 'electron-ticker', 'embedding-manager', 'error-memory', 'exam-calendar', 'exam-planner', 'exam-safe-mode',
  'focus-calibration', 'form-rescue', 'game-library', 'game-loadouts', 'game-scenes', 'gcc-bridge', 'incident-playbooks',
  'intent-gate', 'link-routing', 'locale-translate', 'log-reader', 'log-tailer', 'longdoc-engine', 'mun-dossier', 'newsletter-lane',
  'orders-hub', 'paper-brief', 'paper-session', 'perm-hygiene', 'pkg-card', 'plugin-dev', 'receipt-locker', 'redact-tool', 'refind',
  'refresh-on-deploy', 'response-overrides', 'resurface', 'second-screen', 'secret-guard', 'selection-tools', 'signed-in',
  'site-audio-memory', 'site-instructions', 'snooze-syntax', 'storage-ceilings', 'study-block', 'tab-intent', 'table-extract',
  'tabs-nav', 'text-snippets', 'thread-digest', 'turkish-parse', 'video-tools', 'watch-alerts', 'week-skeleton', 'weekly-triage',
  'workspace-changes',
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

describe('Wave 2 features and Minimal Vex', () => {
  it('every Wave 2 feature has exactly one manifest', () => {
    for (const id of WAVE2) expect(VexRegistry.has(id), id).toBe(true);
  });

  it('every Wave 2 feature that can be switched has a VexUsage row', () => {
    const rows = new Set(VexUsageRegistry.table().map(([id]) => id));
    for (const id of WAVE2) {
      if (VexRegistry.get(id).killSwitch === 'none') expect(rows.has(id), id + ' is always on, so it has no row').toBe(false);
      else expect(rows.has(id), id).toBe(true);
    }
  });

  it('no manifest, old or new, lacks a switch unless it says it is always on', () => {
    const rows = new Set(VexUsageRegistry.table().map(([id]) => id));
    const missing = VexRegistry.all().filter((m) => m.killSwitch !== 'none' && !rows.has(m.id)).map((m) => m.id);
    expect(missing).toEqual([]);
  });

  it('the Wave 2 features arrive as new, not stable', () => {
    for (const id of ['study-block', 'exam-planner', 'thread-digest', 'chores', 'dev-desk', 'text-snippets']) expect(VexRegistry.get(id).maturity, id).toBe('new');
  });
});
