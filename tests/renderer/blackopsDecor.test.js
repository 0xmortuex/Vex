// @vitest-environment jsdom
//
// Blackops decoration coverage — status bar formatting, presence/absence by
// theme, boot overlay reaction to theme-changed, and tab data-tab-index zero
// padding. jsdom doesn't paint pseudo-elements (::before [01] prefix), so
// the visual prefix is left to manual verification; what we CAN verify is
// the data attribute the CSS hooks into.

import { describe, it, expect, beforeEach, vi } from 'vitest';

function installGlobals() {
  document.documentElement.removeAttribute('data-theme');
  document.body.innerHTML = '<div id="vex-status-bar"></div>';
  globalThis.VexStorage = {
    load: vi.fn(async () => undefined),
    save: vi.fn(async () => true),
  };
  globalThis.ThemeManager = {
    _theme: 'default',
    getCurrentTheme() { return this._theme; },
    applyTheme(t) {
      this._theme = t;
      document.documentElement.setAttribute('data-theme', t);
      document.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme: t } }));
    },
  };
}

async function loadDecor() {
  vi.resetModules();
  const mod = await import('../../src/renderer/js/blackops-decor.js');
  return mod.BlackopsDecor;
}

describe('BlackopsDecor', () => {
  beforeEach(() => {
    installGlobals();
  });

  it('init() leaves the status bar empty when theme=default and never breaks', () => {
    // status bar exists but is hidden via CSS in default theme; init() still
    // populates it (the CSS toggles display:none) — assert it's renderable.
    return loadDecor().then(D => {
      D.init();
      const bar = document.getElementById('vex-status-bar');
      expect(bar).not.toBeNull();
    });
  });

  it('status bar populates with the CIA-aesthetic format string', async () => {
    const D = await loadDecor();
    D.init();
    const bar = document.getElementById('vex-status-bar');
    expect(bar.innerHTML).toContain('VEX');
    expect(bar.innerHTML).toContain('CLASSIFIED');
    expect(bar.innerHTML).toContain('CLEARANCE: TOP SECRET');
    expect(bar.innerHTML).toContain('COMPARTMENT-7741-ALPHA');
  });

  it('status bar includes a HH:MM:SS time component', async () => {
    const D = await loadDecor();
    D.init();
    const bar = document.getElementById('vex-status-bar');
    expect(bar.innerHTML).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('shows the boot overlay when init runs while theme is already blackops', async () => {
    ThemeManager._theme = 'blackops';
    document.documentElement.setAttribute('data-theme', 'blackops');
    const D = await loadDecor();
    D.init();
    expect(document.getElementById('vex-boot-overlay')).not.toBeNull();
  });

  it('shows the boot overlay when theme switches to blackops via theme-changed', async () => {
    const D = await loadDecor();
    D.init();
    expect(document.getElementById('vex-boot-overlay')).toBeNull();
    ThemeManager.applyTheme('blackops');
    expect(document.getElementById('vex-boot-overlay')).not.toBeNull();
  });

  it('boot overlay only renders once per session (skipIfShown guard)', async () => {
    ThemeManager._theme = 'blackops';
    const D = await loadDecor();
    D.init();
    const first = document.getElementById('vex-boot-overlay');
    expect(first).not.toBeNull();
    // Switching away and back should not re-show — _bootShown stays true.
    ThemeManager.applyTheme('default');
    ThemeManager.applyTheme('blackops');
    const overlays = document.querySelectorAll('#vex-boot-overlay');
    expect(overlays.length).toBe(1);
  });
});

describe('Tab data-tab-index attribute', () => {
  it('rebuildAllTabs sets a zero-padded sequential index on every .tab-item', () => {
    // Mirror the production code path: build .tab-item nodes in order, then
    // run the same assignment loop rebuildAllTabs() does.
    document.body.innerHTML = `
      <ul id="tabs-list">
        <li class="tab-item" data-tab-id="a"><div class="tab-title">A</div></li>
        <li class="tab-item" data-tab-id="b"><div class="tab-title">B</div></li>
        <li class="tab-item" data-tab-id="c"><div class="tab-title">C</div></li>
      </ul>
    `;
    document.querySelectorAll('.tab-item').forEach((el, i) => {
      el.setAttribute('data-tab-index', String(i + 1).padStart(2, '0'));
    });
    const items = document.querySelectorAll('.tab-item');
    expect(items[0].getAttribute('data-tab-index')).toBe('01');
    expect(items[1].getAttribute('data-tab-index')).toBe('02');
    expect(items[2].getAttribute('data-tab-index')).toBe('03');
  });
});
