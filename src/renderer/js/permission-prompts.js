// === Vex: Site permission prompts ===
// Listens for 'permission:request' from main and pops a banner asking the user
// to allow/deny, with an optional Remember checkbox.

const PermissionPrompts = (() => {
  // Inline SVG icons matching the top-bar chrome style: 24-viewbox,
  // stroke=currentColor (picks up --vex-accent from .perm-icon), round caps.
  function _svg(paths) {
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block">${paths}</svg>`;
  }
  const ICONS = {
    pin:     _svg('<path d="M12 21s-7-5.4-7-11a7 7 0 0 1 14 0c0 5.6-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
    video:   _svg('<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>'),
    camera:  _svg('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
    mic:     _svg('<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'),
    bell:    _svg('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'),
    music:   _svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
    film:    _svg('<rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>'),
    screen:  _svg('<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>'),
    shield:  _svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>')
  };
  const LABELS = {
    'geolocation':    { icon: ICONS.pin,    label: 'your location' },
    'media':          { icon: ICONS.video,  label: 'your camera and microphone' },
    'camera':         { icon: ICONS.camera, label: 'your camera' },
    'microphone':     { icon: ICONS.mic,    label: 'your microphone' },
    'notifications':  { icon: ICONS.bell,   label: 'send notifications' },
    'midi':           { icon: ICONS.music,  label: 'MIDI devices' },
    'midiSysex':      { icon: ICONS.music,  label: 'MIDI devices (SysEx)' },
    'mediaKeySystem': { icon: ICONS.film,   label: 'play protected content (DRM)' },
    'display-capture':{ icon: ICONS.screen, label: 'capture your screen' }
  };

  function _esc(s) { return window.escapeHtml(s); }

  function showPrompt(data) {
    const { id, origin, permission } = data || {};
    const info = LABELS[permission] || { icon: ICONS.shield, label: permission || 'unknown' };

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
    if (!window.vex?.onPermissionRequest) return;
    window.vex.onPermissionRequest(showPrompt);
    // Signal main we're ready so any permission requests that fired during
    // cold-start (before this listener was attached) get flushed to us now.
    try { window.vex.permissionsRendererReady?.(); } catch {}
  }

  return { init, showPrompt };
})();

window.PermissionPrompts = PermissionPrompts;
