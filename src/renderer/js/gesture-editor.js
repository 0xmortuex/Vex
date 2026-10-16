// === Mouse gesture editor (T3-068) =============================================
//
// Settings › Mouse gestures: for each stroke you can draw with the right button
// held (a direction, or two in a row) choose what it does: one of Vex's own
// actions, or any Ctrl+K command, a command chain included. The strokes and
// their built-in actions are in js/gestures.js; this file is the screen that
// changes them and the switch Minimal Vex uses.
//
// Switched off, every stroke does what it did before the editor existed.
const VexGestureEditor = {
  ID: 'gesture-editor',
  KEY: 'vex.gestureEditor',

  enabled() { try { return localStorage.getItem(this.KEY) !== 'off'; } catch (err) { throw new Error('The gesture editor switch could not be read: ' + err.message); } },
  setEnabled(on) { localStorage.setItem(this.KEY, on ? 'on' : 'off'); },

  // Every Ctrl+K command a stroke could run, by name. A chain shows as the chain.
  commandChoices() {
    const list = (typeof CommandBar !== 'undefined' && Array.isArray(CommandBar.commands)) ? CommandBar.commands : [];
    return list
      .filter(c => c && c.id && typeof c.action === 'function')
      .map(c => ({ id: c.id, label: String(c.label || c.id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  },

  render(body) {
    body.textContent = '';
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    body.appendChild(el('p', 'setting-info', 'Hold the right mouse button on a page and drag. A short drag is one stroke; two in a row (down, then right) is another. Choose what each one does. A plain right-click still opens the menu.'));
    // The editor's own switch.
    const swRow = el('div', 'setting-toggle-row');
    const swLab = el('label', 'toggle');
    const sw = document.createElement('input');
    sw.type = 'checkbox'; sw.checked = this.enabled(); sw.setAttribute('aria-label', 'Use my own strokes');
    sw.addEventListener('change', () => { try { this.setEnabled(sw.checked); } catch (err) { sw.checked = !sw.checked; fail(err); } });
    swLab.append(sw, el('span', 'toggle-slider'));
    swRow.append(el('span', 'setting-label-text', 'Use my own strokes'), swLab);
    body.appendChild(swRow);
    body.appendChild(el('p', 'setting-info', 'Off, every stroke does what it did before: back, forward, top, reload, close, reopen and so on.'));

    const cmds = this.commandChoices();
    const grid = el('div', 'gx-grid');
    for (const dir of MouseGestures.DIRS) {
      const row = el('div', 'gx-row');
      const name = el('span', 'gx-dir', MouseGestures.arrows(dir));
      name.title = dir.length === 1 ? 'One stroke' : 'Two strokes in a row';
      const sel = document.createElement('select');
      sel.className = 'set-input gx-select';
      sel.setAttribute('aria-label', 'What ' + MouseGestures.arrows(dir) + ' does');
      const add = (parent, value, label) => { const o = document.createElement('option'); o.value = value; o.textContent = label; parent.appendChild(o); return o; };
      add(sel, '', 'Nothing');
      const own = document.createElement('optgroup'); own.label = 'Vex actions';
      for (const [id, a] of Object.entries(MouseGestures.ACTIONS)) add(own, id, a.label);
      sel.appendChild(own);
      const cg = document.createElement('optgroup'); cg.label = 'Ctrl+K commands and chains';
      for (const c of cmds) add(cg, MouseGestures.CMD_PREFIX + c.id, c.label);
      sel.appendChild(cg);
      const current = MouseGestures.actionFor(dir);
      // A command that has gone since it was chosen stays visible, named as gone, so it can be replaced.
      if (current && ![...sel.options].some(o => o.value === current)) add(sel, current, MouseGestures.describe(current));
      sel.value = current;
      sel.addEventListener('change', () => {
        try { MouseGestures.setBinding(dir, sel.value); }
        catch (err) { sel.value = MouseGestures.actionFor(dir); fail(err); }
      });
      row.append(name, sel);
      grid.appendChild(row);
    }
    body.appendChild(grid);
    const reset = el('button', 'btn-secondary', 'Put the built-in strokes back');
    reset.type = 'button';
    reset.addEventListener('click', () => { try { MouseGestures.resetBindings(); this.render(body); } catch (err) { fail(err); } });
    body.appendChild(reset);
  },

  init() {
    if (typeof VexSettingsGroups === 'undefined') throw new Error('VexSettingsGroups is not loaded');
    VexSettingsGroups.register({ id: this.ID, title: 'Mouse gesture editor', keywords: 'mouse gestures strokes right button drag bind command chain', render: (body) => this.render(body) });
  },
};

if (typeof window !== 'undefined') window.VexGestureEditor = VexGestureEditor;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexGestureEditor };
