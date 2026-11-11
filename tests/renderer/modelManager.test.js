// @vitest-environment jsdom
//
// Installing, updating and removing a local model meant a terminal, and which
// ones fit was invisible: an 8 GB card holds one 9 GB model badly and two
// comfortably at 4 GB each. A model that does not fit is not refused — it runs
// on the processor, ten to a hundred times slower, with no sign except answers
// that take minutes.
//
// And the model holds that memory even while Vex is hidden behind a game,
// which is what cost two agent runs.

import { describe, it, expect, vi, beforeEach } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
const { ModelManager } = require('../../src/renderer/js/model-manager.js');

const GPU = { name: 'NVIDIA GeForce RTX 4060', utilization: 8, usedMB: 800, totalMB: 8188, freeMB: 7388, usedPercent: 10 };
const GB = 1024 * 1024 * 1024;

beforeEach(() => {
  document.body.innerHTML = '<div id="model-manager"></div>';
  globalThis.AIRouter = { agentNumCtx: () => 16384, setModel: vi.fn(), getModel: () => 'qwen3.5:latest' };
  globalThis.Ollama = {
    ping: vi.fn(async () => true),
    listModels: vi.fn(async () => [
      { name: 'qwen3.5:latest', size: 5.5 * GB, sizeFormatted: '5.50 GB' },
      { name: 'llama3.2:3b', size: 2 * GB, sizeFormatted: '2.00 GB' },
      { name: 'huge:70b', size: 40 * GB, sizeFormatted: '40.00 GB' },
    ]),
    running: vi.fn(async () => [{ name: 'qwen3.5:latest', sizeMB: 5600, vramMB: 5600, onGpu: true }]),
    unload: vi.fn(async () => true),
    deleteModel: vi.fn(async () => true),
    pullModel: vi.fn(async (name, onProgress) => { onProgress({ status: 'pulling', completed: 50, total: 100 }); }),
  };
  window.vex = { gpu: vi.fn(async () => GPU) };
  window.showToast = vi.fn();
  window.vexConfirm = globalThis.vexConfirm = vi.fn(async () => true);
});

describe('what fits on the card', () => {
  it('counts the model plus the context it is asked for, not just the file', () => {
    expect(ModelManager.fitMB(5.5 * GB, 16384)).toBe(Math.round(5632 + 960 + 400));
    expect(ModelManager.fitMB(5.5 * GB, 65536)).toBeGreaterThan(ModelManager.fitMB(5.5 * GB, 16384));
  });

  it('marks a model too big for the card, and one that is merely blocked right now', async () => {
    const s = await ModelManager.state();
    const by = Object.fromEntries(s.models.map(m => [m.name, m]));
    expect(by['qwen3.5:latest']).toMatchObject({ fits: true, fitsNow: true, live: true, onGpu: true });
    expect(by['llama3.2:3b']).toMatchObject({ fits: true, live: false });
    expect(by['huge:70b'].fits).toBe(false);

    window.vex.gpu = vi.fn(async () => ({ ...GPU, usedMB: 7708, freeMB: 480, usedPercent: 94 }));
    const busy = await ModelManager.state();
    const q = busy.models.find(m => m.name === 'qwen3.5:latest');
    expect(q.fits).toBe(true);           // the card is big enough
    expect(q.fitsNow).toBe(false);       // but not while something else has it
  });

  it('with no graphics card it judges nothing rather than guessing', async () => {
    window.vex.gpu = vi.fn(async () => null);
    const s = await ModelManager.state();
    expect(s.models.every(m => m.fits === null && m.fitsNow === null)).toBe(true);
  });

  it('Ollama not running is reported, not thrown', async () => {
    globalThis.Ollama.ping = vi.fn(async () => false);
    const s = await ModelManager.state();
    expect(s).toMatchObject({ ok: false, error: 'Ollama is not running' });
  });
});

