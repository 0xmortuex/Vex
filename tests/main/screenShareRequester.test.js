// @vitest-environment node
//
// Discord's "Share Your Screen" died with "Requesting page changed": the picker refused the pick when the
// page's WHOLE URL differed from the one that asked, and Discord (a single-page app) rewrites its address
// while a share is started, without any navigation. The check must ask whether it is still the same site.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');

function load() {
  const start = MAIN.indexOf('function _sameRequester(');
  expect(start).toBeGreaterThan(-1);
  const end = MAIN.indexOf('\nfunction wireDisplayMediaOnSession', start);
  expect(end).toBeGreaterThan(start);
  // The function is pure (frame object + a URL string), so it can be run on its own.
  return new Function(MAIN.slice(start, end).replace(/\r/g, '') + '\nreturn _sameRequester;')();
}

describe('the screen-share requester check', () => {
  const same = load();
  const asked = 'https://discord.com/channels/@me/123456';

  it('accepts the same page', () => {
    expect(same({ url: asked, detached: false }, asked)).toBe(true);
  });

  it('accepts the same site after the single-page app changed its address (pushState)', () => {
    expect(same({ url: 'https://discord.com/channels/9876/5432?voice=1#call', detached: false }, asked)).toBe(true);
  });

  it('refuses another origin, another scheme or another port', () => {
    expect(same({ url: 'https://evil.example/channels/@me/123456', detached: false }, asked)).toBe(false);
    expect(same({ url: 'http://discord.com/channels/@me/123456', detached: false }, asked)).toBe(false);
    expect(same({ url: 'https://discord.com:8443/channels/@me/123456', detached: false }, asked)).toBe(false);
  });

  it('refuses a detached frame, a missing frame and an address it cannot read', () => {
    expect(same({ url: asked, detached: true }, asked)).toBe(false);
    expect(same(null, asked)).toBe(false);
    expect(same({ url: 'not a url', detached: false }, asked)).toBe(false);
    expect(same({ url: asked, detached: false }, '')).toBe(false);
  });

  it('is what the picker uses, before it opens and when the choice arrives (no whole-URL comparison left)', () => {
    expect(MAIN).toContain('!_sameRequester(requestingFrame, requestingUrl)');
    expect(MAIN).toContain('!_sameRequester(p.frame, p.url)');
    expect(MAIN).not.toMatch(/p\.frame\.url !== p\.url/);
    expect(MAIN).not.toMatch(/requestingFrame\.url !== requestingUrl/);
  });
});
