// === Vex Phase 17: Keyboard Shortcut Editor UI ===

const ShortcutEditor = (() => {

  function _toast(m, k) { if (typeof window.showToast === 'function') window.showToast(m, k); }
  function _esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  function renderPanel(container) {
    if (!container) container = document.getElementById('shortcuts-editor-content');
    if (!container) return;
    if (typeof ShortcutsRegistry === 'undefined') {
      container.innerHTML = '<div style="color:var(--text-muted);font-size:12px">Shortcuts registry not loaded.</div>';
      return;
    }

    const shortcuts = ShortcutsRegistry.getAllShortcuts();
    const byCategory = {};
    for (const [id, data] of Object.entries(shortcuts)) {
      (byCategory[data.category] ||= []).push({ id, ...data });
    }

    container.innerHTML = `
      <div class="shortcuts-editor-panel">
        <div class="panel-header">
          <p class="panel-desc">Click any shortcut to rebind it. Custom bindings glow with the primary color. Entries marked <em>system</em> are handled at the OS/window level and keep their defaults.</p>
          <button class="btn-secondary" id="btn-reset-all-shortcuts">Reset all to defaults</button>
        </div>
        ${Object.entries(byCategory).map(([cat, items]) => `
          <div class="shortcut-category">
            <h3>${_esc(cat)}</h3>
            <div class="shortcut-list">
              ${items.map(s => `
                <div class="shortcut-row" data-id="${_esc(s.id)}">
                  <div class="shortcut-label">
                    ${_esc(s.label)}
                    ${!s.hasHandler ? '<span class="sys-tag" title="Handled at system level; binding is informational">system</span>' : ''}
                  </div>
                  <button class="shortcut-key ${s.isCustom ? 'custom' : ''}" data-id="${_esc(s.id)}">${formatKeyCombo(s.current)}</button>
                  ${s.isCustom ? `<button class="btn-reset-sm" data-id="${_esc(s.id)}" title="Reset to default">\u21bb</button>` : '<span></span>'}
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;
    wireHandlers(container);
  }

  function formatKeyCombo(combo) {
    if (!combo) return '<span style="color:var(--text-muted)">&mdash;</span>';
    return combo.split('+').map(p => `<kbd>${_esc(p)}</kbd>`).join('<span class="key-plus">+</span>');
  }

  function wireHandlers(container) {
    container.querySelectorAll('.shortcut-key').forEach(btn => {
      btn.addEventListener('click', () => startCapture(btn, container));
    });
    container.querySelectorAll('.btn-reset-sm').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        ShortcutsRegistry.resetShortcut(btn.dataset.id);
        renderPanel(container);
      });
    });
    document.getElementById('btn-reset-all-shortcuts')?.addEventListener('click', () => {
      if (!confirm('Reset ALL shortcuts to defaults? Custom bindings will be lost.')) return;
      ShortcutsRegistry.resetAll();
      renderPanel(container);
      _toast('Shortcuts reset', 'success');
    });
  }

  function startCapture(btn, panelContainer) {
    const id = btn.dataset.id;
    const originalHTML = btn.innerHTML;

    btn.classList.add('capturing');
    btn.innerHTML = '<em style="font-style:normal;color:var(--text-muted);font-size:11px">Press keys... (Esc to cancel)</em>';

    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { stop(); return; }
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return; // wait for real key

      const combo = ShortcutsRegistry.eventToShortcut(e);
      if (!combo) { stop(); return; }

      const res = ShortcutsRegistry.setShortcut(id, combo);
      if (res === true) {
        _toast(`Bound to ${combo}`, 'success');
        stop();
        renderPanel(panelContainer);
      } else if (res && res.conflict) {
        _toast(`"${combo}" is already used by "${res.conflictLabel}"`, 'warn');
        stop();
      } else {
        _toast('Invalid shortcut', 'error');
        stop();
      }
    };

    function stop() {
      btn.classList.remove('capturing');
      btn.innerHTML = originalHTML;
      document.removeEventListener('keydown', onKey, true);
    }

    document.addEventListener('keydown', onKey, true);
  }

  return { renderPanel };
})();

window.ShortcutEditor = ShortcutEditor;
