// @vitest-environment jsdom
//
// Master Volume makes a cross-origin element CORS-clean by setting
// crossOrigin="anonymous" and reloading it. A second slider move during that
// reload took the "anonymous" for a yes and tapped the element; when the
// server refused (now every server on this computer or the local network,
// security finding SE7) the element stayed tapped, and Web Audio plays a
// refused element as silence.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; window.VexIcons = VexIcons;
require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/site-volume.js');
const { MasterVolume } = require('../../src/renderer/js/master-volume.js');

function fakeAudio() {
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } });
  const made = { sources: 0 };
  class Ctx {
    constructor() { this.state = 'running'; this.destination = {}; }
    addEventListener() {}
    resume() { return Promise.resolve(); }
    createMediaElementSource() { made.sources++; return node(); }
    createGain() { return node(); }
  }
  window.AudioContext = Ctx;
  return made;
}
const runInPage = (js) => (0, eval)(js);

describe('Master Volume waits for the CORS reload', () => {
  beforeEach(() => { delete window.__vexMV; delete window.__vexAudio; document.body.innerHTML = ''; });

  it('a refused reload leaves the element untapped, at plain volume', () => {
    const made = fakeAudio();
    document.body.innerHTML = '<audio src="http://192.168.1.20/radio.mp3"></audio>';
    const a = document.querySelector('audio');
    a.load = () => {};
    a.play = () => Promise.resolve();
    runInPage(MasterVolume._script(2));
    expect(a.crossOrigin).toBe('anonymous');         // the reload is under way
    window.__vexMV.set(3);                            // the slider moves again meanwhile
    expect(made.sources).toBe(0);
    a.dispatchEvent(new Event('error'));              // the server sends no CORS header
    expect(a.crossOrigin).toBe(null);
    window.__vexMV.set(4);
    expect(made.sources).toBe(0);
    expect(a.volume).toBe(1);
  });

  it('an accepted reload is tapped and boosted', () => {
    const made = fakeAudio();
    document.body.innerHTML = '<audio src="https://cdn.example.com/radio.mp3"></audio>';
    const a = document.querySelector('audio');
    a.load = () => {};
    a.play = () => Promise.resolve();
    runInPage(MasterVolume._script(2));
    a.dispatchEvent(new Event('canplay'));
    expect(made.sources).toBe(1);
    expect(window.__vexAudio.nodes.get(a).out.gain.value).toBe(2);
  });
});
