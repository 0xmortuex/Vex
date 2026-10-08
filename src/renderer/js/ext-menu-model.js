// === Extension right-click menu items (chrome.contextMenus) — the rules ===
//
// One copy of the rules for main (src/main/extension-ui.js keeps the items and
// checks a click) and the interface (js/ext-ui.js draws them into the page's
// right-click menu and the toolbar menu). They are Chrome's own rules:
//   * an item shows when one of its contexts applies to what was clicked
//     ("page" only when nothing more specific — a link, a picture, a video or
//     sound, some selected text, a box you type in — was clicked),
//   * targetUrlPatterns narrows link and media items to those addresses,
//     documentUrlPatterns every item to those pages,
//   * "%s" in a title is the selected text,
//   * radio items next to each other are one group: one of them is checked.
//
// Nothing here touches the DOM or Electron; tests require it directly.
(function () {
  'use strict';

  var CONTEXTS = ['all', 'page', 'frame', 'selection', 'link', 'editable', 'image', 'video', 'audio', 'launcher', 'browser_action', 'page_action', 'action'];
  var ACTION_CONTEXTS = ['browser_action', 'page_action', 'action'];
  var TYPES = ['normal', 'checkbox', 'radio', 'separator'];
  // Chrome's chrome.contextMenus.ACTION_MENU_TOP_LEVEL_LIMIT.
  var ACTION_MENU_TOP_LEVEL_LIMIT = 6;
  var MAX_ITEMS = 1000;
  var MAX_SELECTION = 50;

  // --- Match patterns (https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)
  function patternError(p, why) { return new Error('Invalid url pattern \'' + p + '\'' + (why ? ': ' + why : '')); }
  function parsePattern(p) {
    if (typeof p !== 'string' || p.length > 2048) throw patternError(String(p));
    if (p === '<all_urls>') return { all: true };
    var m = /^(\*|https?|wss?|file|ftp|urn|chrome-extension):\/\/([^/]*)(\/.*)$/.exec(p);
    if (!m) throw patternError(p);
    var scheme = m[1], host = m[2], pathPart = m[3];
    if (scheme !== 'file' && !host) throw patternError(p, 'empty host');
    if (host !== '*' && host.indexOf('*') !== -1 && !/^\*\.[^*]+$/.test(host)) throw patternError(p, 'wildcard in the wrong place');
    return { scheme: scheme, host: host, path: pathPart };
  }
  function globToRegex(glob) {
    return new RegExp('^' + glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  }
  function matchPattern(pattern, url) {
    var p = typeof pattern === 'string' ? parsePattern(pattern) : pattern;
    var u;
    try { u = new URL(url); } catch (e) { return false; }
    var scheme = u.protocol.replace(/:$/, '');
    if (p.all) return ['http', 'https', 'ws', 'wss', 'ftp', 'file', 'urn'].indexOf(scheme) !== -1;
    if (p.scheme === '*') { if (scheme !== 'http' && scheme !== 'https') return false; }
    else if (p.scheme !== scheme) return false;
    if (scheme !== 'file') {
      var host = u.hostname;
      if (p.host !== '*') {
        if (p.host.indexOf('*.') === 0) {
          var base = p.host.slice(2).replace(/:\d+$/, '');
          if (host !== base && !host.endsWith('.' + base)) return false;
        } else if (p.host.replace(/:\d+$/, '') !== host) return false;
      }
    }
    return globToRegex(p.path).test(u.pathname + u.search);
  }
  function anyMatch(patterns, url) {
    if (!patterns || !patterns.length) return true;
    if (!url) return false;
    for (var i = 0; i < patterns.length; i++) if (matchPattern(patterns[i], url)) return true;
    return false;
  }

  // --- An item, as an extension describes it, checked the way Chrome checks it.
  // `isUpdate`: only what is given changes; nothing gets its default.
  function cleanProps(props, isUpdate) {
    if (!props || typeof props !== 'object') throw new Error('Expected an object of menu item properties');
    var out = {};
    if (props.type !== undefined) {
      if (TYPES.indexOf(props.type) === -1) throw new Error('Invalid menu item type: ' + props.type);
      out.type = props.type;
    } else if (!isUpdate) out.type = 'normal';
    if (props.title !== undefined) {
      if (typeof props.title !== 'string') throw new Error('The title must be a string');
      out.title = props.title.slice(0, 1000);
    }
    if (props.contexts !== undefined) {
      var list = Array.isArray(props.contexts) ? props.contexts : [props.contexts];
      if (!list.length) throw new Error('A menu item needs at least one context');
      list.forEach(function (c) { if (CONTEXTS.indexOf(c) === -1) throw new Error('Invalid context: ' + c); });
      out.contexts = list.filter(function (c, i) { return list.indexOf(c) === i; });
    } else if (!isUpdate) out.contexts = ['page'];
    ['checked', 'enabled', 'visible'].forEach(function (k) {
      if (props[k] === undefined) return;
      if (typeof props[k] !== 'boolean') throw new Error('"' + k + '" must be true or false');
      out[k] = props[k];
    });
    if (!isUpdate) {
      if (out.enabled === undefined) out.enabled = true;
      if (out.visible === undefined) out.visible = true;
      if (out.checked === undefined) out.checked = false;
    }
    ['documentUrlPatterns', 'targetUrlPatterns'].forEach(function (k) {
      if (props[k] === undefined || props[k] === null) { if (props[k] === null) out[k] = null; return; }
      if (!Array.isArray(props[k]) || props[k].length > 100) throw new Error('"' + k + '" must be a list of URL patterns');
      props[k].forEach(parsePattern);
      out[k] = props[k].slice();
    });
    if (props.parentId !== undefined) {
      if (props.parentId !== null && typeof props.parentId !== 'string' && typeof props.parentId !== 'number') throw new Error('Invalid parentId');
      out.parentId = props.parentId;
    }
    return out;
  }

  // --- One extension's items: an ordered list of plain records.
  function idKey(id) { return typeof id + ':' + String(id); }
  function find(items, id) { for (var i = 0; i < items.length; i++) if (idKey(items[i].id) === idKey(id)) return items[i]; return null; }
  function childrenOf(items, parentId) {
    return items.filter(function (it) { return parentId == null ? it.parentId == null : (it.parentId != null && idKey(it.parentId) === idKey(parentId)); });
  }
  function isAncestor(items, maybeAncestorId, id) {
    var cur = find(items, id);
    var guard = 0;
    while (cur && cur.parentId != null && guard++ < MAX_ITEMS) {
      if (idKey(cur.parentId) === idKey(maybeAncestorId)) return true;
      cur = find(items, cur.parentId);
    }
    return false;
  }
  // Radio items side by side among one parent's children are one group; a
  // group always has exactly one checked (Chrome's SanitizeRadioButtons).
  function sanitizeRadios(items, preferId) {
    var parents = [null].concat(items.map(function (it) { return it.id; }));
    parents.forEach(function (pid) {
      var kids = childrenOf(items, pid);
      var group = [];
      var flush = function () {
        if (!group.length) return;
        var pick = null;
        if (preferId != null) group.forEach(function (it) { if (idKey(it.id) === idKey(preferId) && it.checked) pick = it; });
        if (!pick) group.forEach(function (it) { if (!pick && it.checked) pick = it; });
        if (!pick) pick = group[0];
        group.forEach(function (it) { it.checked = it === pick; });
        group = [];
      };
      kids.forEach(function (it) { if (it.type === 'radio') group.push(it); else flush(); });
      flush();
    });
  }
  function create(items, props) {
    var clean = cleanProps(props, false);
    var id = props.id;
    if (id === undefined || id === null) throw new Error('A menu item needs an id');
    if (typeof id !== 'string' && typeof id !== 'number') throw new Error('Invalid menu item id');
    if (typeof id === 'string' && id.length > 512) throw new Error('The menu item id is too long');
    if (find(items, id)) throw new Error('Cannot create item with duplicate id ' + id);
    if (items.length >= MAX_ITEMS) throw new Error('Too many menu items');
    if (clean.type !== 'separator' && !clean.title) throw new Error('Title missing for a menu item that is not a separator');
    if (clean.parentId != null && !find(items, clean.parentId)) throw new Error('Cannot find menu item with id ' + clean.parentId);
    var item = { id: id, parentId: clean.parentId == null ? null : clean.parentId, type: clean.type, title: clean.title || '',
      contexts: clean.contexts, checked: clean.checked, enabled: clean.enabled, visible: clean.visible,
      documentUrlPatterns: clean.documentUrlPatterns || null, targetUrlPatterns: clean.targetUrlPatterns || null };
    items.push(item);
    sanitizeRadios(items, item.type === 'radio' && item.checked ? item.id : null);
    return item;
  }
  function update(items, id, props) {
    var item = find(items, id);
    if (!item) throw new Error('Cannot find menu item with id ' + id);
    var clean = cleanProps(props, true);
    if (clean.parentId !== undefined) {
      if (clean.parentId != null) {
        if (!find(items, clean.parentId)) throw new Error('Cannot find menu item with id ' + clean.parentId);
        if (idKey(clean.parentId) === idKey(id) || isAncestor(items, id, clean.parentId)) throw new Error('Cannot set a menu item as a child of itself or its own descendant');
      }
      item.parentId = clean.parentId == null ? null : clean.parentId;
    }
    Object.keys(clean).forEach(function (k) { if (k !== 'parentId') item[k] = clean[k]; });
    if (item.type !== 'separator' && !item.title) throw new Error('Title missing for a menu item that is not a separator');
    sanitizeRadios(items, item.type === 'radio' && clean.checked === true ? item.id : null);
    return item;
  }
  // The item and everything under it.
  function remove(items, id) {
    if (!find(items, id)) throw new Error('Cannot find menu item with id ' + id);
    var gone = items.filter(function (it) { return idKey(it.id) === idKey(id) || isAncestor(items, id, it.id); });
    var left = items.filter(function (it) { return gone.indexOf(it) === -1; });
    items.length = 0;
    Array.prototype.push.apply(items, left);
    sanitizeRadios(items, null);
    return gone.length;
  }

  // --- What was clicked: { kind: 'page'|'action', pageUrl, frameUrl,
  // selectionText, linkUrl, srcUrl, mediaType ('image'|'video'|'audio'|''),
  // editable }.
  function documentUrl(ctx) { return (ctx.frameUrl || ctx.pageUrl || ''); }
  function hasContext(item, c) { return item.contexts.indexOf(c) !== -1; }
  function matchesPage(item, ctx) {
    var c = item.contexts;
    var hasLink = !!ctx.linkUrl, hasSel = !!ctx.selectionText, media = ctx.mediaType || '';
    var inFrame = !!ctx.frameUrl && ctx.frameUrl !== ctx.pageUrl;
    var ok = hasContext(item, 'all') || (hasSel && hasContext(item, 'selection')) || (ctx.editable && hasContext(item, 'editable')) || (inFrame && hasContext(item, 'frame'));
    if (!ok && hasLink && hasContext(item, 'link') && anyMatch(item.targetUrlPatterns, ctx.linkUrl)) ok = true;
    if (!ok && media && hasContext(item, media) && anyMatch(item.targetUrlPatterns, ctx.srcUrl)) ok = true;
    // "page" is the least specific: only when nothing more specific was clicked.
    if (!ok && !hasLink && !hasSel && !ctx.editable && !media && hasContext(item, 'page')) ok = true;
    if (!ok) return false;
    return anyMatch(item.documentUrlPatterns, documentUrl(ctx));
  }
  function matchesAction(item) {
    return hasContext(item, 'all') || item.contexts.some(function (c) { return ACTION_CONTEXTS.indexOf(c) !== -1; });
  }
  function shows(item, ctx) {
    if (!item.visible) return false;
    return ctx.kind === 'action' ? matchesAction(item) : matchesPage(item, ctx);
  }
  function titleFor(item, ctx) {
    var t = item.title || '';
    if (t.indexOf('%s') === -1) return t;
    var sel = String(ctx.selectionText || '');
    if (sel.length > MAX_SELECTION) sel = sel.slice(0, MAX_SELECTION) + '…';
    return t.split('%s').join(sel);
  }
  // The items that show for this click, as a tree: [{ id, title, type,
  // checked, enabled, children }]. Separators at either end of a list, or two
  // together, are dropped, as Chrome does.
  function visibleTree(items, ctx) {
    function build(parentId, depth) {
      var out = [];
      childrenOf(items, parentId).forEach(function (it) {
        // Children are drawn when their parent shows; a child's own contexts
        // must also match, as in Chrome.
        if (!shows(it, ctx)) return;
        var node = { id: it.id, title: titleFor(it, ctx), type: it.type, checked: !!it.checked, enabled: it.enabled !== false, children: [] };
        if (depth < 8) node.children = build(it.id, depth + 1);
        out.push(node);
      });
      var tidy = [];
      out.forEach(function (n) {
        if (n.type === 'separator' && (!tidy.length || tidy[tidy.length - 1].type === 'separator')) return;
        tidy.push(n);
      });
      while (tidy.length && tidy[tidy.length - 1].type === 'separator') tidy.pop();
      return tidy;
    }
    var top = build(null, 0);
    if (ctx.kind === 'action') top = top.slice(0, ACTION_MENU_TOP_LEVEL_LIMIT);
    return top;
  }

  // The `info` an extension's onClicked hears (chrome.contextMenus.OnClickData).
  function clickInfo(item, ctx, wasChecked) {
    var info = { menuItemId: item.id, editable: !!ctx.editable };
    if (item.parentId != null) info.parentMenuItemId = item.parentId;
    if (ctx.kind !== 'action') {
      if (ctx.pageUrl) info.pageUrl = ctx.pageUrl;
      if (ctx.frameUrl && ctx.frameUrl !== ctx.pageUrl) info.frameUrl = ctx.frameUrl;
      else info.frameId = 0;
      if (ctx.linkUrl) info.linkUrl = ctx.linkUrl;
      if (ctx.srcUrl && ctx.mediaType) info.srcUrl = ctx.srcUrl;
      if (ctx.mediaType) info.mediaType = ctx.mediaType;
      if (ctx.selectionText) info.selectionText = ctx.selectionText;
    } else if (ctx.pageUrl) info.pageUrl = ctx.pageUrl;
    if (item.type === 'checkbox' || item.type === 'radio') { info.wasChecked = !!wasChecked; info.checked = !!item.checked; }
    return info;
  }

  // A click: a checkbox flips, a radio becomes the one in its group. Returns
  // { item, wasChecked } or throws when the item is not there or cannot be clicked.
  function click(items, id) {
    var item = find(items, id);
    if (!item) throw new Error('That menu item is gone');
    if (item.enabled === false) throw new Error('That menu item is switched off');
    var wasChecked = !!item.checked;
    if (item.type === 'checkbox') item.checked = !item.checked;
    else if (item.type === 'radio') { item.checked = true; sanitizeRadios(items, item.id); }
    return { item: item, wasChecked: wasChecked };
  }

  // The context of a right-click in a page, from Electron's context-menu params.
  function pageContext(params, extra) {
    var p = params || {};
    var x = extra || {};
    var media = p.mediaType === 'image' || p.mediaType === 'video' || p.mediaType === 'audio' ? p.mediaType : '';
    var src = media ? (p.srcURL || '') : '';
    // A picture Vex itself found under the pointer (behind a link, a CSS background).
    if (!media && x.imageSrc) { media = 'image'; src = x.imageSrc; }
    return {
      kind: 'page',
      pageUrl: String(p.pageURL || x.pageUrl || ''),
      frameUrl: String(p.frameURL || ''),
      selectionText: String(p.selectionText || ''),
      linkUrl: String(p.linkURL || ''),
      srcUrl: String(src || ''),
      mediaType: media,
      editable: !!p.isEditable,
    };
  }
  // What a click's context may carry across IPC (strings and a flag, bounded).
  function cleanContext(ctx) {
    var c = ctx || {};
    var str = function (v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; };
    var kind = c.kind === 'action' ? 'action' : 'page';
    var mediaType = ['image', 'video', 'audio'].indexOf(c.mediaType) !== -1 ? c.mediaType : '';
    return { kind: kind, pageUrl: str(c.pageUrl, 8192), frameUrl: str(c.frameUrl, 8192), selectionText: str(c.selectionText, 10000),
      linkUrl: str(c.linkUrl, 8192), srcUrl: str(c.srcUrl, 8192), mediaType: mediaType, editable: c.editable === true };
  }

  var api = {
    CONTEXTS: CONTEXTS, TYPES: TYPES, ACTION_MENU_TOP_LEVEL_LIMIT: ACTION_MENU_TOP_LEVEL_LIMIT,
    parsePattern: parsePattern, matchPattern: matchPattern, cleanProps: cleanProps,
    create: create, update: update, remove: remove, find: find, click: click,
    visibleTree: visibleTree, clickInfo: clickInfo, pageContext: pageContext, cleanContext: cleanContext,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.VexExtMenuModel = api;
})();
