// === Vex: WebHID device picker ===
// Main fires 'hid:select-request' when a site calls navigator.hid.requestDevice().
// We list the offered devices; the user picks one (grant) or cancels (deny).
// The chooser IS the permission gate (Brave-style) — main persists the grant so
// reconnects need no re-prompt. Reply with the chosen deviceId, or '' to cancel.

const HidPicker = (() => {
  function _esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  // Vendor/product ids come as numbers; show them as the familiar 0xXXXX form.
  function _hex(n) { return (typeof n === 'number' && !Number.isNaN(n)) ? '0x' + n.toString(16).padStart(4, '0') : '?'; }
  function _name(dev) { return (dev && dev.name && dev.name.trim()) ? dev.name.trim() : 'Unknown HID device'; }

  function showPicker(data) {
    const { id, origin, devices } = data || {};
    document.querySelectorAll('.hid-picker-overlay').forEach(o => o.remove());

    const list = Array.isArray(devices) ? devices : [];
    let resolved = false;
    let onKey = null;

    const overlay = document.createElement('div');
    overlay.className = 'hid-picker-overlay';

    const respond = (deviceId) => {
      if (resolved) return;
      resolved = true;
      try { window.vexHid?.respond({ id, deviceId: deviceId || '' }); }
      catch (err) { console.error('[Vex HID] respond failed:', err); }
      if (onKey) document.removeEventListener('keydown', onKey, true);
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 180);
    };

    overlay.innerHTML = `
      <div class="hid-picker">
        <div class="hid-picker-head">
          <div class="hid-picker-title">Connect a device</div>
          <div class="hid-picker-origin">${_esc(origin || 'A site')} wants to connect to a HID device</div>
        </div>
        <div class="hid-picker-list">
          ${list.length ? list.map((d, i) => `
            <button class="hid-device" data-idx="${i}">
              <span class="hid-device-name">${_esc(_name(d))}</span>
              <span class="hid-device-ids">${_esc(_hex(d.vendorId))}:${_esc(_hex(d.productId))}</span>
            </button>
          `).join('') : `<div class="hid-empty">No compatible devices found.</div>`}
        </div>
        <div class="hid-picker-actions">
          <button class="btn-link" data-act="cancel">Cancel</button>
          <button class="btn-primary" data-act="connect"${list.length ? '' : ' disabled'}>Connect</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    let selectedIdx = list.length ? 0 : -1;
    const deviceBtns = [...overlay.querySelectorAll('.hid-device')];
    const markSel = () => deviceBtns.forEach((b, i) => b.classList.toggle('selected', i === selectedIdx));
    markSel();

    const doConnect = () => { if (selectedIdx >= 0 && list[selectedIdx]) respond(list[selectedIdx].deviceId); };

    deviceBtns.forEach(b => {
      b.addEventListener('click', () => { selectedIdx = parseInt(b.dataset.idx, 10); markSel(); });
      b.addEventListener('dblclick', doConnect);
    });
    overlay.querySelector('[data-act="connect"]').addEventListener('click', doConnect);
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => respond(''));
    // Backdrop click or Escape cancels — same dismissal affordances as other modals.
    overlay.addEventListener('click', (e) => { if (e.target === overlay) respond(''); });
    onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); respond(''); } };
    document.addEventListener('keydown', onKey, true);
  }

  function init() {
    if (!window.vexHid?.onSelectRequest) return;
    window.vexHid.onSelectRequest(showPicker);
    // Flush any chooser request that fired during cold start.
    try { window.vexHid.rendererReady?.(); } catch {}
  }

  return { init, showPicker };
})();

if (typeof window !== 'undefined') window.HidPicker = HidPicker;
if (typeof module !== 'undefined' && module.exports) module.exports = { HidPicker };
