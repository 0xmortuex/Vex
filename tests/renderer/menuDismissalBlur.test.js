// @vitest-environment jsdom
//
// A context menu opened over a panel used to vanish before the user could click
// an item: the panel's <webview> guest (Discord refocuses its composer, Netflix
// its player) takes focus on its own schedule, which blurs the HOST window
// exactly like an app switch, and the blur handler dismissed the menu. The click
// then landed on nothing and the action never ran - reported as "right-click
// Refresh does nothing", "Switch to ... does nothing" and "Install my Vencord
// build does nothing".
//
// Blur must dismiss only when focus really left the app, not when it moved into
// one of our own guests.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TabManager } from '../../src/renderer/js/tabs.js';

// The handler reads document.activeElement one tick after the blur (focus moving
// host -> guest fires blur BEFORE activeElement updates), so tests must control
// it and then let that timer run.
function setActiveElement(el) {
    Object.defineProperty(document, 'activeElement', { value: el, configurable: true });
}

function openMenu() {
    const menu = document.createElement('div');
    menu.className = 'tab-context-menu';
    document.body.appendChild(menu);
    TabManager._attachMenuDismissal(menu);
    return menu;
}

const menuIsOpen = () => !!document.querySelector('.tab-context-menu');
const overlayExists = () => !!document.querySelector('.context-menu-overlay');

beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('context menu dismissal on window blur', () => {
    it('keeps the menu when a guest webview takes focus', () => {
        const menu = openMenu();
        vi.advanceTimersByTime(500); // past the early-churn grace

        setActiveElement(document.createElement('webview'));
        window.dispatchEvent(new Event('blur'));
        vi.advanceTimersByTime(500);

        expect(menuIsOpen()).toBe(true);
    });

    it('still dismisses when focus really left the app', () => {
        const menu = openMenu();
        vi.advanceTimersByTime(500);

        setActiveElement(document.createElement('input'));
        window.dispatchEvent(new Event('blur'));
        vi.advanceTimersByTime(500);

        expect(menuIsOpen()).toBe(false);
        expect(overlayExists()).toBe(false);
    });

    it('ignores blur entirely during the grace period right after opening', () => {
        openMenu();
        setActiveElement(document.createElement('input'));

        vi.advanceTimersByTime(100); // still inside the 400ms grace
        window.dispatchEvent(new Event('blur'));
        vi.advanceTimersByTime(500);

        expect(menuIsOpen()).toBe(true);
    });

    it('a guest-focus blur does not leave the menu half-torn-down', () => {
        openMenu();
        vi.advanceTimersByTime(500);

        setActiveElement(document.createElement('webview'));
        window.dispatchEvent(new Event('blur'));
        vi.advanceTimersByTime(500);

        // Both halves must still be present, or the next outside click is eaten.
        expect(menuIsOpen()).toBe(true);
        expect(overlayExists()).toBe(true);
    });
});
