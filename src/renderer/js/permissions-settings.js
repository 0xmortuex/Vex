// === Vex: Site permissions manager (Settings > Site Permissions) ===

const PermissionsSettings = (() => {
  function _esc(s) { return window.escapeHtml(s); }
  function _toast(m, k) { if (typeof window.showToast === 'function') window.showToast(m, k); }

  // A list of what a site MAY do says nothing about what it IS doing. Vex has
  // known (it draws the recording badges) and had nowhere to show it and no way
  // to stop it — the page had to give the microphone up by itself.
  function liveCaptures() {
    const out = [];
    try {
      if (typeof TabManager !== 'undefined' && TabManager.isCapturing) {
        for (const t of TabManager.tabs) {
          if (!TabManager.isCapturing(t)) continue;
          out.push({ where: 'tab', id: t.id, label: t.title || t.url, mic: !!(t.capturing && t.capturing.mic), camera: !!(t.capturing && t.capturing.camera) });
        }
      }
      if (typeof SidebarManager !== 'undefined' && SidebarManager.panelCapture) {
        for (const [name, c] of Object.entries(SidebarManager.panelCapture)) {
          if (!c || (!c.mic && !c.camera)) continue;
          out.push({ where: 'panel', id: name, label: SidebarManager.panelLabel ? SidebarManager.panelLabel(name) : name, mic: !!c.mic, camera: !!c.camera });
        }
      }
    } catch (err) { VexProblems?.note('Permissions', 'Could not read what is capturing', err); }
    return out;
  }

  function stopCapture(entry) {
    const wv = entry.where === 'tab'
      ? (typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(entry.id) : null)
      : (typeof SidebarManager !== 'undefined' ? SidebarManager.panelWebviews[entry.id] : null);
    if (!wv || typeof wv.send !== 'function') { _toast('That page is not loaded any more', 'error'); return false; }
    try {
      wv.send('vex-stop-capture', 'all');
      _toast('Asked ' + entry.label + ' to stop. If it starts again, block it in the list below.');
      return true;
    } catch (err) {
      VexProblems?.note('Permissions', 'Could not stop the capture', err);
      _toast('Could not stop it: ' + ((err && err.message) || ''), 'error');
      return false;
    }
  }

  function renderLive(host) {
    if (!host) return;
    const live = liveCaptures();
    host.innerHTML = '<div class="perm-live-head">In use right now</div>';
    if (!live.length) {
      const none = document.createElement('div');
      none.className = 'perm-live-none';
      none.textContent = 'Nothing is using your microphone or camera.';
      host.appendChild(none);
      return;
    }
    for (const entry of live) {
      const row = document.createElement('div');
      row.className = 'perm-live-row';
      row.innerHTML = '<span class="perm-live-what"></span><span class="perm-live-who"></span><button class="perm-live-stop">Stop</button>';
      row.querySelector('.perm-live-what').textContent = [entry.mic ? 'Microphone' : '', entry.camera ? 'Camera' : ''].filter(Boolean).join(' + ');
      row.querySelector('.perm-live-who').textContent = entry.label;
      row.querySelector('.perm-live-stop').addEventListener('click', () => { stopCapture(entry); setTimeout(() => renderLive(host), 600); });
      host.appendChild(row);
    }
  }

  async function render(container) {
    if (!container) container = document.getElementById('permissions-panel-content');
    if (!container) return;

    let all = {};
    try { all = await window.vex.permissionsList(); } catch {}
    const entries = Object.entries(all);

    container.innerHTML = `
      <div class="perm-test" id="perm-notify-test">
        <div class="perm-test-text">
          <div class="perm-test-title">Desktop notifications</div>
          <div class="perm-test-body muted" id="perm-notify-status">Reminders, page-change alerts and websites you allow all arrive as Windows notifications. Send one to check they reach you.</div>
        </div>
        <button class="btn-secondary-sm" id="btn-notify-test">Send a test notification</button>
      </div>
      <p class="setting-info muted" style="margin-bottom:10px">Sites you've allowed or blocked from accessing location, camera, microphone, notifications, and other sensitive features.</p>
      ${entries.length === 0 ? `
        <div style="color:var(--text-muted);font-size:12px;padding:12px 0">No site permissions set yet. When a site requests access, Vex will ask.</div>
      ` : `
        <div class="permissions-list">
          ${entries.map(([key, decision]) => {
            const idx = key.indexOf('::');
            const origin = idx >= 0 ? key.slice(0, idx) : key;
            const permission = idx >= 0 ? key.slice(idx + 2) : '';
            // 'media' is an answer saved before requests were told apart: it covers
            // the camera and the microphone, never a screen share.
            const NAMES = { media: 'camera and microphone', camera: 'camera', microphone: 'microphone', 'display-capture': 'screen sharing', geolocation: 'location', notifications: 'notifications', 'clipboard-read': 'reading the clipboard', midi: 'MIDI devices', midiSysex: 'MIDI devices (SysEx)' };
            const badge = decision === 'allow' ? '\u2713 Allowed' : '\u2717 Blocked';
            return `
              <div class="permission-row">
                <div class="perm-row-info">
                  <div class="perm-row-origin">${_esc(origin)}</div>
                  <div class="perm-row-detail">
                    <span class="perm-badge ${_esc(decision)}">${badge}</span>
                    ${_esc(NAMES[permission] || permission)}
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

    // What is happening now, above what is merely allowed.
    const liveHost = document.createElement('div');
    liveHost.className = 'perm-live';
    container.insertBefore(liveHost, container.firstChild);
    renderLive(liveHost);
    clearInterval(render._liveTimer);
    render._liveTimer = setInterval(() => {
      if (!liveHost.isConnected) { clearInterval(render._liveTimer); return; }
      renderLive(liveHost);
    }, 3000);

    // A test toast that says, in words, whether Windows showed it. Notifications
    // failed silently for the app's whole life because nothing ever checked.
    const testBtn = container.querySelector('#btn-notify-test');
    const status = container.querySelector('#perm-notify-status');
    testBtn?.addEventListener('click', async () => {
      if (!window.vex || typeof window.vex.notify !== 'function') {
        status.textContent = 'Desktop notifications are not available in this build.';
        status.className = 'perm-test-body bad';
        return;
      }
      testBtn.disabled = true;
      status.textContent = 'Sending…';
      status.className = 'perm-test-body muted';
      try {
        await window.vex.notify('Vex', 'This is a test notification. If you can read this, they work.');
        status.textContent = 'Windows showed it. If you did not see it, check Focus Assist and Settings › System › Notifications › Vex.';
        status.className = 'perm-test-body ok';
      } catch (err) {
        status.textContent = 'It did not show: ' + ((err && err.message) || 'unknown error');
        status.className = 'perm-test-body bad';
      } finally { testBtn.disabled = false; }
    });

    container.querySelectorAll('[data-perm-key]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await window.vex.permissionsRevoke(btn.dataset.permKey);
        _toast('Permission revoked', 'info');
        render(container);
      });
    });
    document.getElementById('btn-clear-all-permissions')?.addEventListener('click', async () => {
      if (!await vexConfirm({ title: 'Clear permissions', message: 'Clear all site permissions? Every site will need to ask again.', okLabel: 'Clear all', danger: true })) return;
      await window.vex.permissionsClearAll();
      _toast('All permissions cleared', 'success');
      render(container);
    });
  }

  return { render, liveCaptures, stopCapture, renderLive };
})();

window.PermissionsSettings = PermissionsSettings;
