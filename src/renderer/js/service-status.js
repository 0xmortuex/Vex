(function () {
  const failures = new Map(); const dismissed = new Map(); let panel;
  // Raw network errors ("Failed to fetch") are shown in the person's language (the table has them as whole strings).
  const say = (text) => (typeof window.vexTr === 'function' ? window.vexTr(String(text)) : String(text));
  function paint() {
    panel?.remove(); panel = null;
    // A sync problem can be closed (it comes back only if the message changes); a storage problem means data was not
    // saved, so it stays until it is fixed.
    const shown = [...failures].filter(([service, message]) => !(dismissed.has(service) && dismissed.get(service) === message));
    if (!shown.length) return;
    panel = document.createElement('div'); panel.className = 'vex-service-status'; panel.setAttribute('role','status');
    for (const [service, message] of shown) {
      const row = document.createElement('div'), label = document.createElement('span'), retry = document.createElement('button');
      label.textContent = say(message); retry.textContent = window.VexI18n?.t('retry') || 'Retry';
      retry.addEventListener('click', async () => {
        retry.disabled = true;
        try {
          if (service.startsWith('storage:')) { await PersistentStorage._flush(); await VexStorage.retryFailed(); await TabManager.persistTabs(); await window.vex.flushStorage(); }
          else { const pull = await SyncEngine.pullNow(); if (!pull.ok) throw new Error(pull.reason); const push = await SyncEngine.pushNow(); if (!push.ok) throw new Error(push.reason); }
          failures.delete(service); dismissed.delete(service); paint();
        } catch (error) { label.textContent = say(error.message); retry.disabled = false; }
      });
      row.append(label,retry);
      if (!service.startsWith('storage:')) {
        const close = document.createElement('button'); close.className = 'vex-service-status-close'; close.type = 'button';
        close.setAttribute('aria-label', say('Dismiss')); close.title = say('Dismiss');
        if (typeof VexIcons !== 'undefined') close.innerHTML = VexIcons.svg('x', { size: 14 });
        close.addEventListener('click', () => { dismissed.set(service, message); paint(); });
        row.append(close);
      }
      panel.append(row);
    }
    document.body.append(panel);
  }
  window.addEventListener('vex-storage-status', event => {
    const source = 'storage:' + (event.detail.source || 'unknown');
    if (!event.detail.ok) failures.set(source, event.detail.message || window.VexI18n?.t('saveFailed'));
    else failures.delete(source);
    paint();
  });
  window.addEventListener('vex-sync-status', event => {
    if (event.detail.error) failures.set('sync', event.detail.error); else { failures.delete('sync'); dismissed.delete('sync'); }
    paint();
  });
})();
