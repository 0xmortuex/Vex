// === Vex: Web Serial and WebUSB chooser (navigator.serial.requestPort / navigator.usb.requestDevice) ===
// Main fires 'devices:select-request' when a site asks for a serial port or a USB device (src/main/device-chooser.js).
// This lists what Chromium offered for THAT request, names the site that asked, and waits for an explicit Connect or
// Cancel. The choice is sent back with whether to remember it for this site; nothing is remembered unless the box is
// ticked. Also the list of remembered devices for Settings > Site permissions, with a Revoke on each.
//
// Loaded on demand (VexLazy.ensure('js/device-picker.js')); app.js opens it when a request arrives and cancels the
// request if the file cannot load, so a page never waits for a chooser that is not there.

const DevicePicker = (() => {
  const _t = (s) => (typeof window !== 'undefined' && typeof window.vexTr === 'function') ? window.vexTr(s) : s;
  function _esc(s) { return window.escapeHtml(s); }
  function _hex(n) { return (typeof n === 'number' && Number.isInteger(n)) ? '0x' + n.toString(16).padStart(4, '0') : ''; }
  function _ids(d) { return (_hex(d.vendorId) && _hex(d.productId)) ? _hex(d.vendorId) + ':' + _hex(d.productId) : ''; }

  // What a person reads for one device: a name, and under it the port and the ids that tell two alike apart.
  function nameOf(kind, d) {
    const base = (d && d.name && d.name.trim()) || '';
    const named = (d && d.maker && d.maker.trim() && base && !VexTr.includes(base, d.maker.trim())) ? d.maker.trim() + ' ' + base : base;
    if (named) return named;
    if (d && d.port) return d.port;
    return kind === 'serial' ? _t('Unknown serial device') : _t('Unknown USB device');
  }
  function detailOf(kind, d) {
    const parts = [];
    if (d && d.port && nameOf(kind, d) !== d.port) parts.push(d.port);
    const ids = d ? _ids(d) : '';
    if (ids) parts.push(ids);
    return parts.join(' · ');
  }
  function hostOf(origin) { try { return new URL(origin).host || origin; } catch { return String(origin || ''); } }

  let active = null;   // the chooser on screen: a new request cancels it properly, so its page is answered and its key listener goes

  function show(data) {
    const { id, kind, origin, devices } = data || {};
    const serial = kind === 'serial';
    if (active) active('');
    document.querySelectorAll('.device-picker-overlay').forEach(o => o.remove());

    const list = Array.isArray(devices) ? devices : [];
    let resolved = false;
    let onKey = null;

    const overlay = document.createElement('div');
    overlay.className = 'hid-picker-overlay device-picker-overlay';

    const respond = (deviceId, remember) => {
      if (resolved) return;
      resolved = true;
      if (active === respond) active = null;
      Promise.resolve(window.vexDevices?.respond({ id, deviceId: deviceId || '', remember: !!(deviceId && remember) }))
        .then((r) => { if (r && r.ok && r.remembered === false && r.error) window.showToast?.(_t('The choice works for this page, but could not be remembered') + ': ' + r.error, 'error'); })
        .catch((err) => { window.VexProblems?.note('Devices', 'Could not answer the device request', err); });
      if (onKey) document.removeEventListener('keydown', onKey, true);
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 180);
    };

    overlay.innerHTML = `
      <div class="hid-picker" role="dialog" aria-modal="true" aria-label="${_esc(serial ? _t('Connect to a serial port') : _t('Connect to a USB device'))}">
        <div class="hid-picker-head">
          <div class="hid-picker-title">${_esc(serial ? _t('Connect to a serial port') : _t('Connect to a USB device'))}</div>
          <div class="hid-picker-origin"><strong class="device-picker-site">${_esc(hostOf(origin) || _t('A site'))}</strong> <span>${_esc(serial ? _t('wants to connect to a serial port') : _t('wants to connect to a USB device'))}</span></div>
        </div>
        <div class="hid-picker-list">
          ${list.length ? list.map((d, i) => `
            <button class="hid-device" data-idx="${i}">
              <span class="hid-device-name">${_esc(nameOf(kind, d))}</span>
              <span class="hid-device-ids">${_esc(detailOf(kind, d))}</span>
            </button>
          `).join('') : `<div class="hid-empty">${_esc(serial ? _t('No serial devices found. Plug the device in, then ask the page again.') : _t('No USB devices found. Plug the device in, then ask the page again.'))}</div>`}
        </div>
        ${list.length ? `
        <div class="hid-empty device-picker-warn">${_esc(_t('The site can send data to this device and read from it. Only pick one you mean to use.'))}</div>
        <label class="device-picker-remember"><input type="checkbox" class="device-picker-remember-box"> <span>${_esc(_t('Remember this device for this site'))}</span></label>` : ''}
        <div class="hid-picker-actions">
          <button class="btn-link" data-act="cancel">${_esc(_t('Cancel'))}</button>
          <button class="btn-primary" data-act="connect"${list.length ? '' : ' disabled'}>${_esc(_t('Connect'))}</button>
        </div>
      </div>
    `;
    active = respond;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    let selectedIdx = list.length ? 0 : -1;
    const deviceBtns = [...overlay.querySelectorAll('.hid-device')];
    const markSel = () => deviceBtns.forEach((b, i) => b.classList.toggle('selected', i === selectedIdx));
    markSel();

    const box = overlay.querySelector('.device-picker-remember-box');
    const doConnect = () => { if (selectedIdx >= 0 && list[selectedIdx]) respond(list[selectedIdx].id, !!(box && box.checked)); };

    deviceBtns.forEach(b => {
      b.addEventListener('click', () => { selectedIdx = parseInt(b.dataset.idx, 10); markSel(); });
      b.addEventListener('dblclick', doConnect);
    });
    overlay.querySelector('[data-act="connect"]').addEventListener('click', doConnect);
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => respond(''));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) respond(''); });
    onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); respond(''); } };
    document.addEventListener('keydown', onKey, true);
    return overlay;
  }

  // ---- Settings > Site permissions: the devices remembered for sites ----
  function whenText(g) {
    if (g.until === null || g.until === undefined) return '';
    return _t('Ends') + ': ' + new Date(g.until).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function grantLine(g) {
    const bits = [g.kind === 'serial' ? _t('Serial port') : _t('USB device'), nameOf(g.kind, { name: g.name, vendorId: g.vendorId, productId: g.productId }), whenText(g)];
    const ids = _ids(g);
    if (ids && !bits[1].includes(ids)) bits.splice(2, 0, ids);
    return bits.filter(Boolean).join(' · ');
  }
  async function renderGrants(host) {
    if (!host) return;
    let rows;
    try { rows = await window.vexDevices.grantsList(); }
    catch (err) { host.textContent = _t('The remembered devices could not be read') + ': ' + ((err && err.message) || ''); return; }
    host.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'perm-live-head';
    head.textContent = _t('Serial and USB devices');
    host.appendChild(head);
    if (!rows.length) {
      const none = document.createElement('div');
      none.className = 'perm-live-none';
      none.textContent = _t('No site has a serial port or USB device remembered.');
      host.appendChild(none);
      return;
    }
    for (const g of rows) {
      const row = document.createElement('div');
      row.className = 'permission-row';
      row.innerHTML = '<div class="perm-row-info"><div class="perm-row-origin"></div><div class="perm-row-detail"></div></div><button class="btn-secondary-sm" type="button"></button>';
      row.querySelector('.perm-row-origin').textContent = g.origin;
      row.querySelector('.perm-row-detail').textContent = grantLine(g);
      const btn = row.querySelector('button');
      btn.textContent = _t('Revoke');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try { await window.vexDevices.grantsRevoke(g.id); window.showToast?.(_t('Permission revoked'), 'info'); }
        catch (err) { window.showToast?.(_t('Could not revoke it') + ': ' + ((err && err.message) || ''), 'error'); }
        renderGrants(host);
      });
      host.appendChild(row);
    }
  }

  return { show, cancelActive: () => { if (active) active(''); }, nameOf, detailOf, grantLine, renderGrants, hostOf };
})();

if (typeof window !== 'undefined') {
  window.DevicePicker = DevicePicker;
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'serial-usb', label: 'Serial and USB devices', hint: 'Which sites may use a serial port or USB device you picked, and taking it back', icon: 'shield', action: () => { if (typeof SettingsUI !== 'undefined' && SettingsUI.openSection) SettingsUI.openSection('permissions-panel-content'); } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { DevicePicker };
