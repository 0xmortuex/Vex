// @vitest-environment jsdom
//
// Wave 3 integration (integration-6): every feature the Wave 3 branches and the version review added has
// exactly one manifest, and every manifest that is not marked always-on has a row in the VexUsage table, so
// Minimal Vex can turn it off and put it back. The runtime off/on round trip is in usageRegistry.test.js.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

const WAVE3 = [
  'ai-recipes', 'ai-spend-cap', 'announce-composer', 'archive-on-cite', 'autoscroll', 'chat-new-domain', 'chat-throwaway',
  'cheat-sheet', 'clipboard-tripwire', 'cloudflare-shortcuts', 'community-metrics', 'container-memory', 'content-board',
  'cookie-reject', 'deadline-ledger', 'defender-shortcut', 'diagnostics-bundle', 'discord-noise', 'discord-status',
  'download-desk', 'download-guard', 'draft-check', 'drops-desk', 'essentials', 'expense-capture', 'extension-diff',
  'feature-sheet', 'first-use-sheet', 'follow-ups', 'form-assist', 'game-timers', 'gesture-editor', 'guest-session',
  'holiday-planner', 'intent-search', 'jump-list', 'link-harvester', 'link-hints', 'load-failure', 'local-services',
  'marketplace-signs', 'media-control', 'meeting-links', 'mini-window', 'mod-kit', 'motw-check', 'mun-toolkit', 'net-courtesy',
  'page-reminders', 'panel-guard', 'paste-plain', 'patch-digest', 'pdf-highlights', 'pdf-tools', 'phone-share', 'photo-prep',
  'pinned-home', 'plan-preview', 'preconnect', 'progressive-disclosure', 'provenance-chip', 'push-bundle', 'qr-verdict',
  'reading-triage', 'repo-skim', 'revisit-watch', 'rituals', 'roblox-resolver', 'screen-share-safe', 'scroll-memory',
  'search-index', 'secure-lock', 'seen-before', 'service-check', 'slot-watcher', 'source-badge', 'sources', 'speech-timer',
  'spell-lang', 'split-keys', 'startup-budget', 'startup-check', 'storage-ledger', 'study-glossary', 'study-ledger',
  'study-notes', 'summary-cache', 'syllabus-check', 'tab-hold', 'tab-names', 'tab-select', 'tab-text-find', 'tab-thumbs',
  'tl-equivalent', 'tos-highlighter', 'travel-mode', 'turkish-helpers', 'two-minute', 'tz-helper', 'unread-task',
  'usage-counters', 'vault-hygiene', 'vencord-bridge', 'version-review', 'video-later', 'watch-judgement', 'webhook-inspector',
  'weekday-set', 'what-i-changed', 'whats-new-me', 'window-set', 'workspace-archive', 'writing-desk', 'your-data',
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

describe('Wave 3 features and Minimal Vex', () => {
  it('every Wave 3 feature has exactly one manifest', () => {
    for (const id of WAVE3) expect(VexRegistry.has(id), id).toBe(true);
    expect(new Set(WAVE3).size).toBe(WAVE3.length);
  });

  it('every Wave 3 feature that can be switched has a VexUsage row, and an always-on one has none', () => {
    const rows = new Set(VexUsageRegistry.table().map(([id]) => id));
    for (const id of WAVE3) {
      if (VexRegistry.get(id).killSwitch === 'none') expect(rows.has(id), id + ' is always on, so it has no row').toBe(false);
      else expect(rows.has(id), id).toBe(true);
    }
  });

  it('no VexUsage row names a feature that has no manifest', () => {
    const orphans = VexUsageRegistry.table().map(([id]) => id).filter((id) => !VexRegistry.has(id));
    expect(orphans).toEqual([]);
  });

  it('the version review is a Wave 3 feature with a switch of its own', () => {
    expect(VexRegistry.has('version-review')).toBe(true);
    const rows = new Set(VexUsageRegistry.table().map(([id]) => id));
    expect(rows.has('version-review')).toBe(true);
  });

  it('the Wave 3 features arrive as new, not stable', () => {
    const notNew = WAVE3.filter((id) => VexRegistry.get(id).maturity !== 'new' && VexRegistry.get(id).maturity !== 'beta');
    // A passive foundation may ship stable; a feature that acts on its own may not.
    for (const id of ['guest-session', 'local-services', 'webhook-inspector', 'travel-mode', 'tab-select', 'version-review']) expect(notNew, id).not.toContain(id);
  });
});
