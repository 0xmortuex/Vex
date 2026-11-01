// The pages Vex draws itself when it stops a site (dangerous-site warning, look-alike address, certificate notice, no-HTTPS,
// ad-blocked) came out in English in a Turkish Vex: the main process had no Turkish path for HTML. translateHtml replaces the text
// between tags that is, whole, an entry of TR; the host names and links the code puts in stay as they are.
import { describe, it, expect } from 'vitest';
const { translateHtml, TR } = require('../../src/main/i18n-main.js');
const { threatPageHtml } = require('../../src/main/threat-pages');
const { lookalikePageHtml } = require('../../src/main/web-safety-pages');
const { blockedPageHtml } = require('../../src/main/ad-verdict');
const { noHttpsPage, certErrorPage } = require('../../src/main/https-only');

// Every piece of visible text of a page, as the person would read it.
function texts(html) {
  const body = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  return [...body.matchAll(/(?:<title>|>)([^<>]+)(?=<)/g)].map(m => m[1].trim()).filter(Boolean);
}
const ENGLISH = /\b(the|of|you|this|and|it|with|from|your)\b/i;

describe('safety pages in Turkish', () => {
  it('English stays English', () => {
    const html = threatPageHtml('https://bad.example/x', { kind: 'host', matched: 'bad.example' });
    expect(translateHtml(html, 'en')).toBe(html);
  });
  it('the dangerous-site page is Turkish whole, and keeps its links and host', () => {
    const html = threatPageHtml('https://bad.example/x', { kind: 'host', matched: 'bad.example' });
    const out = translateHtml(html, 'tr');
    expect(out).toContain('Bu site tehlikeli olarak bildirilmiş');
    expect(out).toContain('Güvenli yere dön');
    expect(out).toContain('bad.example');
    expect(out).toContain('href="https://vex-threat.invalid/back"');
    expect(texts(out).filter(t => ENGLISH.test(t))).toEqual([]);
  });
  it('the look-alike page, with reasons that carry names', () => {
    const html = lookalikePageHtml('https://paypa1.com/x', { resembles: 'PayPal', reasons: ['Swaps letters for numbers or lookalike pairs so that it reads as “paypal.com”.', 'Only one letter different from “paypal.com”.'] });
    const out = translateHtml(html, 'tr');
    expect(out).toContain('Bu adres başka bir siteye benziyor');
    expect(out).toContain('“paypal.com” gibi okunmasını sağlıyor');
    expect(texts(out).filter(t => ENGLISH.test(t))).toEqual([]);
  });
  it('the ad-blocked, no-HTTPS and certificate pages', () => {
    for (const html of [blockedPageHtml('https://ads.example.com/x'), noHttpsPage('example.com', 'http://example.com/x'), certErrorPage('example.com', 'net::ERR_CERT_DATE_INVALID')]) {
      const out = translateHtml(html, 'tr');
      expect(texts(out).filter(t => ENGLISH.test(t)), texts(out).join(' | ')).toEqual([]);
    }
  });
  it('a quote in the text (Vex\'s) is matched after the page escaped it', () => {
    const out = translateHtml('<html><body><h1>Blocked by Vex&#39;s ad blocker</h1></body></html>', 'tr');
    expect(out).toContain('Vex’in reklam engelleyicisi tarafından engellendi');
  });
  it('the table has no empty value', () => {
    for (const [k, v] of Object.entries(TR)) expect(v, k).toBeTruthy();
  });
});
