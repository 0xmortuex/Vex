// === Vex Toolbox packs — declarative tools ===============================
// The Toolbox's hand-built tools (regex, JSON, hash…) each have their own
// screen in toolbox.js. Everything else is declared here as data and run by
// one shared screen (Toolbox._runSpec): a tool lists its inputs and a pure
// `run` function that turns them into a result. Packs live in
// js/toolbox-pack-*.js and register with ToolboxPacks.add().
//
// Spec:
//   id        unique, kebab-case (checked against every other tool)
//   name      short title
//   icon      OPTIONAL. Either a VexIcons name (js/vex-icons.js) or short
//             typographic text that IS the tool (".*", "{ }", "Aa", "%").
//             Leave it out and the tool shows its family's icon — which is
//             what most tools should do. Never an emoji.
//   family    one of FAMILIES          desc  one line, what it does
//   keywords  optional extra search words
//   fields    inputs, in order: { id, label, type, value?, options?, placeholder?, min?, max?, step? }
//             type: 'text' | 'textarea' | 'number' | 'select' | 'date' |
//                   'time' | 'checkbox' | 'color'
//             select options: [[value, label], ...]
//   run(v)    v = { fieldId: value } — numbers arrive as Number (NaN when
//             empty), checkboxes as boolean, everything else as string.
//             Returns a string, or rows [[label, value], ...] for a table.
//             Throws Error('plain-language reason') for input it can't use;
//             the message is shown to the user.
//   examples  at least one: { in: {...}, out: string|rows } for an exact
//             result, or { in, match: /regex/ } for random or time-dependent
//             ones. tests/renderer/toolboxPacks.test.js runs every example.
const ToolboxPacks = {
  FAMILIES: {
    text:     { label: 'Text',           icon: 'type' },
    write:    { label: 'Writing',        icon: 'edit' },
    dev:      { label: 'Developer',      icon: 'code' },
    data:     { label: 'Data',           icon: 'database' },
    web:      { label: 'Web & Network',  icon: 'globe' },
    security: { label: 'Security',       icon: 'shield' },
    design:   { label: 'Design & Color', icon: 'palette' },
    convert:  { label: 'Unit Converters', icon: 'swap' },
    math:     { label: 'Math',           icon: 'calculator' },
    science:  { label: 'Science',        icon: 'flask' },
    finance:  { label: 'Money',          icon: 'coins' },
    business: { label: 'Business',       icon: 'chart-line' },
    date:     { label: 'Date & Time',    icon: 'calendar' },
    health:   { label: 'Health',         icon: 'heart' },
    generate: { label: 'Generators',     icon: 'dice' },
    general:  { label: 'Everyday',       icon: 'star' },
  },

  specs: [],

  // Register a pack. Malformed specs are rejected loudly — a broken tool
  // should fail at startup and in the tests, not when someone opens it.
  add(list) {
    if (!Array.isArray(list)) throw new Error('ToolboxPacks.add expects an array of tool specs');
    for (const s of list) {
      const where = `Toolbox tool "${s && s.id}"`;
      if (!s || typeof s.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.id)) throw new Error(`${where}: id must be kebab-case`);
      if (!s.name || !s.desc) throw new Error(`${where}: needs a name and a desc`);
      if (!this.FAMILIES[s.family]) throw new Error(`${where}: unknown family "${s.family}"`);
      if (!Array.isArray(s.fields) || typeof s.run !== 'function') throw new Error(`${where}: needs fields[] and run()`);
      if (!Array.isArray(s.examples) || !s.examples.length) throw new Error(`${where}: needs at least one example`);
      if (this.specs.some(t => t.id === s.id)) throw new Error(`${where}: duplicate id`);
      this.specs.push(s);
    }
  },

  // Turn raw field values (strings from the form) into what run() receives.
  coerce(spec, raw) {
    const v = {};
    for (const f of spec.fields) {
      const x = raw[f.id];
      if (f.type === 'number') v[f.id] = x === '' || x == null ? NaN : Number(x);
      else if (f.type === 'checkbox') v[f.id] = !!x;
      else v[f.id] = x == null ? '' : String(x);
    }
    return v;
  },

  // The field defaults, as run() would receive them.
  defaults(spec) {
    const raw = {};
    for (const f of spec.fields) raw[f.id] = f.value !== undefined ? f.value : (f.type === 'checkbox' ? false : (f.type === 'select' && f.options ? f.options[0][0] : ''));
    return this.coerce(spec, raw);
  },

  // A result as plain text (for Copy and for tests).
  asText(out) {
    if (Array.isArray(out)) return out.map(([k, val]) => `${k}: ${val}`).join('\n');
    return String(out);
  },
};

if (typeof window !== 'undefined') window.ToolboxPacks = ToolboxPacks;
if (typeof module !== 'undefined' && module.exports) module.exports = { ToolboxPacks };
