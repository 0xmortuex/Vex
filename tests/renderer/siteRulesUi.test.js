// @vitest-environment jsdom
//
// The marker that says a site is being held back. YouTube with "content from
// other sites" switched off serves its video from another host, so the player
// was simply black — with nothing on screen to say why. That is the bug this
// prevents, so what matters is that it appears, says which switches are off,
// and disappears again.
import { describe, it, expect, beforeEach } from 'vitest';
const { SiteRulesUI: S } = require('../../src/renderer/js/site-rules-ui.js');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<button id="btn-site-rules" hidden></button>';
});

describe('what is switched off, in words', () => {
  it('names one switch, or several', () => {
    S.save({ 'youtube.com': { thirdParty: 'off' } });
    expect(S.describe('https://www.youtube.com/watch?v=x')).toBe('youtube.com: content from other sites switched off');
    S.save({ 'example.com': { js: 'off', cookies: 'off', thirdParty: 'off' } });
    expect(S.describe('https://example.com/')).toBe('example.com: javascript, cookies and content from other sites switched off');
  });

  it('a site with nothing switched off says nothing', () => {
    expect(S.describe('https://example.com/')).toBe('');
    S.save({ 'other.com': { js: 'off' } });
    expect(S.describe('https://example.com/')).toBe('');
  });
});

describe('the marker in the toolbar', () => {
  it('appears for a held-back site, with the reason in its tooltip', () => {
    S.save({ 'youtube.com': { thirdParty: 'off' } });
    S._mark('https://www.youtube.com/watch?v=x');
    const btn = document.getElementById('btn-site-rules');
    expect(btn.hidden).toBe(false);
    expect(btn.title).toMatch(/content from other sites switched off/);
    expect(btn.title).toMatch(/click to change/);
  });

  it('goes away on a site that is not held back', () => {
    S.save({ 'youtube.com': { thirdParty: 'off' } });
    S._mark('https://www.youtube.com/');
    S._mark('https://example.com/');
    expect(document.getElementById('btn-site-rules').hidden).toBe(true);
  });

  it('a subdomain counts as the site it belongs to', () => {
    S.save({ 'youtube.com': { thirdParty: 'off' } });
    expect(S.describe('https://music.youtube.com/')).toMatch(/switched off/);
  });
});
