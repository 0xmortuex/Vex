// Module-owned command bar entries (and, for older callers, the Settings groups
// registry, which now lives in js/vex-settings-groups.js: one registry only).
// CommandBar is a lexical global, so it is reached by bare name.
//
// CommandBar.commands is the list Ctrl+K searches. A module adds its entries
// here (replacing its own stale ones by id prefix) so command.js stays
// untouched. CommandBar is a lexical global, so it is reached by bare name.
const VexModuleCommands = {
  _lists: new Map(),

  // list: [{ id, label, hint, icon, action }]; every id must start with prefix.
  set(prefix, list) {
    if (typeof prefix !== 'string' || !prefix.endsWith(':')) throw new Error('A command prefix ends with a colon');
    for (const c of list) {
      if (!c || typeof c.id !== 'string' || !c.id.startsWith(prefix)) throw new Error('A command id must start with ' + prefix);
      if (typeof c.action !== 'function') throw new Error('A command needs an action');
    }
    this._lists.set(prefix, list);
    return this._push(prefix);
  },

  _push(prefix) {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return false;
    CommandBar.commands = CommandBar.commands.filter(c => !String(c.id || '').startsWith(prefix));
    for (const c of this._lists.get(prefix) || []) CommandBar.commands.push(c);
    return true;
  },

  // CommandBar may be defined after the module: try again once the page is up.
  pushAll() { for (const prefix of this._lists.keys()) this._push(prefix); },
};
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => VexModuleCommands.pushAll());
if (typeof window !== 'undefined') window.VexModuleCommands = VexModuleCommands;

const VexSettingsGroupsRef = typeof module !== 'undefined' && module.exports ? require('./vex-settings-groups.js').VexSettingsGroups : undefined;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSettingsGroups: VexSettingsGroupsRef, VexModuleCommands };
