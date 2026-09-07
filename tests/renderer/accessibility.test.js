// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
it('labels Turkish dialogs, traps focus, and restores it on Escape', async () => {
  vi.resetModules();
  localStorage.setItem('vex.lang', 'tr');
  document.body.innerHTML = '<button id="launcher">Open</button>';
  const launcher = document.getElementById('launcher'); launcher.focus();
  await import('../../src/renderer/js/i18n.js');
  await import('../../src/renderer/js/vex-dialog.js');
  const pending = window.vexPrompt({ title: 'Çalışma alanındaki değişiklikleri kaydetmek için yeni bir ad belirtin', value: 'Çalışma alanı' });
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog.querySelector('input').getAttribute('aria-label')).toContain('Çalışma alanı');
  expect(dialog.querySelector('[data-cancel]').textContent).toBe('İptal');
  dialog.querySelector('[data-ok]').focus();
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(dialog.querySelector('input'));
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(await pending).toBeNull(); expect(document.activeElement).toBe(launcher);
  localStorage.removeItem('vex.lang');
});
it('does not clear a failed tab save when an unrelated preference flush succeeds', async () => {
  vi.resetModules(); document.body.innerHTML = '';
  await import('../../src/renderer/js/service-status.js');
  window.dispatchEvent(new CustomEvent('vex-storage-status', { detail: { source: 'tabs', ok: false, message: 'Could not save tabs' } }));
  window.dispatchEvent(new CustomEvent('vex-storage-status', { detail: { source: 'preferences', ok: true } }));
  expect(document.querySelector('.vex-service-status').textContent).toContain('Could not save tabs');
  window.dispatchEvent(new CustomEvent('vex-storage-status', { detail: { source: 'tabs', ok: true } }));
  expect(document.querySelector('.vex-service-status')).toBeNull();
});
