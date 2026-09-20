// @vitest-environment jsdom
// Controlling a music panel from anywhere: the page's own media element for
// play/pause and volume, the player's own buttons for next/previous.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { PanelMedia } = require('../../src/renderer/js/panel-media.js');

let ran;
beforeEach(() => {
  ran = [];
  document.body.innerHTML = '<div id="panel-spotify"><webview></webview></div>';
  globalThis.SidebarManager = { panelWebviews: {} };
  window.showToast = vi.fn();
  window.vexGuestEval = vi.fn(async (wv, code) => { ran.push(code); return ran.length === 1 ? 'playing' : true; });
});

describe('PanelMedia', () => {
  it('finds the open music panel, and says so when there is none', async () => {
    expect(PanelMedia.webview()).toBeTruthy();
    document.body.innerHTML = '';
    await expect(PanelMedia.playPause()).rejects.toThrow('Open the music panel once');
  });

  it('play/pause works on the page\'s own player, whatever the site calls its buttons', async () => {
    expect(await PanelMedia.playPause()).toBe('playing');
    expect(ran[0]).toContain("querySelectorAll('video,audio')");
    expect(window.showToast).toHaveBeenCalledWith('Playing');
  });

  it('next and previous use the player\'s buttons, and say so when it has none', async () => {
    await PanelMedia.next();
    expect(ran[0]).toContain('control-button-skip-forward');
    expect(ran[0]).toContain("aria-label*=");
    window.vexGuestEval = vi.fn(async () => false);
    await expect(PanelMedia.previous()).rejects.toThrow('no Previous button');
  });

  it('volume is the player\'s own, and only a real figure', async () => {
    window.vexGuestEval = vi.fn(async () => 40);
    expect(await PanelMedia.volume(40)).toBe(40);
    await expect(PanelMedia.volume(140)).rejects.toThrow('0 to 100');
    await expect(PanelMedia.volume('loud')).rejects.toThrow('0 to 100');
  });
});
