// Per-site switches. These decide whether a request is refused, so the
// matching has to be exact about what "this site" means: a parent domain
// covers its subdomains, a site's own subdomain is not third-party, and a
// rule someone typed cannot become a rule for everything.
import { describe, it, expect } from 'vitest';
const { ruleFor, blocksCookies, blocksScripts, blocksThirdParty, clean } = require('../../src/main/site-rules.js');

const rules = {
  'example.com': { cookies: 'off' },
  'shop.example.com': { cookies: 'off', js: 'off' },
  'news.site': { thirdParty: 'off' },
};

describe('which rule applies', () => {
  it('a site’s own rule, or its parent domain’s', () => {
    expect(ruleFor(rules, 'https://example.com/a')).toEqual({ cookies: 'off' });
    expect(ruleFor(rules, 'https://www.example.com/a')).toEqual({ cookies: 'off' });
    expect(ruleFor(rules, 'https://mail.example.com/a')).toEqual({ cookies: 'off' });
  });

  it('the most specific one wins', () => {
    expect(blocksScripts(rules, 'https://shop.example.com/x')).toBe(true);
    expect(blocksScripts(rules, 'https://example.com/x')).toBe(false);
  });

  it('a site nobody set anything for is untouched', () => {
    expect(ruleFor(rules, 'https://other.example/')).toBe(null);
    expect(blocksCookies(rules, 'https://other.example/')).toBe(false);
  });

  it('a name that merely ends the same is not the same site', () => {
    expect(ruleFor(rules, 'https://notexample.com/')).toBe(null);
  });
});

describe('content from other sites', () => {
  it('the site’s own hosts are not third-party', () => {
    expect(blocksThirdParty(rules, 'https://news.site/a', 'https://news.site/js/app.js')).toBe(false);
    expect(blocksThirdParty(rules, 'https://news.site/a', 'https://cdn.news.site/x.png')).toBe(false);
    expect(blocksThirdParty(rules, 'https://cdn.news.site/a', 'https://news.site/x.png')).toBe(false);
  });

  it('anything else the page loads is refused', () => {
    expect(blocksThirdParty(rules, 'https://news.site/a', 'https://ads.example.net/t.gif')).toBe(true);
  });

  it('a page with no such rule loads whatever it likes', () => {
    expect(blocksThirdParty(rules, 'https://example.com/a', 'https://ads.example.net/t.gif')).toBe(false);
  });

  it('a request with no page behind it is left alone', () => {
    expect(blocksThirdParty(rules, '', 'https://ads.example.net/t.gif')).toBe(false);
  });
});

describe('what is accepted from the renderer', () => {
  it('keeps only the three switches, and only when off', () => {
    expect(clean({ 'a.com': { js: 'off', cookies: 'on', nonsense: 'off' } })).toEqual({ 'a.com': { js: 'off' } });
  });

  it('drops a site with nothing switched off', () => {
    expect(clean({ 'a.com': { js: 'on' } })).toEqual({});
  });

  it('refuses a host that is not one', () => {
    expect(clean({ '': { js: 'off' }, 'a b': { js: 'off' }, '*': { js: 'off' }, 'A.COM': { js: 'off' } }))
      .toEqual({ 'a.com': { js: 'off' } });
  });

  it('does not grow past a list a person could have made', () => {
    const many = {};
    for (let i = 0; i < 300; i++) many['s' + i + '.com'] = { js: 'off' };
    expect(Object.keys(clean(many)).length).toBeLessThanOrEqual(200);
  });
});

// Pictures, Global Privacy Control, the referrer and a site's own User-Agent
// are kept with the same switches.
describe('the header and picture switches', () => {
  const { blocksImages, sendsGpc, keepsReferrer, userAgentFor, validUserAgent } = require('../../src/main/site-rules.js');
  it('keeps them when off, and a User-Agent only in a shape it can send', () => {
    expect(clean({ 'a.com': { images: 'off', gpc: 'off', referrer: 'off', ua: 'mobile' } }))
      .toEqual({ 'a.com': { images: 'off', gpc: 'off', referrer: 'off', ua: 'mobile' } });
    expect(clean({ 'a.com': { ua: 'x' } })).toEqual({});
    expect(clean({ 'a.com': { ua: 'Bad\r\nHeader: 1 agent' } })).toEqual({});
    expect(clean({ 'a.com': { ua: 'MyAgent/1.0 (a custom one)' } })).toEqual({ 'a.com': { ua: 'MyAgent/1.0 (a custom one)' } });
    expect(validUserAgent('a'.repeat(513))).toBe(false);
  });
  it('apply to a site and its subdomains', () => {
    const r = clean({ 'a.com': { images: 'off', gpc: 'off', referrer: 'off', ua: 'mobile' } });
    expect(blocksImages(r, 'https://www.a.com/')).toBe(true);
    expect(blocksImages(r, 'https://b.com/')).toBe(false);
    expect(sendsGpc(r, 'https://shop.a.com/')).toBe(false);
    expect(sendsGpc(r, 'https://b.com/')).toBe(true);
    expect(keepsReferrer(r, 'https://a.com/x', 'https://b.com/')).toBe(true);
    expect(keepsReferrer(r, 'https://c.com/x', 'https://b.com/')).toBe(false);
    expect(userAgentFor(r, 'https://a.com/', 'MOBILE')).toMatchObject({ ua: 'MOBILE', mobile: true });
    expect(userAgentFor(r, 'https://b.com/', 'MOBILE')).toBe(null);
  });
});
