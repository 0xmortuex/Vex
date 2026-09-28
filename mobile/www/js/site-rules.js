// === Vex Mobile — rules for one site ===
//
// The desktop app has src/main/site-rules.js: switches that apply to a single
// site and survive restarts — JavaScript off for a page that will not stop
// moving, images off on a metered connection, dark forced on a site that only
// ships a white theme, desktop layout for a site whose mobile version hides
// half the page.
//
// A rule is only stored when it differs from the default, so "reset" is a
// delete and the store stays small. Rules are keyed by registrable-ish host
// (news.bbc.co.uk and bbc.co.uk are different keys — a rule you set on one
// subdomain should not silently apply to another).

const VexSiteRules = (() => {
  const DEFAULTS = {
    scripts: true,
    images: true,
    dark: null,        // null = follow the global setting
    desktop: null,
    blocking: true,
    zoom: 1
  };

  function all() {
    const stored = VexStore.get('vex.siteRules', {});
    return stored && typeof stored === 'object' ? stored : {};
  }

  function hostOf(url) {
    return VexSearch.prettyHost(url);
  }

  return {
    DEFAULTS,
    hostOf,

    // What applies to this host, defaults filled in.
    for(host) {
      return Object.assign({}, DEFAULTS, all()[host] || {});
    },

    // Only the rules that have actually been set, for "this site is customised"
    // badges and the reset button.
    customised(host) {
      const rules = all()[host];
      return rules ? Object.keys(rules) : [];
    },

    async set(host, key, value) {
      if (!host || !(key in DEFAULTS)) return null;
      const rules = all();
      const entry = Object.assign({}, rules[host]);
      if (value === DEFAULTS[key] || value === null) delete entry[key];
      else entry[key] = value;
      if (Object.keys(entry).length) rules[host] = entry;
      else delete rules[host];
      await VexStore.set('vex.siteRules', rules);
      return this.for(host);
    },

    async reset(host) {
      const rules = all();
      delete rules[host];
      await VexStore.set('vex.siteRules', rules);
      return this.for(host);
    },

    // Push a tab's rules down to its WebView. Called when a tab is created,
    // when it lands on a new host, and when a rule changes.
    async applyTo(tab) {
      if (!tab || !tab.url) return null;
      const host = hostOf(tab.url);
      const rules = this.for(host);
      const globalDark = VexStore.get('vex.darkPages', false);
      const globalDesktop = VexStore.get('vex.desktopDefault', false);

      const dark = rules.dark === null ? globalDark : rules.dark;
      const desktop = rules.desktop === null ? globalDesktop : rules.desktop;

      await VexBridge.setScriptsEnabled(tab.id, rules.scripts);
      await VexBridge.setImagesEnabled(tab.id, rules.images && !VexStore.get('vex.dataSaver', false));
      await VexBridge.setDarkMode(tab.id, dark);
      if (desktop !== tab.desktopMode) {
        await VexBridge.setDesktopMode(tab.id, desktop);
        tab.desktopMode = desktop;
      }
      if (rules.zoom !== 1) await VexBridge.setZoom(tab.id, rules.zoom);
      await VexBlock.setSiteAllowed(host, !rules.blocking);
      return rules;
    },

    // A one-line summary for the site sheet: "JavaScript off · no images".
    describe(host) {
      const rules = this.for(host);
      const parts = [];
      if (!rules.scripts) parts.push('JavaScript off');
      if (!rules.images) parts.push('no images');
      if (rules.dark === true) parts.push('forced dark');
      if (rules.desktop === true) parts.push('desktop layout');
      if (!rules.blocking) parts.push('blocking off');
      if (rules.zoom !== 1) parts.push(Math.round(rules.zoom * 100) + '% text');
      return parts.length ? parts.join(' · ') : 'Default settings';
    }
  };
})();

if (typeof window !== 'undefined') window.VexSiteRules = VexSiteRules;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSiteRules };
