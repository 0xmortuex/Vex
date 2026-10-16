// @vitest-environment jsdom
//
// T3-086: the terms-of-service highlighter (js/tos-highlight.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let VexTos;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  vi.resetModules();
  window.showToast = vi.fn();
  ({ VexTos } = fresh(JS + 'tos-highlight.js'));
});

const TERMS = [
  'Welcome to the service. These terms describe how you may use it and what we expect from you.',
  'Your subscription will automatically renew at the end of each billing period unless you cancel at least 24 hours before.',
  'We may share your personal information with our advertising partners and other third parties.',
  'Any dispute will be resolved by binding arbitration, and you waive your right to a jury trial or to join a class action.',
  'We reserve the right to modify these terms at any time without notice, and continued use constitutes acceptance.',
  'You grant us a perpetual, irrevocable, worldwide licence to use any content you post.',
  'The service is provided as is, without warranties of any kind, and we shall not be liable for any damages.',
  'We may suspend your account at any time without prior notice and for any reason.',
  'We will retain your data indefinitely, even after you delete your account.',
  'Cats are very small tigers that live in houses and do not pay rent to anyone at all.',
].join(' ');

describe('analyze', () => {
  it('marks each kind of unusual clause once, with the reason', () => {
    const r = VexTos.analyze(TERMS);
    const ids = r.findings.map(f => f.id);
    for (const id of ['auto-renew', 'data-sharing', 'arbitration', 'one-sided-change', 'content-licence', 'liability', 'termination', 'retention']) expect(ids, id).toContain(id);
    expect(r.findings.every(f => f.label && f.why && f.excerpt)).toBe(true);
    expect(r.findings.some(f => /Cats are very small/.test(f.excerpt))).toBe(false);
  });

  it('marks nothing in ordinary prose', () => {
    const r = VexTos.analyze('This recipe takes about forty minutes. First chop the onions finely. Then fry them until they are golden brown and sweet.');
    expect(r.findings).toEqual([]);
    expect(r.scanned).toBe(3);
  });

  it('does not repeat the same sentence for the same reason, and keeps order', () => {
    const r = VexTos.analyze(TERMS + ' ' + TERMS);
    expect(r.findings.length).toBe(new Set(r.findings.map(f => f.id + f.excerpt)).size);
    const idx = r.findings.map(f => f.index);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it('clips a long sentence and caps the list', () => {
    const long = 'We may sell your personal data to anyone ' + 'and more and more '.repeat(60) + '.';
    expect(VexTos.analyze(long).findings[0].excerpt.length).toBeLessThanOrEqual(VexTos.EXCERPT);
    const many = Array.from({ length: 200 }, (_, i) => 'Variant number ' + i + ' says your subscription will automatically renew every single period.').join(' ');
    expect(VexTos.analyze(many).findings.length).toBe(VexTos.MAX_FINDINGS);
  });

  it('says it is not legal advice', () => {
    expect(VexTos.NOT_ADVICE).toMatch(/not legal advice/);
  });
});

describe('looksLikeTerms', () => {
  it('reads the address and the title', () => {
    expect(VexTos.looksLikeTerms('https://example.com/legal/terms-of-service', '')).toBe(true);
    expect(VexTos.looksLikeTerms('https://example.com/', 'Privacy Policy - Example')).toBe(true);
    expect(VexTos.looksLikeTerms('https://example.com/blog/cats', 'Cats')).toBe(false);
  });
});

describe('markScript', () => {
  it('marks a sentence in a page and can be run twice without stacking marks', () => {
    document.body.innerHTML = '<p>Intro text goes here and is not marked.</p><p>Your subscription will automatically renew at the end of each billing period unless you cancel.</p>';
    const f = VexTos.analyze(document.body.textContent).findings;
    expect(f.length).toBe(1);
    const run = () => (0, eval)(VexTos.markScript(f)); // eslint-disable-line no-eval
    expect(run()).toBe(1);
    expect(document.querySelectorAll('mark[data-vex-tos="auto-renew"]').length).toBe(1);
    expect(document.querySelector('mark').title).toMatch(/Renews by itself/);
    expect(run()).toBe(1);
    expect(document.querySelectorAll('mark[data-vex-tos]').length).toBe(1);
  });

  it('treats the page text as data: a sentence full of quotes and script tags does not break the script', () => {
    const evil = 'Your subscription will automatically renew"; alert(1); // </script><script>alert(2)</script> every month.';
    document.body.textContent = evil;
    const f = VexTos.analyze(evil).findings;
    expect(() => (0, eval)(VexTos.markScript(f))).not.toThrow(); // eslint-disable-line no-eval
  });
});

describe('explainLocal', () => {
  const finding = { excerpt: 'We may share your data with partners.' };
  it('uses the local model and nothing else', async () => {
    globalThis.AIRouter = { getOllamaStatus: () => ({ available: true }), callOn: vi.fn(async () => ({ backend: 'local', result: JSON.stringify({ explanation: 'They can give your data to other companies.' }) })) };
    const text = await VexTos.explainLocal(finding, { url: 'https://x.test/terms', title: 'Terms' });
    expect(text).toBe('They can give your data to other companies.');
    expect(AIRouter.callOn.mock.calls[0][0]).toBe('local');
    expect(AIRouter.callOn.mock.calls[0][2].selectedText).toBe(finding.excerpt);
    delete globalThis.AIRouter;
  });

  it('says so when no local model is running, and sends nothing', async () => {
    globalThis.AIRouter = { getOllamaStatus: () => ({ available: false }), callOn: vi.fn() };
    await expect(VexTos.explainLocal(finding, {})).rejects.toThrow(/No local model is running.*nothing is sent to the cloud/);
    expect(AIRouter.callOn).not.toHaveBeenCalled();
    delete globalThis.AIRouter;
  });

  it('refuses an answer that did not come from the local model', async () => {
    globalThis.AIRouter = { getOllamaStatus: () => ({ available: true }), callOn: vi.fn(async () => ({ backend: 'cloud', result: 'x' })) };
    await expect(VexTos.explainLocal(finding, {})).rejects.toThrow(/did not come from the local model/);
    delete globalThis.AIRouter;
  });
});

describe('run', () => {
  it('refuses a private tab', async () => {
    globalThis.TabManager = { getActiveTab: () => ({ url: 'https://x.test/terms', title: 'T', partition: 'tor-1' }) };
    globalThis.WebviewManager = { getActiveWebview: () => ({ executeJavaScript: vi.fn() }) };
    window.VexTabPolicy = { canRestore: () => false };
    await expect(VexTos.run()).rejects.toThrow(/private tab/);
    delete globalThis.TabManager; delete globalThis.WebviewManager;
  });

  it('does nothing while switched off', async () => {
    VexTos.setEnabled(false);
    expect(await VexTos.run()).toBeNull();
  });
});
