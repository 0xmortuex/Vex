// === Vex Location Settings ===
// Renders into #location-panel-content inside the Settings panel. Backed by
// localStorage (mirrored to disk by the PersistentStorage shim) so main.js
// can read the same values via the persist cache.

const LocationSettings = (() => {

  const PRESETS = [
    { name: 'Fatih (center)', lat: 41.0082, lng: 28.9784 },
    { name: 'Kad\u0131k\u00f6y',   lat: 40.9862, lng: 29.0253 },
    { name: 'Be\u015fikta\u015f',   lat: 41.0430, lng: 29.0091 },
    { name: 'Beyo\u011flu',    lat: 41.0545, lng: 28.9847 },
    { name: 'Maltepe',    lat: 40.9368, lng: 29.1553 },
    { name: '\u015ei\u015fli',      lat: 41.0663, lng: 29.0163 }
  ];

  function _get(key, fb) {
    try { const r = localStorage.getItem(key); return r === null ? fb : JSON.parse(r); }
    catch { return fb; }
  }
  function _set(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }
  function _esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function _toast(m, k, d) { if (typeof window.showToast === 'function') window.showToast(m, k, d); }

  function render(container) {
    if (!container) return;
    const saved = _get('vex.manualLocation', null);
    // If no mode has ever been saved, persist the default so main.js's
    // geolocation:get handler reads the same value we show in the UI.
    // Without this, users who never click a radio silently have no mode
    // on disk, and check-permission / get behave like first-run forever.
    let mode = _get('vex.locationMode', null);
    if (!mode) {
      mode = 'manual';
      _set('vex.locationMode', mode);
    }

    container.innerHTML = `
      <p class="setting-info muted" style="margin-bottom:10px">What Vex reports when a site asks for your location. Manual is the most accurate and private option \u2014 nothing leaves your device.</p>

      <div class="location-mode-picker">
        ${['manual','ip','off'].map(m => {
          const active = mode === m ? ' active' : '';
          const checked = mode === m ? ' checked' : '';
          const title = m === 'manual' ? 'Manual (recommended)' : m === 'ip' ? 'IP-based (automatic)' : 'Off';
          const desc = m === 'manual' ? 'Set your location once, Vex returns it every time. Most accurate.'
                    : m === 'ip'    ? "Uses your internet provider's location. Usually off by 10-50 km."
                    :                 "All location requests fail. Sites can't see where you are.";
          return `
            <label class="mode-option${active}">
              <input type="radio" name="loc-mode" value="${m}"${checked}>
              <div>
                <strong>${title}</strong>
                <div class="mode-desc">${desc}</div>
              </div>
            </label>`;
        }).join('')}
      </div>

      <div class="manual-location-form" id="manual-location-form" style="${mode === 'manual' ? '' : 'display:none'}">
        <h3>Your location</h3>
        <div class="form-row" style="display:flex;gap:10px">
          <div class="form-field" style="flex:1">
            <label>Latitude</label>
            <input type="number" step="0.000001" id="loc-lat" value="${saved?.latitude ?? ''}" placeholder="41.0082">
          </div>
          <div class="form-field" style="flex:1">
            <label>Longitude</label>
            <input type="number" step="0.000001" id="loc-lng" value="${saved?.longitude ?? ''}" placeholder="28.9784">
          </div>
        </div>
        <div class="form-field">
          <label>Label (for your reference)</label>
          <input type="text" id="loc-label" value="${_esc(saved?.label || '')}" placeholder="Home, Istanbul">
        </div>
        <div class="location-helpers">
          <button class="btn-secondary" id="btn-get-coords">\ud83d\uddfa\ufe0f Look up my address</button>
          <button class="btn-secondary" id="btn-use-ip-once">\ud83d\udce1 Use IP location once</button>
        </div>
        <div class="preset-cities">
          <div class="preset-label">Istanbul districts</div>
          ${PRESETS.map(p => `<button class="preset-btn" data-lat="${p.lat}" data-lng="${p.lng}" data-name="${_esc(p.name)}">${_esc(p.name)}</button>`).join('')}
        </div>
        <button class="btn-primary" id="btn-save-location" style="margin-top:10px">Save Location</button>
      </div>

      <div id="location-preview" class="location-preview" style="${saved ? '' : 'display:none'}">
        <div class="preview-label">Currently set to</div>
        <div class="preview-coords">${saved ? `${Number(saved.latitude).toFixed(4)}, ${Number(saved.longitude).toFixed(4)}` : ''}</div>
        ${saved?.label ? `<div class="preview-name">${_esc(saved.label)}</div>` : ''}
      </div>
    `;

    _wire(container);
  }

  function _wire(container) {
    container.querySelectorAll('input[name="loc-mode"]').forEach(radio => {
      radio.addEventListener('change', () => {
        _set('vex.locationMode', radio.value);
        const form = container.querySelector('#manual-location-form');
        if (form) form.style.display = radio.value === 'manual' ? '' : 'none';
        container.querySelectorAll('.mode-option').forEach(el => {
          const r = el.querySelector('input[name="loc-mode"]');
          el.classList.toggle('active', !!(r && r.checked));
        });
        _toast(`Location mode: ${radio.value}`, 'info', 2000);
      });
    });

    container.querySelector('#btn-save-location')?.addEventListener('click', () => {
      const lat = parseFloat(container.querySelector('#loc-lat').value);
      const lng = parseFloat(container.querySelector('#loc-lng').value);
      const label = container.querySelector('#loc-label').value.trim();
      if (isNaN(lat) || isNaN(lng)) { _toast('Please enter valid coordinates', 'warn'); return; }
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) { _toast('Coordinates out of range', 'warn'); return; }
      _set('vex.manualLocation', { latitude: lat, longitude: lng, label });
      _toast('Location saved', 'success');
      const preview = container.querySelector('#location-preview');
      if (preview) {
        preview.style.display = '';
        preview.innerHTML = `
          <div class="preview-label">Currently set to</div>
          <div class="preview-coords">${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
          ${label ? `<div class="preview-name">${_esc(label)}</div>` : ''}
        `;
      }
    });

    container.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelector('#loc-lat').value = btn.dataset.lat;
        container.querySelector('#loc-lng').value = btn.dataset.lng;
        container.querySelector('#loc-label').value = btn.dataset.name || btn.textContent.trim();
      });
    });

    container.querySelector('#btn-get-coords')?.addEventListener('click', () => {
      if (typeof TabManager !== 'undefined') TabManager.createTab('https://www.latlong.net/', true);
      _toast('Search your address on that page, then copy the coordinates back here', 'info', 6000);
    });

    container.querySelector('#btn-use-ip-once')?.addEventListener('click', async () => {
      _toast('Looking up your IP location\u2026', 'info', 2500);
      try {
        const r = await fetch('https://ipapi.co/json/');
        const d = await r.json();
        if (d && d.latitude && d.longitude) {
          container.querySelector('#loc-lat').value = d.latitude;
          container.querySelector('#loc-lng').value = d.longitude;
          container.querySelector('#loc-label').value = `${d.city || 'IP location'} (${d.country_code || ''})`;
          _toast(`Got: ${d.city || 'unknown'}, ${d.country_name || ''}`, 'success');
        } else {
          _toast('IP lookup returned no coordinates', 'error');
        }
      } catch {
        _toast('IP lookup failed', 'error');
      }
    });
  }

  return { render };
})();

window.LocationSettings = LocationSettings;
