// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
// Loaded first, exactly as index.html orders the script tags: the consumers
// resolve the helper through window.CollectionStore, which this import installs.
import '../../src/renderer/js/collection-store.js';

// Two Vex windows share one session, so they share localStorage. Each module
// keeps its list in memory, so "the other window" is simulated by writing to
// localStorage behind this window's back and then saving a stale in-memory list.
beforeEach(() => localStorage.clear());

describe('cross-window collection writes', () => {
  it('keeps another window\'s bookmark when this window saves a stale list', async () => {
    const { Bookmarks } = await import('../../src/renderer/js/bookmarks.js');
    localStorage.setItem('vex.bookmarks', JSON.stringify([{ id: 'a', url: 'https://a.test' }]));
    Bookmarks.init();

    // Another window bookmarks something after we loaded.
    localStorage.setItem('vex.bookmarks', JSON.stringify([
      { id: 'b', url: 'https://b.test' },
      { id: 'a', url: 'https://a.test' },
    ]));

    // This window bookmarks something too, from its now-stale list.
    Bookmarks.items.unshift({ id: 'c', url: 'https://c.test' });
    Bookmarks.save();

    const saved = JSON.parse(localStorage.getItem('vex.bookmarks'));
    expect(saved.map(b => b.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('still applies this window\'s deletion without resurrecting it', async () => {
    const { Bookmarks } = await import('../../src/renderer/js/bookmarks.js');
    localStorage.setItem('vex.bookmarks', JSON.stringify([
      { id: 'a', url: 'https://a.test' },
      { id: 'keep', url: 'https://keep.test' },
    ]));
    Bookmarks.init();

    localStorage.setItem('vex.bookmarks', JSON.stringify([
      { id: 'b', url: 'https://b.test' },
      { id: 'a', url: 'https://a.test' },
      { id: 'keep', url: 'https://keep.test' },
    ]));

    Bookmarks.items = Bookmarks.items.filter(b => b.id !== 'a');
    Bookmarks.save();

    const saved = JSON.parse(localStorage.getItem('vex.bookmarks'));
    expect(saved.map(b => b.id).sort()).toEqual(['b', 'keep']);
  });

  it('keeps another window\'s Read Later article', async () => {
    const { ReadLater } = await import('../../src/renderer/js/readlater.js');
    localStorage.setItem('vex.readLater', JSON.stringify([{ id: 'r1', url: 'https://one.test', read: false }]));
    ReadLater.init();

    localStorage.setItem('vex.readLater', JSON.stringify([
      { id: 'r2', url: 'https://two.test', read: false },
      { id: 'r1', url: 'https://one.test', read: false },
    ]));

    ReadLater.items.unshift({ id: 'r3', url: 'https://three.test', read: false });
    ReadLater.save();

    expect(JSON.parse(localStorage.getItem('vex.readLater')).map(i => i.id).sort()).toEqual(['r1', 'r2', 'r3']);
  });

  it('propagates an edit this window made to a shared record', async () => {
    const { ReadLater } = await import('../../src/renderer/js/readlater.js');
    localStorage.setItem('vex.readLater', JSON.stringify([{ id: 'r1', url: 'https://one.test', read: false }]));
    ReadLater.init();

    localStorage.setItem('vex.readLater', JSON.stringify([
      { id: 'r2', url: 'https://two.test', read: false },
      { id: 'r1', url: 'https://one.test', read: false },
    ]));

    ReadLater.items.find(i => i.id === 'r1').read = true;
    ReadLater.save();

    const saved = JSON.parse(localStorage.getItem('vex.readLater'));
    expect(saved.find(i => i.id === 'r1').read).toBe(true);
    expect(saved.find(i => i.id === 'r2')).toBeTruthy();
  });

  it('does not duplicate records across repeated saves', async () => {
    const { CollectionStore } = await import('../../src/renderer/js/collection-store.js');
    localStorage.setItem('vex.dup', JSON.stringify([{ id: 'x' }]));
    let baseline = [{ id: 'x' }];
    let mine = [{ id: 'y' }, { id: 'x' }];
    for (let i = 0; i < 3; i++) {
      mine = CollectionStore.save('vex.dup', baseline, mine);
      baseline = mine.slice();
    }
    expect(JSON.parse(localStorage.getItem('vex.dup')).map(r => r.id)).toEqual(['y', 'x']);
  });
});

describe('cross-window annotation writes', () => {
  it('keeps another window\'s highlight on the same page', async () => {
    const { Annotations } = await import('../../src/renderer/js/annotations.js');
    const page = 'https://doc.test/a';
    localStorage.setItem('vex.annotations', JSON.stringify({ [page]: [{ id: 'h1', text: 'one' }] }));
    Annotations.init();

    localStorage.setItem('vex.annotations', JSON.stringify({
      [page]: [{ id: 'h1', text: 'one' }, { id: 'h2', text: 'two' }],
      'https://other.test/b': [{ id: 'h9', text: 'elsewhere' }],
    }));

    Annotations.store[page].push({ id: 'h3', text: 'three' });
    Annotations.save();

    const saved = JSON.parse(localStorage.getItem('vex.annotations'));
    expect(saved[page].map(h => h.id).sort()).toEqual(['h1', 'h2', 'h3']);
    expect(saved['https://other.test/b'].map(h => h.id)).toEqual(['h9']);
  });

  it('removes only this window\'s highlight when it empties a page', async () => {
    const { Annotations } = await import('../../src/renderer/js/annotations.js');
    const page = 'https://doc.test/c';
    localStorage.setItem('vex.annotations', JSON.stringify({ [page]: [{ id: 'mine', text: 'x' }] }));
    Annotations.init();

    // Another window highlighted the same page after we loaded.
    localStorage.setItem('vex.annotations', JSON.stringify({
      [page]: [{ id: 'mine', text: 'x' }, { id: 'theirs', text: 'y' }],
    }));

    // We delete our last highlight, which drops the page key locally.
    Annotations.store[page] = Annotations.store[page].filter(h => h.id !== 'mine');
    if (!Annotations.store[page].length) delete Annotations.store[page];
    Annotations.save();

    const saved = JSON.parse(localStorage.getItem('vex.annotations'));
    expect(saved[page].map(h => h.id)).toEqual(['theirs']);
  });

  it('drops the page entirely when nothing remains', async () => {
    const { Annotations } = await import('../../src/renderer/js/annotations.js');
    const page = 'https://doc.test/d';
    localStorage.setItem('vex.annotations', JSON.stringify({ [page]: [{ id: 'only', text: 'x' }] }));
    Annotations.init();
    delete Annotations.store[page];
    Annotations.save();
    expect(JSON.parse(localStorage.getItem('vex.annotations'))[page]).toBeUndefined();
  });
});

describe('cross-window archive writes', () => {
  it('keeps another window\'s archived tab when this window archives', async () => {
    const { TabArchiver } = await import('../../src/renderer/js/readlater.js');
    const baseline = [{ id: 'ar1', url: 'https://one.test' }];
    localStorage.setItem('vex.archivedTabs', JSON.stringify(baseline));

    // Another window archives something between our read and our write.
    localStorage.setItem('vex.archivedTabs', JSON.stringify([
      { id: 'ar2', url: 'https://two.test' },
      { id: 'ar1', url: 'https://one.test' },
    ]));

    TabArchiver._save([{ id: 'ar3', url: 'https://three.test' }, ...baseline], baseline);
    expect(JSON.parse(localStorage.getItem('vex.archivedTabs')).map(a => a.id).sort()).toEqual(['ar1', 'ar2', 'ar3']);
  });

  it('applies a removal and still honours the 200 entry cap', async () => {
    const { TabArchiver } = await import('../../src/renderer/js/readlater.js');
    const many = Array.from({ length: 205 }, (_, i) => ({ id: 'ar' + i, url: 'https://x.test/' + i }));
    localStorage.setItem('vex.archivedTabs', JSON.stringify(many));
    TabArchiver.remove({ id: 'ar0' });
    const saved = JSON.parse(localStorage.getItem('vex.archivedTabs'));
    expect(saved.length).toBe(200);
    expect(saved.some(a => a.id === 'ar0')).toBe(false);
  });
});

it('loads collection-store.js before every module that depends on it', async () => {
  const { readFileSync } = await import('node:fs');
  // jsdom gives import.meta.url an http: URL, so resolve from the project root.
  const html = readFileSync(process.cwd() + '/src/renderer/index.html', 'utf8');
  const order = [...html.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map(m => m[1]);
  const helper = order.indexOf('collection-store.js');
  expect(helper).toBeGreaterThanOrEqual(0);
  // A consumer loaded first would call window.CollectionStore.save on undefined
  // and every write would throw, silently losing the user's change.
  for (const consumer of ['bookmarks.js', 'readlater.js', 'annotations.js']) {
    const at = order.indexOf(consumer);
    expect(at, consumer + ' must be listed in index.html').toBeGreaterThanOrEqual(0);
    expect(at, consumer + ' must load after collection-store.js').toBeGreaterThan(helper);
  }
});
