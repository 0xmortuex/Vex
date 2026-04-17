// === Vex Phase 18: Extensions management UI ===

const ExtensionsSettings = (() => {
  function _toast(m, k) { if (typeof window.showToast === 'function') window.showToast(m, k); }
  function _esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  async function render(container) {
    if (!container) container = document.getElementById('extensions-panel-content');
    if (!container) return;

    let extensions = [];
    try { extensions = await window.vex.extensionsList(); } catch {}

    container.innerHTML = `
      <div class="extensions-panel">
        <p class="setting-info muted" style="margin-bottom:12px">Vex supports Chrome extensions loaded from a folder, <code>.zip</code>, or <code>.crx</code>. Restart Vex after install to make sure they load into every tab session.</p>

        <div class="extensions-actions">
          <button class="btn-primary" id="btn-install-zip">\ud83d\udce6 Install from .zip / .crx</button>
          <button class="btn-secondary" id="btn-install-folder">\ud83d\udcc1 Install from folder</button>
          <button class="btn-link" id="btn-open-ext-folder">Open extensions folder</button>
        </div>

        <div class="extensions-help">
          <details>
            <summary>How do I get Chrome extensions?</summary>
            <div class="help-content">
              <p><strong>Option 1 &mdash; Chrome Web Store via a .crx extractor</strong></p>
              <ol>
                <li>Find an extension at <a href="#" data-open="https://chromewebstore.google.com/">chromewebstore.google.com</a></li>
                <li>Copy the page URL</li>
                <li>Paste it at <a href="#" data-open="https://crxextractor.com/">crxextractor.com</a> &rarr; download .crx</li>
                <li>Click &quot;Install from .zip / .crx&quot; above &rarr; pick the file</li>
              </ol>
              <p><strong>Option 2 &mdash; GitHub (for open-source extensions)</strong></p>
              <ol>
                <li>Download the extension's source as a .zip</li>
                <li>Extract it, locate the folder containing <code>manifest.json</code></li>
                <li>Click &quot;Install from folder&quot; &rarr; pick that folder</li>
              </ol>
              <p><strong>Good starters:</strong> uBlock Origin &middot; Dark Reader &middot; Bitwarden &middot; Return YouTube Dislike</p>
              <p><small>Manifest V3 extensions work best. Some Web Store extensions that rely on Google-specific APIs won't work in Electron — try an alternative if one misbehaves.</small></p>
            </div>
          </details>
        </div>

        ${extensions.length === 0 ? `
          <div class="empty-state" style="padding:30px 10px">
            <div class="empty-icon" style="font-size:32px">\ud83e\udde9</div>
            <div class="empty-title">No extensions installed</div>
            <div class="empty-subtitle">Click an install button above to add one</div>
          </div>
        ` : `
          <div class="extension-list">
            ${extensions.map(e => `
              <div class="extension-card">
                <div class="ext-info">
                  <div class="ext-name">${_esc(e.name)} <span class="ext-version">v${_esc(e.version)}</span></div>
                  <div class="ext-desc">${_esc(e.description || 'No description')}</div>
                  <div class="ext-folder"><code>${_esc(e.folder)}</code></div>
                </div>
                <button class="btn-danger-sm" data-folder="${_esc(e.folder)}">Uninstall</button>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;

    _wire(container);
  }

  function _wire(container) {
    container.querySelectorAll('[data-open]').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof TabManager !== 'undefined') TabManager.createTab(a.dataset.open, true);
      });
    });
    document.getElementById('btn-install-zip')?.addEventListener('click', async () => {
      const r = await window.vex.extensionsInstallZip();
      if (r.cancelled) return;
      if (r.ok) { _toast(`Installed: ${r.name} v${r.version}`, 'success'); render(container); }
      else _toast('Install failed: ' + (r.error || 'unknown'), 'error');
    });
    document.getElementById('btn-install-folder')?.addEventListener('click', async () => {
      const r = await window.vex.extensionsInstallFolder();
      if (r.cancelled) return;
      if (r.ok) { _toast(`Installed: ${r.name} v${r.version}`, 'success'); render(container); }
      else _toast('Install failed: ' + (r.error || 'unknown'), 'error');
    });
    document.getElementById('btn-open-ext-folder')?.addEventListener('click', () => {
      window.vex.extensionsOpenFolder();
    });
    container.querySelectorAll('[data-folder]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const folder = btn.dataset.folder;
        if (!confirm(`Uninstall "${folder}"? Restart Vex to fully unload from running tabs.`)) return;
        const r = await window.vex.extensionsUninstall(folder);
        if (r.ok) { _toast('Uninstalled \u2014 restart Vex to fully remove', 'success'); render(container); }
        else _toast('Uninstall failed: ' + (r.error || 'unknown'), 'error');
      });
    });
  }

  return { render };
})();

window.ExtensionsSettings = ExtensionsSettings;
