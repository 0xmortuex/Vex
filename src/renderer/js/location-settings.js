// === Vex Location Settings ===
// Renders into #location-panel-content inside the Settings panel. Backed by
// localStorage (mirrored to disk by the PersistentStorage shim) so main.js
// can read the same values via the persist cache.

const LocationSettings = (() => {

  // A few well-known cities as quick presets. Users can type exact coordinates
  // or look up their address; these are just convenient starting points.
  const PRESETS = [
    { name: 'New York',  lat: 40.7128, lng: -74.0060 },
    { name: 'London',    lat: 51.5074, lng: -0.1278 },
    { name: 'Berlin',    lat: 52.5200, lng: 13.4050 },
    { name: 'Istanbul',  lat: 41.0082, lng: 28.9784 },
    { name: 'Tokyo',     lat: 35.6762, lng: 139.6503 },
    { name: 'Sydney',    lat: -33.8688, lng: 151.2093 }
  ];

  function _get(key, fb) {
    try { const r = localStorage.getItem(key); return r === null ? fb : JSON.parse(r); }
    catch { return fb; }
  }
  // Returns false when the write failed, so no caller claims a save that did
  // not happen.
  function _set(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { return false; }
    return true;
  }

  // The saved coordinates, or null when none are usable. Vex answers a site's
  // location request from exactly this — if it is null, manual mode has nothing
  // to give and the request fails (it does NOT quietly fall back to an IP
  // lookup, which would put the user's address on the network behind a setting
  // that says nothing leaves your device).
  function _coords() {
    const m = _get('vex.manualLocation', null);
    if (!m || typeof m !== 'object') return null;
    const lat = Number(m.latitude), lng = Number(m.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { latitude: lat, longitude: lng, label: typeof m.label === 'string' ? m.label : '' };
  }
  function _esc(s) { return window.escapeHtml(s); }
  function _toast(m, k, d) { if (typeof window.showToast === 'function') window.showToast(m, k, d); }

  function render(container) {
    if (!container) return;
    const saved = _coords();
    // Opening a settings panel is a read, not a change. This used to write the
    // default mode to storage as a side effect of rendering, so merely looking
    // at the panel recorded a decision the user never made — and that write
    // then looked like an explicit choice to everything downstream. main.js
    // applies the same 'manual' default when nothing is stored, so showing it
    // here needs no write at all.
    const mode = _get('vex.locationMode', null) || 'manual';
    const needsCoords = mode === 'manual' && !saved;

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

      <div class="location-unset-warning" id="location-unset-warning" role="alert"
           style="display:${needsCoords ? 'flex' : 'none'};align-items:flex-start;gap:8px;margin:10px 0;padding:10px 12px;border:1px solid var(--danger,#e5484d);border-radius:9px;color:var(--danger,#e5484d);font-size:12px">
        ${window.VexIcons?.svg('warning', { size: 14 }) || ''}
        <span>Manual mode is selected but no coordinates are saved. Until you set one below, sites that ask for your location are told it is unavailable — Vex will not look it up from your IP address behind your back.</span>
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
          <input type="text" id="loc-label" value="${_esc(saved?.label || '')}" placeholder="Home">
        </div>
        <div class="location-helpers">
          <button class="btn-secondary" id="btn-get-coords">${window.VexIcons?.svg('map', { size: 13 }) || ''} Look up my address</button>
          <button class="btn-secondary" id="btn-use-ip-once">${window.VexIcons?.svg('wifi', { size: 13 }) || ''} Use IP location once</button>
        </div>
        <div class="preset-cities">
          <div class="preset-label">Quick presets</div>
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

  // Show or hide the "manual mode, but no coordinates" alert. Called whenever
  // either half of that condition can have changed, so the panel never claims a
  // working manual location it does not have.
  function _paintUnsetWarning(container, mode) {
    const el = container.querySelector('#location-unset-warning');
    if (!el) return;
    const current = mode || _get('vex.locationMode', null) || 'manual';
    el.style.display = (current === 'manual' && !_coords()) ? 'flex' : 'none';
  }

  function _wire(container) {
    container.querySelectorAll('input[name="loc-mode"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const stored = _set('vex.locationMode', radio.value);
        const form = container.querySelector('#manual-location-form');
        if (form) form.style.display = radio.value === 'manual' ? '' : 'none';
        container.querySelectorAll('.mode-option').forEach(el => {
          const r = el.querySelector('input[name="loc-mode"]');
          el.classList.toggle('active', !!(r && r.checked));
        });
        _paintUnsetWarning(container, radio.value);
        if (!stored) { _toast('Mode changed for now, but it could not be saved — it resets when you restart Vex', 'error'); return; }
        _toast(`Location mode: ${radio.value}`, 'info', 2000);
      });
    });

    container.querySelector('#btn-save-location')?.addEventListener('click', () => {
      const lat = parseFloat(container.querySelector('#loc-lat').value);
      const lng = parseFloat(container.querySelector('#loc-lng').value);
      const label = container.querySelector('#loc-label').value.trim();
      if (isNaN(lat) || isNaN(lng)) { _toast('Please enter valid coordinates', 'warn'); return; }
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) { _toast('Coordinates out of range', 'warn'); return; }
      // Confirm the value really landed before saying "saved" — and before the
      // warning about having no location comes down.
      const stored = _set('vex.manualLocation', { latitude: lat, longitude: lng, label }) && !!_coords();
      if (!stored) { _toast('Your location could not be saved — sites will still be told it is unavailable', 'error'); return; }
      _toast('Location saved', 'success');
      _paintUnsetWarning(container);
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
        const r = await (window.VexNet?.fetch || fetch)('https://ipapi.co/json/');
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
