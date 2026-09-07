// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
it('renders a bounded window and supports keyboard access to the final item', () => {
  const context = { window, document, ResizeObserver: undefined, requestAnimationFrame: cb => { cb(); return 1; }, cancelAnimationFrame: vi.fn() };
  vm.runInNewContext(fs.readFileSync('src/renderer/js/virtual-list.js','utf8'), context);
  const list = document.createElement('div'); document.body.append(list);
  window.VexVirtualList.mount(list, Array.from({ length: 10000 }, (_, i) => i), n => { const row = document.createElement('div'); row.textContent = String(n); return row; });
  expect(list.querySelectorAll('[data-virtual-index]').length).toBeLessThan(30);
  list.querySelector('[data-virtual-index]').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  expect(document.activeElement.dataset.virtualIndex).toBe('9999');
  list._virtualDispose(); expect(list._virtualDispose).toBeUndefined(); list.remove();
});
it('provides Turkish onboarding titles and a longer save-failure label', () => {
  vm.runInNewContext(fs.readFileSync('src/renderer/js/i18n.js','utf8'), { window, localStorage });
  localStorage.setItem('vex.lang','tr');
  expect(window.VexI18n.t('defaultbrowser')).toContain('varsayılan');
  expect(window.VexI18n.t('saveFailed').length).toBeGreaterThan(50);
  localStorage.removeItem('vex.lang');
});
