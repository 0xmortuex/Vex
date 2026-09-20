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

    // "Your own" goes last: the built-in list is what people scan, and the
    // ones they added belong beside the box that adds more.
    const order = (cat) => (cat === 'Your own' ? 1 : 0);
    const cats = Object.keys(byCategory).sort((a, b) => order(a) - order(b));
    const spare = (typeof ShortcutsRegistry.assignable === 'function') ? ShortcutsRegistry.assignable() : [];

    container.innerHTML = `
      <div class="shortcuts-editor-panel">
        <div class="panel-header">
          <p class="panel-desc">Click any shortcut to rebind it. Custom bindings glow with the primary color. Entries marked <em>system</em> are handled at the OS/window level and keep their defaults.</p>
          <button class="btn-secondary" id="btn-reset-all-shortcuts">Reset all to defaults</button>
        </div>
        ${cats.map(cat => [cat, byCategory[cat]]).map(([cat, items]) => `
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
                  ${s.removable
                    ? `<button class="btn-reset-sm" data-remove="${_esc(s.id)}" title="Take this shortcut away">×</button>`
                    : (!locked && s.isCustom) ? `<button class="btn-reset-sm" data-id="${_esc(s.id)}" title="Reset to default">↻</button>` : '<span></span>'}
                </div>
              `; }).join('')}
            </div>
          </div>
        `).join('')}
        <div class="shortcut-category shortcut-adder">
          <h3>Give something else a key</h3>
          <p class="panel-desc">Anything in the command bar can have one — there are ${spare.length} without one now. Find it, then press the keys you want.</p>
          <input type="search" id="shortcut-add-q" class="shortcut-add-q" placeholder="Search everything Vex can do…" autocomplete="off" aria-label="Search for something to give a shortcut to">
          <div class="shortcut-add-list" id="shortcut-add-list"></div>
        </div>
      </div>
    `;
    _drawAdder(container, spare, '');
    wireHandlers(container);
  }

  // The list under "Give something else a key": what you can bind, filtered by
  // what you typed. Capped, because two hundred rows is not a list anybody
  // reads — the search is how you find the one you want.
  const ADDER_SHOWN = 12;

  function _drawAdder(container, spare, query) {
    const host = container.querySelector('#shortcut-add-list');
    if (!host) return;
    const q = String(query || '').trim().toLowerCase();
    const hits = q
      ? spare.filter(c => (c.label + ' ' + c.hint + ' ' + c.id).toLowerCase().includes(q))
      : spare;
    if (!hits.length) {
      host.innerHTML = `<div class="shortcut-add-empty">${q ? 'Nothing matches “' + _esc(query) + '”, or it already has a key.' : 'Everything already has a key.'}</div>`;
      return;
    }
    host.innerHTML = hits.slice(0, ADDER_SHOWN).map(c => `
      <div class="shortcut-add-row">
        <span class="shortcut-add-name" title="${_esc(c.hint || '')}">${_esc(c.label)}</span>
        <button class="shortcut-key" data-add="${_esc(c.id)}">Press keys…</button>
      </div>`).join('')
      + (hits.length > ADDER_SHOWN ? `<div class="shortcut-add-empty">and ${hits.length - ADDER_SHOWN} more — keep typing to narrow it down.</div>` : '');
    host.querySelectorAll('[data-add]').forEach(btn => btn.addEventListener('click', () => startCapture(btn, container, 'cmd:' + btn.dataset.add)));
  }

  function formatKeyCombo(combo) {
    if (!combo) return '<span style="color:var(--text-muted)">&mdash;</span>';
    return combo.split('+').map(p => `<kbd>${_esc(p)}</kbd>`).join('<span class="key-plus">+</span>');
  }

  function wireHandlers(container) {
    // [data-id] only: the adder's own buttons are .shortcut-key too and are
    // wired in _drawAdder with the id of the command they bind. Catching them
    // here as well started a second capture with no id, which cancelled the
    // first and then refused the key as invalid.
    container.querySelectorAll('button.shortcut-key[data-id]').forEach(btn => {
      btn.addEventListener('click', () => startCapture(btn, container));
    });
    container.querySelectorAll('.btn-reset-sm[data-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const saved = ShortcutsRegistry.resetShortcut(btn.dataset.id);
        renderPanel(container);
        if (saved === false) _toast('Reset for this session — the change could not be saved and returns when you restart Vex', 'error');
      });
    });
    // A shortcut you added yourself has no default to go back to: removing it
    // takes the key away and puts the thing back in the list below.
    container.querySelectorAll('.btn-reset-sm[data-remove]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const saved = ShortcutsRegistry.removeShortcut(btn.dataset.remove);
        renderPanel(container);
        _toast(saved === false ? 'Removed for this session only — it could not be saved' : 'Shortcut removed', saved === false ? 'error' : 'success');
      });
    });
    const q = container.querySelector('#shortcut-add-q');
    if (q) {
      const spare = (typeof ShortcutsRegistry.assignable === 'function') ? ShortcutsRegistry.assignable() : [];
      q.addEventListener('input', () => _drawAdder(container, spare, q.value));
    }
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

  function startCapture(btn, panelContainer, forId) {
    if (cancelActiveCapture) cancelActiveCapture();
    const id = forId || btn.dataset.id;
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
      } else if (res && res.unknown) {
        _toast('That is no longer in Vex, so it cannot be given a key', 'warn');
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

if (typeof window !== 'undefined') window.ShortcutEditor = ShortcutEditor;
if (typeof module !== 'undefined' && module.exports) module.exports = ShortcutEditor;
