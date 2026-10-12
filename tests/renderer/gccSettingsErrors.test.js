// @vitest-environment jsdom
//
// Found 2026-10-12 reading Settings > Gaming's "Game Control Center location"
// row: Browse… and Find it automatically ignored a failure from main, so a
// button that threw did nothing visible and left an unhandled rejection.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { GameMode } = require('../../src/renderer/js/game-mode.js');

const flush = () => new Promise(r => setTimeout(r, 0));

describe('Settings > Gaming > Game Control Center location', () => {
  let host;
  beforeEach(() => {
    window.showToast = vi.fn();
    host = document.createElement('div');
    document.body.innerHTML = '';
    document.body.appendChild(host);
    window.vex = {
      gccGet: vi.fn(async () => ({ path: 'D:\\Game Control Center.exe' })),
      gccPick: vi.fn(async () => { throw new Error('the file dialog failed'); }),
      gccClear: vi.fn(async () => { throw new Error('the setting could not be cleared'); }),
    };
  });

  it('says so when Browse… fails', async () => {
    GameMode.renderGamingSettings(host);
    await flush();
    host.querySelector('.gcc-browse').click();
    await flush();
    expect(window.showToast).toHaveBeenCalledWith('Game Control Center location: the file dialog failed', 'error');
  });

  it('says so when Find it automatically fails', async () => {
    GameMode.renderGamingSettings(host);
    await flush();
    host.querySelector('.gcc-auto').click();
    await flush();
    expect(window.showToast).toHaveBeenCalledWith('Game Control Center location: the setting could not be cleared', 'error');
  });
});