describe('freeing the card', () => {
  it('unloads every loaded model and says how much came back', async () => {
    const r = await ModelManager.freeGpu();
    expect(Ollama.unload).toHaveBeenCalledWith('qwen3.5:latest');
    expect(r).toEqual({ freed: 5600, models: ['qwen3.5:latest'] });
  });

  it('nothing loaded, nothing done', async () => {
    globalThis.Ollama.running = vi.fn(async () => []);
    expect(await ModelManager.freeGpu()).toEqual({ freed: 0, models: [] });
    expect(Ollama.unload).not.toHaveBeenCalled();
  });

  // Found 2026-11-11 in a real profile: "Gaming: Could not free the graphics card: Failed to fetch", 173 times in
  // three days. Ollama was simply closed, and every game start reported it as a problem.
  it('an Ollama that is not running holds nothing on the card: nothing to free, and not an error', async () => {
    for (const message of ['Failed to fetch', 'net::ERR_CONNECTION_REFUSED', 'connect ECONNREFUSED 127.0.0.1:11434']) {
      globalThis.Ollama.running = vi.fn(async () => { throw new TypeError(message); });
      expect(await ModelManager.freeGpu(), message).toEqual({ freed: 0, models: [] });
    }
    expect(Ollama.unload).not.toHaveBeenCalled();
  });
  // The same log: "Could not free the graphics card: timeout" at 23 game starts. Ollama was running and busy, the
  // question gets three seconds, and the model stayed on the card for the whole game.
  it('an Ollama that is slow to answer is asked once more, and the card is freed when it then answers', async () => {
    const waited = ModelManager.RETRY_AFTER_MS;
    ModelManager.RETRY_AFTER_MS = 0;
    try {
      let calls = 0;
      globalThis.Ollama.running = vi.fn(async () => { if (++calls === 1) throw new Error('timeout'); return [{ name: 'qwen3.5:latest', vramMB: 5600 }]; });
      expect(await ModelManager.freeGpu()).toEqual({ freed: 5600, models: ['qwen3.5:latest'] });
      expect(Ollama.running).toHaveBeenCalledTimes(2);
      expect(Ollama.unload).toHaveBeenCalledWith('qwen3.5:latest');
    } finally { ModelManager.RETRY_AFTER_MS = waited; }
  });
  it('an Ollama that is there and still does not answer is an error: its model is still on the card', async () => {
    const waited = ModelManager.RETRY_AFTER_MS;
    ModelManager.RETRY_AFTER_MS = 0;
    try {
      globalThis.Ollama.running = vi.fn(async () => { throw new Error('timeout'); });
      await expect(ModelManager.freeGpu()).rejects.toThrow('timeout');
      expect(Ollama.running).toHaveBeenCalledTimes(2);                 // once more, not for ever
      globalThis.Ollama.running = vi.fn(async () => { throw new Error('Ollama answered 500'); });
      await expect(ModelManager.freeGpu()).rejects.toThrow('500');
      expect(Ollama.running).toHaveBeenCalledTimes(1);                 // an answer that is an error is not asked again
    } finally { ModelManager.RETRY_AFTER_MS = waited; }
  });
  it('slow, then gone: an Ollama that closed between the two questions has nothing to free', async () => {
    const waited = ModelManager.RETRY_AFTER_MS;
    ModelManager.RETRY_AFTER_MS = 0;
    try {
      let calls = 0;
      globalThis.Ollama.running = vi.fn(async () => { throw new Error(++calls === 1 ? 'timeout' : 'Failed to fetch'); });
      expect(await ModelManager.freeGpu()).toEqual({ freed: 0, models: [] });
    } finally { ModelManager.RETRY_AFTER_MS = waited; }
  });

  it('one model that refuses does not stop the others', async () => {
    globalThis.VexProblems = { note: vi.fn() };
    globalThis.Ollama.running = vi.fn(async () => [{ name: 'a', vramMB: 100 }, { name: 'b', vramMB: 200 }]);
    globalThis.Ollama.unload = vi.fn(async (n) => { if (n === 'a') throw new Error('busy'); return true; });
    expect(await ModelManager.freeGpu()).toEqual({ freed: 200, models: ['b'] });
    expect(VexProblems.note).toHaveBeenCalledWith('Local AI', 'Could not unload a', expect.any(Error));
    delete globalThis.VexProblems;
  });
});

describe('the panel', () => {
  it('lists each model with what it costs and where it is running', async () => {
    await ModelManager.render();
    const rows = [...document.querySelectorAll('.mm-row')];
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector('.mm-name').textContent).toBe('qwen3.5:latest');
    expect(rows[0].querySelector('.mm-meta').textContent).toMatch(/5\.50 GB · needs about 6\.8 GB · loaded on the card/);
    expect(rows[0].classList.contains('live')).toBe(true);
    expect(rows[2].querySelector('.mm-meta').textContent).toMatch(/too big for this card/);
    expect(document.querySelector('.mm-card').textContent).toMatch(/RTX 4060 — 0\.8 GB of 8\.0 GB in use, 8% busy/);
  });

  it('a model loaded on the processor is called out as the slow case', async () => {
    globalThis.Ollama.running = vi.fn(async () => [{ name: 'qwen3.5:latest', vramMB: 100, onGpu: false }]);
    await ModelManager.render();
    expect(document.querySelector('.mm-row .mm-meta').textContent).toMatch(/loaded on the PROCESSOR — slow/);
  });

  it('Use picks the model, Unload frees it, Delete asks first', async () => {
    await ModelManager.render();
    const row = [...document.querySelectorAll('.mm-row')].find(r => r.querySelector('.mm-name').textContent === 'qwen3.5:latest');
    row.querySelector('[data-use]').click();
    expect(AIRouter.setModel).toHaveBeenCalledWith('qwen3.5:latest');
    row.querySelector('[data-unload]').click();
    await vi.waitFor(() => expect(Ollama.unload).toHaveBeenCalledWith('qwen3.5:latest'));
    row.querySelector('[data-delete]').click();
    await vi.waitFor(() => expect(Ollama.deleteModel).toHaveBeenCalledWith('qwen3.5:latest'));
    expect(vexConfirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true, message: expect.stringContaining('5.50 GB') }));
  });

  it('a delete that is refused deletes nothing', async () => {
    window.vexConfirm = globalThis.vexConfirm = vi.fn(async () => false);
    await ModelManager.render();
    document.querySelector('.mm-row [data-delete]').click();
    await new Promise(r => setTimeout(r, 10));
    expect(Ollama.deleteModel).not.toHaveBeenCalled();
  });

  it('installing shows progress and refreshes', async () => {
    await ModelManager.render();
    document.querySelector('#mm-pull-name').value = 'gemma3:4b';
    document.querySelector('#mm-pull').click();
    await vi.waitFor(() => expect(Ollama.pullModel).toHaveBeenCalledWith('gemma3:4b', expect.any(Function)));
    await vi.waitFor(() => expect(window.showToast).toHaveBeenCalledWith('Installed gemma3:4b'));
  });

  it('with Ollama down it says so instead of an empty list', async () => {
    globalThis.Ollama.ping = vi.fn(async () => false);
    await ModelManager.render();
    expect(document.querySelector('.mm-empty').textContent).toMatch(/Ollama is not running — start it/);
  });
});

// Seen live: "loaded on the card · will not fit until the card frees up" —
// the card was full OF THAT MODEL, which reads as a contradiction.
describe('what a loaded model is told', () => {
  it('is not told it will not fit', async () => {
    window.vex.gpu = vi.fn(async () => ({ ...GPU, usedMB: 7209, freeMB: 979, usedPercent: 88 }));
    await ModelManager.render();
    const row = [...document.querySelectorAll('.mm-row')].find(r => r.querySelector('.mm-name').textContent === 'qwen3.5:latest');
    expect(row.querySelector('.mm-meta').textContent).toMatch(/loaded on the card/);
    expect(row.querySelector('.mm-meta').textContent).not.toMatch(/will not fit/);
    // One that is genuinely blocked still says so.
    const other = [...document.querySelectorAll('.mm-row')].find(r => r.querySelector('.mm-name').textContent === 'llama3.2:3b');
    expect(other.querySelector('.mm-meta').textContent).toMatch(/will not fit until the card frees up/);
  });
});
