// === Vex Phase 13: Sync settings UI ===
// Renders into #sync-panel-content inside the Settings panel.

const SyncSettings = (() => {

  function toast(msg, kind) {
    if (typeof window.showToast === 'function') window.showToast(msg, kind);
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  function getRelativeTime(iso) {
    if (!iso) return 'never';
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString();
  }

  async function renderSyncPanel(container) {
    if (!container) return;
    const state = SyncEngine.getState();
    if (!state.enabled) renderSignedOut(container);
    else await renderSignedIn(container);
  }

  function renderSignedOut(container) {
    container.innerHTML = `
      <div class="sync-section">
        <div class="sync-header">
          <div class="sync-icon-big">&#9729;&#65039;</div>
          <div>
            <div class="sync-title">Vex Sync</div>
            <div class="sync-subtitle">Sync your tabs, notes, and settings across devices</div>
          </div>
        </div>

        <div class="sync-signed-out">
          <div class="step" id="step-email">
            <div class="step-label">Step 1: Enter your email</div>
            <div class="step-input-row">
              <input type="email" id="sync-email-input" placeholder="you@example.com" autocomplete="email">
              <button class="btn-primary" id="btn-send-code">Send Code</button>
            </div>
            <div class="step-error" id="email-error" hidden></div>
          </div>

          <div class="step" id="step-code" hidden>
            <div class="step-label">Step 2: Enter the 6-digit code sent to your email</div>
            <div class="step-input-row">
              <input type="text" id="sync-code-input" placeholder="123456" maxlength="6" inputmode="numeric" style="font-size: 18px; letter-spacing: 4px; text-align: center;">
              <button class="btn-primary" id="btn-verify-code">Verify</button>
            </div>
            <div class="step-error" id="code-error" hidden></div>
            <div class="recovery-toggle">
              <label>
                <input type="checkbox" id="has-recovery-code">
                I have a recovery code from another device
              </label>
              <input type="text" id="recovery-code-input" placeholder="AAAA-BBBB-CCCC-DDDD-..." hidden style="margin-top: 8px; font-family: 'JetBrains Mono', monospace;">
            </div>
          </div>

          <div class="sync-features">
            <strong>What gets synced:</strong>
            <ul>
              <li>Tabs, sessions, and workspaces</li>
              <li>Shortcuts and tools</li>
              <li>Notes and scheduled tasks</li>
              <li>History summaries and settings</li>
              <li>Theme and preferences</li>
            </ul>
            <strong>What stays local:</strong>
            <ul>
              <li>Saved passwords</li>
              <li>Website cookies and logins</li>
              <li>AI chat history</li>
            </ul>
          </div>

          <div class="sync-security-note">
            &#128274; All data is encrypted on your device before upload. We never see your content.
          </div>
        </div>
      </div>
    `;
    wireSignedOutHandlers(container);
    setTimeout(() => document.getElementById('sync-email-input')?.focus(), 50);
  }

  function wireSignedOutHandlers(container) {
    document.getElementById('btn-send-code')?.addEventListener('click', async () => {
      const email = document.getElementById('sync-email-input').value.trim();
      const errorEl = document.getElementById('email-error');
      errorEl.hidden = true;
      if (!email || !email.includes('@')) {
        errorEl.textContent = 'Please enter a valid email'; errorEl.hidden = false; return;
      }
      const btn = document.getElementById('btn-send-code');
      btn.disabled = true; btn.textContent = 'Sending...';
      try {
        await SyncEngine.requestCode(email);
        document.getElementById('step-code').hidden = false;
        document.getElementById('sync-code-input').focus();
        btn.textContent = 'Sent \u2713';
        setTimeout(() => { btn.textContent = 'Resend Code'; btn.disabled = false; }, 3000);
      } catch (err) {
        errorEl.textContent = err.message; errorEl.hidden = false;
        btn.textContent = 'Send Code'; btn.disabled = false;
      }
    });

    document.getElementById('has-recovery-code')?.addEventListener('change', (e) => {
      document.getElementById('recovery-code-input').hidden = !e.target.checked;
    });

    document.getElementById('btn-verify-code')?.addEventListener('click', async () => {
      const email = document.getElementById('sync-email-input').value.trim();
      const code = document.getElementById('sync-code-input').value.trim();
      const hasRecovery = document.getElementById('has-recovery-code').checked;
      const recoveryCode = document.getElementById('recovery-code-input').value.trim();
      const errorEl = document.getElementById('code-error');
      errorEl.hidden = true;

      if (!code || code.length !== 6) { errorEl.textContent = 'Enter the 6-digit code'; errorEl.hidden = false; return; }
      if (hasRecovery && !recoveryCode) { errorEl.textContent = 'Enter your recovery code'; errorEl.hidden = false; return; }

      const btn = document.getElementById('btn-verify-code');
      btn.disabled = true; btn.textContent = 'Verifying...';

      try {
        if (hasRecovery) {
          await SyncEngine.enrollWithRecoveryCode(email, code, recoveryCode);
          toast('Signed in — pulled your data', 'success');
        } else {
          const result = await SyncEngine.verifyCode(email, code);
          showRecoveryCodeDialog(result.recoveryCode);
        }
        await renderSyncPanel(document.getElementById('sync-panel-content'));
      } catch (err) {
        errorEl.textContent = err.message; errorEl.hidden = false;
        btn.textContent = 'Verify'; btn.disabled = false;
      }
    });
  }

  function showRecoveryCodeDialog(code) {
    const overlay = document.createElement('div');
    overlay.className = 'sync-modal-overlay';
    overlay.innerHTML = `
      <div class="sync-modal-card">
        <h2 style="margin-top:0; color: var(--primary);">&#9888;&#65039; Save Your Recovery Code</h2>
        <p>This code is required to sync on another device or if you ever lose access. <strong>Vex cannot recover this for you.</strong></p>
        <div class="recovery-code-display">${escapeHtml(code)}</div>
        <div style="display:flex; gap:8px; justify-content:flex-end;">
          <button class="btn-primary" id="copy-recovery">&#128203; Copy</button>
          <button class="btn-secondary" id="close-recovery">I've saved it</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#copy-recovery').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(code); toast('Recovery code copied', 'success'); }
      catch { toast('Copy failed — select the text manually', 'error'); }
    });
    overlay.querySelector('#close-recovery').addEventListener('click', () => overlay.remove());
  }

  async function renderSignedIn(container) {
    const state = SyncEngine.getState();
    let devices = [];
    try { devices = await SyncEngine.listDevices(); } catch {}

    const lastPush = getRelativeTime(state.lastPushAt);
    const lastPull = getRelativeTime(state.lastPullAt);

    container.innerHTML = `
      <div class="sync-section">
        <div class="sync-header signed-in">
          <div class="sync-icon-big">&#10003;</div>
          <div>
            <div class="sync-title">Signed in as ${escapeHtml(state.email)}</div>
            <div class="sync-subtitle">Last sync: pushed ${lastPush} &middot; pulled ${lastPull}</div>
          </div>
          <button class="btn-primary" id="btn-sync-now">Sync Now</button>
        </div>

        <div class="sync-subsection">
          <h3>Devices (${devices.length})</h3>
          <div class="device-list">
            ${devices.map(d => `
              <div class="device-item ${d.deviceId === state.deviceId ? 'current' : ''}">
                <div class="device-info">
                  <div class="device-name">&#128187; ${escapeHtml(d.deviceName)} ${d.deviceId === state.deviceId ? '<span class="this-device">(This device)</span>' : ''}</div>
                  <div class="device-meta">Added ${getRelativeTime(d.createdAt)} &middot; Last seen ${getRelativeTime(d.lastSeenAt)}</div>
                </div>
                ${d.deviceId !== state.deviceId ? `<button class="btn-danger-sm" data-device-id="${escapeHtml(d.deviceId)}">Remove</button>` : ''}
              </div>
            `).join('') || '<div style="color:var(--text-muted);font-size:12px">No devices yet.</div>'}
          </div>
        </div>

        <div class="sync-subsection">
          <h3>Recovery Code</h3>
          <p class="subsection-desc">Save this code to set up sync on another device. Don't share it with anyone.</p>
          <button class="btn-secondary" id="btn-show-recovery">Show Recovery Code</button>
        </div>

        <div class="sync-subsection danger-zone">
          <h3>Danger Zone</h3>
          <div class="danger-row">
            <div>
              <strong>Sign out</strong>
              <div class="desc">Remove this device from sync. Local data is preserved.</div>
            </div>
            <button class="btn-secondary" id="btn-sign-out">Sign Out</button>
          </div>
          <div class="danger-row">
            <div>
              <strong>Wipe all cloud data</strong>
              <div class="desc">Delete everything stored in Vex Sync. Local data on all devices remains.</div>
            </div>
            <button class="btn-danger" id="btn-wipe-cloud">Wipe Cloud</button>
          </div>
        </div>
      </div>
    `;

    wireSignedInHandlers(container);
  }

  function wireSignedInHandlers(container) {
    document.getElementById('btn-sync-now')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-sync-now');
      btn.disabled = true; btn.textContent = 'Syncing...';
      const pushR = await SyncEngine.pushNow();
      const pullR = await SyncEngine.pullNow();
      btn.textContent = (pushR.ok && pullR.ok) ? 'Done \u2713' : 'Failed';
      setTimeout(async () => {
        await renderSyncPanel(document.getElementById('sync-panel-content'));
      }, 1500);
    });

    document.getElementById('btn-show-recovery')?.addEventListener('click', async () => {
      const code = await SyncEngine.getRecoveryCode();
      if (code) showRecoveryCodeDialog(code);
      else toast('No recovery code stored', 'error');
    });

    document.getElementById('btn-sign-out')?.addEventListener('click', async () => {
      if (!confirm('Sign out? Your local data stays. You can sign back in anytime.')) return;
      await SyncEngine.signOut(true);
      await renderSyncPanel(document.getElementById('sync-panel-content'));
      toast('Signed out', 'success');
    });

    document.getElementById('btn-wipe-cloud')?.addEventListener('click', async () => {
      if (!confirm('Wipe ALL cloud data? This cannot be undone. Local data on each device is safe.')) return;
      const ok = await SyncEngine.wipeAllCloudData();
      toast(ok ? 'Cloud data wiped' : 'Wipe failed', ok ? 'success' : 'error');
    });

    container.querySelectorAll('[data-device-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.deviceId;
        if (!confirm('Remove this device from sync?')) return;
        await SyncEngine.removeDevice(id);
        await renderSyncPanel(document.getElementById('sync-panel-content'));
        toast('Device removed', 'success');
      });
    });
  }

  return { renderSyncPanel };
})();

window.SyncSettings = SyncSettings;
