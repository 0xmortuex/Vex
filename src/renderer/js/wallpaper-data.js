// === The wallpapers that come with Vex: 74 pictures drawn by code ==============
//
// Nothing here is a photograph or a file: each row is a name, a kind of picture
// (js/wallpaper-generators.js), a palette and a seed. They are made by Vex, so
// there is no licence to keep track of and they add a few kilobytes of text.
// A row is [id, title, category, kind, palette, seed, options?].
//
//   WallpaperData.CATEGORIES   [{ id, title }]
//   WallpaperData.generated()  [{ id, title, category, source: 'generated', kind, seed, colors,
//                                 light, dominant, tags, author: 'Vex', licence: 'Made by Vex' }]

(function (root) {
  'use strict';

  const CATEGORIES = [
    { id: 'aurora', title: 'Aurora' },
    { id: 'gradients', title: 'Gradients' },
    { id: 'horizon', title: 'Horizon' },
    { id: 'waves', title: 'Waves' },
    { id: 'mountains', title: 'Mountains' },
    { id: 'geometry', title: 'Geometry' },
    { id: 'topography', title: 'Topography' },
    { id: 'grids', title: 'Dots and grids' },
    { id: 'night', title: 'Night sky' },
    { id: 'grain', title: 'Film grain' },
    { id: 'minimal', title: 'Minimal' },
    { id: 'soft', title: 'Soft light' },
  ];

  // [base, second tone, accent, accent, accent]
  const PALETTES = {
    midnight: ['#070b1f', '#101a3d', '#3b5bdb', '#7c3aed', '#22d3ee'],
    emerald: ['#04130f', '#0b2b22', '#10b981', '#34d399', '#a7f3d0'],
    ember: ['#150806', '#2a0f0a', '#f97316', '#ef4444', '#fbbf24'],
    orchid: ['#12061c', '#240a3a', '#c026d3', '#8b5cf6', '#f472b6'],
    ocean: ['#03121c', '#06293d', '#0ea5e9', '#06b6d4', '#67e8f9'],
    rose: ['#1a060d', '#330c1b', '#f43f5e', '#fb7185', '#fda4af'],
    graphite: ['#0c0d10', '#1a1c22', '#475569', '#64748b', '#94a3b8'],
    forest: ['#050f08', '#0d2414', '#16a34a', '#65a30d', '#bef264'],
    dusk: ['#0f0a24', '#2b1250', '#7c3aed', '#ec4899', '#fb923c'],
    arctic: ['#08141c', '#11303f', '#38bdf8', '#a5f3fc', '#e0f2fe'],
    sunset: ['#1c0a1f', '#4a1233', '#f43f5e', '#fb923c', '#fde047'],
    teal: ['#031514', '#073a3a', '#14b8a6', '#2dd4bf', '#99f6e4'],
    indigo: ['#0a0a23', '#1e1b4b', '#6366f1', '#818cf8', '#c7d2fe'],
    copper: ['#140c07', '#2d1b0e', '#b45309', '#d97706', '#fcd34d'],
    paper: ['#faf7f2', '#efe9de', '#d6c7ae', '#b79f7c', '#8c7556'],
    sky: ['#f0f9ff', '#dbeafe', '#7dd3fc', '#93c5fd', '#c4b5fd'],
    blush: ['#fff1f2', '#ffe4e6', '#fda4af', '#f9a8d4', '#fcd34d'],
    mint: ['#f0fdf4', '#dcfce7', '#86efac', '#5eead4', '#bae6fd'],
    lavender: ['#faf5ff', '#f3e8ff', '#d8b4fe', '#a5b4fc', '#f9a8d4'],
    sand: ['#fefce8', '#fef3c7', '#fcd34d', '#fdba74', '#fca5a5'],
    cloud: ['#f8fafc', '#e2e8f0', '#cbd5e1', '#94a3b8', '#bfdbfe'],
    peach: ['#fff7ed', '#ffedd5', '#fdba74', '#fb7185', '#fde68a'],
  };

  const ROWS = [
    ['aurora-borealis', 'Borealis', 'aurora', 'mesh', 'emerald', 1, { ribbon: true }],
    ['aurora-polar', 'Polar veil', 'aurora', 'mesh', 'arctic', 2, { ribbon: true }],
    ['aurora-violet', 'Violet drift', 'aurora', 'mesh', 'orchid', 3, { ribbon: true }],
    ['aurora-magenta', 'Magenta tide', 'aurora', 'mesh', 'dusk', 4, { ribbon: true }],
    ['aurora-deep', 'Deep current', 'aurora', 'mesh', 'ocean', 5, { ribbon: true }],
    ['aurora-ember', 'Ember veil', 'aurora', 'mesh', 'ember', 6, { ribbon: true }],
    ['aurora-nova', 'Nova', 'aurora', 'mesh', 'indigo', 7, { ribbon: true }],
    ['aurora-jade', 'Jade ribbon', 'aurora', 'mesh', 'teal', 8, { ribbon: true }],

    ['grad-midnight', 'Midnight blue', 'gradients', 'linear', 'midnight', 1],
    ['grad-sunset', 'Sunset fade', 'gradients', 'linear', 'sunset', 2],
    ['grad-rose', 'Rose smoke', 'gradients', 'radial', 'rose', 3],
    ['grad-ocean', 'Open water', 'gradients', 'linear', 'ocean', 4],
    ['grad-orchid', 'Orchid glow', 'gradients', 'radial', 'orchid', 5],
    ['grad-copper', 'Copper light', 'gradients', 'radial', 'copper', 6],
    ['grad-forest', 'Canopy', 'gradients', 'linear', 'forest', 7],
    ['grad-graphite', 'Graphite haze', 'gradients', 'radial', 'graphite', 8],

    ['horizon-dusk', 'Dusk line', 'horizon', 'horizon', 'dusk', 1],
    ['horizon-ember', 'Ember hour', 'horizon', 'horizon', 'ember', 2],
    ['horizon-coral', 'Coral evening', 'horizon', 'horizon', 'sunset', 3],
    ['horizon-lagoon', 'Lagoon night', 'horizon', 'horizon', 'teal', 4],
    ['horizon-violet', 'Violet hour', 'horizon', 'horizon', 'orchid', 5],
    ['horizon-arctic', 'Cold dawn', 'horizon', 'horizon', 'arctic', 6],

    ['waves-deep', 'Deep swell', 'waves', 'waves', 'ocean', 1],
    ['waves-teal', 'Teal tide', 'waves', 'waves', 'teal', 2],
    ['waves-dusk', 'Dusk swell', 'waves', 'waves', 'dusk', 3],
    ['waves-rose', 'Rose surf', 'waves', 'waves', 'rose', 4],
    ['waves-indigo', 'Indigo roll', 'waves', 'waves', 'indigo', 5],
    ['waves-forest', 'Moss ripple', 'waves', 'waves', 'forest', 6],

    ['mtn-midnight', 'Midnight range', 'mountains', 'mountains', 'midnight', 1],
    ['mtn-ember', 'Ember peaks', 'mountains', 'mountains', 'ember', 2],
    ['mtn-forest', 'Pine ridge', 'mountains', 'mountains', 'forest', 3],
    ['mtn-dusk', 'Violet ridge', 'mountains', 'mountains', 'dusk', 4],
    ['mtn-arctic', 'Glacier line', 'mountains', 'mountains', 'arctic', 5],
    ['mtn-copper', 'Canyon rim', 'mountains', 'mountains', 'copper', 6],

    ['poly-indigo', 'Facet indigo', 'geometry', 'lowpoly', 'indigo', 1],
    ['poly-ember', 'Facet ember', 'geometry', 'lowpoly', 'ember', 2],
    ['poly-teal', 'Facet teal', 'geometry', 'lowpoly', 'teal', 3],
    ['poly-orchid', 'Facet orchid', 'geometry', 'lowpoly', 'orchid', 4],
    ['tiles-graphite', 'Slate tiles', 'geometry', 'tiles', 'graphite', 5],
    ['tiles-ocean', 'Harbour tiles', 'geometry', 'tiles', 'ocean', 6],

    ['topo-forest', 'Contour forest', 'topography', 'topo', 'forest', 1],
    ['topo-ocean', 'Depth chart', 'topography', 'topo', 'ocean', 2],
    ['topo-graphite', 'Survey', 'topography', 'topo', 'graphite', 3],
    ['topo-copper', 'Ridge map', 'topography', 'topo', 'copper', 4],
    ['topo-indigo', 'Night survey', 'topography', 'topo', 'indigo', 5],

    ['dots-midnight', 'Dot matrix', 'grids', 'dots', 'midnight', 1],
    ['dots-emerald', 'Green matrix', 'grids', 'dots', 'emerald', 2],
    ['grid-blueprint', 'Blueprint', 'grids', 'grid', 'ocean', 3],
    ['grid-graphite', 'Draft grid', 'grids', 'grid', 'graphite', 4],
    ['rings-sonar', 'Sonar', 'grids', 'rings', 'teal', 5],
    ['rings-orchid', 'Orchid ripple', 'grids', 'rings', 'orchid', 6],

    ['stars-deep', 'Deep field', 'night', 'stars', 'midnight', 1],
    ['stars-violet', 'Violet nebula', 'night', 'stars', 'orchid', 2],
    ['stars-ember', 'Red nebula', 'night', 'stars', 'ember', 3],
    ['stars-arctic', 'Cold stars', 'night', 'stars', 'arctic', 4],

    ['grain-graphite', 'Film graphite', 'grain', 'grain', 'graphite', 1],
    ['grain-dusk', 'Film dusk', 'grain', 'grain', 'dusk', 2],
    ['grain-forest', 'Film moss', 'grain', 'grain', 'forest', 3],
    ['grain-rose', 'Film rose', 'grain', 'grain', 'rose', 4],
    ['grain-ocean', 'Film tide', 'grain', 'grain', 'ocean', 5],

    ['solid-ink', 'Ink', 'minimal', 'solid', 'graphite', 1],
    ['solid-navy', 'Navy', 'minimal', 'solid', 'midnight', 2],
    ['solid-pine', 'Pine', 'minimal', 'solid', 'forest', 3],
    ['solid-wine', 'Wine', 'minimal', 'solid', 'rose', 4],
    ['solid-plum', 'Plum', 'minimal', 'solid', 'orchid', 5],
    ['solid-coal', 'Coal', 'minimal', 'solid', 'graphite', 6],

    ['soft-sky', 'Soft sky', 'soft', 'mesh', 'sky', 1],
    ['soft-blush', 'Blush', 'soft', 'mesh', 'blush', 2],
    ['soft-mint', 'Mint air', 'soft', 'mesh', 'mint', 3],
    ['soft-lavender', 'Lavender mist', 'soft', 'mesh', 'lavender', 4],
    ['soft-sand', 'Warm sand', 'soft', 'linear', 'sand', 5],
    ['soft-cloud', 'Cloud', 'soft', 'radial', 'cloud', 6],
    ['soft-peach', 'Peach bokeh', 'soft', 'bokeh', 'peach', 7],
    ['soft-paper', 'Paper', 'soft', 'grain', 'paper', 8],
  ];

  const LIGHT = new Set(['paper', 'sky', 'blush', 'mint', 'lavender', 'sand', 'cloud', 'peach']);
  const LIGHT_IDS = new Set();    // wallpapers from extend() that are light (their colours are then listed lightest first)
  const TITLE_OF = Object.fromEntries(CATEGORIES.map(c => [c.id, c.title]));

  let cache = null;

  // More wallpapers from js/wallpaper-materials-data.js: { categories, palettes, rows, light: [ids] }. Palettes there are
  // written darkest to lightest. Files that load late can arrive after the list was first read: the next read then has them.
  function extend(part) {
    cache = null;
    for (const c of part.categories || []) {
      if (TITLE_OF[c.id]) throw new Error('The wallpaper group "' + c.id + '" already exists');
      CATEGORIES.push(c);
      TITLE_OF[c.id] = c.title;
    }
    for (const name of Object.keys(part.palettes || {})) {
      if (PALETTES[name]) throw new Error('The wallpaper palette "' + name + '" already exists');
      PALETTES[name] = part.palettes[name];
    }
    const seen = new Set(ROWS.map(r => r[0]));
    for (const row of part.rows || []) {
      if (seen.has(row[0])) throw new Error('The wallpaper "' + row[0] + '" already exists');
      seen.add(row[0]);
      ROWS.push(row);
    }
    for (const id of part.light || []) LIGHT_IDS.add(id);
  }

  function generated() {
    if (cache) return cache;
    cache = ROWS.map(([id, title, category, kind, pal, seed, opts]) => {
      const colors = PALETTES[pal];
      if (!colors) throw new Error('Wallpaper ' + id + ' names an unknown palette: ' + pal);
      if (!TITLE_OF[category]) throw new Error('Wallpaper ' + id + ' names an unknown category: ' + category);
      const light = LIGHT.has(pal) || LIGHT_IDS.has(id);
      return Object.freeze({
        id, title, category, source: 'generated', kind, seed, colors: LIGHT_IDS.has(id) ? colors.slice().reverse() : colors.slice(), opts: opts || {}, light,
        dominant: kind === 'solid' || kind === 'grain' ? colors[1] : colors[2],
        tags: [TITLE_OF[category].toLowerCase(), pal, kind, light ? 'light' : 'dark'],
        author: 'Vex', licence: 'Made by Vex',
      });
    });
    return cache;
  }

  const api = { CATEGORIES, PALETTES, generated, extend, categoryTitle: (id) => TITLE_OF[id] || id };
  if (typeof window !== 'undefined') window.WallpaperData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = { WallpaperData: api };
})(typeof window !== 'undefined' ? window : globalThis);
