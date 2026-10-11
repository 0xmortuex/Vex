// @vitest-environment jsdom
//
// The shortcuts bar's Add/Edit shortcut box was a plain div: no dialog role
// or name, Escape did nothing, labels were not tied to their fields, and Tab
// walked out of it into the window behind (cat-themes TH10).
import { describe, it, expect, vi, beforeAll } from 'vitest';

let VGS;
beforeAll(async () => {
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = '<div id="top-tab-bar"></div><div id="top-bar"><div id="top-bar-right"></div></div><div id="main-layout"></div>';
  window.showToast = vi.fn();
  await import('../../src/renderer/js/gui-style.js');
  VGS = window.VexGuiStyle;
  VGS.set('glass');
});

const key = (el, k, opts = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));

function openEditor() {
  const add = document.querySelector('#gui-shortcuts-bar .gsc-add');
  expect(add).not.toBeNull();
  add.focus();
  add.click();
  const ov = document.querySelector('.gsc-ed-ov');
  expect(ov).not.toBeNull();
  return { add, ov };
}

describe('the shortcut editor is a dialog', () => {
  it('is named, modal, and its labels belong to their fields', () => {
    const { ov } = openEditor();
    const box = ov.querySelector('.gsc-ed');
    expect(box.getAttribute('role')).toBe('dialog');
    expect(box.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(box.getAttribute('aria-labelledby')).textContent).toBe('Add shortcut');
    for (const l of ov.querySelectorAll('label')) expect(ov.querySelector('#' + l.htmlFor), l.textContent).not.toBeNull();
    ov.remove();
  });

  it('Escape closes it and gives focus back', () => {
    const { add, ov } = openEditor();
    ov.querySelector('.gsc-ed-name').focus();
    key(ov.querySelector('.gsc-ed-name'), 'Escape');
    expect(document.querySelector('.gsc-ed-ov')).toBeNull();
    expect(document.activeElement).toBe(add);
  });

  it('Tab stays inside it', () => {
    const { ov } = openEditor();
    const save = ov.querySelector('.gsc-ed-save');
    save.focus();
    key(save, 'Tab');
    expect(document.activeElement).toBe(ov.querySelector('.gsc-ed-name'));
    key(ov.querySelector('.gsc-ed-name'), 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(save);
    ov.remove();
  });

  it('Enter in a field saves it', () => {
    const { ov } = openEditor();
    ov.querySelector('.gsc-ed-name').value = 'Example';
    ov.querySelector('.gsc-ed-url').value = 'example.com';
    key(ov.querySelector('.gsc-ed-url'), 'Enter');
    expect(document.querySelector('.gsc-ed-ov')).toBeNull();
    expect(JSON.stringify(localStorage)).toMatch(/example\.com/);
  });

  it('the bar\'s chips are reached from the keyboard: Enter on Add opens the editor', () => {
    const add = document.querySelector('#gui-shortcuts-bar .gsc-add');
    expect(add.getAttribute('role')).toBe('button');
    expect(add.tabIndex).toBe(0);
    for (const c of document.querySelectorAll('#gui-shortcuts-bar .gsc')) expect(c.tabIndex).toBe(0);
    key(add, 'Enter');
    expect(document.querySelector('.gsc-ed-ov')).not.toBeNull();
    document.querySelector('.gsc-ed-ov').remove();
    const first = document.querySelector('#gui-shortcuts-bar .gsc:not(.gsc-add)');
    key(first, 'F10', { shiftKey: true });
    expect(document.querySelector('.gsc-ed-title').textContent).toBe('Edit shortcut');
    document.querySelector('.gsc-ed-ov').remove();
  });

  it('Save takes the theme\'s text-on-accent colour and Delete the theme\'s danger colour', () => {
    const css = document.getElementById('gsc-editor-styles').textContent;
    expect(css).toMatch(/\.gsc-ed-save\{[^}]*color:var\(--on-primary,#fff\)/);
    expect(css).toMatch(/\.gsc-ed-del\{color:var\(--danger,/);
  });
});
