// === Recipe, trip and docs layouts for reader view ==========================
//
// Reader view (js/reading-mode.js) turns an article into clean text. Some
// pages are not articles: a recipe is a list to cook from, a trip a list of
// places to go, a documentation page a list of things to get through. Those
// pages say what they are — recipes, trips and technical docs publish
// schema.org JSON-LD for search engines — so when the page does, reader view
// puts the structure on top as a checklist you can tick:
//
//   Recipe        ingredients and method, with time and servings
//   Trip          the itinerary (or the places) in order
//   Docs / HowTo  the steps, and the page's own outline
//
// The ordinary article text stays underneath, folded, unless you turn that
// off in Settings. A page with no such data is read exactly as before.
// Everything that comes out of a page is plain data and is escaped when drawn;
// the ticks live in the reader page only and are gone when it closes.
const VexReaderKinds = {
  KEY: 'vex.readerKinds',
  DEFAULT_PREFS: { recipe: true, travel: true, docs: true, keepArticle: true },
  MAX_ITEMS: 120,
  KINDS: { recipe: 'Recipe', travel: 'Trip', docs: 'Documentation' },

  // Runs in the page: the JSON-LD blocks and the headings, as plain data.
  PROBE_SCRIPT: `(() => {
    const ld = [];
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      const t = s.textContent || '';
      if (t.length < 400000 && ld.length < 10) ld.push(t);
    }
    const headings = [];
    const root = document.querySelector('main, article, [role="main"]') || document.body;
    for (const h of (root ? root.querySelectorAll('h2, h3, h4') : [])) {
      if (headings.length >= 80) break;
      const cs = getComputedStyle(h);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const text = (h.textContent || '').replace(/\\s+/g, ' ').trim();
      if (text && text.length < 160) headings.push({ level: Number(h.tagName[1]), text });
    }
    return { ld, headings };
  })()`,

  cleanPrefs(p) {
    const o = (p && typeof p === 'object') ? p : {};
    const d = this.DEFAULT_PREFS;
    const b = (k) => (o[k] === undefined ? d[k] : o[k] === true);
    return { recipe: b('recipe'), travel: b('travel'), docs: b('docs'), keepArticle: b('keepArticle') };
  },
  prefs() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch { raw = null; }
    return this.cleanPrefs(raw);
  },
  savePrefs(patch) {
    const next = this.cleanPrefs({ ...this.prefs(), ...patch });
    localStorage.setItem(this.KEY, JSON.stringify(next));
    return next;
  },

  // ---- reading the structured data ----
  _types(n) { return [].concat(n && n['@type'] ? n['@type'] : []).map(String); },
  _nodes(data, out = [], depth = 0) {
    if (!data || depth > 6 || out.length > 400) return out;
    if (Array.isArray(data)) { for (const x of data) this._nodes(x, out, depth + 1); return out; }
    if (typeof data !== 'object') return out;
    out.push(data);
    if (data['@graph']) this._nodes(data['@graph'], out, depth + 1);
    return out;
  },
  _text(v, n = 400) {
    if (v == null) return '';
    if (typeof v === 'object') v = v.name || v.text || '';
    return String(v).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  },

  // "PT1H30M" -> "1 h 30 min"; anything else is shown as the page wrote it.
  duration(v) {
    const s = String(v == null ? '' : v).trim();
    const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(s);
    if (!m || !s.slice(1)) return this._text(s, 40);
    const parts = [];
    if (m[1]) parts.push(m[1] + ' d');
    if (m[2]) parts.push(m[2] + ' h');
    if (m[3]) parts.push(m[3] + ' min');
    if (!parts.length && m[4]) parts.push(m[4] + ' s');
    return parts.join(' ') || this._text(s, 40);
  },

  // HowToStep, HowToSection, plain strings, one long string -> [text]
  _steps(v, out = [], depth = 0) {
    if (v == null || depth > 4 || out.length >= this.MAX_ITEMS) return out;
    if (typeof v === 'string') {
      const lines = v.split(/\r?\n+/).map(x => this._text(x, 600)).filter(Boolean);
      for (const l of lines) out.push(l);
      return out;
    }
    if (Array.isArray(v)) { for (const x of v) this._steps(x, out, depth + 1); return out; }
    if (typeof v === 'object') {
      if (v.itemListElement) return this._steps(v.itemListElement, out, depth + 1);
      const t = this._text(v.text || v.name || (v.item && v.item.name), 600);
      if (t) out.push(t);
    }
    return out;
  },

  _list(v) {
    return [].concat(v == null ? [] : v).map(x => this._text(x, 300)).filter(Boolean).slice(0, this.MAX_ITEMS);
  },

  // payload ({ ld, headings }) -> { kind, name, facts, lists } or null
  parse(payload, prefs) {
    const p = (payload && typeof payload === 'object') ? payload : {};
    const pr = this.cleanPrefs(prefs || this.prefs());
    const nodes = [];
    for (const raw of (Array.isArray(p.ld) ? p.ld : [])) {
      try { this._nodes(JSON.parse(raw), nodes); } catch { /* a block that is not JSON is skipped */ }
    }
    const has = (t) => nodes.find(n => this._types(n).includes(t));
    const headings = (Array.isArray(p.headings) ? p.headings : [])
      .map(h => ({ level: Math.min(4, Math.max(2, Number(h && h.level) || 2)), text: this._text(h && h.text, 160) })).filter(h => h.text).slice(0, 80);

    const recipe = pr.recipe && has('Recipe');
    if (recipe) {
      const ings = this._list(recipe.recipeIngredient || recipe.ingredients);
      const steps = this._steps(recipe.recipeInstructions);
      if (ings.length || steps.length) {
        const yieldV = [].concat(recipe.recipeYield == null ? [] : recipe.recipeYield).map(x => this._text(x, 40)).filter(Boolean)[0] || '';
        const facts = [];
        const add = (label, value) => { if (value) facts.push({ label, value }); };
        add('Prep', this.duration(recipe.prepTime));
        add('Cook', this.duration(recipe.cookTime));
        add('Total', this.duration(recipe.totalTime));
        add('Serves', yieldV);
        add('Calories', this._text(recipe.nutrition && recipe.nutrition.calories, 40));
        return { kind: 'recipe', name: this._text(recipe.name, 200), facts, lists: [
          ings.length ? { heading: 'Ingredients', ordered: false, items: ings.map(text => ({ text })) } : null,
          steps.length ? { heading: 'Method', ordered: true, items: steps.map(text => ({ text })) } : null,
        ].filter(Boolean) };
      }
    }

    const trip = pr.travel && (has('TouristTrip') || has('Trip') || has('TouristDestination'));
    if (trip) {
      let items = [];
      const itin = trip.itinerary;
      if (itin) {
        const raw = Array.isArray(itin) ? itin : (itin.itemListElement || [itin]);
        const rows = [].concat(raw).map((x, i) => {
          if (typeof x === 'string') return { pos: i, name: this._text(x, 200), note: '' };
          const o = x && typeof x === 'object' ? x : {};
          const inner = o.item && typeof o.item === 'object' ? o.item : {};
          return { pos: Number.isFinite(Number(o.position)) ? Number(o.position) : i, name: this._text(o.name || inner.name, 200), note: this._text(o.description || inner.description, 300) };
        }).filter(r => r.name);
        items = rows.sort((a, b) => a.pos - b.pos).map(r => ({ text: r.name + (r.note ? ' — ' + r.note : '') }));
      }
      let heading = 'Itinerary';
      if (!items.length) {
        const places = [].concat(trip.includesAttraction || [], trip.subTrip || [], trip.containsPlace || []);
        items = this._list(places.map(x => (typeof x === 'string' ? x : (x && x.name) || ''))).map(text => ({ text }));
        heading = 'Places to see';
      }
      if (items.length) {
        const facts = [];
        const touristType = this._list(trip.touristType).join(', ');
        if (touristType) facts.push({ label: 'For', value: touristType });
        return { kind: 'travel', name: this._text(trip.name, 200), facts, lists: [{ heading, ordered: heading === 'Itinerary', items: items.slice(0, this.MAX_ITEMS) }] };
      }
    }

    const doc = pr.docs && (has('TechArticle') || has('APIReference') || has('HowTo'));
    if (doc) {
      const lists = [];
      const steps = this._steps(doc.step);
      if (steps.length) lists.push({ heading: 'Steps', ordered: true, items: steps.map(text => ({ text })) });
      const needs = this._list([].concat(doc.supply || [], doc.tool || []));
      if (needs.length) lists.push({ heading: 'You need', ordered: false, items: needs.map(text => ({ text })) });
      if (headings.length >= 3) lists.push({ heading: 'On this page', ordered: false, items: headings.slice(0, this.MAX_ITEMS).map(h => ({ text: h.text, level: h.level })) });
      if (lists.length) return { kind: 'docs', name: this._text(doc.name || doc.headline, 200), facts: [], lists };
    }
    return null;
  },

  // From the page: structured data or null.
  async probe(wv) {
    const payload = await window.vexGuestEval(wv, this.PROBE_SCRIPT);
    return this.parse(payload);
  },

  // ---- drawing, inside reader view's own document ----
  CSS: `
.vk-card{border:1px solid var(--vr-border);border-radius:12px;padding:16px 18px;margin:0 0 1.8em;background:var(--vr-code)}
.vk-kind{font:600 12px/1.2 'Segoe UI',system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--vr-muted);margin:0 0 .6em}
.vk-facts{display:flex;flex-wrap:wrap;gap:6px 18px;margin:0 0 1em;padding:0;list-style:none;font:14px/1.4 'Segoe UI',system-ui,sans-serif;color:var(--vr-muted)}
.vk-facts b{color:var(--vr-text);font-weight:600}
.vk-card h2{margin:1em 0 .4em;font-size:1.15em}
.vk-check{list-style:none;padding:0;margin:0 0 .6em}
ol.vk-check{counter-reset:vk}
.vk-check li{margin:.15em 0}
.vk-check label{display:flex;gap:.65em;align-items:flex-start;cursor:pointer;padding:.25em .2em;border-radius:6px}
.vk-check label:hover{background:color-mix(in srgb,var(--vr-link) 8%,transparent)}
ol.vk-check label::before{counter-increment:vk;content:counter(vk) ".";min-width:1.6em;color:var(--vr-muted);font-variant-numeric:tabular-nums}
.vk-check input{margin-top:.38em;accent-color:var(--vr-link);flex:none}
.vk-check .vk-done span{text-decoration:line-through;color:var(--vr-muted)}
.vk-foot{display:flex;gap:12px;align-items:center;font:13px/1.2 'Segoe UI',system-ui,sans-serif;color:var(--vr-muted);margin-top:.6em}
.vk-reset{font:inherit;color:inherit;background:transparent;border:1px solid var(--vr-border);border-radius:8px;padding:4px 10px;cursor:pointer}
.vk-reset:hover{border-color:var(--vr-muted)}
.vk-more>summary{cursor:pointer;color:var(--vr-muted);font:600 14px/1.4 'Segoe UI',system-ui,sans-serif;margin:0 0 1em}
`,
  SCRIPT: `(function(){
document.querySelectorAll('.vk-card').forEach(function(card){
  var boxes=card.querySelectorAll('input[type=checkbox]');
  var out=card.querySelector('.vk-progress');
  function upd(){var n=0;boxes.forEach(function(b){if(b.checked){n++;}b.closest('li').classList.toggle('vk-done',b.checked);});if(out){out.textContent=n+' of '+boxes.length+' done';}}
  boxes.forEach(function(b){b.addEventListener('change',upd);});
  var r=card.querySelector('.vk-reset');
  if(r){r.addEventListener('click',function(){boxes.forEach(function(b){b.checked=false;});upd();});}
  upd();
});
})();`,

  // The block that goes above the article, as { html, css, script }; `esc` is
  // reader view's own escaper.
  render(structured, esc) {
    if (!structured || !this.KINDS[structured.kind] || !Array.isArray(structured.lists)) return null;
    const e = (s) => esc(String(s == null ? '' : s));
    const facts = (structured.facts || []).filter(f => f && f.value);
    const lists = structured.lists.filter(l => l && Array.isArray(l.items) && l.items.length);
    if (!lists.length) return null;
    const html = `<section class="vk-card" aria-label="${e(this.KINDS[structured.kind])} checklist" data-kind="${e(structured.kind)}">`
      + `<p class="vk-kind">${e(this.KINDS[structured.kind])}</p>`
      + (facts.length ? `<ul class="vk-facts">${facts.map(f => `<li>${e(f.label)} <b>${e(f.value)}</b></li>`).join('')}</ul>` : '')
      + lists.map(l => {
        const tag = l.ordered ? 'ol' : 'ul';
        return `<h2>${e(l.heading)}</h2><${tag} class="vk-check">${l.items.map(it => {
          const pad = it.level > 2 ? ` style="margin-left:${(Math.min(4, it.level) - 2) * 1.2}em"` : '';
          return `<li${pad}><label><input type="checkbox"><span>${e(it.text)}</span></label></li>`;
        }).join('')}</${tag}>`;
      }).join('')
      + `<div class="vk-foot"><span class="vk-progress" aria-live="polite"></span><button type="button" class="vk-reset">Untick all</button></div>`
      + `</section>`;
    return { html, css: this.CSS, script: this.SCRIPT };
  },

  // ---- Settings and the command bar ----
  buildSettings(body) {
    const G = window.VexSettingsGroup;
    const p = this.prefs();
    body.append(
      G.toggle('Recipes: ingredients and method as a checklist', p.recipe, (on) => { this.savePrefs({ recipe: on }); }),
      G.toggle('Trips: the itinerary as a checklist', p.travel, (on) => { this.savePrefs({ travel: on }); }),
      G.toggle('Docs and how-tos: steps and the page outline', p.docs, (on) => { this.savePrefs({ docs: on }); }),
      G.toggle('Keep the article text under the checklist', p.keepArticle, (on) => { this.savePrefs({ keepArticle: on }); }, 'folded'),
      G.note('Used by reader view (Ctrl+K › Reading Mode) on pages that publish schema.org recipe, trip or documentation data. Pages without it read as before.'),
    );
  },

  mount() {
    if (window.VexSettingsGroup) {
      window.VexSettingsGroup.add({ id: 'settings-readerkinds', title: 'Reader layouts for recipes, trips and docs', info: 'A checklist on top of reader view when the page says it is a recipe, a trip or documentation.', build: (body) => this.buildSettings(body) });
    }
    if (typeof CommandBar !== 'undefined' && CommandBar.commands && !CommandBar.commands.some(c => c.id === 'reader-checklist')) {
      CommandBar.commands.push({ id: 'reader-checklist', label: 'Read as a Checklist (Recipe, Trip or Docs)', hint: 'Reader view with the ingredients, itinerary or steps on top, to tick off', icon: 'check',
        action: async () => {
          try {
            if (typeof ReadingMode === 'undefined') throw new Error('Reader view is not available');
            const wv = WebviewManager.getActiveWebview();
            if (!wv) throw new Error('Open a page first');
            const s = await this.probe(wv);
            if (!s) window.showToast?.('This page does not say it is a recipe, a trip or documentation — opening ordinary reader view');
            await ReadingMode.activate();
          } catch (err) { window.showToast?.(err.message, 'error'); }
        } });
    }
  },
};

if (typeof window !== 'undefined') {
  window.VexReaderKinds = VexReaderKinds;
  if (typeof document !== 'undefined' && document.getElementById('command-overlay')) VexReaderKinds.mount();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexReaderKinds };
