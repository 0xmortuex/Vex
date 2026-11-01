// @vitest-environment jsdom
//
// The "Failed to fetch  [Retry]" box (js/service-status.js) that stayed on screen for ever when the sync server could
// not be reached: it said the raw browser error in English, and it could not be closed. A sync problem can now be
// closed (and stays closed until its message changes); a storage problem (data not saved) can never be closed.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

// The module listens on window for as long as it lives: load it once and reset it with the real "recovered" events.
async function load() {
  window.vexTr = (s) => ({ 'Failed to fetch': 'Sunucuya ulaşılamadı', 'Dismiss': 'Kapat' }[s] || s);
  globalThis.VexIcons = { svg: () => '<svg></svg>' };
  await import('../../src/renderer/js/service-status.js');
}
const box = () => document.querySelector('.vex-service-status');
const sync = (error) => window.dispatchEvent(new CustomEvent('vex-sync-status', { detail: { error } }));
const storage = (ok, message) => window.dispatchEvent(new CustomEvent('vex-storage-status', { detail: { ok, message, source: 'tabs' } }));

describe('the status box', () => {
  beforeAll(load);
  beforeEach(() => { sync(null); storage(true); document.body.innerHTML = ''; });

  it('says a sync failure in the person\'s language, not the raw browser error', () => {
    sync('Failed to fetch');
    expect(box().textContent).toContain('Sunucuya ulaşılamadı');
    expect(box().textContent).not.toContain('Failed to fetch');
  });

  it('lets a sync failure be closed, and keeps it closed while the message is the same', () => {
    sync('Failed to fetch');
    const close = box().querySelector('.vex-service-status-close');
    expect(close).toBeTruthy();
    expect(close.getAttribute('aria-label')).toBe('Kapat');
    close.click();
    expect(box()).toBeNull();
    sync('Failed to fetch');                       // the same error again: stays closed
    expect(box()).toBeNull();
    sync('A different problem');                   // a new message: comes back
    expect(box()).not.toBeNull();
  });

  it('clears the closed state when sync works again, so the next failure shows', () => {
    sync('Failed to fetch');
    box().querySelector('.vex-service-status-close').click();
    sync(null);                                    // sync recovered
    sync('Failed to fetch');
    expect(box()).not.toBeNull();
  });

  it('never offers to close a storage failure: data was not saved', () => {
    storage(false, 'Could not save tabs');
    expect(box().textContent).toContain('Could not save tabs');
    expect(box().querySelector('.vex-service-status-close')).toBeNull();
    storage(true);
    expect(box()).toBeNull();
  });
});
