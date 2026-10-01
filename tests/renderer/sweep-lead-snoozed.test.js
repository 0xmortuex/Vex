// @vitest-environment jsdom
//
// Snoozed tabs could not be seen or woken early: nothing listed them
// (found 2026-09-29). The Library panel lists them; a row wakes one now.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../../src/renderer/js/collection-store.js';
import '../../src/renderer/js/vex-utils.js';

beforeEach(() => {
  localStorage.clear();
  globalThis.VexIcons = { svg: () => '<svg></svg>' };
  globalThis.SidebarManager = { hideActivePanel: vi.fn() };
  window.showToast = vi.fn();
});

describe('Snoozed tabs in the Library', () => {
  it('are listed, a row wakes one, and remove forgets it', async () => {
    const { ReadLater } = await import('../../src/renderer/js/readlater.js');
    const later = Date.now() + 3 * 86400000;
    const list = [{ id: 'sn1', url: 'https://a.test/', title: 'A page', at: later, snoozedAt: Date.now() - 60000 },
                  { id: 'sn2', url: 'https://b.test/', title: 'B page', at: later + 1000, snoozedAt: Date.now() - 60000 }];
    globalThis.TabSnooze = {
      list: () => list.slice(),
      wake: vi.fn((id) => { list.splice(list.findIndex(e => e.id === id), 1); }),
      forget: vi.fn((id) => { list.splice(list.findIndex(e => e.id === id), 1); }),
    };
    ReadLater.init();
    const box = document.createElement('div');
    ReadLater.renderPanel(box);
    expect(box.textContent).toContain('Snoozed tabs');
    expect(box.textContent).toMatch(/A page — back /);
    const rows = [...box.querySelectorAll('[data-x]')].map(b => b.parentElement);
    const aRow = rows.find(r => /A page/.test(r.textContent));
    aRow.click();
    expect(TabSnooze.wake).toHaveBeenCalledWith('sn1');
    ReadLater.renderPanel(box);
    const bRow = [...box.querySelectorAll('[data-x]')].map(b => b.parentElement).find(r => /B page/.test(r.textContent));
    bRow.querySelector('[data-x]').click();
    expect(TabSnooze.forget).toHaveBeenCalledWith('sn2');
    expect(box.textContent).not.toContain('Snoozed tabs');
  });
});
