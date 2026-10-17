// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const { VexProgress } = require('../../src/renderer/js/fun/fun-core');
const { VexPet } = require('../../src/renderer/js/fun/vex-pet');
const { VexPetCompanion } = require('../../src/renderer/js/fun/pet-companion');
let host;
beforeEach(() => {
  localStorage.clear(); globalThis.VexProgress = VexProgress;
  delete globalThis.VexPlayfulness;
  VexProgress._gameFlag = false;
  VexProgress.setEnabled('pet', true);
  document.body.innerHTML = '<div id="pet"></div>'; host = document.getElementById('pet');
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { host._companion?.destroy(); vi.restoreAllMocks(); });
const mount = () => VexPetCompanion.render(host, VexPet.snapshot(), svg => new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement);
const sent = () => JSON.parse(console.log.mock.calls.at(-1)[0].slice(8));

describe('saved pet care', () => {
  it('keeps customization and care counts through focus cheers', () => {
    VexPet.interact('customize', { name: 'Pip', species: 'fox', color: '#b2c9a5', size: 112, accessory: 'bow' });
    VexPet.interact('feed'); VexPet.interact('play'); VexPet.cheer();
    expect(VexPet.snapshot()).toMatchObject({ snacks: 1, plays: 1, prefs: { name: 'Pip', species: 'fox', size: 112, accessory: 'bow' } });
  });
  it('validates preferences, strips control characters, clamps positions and ignores unknown actions', () => {
    VexPet.interact('customize', { name: '\u0000Pip', color: 'url(evil)', species: 'dragon', size: 999, position: { x: -2, y: 8 }, extra: 'ignored' });
    expect(VexPet.snapshot().prefs).toMatchObject({ name: 'Pip', color: 'theme', species: 'cat', size: 88, position: { x: 0, y: 1 } });
    const saved = localStorage.getItem(VexPet.KEY);
    expect(VexPet.interact('delete-profile')).toBe(false);
    expect(localStorage.getItem(VexPet.KEY)).toBe(saved);
  });
  it('does not move a locked pet, but lets its owner reset the position', () => {
    VexPet.interact('customize', { position: { x: 0.4, y: 0.5 } });
    VexPet.interact('customize', { locked: true });
    VexPet.interact('customize', { position: { x: 0.9, y: 0.9 } });
    expect(VexPet.state().prefs.position).toEqual({ x: 0.4, y: 0.5 });
    VexPet.interact('customize', { position: null });
    expect(VexPet.state().prefs.position).toBeNull();
  });
  it('throttles repeated hover cuddles and expires the reaction without losing counts', () => {
    vi.spyOn(VexProgress, 'now').mockReturnValue(1800000000000);
    expect(VexPet.interact('cuddle')).toBe(true);
    expect(VexPet.interact('cuddle')).toBe(false);
    expect(VexPet.snapshot().mood).toBe('cuddle');
    VexProgress.now.mockReturnValue(1800000010000);
    expect(VexPet.snapshot().mood).not.toBe('cuddle');
    expect(VexPet.state().cuddles).toBe(1);
  });
  it('does not run interactions when off or quiet', () => {
    localStorage.setItem('vex.fun.quiet', '1');
    expect(VexPet.interact('feed')).toBe(false);
    expect(VexPet.state().snacks).toBe(0);
  });
  it('keeps every species, accessory and mood within the SVG bound', () => {
    for (const species of VexPet.OPTIONS.species) for (const accessory of VexPet.OPTIONS.accessory) for (const mood of Object.keys(VexPet.LABELS)) {
      const art = VexPet.art(mood, species, accessory);
      expect(art.length).toBeLessThan(6000);
      expect(art).not.toMatch(/<script|onload|https?:/);
    }
  });
});

describe('New Tab care menu', () => {
  it('opens by keyboard-compatible button and offers feeding, play, cuddle and sleep', () => {
    mount(); host.querySelector('.vpc-avatar').click();
    expect(host.querySelector('.vpc-menu').hidden).toBe(false);
    host.querySelector('[data-pet-action="feed"]').click();
    expect(sent()).toEqual({ type: 'pet-action', action: 'feed' });
    expect(host.querySelector('.vpc-speech').textContent).toContain('Delicious');
  });
  it('starts and finishes a five-catch ball game', () => {
    mount(); host.querySelector('[data-pet-action="play"]').click();
    const ball = host.querySelector('.vpc-ball'); expect(ball.hidden).toBe(false);
    for (let i = 0; i < 5; i++) ball.click();
    expect(ball.hidden).toBe(true);
    expect(host.querySelector('.vpc-speech').textContent).toContain('Five catches');
  });
  it('writes customization through a bounded command and renders names as text', () => {
    VexPet.interact('customize', { name: '<img src=x>' }); mount();
    expect(host.querySelector('.vpc-name').textContent).toBe('<img src=x>');
    expect(host.querySelector('img')).toBeNull();
    const size = host.querySelector('[aria-label="Size"]'); size.value = '112'; size.dispatchEvent(new Event('change'));
    expect(sent()).toMatchObject({ action: 'customize', prefs: { size: 112 } });
  });
  it('keeps the menu and focused fields during periodic snapshots and cleans up when disabled', () => {
    mount(); host.querySelector('.vpc-avatar').click();
    const name = host.querySelector('[aria-label="Name"]'); name.focus(); name.value = 'Typing';
    mount(); expect(name.value).toBe('Typing'); expect(host.querySelector('.vpc-menu').hidden).toBe(false);
    VexPetCompanion.render(host, null, () => {});
    expect(host.childNodes.length).toBe(0); expect(host._companion).toBeNull();
  });
});
