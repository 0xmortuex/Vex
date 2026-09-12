// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../src/renderer/js/collection-store.js';
import { VexFeeds } from '../../src/renderer/js/rss.js';
import { Annotations } from '../../src/renderer/js/annotations.js';

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Test Feed</title>
  <item><title>One</title><link>https://example.test/1</link><pubDate>Mon, 01 Sep 2025 10:00:00 GMT</pubDate></item>
  <item><title>Two</title><link>https://example.test/2</link><pubDate>Tue, 02 Sep 2025 10:00:00 GMT</pubDate></item>
</channel></rss>`;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.showToast = vi.fn();
  window.vex = { rssFetch: vi.fn(async () => RSS) };
  VexFeeds.feeds = [];
  VexFeeds._renderToken = 0;
});

describe('feed URLs', () => {
  it('accepts a bare domain and rejects a non-http scheme', () => {
    expect(VexFeeds._normalizeUrl('example.test/feed')).toBe('https://example.test/feed');
    expect(VexFeeds._normalizeUrl('http://example.test/rss.xml')).toBe('http://example.test/rss.xml');
    // "javascript:alert(1)" used to become "https://javascript:alert(1)".
    expect(VexFeeds._normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(VexFeeds._normalizeUrl('file:///etc/passwd')).toBeNull();
    expect(VexFeeds._normalizeUrl('   ')).toBeNull();
  });

  it('drops duplicates and legacy string entries when loading', () => {
    localStorage.setItem('vex.feeds', JSON.stringify(['https://a.test/feed', { url: 'https://a.test/feed' }, { url: 'https://b.test/feed' }]));
    VexFeeds.init();
    expect(VexFeeds.feeds.map(f => f.url)).toEqual(['https://a.test/feed', 'https://b.test/feed']);
  });
});

describe('feed parsing', () => {
  it('raises rather than silently returning nothing for malformed XML', () => {
    expect(() => VexFeeds.parse('<rss><channel><item>')).toThrow(/valid XML/);
  });

  it('keeps only http(s) item links', () => {
    const hostile = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
      <item><title>bad</title><link>javascript:alert(1)</link></item>
      <item><title>good</title><link>https://ok.test/x</link></item></channel></rss>`;
    expect(VexFeeds.parse(hostile).map(i => i.title)).toEqual(['good']);
  });

  it('reads Atom entries as well as RSS items', () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atomic</title>
      <entry><title>A1</title><link rel="alternate" href="https://a.test/1"/><updated>2025-09-03T10:00:00Z</updated></entry></feed>`;
    const items = VexFeeds.parse(atom);
    expect(items).toHaveLength(1);
    expect(items[0].link).toBe('https://a.test/1');
  });
});

describe('fetching feeds', () => {
  it('reports a dead feed instead of making it look empty', async () => {
    VexFeeds.feeds = [{ url: 'https://ok.test/feed', title: 'Good' }, { url: 'https://dead.test/feed', title: 'Dead' }];
    window.vex.rssFetch = vi.fn(async (url) => (url.includes('dead') ? null : RSS));
    const { items, errors } = await VexFeeds.fetchAll();
    expect(items.map(i => i.title)).toEqual(['Two', 'One']);
    expect(errors).toEqual([{ url: 'https://dead.test/feed', title: 'Dead', error: 'could not be reached' }]);
  });

  it('surfaces a malformed feed as an error, not as zero items', async () => {
    VexFeeds.feeds = [{ url: 'https://bad.test/feed', title: 'Bad' }];
    window.vex.rssFetch = vi.fn(async () => '<not xml');
    const { errors } = await VexFeeds.fetchAll();
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toMatch(/valid XML/);
  });

  it('shows the failure in the panel', async () => {
    VexFeeds.feeds = [{ url: 'https://dead.test/feed', title: 'Dead' }];
    window.vex.rssFetch = vi.fn(async () => null);
    const container = document.createElement('div');
    document.body.appendChild(container);
    await VexFeeds.renderPanel(container);
    expect(container.querySelector('#feed-errors').textContent).toContain('could not be reached');
  });

  it('lets a newer repaint win over one that is still fetching', async () => {
    VexFeeds.feeds = [{ url: 'https://slow.test/feed', title: 'Slow' }];
    let release;
    window.vex.rssFetch = vi.fn(() => new Promise(resolve => { release = () => resolve(RSS); }));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const stale = VexFeeds.renderPanel(container);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    VexFeeds._renderToken++;                 // a newer repaint took over
    release();
    await stale;
    expect(container.querySelector('#feed-list').textContent).toContain('Loading…');
  });
});

describe('highlight page keys', () => {
  beforeEach(() => { Annotations.store = {}; Annotations._baseline = {}; });

  it('keeps two query-distinguished pages apart', () => {
    const a = 'https://www.youtube.com/watch?v=AAA';
    const b = 'https://www.youtube.com/watch?v=BBB';
    expect(Annotations._key(a)).not.toBe(Annotations._key(b));
    Annotations.store[Annotations._key(a)] = [{ id: 'h1', text: 'on A', at: 1 }];
    expect(Annotations.forUrl(a).map(h => h.id)).toEqual(['h1']);
    expect(Annotations.forUrl(b)).toEqual([]);
  });

  it('still finds highlights stored under the pre-query-string key', () => {
    const url = 'https://www.youtube.com/watch?v=AAA';
    Annotations.store[Annotations._legacyKey(url)] = [{ id: 'old', text: 'legacy', at: 1 }];
    expect(Annotations.forUrl(url).map(h => h.id)).toEqual(['old']);
    expect(Annotations._bucketFor(url, 'old')).toBe('https://www.youtube.com/watch');
  });

  it('prefers the precise bucket once the page has its own highlights', () => {
    const url = 'https://www.youtube.com/watch?v=AAA';
    Annotations.store[Annotations._legacyKey(url)] = [{ id: 'old', text: 'legacy', at: 1 }];
    Annotations.store[Annotations._key(url)] = [{ id: 'new', text: 'fresh', at: 2 }];
    expect(Annotations.forUrl(url).map(h => h.id)).toEqual(['new']);
    expect(Annotations._bucketFor(url, 'new')).toBe(Annotations._key(url));
  });

  it('deletes a legacy highlight from the bucket it actually lives in', async () => {
    const url = 'https://news.test/story?id=7';
    Annotations.store[Annotations._legacyKey(url)] = [{ id: 'old', text: 'legacy', at: 1 }];
    Annotations._baseline = window.CollectionStore.snapshotMap(Annotations.store);
    globalThis.WebviewManager = { getActiveWebview: () => null };
    globalThis.TabManager = { getActiveTab: () => null };
    await Annotations.remove(url, 'old');
    expect(Annotations.forUrl(url)).toEqual([]);
  });

  it('ignores the trailing slash but not the query', () => {
    expect(Annotations._key('https://a.test/path/')).toBe(Annotations._key('https://a.test/path'));
    expect(Annotations._key('https://a.test/path?x=1')).toBe('https://a.test/path?x=1');
  });
});
