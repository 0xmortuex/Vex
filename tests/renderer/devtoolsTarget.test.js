// @vitest-environment jsdom
//
// F12 / Ctrl+Shift+I resolved the active TAB's webview only. A sidebar panel is
// not a tab, and an open panel covers the content area - so pressing F12 while
// looking at the Discord or Spotify panel opened DevTools for whatever hidden
// tab happened to be active, or reported "No active tab" and did nothing you
// could see. The panel you are looking at wins.

import { describe, it, expect } from 'vitest';
import { resolveDevToolsTarget } from '../../src/renderer/js/sidebar.js';

const wv = tag => ({ tag, getWebContentsId: () => tag });

function tabs(activeId) {
    return { getActiveTab: () => (activeId == null ? null : { id: activeId }) };
}

describe('resolveDevToolsTarget', () => {
    it('prefers an open panel over the active tab', () => {
        const panelWv = wv('panel');
        const sidebar = { activePanel: 'discord', panelWebviews: { discord: panelWv } };
        const views = new Map([['t1', wv('tab')]]);

        const target = resolveDevToolsTarget(sidebar, tabs('t1'), views);

        expect(target.webview).toBe(panelWv);
        expect(target.source).toBe('panel');
    });

    it('falls back to the active tab when no panel is open', () => {
        const tabWv = wv('tab');
        const sidebar = { activePanel: null, panelWebviews: {} };
        const views = new Map([['t1', tabWv]]);

        const target = resolveDevToolsTarget(sidebar, tabs('t1'), views);

        expect(target.webview).toBe(tabWv);
        expect(target.source).toBe('tab');
    });

    it('falls back to the tab for a built-in panel that has no page of its own', () => {
        const tabWv = wv('tab');
        // Settings / History / Downloads render themselves - no webview.
        const sidebar = { activePanel: 'settings', panelWebviews: {} };
        const views = new Map([['t1', tabWv]]);

        expect(resolveDevToolsTarget(sidebar, tabs('t1'), views).source).toBe('tab');
    });

    it('returns null when there is nothing to inspect', () => {
        expect(resolveDevToolsTarget({ activePanel: null, panelWebviews: {} }, tabs(null), new Map())).toBeNull();
    });

    it('never throws on a half-built app state', () => {
        expect(() => resolveDevToolsTarget(null, null, null)).not.toThrow();
        expect(resolveDevToolsTarget(null, null, null)).toBeNull();
        expect(resolveDevToolsTarget(undefined, tabs('t1'), new Map())).toBeNull();
    });

    it('does not pick a tab whose webview is gone', () => {
        const sidebar = { activePanel: null, panelWebviews: {} };
        expect(resolveDevToolsTarget(sidebar, tabs('missing'), new Map())).toBeNull();
    });
});
