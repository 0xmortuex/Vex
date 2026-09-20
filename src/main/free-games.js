// === What is free to keep this week ========================================
//
// Epic gives a game away every week and takes the offer down again seven days
// later; Steam does the same occasionally. Both are easy to miss, and both
// publish the list openly — no account, no key, no scraping. This reads those
// two lists and turns them into one: what is free now, and what is free next.
//
// Only the offers that make a game yours to keep count. A 90%-off sale is a
// sale, not a free game, and saying otherwise would make the list worthless.
const EPIC = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US';
const STEAM = 'https://store.steampowered.com/api/featuredcategories?cc=us&l=en';

const at = (value) => { const t = Date.parse(String(value || '')); return Number.isFinite(t) ? t : null; };

// Epic's shape: every element carries its promotions, current and upcoming,
// each with a discount setting. 0% of the price is what "free" means here.
function fromEpic(json) {
  const elements = (((json || {}).data || {}).Catalog || {}).searchStore;
  const list = (elements && Array.isArray(elements.elements)) ? elements.elements : [];
  const out = [];
  for (const el of list) {
    const promos = (el && el.promotions) || {};
    for (const [group, upcoming] of [[promos.promotionalOffers, false], [promos.upcomingPromotionalOffers, true]]) {
      for (const wrap of Array.isArray(group) ? group : []) {
        for (const offer of (wrap && Array.isArray(wrap.promotionalOffers)) ? wrap.promotionalOffers : []) {
          const percent = offer && offer.discountSetting && offer.discountSetting.discountPercentage;
          if (percent !== 0) continue;                 // a sale is not a giveaway
          const slug = el.productSlug
            || (el.catalogNs && Array.isArray(el.catalogNs.mappings) && el.catalogNs.mappings[0] && el.catalogNs.mappings[0].pageSlug)
            || (Array.isArray(el.offerMappings) && el.offerMappings[0] && el.offerMappings[0].pageSlug)
            || '';
          out.push({
            store: 'Epic',
            title: String(el.title || 'Untitled'),
            url: slug ? 'https://store.epicgames.com/en-US/p/' + String(slug).replace(/^\/+/, '') : 'https://store.epicgames.com/en-US/free-games',
            image: (Array.isArray(el.keyImages) ? (el.keyImages.find(i => i && /Thumbnail|OfferImageWide|DieselStoreFrontWide/.test(i.type)) || el.keyImages[0]) : null)?.url || '',
            from: at(offer.startDate),
            until: at(offer.endDate),
            upcoming,
          });
        }
      }
    }
  }
  return out;
}

// Steam's featured lists. Only 100% off is free to keep; everything else in
// that list is an ordinary sale.
function fromSteam(json) {
  const items = (((json || {}).specials || {}).items) || [];
  return (Array.isArray(items) ? items : [])
    .filter(i => i && i.discount_percent === 100)
    .map(i => ({
      store: 'Steam',
      title: String(i.name || 'Untitled'),
      url: 'https://store.steampowered.com/app/' + i.id,
      image: String(i.header_image || i.large_capsule_image || ''),
      from: null,
      until: at(i.discount_expiration ? new Date(i.discount_expiration * 1000).toISOString() : null),
      upcoming: false,
    }));
}

// Now first, then what is coming, each soonest-first. A game listed twice (it
// happens when Epic re-runs an offer) appears once.
function merge(epic, steam, now = Date.now()) {
  const all = [...fromEpic(epic), ...fromSteam(steam)];
  const seen = new Set();
  const out = [];
  for (const game of all) {
    const key = game.store + '::' + game.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // An offer whose end has passed is over, whatever the list still says.
    if (game.until && game.until < now) continue;
    game.live = !game.upcoming && (!game.from || game.from <= now);
    out.push(game);
  }
  // Free now first, and among those the one about to disappear first — that
  // is the one worth knowing about. Then what is coming, soonest first.
  const far = Number.MAX_SAFE_INTEGER;
  out.sort((a, b) =>
    (a.live ? 0 : 1) - (b.live ? 0 : 1)
    || (a.live ? (a.until || far) - (b.until || far) : (a.from || far) - (b.from || far))
    || a.title.localeCompare(b.title));
  return out;
}

// How long is left, in the words someone would actually use.
function endsIn(game, now = Date.now()) {
  if (game.upcoming || !game.live) {
    if (!game.from) return 'coming soon';
    const days = Math.round((game.from - now) / 86400000);
    return days <= 0 ? 'later today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days';
  }
  if (!game.until) return 'free now';
  const hours = Math.round((game.until - now) / 3600000);
  if (hours <= 0) return 'gone';
  if (hours < 24) return hours + ' hour' + (hours === 1 ? '' : 's') + ' left';
  const days = Math.round(hours / 24);
  return days + ' day' + (days === 1 ? '' : 's') + ' left';
}

module.exports = { merge, fromEpic, fromSteam, endsIn, EPIC, STEAM };
