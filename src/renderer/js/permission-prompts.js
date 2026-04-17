// === Vex: Site permission prompts ===
// Listens for 'permission:request' from main and pops a banner asking the user
// to allow/deny, with an optional Remember checkbox.

const PermissionPrompts = (() => {
  const LABELS = {
    'geolocation':    { icon: '\ud83d\udccd', label: 'your location' },
    'media':          { icon: '\ud83c\udfa4', label: 'your camera and microphone' },
    'camera':         { icon: '\ud83d\udcf7', label: 'your camera' },
    'microphone':     { icon: '\ud83c\udfa4', label: 'your microphone' },
    'notifications':  { icon: '\ud83d\udd14', label: 'send notifications' },
    'midi':           { icon: '\ud83c\udfb9', label: 'MIDI devices' },
    'midiSysex':      { icon: '\ud83c\udfb9', label: 'MIDI devices (SysEx)' },
    'mediaKeySystem': { icon: '\ud83c\udfac', label: 'play protected content (DRM)' },
    'display-capture':{ icon: '\ud83d\udcfa', label: 'capture your screen' }
  };

  function _esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  function showPrompt(data) {
    const { id, origin, permission } = data || {};
    const info = LABELS[permission] || { icon: '\u2753', label: permission || 'unknown' };

    document.querySelectorAll('.permission-prompt').forEach(p => p.remove());

    const prompt = document.createElement('div');
    prompt.className = 'permission-prompt';
    prompt.innerHTML = `
      <div class="perm-icon">${info.icon}</div>
      <div class="perm-content">
        <div class="perm-origin">${_esc(origin)}</div>
        <div class="perm-message">wants to access <strong>${_esc(info.label)}</strong></div>
      </div>
      <div class="perm-actions">
        <label class="perm-remember">
          <input type="checkbox" id="perm-remember-${_esc(id)}" checked>
          Remember
        </label>
        <button class="btn-danger-sm" data-decision="deny">Block</button>
        <button class="btn-primary-sm" data-decision="allow">Allow</button>
      </div>
    `;
    document.body.appendChild(prompt);
    requestAnimationFrame(() => prompt.classList.add('show'));

    prompt.querySelectorAll('[data-decision]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const decision = btn.dataset.decision;
        const remember = document.getElementById(`perm-remember-${id}`)?.checked ?? true;
        try {
          await window.vex.permissionRespond({ id, decision, remember, origin, permission });
        } catch (err) { console.error('[Permissions] respond failed:', err); }
        prompt.classList.remove('show');
        setTimeout(() => prompt.remove(), 250);
        if (remember && typeof window.showToast === 'function') {
          window.showToast(`${decision === 'allow' ? '\u2713 Allowed' : '\u2717 Blocked'}: ${origin} \u2192 ${info.label}`, 'info', 3000);
        }
      });
    });
  }

  function init() {
    if (window.vex?.onPermissionRequest) {
      window.vex.onPermissionRequest(showPrompt);
    }
  }

  return { init, showPrompt };
})();

window.PermissionPrompts = PermissionPrompts;
