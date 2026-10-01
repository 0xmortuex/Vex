// @vitest-environment jsdom
//
// Settings › Extensions and the safe-mode banner (2026-09-29): the banner
// covered the very toggles it points to, and the uninstall question ran its
// two sentences together.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { SafeModeBanner } = require('../../src/renderer/js/safe-mode-banner.js');
require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/extension-catalog.js');

describe('the safe-mode banner keeps Settings clear of it', () => {
  beforeEach(() => { document.body.innerHTML = ''; document.body.className = ''; document.body.removeAttribute('style'); });

  it('reserves its height while it shows, and gives it back when dismissed', () => {
    SafeModeBanner.show({ asked: true, fails: 0 });
    expect(document.body.classList.contains('vex-safe-mode-banner-shown')).toBe(true);
    expect(document.body.style.getPropertyValue('--vex-smb-space')).toMatch(/^\d+px$/);
    document.querySelector('.safe-mode-banner [data-act="close"]').click();
    expect(document.querySelector('.safe-mode-banner')).toBeNull();
    expect(document.body.classList.contains('vex-safe-mode-banner-shown')).toBe(false);
    expect(document.body.style.getPropertyValue('--vex-smb-space')).toBe('');
  });

  it('the Settings scroll area pads by that space', () => {
    const css = fs.readFileSync(path.resolve('src/renderer/css/app.css'), 'utf8');
    const rule = css.slice(css.indexOf('body.vex-safe-mode-banner-shown #panel-settings .settings-content'));
    expect(rule).toMatch(/padding-bottom: calc\(var\(--vex-smb-space/);
    expect(rule).toMatch(/scroll-padding-bottom: var\(--vex-smb-space/);
  });
});

describe('Settings › Extensions', () => {
  function render(list, setEnabled) {
    window.escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    window.showToast = vi.fn();
    window.vex = { extensionsList: async () => list, extensionsSetEnabled: setEnabled, extensionsUninstall: async () => ({ ok: true }) };
    return window.showToast;
  }
  const ext = { folder: 'dark-reader-1', name: 'Dark Reader', version: '4.9', enabled: false, loaded: false, where: [], scope: 'auto', audit: null };

  it('the uninstall question has a space between its sentences', async () => {
    const src = fs.readFileSync(path.resolve('src/renderer/js/extensions-settings.js'), 'utf8');
    expect(src).toMatch(/Uninstall "\$\{btn\.dataset\.name \|\| folder\}"\? Restart Vex/);
  });

  it('switching one on in safe mode says it loads after a normal restart', async () => {
    const toast = render([ext], async () => ({ ok: true, enabled: true, afterRestart: true }));
    const { ExtensionsSettings } = require('../../src/renderer/js/extensions-settings.js');
    const host = document.createElement('div');
    document.body.appendChild(host);
    await ExtensionsSettings.render(host);
    const box = host.querySelector('[data-toggle="dark-reader-1"]');
    expect(box).toBeTruthy();
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 0));
    expect(toast).toHaveBeenCalledWith('Saved — it loads when Vex restarts normally', 'info');
  });
});
