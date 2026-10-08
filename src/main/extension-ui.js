// === What an extension shows in Vex: its right-click menu items and its
// toolbar button's badge (chrome.contextMenus, chrome.action) ===
//
// Kept by main, per session (its partition: a container's extension is a
// separate copy with its own service worker) and per extension. The rules for
// the menu items are js/ext-menu-model.js, shared with the interface that
// draws them. onChange() is called after anything changes, so main can tell
// the windows.
//
// No Electron here: main.js does the IPC, tests drive this directly.

const Model = require('../renderer/js/ext-menu-model');

// Chrome's default badge colours: white text on red.
const DEFAULT_BADGE_BG = [217, 48, 37, 255];
const DEFAULT_BADGE_TEXT = [255, 255, 255, 255];

const NAMED_COLOURS = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', lime: '#00ff00', blue: '#0000ff', yellow: '#ffff00',
  orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', brown: '#a52a2a', gray: '#808080', grey: '#808080', cyan: '#00ffff',
  aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff', navy: '#000080', teal: '#008080', maroon: '#800000', olive: '#808000',
  silver: '#c0c0c0', gold: '#ffd700', darkred: '#8b0000', darkgreen: '#006400', darkblue: '#00008b', crimson: '#dc143c',
  tomato: '#ff6347', coral: '#ff7f50', indigo: '#4b0082', violet: '#ee82ee', transparent: 'rgba(0,0,0,0)',
};

// A badge colour as an extension may give it — "#RGB", "#RRGGBB", "rgb()",
// "rgba()", a CSS colour name, or [r, g, b, a] — as [r, g, b, a].
function parseColour(value) {
  if (Array.isArray(value)) {
    if (value.length !== 4 || !value.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) throw new Error('A colour array is [red, green, blue, alpha], each 0 to 255');
    return value.slice();
  }
  if (typeof value !== 'string' || value.length > 60) throw new Error('A badge colour is a CSS colour string or [r, g, b, a]');
  let s = value.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(NAMED_COLOURS, s)) s = NAMED_COLOURS[s];
  let m;
  if ((m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s))) return [m[1], m[2], m[3]].map(h => parseInt(h + h, 16)).concat(255);
  if ((m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/.exec(s))) return [m[1], m[2], m[3]].map(h => parseInt(h, 16)).concat(m[4] ? parseInt(m[4], 16) : 255);
  if ((m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s))) {
    const rgb = [m[1], m[2], m[3]].map(Number);
    const a = m[4] === undefined ? 1 : Number(m[4]);
    if (rgb.some(n => n > 255) || !(a >= 0 && a <= 1)) throw new Error(`"${value}" is not a colour`);
    return rgb.concat(Math.round(a * 255));
  }
  throw new Error(`"${value}" is not a colour Vex understands (use #RRGGBB, rgb(), a colour name or [r, g, b, a])`);
}

const ACTION_PROPS = ['text', 'bg', 'color', 'title'];

