// === Vex Keyboard Shortcuts panel ==========================================
//
// This used to be a written-out list of keys, which meant it disagreed with
// the app the moment anybody rebound anything — and there was no way to
// change a key from here at all. It is the editor now (js/shortcut-editor.js,
// the same one in Settings), so the panel shows what your keys REALLY are and
// every one of them can be changed where you are reading it.

const ShortcutsPanel = {
  init() {
    const panel = document.getElementById('panel-shortcuts');
    if (!panel) return;
    panel.dataset.rendered = 'true';
    panel.innerHTML = '<div class="shortcuts-container"><h2>Keyboard shortcuts</h2><div id="shortcuts-panel-editor"></div></div>';
    const host = panel.querySelector('#shortcuts-panel-editor');
    if (typeof ShortcutEditor === 'undefined') {
      host.innerHTML = '<div style="color:var(--text-muted);font-size:12px">The shortcut editor is not available in this window.</div>';
      return;
    }
    ShortcutEditor.renderPanel(host);
  },
};

if (typeof window !== 'undefined') window.ShortcutsPanel = ShortcutsPanel;
if (typeof module !== 'undefined' && module.exports) module.exports = { ShortcutsPanel };
