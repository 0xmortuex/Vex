// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

const HOSTILE = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';

function api(over = {}) {
  return {
    list: vi.fn(async () => ({
      globalEnabled: true,
      packs: [{
        id: 'evil-pack', name: HOSTILE, author: HOSTILE, description: HOSTILE, enabled: true, trust: 'unknown-key', fingerprint: 'aaaa-bbbb',
        installedAt: 1, source: '', hash: 'x', items: [{ type: 'theme', id: 't1', name: HOSTILE }, { type: 'quotes', id: 'q1', name: HOSTILE }],
        permissions: [{ id: 'runs:commands', text: HOSTILE }],
      }],
      damaged: [{ file: HOSTILE, error: HOSTILE }], trusted: [{ fingerprint: 'cccc', label: HOSTILE, addedAt: 0 }], authorKey: null,
      log: [{ at: 0, event: 'install', packId: 'evil-pack', detail: HOSTILE }],
    })),
    items: vi.fn(async () => [{ packId: 'evil-pack', packName: HOSTILE, trust: 'unknown-key', item: { type: 'chain', id: 'c1', name: HOSTILE, steps: ['reading-mode'] } }]),
    ...over,
  };
}

describe('the packs manager', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete window.__pwned;
    window.vex = { packs: api() };
    window.vexConfirm = vi.fn(async () => true);
    window.vexAlert = vi.fn(async () => {});
    globalThis.vexConfirm = window.vexConfirm;
    globalThis.vexAlert = window.vexAlert;
  });

  it('draws every pack string as text, never as markup', async () => {
    await import('../../src/renderer/js/packs-ui.js');
    await window.VexPacks.open();
    const modal = document.querySelector('.vex-packs-overlay');
    expect(modal).toBeTruthy();
    expect(modal.querySelector('img[src="x"]')).toBeNull();
    expect(modal.querySelector('script')).toBeNull();
    expect(modal.textContent).toContain('<img src=x');
    expect(window.__pwned).toBeUndefined();
  });

  it('the plain-language confirm lists every item and every permission for an unsigned pack', async () => {
    await import('../../src/renderer/js/packs-ui.js');
    const text = window.VexPacks._confirmText({
      name: 'P', author: 'A', description: '', trust: 'unsigned', fingerprint: '', replaces: null,
      items: [{ label: 'Theme', line: 'Colour theme "N"' }, { label: 'Command chain', line: 'Command chain "C" runs: a, then b' }],
      permissions: [{ id: 'runs:commands', text: 'Run Vex commands one after another.' }],
    });
    expect(text).toContain('NOT SIGNED');
    expect(text).toContain('Colour theme "N"');
    expect(text).toContain('Command chain "C" runs: a, then b');
    expect(text).toContain('Run Vex commands one after another.');
    expect(text).toContain('cannot run code');
  });

  it('a trusted pack gets the short confirm', async () => {
    await import('../../src/renderer/js/packs-ui.js');
    const text = window.VexPacks._confirmText({
      name: 'P', author: 'A', description: 'long', trust: 'trusted', fingerprint: 'aaaa', replaces: null,
      items: [{ label: 'Theme', line: 'x' }, { label: 'Theme', line: 'y' }], permissions: [],
    });
    expect(text).toContain('2 x Theme');
    expect(text).not.toContain('NOT SIGNED');
    expect(text.split('\n').length).toBeLessThan(6);
  });

  it('declining the confirm discards the staged pack and installs nothing', async () => {
    await import('../../src/renderer/js/packs-ui.js');
    const install = vi.fn(), discard = vi.fn(async () => true);
    window.vex.packs = api({ install, discard });
    window.vexConfirm = vi.fn(async () => false);
    globalThis.vexConfirm = window.vexConfirm;
    const ok = await window.VexPacks._review({ token: '0'.repeat(32), name: 'P', author: 'A', description: '', trust: 'unsigned', fingerprint: '', replaces: null, items: [], permissions: [] });
    expect(ok).toBe(false);
    expect(install).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledWith('0'.repeat(32));
  });

  it('is unavailable in a private window', async () => {
    await import('../../src/renderer/js/packs-ui.js');
    window.VexTabPolicy = { isPrivateWindow: true };
    await window.VexPacks.open();
    expect(document.querySelector('.vex-packs-overlay')).toBeNull();
    expect(window.vexAlert).toHaveBeenCalled();
    delete window.VexTabPolicy;
  });
});
