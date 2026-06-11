import { describe, it, expect, vi, afterEach } from 'vitest';
import VexTools from '../../src/renderer/js/tools.js';

// applySidebarConfig is the only place the LOCAL, gitignored sidebar-config.json
// can inject a personalized "AI News" tool URL. No personal URL ships in source:
// unconfigured (no bridge / reject / blank) returns '' and adds nothing.

afterEach(() => {
  delete globalThis.window;
  VexTools.tools = [];
  vi.restoreAllMocks();
});

describe('VexTools.applySidebarConfig — sidebar-config IPC fetch', () => {
  it('points an existing AI News tool at the configured URL', async () => {
    const configured = 'https://example.com/news/#/guides?personalize=abc123';
    globalThis.window = {
      vex: { getSidebarConfig: async () => ({ aiNewsUrl: configured }) },
    };
    VexTools.tools = [{ id: 'ainews', name: 'AI News', url: 'stale' }];

    const resolved = await VexTools.applySidebarConfig();

    expect(resolved).toBe(configured);
    expect(VexTools.tools.find(t => t.id === 'ainews').url).toBe(configured);
  });

  it('inserts an AI News tool when the URL is configured but none exists yet', async () => {
    const configured = 'https://example.com/news/';
    globalThis.window = {
      vex: { getSidebarConfig: async () => ({ aiNewsUrl: configured }) },
    };
    VexTools.tools = [];

    const resolved = await VexTools.applySidebarConfig();

    expect(resolved).toBe(configured);
    const ainews = VexTools.tools.find(t => t.id === 'ainews');
    expect(ainews).toBeTruthy();
    expect(ainews.url).toBe(configured);
  });

  it('returns "" and adds nothing when the IPC call rejects', async () => {
    globalThis.window = {
      vex: { getSidebarConfig: async () => { throw new Error('ipc unavailable'); } },
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    VexTools.tools = [];

    const resolved = await VexTools.applySidebarConfig();

    expect(resolved).toBe('');
    expect(VexTools.tools.find(t => t.id === 'ainews')).toBeUndefined();
  });

  it('returns "" and adds nothing when no IPC bridge is present', async () => {
    globalThis.window = {}; // no .vex bridge
    VexTools.tools = [];

    const resolved = await VexTools.applySidebarConfig();

    expect(resolved).toBe('');
    expect(VexTools.tools.find(t => t.id === 'ainews')).toBeUndefined();
  });

  it('returns "" when the configured URL is blank', async () => {
    globalThis.window = {
      vex: { getSidebarConfig: async () => ({ aiNewsUrl: '   ' }) },
    };
    VexTools.tools = [];

    const resolved = await VexTools.applySidebarConfig();

    expect(resolved).toBe('');
    expect(VexTools.tools.find(t => t.id === 'ainews')).toBeUndefined();
  });
});
