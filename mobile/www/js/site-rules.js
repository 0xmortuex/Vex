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
  // Injected after each load. Three things Samsung Internet has that a
  // WebView does not give you for free: pinch zoom on sites that forbid it,
  // a contrast lift for a page that is grey text on grey, and a warm shade
  // for reading at night.
  function presentationScript() {
    const forceZoom = VexStore.get('vex.forceZoom', true) !== false;
    const contrast = Number(VexStore.get('vex.pageContrast', 1)) || 1;
    const shade = Number(VexStore.get('vex.nightShade', 0)) || 0;
    if (!forceZoom && contrast === 1 && !shade) return '';
    return `(function(){
  if (${forceZoom}) {
    var meta = document.querySelector('meta[name=viewport]');
    if (meta) meta.setAttribute('content',
      meta.content.replace(/user-scalable\\s*=\\s*(no|0)/gi, 'user-scalable=yes')
                  .replace(/maximum-scale\\s*=\\s*[\\d.]+/gi, 'maximum-scale=10'));
  }
  var filters = [];
  if (${contrast} !== 1) filters.push('contrast(${contrast})');
  if (${shade} > 0) filters.push('sepia(${shade}) saturate(1.1) brightness(' + (1 - ${shade} * 0.15) + ')');
  var id = 'vex-presentation';
  var style = document.getElementById(id);
  if (!filters.length) { if (style) style.remove(); return; }
  if (!style) {
    style = document.createElement('style');
    style.id = id;
    (document.head || document.documentElement).appendChild(style);
  }
  style.textContent = 'html{filter:' + filters.join(' ') + ' !important}';
})()`;
  }

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
    presentationScript,

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

      const presentation = presentationScript();
      if (presentation) {
        try { await VexBridge.evaluate(tab.id, presentation); }
        catch { /* a page with scripts off cannot be adjusted */ }
      }
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
