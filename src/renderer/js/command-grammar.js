// === The rules a Ctrl+K command and a shortcut have to follow (T2-041) ===========
//
// Written down in docs/COMMAND-GRAMMAR.md and enforced by tests/renderer/commandGrammar.test.js,
// which reads every command and shortcut in the source. This file holds the rules as plain
// functions so a test, and any code that adds a command, ask the same question.
//
//   CommandGrammar.lintCommand({ id, label, hint })  -> [problem, ...]  ([] = fine)
//   CommandGrammar.lintShortcuts(defaults, pageFirst) -> [problem, ...]
//   CommandGrammar.PREFIXES                           -> the characters that change how Ctrl+K reads a line
const CommandGrammar = {
  // Characters at the start of a Ctrl+K line that change what it means. A new one is added here
  // (and in the doc) first; the test fails on a duplicate.
  PREFIXES: [
    { char: '>', means: 'run a command only (js/command.js)' },
    { char: '@', means: 'search a site or a tab (js/search-shortcuts.js)' },
  ],
  ID: /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
  MAX_ID: 40,
  MAX_LABEL: 60,
  MAX_HINT: 220,
  EMOJI: /\p{Extended_Pictographic}/u,
  // Ctrl, Alt, Shift or Super in that order, then one key.
  COMBO: /^(?:Ctrl\+)?(?:Alt\+)?(?:Shift\+)?(?:Super\+)?(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|PageUp|PageDown|Delete|Tab|Home|End|Insert|Space|Enter|Escape)$/,

  lintCommand(c) {
    const out = [];
    if (!c || typeof c !== 'object') return ['not an object'];
    const id = c.id;
    if (typeof id !== 'string' || !this.ID.test(id)) out.push('the id "' + id + '" is not lowercase words joined by dashes');
    else if (id.length > this.MAX_ID) out.push('the id "' + id + '" is longer than ' + this.MAX_ID);
    const label = c.label;
    if (typeof label !== 'string' || !label.trim()) out.push('"' + id + '" has no label');
    else {
      if (label !== label.trim() || /\s{2,}/.test(label)) out.push('the label "' + label + '" has stray spaces');
      if (label.length > this.MAX_LABEL) out.push('the label "' + label + '" is longer than ' + this.MAX_LABEL);
      if (/[^.]\.$|!$/.test(label)) out.push('the label "' + label + '" ends with a full stop');
      if (!/^[\p{Lu}\p{N}]/u.test(label)) out.push('the label "' + label + '" does not start with a capital letter');
      if (this.EMOJI.test(label)) out.push('the label "' + label + '" has an emoji');
      if (/[<>]/.test(label)) out.push('the label "' + label + '" has markup in it');
    }
    if (c.hint != null) {
      if (typeof c.hint !== 'string') out.push('the hint of "' + id + '" is not text');
      else {
        if (c.hint.length > this.MAX_HINT) out.push('the hint of "' + id + '" is longer than ' + this.MAX_HINT);
        if (this.EMOJI.test(c.hint)) out.push('the hint of "' + id + '" has an emoji');
      }
    }
    return out;
  },

  // Every id, and every label ignoring case, appears once.
  lintUnique(commands) {
    const out = [];
    const ids = new Map(), labels = new Map();
    for (const c of commands) {
      if (ids.has(c.id)) out.push('the id "' + c.id + '" is used twice');
      ids.set(c.id, true);
      const key = String(c.label || '').toLowerCase();
      if (key && labels.has(key) && labels.get(key) !== c.id) out.push('the label "' + c.label + '" belongs to "' + labels.get(key) + '" and "' + c.id + '"');
      labels.set(key, c.id);
    }
    return out;
  },

  // defaults: the shortcut registry's table { id: { default, system?, cmd? } }.
  // pageFirst: main/guest-shortcuts.js PAGE_FIRST ({ plain: { b: ... }, shifted: { o: ... } }), the keys a
  // page gets BEFORE Vex does and that therefore cannot be moved: a registry key on one must be fixed (system).
  // commandIds: the ids a `cmd` may name.
  lintShortcuts(defaults, pageFirst, commandIds = null) {
    const out = [];
    const taken = new Map();
    const fixed = new Set();
    for (const [k, ch] of Object.entries((pageFirst && pageFirst.plain) || {})) fixed.add('Ctrl+' + k.toUpperCase());
    for (const [k, ch] of Object.entries((pageFirst && pageFirst.shifted) || {})) fixed.add('Ctrl+Shift+' + k.toUpperCase());
    for (const [id, d] of Object.entries(defaults)) {
      const combo = d.default;
      if (typeof combo !== 'string' || !this.COMBO.test(combo)) { out.push('"' + id + '" has the key "' + combo + '", which is not Ctrl+Alt+Shift+Key'); continue; }
      if (taken.has(combo)) out.push('the key ' + combo + ' is on both "' + taken.get(combo) + '" and "' + id + '"');
      taken.set(combo, id);
      if (fixed.has(combo) && !d.system) out.push('"' + id + '" uses ' + combo + ', which a page gets first; it has to be a fixed (system) key');
      if (d.cmd && commandIds && !commandIds.has(d.cmd)) out.push('"' + id + '" runs the command "' + d.cmd + '", which does not exist');
      if (!d.label) out.push('"' + id + '" has no label');
    }
    return out;
  },

  lintPrefixes() {
    const out = [];
    const seen = new Set();
    for (const p of this.PREFIXES) {
      if (typeof p.char !== 'string' || p.char.length !== 1 || /[A-Za-z0-9\s]/.test(p.char)) out.push('a prefix is one symbol, not "' + p.char + '"');
      if (seen.has(p.char)) out.push('the prefix ' + p.char + ' is listed twice');
      seen.add(p.char);
    }
    return out;
  },
};

if (typeof window !== 'undefined') window.CommandGrammar = CommandGrammar;
if (typeof module !== 'undefined' && module.exports) module.exports = { CommandGrammar };
