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
    // Always returned, even with nothing to apply: turning the shade off has to
    // take it off the page in front, and returning nothing left it on until
    // the page was reloaded.
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
  var root = document.documentElement;
  if (!root) return;
  // Set through the CSSOM rather than a <style> element: a page whose
  // Content-Security-Policy forbids inline styles refuses the element, and
  // the shade did nothing there. An earlier build's element is taken away.
  var legacy = document.getElementById('vex-presentation');
  if (legacy) legacy.remove();
  if (!filters.length) {
    if (root.getAttribute('data-vex-filter') !== null) {
      root.style.removeProperty('filter');
      root.removeAttribute('data-vex-filter');
    }
    return;
  }
  root.style.setProperty('filter', filters.join(' '), 'important');
  root.setAttribute('data-vex-filter', '');
})()`;
  }

  /**
   * Copy Unlock — the desktop's (src/renderer/js/page-extras.js), for the
   * sites that stop you selecting or copying their text: user-select:none,
   * a selectstart handler, a copy handler that empties the clipboard.
   * Capture listeners stop the page's own blockers from hearing those events
   * without cancelling them, so the phone's own selection and copy still
   * work; the inline handlers are cleared for a while after load, because
   * sites put them back.
   */
  const COPY_UNLOCK = `(function(){try{
  if (window.__vexCopyUnlock) return; window.__vexCopyUnlock = true;
  var STOP = ['contextmenu','copy','cut','selectstart','dragstart','beforecopy'];
  STOP.forEach(function(type){
    try { document.addEventListener(type, function(e){ e.stopPropagation(); }, true); } catch(_){}
  });
  var PROPS = ['oncontextmenu','oncopy','oncut','onselectstart','ondragstart','onbeforecopy'];
  function clearOn(){
    var nodes = [document, document.documentElement, document.body];
    for (var n=0;n<nodes.length;n++){ if(!nodes[n]) continue;
      for (var p=0;p<PROPS.length;p++){ try{ nodes[n][PROPS[p]] = null; }catch(_){} } }
  }
  clearOn();
  var ticks=0; var iv=setInterval(function(){ clearOn(); if(++ticks>20){ try{clearInterval(iv);}catch(_){} } }, 500);
  var css='*,*::before,*::after{-webkit-user-select:auto!important;user-select:auto!important;-webkit-touch-callout:default!important;}html,body{-webkit-user-select:auto!important;user-select:auto!important;}';
  // A constructed sheet where there is one: a strict Content-Security-Policy
  // refuses a <style> element, and those are the sites most likely to lock
  // their text up. The element is the fallback.
  try {
    if (document.adoptedStyleSheets !== undefined && window.CSSStyleSheet) {
      var sheet = new CSSStyleSheet(); sheet.replaceSync(css);
      document.adoptedStyleSheets = document.adoptedStyleSheets.concat([sheet]);
      return;
    }
  } catch(_) {}
  var id='vex-copy-unlock-style';
  if(!document.getElementById(id)){
    var st=document.createElement('style'); st.id=id;
    st.textContent=css;
    (document.head||document.documentElement).appendChild(st);
  }
}catch(e){}})()`;

  const DEFAULTS = {
    scripts: true,
    images: true,
    dark: null,        // null = follow the global setting
    desktop: null,
    autoplay: null,    // null = follow the global setting, which is "ask for a tap"
    blocking: true,
    copy: false,       // true: Copy Unlock on every page of the site
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
    COPY_UNLOCK,

    /** Unlock the page in front once, whatever the site's rule. */
    async unlockCopy(tab) {
      if (!tab || !tab.url) return false;
      try { await VexBridge.evaluate(tab.id, COPY_UNLOCK); return true; }
      catch { return false; }
    },

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
      // 'theme' means "whenever the browser itself is dark", which on auto is
      // whenever the phone is — so going dark at sunset takes a site's white
      // page with it, without a clock in here.
      const darkMode = VexStore.get('vex.darkPages', false);
      const globalDark = darkMode === 'theme' ? VexTheme.isDark() : darkMode === true;
      const globalDesktop = VexStore.get('vex.desktopDefault', false);

      const dark = rules.dark === null ? globalDark : rules.dark;
      const desktop = rules.desktop === null ? globalDesktop : rules.desktop;
      const autoplay = rules.autoplay === null ? VexStore.get('vex.autoplay', false) === true : rules.autoplay;

      await VexBridge.setScriptsEnabled(tab.id, rules.scripts);
      await VexBridge.setImagesEnabled(tab.id, rules.images && !VexStore.get('vex.dataSaver', false));
      await VexBridge.setAutoplayAllowed(tab.id, autoplay);
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
      if (rules.copy === true) await this.unlockCopy(tab);
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
      if (rules.autoplay === true) parts.push('autoplay allowed');
      if (rules.autoplay === false) parts.push('no autoplay');
      if (!rules.blocking) parts.push('blocking off');
      if (rules.copy === true) parts.push('copying unlocked');
      if (rules.zoom !== 1) parts.push(Math.round(rules.zoom * 100) + '% text');
      return parts.length ? parts.join(' · ') : 'Default settings';
    }
  };
})();

if (typeof window !== 'undefined') window.VexSiteRules = VexSiteRules;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSiteRules };
