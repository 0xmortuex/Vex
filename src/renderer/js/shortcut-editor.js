// === Vex Phase 17: Keyboard Shortcut Editor UI ===

const ShortcutEditor = (() => {

  function _toast(m, k) { if (typeof window.showToast === 'function') window.showToast(m, k); }
  function _esc(s) { return window.escapeHtml(s); }

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
              ${items.map(s => {
                const locked = s.system || !s.hasHandler;
                return `
                <div class="shortcut-row" data-id="${_esc(s.id)}">
                  <div class="shortcut-label">
                    ${_esc(s.label)}
                    ${locked ? '<span class="sys-tag" title="Handled at the window/system level \u2014 the shortcut works but keeps its default and can\u2019t be reassigned here">system</span>' : ''}
                  </div>
                  ${locked
                    ? `<span class="shortcut-key locked" title="Fixed shortcut \u2014 works, but can\u2019t be reassigned">${formatKeyCombo(s.current)}</span>`
                    : `<button class="shortcut-key ${s.isCustom ? 'custom' : ''}" data-id="${_esc(s.id)}">${formatKeyCombo(s.current)}</button>`}
                  ${(!locked && s.isCustom) ? `<button class="btn-reset-sm" data-id="${_esc(s.id)}" title="Reset to default">\u21bb</button>` : '<span></span>'}
                </div>
              `; }).join('')}
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
    container.querySelectorAll('button.shortcut-key').forEach(btn => {
      btn.addEventListener('click', () => startCapture(btn, container));
    });
    container.querySelectorAll('.btn-reset-sm').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const saved = ShortcutsRegistry.resetShortcut(btn.dataset.id);
        renderPanel(container);
        if (saved === false) _toast('Reset for this session — the change could not be saved and returns when you restart Vex', 'error');
      });
    });
    document.getElementById('btn-reset-all-shortcuts')?.addEventListener('click', async () => {
      if (!await vexConfirm({ title: 'Reset shortcuts', message: 'Reset ALL shortcuts to defaults? Custom bindings will be lost.', okLabel: 'Reset all', danger: true })) return;
      const saved = ShortcutsRegistry.resetAll();
      renderPanel(container);
      if (saved === false) _toast('Reset for this session — the change could not be saved and your custom bindings return when you restart Vex', 'error');
      else _toast('Shortcuts reset', 'success');
    });
  }

  // The capture that currently owns the keyboard, so a second one can cancel it
  // rather than stacking another document-level listener.
  let cancelActiveCapture = null;

  function startCapture(btn, panelContainer) {
    if (cancelActiveCapture) cancelActiveCapture();
    const id = btn.dataset.id;
    const originalHTML = btn.innerHTML;

    btn.classList.add('capturing');
    btn.innerHTML = '<em style="font-style:normal;color:var(--text-muted);font-size:11px">Press keys... (Esc to cancel)</em>';

    const onKey = (e) => {
      // The panel can go away mid-capture (Settings closed, another section
      // opened, the list re-rendered). Without this the listener outlived the
      // button and the next keystroke anywhere in Vex was swallowed and bound
      // to whatever was being edited. Stand down before touching the event.
      if (!btn.isConnected) { stop(); return; }
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
      } else if (res && res.system) {
        _toast('That shortcut is fixed at the system level and can’t be reassigned', 'warn');
        stop();
      } else if (res && res.saved === false) {
        _toast(`Bound to ${combo} for this session — the change could not be saved and resets when you restart Vex`, 'error');
        stop();
        renderPanel(panelContainer);
      } else {
        _toast('Invalid shortcut', 'error');
        stop();
      }
    };

    // Anything that takes the user's attention elsewhere ends the capture:
    // clicking outside the button, or the window losing focus.
    const onPointerDown = (e) => { if (e.target !== btn && !btn.contains(e.target)) stop(); };
    const onWindowBlur = () => stop();
    // Belt and braces for a panel that is torn down without any of the above
    // (e.g. the section is re-rendered programmatically).
    const detachWatch = new MutationObserver(() => { if (!btn.isConnected) stop(); });

    function stop() {
      if (cancelActiveCapture === stop) cancelActiveCapture = null;
      detachWatch.disconnect();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', onWindowBlur);
      btn.classList.remove('capturing');
      btn.innerHTML = originalHTML;
    }

    cancelActiveCapture = stop;
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', onWindowBlur);
    try { detachWatch.observe(document.body, { childList: true, subtree: true }); } catch {}
  }

  return { renderPanel };
})();

window.ShortcutEditor = ShortcutEditor;
