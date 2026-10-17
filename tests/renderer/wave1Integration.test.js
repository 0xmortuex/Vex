// @vitest-environment jsdom
//
// Wave 1 integration: the hooks between the branches. Turkish deadlines through VexTr, the
// repository registry feeding the developer loop, and Screenshot to Code behind the
// sensitivity gate (a screenshot is "an image attached": asked every time, refused for a vault
// or private page, and never sent when the gate is missing).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

describe('Turkish deadlines', () => {
  beforeEach(() => { globalThis.VexTr = fresh(JS + 'vex-tr.js').VexTr; });
  const NOW = new Date(2026, 9, 16, 10, 0).getTime();

  it('reads "son tarih 15 Kasım 2026" and "en geç cuma" as deadlines, 17:00 that day', () => {
    const { VexDeadlines } = fresh(JS + 'deadline-extractor.js');
    const found = VexDeadlines.extract('Başvuru için son tarih 15 Kasım 2026. En geç cuma teslim edin.', NOW);
    expect(found.map(f => f.kind)).toEqual(['deadline', 'deadline']);
    const first = new Date(found[0].dueAt);
    expect([first.getFullYear(), first.getMonth(), first.getDate(), first.getHours()]).toEqual([2026, 10, 15, 17]);
    expect(new Date(found[1].dueAt).getDay()).toBe(5);
  });

  it('skips a day that does not exist, as the English reading skips 31 Feb', () => {
    const { VexDeadlines } = fresh(JS + 'deadline-extractor.js');
    expect(VexDeadlines.extract('Son tarih 31 Şubat.', NOW)).toEqual([]);
  });

  it('still reads English', () => {
    const { VexDeadlines } = fresh(JS + 'deadline-extractor.js');
    expect(VexDeadlines.extract('Submit by Friday.', NOW)).toHaveLength(1);
  });
});

describe('Screenshot to Code and the sensitivity gate', () => {
  beforeEach(() => {
    vi.resetModules();
    globalThis.VexSensitivity = fresh(JS + 'ai-sensitivity.js').VexSensitivity;
  });

  it('classifies an attached image as a thing to ask about, every time', () => {
    const d = VexSensitivity.decide('screenshotToCode', { dataClass: 'image', pageContext: { url: 'https://example.com/' } });
    expect(d.verdict).toBe('ask');
    expect(d.classes.map(c => c.id)).toContain('image');
  });

  it('refuses a screenshot of a vault page', () => {
    const d = VexSensitivity.decide('screenshotToCode', { dataClass: 'image', pageContext: { url: 'https://my.1password.com/' } });
    expect(d.verdict).toBe('refuse');
  });

  it('does not ask about ordinary chat; since the picture rule (49d28f65) an agent screenshot is asked about like any picture', () => {
    expect(VexSensitivity.decide('agent', { image: 'data:image/png;base64,AAAA', message: 'next' }).verdict).toBe('ask');
    expect(VexSensitivity.decide('chat', { message: 'hello' }).verdict).toBe('send');
  });

  it('sends nothing to the worker when the person says no', async () => {
    const { ScreenshotToCode } = fresh(JS + 'screenshot-to-code.js');
    const fetchAI = vi.fn();
    window.VexConfig = { fetchAI };
    window.AIRouter = { cloudWorkerUrl: () => 'https://vex-ai.example.workers.dev' };
    globalThis.AIRouter = window.AIRouter;
    window.vexConfirm = vi.fn().mockResolvedValue(false);
    ScreenshotToCode._pageUrl = 'https://example.com/';
    await expect(ScreenshotToCode.generate('data:image/png;base64,AAAA', 'html')).rejects.toThrow(/Not sent/);
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    expect(fetchAI).not.toHaveBeenCalled();
  });

  it('sends nothing when the gate is not loaded', async () => {
    const { ScreenshotToCode } = fresh(JS + 'screenshot-to-code.js');
    const fetchAI = vi.fn();
    window.VexConfig = { fetchAI };
    globalThis.AIRouter = { cloudWorkerUrl: () => 'https://vex-ai.example.workers.dev' };
    delete globalThis.VexSensitivity;
    await expect(ScreenshotToCode.generate('data:image/png;base64,AAAA', 'html')).rejects.toThrow(/sensitivity gate is not loaded/);
    expect(fetchAI).not.toHaveBeenCalled();
  });
});
