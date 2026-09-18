// @vitest-environment jsdom
//
// The same path in three places — live, staging, and whatever is running on
// this machine — and moving between them meant retyping a URL by hand, which is
// exactly where a typo costs ten minutes.

import { describe, it, expect, vi, beforeEach } from 'vitest';
const { DevSwitch } = require('../../src/renderer/js/dev-switch.js');

beforeEach(() => {
  localStorage.clear();
  globalThis.VexProblems = { note: vi.fn() };
  window.vex = { devPorts: vi.fn(async () => [{ port: 5173, url: 'http://localhost:5173/', guess: 'Vite' }]) };
});

describe('swapping the host', () => {
  it('keeps the path, the query and the fragment — the part worth not retyping', () => {
    expect(DevSwitch.swap('https://shop.example/products/42?sort=price#reviews', 'staging.shop.example'))
      .toBe('https://staging.shop.example/products/42?sort=price#reviews');
  });

  it('a local server gets http, because insisting on https makes it a blank page', () => {
    expect(DevSwitch.swap('https://shop.example/a?b=1', 'localhost:5173')).toBe('http://localhost:5173/a?b=1');
    expect(DevSwitch.swap('https://shop.example/a', '127.0.0.1:3000')).toBe('http://127.0.0.1:3000/a');
    expect(DevSwitch.swap('http://localhost:5173/a', 'shop.example')).toBe('https://shop.example/a');
  });

  it('tolerates a host written the way a person would paste it', () => {
    expect(DevSwitch.swap('https://a.example/x', 'https://b.example/')).toBe('https://b.example/x');
    expect(() => DevSwitch.swap('https://a.example/x', '')).toThrow(/nowhere to switch to/);
  });
});

describe('remembering a site’s environments', () => {
  it('works in both directions, whichever one you are on', () => {
    DevSwitch.remember('https://shop.example/', { staging: 'staging.shop.example', local: 'localhost:5173' });
    expect(DevSwitch.groupFor('https://shop.example/any/path')).toMatchObject({ key: 'shop.example', staging: 'staging.shop.example', local: 'localhost:5173' });
    expect(DevSwitch.groupFor('https://staging.shop.example/x')).toMatchObject({ key: 'shop.example' });
    expect(DevSwitch.groupFor('http://localhost:5173/x')).toMatchObject({ key: 'shop.example' });
    expect(DevSwitch.groupFor('https://unrelated.example/')).toBe(null);
  });

  it('strips the scheme and the trailing slash people paste in', () => {
    DevSwitch.remember('https://a.example/', { staging: 'https://stage.a.example/' });
    expect(DevSwitch.groupFor('https://a.example/').staging).toBe('stage.a.example');
  });

  it('clearing both forgets the site', () => {
    DevSwitch.remember('https://a.example/', { staging: 'stage.a.example' });
    DevSwitch.remember('https://a.example/', { staging: '', local: '' });
    expect(DevSwitch.groupFor('https://a.example/')).toBe(null);
    expect(() => DevSwitch.remember('not a url', {})).toThrow(/no address/);
  });
});

describe('where you can go from here', () => {
  it('offers the remembered ones and whatever is actually listening', async () => {
    DevSwitch.remember('https://shop.example/', { staging: 'staging.shop.example', local: 'localhost:3000' });
    const out = await DevSwitch.options('https://shop.example/cart?x=1');
    expect(out.map(o => o.host)).toEqual(['staging.shop.example', 'localhost:3000', 'localhost:5173']);
    expect(out[0].url).toBe('https://staging.shop.example/cart?x=1');
    expect(out[2].label).toBe('localhost:5173 — Vite');
  });

  it('never offers where you already are', async () => {
    DevSwitch.remember('https://shop.example/', { local: 'localhost:5173' });
    const out = await DevSwitch.options('http://localhost:5173/cart');
    expect(out.map(o => o.host)).toEqual(['shop.example']);
  });

  it('a scan that fails still leaves the remembered ones usable', async () => {
    window.vex.devPorts = vi.fn(async () => { throw new Error('no ipc'); });
    DevSwitch.remember('https://shop.example/', { staging: 'stage.example' });
    expect((await DevSwitch.options('https://shop.example/')).map(o => o.host)).toEqual(['stage.example']);
    expect(VexProblems.note).toHaveBeenCalledWith('Environments', 'Could not look for dev servers', expect.any(Error));
  });

  it('an address Vex cannot parse offers nothing rather than throwing', async () => {
    expect(await DevSwitch.options('not a url')).toEqual([]);
  });
});
