// Unified in-app dialogs — vexConfirm / vexPrompt / vexAlert.
//
// Electron's renderer disables window.prompt() (returns null silently), and
// native confirm()/alert() block the whole event loop with an unthemed OS
// dialog. Every chrome-UI confirmation or text prompt goes through these
// promise-based modals instead. Styles live in css/vex-dialog.css.
//
//   vexConfirm('Delete it?')                          -> Promise<boolean>
//   vexConfirm({ title, message, okLabel, cancelLabel, danger })
//   vexConfirm({ ..., html, wide })  html: markup the CALLER has built and
//                                     escaped (icons, lists); shown under message
//   vexPrompt('New name', 'default value')            -> Promise<string|null>
//   vexPrompt({ title, message, label, value, placeholder, okLabel })
//   vexPrompt({ ..., multiline: true, wide: true })     -> a scrollable text box
//   vexPrompt({ ..., password: true })                 -> a hidden box (PIN, passphrase)
//   vexConfirm / vexPrompt({ ..., extra: { label, run } }) -> a third button:
//                                     closes as a cancel, then runs
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
  const t = (key, fallback) => window.VexI18n?.t(key, fallback) || fallback;

  // The one focus trap. Every visible [aria-modal="true"] keeps Tab inside
  // itself: these dialogs used to trap it, while What's new, the Backup and
  // the Import screens let it walk out to the toolbar behind them (found
  // 2026-10-10). One document-level listener covers every modal, the ones
  // added later too; the topmost (last in the document) wins.
  const shown = (el) => (typeof el.checkVisibility === 'function' ? el.checkVisibility() : !el.closest('[hidden]'));
  const FocusTrap = {
    focusables(root) {
      return [...root.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
        .filter(el => !el.disabled && el.tabIndex >= 0 && el.type !== 'hidden' && shown(el));
    },
    topModal() {
      const all = [...document.querySelectorAll('[aria-modal="true"]')].filter(shown);
      return all[all.length - 1] || null;
    },
    // Wraps Tab at the ends, and brings focus that is outside `root` back in.
    onTab(e, root) {
      if (e.key !== 'Tab' || e.defaultPrevented || !root) return;
      const items = this.focusables(root);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!root.contains(active)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    },
  };
  // A modal built by hand (the editors, pickers and wizards that are not
  // vexConfirm/vexPrompt): it says it is a dialog, which also puts it under the
  // trap above; focus goes in when nothing in it has it; and focus goes back to
  // what had it when the modal is removed, unless something else has taken it.
  FocusTrap.adopt = function adopt(modal, { label } = {}) {
    if (!modal || modal.nodeType !== 1) throw new Error('VexFocusTrap.adopt needs the dialog element');
    if (modal.__vexAdopted) return;
    modal.__vexAdopted = true;
    // What had focus before the modal: when it already took focus by itself
    // (a modal that focuses its own field), the last thing outside any modal.
    const opener = modal.contains(document.activeElement) ? FocusTrap.lastOutside : document.activeElement;
    if (!modal.getAttribute('role')) modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    if (label && !modal.getAttribute('aria-label') && !modal.getAttribute('aria-labelledby')) modal.setAttribute('aria-label', label);
    requestAnimationFrame(() => {
      if (!modal.isConnected || modal.contains(document.activeElement)) return;
      const first = FocusTrap.focusables(modal)[0];
      if (first) first.focus({ preventScroll: true });
      else { modal.tabIndex = -1; modal.focus({ preventScroll: true }); }
    });
    // Removed itself, or with the overlay around it.
    const watch = new MutationObserver(() => {
      if (modal.isConnected) return;
      watch.disconnect();
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && opener && opener !== document.body && opener.isConnected) opener.focus({ preventScroll: true });
    });
    if (modal.parentNode) watch.observe(modal.parentNode, { childList: true });
    watch.observe(document.body, { childList: true });
  };
  window.VexFocusTrap = FocusTrap;
  document.addEventListener('keydown', (e) => { if (e.key === 'Tab') FocusTrap.onTab(e, FocusTrap.topModal()); }, true);

  // Every modal, however it was built, is brought under the same rules: a
  // [aria-modal="true"] that appears takes focus when nothing in it has it,
  // and gives it back when it goes. 9 of Vex's dialogs opened with the focus
  // left on the toolbar button behind them, so a screen reader announced
  // nothing and the keyboard was not in them.
  FocusTrap.lastOutside = null;
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (t && t.nodeType === 1 && t !== document.body && !t.closest('[aria-modal="true"]')) FocusTrap.lastOutside = t;
  }, true);
  const watchModals = () => {
    new MutationObserver((records) => {
      for (const rec of records) {
        for (const n of rec.addedNodes) {
          if (n.nodeType !== 1) continue;
          const modal = n.matches('[aria-modal="true"]') ? n : n.querySelector('[aria-modal="true"]');
          if (modal) FocusTrap.adopt(modal);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) watchModals();
  else document.addEventListener('DOMContentLoaded', watchModals, { once: true });

  function open(opts) {
    return new Promise(resolve => {
      // One dialog at a time — a new one cancels any dialog still open.
      document.querySelectorAll('.vex-dialog-overlay').forEach(o => o._vexCancel?.());

      const prevFocus = document.activeElement;
      const id = 'vex-dialog-' + (++counter);
      const overlay = document.createElement('div');
      overlay.className = 'vex-dialog-overlay';
      // A multi-line box (input.multiline) is for text the user reads and edits
      // before it goes somewhere — a problem report. The wide dialog gives it room.
      const multi = !!(opts.input && opts.input.multiline);
      overlay.innerHTML = `
        <div class="vex-dialog${opts.wide ? ' vex-dialog-wide' : ''}" role="${opts.danger ? 'alertdialog' : 'dialog'}" aria-modal="true" aria-labelledby="${id}-title"${opts.message || opts.html ? ` aria-describedby="${id}-msg"` : ''}>
          <div class="vex-dialog-title" id="${id}-title">${esc(opts.title || 'Vex')}</div>
          ${opts.message ? `<div class="vex-dialog-msg" id="${id}-msg">${esc(opts.message)}</div>` : ''}
          ${opts.html ? `<div class="vex-dialog-body"${opts.message ? '' : ` id="${id}-msg"`}>${opts.html}</div>` : ''}
          ${opts.input ? `
            ${opts.input.label ? `<label class="vex-dialog-label" for="${id}-input">${esc(opts.input.label)}</label>` : ''}
            ${multi
              ? `<textarea class="vex-dialog-input vex-dialog-textarea" id="${id}-input" rows="14" spellcheck="false" aria-label="${esc(opts.input.label || opts.title || 'Vex')}" placeholder="${esc(opts.input.placeholder || '')}"></textarea>`
              : `<input class="vex-dialog-input" id="${id}-input" type="${opts.input.password ? 'password' : 'text'}"${opts.input.password ? ' autocomplete="off"' : ''} aria-label="${esc(opts.input.label || opts.title || 'Vex')}" placeholder="${esc(opts.input.placeholder || '')}">`}` : ''}
          <div class="vex-dialog-actions">
            ${opts.extra ? `<button class="vex-dialog-btn" data-extra style="margin-right:auto">${esc(opts.extra.label)}</button>` : ''}
            ${opts.cancelLabel === null ? '' : `<button class="vex-dialog-btn" data-cancel>${esc(opts.cancelLabel || t('cancel', 'Cancel'))}</button>`}
            <button class="vex-dialog-btn ${opts.danger ? 'danger' : 'primary'}" data-ok>${esc(opts.okLabel || t('ok', 'OK'))}</button>
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
      // A third choice (opts.extra = { label, run }): closes as a cancel, then
      // does its own thing — "look it up first", say.
      overlay.querySelector('[data-extra]')?.addEventListener('click', () => { done(cancelResult()); opts.extra.run(); });
      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) done(cancelResult()); });

      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); done(cancelResult()); return; }
        // Enter in a multi-line box is a new line, not OK.
        if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); done(okResult()); return; }
        if (e.key === 'Tab') FocusTrap.onTab(e, overlay.firstElementChild);
      });

      const initialFocus = input
        || (opts.danger && overlay.querySelector('[data-cancel]'))
        || overlay.querySelector('[data-ok]');
      initialFocus.focus();
      // A long text is read from the top, not selected for overwriting.
      if (input && !multi) input.select();
      else if (input) { input.setSelectionRange(0, 0); input.scrollTop = 0; }
    });
  }

  window.vexConfirm = function (o) {
    if (typeof o === 'string') o = { title: t('confirm', 'Confirm'), message: o };
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
      input: { value: o.value, label: o.label, placeholder: o.placeholder, multiline: !!o.multiline, password: !!o.password },
      wide: !!o.wide,
      extra: o.extra,
    });
  };
})();
