// === Vex Icons ============================================================
// One small, hand-drawn line-icon set for the whole UI, so nothing in Vex has
// to fall back on an emoji. Every icon is drawn from primitives (circle, rect,
// line, polyline, path) on a 24x24 grid with ~2.5px of optical padding, and is
// stroked in `currentColor` with no fill — so an icon takes the colour of
// whatever renders it and works on every theme and look without a second copy.
//
// Public API:
//   VexIcons.svg(name, { size = 16, className })  -> '<svg …>' string, or ''
//   VexIcons.markup(value, opts)                  -> svg for a known name,
//                                                    otherwise `value` unchanged
//   VexIcons.has(name)                            -> boolean
//   VexIcons.names()                              -> sorted array of every name
//
// An unknown name returns '' AND warns on the console — a typo must be loud in
// development rather than quietly leaving a blank square in the UI.
//
// Adding an icon: keep the 24x24 box, 1.75 stroke, round caps/joins, and no
// fill except tiny dots (which use fill="currentColor" stroke="none"). Names
// are lowercase kebab-case and describe the THING, not the feature that uses
// it, so one icon can serve several call sites.

const VexIcons = {
  STROKE: 1.75,

  // name -> the inner markup of a 24x24 icon.
  icons: {
    // --- arrows, state, feedback ---------------------------------------
    'arrow-left':   '<path d="M20 12H4.5"/><path d="m10.5 6-6 6 6 6"/>',
    'arrow-right':  '<path d="M4 12h15.5"/><path d="m13.5 6 6 6-6 6"/>',
    'check':        '<path d="m4.5 12.5 4.8 4.8L19.5 7"/>',
    'x':            '<path d="M6 6l12 12M18 6 6 18"/>',
    'plus':         '<path d="M12 5v14M5 12h14"/>',
    'minus':        '<path d="M5 12h14"/>',
    'undo':         '<path d="M4.5 10.5h10a5 5 0 0 1 0 10H9"/><path d="m8.5 6-4 4.5 4 4.5"/>',
    'refresh':      '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20.2 4v4.6h-4.6"/>',
    'swap':         '<path d="M4 8.5h13"/><path d="M13.5 5 17 8.5 13.5 12"/><path d="M20 15.5H7"/><path d="M10.5 12 7 15.5 10.5 19"/>',
    'shuffle':      '<path d="M3.5 6.5h3.2l10.6 11h3.2M3.5 17.5h3.2L17.3 6.5h3.2"/><path d="m17.8 3.8 2.7 2.7-2.7 2.7M17.8 14.8l2.7 2.7-2.7 2.7"/>',
    'download':     '<path d="M12 4v10.5"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4.5 19.5h15"/>',
    'upload':       '<path d="M12 20V9.5"/><path d="m7.5 13.5 4.5-4.5 4.5 4.5"/><path d="M4.5 4.5h15"/>',
    'warning':      '<path d="M12 4.2 21 20H3z"/><path d="M12 10v4.4"/><circle cx="12" cy="17.5" r=".95" fill="currentColor" stroke="none"/>',
    'info':         '<circle cx="12" cy="12" r="8.5"/><path d="M12 11.4V16.4"/><circle cx="12" cy="8" r=".95" fill="currentColor" stroke="none"/>',

    // --- navigation, places --------------------------------------------
    'search':       '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    'globe':        '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.6 2.4 14.4 0 17M12 3.5c-2.4 2.6-2.4 14.4 0 17"/>',
    'home':         '<path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H5.5A1.5 1.5 0 0 1 4 19z"/>',
    'compass':      '<circle cx="12" cy="12" r="8.5"/><path d="M15.6 8.4 13.6 13.6 8.4 15.6l2-5.2z"/>',
    'map':          '<path d="m3.5 6.5 5.5-2.5 6 2.5 5.5-2.5v13l-5.5 2.5-6-2.5-5.5 2.5z"/><path d="M9 4v13M15 6.5v13"/>',
    'pin':          '<path d="M12 20.8s6.4-6 6.4-10.4a6.4 6.4 0 1 0-12.8 0C5.6 14.8 12 20.8 12 20.8z"/><circle cx="12" cy="10.2" r="2.4"/>',
    'link':         '<path d="M10.2 13.8a4.2 4.2 0 0 0 5.9 0l2.6-2.6a4.2 4.2 0 0 0-5.9-5.9l-1.3 1.3"/><path d="M13.8 10.2a4.2 4.2 0 0 0-5.9 0l-2.6 2.6a4.2 4.2 0 0 0 5.9 5.9l1.3-1.3"/>',
    'rocket':       '<path d="M13.4 16.6 7.4 10.6c.9-4.6 4.7-8.1 9.4-8.1h4.3v4.3c0 4.7-3.5 8.5-8.1 9.4z"/><circle cx="15" cy="9" r="2"/><path d="M7.6 14.6c-2 .8-3.1 2.9-3.6 6.1 3.2-.5 5.3-1.6 6.1-3.6"/>',

    // --- documents, storage --------------------------------------------
    'file':         '<path d="M6 3.5h7l5 5v12H6z"/><path d="M13 3.5v5h5"/>',
    'note':         '<path d="M5.5 4.5h13v10l-5 5h-8z"/><path d="M18.5 14.5h-5v5"/><path d="M8.5 9h7M8.5 12h4"/>',
    'edit':         '<path d="m4.5 19.5 1-4L15 6l3 3-9.5 9.5z"/><path d="m13.6 7.4 3 3"/>',
    'folder':       '<path d="M3.5 6h6l2 2.5h9v10h-17z"/>',
    'folder-open':  '<path d="M3.5 6h6l2 2.5h7V11"/><path d="M3.5 19h14l3-8H6.5z"/>',
    'book':         '<path d="M5 18.8V6a2.5 2.5 0 0 1 2.5-2.5H19v13.5H7.5A2.5 2.5 0 0 0 5 20.5h14"/>',
    'book-open':    '<path d="M12 7.5C10.3 6 8.2 5.3 4 5.3v12.4c4.2 0 6.3.7 8 2.2 1.7-1.5 3.8-2.2 8-2.2V5.3c-4.2 0-6.3.7-8 2.2z"/><path d="M12 7.5V19.9"/>',
    'newspaper':    '<path d="M3.5 6h14v13.5h-14z"/><path d="M17.5 9.5h3v8a2 2 0 0 1-3 1.7"/><path d="M6.5 9.5h8M6.5 13h8M6.5 16.5h5"/>',
    'clipboard':    '<path d="M9 4.8H7A1.5 1.5 0 0 0 5.5 6.3V19A1.5 1.5 0 0 0 7 20.5h10A1.5 1.5 0 0 0 18.5 19V6.3A1.5 1.5 0 0 0 17 4.8h-2"/><rect x="9" y="2.9" width="6" height="3.8" rx="1.2"/>',
    'copy':         '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
    'receipt':      '<path d="M6 3.5h12v17.2l-2.4-1.6-2.4 1.6-2.4-1.6-2.4 1.6L6 20.7z"/><path d="M9 8.2h6M9 11.8h6"/>',
    'box':          '<path d="M3.5 8 12 3.8 20.5 8v8L12 20.2 3.5 16z"/><path d="M3.5 8 12 12.2 20.5 8M12 12.2v8"/>',
    'database':     '<ellipse cx="12" cy="6" rx="7.5" ry="2.8"/><path d="M4.5 6v12c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8V6"/><path d="M4.5 12c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8"/>',
    'save':         '<path d="M4.5 4.5h12l3 3v12h-15z"/><path d="M8 4.5v5h7v-5M8 19.5v-6h8v6"/>',
    'bookmark':     '<path d="M6.5 3.5h11v17L12 16.3 6.5 20.5z"/>',
    'star':         '<path d="m12 3.4 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.4l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    'tag':          '<path d="M11.3 3.5H3.5v7.8l9.2 9.2 7.8-7.8z"/><circle cx="7.4" cy="7.4" r="1.5"/>',
    'trash':        '<path d="M4.5 6.5h15"/><path d="M9 6.5V4.2h6v2.3"/><path d="m6.6 6.5 1 14h8.8l1-14"/><path d="M10.3 10v7M13.7 10v7"/>',
    'archive':      '<rect x="3" y="4" width="18" height="4.5" rx="1.5"/><path d="M5 8.5V20h14V8.5"/><path d="M9.8 12.5h4.4"/>',

    // --- media ----------------------------------------------------------
    'play':         '<path d="M7.5 4.6 19.2 12 7.5 19.4z"/>',
    'pause':        '<path d="M9 4.8v14.4M15 4.8v14.4"/>',
    'stop':         '<rect x="5.5" y="5.5" width="13" height="13" rx="2"/>',
    'skip':         '<path d="M6 5.2 15 12l-9 6.8z"/><path d="M18.2 5.2v13.6"/>',
    'fast-forward': '<path d="m3.5 6 7 6-7 6z"/><path d="m12.5 6 7 6-7 6z"/>',
    'volume':       '<path d="M4.5 9.3h3L12 5.2v13.6l-4.5-4.1h-3z"/><path d="M15.4 9.2a4.2 4.2 0 0 1 0 5.6M18.2 6.6a8 8 0 0 1 0 10.8"/>',
    'mute':         '<path d="M4.5 9.3h3L12 5.2v13.6l-4.5-4.1h-3z"/><path d="m15.5 9.5 5 5M20.5 9.5l-5 5"/>',
    'headphones':   '<path d="M4.5 15.2v-2.7a7.5 7.5 0 0 1 15 0v2.7"/><path d="M4.5 14.5h2A1.5 1.5 0 0 1 8 16v2.6a1.5 1.5 0 0 1-1.5 1.5h-2zM19.5 14.5h-2A1.5 1.5 0 0 0 16 16v2.6a1.5 1.5 0 0 0 1.5 1.5h2z"/>',
    'mic':          '<rect x="9" y="2.8" width="6" height="11.2" rx="3"/><path d="M5.6 11.6a6.4 6.4 0 0 0 12.8 0"/><path d="M12 18v3.2M9 21.2h6"/>',
    'camera':       '<path d="M3.5 7.5h4L9 5h6l1.5 2.5h4v12h-17z"/><circle cx="12" cy="13.3" r="3.6"/>',
    'image':        '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="8.7" cy="9.6" r="1.6"/><path d="m4 17.5 5-5 4.4 4.4 2.9-2.9 4.2 4.2"/>',
    'video':        '<rect x="3" y="5.5" width="12.5" height="13" rx="2"/><path d="m15.5 10.5 5.5-3v9l-5.5-3z"/>',
    'tv':           '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="m8.4 2.6 3.6 3.4 3.6-3.4"/><path d="M8 21h8"/>',
    'music':        '<circle cx="6.4" cy="17.6" r="2.8"/><circle cx="17.6" cy="15.6" r="2.8"/><path d="M9.2 17.6V6.2l11.2-2.2v11.6"/>',

    // --- windows, tabs, layout ------------------------------------------
    'tabs':         '<rect x="3" y="8.8" width="18" height="11.2" rx="2"/><path d="M7 8.8V6.4A1.6 1.6 0 0 1 8.6 4.8h4A1.6 1.6 0 0 1 14.2 6.4v2.4"/>',
    'window':       '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M3 9h18"/><circle cx="6.4" cy="6.8" r=".85" fill="currentColor" stroke="none"/><circle cx="9.2" cy="6.8" r=".85" fill="currentColor" stroke="none"/>',
    'split':        '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M12 4.5v15"/>',
    'sidebar':      '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M9 4.5v15"/>',
    'grid':         '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    'list':         '<path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11"/><circle cx="4.8" cy="6.5" r="1" fill="currentColor" stroke="none"/><circle cx="4.8" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4.8" cy="17.5" r="1" fill="currentColor" stroke="none"/>',
    'filter':       '<path d="M3.5 5h17l-6.6 7.6v6.4l-3.8 2v-8.4z"/>',
    'compress':     '<path d="M3.5 12h17"/><path d="m8.5 7.5 3.5-3.5 3.5 3.5"/><path d="m8.5 16.5 3.5 3.5 3.5-3.5"/>',
    'monitor':      '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M12 16.5v3.6M8 20.1h8"/>',
    'maximize':     '<path d="M8.6 3.6H3.6v5M15.4 3.6h5v5M8.6 20.4H3.6v-5M15.4 20.4h5v-5"/>',
    'keyboard':     '<rect x="2.5" y="6" width="19" height="12" rx="2.2"/><path d="M6 9.6h.01M9.6 9.6h.01M13.2 9.6h.01M16.8 9.6h.01M6 12.9h.01M9.6 12.9h.01M13.2 12.9h.01M16.8 12.9h.01M8 15.8h8"/>',
    'phone':        '<rect x="6.5" y="2.8" width="11" height="18.4" rx="2.5"/><path d="M10.4 18.4h3.2"/>',

    // --- security, privacy ----------------------------------------------
    'shield':       '<path d="M12 3.2 19.5 6v6c0 4.4-3.1 7.6-7.5 9-4.4-1.4-7.5-4.6-7.5-9V6z"/>',
    'lock':         '<rect x="4.5" y="10" width="15" height="10.5" rx="2.2"/><path d="M8 10V7.6a4 4 0 0 1 8 0V10"/>',
    'unlock':       '<rect x="4.5" y="10" width="15" height="10.5" rx="2.2"/><path d="M8 10V7.6a4 4 0 0 1 7.7-1.5"/>',
    'key':          '<circle cx="8" cy="14" r="4.6"/><path d="m11.4 10.8 8.2-8.2M17.1 5.1l2.2 2.2M14.8 7.4 17 9.6"/>',
    'eye':          '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    'incognito':    '<path d="M3.2 12h17.6"/><path d="M6 12 7.8 6.1A2.2 2.2 0 0 1 9.9 4.6h4.2a2.2 2.2 0 0 1 2.1 1.5L18 12"/><circle cx="7.4" cy="16" r="3.4"/><circle cx="16.6" cy="16" r="3.4"/>',
    'onion':        '<path d="M12 3.2c2.6 3 7 4.6 7 9.3a7 7 0 0 1-14 0c0-4.7 4.4-6.3 7-9.3z"/><path d="M12 8.6c1.3 1.6 2.2 2.6 2.2 4.4a2.2 2.2 0 0 1-4.4 0c0-1.8.9-2.8 2.2-4.4z"/>',
    'fingerprint':  '<path d="M12 3.5a8.5 8.5 0 0 0-8.5 8.5v2"/><path d="M20.5 12a8.5 8.5 0 0 0-4.2-7.3"/><path d="M7.5 12a4.5 4.5 0 0 1 9 0v3.5"/><path d="M12 12v5.5"/><path d="M16.3 18.8a8.6 8.6 0 0 1-1 1.7"/><path d="M6.6 17.8A8.5 8.5 0 0 0 8 20.5"/>',

    // --- tools -----------------------------------------------------------
    'settings':     '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.9 1.9M7.4 16.6l-1.9 1.9M18.5 18.5l-1.9-1.9M7.4 7.4 5.5 5.5"/>',
    'sliders':      '<path d="M5 3.5v6M5 14.5v6M12 3.5v3M12 11.5v9M19 3.5v9M19 17.5v3"/><circle cx="5" cy="12" r="2.4"/><circle cx="12" cy="9" r="2.4"/><circle cx="19" cy="15" r="2.4"/>',
    'wrench':       '<path d="M20.1 6.6a5.5 5.5 0 0 1-7.1 7.1l-6 6a2.2 2.2 0 0 1-3.1-3.1l6-6a5.5 5.5 0 0 1 7.1-7.1l-3.2 3.2 3.1 3.1z"/>',
    'hammer':       '<path d="M3.8 7.4 7.4 3.8l4.3 4.3-3.6 3.6z"/><path d="m9.7 9.7 9 9a2.2 2.2 0 0 1-3.1 3.1l-9-9"/>',
    'toolbox':      '<rect x="3" y="8" width="18" height="11.8" rx="2"/><path d="M8.5 8V5.9A1.9 1.9 0 0 1 10.4 4h3.2A1.9 1.9 0 0 1 15.5 5.9V8"/><path d="M3 13h18M10.5 11.4v3.2M13.5 11.4v3.2"/>',
    'puzzle':       '<path d="M4.5 9.6h2.2a1.85 1.85 0 1 0 0-3.7V4.5h5.4v1.4a1.85 1.85 0 1 0 3.7 0V4.5h3.7v4h-1.4a1.85 1.85 0 1 0 0 3.7h1.4v7.3h-7.3v-1.4a1.85 1.85 0 1 0-3.7 0v1.4H4.5z"/>',
    'terminal':     '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="m7.5 9.6 3 2.4-3 2.4M13 14.9h4"/>',
    'code':         '<path d="m8.4 7.4-5 4.6 5 4.6M15.6 7.4l5 4.6-5 4.6M13.6 4.4l-3.2 15.2"/>',
    'braces':       '<path d="M9.6 4.5H9A2.5 2.5 0 0 0 6.5 7v2.5A2.5 2.5 0 0 1 4 12a2.5 2.5 0 0 1 2.5 2.5V17A2.5 2.5 0 0 0 9 19.5h.6"/><path d="M14.4 4.5h.6A2.5 2.5 0 0 1 17.5 7v2.5A2.5 2.5 0 0 0 20 12a2.5 2.5 0 0 0-2.5 2.5V17a2.5 2.5 0 0 1-2.5 2.5h-.6"/>',
    'hash':         '<path d="M9.4 3.8 7.8 20.2M16.2 3.8l-1.6 16.4M4.4 9h15.2M3.8 15H19"/>',
    'calculator':   '<rect x="4.5" y="2.8" width="15" height="18.4" rx="2.2"/><rect x="7.5" y="5.8" width="9" height="3.4" rx="1.2"/><path d="M8 13h.01M12 13h.01M16 13h.01M8 17.2h.01M12 17.2h.01M16 17.2h.01"/>',
    'ruler':        '<path d="M3.4 14.4 14.4 3.4l6.2 6.2-11 11z"/><path d="m6.9 10.9 2.1 2.1M9.9 7.9l2.1 2.1M12.9 4.9 15 7"/>',
    'flask':        '<path d="M9.4 3.5h5.2M10.6 3.5v6L5.3 18a2 2 0 0 0 1.7 3h10a2 2 0 0 0 1.7-3l-5.3-8.5v-6"/><path d="M7.7 14.2h8.6"/>',
    'atom':         '<circle cx="12" cy="12" r="2"/><ellipse cx="12" cy="12" rx="9" ry="3.9"/><ellipse cx="12" cy="12" rx="9" ry="3.9" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.9" transform="rotate(120 12 12)"/>',
    'magnet':       '<path d="M6 3.5H3.5v8.5a8.5 8.5 0 0 0 17 0V3.5H18v8.5a6 6 0 0 1-12 0z"/><path d="M3.5 8.5H6M18 8.5h2.5"/>',
    'broom':        '<path d="M19.5 4.5 12 12"/><path d="M13.2 10.3 6.8 16.8 8.4 20.5h8.4L18 14.2z"/><path d="m9.4 15 2.8 3.4M12.6 12.6l2.8 3.4"/>',
    'scissors':     '<circle cx="6.5" cy="6.5" r="2.8"/><circle cx="6.5" cy="17.5" r="2.8"/><path d="M8.9 8.1 20 19.2M8.9 15.9 20 4.8"/>',
    'marker':       '<path d="M14.6 3.6 20.4 9.4 11.2 18.6H5.4v-5.8z"/><path d="m11.7 6.5 5.8 5.8"/><path d="M3.5 21.5h17"/>',
    'plug':         '<path d="M9 3.5v5M15 3.5v5"/><path d="M6 8.5h12V11a6 6 0 0 1-12 0z"/><path d="M12 17v3.5"/>',
    'battery':      '<rect x="2.5" y="7.5" width="16" height="9" rx="2.2"/><path d="M21.5 10.5v3"/><path d="M5.5 10.5h4.5v3H5.5z"/>',
    'wifi':         '<path d="M2.6 8.9a13.8 13.8 0 0 1 18.8 0"/><path d="M6 12.5a8.9 8.9 0 0 1 12 0"/><path d="M9.3 16a4.4 4.4 0 0 1 5.4 0"/><circle cx="12" cy="19.4" r="1.1" fill="currentColor" stroke="none"/>',
    'cpu':          '<rect x="5.5" y="5.5" width="13" height="13" rx="2.2"/><rect x="9.6" y="9.6" width="4.8" height="4.8" rx="1.2"/><path d="M9 2.6v2.9M15 2.6v2.9M9 18.5v2.9M15 18.5v2.9M2.6 9h2.9M2.6 15h2.9M18.5 9h2.9M18.5 15h2.9"/>',

    // --- people, AI -------------------------------------------------------
    'user':         '<circle cx="12" cy="8" r="4"/><path d="M4.6 20.5a7.4 7.4 0 0 1 14.8 0"/>',
    'users':        '<circle cx="9.4" cy="8" r="3.5"/><path d="M3 20.5a6.4 6.4 0 0 1 12.8 0"/><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M17.6 14.7a6.4 6.4 0 0 1 3.4 5.8"/>',
    'mask':         '<path d="M3.5 7.4c0-1.5 1-2.4 2.5-2.4h12c1.5 0 2.5.9 2.5 2.4 0 6-3.5 11.6-8.5 11.6S3.5 13.4 3.5 7.4z"/><circle cx="8.8" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.2" cy="10" r="1.2" fill="currentColor" stroke="none"/><path d="M9.4 14.4c1.6 1.2 3.6 1.2 5.2 0"/>',
    'robot':        '<rect x="4" y="7.5" width="16" height="12.2" rx="3"/><path d="M12 4.6v2.9"/><circle cx="12" cy="3.4" r="1.3"/><circle cx="9.2" cy="13" r="1.3" fill="currentColor" stroke="none"/><circle cx="14.8" cy="13" r="1.3" fill="currentColor" stroke="none"/><path d="M9.6 16.6h4.8"/>',
    'brain':        '<path d="M12 5.4a3 3 0 0 0-5.6-1.5A2.9 2.9 0 0 0 4 8.3a3 3 0 0 0-.2 4.6A3 3 0 0 0 5.9 18a3 3 0 0 0 6.1.9z"/><path d="M12 5.4a3 3 0 0 1 5.6-1.5A2.9 2.9 0 0 1 20 8.3a3 3 0 0 1 .2 4.6A3 3 0 0 1 18.1 18a3 3 0 0 1-6.1.9z"/><path d="M12 5.4v13.5"/>',
    'sparkles':     '<path d="m11 3.4 1.8 4.8 4.8 1.8-4.8 1.8L11 16.6 9.2 11.8 4.4 10l4.8-1.8z"/><path d="m18.4 14.6.85 2.15 2.15.85-2.15.85-.85 2.15-.85-2.15-2.15-.85 2.15-.85z"/>',
    'wand':         '<path d="M3.8 20.2 14.2 9.8"/><path d="m14.4 3.4 1.2 2.8 2.8 1.2-2.8 1.2-1.2 2.8-1.2-2.8-2.8-1.2 2.8-1.2z"/><path d="m19.7 13.6.75 1.7 1.7.75-1.7.75-.75 1.7-.75-1.7-1.7-.75 1.7-.75z"/>',

    // --- time -------------------------------------------------------------
    'clock':        '<circle cx="12" cy="12" r="8.5"/><path d="M12 6.8V12l3.6 2.2"/>',
    'history':      '<path d="M3.6 12a8.4 8.4 0 1 0 2.6-6.1"/><path d="M3.5 3.6v4.6h4.6"/><path d="M12 7.6V12l3.4 2"/>',
    'calendar':     '<rect x="3.5" y="5.5" width="17" height="15" rx="2"/><path d="M3.5 10.2h17M8 3.4v4M16 3.4v4"/>',
    'alarm':        '<circle cx="12" cy="13.6" r="7.4"/><path d="M12 9.4v4.2l2.8 1.7"/><path d="M4.6 5 7.6 2.6M19.4 5l-3-2.4"/>',
    'timer':        '<circle cx="12" cy="13.6" r="7.4"/><path d="M12 13.6V9.2M9.4 2.6h5.2"/>',

    // --- comms ------------------------------------------------------------
    'mail':         '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.6 7.4 8.4 5.9 8.4-5.9"/>',
    'message':      '<path d="M20.5 15.4a2 2 0 0 1-2 2H8.2l-4.7 4V5.6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/>',
    'bell':         '<path d="M6.4 10a5.6 5.6 0 0 1 11.2 0c0 5 2 6.6 2 6.6H4.4S6.4 15 6.4 10z"/><path d="M9.9 19.4a2.4 2.4 0 0 0 4.2 0"/>',
    'send':         '<path d="M21 3.4 2.6 10.2l7.6 3 3.2 7.4z"/><path d="M10.2 13.2 21 3.4"/>',

    // --- nature, weather ---------------------------------------------------
    'sun':          '<circle cx="12" cy="12" r="4.3"/><path d="M12 2.6v2.4M12 19v2.4M21.4 12H19M5 12H2.6M18.6 5.4 17 7M7 17l-1.6 1.6M18.6 18.6 17 17M7 7 5.4 5.4"/>',
    'moon':         '<path d="M20.2 14.6A8.4 8.4 0 0 1 9.4 3.8 8.5 8.5 0 1 0 20.2 14.6z"/>',
    'sleep':        '<path d="M20.4 15A7.8 7.8 0 0 1 9 4.2 8.4 8.4 0 1 0 20.4 15z"/><path d="M13.6 2.6h4.8l-4.8 4.8h4.8"/>',
    'flame':        '<path d="M12 20.8c3.6 0 6.4-2.6 6.4-6 0-4.5-4.2-6.5-3.9-11.6-2.7 1.4-4.4 4-4.4 6.4 0 1.6-1 2.4-1.9 1.6-.7-.6-.9-1.6-.9-2.5C5.8 10.4 5.6 12.6 5.6 14.8c0 3.4 2.8 6 6.4 6z"/>',
    'zap':          '<path d="M13.6 2.6 5 13.4h6l-.6 8L19 10.6h-6z"/>',
    'bulb':         '<path d="M9.2 18h5.6M10 21h4"/><path d="M12 2.8a6.2 6.2 0 0 0-3.6 11.2c.6.5 1 1.2 1 2h5.2c0-.8.4-1.5 1-2A6.2 6.2 0 0 0 12 2.8z"/>',
    'droplet':      '<path d="M12 3.2c3.3 4 6.2 6.4 6.2 10a6.2 6.2 0 1 1-12.4 0c0-3.6 2.9-6 6.2-10z"/>',
    'leaf':         '<path d="M20.4 3.6c0 9.1-5.6 15.6-13.1 15.6-1 0-2-.2-2.9-.5C3.8 11.6 8.4 3.6 20.4 3.6z"/><path d="M3.6 20.4 13.8 10.2"/>',
    'cloud':        '<path d="M7.2 19a4.6 4.6 0 0 1-.3-9.2 6.1 6.1 0 0 1 11.5 1.6A4 4 0 0 1 17.4 19z"/>',
    'wind':         '<path d="M3.5 8.6h9.6a3 3 0 1 0-3-3"/><path d="M3.5 15.4h12.6a3 3 0 1 1-3 3"/><path d="M3.5 12h6.6"/>',
    'thermometer':  '<path d="M14 14.8V5.4a2.5 2.5 0 0 0-5 0v9.4a4.6 4.6 0 1 0 5 0z"/><path d="M11.5 9.4v6.4"/>',
    'snowflake':    '<path d="M12 2.6v18.8M4 7.3l16 9.4M20 7.3 4 16.7"/><path d="m9.4 4.6 2.6 2.6 2.6-2.6M9.4 19.4l2.6-2.6 2.6 2.6"/>',

    // --- money, data, business ----------------------------------------------
    'chart-bar':    '<path d="M3.6 20.4h16.8"/><path d="M7.2 20.4v-6.8M12 20.4V5.8M16.8 20.4v-9.6"/>',
    'chart-line':   '<path d="M3.6 3.6v16.8h16.8"/><path d="m7 15.4 4-4.6 3 2.6 5.4-6.6"/>',
    'percent':      '<circle cx="7.5" cy="7.5" r="3"/><circle cx="16.5" cy="16.5" r="3"/><path d="M19 5 5 19"/>',
    'coins':        '<circle cx="9" cy="9" r="5.5"/><path d="M14.4 8.2a5.5 5.5 0 1 1-6.2 6.2"/>',
    'card':         '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M6.6 14.6h4"/>',
    'cart':         '<circle cx="9.6" cy="19.8" r="1.5"/><circle cx="17.4" cy="19.8" r="1.5"/><path d="M2.6 3.6h2.8l2.6 11.4h10.4l2.2-8.4H6.4"/>',
    'scale':        '<path d="M12 4.4v15.6M7.6 20.4h8.8"/><path d="m12 7-7.5 2.2M12 7l7.5 2.2"/><path d="M2 14.2 4.5 8.7 7 14.2a2.5 2.5 0 0 1-5 0zM17 14.2l2.5-5.5 2.5 5.5a2.5 2.5 0 0 1-5 0z"/>',
    'target':       '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.8"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
    'flag':         '<path d="M5.6 21V3.4"/><path d="M5.6 4.4h11l-2 3.6 2 3.6h-11z"/>',
    'gift':         '<rect x="3.4" y="8.8" width="17.2" height="4.4" rx="1"/><path d="M5.2 13.2v7.4h13.6v-7.4"/><path d="M12 8.8v11.8"/><path d="M12 8.8S10.6 4.2 8.2 4.2a2.3 2.3 0 0 0 0 4.6zM12 8.8s1.4-4.6 3.8-4.6a2.3 2.3 0 0 1 0 4.6z"/>',
    'graduation':   '<path d="m12 3.6 9.4 4.4-9.4 4.4-9.4-4.4z"/><path d="M6.6 10.4V16c0 1.7 2.4 3 5.4 3s5.4-1.3 5.4-3v-5.6"/><path d="M21.4 8v5.6"/>',
    'briefcase':    '<rect x="3" y="7" width="18" height="12.6" rx="2"/><path d="M8.6 7V5.6A1.6 1.6 0 0 1 10.2 4h3.6a1.6 1.6 0 0 1 1.6 1.6V7"/><path d="M3 12h18"/>',
    'heart':        '<path d="M12 20.4S3.6 15.2 3.6 9.4a4.9 4.9 0 0 1 8.4-3.4 4.9 4.9 0 0 1 8.4 3.4c0 5.8-8.4 11-8.4 11z"/>',
    'activity':     '<path d="M2.6 12h4l2.6-7.2 5 14.4 2.6-7.2h4.6"/>',
    'stethoscope':  '<path d="M5.4 3.4v5a4.6 4.6 0 0 0 9.2 0v-5"/><path d="M3.8 3.4h3.2M13 3.4h3.2"/><path d="M10 13v1.8a5 5 0 0 0 10 0v-1.4"/><circle cx="20" cy="11" r="2.3"/>',
    'coffee':       '<path d="M3.8 8h13.4v7.2a5 5 0 0 1-5 5H8.8a5 5 0 0 1-5-5z"/><path d="M17.2 9.6H19a2.8 2.8 0 0 1 0 5.6h-1.8"/><path d="M7.8 2.6v2.6M12 2.6v2.6"/>',
    'dice':         '<rect x="4" y="4" width="16" height="16" rx="3.2"/><circle cx="8.8" cy="8.8" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.2" cy="15.2" r="1.3" fill="currentColor" stroke="none"/>',
    'palette':      '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.4 0 2.3-.9 2.3-2.1 0-.6-.2-1-.6-1.4-.4-.4-.6-.8-.6-1.3 0-1 .9-1.9 1.9-1.9h2.2a4.8 4.8 0 0 0 4.3-4.8c0-3.2-4-5.5-9.5-5.5z"/><circle cx="7.8" cy="11.6" r="1.2" fill="currentColor" stroke="none"/><circle cx="10.6" cy="7.6" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.4" cy="8.2" r="1.2" fill="currentColor" stroke="none"/>',
    'type':         '<path d="M4.8 7V4.5h14.4V7M12 4.5v15M8.4 19.5h7.2"/>',
    'gamepad':      '<rect x="2.5" y="7.4" width="19" height="11.2" rx="4"/><path d="M7.2 11v3.2M5.6 12.6h3.2"/><circle cx="16" cy="11.8" r="1.15" fill="currentColor" stroke="none"/><circle cx="18.4" cy="14.2" r="1.15" fill="currentColor" stroke="none"/>',
    'git':          '<circle cx="6.4" cy="5.8" r="2.8"/><circle cx="6.4" cy="18.2" r="2.8"/><circle cx="17.2" cy="7.8" r="2.8"/><path d="M6.4 8.6v6.8M17.2 10.6c0 3.4-2.9 4.6-6.2 5"/>',
  },

  has(name) { return typeof name === 'string' && Object.prototype.hasOwnProperty.call(this.icons, name); },

  names() { return Object.keys(this.icons).sort(); },

  // The <svg> string for `name`. Unknown names return '' and warn — a missing
  // icon must be visible to whoever is working on the code, not a silent gap.
  svg(name, opts) {
    const o = opts || {};
    const inner = this.has(name) ? this.icons[name] : null;
    if (inner === null) {
      try { console.warn('[VexIcons] unknown icon name:', name); } catch {}
      return '';
    }
    const size = Number(o.size) > 0 ? Number(o.size) : 16;
    const cls = o.className ? ` class="vex-icon ${String(o.className).replace(/"/g, '')}"` : ' class="vex-icon"';
    return `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"`
      + ` stroke-width="${this.STROKE}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`
      + ` style="flex:none;display:inline-block;vertical-align:middle">${inner}</svg>`;
  },

  // For call sites whose `icon` field may hold either an icon name or already
  // -built markup (a favicon <img>, a typographic glyph like ".*"). A known
  // name becomes an <svg>; anything else is handed back untouched.
  markup(value, opts) {
    if (this.has(value)) return this.svg(value, opts);
    return value == null ? '' : String(value);
  },
};

if (typeof window !== 'undefined') window.VexIcons = VexIcons;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexIcons };
