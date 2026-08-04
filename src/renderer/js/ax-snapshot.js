// === Vex AX Snapshot — accessibility tree as the agent's page model ===
//
// DOMExtractor gives the agent a flat list of up to 100 interactive elements
// with CSS selectors. That's enough to *act*, but it's a poor description of a
// page: it can't say that a button is disabled, that a checkbox is already
// checked, that a menu is collapsed, or how anything nests. The model ends up
// guessing, clicking disabled controls, and re-reading the page.
//
// The accessibility tree carries exactly that information, and it's what
// Claude for Chrome injects into every frame for the same reason. Chromium
// already computes it, so reading it is cheap.
//
// Division of labour, deliberately: the AX tree is how the agent *understands*
// the page; DOMExtractor's [data-vex-id] selectors remain how it *acts* on the
// page. AX nodes are addressed by backendDOMNodeId, which is not a selector,
// and correlating the two would be a guessy name-matching layer that breaks on
// any page with repeated labels. Two clear inputs beat one lossy merged one.
//
// Public API: AXSnapshot. flattenAXTree is exported for tests.

// Roles that carry no meaning for an agent — pure layout and text wrappers.
// Dropping them typically removes over half the tree.
const NOISE_ROLES = new Set([
  'none', 'presentation', 'generic', 'InlineTextBox', 'StaticText',
  'LineBreak', 'paragraph', 'group', 'Iframe',
]);

// States worth reporting. `focusable` and friends are omitted — too common to
// be informative, and they inflate the payload.
const USEFUL_STATES = ['disabled', 'checked', 'selected', 'expanded', 'required', 'invalid', 'pressed', 'level'];

function _val(node, key) {
  if (!node || !Array.isArray(node.properties)) return undefined;
  const p = node.properties.find(x => x && x.name === key);
  if (!p || !p.value) return undefined;
  const v = p.value.value;
  // Chromium reports tri-state booleans as 'false'/'true'/'mixed' strings and
  // genuine booleans as booleans; 'false' is noise either way.
  if (v === false || v === 'false' || v === '' || v == null) return undefined;
  return v;
}

// Turn the raw getFullAXTree node array into an indented, readable outline.
// Pure so the tests can pin the shape.
function flattenAXTree(nodes, opts = {}) {
  const maxLines = opts.maxLines || 400;
  const maxNameLen = opts.maxNameLen || 120;

  if (!Array.isArray(nodes) || !nodes.length) return { lines: [], truncated: false };

  const byId = new Map();
  for (const n of nodes) if (n && n.nodeId) byId.set(String(n.nodeId), n);

  // The first node Chromium returns is the root (RootWebArea).
  const root = nodes[0];
  const lines = [];
  let truncated = false;
  // Chromium shouldn't hand us a cycle, but a malformed tree must not spin the
  // renderer. The maxLines guard alone isn't enough — a cycle made entirely of
  // noise-role nodes emits no lines, so it would never trip.
  const seen = new Set();

  const walk = (node, depth) => {
    if (!node || lines.length >= maxLines) { if (node) truncated = true; return; }
    const key = String(node.nodeId);
    if (seen.has(key)) return;
    seen.add(key);

    const role = node.role && node.role.value ? String(node.role.value) : '';
    const name = node.name && node.name.value ? String(node.name.value).trim().replace(/\s+/g, ' ') : '';
    const value = node.value && node.value.value != null ? String(node.value.value).trim() : '';

    // An ignored or noise-role node contributes nothing itself, but its
    // children still might — so recurse without emitting a line.
    const skip = node.ignored === true || NOISE_ROLES.has(role) || (!role && !name);

    if (!skip) {
      let line = '  '.repeat(Math.min(depth, 12)) + role;
      if (name) {
        const short = name.length > maxNameLen ? name.slice(0, maxNameLen) + '…' : name;
        line += ` "${short}"`;
      }
      if (value) {
        const shortV = value.length > 60 ? value.slice(0, 60) + '…' : value;
        line += ` = "${shortV}"`;
      }
      const states = [];
      for (const s of USEFUL_STATES) {
        const v = _val(node, s);
        if (v !== undefined) states.push(v === true ? s : `${s}:${v}`);
      }
      if (states.length) line += ` [${states.join(', ')}]`;
      lines.push(line);
    }

    const kids = Array.isArray(node.childIds) ? node.childIds : [];
    for (const cid of kids) {
      const child = byId.get(String(cid));
      if (child) walk(child, skip ? depth : depth + 1);
    }
  };

  walk(root, 0);
  return { lines, truncated: truncated || lines.length >= maxLines };
}

const AXSnapshot = {
  _enabled: new Set(),

  available() { return !!(window.vex && window.vex.cdp); },

  _id(webview) {
    try {
      const id = webview && typeof webview.getWebContentsId === 'function' ? webview.getWebContentsId() : -1;
      return typeof id === 'number' && id > 0 ? id : null;
    } catch { return null; }
  },

  // Returns { ok, text, truncated } — an indented outline ready to drop into
  // the model's page context, or { ok:false, error } if CDP isn't usable on
  // this tab (DevTools open, guest not attached yet, etc.).
  async capture(webview, opts = {}) {
    if (!this.available()) return { ok: false, error: 'CDP bridge unavailable' };
    const id = this._id(webview);
    if (!id) return { ok: false, error: 'Tab is not ready yet' };

    if (!this._enabled.has(id)) {
      const en = await window.vex.cdp.send(id, 'Accessibility.enable', {});
      if (!en.ok) return en;
      this._enabled.add(id);
    }

    const res = await window.vex.cdp.send(id, 'Accessibility.getFullAXTree', {});
    if (!res.ok) return res;

    const nodes = res.result && res.result.nodes;
    const { lines, truncated } = flattenAXTree(nodes, opts);
    return {
      ok: true,
      text: lines.join('\n'),
      nodeCount: Array.isArray(nodes) ? nodes.length : 0,
      truncated,
    };
  },

  forget(webContentsId) { this._enabled.delete(webContentsId); },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { flattenAXTree, NOISE_ROLES };
}
