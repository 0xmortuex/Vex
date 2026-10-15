// === Module-owned Settings groups ===
//
// A feature that owns its own Settings section registers it here instead of
// adding markup to index.html: the page only needs the feature's <script> tag.
// The group is a normal `.setting-group` appended to the Settings content
// each time Settings opens (just before SettingsUI.enhance() sorts and
// colours every group), and its body is drawn fresh by the module's render().
//
//   VexSettingsGroups.register({ id: 'my-feature', title: 'Reading — my feature',
//                                render(container) { … } });
//
// The title decides which Settings category the group lands in
// (SettingsUI.CATS match words such as "reading", "workspace", "boost").
// Nothing here is ever hidden if render() throws: the group shows the error.
//
// Loaded after settings-ui.js (it wraps SettingsUI.enhance).

const VexSettingsGroups = {
  _groups: [],
  _wrapped: false,

  register(def) {
    if (!def || typeof def.id !== 'string' || !/^[a-z][a-z0-9-]{1,40}$/.test(def.id)) throw new Error('A settings group needs a lowercase id');
    if (typeof def.title !== 'string' || !def.title.trim()) throw new Error('A settings group needs a title');
    if (typeof def.render !== 'function') throw new Error('A settings group needs a render function');
    const at = this._groups.findIndex(g => g.id === def.id);
    if (at >= 0) this._groups[at] = def; else this._groups.push(def);
    this._wrap();
    return def.id;
  },

  ids() { return this._groups.map(g => g.id); },

  // Create or refresh every registered group under `root` (.settings-content).
  mount(root) {
    if (!root) return 0;
    let n = 0;
    for (const def of this._groups) {
      const gid = 'setting-' + def.id;
      let group = root.querySelector(':scope > #' + gid);
      if (!group) {
        group = document.createElement('div');
        group.className = 'setting-group';
        group.id = gid;
        const label = document.createElement('label');
        label.className = 'setting-label';
        label.textContent = def.title;
        const body = document.createElement('div');
        body.className = 'vex-module-group-body';
        group.append(label, body);
        root.appendChild(group);
      }
      const body = group.querySelector('.vex-module-group-body');
      try { def.render(body); }
      catch (err) {
        console.error('[Settings] ' + def.id + ' could not be drawn:', err);
        body.textContent = 'This section could not be shown: ' + ((err && err.message) || err);
      }
      n++;
    }
    return n;
  },

  // SettingsUI.enhance() reads the groups that exist when it runs, so ours are
  // mounted first. Wrapped once, whichever module registers first.
  _wrap() {
    if (this._wrapped || typeof SettingsUI === 'undefined' || typeof SettingsUI.enhance !== 'function') return;
    const original = SettingsUI.enhance;
    const self = this;
    SettingsUI.enhance = function () {
      try { self.mount(document.querySelector('#panel-settings .settings-content')); }
      catch (err) { console.error('[Settings] module groups failed:', err); }
      return original.apply(this, arguments);
    };
    this._wrapped = true;
  },
};

// === Module-owned command bar entries ===
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

// A module registered before settings-ui.js was parsed gets wrapped here.
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => VexSettingsGroups._wrap());
if (typeof window !== 'undefined') window.VexSettingsGroups = VexSettingsGroups;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSettingsGroups, VexModuleCommands };
