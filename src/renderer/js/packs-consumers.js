// === Vex Packs: who reads each kind of item ==================================
//
// A pack is declarative data (main/packs.js). Nothing in it is code. This file
// hands the items of the packs that are installed AND switched on to the
// features that know how to show them, each through a small in-memory setter on
// that feature:
//
//   aliases             VexAliases.setPackEntries        (the person's own word wins)
//   readability-preset  SiteReadability.setPackPresets   (not in private / Tor / routed tabs)
//   page-action         PageActions.setPackScripts       (master switch, exact origin,
//                                                         chosen by the person, never automatic)
//   brief-section       BriefIntegration.setPackSections (text, https links; page-bound
//                                                         templates only from a normal tab)
//   quotes (fortune)    VexFortune.setPackLines
//   quotes (quote)      VexWidgets.setPackQuotes
//   sticker             StickerSheet.setPackStickers     (drawn as an image)
//   medal-frame         VexCosmetics.setPackFrames       (drawn as an image)
//   theme, chain        js/packs-ui.js itself            (theme list, Ctrl+K chains)
//
// Pack data is never written into a feature's own storage: switch the pack off
// or remove it and the feature goes back to exactly its own data. A private
// window gets no items at all (VexPacks.items() is empty there). A type whose
// consumer is not in this build is left alone and listed by status().
const VexPackConsumers = {
  TYPES: ['theme', 'chain', 'page-action', 'brief-section', 'readability-preset', 'sticker', 'medal-frame', 'aliases', 'quotes'],

  // type -> true when something in this build reads it.
  _consumers() {
    return {
      theme: typeof VexPacks !== 'undefined',
      chain: typeof VexPacks !== 'undefined' && typeof CommandChains !== 'undefined',
      'page-action': typeof PageActions !== 'undefined' && typeof PageActions.setPackScripts === 'function',
      'brief-section': typeof BriefIntegration !== 'undefined' && typeof BriefIntegration.setPackSections === 'function',
      'readability-preset': typeof SiteReadability !== 'undefined' && typeof SiteReadability.setPackPresets === 'function',
      sticker: typeof StickerSheet !== 'undefined' && typeof StickerSheet.setPackStickers === 'function',
      'medal-frame': typeof VexCosmetics !== 'undefined' && typeof VexCosmetics.setPackFrames === 'function',
      aliases: typeof VexAliases !== 'undefined' && typeof VexAliases.setPackEntries === 'function',
      quotes: (typeof VexFortune !== 'undefined' && typeof VexFortune.setPackLines === 'function')
        || (typeof VexWidgets !== 'undefined' && typeof VexWidgets.setPackQuotes === 'function'),
    };
  },

  // Which types are read, and which are inert in this build.
  status() {
    const c = this._consumers();
    return { consumed: this.TYPES.filter(t => c[t]), inert: this.TYPES.filter(t => !c[t]) };
  },

  apply() {
    if (typeof VexPacks === 'undefined' || typeof VexPacks.items !== 'function') return null;
    const of = (type) => VexPacks.items(type);
    const out = {};
    const run = (name, fn) => { try { out[name] = fn(); } catch (err) { console.error('[PackConsumers] ' + name + ' failed:', err); out[name] = -1; } };

    if (typeof VexAliases !== 'undefined' && typeof VexAliases.setPackEntries === 'function') {
      run('aliases', () => VexAliases.setPackEntries(of('aliases').flatMap(x => x.item.entries)));
    }
    if (typeof SiteReadability !== 'undefined' && typeof SiteReadability.setPackPresets === 'function') {
      run('readability-preset', () => {
        const n = SiteReadability.setPackPresets(of('readability-preset').map(x => x.item));
        if (typeof SiteReadability.refreshAll === 'function') SiteReadability.refreshAll();
        return n;
      });
    }
    if (typeof PageActions !== 'undefined' && typeof PageActions.setPackScripts === 'function') {
      run('page-action', () => PageActions.setPackScripts(of('page-action').map(x => ({
        id: x.packId + ':' + x.item.id, name: x.item.name, origin: x.item.origin, source: x.item.source, packName: x.packName,
      }))));
    }
    if (typeof BriefIntegration !== 'undefined' && typeof BriefIntegration.setPackSections === 'function') {
      run('brief-section', () => BriefIntegration.setPackSections(of('brief-section')));
    }
    const quotes = of('quotes');
    if (typeof VexFortune !== 'undefined' && typeof VexFortune.setPackLines === 'function') {
      run('fortune', () => VexFortune.setPackLines(quotes.filter(x => x.item.kind === 'fortune').flatMap(x => x.item.entries)));
    }
    if (typeof VexWidgets !== 'undefined' && typeof VexWidgets.setPackQuotes === 'function') {
      run('quote', () => VexWidgets.setPackQuotes(quotes.filter(x => x.item.kind === 'quote').flatMap(x => x.item.entries)));
    }
    if (typeof StickerSheet !== 'undefined' && typeof StickerSheet.setPackStickers === 'function') {
      run('sticker', () => StickerSheet.setPackStickers(of('sticker').map(x => ({ id: x.packId + ':' + x.item.id, name: x.item.name, svg: x.item.svg }))));
    }
    if (typeof VexCosmetics !== 'undefined' && typeof VexCosmetics.setPackFrames === 'function') {
      run('medal-frame', () => VexCosmetics.setPackFrames(of('medal-frame').map(x => ({ id: x.packId + ':' + x.item.id, name: x.item.name, svg: x.item.svg, packName: x.packName }))));
    }
    return out;
  },

  _wired: false,
  init() {
    if (this._wired || typeof VexPacks === 'undefined' || typeof VexPacks.onChange !== 'function') return false;
    this._wired = true;
    VexPacks.onChange(() => this.apply());
    this.apply();
    return true;
  },
};

if (typeof window !== 'undefined') window.VexPackConsumers = VexPackConsumers;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPackConsumers };
