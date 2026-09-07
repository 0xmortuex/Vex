(function () {
  const failures = new Map(); let panel;
  function paint() {
    panel?.remove(); panel = null;
    if (!failures.size) return;
    panel = document.createElement('div'); panel.className = 'vex-service-status'; panel.setAttribute('role','status');
    for (const [service, message] of failures) {
      const row = document.createElement('div'), label = document.createElement('span'), retry = document.createElement('button');
      label.textContent = message; retry.textContent = window.VexI18n?.t('retry') || 'Retry';
      retry.addEventListener('click', async () => {
        retry.disabled = true;
        try {
          if (service.startsWith('storage:')) { await PersistentStorage._flush(); await VexStorage.retryFailed(); await TabManager.persistTabs(); await window.vex.flushStorage(); }
          else { const pull = await SyncEngine.pullNow(); if (!pull.ok) throw new Error(pull.reason); const push = await SyncEngine.pushNow(); if (!push.ok) throw new Error(push.reason); }
          failures.delete(service); paint();
        } catch (error) { label.textContent = error.message; retry.disabled = false; }
      });
      row.append(label,retry); panel.append(row);
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
    if (event.detail.error) failures.set('sync', event.detail.error); else failures.delete('sync');
    paint();
  });
})();
