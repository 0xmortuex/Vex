// === Vex Mobile — DOM helpers ===
//
// Three things every chrome module needs: find an element, build one, and put
// text that is not ours on screen safely. Page titles, URLs and the
// assistant's replies all end up in the chrome, and none of them are trusted —
// so nothing here has an innerHTML path that takes outside text.
//
// Every helper is a standalone function rather than a method. Modules pull
// them out with `const { el, icon } = VexDom`, and anything leaning on `this`
// would break the moment they did.

const VexDom = (() => {
  function $(id) {
    return document.getElementById(id);
  }

  // el('div', 'card', 'Hello') or el('div', { class: 'card', onclick: fn })
  function el(tag, options, text) {
    const node = document.createElement(tag);
    if (typeof options === 'string') {
      node.className = options;
    } else if (options) {
      for (const [key, value] of Object.entries(options)) {
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('on') && typeof value === 'function') node[key] = value;
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (value != null && value !== false) node.setAttribute(key, value === true ? '' : value);
      }
    }
    if (text != null) node.textContent = text;
    return node;
  }

  // <svg><use href="#i-name"/></svg> — the sprite lives in index.html.
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  // A favicon, falling back to the host's first letter.
  function favicon(entry, className = 'favicon') {
    if (entry && entry.icon) return el('img', { class: className, src: entry.icon, alt: '' });
    const host = entry && entry.url ? VexSearch.prettyHost(entry.url) : '';
    return el('span', { class: className }, (host[0] || '?').toUpperCase());
  }

  // Highlight the typed part of a suggestion, without building HTML.
  function highlight(text, query) {
    const node = el('span');
    const value = String(text == null ? '' : text);
    const needle = String(query || '').trim().toLowerCase();
    const at = needle ? value.toLowerCase().indexOf(needle) : -1;
    if (at < 0) {
      node.textContent = value;
      return node;
    }
    node.appendChild(document.createTextNode(value.slice(0, at)));
    node.appendChild(el('mark', null, value.slice(at, at + needle.length)));
    node.appendChild(document.createTextNode(value.slice(at + needle.length)));
    return node;
  }

  // "just now", "3 h ago", "yesterday", "12 Mar".
  function when(timestamp) {
    if (!timestamp) return '';
    const seconds = Math.max(0, (Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return Math.round(seconds / 60) + ' min ago';
    if (seconds < 86400) return Math.round(seconds / 3600) + ' h ago';
    if (seconds < 172800) return 'yesterday';
    return new Date(timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  function bytes(size) {
    if (!size) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = size, unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return (unit === 0 ? value : value.toFixed(1)) + ' ' + units[unit];
  }

  return { $, el, icon, clear, favicon, highlight, when, bytes };
})();

if (typeof window !== 'undefined') window.VexDom = VexDom;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDom };
