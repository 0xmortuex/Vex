// @vitest-environment jsdom
//
// The panel state strip also says what Autopilot's stream holds for you: a count and one title,
// refreshed at most every two minutes, only while the strip is on.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const path = require('path');
const JS = path.resolve(__dirname, '../../src/renderer/js');
let P, stream;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  delete require.cache[require.resolve(path.join(JS, 'panel-state.js'))];
  P = require(path.join(JS, 'panel-state.js')).PanelState;
  stream = vi.fn(async () => ({ now: [{ title: 'Reply to Sam' }], today: [{ title: 'b' }, { title: 'c' }], fyi: [{ title: 'd' }], problems: [] }));
  globalThis.VexAutopilot = { stream, showPanel: vi.fn(async () => {}) };
});
afterEach(() => { delete globalThis.VexAutopilot; vi.restoreAllMocks(); });

describe('what Autopilot says needs you', () => {
  it('counts now and today (not fyi), keeps one title, and reads at most every two minutes', async () => {
    const a = await P.refreshAutopilot(1000);
    expect(a).toMatchObject({ now: 1, today: 2, top: 'Reply to Sam' });
    expect(P.describeAutopilot(a)).toBe('1 need you now, 2 today (Reply to Sam)');
    await P.refreshAutopilot(1000 + 60000);
    expect(stream).toHaveBeenCalledTimes(1);
    await P.refreshAutopilot(1000 + P.AUTOPILOT_MS + 1);
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it('nothing to say when Autopilot is not there or holds nothing', async () => {
    delete globalThis.VexAutopilot;
    expect(await P.refreshAutopilot(5)).toBe(null);
    expect(P.autopilotState()).toBe(null);
    globalThis.VexAutopilot = { stream: async () => ({ now: [], today: [], fyi: [{ title: 'x' }] }) };
    await P.refreshAutopilot(10);
    expect(P.autopilotState()).toBe(null);
  });

  it('a failing stream is raised, not hidden, and does not leave the reader stuck', async () => {
    globalThis.VexAutopilot = { stream: async () => { throw new Error('mail down'); } };
    await expect(P.refreshAutopilot(1)).rejects.toThrow('mail down');
    globalThis.VexAutopilot = { stream, showPanel: vi.fn() };
    await expect(P.refreshAutopilot(2)).resolves.toMatchObject({ now: 1 });
  });

  it('the strip shows a chip that opens Autopilot, only when the strip is on', async () => {
    await P.refreshAutopilot(1);
    P.render();
    expect(document.getElementById('panel-state-strip')).toBe(null);          // strip off
    localStorage.setItem(P.KEYS.strip, '1');
    P.render();
    const chip = document.querySelector('#panel-state-strip button');
    expect(chip.textContent).toBe('Autopilot: 1 need you now, 2 today (Reply to Sam)');
    chip.click();
    expect(globalThis.VexAutopilot.showPanel).toHaveBeenCalled();
  });

  it('tick refreshes it only while the strip is on', async () => {
    await P.tick({}, 1);
    expect(stream).not.toHaveBeenCalled();
    localStorage.setItem(P.KEYS.strip, '1');
    await P.tick({}, 2);
    expect(stream).toHaveBeenCalledTimes(1);
  });
});
