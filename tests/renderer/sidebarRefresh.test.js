import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRefreshAction } from '../../src/renderer/js/sidebar.js';

// makeRefreshAction(manager, panelName) is the hoisted refresh-action factory.
// It must:
//   - Reload the existing panel webview when one is mounted, AND ensure the
//     panel is visible first so the reload isn't silent from the user's POV.
//   - Fall back to opening the panel (first-open == first-refresh) when no
//     webview exists yet.
//   - Never throw, no matter what the manager looks like.

function fakeWebview() {
  return { reload: vi.fn() };
}

function fakeManager(over = {}) {
  return {
    activePanel: null,
    panelWebviews: {},
    showPanel: vi.fn(),
    openPanel: vi.fn(),
    ...over,
  };
}

describe('makeRefreshAction', () => {
  describe('webview exists', () => {
    it('reloads the webview and shows the panel if it was not the active panel', () => {
      const wv = fakeWebview();
      const m = fakeManager({
        activePanel: 'whatsapp',
        panelWebviews: { claude: wv },
      });

      makeRefreshAction(m, 'claude')();

      expect(m.showPanel).toHaveBeenCalledWith('claude');
      expect(wv.reload).toHaveBeenCalledTimes(1);
    });

    it('reloads but does NOT call showPanel if the panel is already active', () => {
      const wv = fakeWebview();
      const m = fakeManager({
        activePanel: 'claude',
        panelWebviews: { claude: wv },
      });

      makeRefreshAction(m, 'claude')();

      expect(m.showPanel).not.toHaveBeenCalled();
      expect(wv.reload).toHaveBeenCalledTimes(1);
    });

    it('swallows reload errors without throwing (panel switch first)', () => {
      const wv = { reload: vi.fn(() => { throw new Error('boom'); }) };
      const m = fakeManager({ panelWebviews: { spotify: wv } });

      expect(() => makeRefreshAction(m, 'spotify')()).not.toThrow();
      expect(wv.reload).toHaveBeenCalled();
    });
  });

  describe('webview does not exist', () => {
    it('opens the panel via openPanel (preferred)', () => {
      const m = fakeManager(); // panelWebviews empty
      makeRefreshAction(m, 'claude')();
      expect(m.openPanel).toHaveBeenCalledWith('claude');
      expect(m.showPanel).not.toHaveBeenCalled();
    });

    it('falls back to showPanel when openPanel is not provided', () => {
      const m = fakeManager({ openPanel: undefined });
      makeRefreshAction(m, 'claude')();
      expect(m.showPanel).toHaveBeenCalledWith('claude');
    });

    it('panelWebviews entirely missing → still falls back, no throw', () => {
      const m = { showPanel: vi.fn(), openPanel: vi.fn() };
      expect(() => makeRefreshAction(m, 'claude')()).not.toThrow();
      expect(m.openPanel).toHaveBeenCalledWith('claude');
    });
  });

  describe('returned function is reusable', () => {
    it('captures panelName at factory time', () => {
      const claudeWv = fakeWebview();
      const spotifyWv = fakeWebview();
      const m = fakeManager({
        activePanel: 'claude',
        panelWebviews: { claude: claudeWv, spotify: spotifyWv },
      });

      const refreshClaude = makeRefreshAction(m, 'claude');
      const refreshSpotify = makeRefreshAction(m, 'spotify');

      refreshClaude();
      refreshSpotify();

      expect(claudeWv.reload).toHaveBeenCalledTimes(1);
      expect(spotifyWv.reload).toHaveBeenCalledTimes(1);
      expect(m.showPanel).toHaveBeenCalledWith('spotify'); // wasn't active
      expect(m.showPanel).not.toHaveBeenCalledWith('claude'); // was active
    });

    it('multiple invocations of the same action keep working', () => {
      const wv = fakeWebview();
      const m = fakeManager({
        activePanel: 'claude',
        panelWebviews: { claude: wv },
      });
      const refresh = makeRefreshAction(m, 'claude');
      refresh(); refresh(); refresh();
      expect(wv.reload).toHaveBeenCalledTimes(3);
    });
  });
});
