// === Vex Phase 18: Extensions management UI ===

const ExtensionsSettings = (() => {
  function _toast(m, k) { if (typeof window.showToast === 'function') window.showToast(m, k); }
  function _esc(s) { return window.escapeHtml(s); }

  // Icons live inside the install folder, so the manager loads them straight off
  // disk. encodeURI (not encodeURIComponent) keeps the drive letter and the path
  // separators intact while still escaping spaces.
  function _fileUrl(p) {
    if (typeof p !== 'string' || !p) return null;
    return encodeURI('file:///' + p.replace(/\\/g, '/').replace(/^\/+/, ''));
  }

  // What the card badge says. "Enabled but not loaded" is a real state — the
  // folder is there and switched on, but Electron refused it — and it must not
  // look identical to a working extension.
  function _statusOf(ext) {
    if (!ext.enabled) return { label: 'Disabled', tone: 'off' };
    if (ext.error) return { label: 'Failed to load', tone: 'bad' };
    if (!ext.loaded) return { label: 'Not loaded', tone: 'bad' };
    return { label: 'On', tone: 'ok' };
  }

  function _injectStyles() {
    if (document.getElementById('ext-manager-styles')) return;
    const st = document.createElement('style');
    st.id = 'ext-manager-styles';
    st.textContent = `
      .extension-card .ext-icon{width:32px;height:32px;flex-shrink:0;margin-right:10px;border-radius:6px;
        object-fit:contain;background:var(--surface,rgba(255,255,255,0.04));}
      .extension-card .ext-icon-fallback{width:32px;height:32px;flex-shrink:0;margin-right:10px;border-radius:6px;
        display:flex;align-items:center;justify-content:center;font-size:17px;
        background:var(--surface,rgba(255,255,255,0.04));}
      .ext-badge{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:999px;font-size:10px;
        font-weight:600;vertical-align:middle;}
      .ext-badge.ok{background:color-mix(in srgb, #22c55e 20%, transparent);color:#22c55e;}
      .ext-badge.off{background:color-mix(in srgb, #9a9aa5 22%, transparent);color:var(--text-muted,#9a9aa5);}
      .ext-badge.bad{background:color-mix(in srgb, #ef4444 20%, transparent);color:#ef4444;}
      .ext-error{color:#ef4444;font-size:11px;margin-top:4px;line-height:1.35;word-break:break-word;}
      .ext-card-actions{display:flex;align-items:center;gap:8px;flex-shrink:0;}
      .ext-toggle{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--text-muted,#9a9aa5);cursor:pointer;}
      .ext-open-btn{background:transparent;border:1px solid var(--border,rgba(255,255,255,0.12));color:var(--text,#e9e9ee);
        border-radius:6px;font-size:11px;padding:3px 8px;cursor:pointer;font-family:inherit;}
      .ext-open-btn:hover{border-color:var(--primary,#6366f1);}
      .ext-state-error{background:color-mix(in srgb, #ef4444 12%, transparent);border:1px solid #ef4444;
        border-radius:8px;padding:8px 10px;font-size:12px;color:#ef4444;margin-bottom:10px;}
    `;
    document.head.appendChild(st);
  }

  async function render(container) {
    if (!container) container = document.getElementById('extensions-panel-content');
    if (!container) return;
    _injectStyles();

    let extensions = [];
    let listError = null;
    try { extensions = await window.vex.extensionsList(); }
    catch (err) { listError = (err && err.message) || String(err); }

    // Reported by main when the enabled/disabled file can't be read — without
    // this the user would silently get every extension back on after a restart.
    const stateError = extensions.length ? extensions[0].stateError : null;

    container.innerHTML = `
      <div class="extensions-panel">
        <p class="setting-info muted" style="margin-bottom:12px">Vex supports Chrome extensions loaded from a folder, <code>.zip</code>, or <code>.crx</code>. Extensions load into regular tabs, the sidebar panels and container tabs. Private, Off-the-Record and Tor tabs never load extensions &mdash; Electron can't put them in a temporary session.</p>

        ${listError ? `<div class="ext-state-error">Couldn't read the installed extensions: ${_esc(listError)}</div>` : ''}
        ${stateError ? `<div class="ext-state-error">${_esc(stateError)}</div>` : ''}

        <div class="extensions-actions">
          <button class="btn-primary" id="btn-install-zip">📦 Install from .zip / .crx</button>
          <button class="btn-secondary" id="btn-install-folder">📁 Install from folder</button>
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
              <p><strong>What works here:</strong> content scripts (page tweaks, themes, readers), <code>chrome.storage</code>, <code>chrome.tabs</code>, <code>chrome.scripting</code>, <code>chrome.alarms</code>, <code>chrome.i18n</code>, options pages and toolbar popups.</p>
              <p><strong>What Electron can't do:</strong> request blocking (<code>declarativeNetRequest</code> and blocking <code>webRequest</code> are ignored, so ad blockers won't block &mdash; use Vex's own built-in blocker), context menus, <code>chrome.storage.sync</code>, notifications, cookies, downloads, keyboard commands, and toolbar badges.</p>
            </div>
          </details>
        </div>

        ${extensions.length === 0 ? `
          <div class="empty-state" style="padding:30px 10px">
            <div class="empty-icon" style="font-size:32px">🧩</div>
            <div class="empty-title">No extensions installed</div>
            <div class="empty-subtitle">Click an install button above to add one</div>
          </div>
        ` : `
          <div class="extension-list">
            ${extensions.map(e => {
              const status = _statusOf(e);
              const icon = _fileUrl(e.iconPath);
              return `
              <div class="extension-card">
                ${icon
                  ? `<img class="ext-icon" src="${_esc(icon)}" alt="">`
                  : '<div class="ext-icon-fallback">🧩</div>'}
                <div class="ext-info">
                  <div class="ext-name">${_esc(e.name)} <span class="ext-version">v${_esc(e.version)}</span><span class="ext-badge ${status.tone}">${_esc(status.label)}</span></div>
                  <div class="ext-desc">${_esc(e.description || 'No description')}</div>
                  <div class="ext-folder"><code>${_esc(e.folder)}</code></div>
                  ${e.error ? `<div class="ext-error">${_esc(e.error)}</div>` : ''}
                </div>
                <div class="ext-card-actions">
                  ${e.hasPopup && e.loaded ? `<button class="ext-open-btn" data-popup="${_esc(e.folder)}">Popup</button>` : ''}
                  ${e.optionsUrl ? `<button class="ext-open-btn" data-options="${_esc(e.optionsUrl)}">Options</button>` : ''}
                  <label class="ext-toggle"><input type="checkbox" data-toggle="${_esc(e.folder)}" ${e.enabled ? 'checked' : ''}> On</label>
                  <button class="btn-danger-sm" data-folder="${_esc(e.folder)}">Uninstall</button>
                </div>
              </div>
            `; }).join('')}
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
    container.querySelectorAll('[data-toggle]').forEach(box => {
      box.addEventListener('change', async () => {
        const folder = box.dataset.toggle;
        const wanted = box.checked;
        const r = await window.vex.extensionsSetEnabled(folder, wanted);
        if (!r.ok) {
          box.checked = !wanted;                       // don't pretend it worked
          _toast((wanted ? 'Enable' : 'Disable') + ' failed: ' + (r.error || 'unknown'), 'error');
        } else {
          _toast(wanted ? 'Extension enabled' : 'Extension disabled', 'success');
        }
        render(container);
      });
    });
    container.querySelectorAll('[data-popup]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const rect = btn.getBoundingClientRect();
        const r = await window.vex.extensionsOpenPopup({
          folder: btn.dataset.popup,
          x: Math.max(0, Math.round(window.screenX + rect.left)),
          y: Math.max(0, Math.round(window.screenY + rect.bottom))
        });
        if (!r.ok) _toast('Could not open popup: ' + (r.error || 'unknown'), 'error');
      });
    });
    container.querySelectorAll('[data-options]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (typeof TabManager !== 'undefined') TabManager.createTab(btn.dataset.options, true);
      });
    });
    container.querySelectorAll('[data-folder]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const folder = btn.dataset.folder;
        if (!await vexConfirm({ title: 'Uninstall extension', message: `Uninstall "${folder}"? Restart Vex to fully unload from running tabs.`, okLabel: 'Uninstall', danger: true })) return;
        const r = await window.vex.extensionsUninstall(folder);
        if (r.ok) { _toast('Uninstalled — restart Vex to fully remove', 'success'); render(container); }
        else _toast('Uninstall failed: ' + (r.error || 'unknown'), 'error');
      });
    });
  }

  return { render, _fileUrl, _statusOf };
})();

window.ExtensionsSettings = ExtensionsSettings;
if (typeof module !== 'undefined' && module.exports) module.exports = { ExtensionsSettings };
