// @vitest-environment jsdom
//
// Three things a browser should do about links and mostly does not: say where
// one really goes, not carry the tracker when you share it, and notice an
// address pretending to be a familiar one.

import { describe, it, expect, vi, beforeEach } from 'vitest';
const { LinkSafety } = require('../../src/renderer/js/link-safety.js');

beforeEach(() => { LinkSafety._warned = new Set(); document.body.innerHTML = ''; globalThis.VexProblems = { note: vi.fn() }; });

describe('where a link really goes', () => {
  it('unwraps the common wrappers, without asking anyone', () => {
    expect(LinkSafety.unwrap('https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fa&sa=D')).toBe('https://example.com/a');
    expect(LinkSafety.unwrap('https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Fb')).toBe('https://example.com/b');
    expect(LinkSafety.unwrap('https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fc')).toBe('https://example.com/c');
    expect(LinkSafety.unwrap('https://steamcommunity.com/linkfilter/?url=https%3A%2F%2Fexample.com%2Fd')).toBe('https://example.com/d');
    expect(LinkSafety.unwrap('https://href.li/?https://example.com/e')).toBe('https://example.com/e');
  });

  it('follows a wrapper inside a wrapper, and stops rather than looping', () => {
    const inner = encodeURIComponent('https://example.com/deep');
    const once = 'https://l.facebook.com/l.php?u=' + inner;
    expect(LinkSafety.unwrap('https://www.google.com/url?q=' + encodeURIComponent(once))).toBe('https://example.com/deep');
    expect(() => LinkSafety.unwrap('https://out.reddit.com/?url=https://out.reddit.com/?url=https://a.example/')).not.toThrow();
  });

  it('leaves an ordinary link exactly as it is', () => {
    expect(LinkSafety.unwrap('https://example.com/page?q=1')).toBe('https://example.com/page?q=1');
    expect(LinkSafety.unwrap('not a url')).toBe('not a url');
    expect(LinkSafety.unwrap('')).toBe('');
  });
});

describe('what a link carries', () => {
  it('drops what identifies you and keeps what the page needs', () => {
    expect(LinkSafety.strip('https://shop.example/item?id=9&utm_source=news&fbclid=abc&colour=red'))
      .toBe('https://shop.example/item?id=9&colour=red');
    expect(LinkSafety.strip('https://a.example/x?utm_campaign=a')).toBe('https://a.example/x');
    expect(LinkSafety.strip('https://a.example/x?utm_campaign=a#part')).toBe('https://a.example/x#part');
  });

  it('leaves a clean link untouched, and is not fooled by a non-web address', () => {
    expect(LinkSafety.strip('https://a.example/x?id=1')).toBe('https://a.example/x?id=1');
    expect(LinkSafety.strip('mailto:someone@example.com')).toBe('mailto:someone@example.com');
  });

  it('clean() does both, which is what copying a link should mean', () => {
    const wrapped = 'https://www.google.com/url?q=' + encodeURIComponent('https://example.com/a?utm_source=x&id=2');
    expect(LinkSafety.clean(wrapped)).toBe('https://example.com/a?id=2');
  });

  it('describe() says what it did, so the user can be told', () => {
    const d = LinkSafety.describe('https://www.google.com/url?q=' + encodeURIComponent('http://example.com/a?fbclid=z'));
    expect(d).toMatchObject({ wrapped: true, tracked: true, host: 'example.com', insecure: true, clean: 'http://example.com/a' });
  });
});

describe('an address pretending to be a familiar one', () => {
  it('spots a swapped character, a bolted-on name and the wrong ending', () => {
    expect(LinkSafety.lookalike('paypa1.com')).toMatchObject({ looksLike: 'paypal.com' });
    expect(LinkSafety.lookalike('g00gle.com')).toMatchObject({ looksLike: 'google.com' });
    expect(LinkSafety.lookalike('github-support.co')).toMatchObject({ looksLike: 'github.com' });
    expect(LinkSafety.lookalike('secure-paypal.net')).toMatchObject({ looksLike: 'paypal.com' });
    expect(LinkSafety.lookalike('paypal.security')).toMatchObject({ looksLike: 'paypal.com', why: expect.stringContaining('ending does not') });
    expect(LinkSafety.lookalike('xn--80ak6aa92e.com')).toMatchObject({ looksLike: null, why: expect.stringContaining('another alphabet') });
  });

  it('never warns about the real thing, its subdomains, or an unrelated site', () => {
    for (const ok of ['github.com', 'www.github.com', 'docs.github.com', 'gist.github.com', 'example.com', 'vex.dev', 'news.ycombinator.com', 'roblox.com']) {
      expect(LinkSafety.lookalike(ok), ok).toBe(null);
    }
  });
});

describe('the warning bar', () => {
  const warn = { host: 'paypa1.com', looksLike: 'paypal.com', why: 'It reads as paypal.com.' };

  it('says what is wrong and offers a way out, once per host', () => {
    const webview = { canGoBack: () => true, goBack: vi.fn() };
    expect(LinkSafety.warnOnce(warn, webview)).toBe(true);
    const bar = document.querySelector('.lookalike-warn');
    expect(bar.textContent).toContain('This is not paypal.com');
    expect(bar.textContent).toContain('You are on paypa1.com');
    expect(VexProblems.note).toHaveBeenCalledWith('Link safety', 'Visited a lookalike address: paypa1.com', warn.why);

    expect(LinkSafety.warnOnce(warn, webview)).toBe(false);          // not again this session
    bar.querySelector('.lw-leave').click();
    expect(webview.goBack).toHaveBeenCalled();
    expect(document.querySelector('.lookalike-warn')).toBe(null);
  });

  it('does not block — staying is one click', () => {
    LinkSafety.warnOnce(warn, { canGoBack: () => false });
    document.querySelectorAll('.lookalike-warn .lw-btn')[1].click();
    expect(document.querySelector('.lookalike-warn')).toBe(null);
  });
});

describe('where a link really goes', () => {
  it('follows a shortener to its end, strips the tracking, and flags a lookalike', async () => {
    window.vex = { checkLinks: vi.fn(async () => ({ ok: true, results: [{ url: 'https://bit.ly/x', status: 200, verdict: 'ok', finalUrl: 'https://paypa1.com/login?utm_source=mail', redirected: true }] })) };
    const r = await LinkSafety.follow('https://bit.ly/x');
    expect(window.vex.checkLinks).toHaveBeenCalledWith(['https://bit.ly/x']);
    expect(r.moved).toBe(true);
    expect(r.final.clean).toBe('https://paypa1.com/login');
    expect(r.final.lookalike.looksLike).toBe('paypal.com');
  });

  it('a link that goes where it says is said to', async () => {
    window.vex = { checkLinks: async () => ({ ok: true, results: [{ url: 'https://example.com/', status: 200, verdict: 'ok', finalUrl: 'https://example.com/' }] }) };
    expect((await LinkSafety.follow('https://example.com/')).moved).toBe(false);
  });

  it('only web links, and a failed check is said', async () => {
    await expect(LinkSafety.follow('mailto:a@b.c')).rejects.toThrow(/Only web links/);
    window.vex = { checkLinks: async () => ({ ok: false, error: 'offline' }) };
    await expect(LinkSafety.follow('https://example.com/')).rejects.toThrow(/offline/);
  });
});
