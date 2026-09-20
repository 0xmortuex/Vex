// The page in both languages at once. The things that must hold: a
// translation is never translated again, a paragraph that came back unchanged
// or empty is not printed twice, and turning it off leaves the page as it was.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { TranslateSide } = require('../../src/renderer/js/translate-side.js');

beforeEach(() => {
  globalThis.localStorage = { getItem: () => 'fr', setItem: () => {} };
  globalThis.window = { vex: { translateText: vi.fn(async (t) => 'FR:' + t) }, vexGuestEval: vi.fn(async () => []), showToast: vi.fn() };
});

describe('the scripts that run in the page', () => {
  it('are valid JavaScript', () => {
    expect(() => new Function(TranslateSide.readScript())).not.toThrow();
    expect(() => new Function(TranslateSide.applyScript([[0, 'bonjour']]))).not.toThrow();
    expect(() => new Function(TranslateSide.clearScript())).not.toThrow();
  });

  it('never read a translation Vex itself added', () => {
    expect(TranslateSide.readScript()).toContain("closest('[data-vex-tr-out]')");
  });

  it('put the translated text in as text, not as markup', () => {
    const script = TranslateSide.applyScript([[0, '<img src=x onerror=alert(1)>']]);
    expect(script).toContain('out.textContent = text');
    expect(script).not.toContain('innerHTML');
  });

  it('take everything back off again', () => {
    const clear = TranslateSide.clearScript();
    for (const part of ['data-vex-tr-out', 'data-vex-tr', 'vex-tr-style']) expect(clear).toContain(part);
  });
});

describe('translating a page full of paragraphs', () => {
  it('goes in batches, and each batch is shown as it arrives', async () => {
    const texts = Array.from({ length: 10 }, (_, i) => 'paragraph ' + i);
    const batches = [];
    const pairs = await TranslateSide.translateAll(texts, 'fr', async (p) => { batches.push(p.length); });
    expect(pairs).toHaveLength(10);
    expect(pairs[0]).toEqual([0, 'FR:paragraph 0']);
    expect(batches.length).toBe(Math.ceil(10 / TranslateSide.AT_ONCE));
  });

  it('a paragraph that came back the same, empty, or failed is left alone', async () => {
    window.vex.translateText = vi.fn(async (t) => {
      if (t === 'same') return 'same';
      if (t === 'boom') throw new Error('offline');
      if (t === 'none') return null;
      return 'FR:' + t;
    });
    const pairs = await TranslateSide.translateAll(['same', 'boom', 'none', 'real'], 'fr');
    expect(pairs).toEqual([[3, 'FR:real']]);
  });

  it('asks in the language that was last picked', () => {
    expect(TranslateSide.lang()).toBe('fr');
  });
});

describe('running it on a tab', () => {
  const tab = () => {
    globalThis.WebviewManager = { getActiveWebview: () => ({ getURL: () => 'https://example.com/a' }) };
  };

  it('says so plainly when there is nothing to translate', async () => {
    tab();
    window.vexGuestEval.mockResolvedValue([]);
    await expect(TranslateSide.run('fr')).rejects.toThrow(/no text/i);
  });

  it('says so when the translator answered for nothing', async () => {
    tab();
    window.vexGuestEval.mockResolvedValueOnce(['hello']);
    window.vex.translateText = vi.fn(async () => null);
    await expect(TranslateSide.run('fr')).rejects.toThrow(/did not answer/i);
  });

  it('a second run takes the translation off instead of doubling it', async () => {
    tab();
    window.vexGuestEval.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    expect(await TranslateSide.toggle('fr')).toBe(0);
    expect(window.showToast).toHaveBeenCalledWith('Translation removed');
  });

  it('refuses a page that is not a web page', async () => {
    globalThis.WebviewManager = { getActiveWebview: () => ({ getURL: () => 'file:///C:/x.html' }) };
    await expect(TranslateSide.run('fr')).rejects.toThrow(/web page/i);
  });
});
