import { describe, it, expect, vi, afterEach } from 'vitest';
import VexTools from '../../src/renderer/js/tools.js';

// The public fallback — also the URL baked into VexTools.defaultTools.
const PUBLIC_URL = 'https://0xmortuex.github.io/ai-news-tracker/';

afterEach(() => {
  delete globalThis.window;
  vi.restoreAllMocks();
});

describe('VexTools.applySidebarConfig — sidebar-config IPC fetch', () => {
  it('resolves the IPC config and points the AI News tool at the configured URL', async () => {
    const personalized = PUBLIC_URL + '#/guides?personalize=fadi-abc123';
    globalThis.window = {
      vex: { getSidebarConfig: async () => ({ aiNewsUrl: personalized }) },
    };
    VexTools.tools = [{ id: 'ainews', name: 'AI News', url: PUBLIC_URL }];

    const resolved = await VexTools.applySidebarConfig();

    expect(resolved).toBe(personalized);
    expect(VexTools.tools.find(t => t.id === 'ainews').url).toBe(personalized);
  });

  it('falls back to the public URL when the IPC call rejects', async () => {
    globalThis.window = {
      vex: { getSidebarConfig: async () => { throw new Error('ipc unavailable'); } },
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    VexTools.tools = [{ id: 'ainews', url: 'stale-url' }];

    const resolved = await VexTools.applySidebarConfig();

    expect(resolved).toBe(PUBLIC_URL);
    expect(VexTools.tools.find(t => t.id === 'ainews').url).toBe(PUBLIC_URL);
  });

  it('falls back to the public URL when no IPC bridge is present', async () => {
    globalThis.window = {}; // no .vex bridge
    VexTools.tools = [{ id: 'ainews', url: 'stale-url' }];

    const resolved = await VexTools.applySidebarConfig();

    expect(resolved).toBe(PUBLIC_URL);
    expect(VexTools.tools.find(t => t.id === 'ainews').url).toBe(PUBLIC_URL);
  });
});
