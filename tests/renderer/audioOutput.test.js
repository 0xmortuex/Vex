// @vitest-environment jsdom
//
// Windows gives a whole program one output device, so a browser sends
// everything to the same place: a Discord call and a music tab cannot be split
// between headphones and desk speakers without moving the whole browser — which
// moves the game's sound with it. Chromium can do better (every media element
// has setSinkId); no page calls it, so Vex does, per site.

import { describe, it, expect, vi, beforeEach } from 'vitest';
const fs = require('fs');
const path = require('path');
const { AudioOutput } = require('../../src/renderer/js/audio-output.js');

const DEVICES = [
  { kind: 'audiooutput', deviceId: 'default', label: 'Default - Speakers' },
  { kind: 'audiooutput', deviceId: 'hp1', label: 'Headphones (USB)' },
  { kind: 'audiooutput', deviceId: 'spk1', label: '' },
  { kind: 'audioinput', deviceId: 'mic1', label: 'Microphone' },
];

beforeEach(() => {
  localStorage.clear();
  globalThis.VexProblems = { note: vi.fn() };
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { enumerateDevices: vi.fn(async () => DEVICES) } });
});

describe('the device list', () => {
  it('is outputs only, and names the ones Windows leaves blank', async () => {
    expect(await AudioOutput.devices()).toEqual([
      { id: 'default', label: 'Default - Speakers', isDefault: true },
      { id: 'hp1', label: 'Headphones (USB)', isDefault: false },
      { id: 'spk1', label: 'Output 3', isDefault: false },
    ]);
  });

  it('a refusal is recorded, and the caller gets an empty list rather than a throw', async () => {
    navigator.mediaDevices.enumerateDevices = vi.fn(async () => { throw new Error('NotAllowedError'); });
    expect(await AudioOutput.devices()).toEqual([]);
    expect(VexProblems.note).toHaveBeenCalledWith('Audio output', 'Could not list the output devices', expect.any(Error));
  });
});

describe('remembering the choice', () => {
  it('is kept per site, so a reopened tab comes back on the right device', () => {
    AudioOutput.setForUrl('https://open.spotify.com/track/1', 'spk1');
    expect(AudioOutput.get('https://open.spotify.com/anything/else')).toBe('spk1');
    expect(AudioOutput.get('https://discord.com/channels/1')).toBe('');
    expect(JSON.parse(localStorage.getItem(AudioOutput.KEY))).toEqual({ 'open.spotify.com': 'spk1' });
  });

  it('an empty choice puts the site back on the system default', () => {
    AudioOutput.setForUrl('https://a.example/', 'hp1');
    AudioOutput.setForUrl('https://a.example/', '');
    expect(AudioOutput.get('https://a.example/')).toBe('');
    expect(JSON.parse(localStorage.getItem(AudioOutput.KEY))).toEqual({});
  });

  it('a tab with no address yet is refused with a reason', () => {
    expect(() => AudioOutput.setForUrl('', 'hp1')).toThrow(/no address yet/);
  });
});

describe('telling the page', () => {
  it('sends the site’s device to that webview', () => {
    AudioOutput.setForUrl('https://open.spotify.com/', 'spk1');
    const wv = { send: vi.fn(), getURL: () => 'https://open.spotify.com/' };
    expect(AudioOutput.apply(wv)).toBe(true);
    expect(wv.send).toHaveBeenCalledWith('vex-audio-sink', 'spk1');
  });

  it('reaches every open tab and panel at once, so a change needs no reload', () => {
    AudioOutput.setForUrl('https://a.example/', 'hp1');
    const mk = (url) => ({ send: vi.fn(), getURL: () => url });
    const tab = mk('https://a.example/'), other = mk('https://b.example/'), panel = mk('https://a.example/x');
    globalThis.WebviewManager = { webviews: new Map([['t1', tab], ['t2', other]]) };
    globalThis.SidebarManager = { panelWebviews: { discord: panel } };
    expect(AudioOutput.applyAll()).toBe(3);
    expect(tab.send).toHaveBeenCalledWith('vex-audio-sink', 'hp1');
    expect(other.send).toHaveBeenCalledWith('vex-audio-sink', '');      // back to default
    expect(panel.send).toHaveBeenCalledWith('vex-audio-sink', 'hp1');
  });

  it('a webview that has gone is recorded, not thrown', () => {
    const dead = { send: () => { throw new Error('destroyed'); }, getURL: () => 'https://a.example/' };
    expect(AudioOutput.apply(dead)).toBe(false);
    expect(VexProblems.note).toHaveBeenCalledWith('Audio output', 'Could not set the device for this tab', expect.any(Error));
    expect(AudioOutput.apply(null)).toBe(false);
  });

  it('the menu marks what is chosen, with the default first', async () => {
    AudioOutput.setForUrl('https://a.example/', 'hp1');
    expect(await AudioOutput.menuFor('https://a.example/')).toEqual([
      { id: '', label: 'System default', isDefault: true, chosen: false },
      { id: 'hp1', label: 'Headphones (USB)', isDefault: false, chosen: true },
      { id: 'spk1', label: 'Output 3', isDefault: false, chosen: false },
    ]);
    expect((await AudioOutput.menuFor('https://b.example/'))[0].chosen).toBe(true);
  });
});

describe('the guest shim', () => {
  const preload = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8');

  it('points every media element at the device, now and as they appear', () => {
    expect(preload).toContain('__vexSetAudioSink');
    expect(preload).toContain("ipcRenderer.on('vex-audio-sink'");
    expect(preload).toMatch(/setSinkId/);
    expect(preload).toMatch(/MutationObserver/);                       // elements made later
    expect(preload).toMatch(/document\.addEventListener\('play'/);     // and ones that only exist on play
  });

  it('only runs on real web pages', () => {
    const at = preload.indexOf('__vexSetAudioSink');
    const block = preload.slice(preload.lastIndexOf('(function () {', at), at);
    expect(block).toContain("proto === 'http:' || proto === 'https:'");
  });
});

// Measured live: Chromium returned ONE nameless output, because the host has
// never had microphone permission. Vex does not work around that quietly.
describe('when Windows will not name the devices', () => {
  it('knows the list is the nameless placeholder', async () => {
    navigator.mediaDevices.enumerateDevices = vi.fn(async () => [{ kind: 'audiooutput', deviceId: '', label: '' }]);
    const devices = await AudioOutput.devices();
    expect(devices).toEqual([{ id: '', label: 'Output 1', isDefault: false }]);
    expect(AudioOutput.usable(devices)).toBe(false);
    expect(AudioOutput.usable(await AudioOutput.devices())).toBe(false);
  });

  it('a real list is usable', async () => {
    expect(AudioOutput.usable(await AudioOutput.devices())).toBe(true);
  });

  it('unlocking asks for the microphone, uses nothing, and stops it at once', async () => {
    const stop = vi.fn();
    navigator.mediaDevices.getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop }] }));
    const devices = await AudioOutput.unlockDevices();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(stop).toHaveBeenCalled();
    expect(devices.length).toBe(3);
  });

  it('a refusal reaches the caller, so the menu can say what happened', async () => {
    navigator.mediaDevices.getUserMedia = vi.fn(async () => { throw new Error('Permission denied'); });
    await expect(AudioOutput.unlockDevices()).rejects.toThrow('Permission denied');
  });
});
