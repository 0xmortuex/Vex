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

// Pressing a submenu's row took the focus off the page's <webview>: that
// element's blur reached the capture-phase listener and closed the whole menu
// ("Page" and "This site" vanished when clicked, found 2026-10-08).
describe('an element losing focus is not the window losing it', () => {
    it('keeps the menu when the page\'s webview loses focus to the menu', () => {
        openMenu();
        vi.advanceTimersByTime(500);
        const wv = document.createElement('webview');
        document.body.appendChild(wv);
        setActiveElement(document.body);
        wv.dispatchEvent(new FocusEvent('blur'));
        vi.advanceTimersByTime(500);
        expect(menuIsOpen()).toBe(true);
    });
});

// A menu opened near the left or top edge began off screen (found 2026-10-08).
describe('menus stay on screen', () => {
    it('is moved in from the left and top edges as well as the right and bottom', () => {
        const menu = document.createElement('div');
        document.body.appendChild(menu);
        menu.getBoundingClientRect = () => ({ left: -40, top: -10, right: 140, bottom: 300, width: 180, height: 310 });
        const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((fn) => { fn(); return 1; });
        TabManager._clampMenuToViewport(menu, -40, -10);
        expect([menu.style.left, menu.style.top]).toEqual(['8px', '8px']);
        raf.mockRestore();
    });
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