function createExtensionUi({ onChange = () => {} } = {}) {
  const menus = new Map();    // key → items[] (ext-menu-model records)
  const actions = new Map();  // key → { def: {prop: value}, tabs: Map(tabId → {prop: value}) }
  const key = (partition, extId) => String(partition) + '\n' + String(extId);
  const split = (k) => { const i = k.indexOf('\n'); return [k.slice(0, i), k.slice(i + 1)]; };

  function itemsOf(partition, extId, make) {
    const k = key(partition, extId);
    let list = menus.get(k);
    if (!list && make) { list = []; menus.set(k, list); }
    return list || null;
  }
  function changed() { onChange(); }

  // --- chrome.contextMenus
  function menusCreate(partition, extId, props) {
    const list = itemsOf(partition, extId, true);
    const item = Model.create(list, props);
    changed();
    return item.id;
  }
  function menusUpdate(partition, extId, id, props) {
    const list = itemsOf(partition, extId, false);
    if (!list) throw new Error('Cannot find menu item with id ' + id);
    Model.update(list, id, props);
    changed();
  }
  function menusRemove(partition, extId, id) {
    const list = itemsOf(partition, extId, false);
    if (!list) throw new Error('Cannot find menu item with id ' + id);
    Model.remove(list, id);
    if (!list.length) menus.delete(key(partition, extId));
    changed();
  }
  function menusRemoveAll(partition, extId) {
    if (menus.delete(key(partition, extId))) changed();
  }
  function menusTree(partition, extId, ctx) {
    const list = itemsOf(partition, extId, false);
    return list ? Model.visibleTree(list, Model.cleanContext(ctx)) : [];
  }
  // A click from the interface. The item must still show for that click (the
  // interface may be a moment behind). → { info, item }.
  function menusClick(partition, extId, id, rawCtx) {
    const ctx = Model.cleanContext(rawCtx);
    const list = itemsOf(partition, extId, false);
    const item = list && Model.find(list, id);
    if (!item) throw new Error('That menu item is gone');
    const shown = (function walk(nodes) { return nodes.some(n => (n.id === item.id && typeof n.id === typeof item.id) || walk(n.children)); })(Model.visibleTree(list, ctx));
    if (!shown) throw new Error('That menu item does not apply here');
    const { wasChecked } = Model.click(list, id);
    if (item.type === 'checkbox' || item.type === 'radio') changed();
    return { info: Model.clickInfo(item, ctx, wasChecked), item };
  }

  // --- chrome.action / chrome.browserAction badge and title.
  function actionSet(partition, extId, prop, value, tabId) {
    if (!ACTION_PROPS.includes(prop)) throw new Error('Unknown action property ' + prop);
    if (tabId != null && !(Number.isSafeInteger(tabId) && tabId > 0)) throw new Error('Invalid tabId');
    const k = key(partition, extId);
    let state = actions.get(k);
    if (!state) { state = { def: {}, tabs: new Map() }; actions.set(k, state); }
    let target = state.def;
    if (tabId != null) {
      target = state.tabs.get(tabId);
      if (!target) { target = {}; state.tabs.set(tabId, target); }
    }
    if (value === null || value === undefined) {
      // No value for one tab: that tab follows the default again.
      if (tabId != null) delete target[prop];
      else if (prop === 'text' || prop === 'title') target[prop] = '';
      else delete target[prop];
    } else if (prop === 'text' || prop === 'title') {
      if (typeof value !== 'string') throw new Error(`The badge ${prop} must be a string`);
      target[prop] = value.slice(0, prop === 'text' ? 100 : 1000);
    } else {
      target[prop] = parseColour(value);
    }
    if (tabId != null && !Object.keys(target).length) state.tabs.delete(tabId);
    changed();
  }
  // defaults: { title } — the manifest's own title for the button.
  function actionGet(partition, extId, prop, tabId, defaults = {}) {
    if (!ACTION_PROPS.includes(prop)) throw new Error('Unknown action property ' + prop);
    const state = actions.get(key(partition, extId));
    const tab = state && tabId != null ? state.tabs.get(tabId) : null;
    if (tab && Object.prototype.hasOwnProperty.call(tab, prop)) return copy(tab[prop]);
    if (state && Object.prototype.hasOwnProperty.call(state.def, prop)) return copy(state.def[prop]);
    if (prop === 'text') return '';
    if (prop === 'title') return defaults.title || '';
    return (prop === 'bg' ? DEFAULT_BADGE_BG : DEFAULT_BADGE_TEXT).slice();
  }
  function copy(v) { return Array.isArray(v) ? v.slice() : v; }

  // A tab closed: what was set for it alone goes (as in Chrome).
  function forgetTab(tabId) {
    let any = false;
    for (const state of actions.values()) if (state.tabs.delete(tabId)) any = true;
    if (any) changed();
  }
  // Switched off, uninstalled or updated: its items and badge go everywhere.
  function forgetExtension(extId) {
    let any = false;
    for (const k of [...menus.keys()]) if (split(k)[1] === extId) { menus.delete(k); any = true; }
    for (const k of [...actions.keys()]) if (split(k)[1] === extId) { actions.delete(k); any = true; }
    if (any) changed();
  }

  // Everything, for the interface: { menus: {partition: {extId: items}},
  // action: {partition: {extId: {def, tabs: {tabId: state}}}} }.
  function snapshot() {
    const out = { menus: {}, action: {} };
    for (const [k, list] of menus) {
      const [p, id] = split(k);
      (out.menus[p] = out.menus[p] || {})[id] = list.map(it => ({ ...it }));
    }
    for (const [k, state] of actions) {
      const [p, id] = split(k);
      const tabs = {};
      for (const [t, v] of state.tabs) tabs[t] = { ...v };
      (out.action[p] = out.action[p] || {})[id] = { def: { ...state.def }, tabs };
    }
    return out;
  }

  // Menu items survive a restart for an extension whose background stops
  // when idle (a service worker), as in Chrome: it makes them once, when
  // installed. keep(partition, extId) says which to save.
  function saved(keep) {
    const out = {};
    for (const [k, list] of menus) {
      const [p, id] = split(k);
      if (keep(p, id)) (out[p] = out[p] || {})[id] = list.map(it => ({ ...it }));
    }
    return out;
  }
  function restore(data) {
    if (!data || typeof data !== 'object') return;
    for (const p of Object.keys(data)) {
      for (const id of Object.keys(data[p] || {})) {
        const list = [];
        for (const it of Array.isArray(data[p][id]) ? data[p][id] : []) {
          try { Model.create(list, it); }
          catch (err) { console.error(`[Extensions] a saved menu item of ${id} was dropped: ${err.message}`); }
        }
        if (list.length) menus.set(key(p, id), list);
      }
    }
    changed();
  }

  return { menusCreate, menusUpdate, menusRemove, menusRemoveAll, menusTree, menusClick,
    actionSet, actionGet, forgetTab, forgetExtension, snapshot, saved, restore };
}

module.exports = { createExtensionUi, parseColour, DEFAULT_BADGE_BG, DEFAULT_BADGE_TEXT };
