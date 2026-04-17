// === Vex: Site permissions manager (Settings > Site Permissions) ===

const PermissionsSettings = (() => {
  function _esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function _toast(m, k) { if (typeof window.showToast === 'function') window.showToast(m, k); }

  async function render(container) {
    if (!container) container = document.getElementById('permissions-panel-content');
    if (!container) return;

    let all = {};
    try { all = await window.vex.permissionsList(); } catch {}
    const entries = Object.entries(all);

    container.innerHTML = `
      <p class="setting-info muted" style="margin-bottom:10px">Sites you've allowed or blocked from accessing location, camera, microphone, notifications, and other sensitive features.</p>
      ${entries.length === 0 ? `
        <div style="color:var(--text-muted);font-size:12px;padding:12px 0">No site permissions set yet. When a site requests access, Vex will ask.</div>
      ` : `
        <div class="permissions-list">
          ${entries.map(([key, decision]) => {
            const idx = key.indexOf('::');
            const origin = idx >= 0 ? key.slice(0, idx) : key;
            const permission = idx >= 0 ? key.slice(idx + 2) : '';
            const badge = decision === 'allow' ? '\u2713 Allowed' : '\u2717 Blocked';
            return `
              <div class="permission-row">
                <div class="perm-row-info">
                  <div class="perm-row-origin">${_esc(origin)}</div>
                  <div class="perm-row-detail">
                    <span class="perm-badge ${_esc(decision)}">${badge}</span>
                    ${_esc(permission)}
                  </div>
                </div>
                <button class="btn-secondary-sm" data-perm-key="${_esc(key)}">Revoke</button>
              </div>
            `;
          }).join('')}
        </div>
        <button class="btn-danger" id="btn-clear-all-permissions" style="margin-top:14px">Clear all permissions</button>
      `}
    `;

    container.querySelectorAll('[data-perm-key]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await window.vex.permissionsRevoke(btn.dataset.permKey);
        _toast('Permission revoked', 'info');
        render(container);
      });
    });
    document.getElementById('btn-clear-all-permissions')?.addEventListener('click', async () => {
      if (!confirm('Clear all site permissions? Every site will need to ask again.')) return;
      await window.vex.permissionsClearAll();
      _toast('All permissions cleared', 'success');
      render(container);
    });
  }

  return { render };
})();

window.PermissionsSettings = PermissionsSettings;
