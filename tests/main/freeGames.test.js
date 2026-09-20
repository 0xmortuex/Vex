// What is free to keep. The one thing this must never do is call a sale a
// giveaway: a 90%-off game is not free, and a list that says otherwise is
// worse than no list.
import { describe, it, expect } from 'vitest';
const { merge, fromEpic, fromSteam, endsIn } = require('../../src/main/free-games.js');

const NOW = Date.UTC(2026, 8, 20, 12);
const iso = (ms) => new Date(ms).toISOString();

const epicWith = (offers) => ({ data: { Catalog: { searchStore: { elements: offers } } } });
const game = (title, percent, { start = NOW - 86400000, end = NOW + 3 * 86400000, upcoming = false, slug = 'a-game' } = {}) => ({
  title,
  productSlug: slug,
  keyImages: [{ type: 'Thumbnail', url: 'https://img.example/' + slug + '.jpg' }],
  promotions: {
    [upcoming ? 'upcomingPromotionalOffers' : 'promotionalOffers']: [{
      promotionalOffers: [{ startDate: iso(start), endDate: iso(end), discountSetting: { discountPercentage: percent } }],
    }],
  },
});

describe('reading Epic’s list', () => {
  it('takes the giveaways and leaves the sales', () => {
    const out = fromEpic(epicWith([game('Free One', 0), game('Half Price', 50), game('Nearly Free', 10)]));
    expect(out.map(g => g.title)).toEqual(['Free One']);
    expect(out[0]).toMatchObject({ store: 'Epic', url: 'https://store.epicgames.com/en-US/p/a-game' });
  });

  it('keeps what is coming next, marked as coming', () => {
    const out = fromEpic(epicWith([game('Next Week', 0, { upcoming: true, start: NOW + 4 * 86400000 })]));
    expect(out[0]).toMatchObject({ title: 'Next Week', upcoming: true });
  });

  it('a game with no slug still links somewhere useful', () => {
    const g = game('No Slug', 0);
    delete g.productSlug;
    expect(fromEpic(epicWith([g]))[0].url).toBe('https://store.epicgames.com/en-US/free-games');
  });

  it('a broken or empty answer is an empty list, not a crash', () => {
    expect(fromEpic(null)).toEqual([]);
    expect(fromEpic({ data: {} })).toEqual([]);
    expect(fromEpic(epicWith([{ title: 'No promos' }]))).toEqual([]);
  });
});

describe('reading Steam’s list', () => {
  const steam = (items) => ({ specials: { items } });

  it('only 100% off is free to keep', () => {
    const out = fromSteam(steam([
      { name: 'Free Steam Game', id: 1, discount_percent: 100 },
      { name: 'Big Sale', id: 2, discount_percent: 90 },
    ]));
    expect(out.map(g => g.title)).toEqual(['Free Steam Game']);
    expect(out[0].url).toBe('https://store.steampowered.com/app/1');
  });

  it('a store that answered with nothing gives nothing', () => {
    expect(fromSteam(null)).toEqual([]);
    expect(fromSteam({})).toEqual([]);
  });
});

describe('the list you actually see', () => {
  it('free now first — soonest to disappear at the top — then what is coming', () => {
    const out = merge(epicWith([
      game('Later', 0, { upcoming: true, start: NOW + 5 * 86400000 }),
      game('Ends in three days', 0, { slug: 'three', end: NOW + 3 * 86400000 }),
      game('Ends tomorrow', 0, { slug: 'one', end: NOW + 86400000 }),
    ]), { specials: { items: [{ name: 'Steam, no end date given', id: 5, discount_percent: 100 }] } }, NOW);
    expect(out.map(g => g.title)).toEqual(['Ends tomorrow', 'Ends in three days', 'Steam, no end date given', 'Later']);
    expect(out[0].live).toBe(true);
    expect(out[3].live).toBe(false);
  });

  it('an offer that has already ended is left out', () => {
    const out = merge(epicWith([game('Gone', 0, { start: NOW - 10 * 86400000, end: NOW - 86400000 })]), null, NOW);
    expect(out).toEqual([]);
  });

  it('the same game listed twice appears once', () => {
    const out = merge(epicWith([game('Twice', 0), game('Twice', 0)]), null, NOW);
    expect(out).toHaveLength(1);
  });

  it('one store failing still gives the other store’s list', () => {
    expect(merge(epicWith([game('Epic One', 0)]), null, NOW)).toHaveLength(1);
    expect(merge(null, { specials: { items: [{ name: 'Steam One', id: 9, discount_percent: 100 }] } }, NOW)).toHaveLength(1);
  });
});

describe('how long is left', () => {
  it('says it the way a person would', () => {
    expect(endsIn({ live: true, until: NOW + 3 * 86400000 }, NOW)).toBe('3 days left');
    expect(endsIn({ live: true, until: NOW + 5 * 3600000 }, NOW)).toBe('5 hours left');
    expect(endsIn({ live: true, until: null }, NOW)).toBe('free now');
    expect(endsIn({ live: false, upcoming: true, from: NOW + 86400000 }, NOW)).toBe('tomorrow');
    expect(endsIn({ live: false, upcoming: true, from: NOW + 4 * 86400000 }, NOW)).toBe('in 4 days');
  });
});
