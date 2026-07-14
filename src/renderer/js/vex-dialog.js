// Unified in-app dialogs — vexConfirm / vexPrompt / vexAlert.
//
// Electron's renderer disables window.prompt() (returns null silently), and
// native confirm()/alert() block the whole event loop with an unthemed OS
// dialog. Every chrome-UI confirmation or text prompt goes through these
// promise-based modals instead. Styles live in css/vex-dialog.css.
//
//   vexConfirm('Delete it?')                          -> Promise<boolean>
//   vexConfirm({ title, message, okLabel, cancelLabel, danger })
//   vexPrompt('New name', 'default value')            -> Promise<string|null>
//   vexPrompt({ title, message, label, value, placeholder, okLabel })
//   vexAlert('Done!') / vexAlert({ title, message })  -> Promise<void>
//
// Escape cancels, Enter confirms, Tab is trapped inside the dialog, and
// focus returns to the previously focused element on close. Danger dialogs
// focus Cancel first so Enter can't destroy anything by accident.
(function () {
  'use strict';

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s ?? '');
    return d.innerHTML;
  }

  let counter = 0;

  function open(opts) {
    return new Promise(resolve => {
      // One dialog at a time — a new one cancels any dialog still open.
      document.querySelectorAll('.vex-dialog-overlay').forEach(o => o._vexCancel?.());

      const prevFocus = document.activeElement;
      const id = 'vex-dialog-' + (++counter);
      const overlay = document.createElement('div');
      overlay.className = 'vex-dialog-overlay';
      overlay.innerHTML = `
        <div class="vex-dialog" role="${opts.danger ? 'alertdialog' : 'dialog'}" aria-modal="true" aria-labelledby="${id}-title">
          <div class="vex-dialog-title" id="${id}-title">${esc(opts.title || 'Vex')}</div>
          ${opts.message ? `<div class="vex-dialog-msg">${esc(opts.message)}</div>` : ''}
          ${opts.input ? `
            ${opts.input.label ? `<label class="vex-dialog-label" for="${id}-input">${esc(opts.input.label)}</label>` : ''}
            <input class="vex-dialog-input" id="${id}-input" type="text" placeholder="${esc(opts.input.placeholder || '')}">` : ''}
          <div class="vex-dialog-actions">
            ${opts.cancelLabel === null ? '' : `<button class="vex-dialog-btn" data-cancel>${esc(opts.cancelLabel || 'Cancel')}</button>`}
            <button class="vex-dialog-btn ${opts.danger ? 'danger' : 'primary'}" data-ok>${esc(opts.okLabel || 'OK')}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      const input = overlay.querySelector('.vex-dialog-input');
      if (input) input.value = opts.input.value != null ? String(opts.input.value) : '';

      let settled = false;
      const done = (result) => {
        if (settled) return;
        settled = true;
        overlay.remove();
        try { if (prevFocus && document.contains(prevFocus)) prevFocus.focus(); } catch {}
        resolve(result);
      };
      const okResult = () => (opts.input ? input.value : true);
      const cancelResult = () => (opts.input ? null : false);
      overlay._vexCancel = () => done(cancelResult());

      overlay.querySelector('[data-ok]').addEventListener('click', () => done(okResult()));
      overlay.querySelector('[data-cancel]')?.addEventListener('click', () => done(cancelResult()));
      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) done(cancelResult()); });

      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); done(cancelResult()); return; }
        if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); done(okResult()); return; }
        if (e.key === 'Tab') {
          const focusables = [...overlay.querySelectorAll('input, button')].filter(el => !el.disabled);
          if (!focusables.length) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      });

      const initialFocus = input
        || (opts.danger && overlay.querySelector('[data-cancel]'))
        || overlay.querySelector('[data-ok]');
      initialFocus.focus();
      if (input) input.select();
    });
  }

  window.vexConfirm = function (o) {
    if (typeof o === 'string') o = { title: 'Confirm', message: o };
    return open(o);
  };

  window.vexAlert = function (o) {
    if (typeof o === 'string') o = { message: o };
    return open({ ...o, input: null, cancelLabel: null }).then(() => {});
  };

  window.vexPrompt = function (o, defaultValue) {
    if (typeof o === 'string') o = { title: o, value: defaultValue };
    return open({
      title: o.title,
      message: o.message,
      okLabel: o.okLabel,
      cancelLabel: o.cancelLabel,
      input: { value: o.value, label: o.label, placeholder: o.placeholder },
    });
  };
})();
