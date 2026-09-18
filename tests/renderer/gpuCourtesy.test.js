// @vitest-environment jsdom
//
// While Vex is hidden behind a game, the local model is holding video memory
// for nobody. Measured: a game with the card at 7.7 of 8 GB pushed the model
// onto the processor, and the same agent task that took 30 seconds ran past
// the two-minute limit and returned nothing — twice.
//
// So Vex hands it back: hidden, and the card under pressure. Never mid-answer.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const BUSY = { name: 'RTX 4060', usedPercent: 94, freeMB: 480, totalMB: 8188, utilization: 92 };
const IDLE = { name: 'RTX 4060', usedPercent: 10, freeMB: 7388, totalMB: 8188, utilization: 8 };

let SidebarManager, hidden;
beforeEach(async () => {
  vi.resetModules();
  hidden = true;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  globalThis.ModelManager = { freeGpu: vi.fn(async () => ({ freed: 5600, models: ['qwen3.5:latest'] })) };
  globalThis.AgentLoop = { isRunning: () => false };
  globalThis.AIPanel = { _sending: false };
  window.vex = { gpu: vi.fn(async () => BUSY) };
  ({ SidebarManager } = await import('../../src/renderer/js/sidebar.js?' + Math.random()));
});
afterEach(() => { delete globalThis.ModelManager; delete globalThis.AgentLoop; delete globalThis.AIPanel; });

const notes = () => { const out = []; document.addEventListener('vex:memory-event', (e) => out.push(e.detail.note)); return out; };

describe('handing the graphics card back', () => {
  it('hidden and the card crowded: the model is unloaded, and the Memory panel is told', async () => {
    const seen = notes();
    const r = await SidebarManager.freeGpuIfCrowded();
    expect(ModelManager.freeGpu).toHaveBeenCalled();
    expect(r).toMatchObject({ freed: 5600 });
    expect(seen[0]).toBe('Gave 5.5 GB of video memory back while Vex was hidden (qwen3.5:latest)');
  });

  it('not while Vex is on screen', async () => {
    hidden = false;
    expect(await SidebarManager.freeGpuIfCrowded()).toBe(null);
    expect(ModelManager.freeGpu).not.toHaveBeenCalled();
  });

  it('not while nothing else wants the card', async () => {
    window.vex.gpu = vi.fn(async () => IDLE);
    expect(await SidebarManager.freeGpuIfCrowded()).toBe(null);
    expect(ModelManager.freeGpu).not.toHaveBeenCalled();
  });

  it('never in the middle of an agent run or a chat answer', async () => {
    globalThis.AgentLoop.isRunning = () => true;
    expect(await SidebarManager.freeGpuIfCrowded()).toBe(null);
    globalThis.AgentLoop.isRunning = () => false;
    globalThis.AIPanel._sending = true;
    expect(await SidebarManager.freeGpuIfCrowded()).toBe(null);
    expect(ModelManager.freeGpu).not.toHaveBeenCalled();
  });

  it('with no graphics card to ask, it leaves the model alone', async () => {
    window.vex.gpu = vi.fn(async () => null);
    expect(await SidebarManager.freeGpuIfCrowded()).toBe(null);
    expect(ModelManager.freeGpu).not.toHaveBeenCalled();
  });

  it('a failure to unload is recorded, not thrown at the caller', async () => {
    globalThis.VexProblems = { note: vi.fn() };
    globalThis.ModelManager.freeGpu = vi.fn(async () => { throw new Error('Ollama went away'); });
    expect(await SidebarManager.freeGpuIfCrowded()).toBe(null);
    expect(VexProblems.note).toHaveBeenCalledWith('Local AI', 'Could not free the graphics card', expect.any(Error));
    delete globalThis.VexProblems;
  });

  it('only considers it after Vex has been hidden a while, and cancels if it comes back', async () => {
    vi.useFakeTimers();
    try {
      SidebarManager.startGpuCourtesy();
      expect(SidebarManager.GPU_COURTESY_MS).toBe(5 * 60000);
      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));     // back on screen: nothing scheduled
      vi.advanceTimersByTime(10 * 60000);
      expect(ModelManager.freeGpu).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
