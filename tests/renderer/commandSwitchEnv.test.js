// @vitest-environment jsdom
//
// Ctrl+K › Switch environment moves the tab you are on to the same path on
// another host. It called TabManager.navigateTo, which does not exist, so it
// always opened a new tab instead (found 2026-10-10).
import { afterEach, describe, expect, it, vi } from 'vitest';
const { CommandBar } = require('../../src/renderer/js/command.js');

afterEach(() => { vi.unstubAllGlobals(); });

describe('Switch environment', () => {
  it('moves the current tab instead of opening a new one', async () => {
    const createTab = vi.fn();
    const navigate = vi.fn();
    vi.stubGlobal('TabManager', { activeTabId: 't1', tabs: [{ id: 't1', url: 'https://example.com/a/b?c=1' }], createTab });
    vi.stubGlobal('WebviewManager', { navigate });
    vi.stubGlobal('DevSwitch', { options: async () => [{ label: 'Local', host: 'localhost:5173', url: 'http://localhost:5173/a/b?c=1' }] });
    vi.stubGlobal('vexPrompt', async () => '1');
    await CommandBar.commands.find(c => c.id === 'switchenv').action();
    expect(navigate).toHaveBeenCalledWith('http://localhost:5173/a/b?c=1');
    expect(createTab).not.toHaveBeenCalled();
  });
});
