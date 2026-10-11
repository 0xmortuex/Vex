// @vitest-environment jsdom
//
// Settings and its screens, used from the keyboard and a screen reader:
//  - every control in Settings has an accessible name (11 had none, found
//    2026-10-10: the search engine, the ad blocker, the email-code switches,
//    the look and tab-layout menus, the reading font, colour filter, ruler);
//  - a switch shows a ring when it has keyboard focus (its checkbox is 0x0);
//  - every [aria-modal] screen keeps Tab inside itself (What's new, Backup and
//    Import let it walk out to the toolbar behind them).

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const R = path.resolve(__dirname, '../../src/renderer');

function accessibleName(el) {
  const label = el.getAttribute('aria-label');
  if (label && label.trim()) return label.trim();
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const t = by.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
    if (t) return t;
  }
  if (el.id) {
    const f = document.querySelector(`label[for="${el.id.replace(/"/g, "")}"]`);
    if (f && f.textContent.trim()) return f.textContent.trim();
  }
  const wrap = el.closest('label');
  if (wrap) {
    const copy = wrap.cloneNode(true);
    copy.querySelectorAll('input,select,textarea').forEach(n => n.remove());
    if (copy.textContent.trim()) return copy.textContent.trim();
  }
  if (el.tagName === 'BUTTON' && el.textContent.trim()) return el.textContent.trim();
  if (el.tagName === 'INPUT' && /^(button|submit|reset)$/.test(el.type) && el.value) return el.value;
  if (el.getAttribute('title')) return el.getAttribute('title');
  if (el.getAttribute('placeholder')) return el.getAttribute('placeholder');
  return '';
}

describe('Settings controls have names', () => {
  beforeAll(() => {
    const html = readFileSync(path.join(R, 'index.html'), 'utf8');
    document.body.innerHTML = html.slice(html.indexOf('<body'), html.lastIndexOf('</body>')).replace(/^<body[^>]*>/, '');
    globalThis.VexIcons = { svg: () => '' };
    const { AccessibilityPack } = require('../../src/renderer/js/accessibility.js');
    AccessibilityPack.cfg = AccessibilityPack.cfg || {};
    AccessibilityPack.renderPanel(document.getElementById('a11y-panel-content'));
  });

  it('every input, select, textarea and button in #panel-settings has an accessible name', () => {
    const panel = document.getElementById('panel-settings');
    const controls = [...panel.querySelectorAll('input:not([type=hidden]), select, textarea, button')];
    expect(controls.length).toBeGreaterThan(80);
    const unnamed = controls.filter(c => !accessibleName(c)).map(c => c.id || c.outerHTML.slice(0, 80));
    expect(unnamed).toEqual([]);
  });

  it('a switch draws a focus ring on its track (a11y.css, which stays last)', () => {
    const css = readFileSync(path.join(R, 'css/a11y.css'), 'utf8');
    expect(css).toMatch(/\.toggle input:focus-visible \+ \.toggle-slider\s*\{[^}]*outline:\s*2px solid/);
    const html = readFileSync(path.join(R, 'index.html'), 'utf8');
    const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]);
    expect(sheets[sheets.length - 1]).toBe('css/a11y.css');
  });
});

describe('every aria-modal screen keeps Tab inside', () => {
  const tab = (shift = false) => {
    const target = document.activeElement || document.body;
    const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    return e.defaultPrevented;
  };
  const expectTrapped = (root) => {
    const items = window.VexFocusTrap.focusables(root);
    expect(items.length).toBeGreaterThan(1);
    items[items.length - 1].focus();
    expect(tab()).toBe(true);
    expect(document.activeElement).toBe(items[0]);
    expect(tab(true)).toBe(true);
    expect(document.activeElement).toBe(items[items.length - 1]);
    // Focus behind the screen comes back in on the next Tab.
    document.getElementById('behind').focus();
    tab();
    expect(root.contains(document.activeElement)).toBe(true);
  };

  beforeAll(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    globalThis.VexIcons = { svg: () => '' };
    window.VexIcons = globalThis.VexIcons;
    window.vex = {
      getReleaseNotes: vi.fn(async () => ({ version: '1.0.0', name: 'v1.0.0', body: '- one' })),
      getReleaseList: vi.fn(async () => [{ version: '1.0.0', name: 'v1.0.0', body: '- one' }, { version: '0.9.0', name: 'v0.9.0', body: '- zero' }]),
      browserImport: { list: vi.fn(async () => ({ ok: true, browsers: [] })) },
    };
    require('../../src/renderer/js/vex-dialog.js');
  });

  const reset = () => {
    document.querySelectorAll('body > *').forEach(n => n.remove());
    const b = document.createElement('button');
    b.id = 'behind'; b.textContent = 'Behind';
    document.body.appendChild(b);
  };

  it('any [aria-modal="true"] overlay, including one added later', () => {
    reset();
    const ov = document.createElement('div');
    ov.innerHTML = '<div role="dialog" aria-modal="true"><button>One</button><input aria-label="x"><a href="#">Link</a></div>';
    document.body.appendChild(ov);
    expectTrapped(ov.firstElementChild);
  });

  it('a hidden aria-modal (the closed command bar) traps nothing', () => {
    reset();
    const ov = document.createElement('div');
    ov.hidden = true;
    ov.innerHTML = '<div role="dialog" aria-modal="true"><button>One</button><button>Two</button></div>';
    document.body.appendChild(ov);
    document.getElementById('behind').focus();
    expect(tab()).toBe(false);
  });

  it('Backup is announced as a dialog, names its file box, and traps Tab', () => {
    reset();
    const { VexBackup } = require('../../src/renderer/js/backup.js');
    const m = VexBackup.open();
    const d = m.querySelector('[role=dialog]');
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(d.getAttribute('aria-labelledby')).textContent).toMatch(/Back up/);
    expect(m.querySelector('#bk-file').getAttribute('aria-label')).toBeTruthy();
    expectTrapped(d);
  });

  it('Import traps Tab', async () => {
    reset();
    const { BrowserImport } = require('../../src/renderer/js/browser-import.js');
    await BrowserImport.open();
    const d = document.querySelector('#vex-browser-import [role=dialog]');
    expect(d.getAttribute('aria-modal')).toBe('true');
    expectTrapped(d);
  });

  it("What's new traps Tab", async () => {
    reset();
    require('../../src/renderer/js/update-log.js');
    await window.VexWhatsNew.open();
    const d = document.querySelector('.whatsnew-ov [role=dialog]');
    expect(d.getAttribute('aria-modal')).toBe('true');
    expectTrapped(d);
  });
});
