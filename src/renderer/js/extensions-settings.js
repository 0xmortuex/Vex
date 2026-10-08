// === Vex Phase 18: Extensions management UI ===

const ExtensionsSettings = (() => {
  function _toast(m, k) { if (typeof window.showToast === 'function') window.showToast(m, k); }
  function _esc(s) { return window.escapeHtml(s); }
  // An update of a switched-off extension replaces its files and leaves it off.
  // In safe mode it is placed but not loaded (found 2026-09-29).
  function _installedText(r) {
    if (r.afterRestart) return `Installed ${r.name} v${r.version} — it loads when Vex restarts normally`;
    return `Installed: ${r.name} v${r.version}` + (r.disabled ? ' — still switched off' : '');
  }

  // Icons live inside the install folder, so the manager loads them straight off
  // disk. encodeURI (not encodeURIComponent) keeps the drive letter and the path
  // separators intact while still escaping spaces.
  function _fileUrl(p) {
    if (typeof p !== 'string' || !p) return null;
    return encodeURI('file:///' + p.replace(/\\/g, '/').replace(/^\/+/, ''));
  }

  // "Runs in: browsing tabs + Discord" — from the partitions main loads it into.
  const PANEL_NAMES = { 'persist:discord': 'Discord', 'persist:whatsapp': 'WhatsApp', 'persist:claude': 'Claude', 'persist:spotify': 'Spotify', 'persist:netflix': 'Prime / Netflix', 'persist:roblox': 'Roblox' };
  function _whereText(ext) {
    const apps = (ext.where || []).map(p => PANEL_NAMES[p]).filter(Boolean);
    const base = 'Runs in: browsing tabs' + (apps.length ? ' + ' + apps.join(', ') : '');
    return ext.generic && !apps.length ? base + ' (a generic extension: one copy per panel otherwise)' : base;
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
      .ext-badge.ok{background:color-mix(in srgb, var(--success) 20%, transparent);color:var(--success);}
      .ext-badge.off{background:color-mix(in srgb, #9a9aa5 22%, transparent);color:var(--text-muted,#9a9aa5);}
      .ext-badge.bad{background:color-mix(in srgb, #ef4444 20%, transparent);color:#ef4444;}
      .ext-error{color:#ef4444;font-size:11px;margin-top:4px;line-height:1.35;word-break:break-word;}
      .ext-card-actions{display:flex;align-items:center;gap:8px;flex-shrink:0;}
      .ext-audit{margin-top:6px;font-size:11.5px;}
      .ext-reach{color:var(--text-muted);}
      .ext-reach-all{color:var(--danger,#ef4444);}
      .ext-reach-some{color:var(--text);}
      .ext-reach-click{color:var(--text-muted);}
      .ext-audit summary{cursor:pointer;color:var(--text-muted);font-size:11px;margin-top:3px;}
      .ext-powers{margin:4px 0 0;padding-left:16px;color:var(--text);}
      .ext-powers li{margin:1px 0;}
      .ext-hosts{margin-top:4px;color:var(--text-muted);font-size:10.5px;}
      .ext-toggle{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--text-muted,#9a9aa5);cursor:pointer;}
      .ext-open-btn{background:transparent;border:1px solid var(--border,rgba(255,255,255,0.12));color:var(--text,#e9e9ee);
        border-radius:6px;font-size:11px;padding:3px 8px;cursor:pointer;font-family:inherit;}
      .ext-open-btn:hover{border-color:var(--primary,#6366f1);}
      .ext-state-error{background:color-mix(in srgb, #ef4444 12%, transparent);border:1px solid #ef4444;
        border-radius:8px;padding:8px 10px;font-size:12px;color:#ef4444;margin-bottom:10px;}
      .ext-suggest{border:1px solid var(--border,rgba(255,255,255,0.12));border-radius:9px;padding:10px 12px;margin-bottom:8px;}
      .ext-suggest-name{font-size:13px;font-weight:600;color:var(--text,#e9e9ee);display:flex;align-items:center;gap:8px;}
      .ext-suggest-what{font-size:12px;color:var(--text-muted,#9a9aa5);margin-top:3px;line-height:1.45;}
      .ext-suggest-works{font-size:11.5px;margin-top:5px;line-height:1.45;color:var(--text,#e9e9ee);}
      .ext-suggest-caveat{font-size:11.5px;margin-top:3px;line-height:1.45;color:var(--text-muted,#9a9aa5);}
      .ext-suggest-limited{color:#f59e0b;}
      .ext-source-link{font-size:11.5px;font-weight:400;color:var(--text-muted,#9a9aa5);text-decoration:none;}
      .ext-source-link:hover{color:var(--primary,#6366f1);text-decoration:underline;}
      .ext-open-btn:disabled{opacity:.6;cursor:default;}
      .ext-unsupported{margin:6px 0 0;padding-left:18px;font-size:12px;color:var(--text-muted,#9a9aa5);line-height:1.6;}
      .ext-where{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:5px;font-size:11px;color:var(--text-muted,#9a9aa5);}
      .ext-note{margin-top:5px;font-size:11px;line-height:1.45;color:#f59e0b;}
      .ext-webstore{margin:12px 0 4px;}
      .ext-webstore-label{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--text,#e9e9ee);margin-bottom:5px;}
      .ext-webstore-row{display:flex;gap:8px;}
      .ext-webstore-row input{flex:1;min-width:0;font:inherit;font-size:12.5px;padding:6px 9px;border-radius:7px;
        background:var(--bg,transparent);color:var(--text,#e9e9ee);border:1px solid var(--border,rgba(255,255,255,0.12));}
      .ext-webstore-row input:focus-visible{outline:2px solid var(--primary,#6366f1);outline-offset:0;}
      .ext-webstore-note{font-size:11px;color:var(--text-muted,#9a9aa5);margin-top:5px;line-height:1.4;}
      .ext-scope{font:inherit;font-size:11px;padding:2px 6px;border-radius:6px;background:var(--surface,rgba(255,255,255,0.04));
        color:var(--text,#e9e9ee);border:1px solid var(--border,rgba(255,255,255,0.12));cursor:pointer;}
      .ext-updates{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0 4px;font-size:12px;color:var(--text,#e9e9ee);}
      .ext-updates-status{flex-basis:100%;font-size:11px;color:var(--text-muted,#9a9aa5);line-height:1.4;}
      .ext-source{margin-top:4px;font-size:11px;color:var(--text-muted,#9a9aa5);line-height:1.4;}
      .ext-pending{margin-top:6px;padding:6px 8px;border-radius:7px;font-size:11.5px;line-height:1.45;
        border:1px solid color-mix(in srgb, #f59e0b 55%, transparent);background:color-mix(in srgb, #f59e0b 10%, transparent);color:var(--text,#e9e9ee);}
      .ext-pending ul{margin:3px 0 4px;padding-left:16px;}
      .ext-fileaccess{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:5px;font-size:11px;color:var(--text-muted,#9a9aa5);}
    `;
    document.head.appendChild(st);
  }

  // What this extension can read and do, in the manifest's own words
  // (src/main/extension-audit.js). Shown on the card because "it can read
  // every page you open" is the thing nobody checks after installing.
  function _auditHtml(e) {
    const a = e && e.audit;
    if (!a || !a.reach) return '';
    const tone = { all: 'ext-reach-all', some: 'ext-reach-some', click: 'ext-reach-click', none: '' }[a.reach.level] || '';
    const heavy = a.powers.filter(p => p.heavy);
    const rest = a.powers.filter(p => !p.heavy);
    const list = (items) => items.map(p => `<li>${_esc(p.says)}</li>`).join('');
    return `
      <div class="ext-audit">
        <div class="ext-reach ${tone}">${_esc(a.reach.says)}</div>
        ${a.powers.length ? `<details>
          <summary>What it is allowed to do (${a.powers.length})</summary>
          <ul class="ext-powers">${list(heavy)}${list(rest)}</ul>
          ${a.reach.hosts.length ? `<div class="ext-hosts">Sites it names: ${_esc(a.reach.hosts.join(', '))}</div>` : ''}
          <div class="ext-hosts">Vex cannot give an extension access to some sites and not others — that is all or nothing. What you can do is switch it off, or keep it out of the app panels above.</div>
        </details>` : ''}
      </div>`;
  }

  // Where it came from, and so whether Vex can update it.
  function _sourceHtml(e) {
    const s = e.source;
    let says;
    if (s && s.kind === 'webstore') says = 'From the Chrome Web Store. Vex keeps it up to date from there.';
    else if (s && s.kind === 'catalog') {
      says = `From its publisher's GitHub releases${s.repo ? ` (${_esc(s.repo)}${s.tag ? ', ' + _esc(s.tag) : ''})` : ''}. Vex keeps it up to date from there. `
        + (s.digestChecked ? 'The download matched the digest GitHub published for it.' : 'GitHub published no digest for this file, so the download could not be checked against one.')
        + ' These releases are not signed or reviewed by any store.';
    } else says = 'Installed from a file or a folder: not from the Chrome Web Store, and Vex cannot update it by itself.';
    return `<div class="ext-source">${says}</div>`;
  }

  // A newer version that asks for more waits for the person; the last
  // update and the last failed check are said too.
  function _updateHtml(e) {
    const u = e.update;
    if (!u) return '';
    const out = [];
    if (u.pending) {
      out.push(`<div class="ext-pending"><strong>Update needs approval:</strong> version ${_esc(u.pending.version)} asks for more than this one:
        <ul>${(u.pending.added || []).map(a => `<li>${_esc(a.says)}</li>`).join('')}</ul>
        <button class="ext-open-btn" data-update-approve="${_esc(e.folder)}" data-name="${_esc(e.name)}" data-version="${_esc(u.pending.version)}">Update</button></div>`);
    }
    if (u.last) {
      const when = new Date(u.last.at).toLocaleDateString();
      out.push(`<div class="ext-source">Updated ${{ approved: 'with your approval ', auto: 'automatically ', check: 'by "Check now" ' }[u.last.how] || ''}from v${_esc(u.last.from)} to v${_esc(u.last.to)} on ${_esc(when)}.</div>`);
    }
    if (u.error) out.push(`<div class="ext-error">Last update check failed: ${_esc(u.error)}</div>`);
    return out.join('');
  }

  // Chrome's "Allow access to file URLs": off unless switched on here.
  function _fileAccessHtml(e) {
    let note = '';
    if (e.fileAccessKept) note = 'Left on when Vex made this a choice: its manifest names file:// pages, so working on your files is part of its job.';
    else if (e.fileUrls && !e.fileAccess) note = 'Its manifest names file:// pages; it cannot run on files on this computer until you allow this.';
    return `<div class="ext-fileaccess"><label class="ext-toggle"><input type="checkbox" data-file-access="${_esc(e.folder)}"${e.fileAccess ? ' checked' : ''}> Allow access to file URLs</label>${note ? `<span>${_esc(note)}</span>` : ''}</div>`;
  }

  function _ago(ms) {
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    return h < 48 ? h + ' h ago' : Math.round(h / 24) + ' days ago';
  }
  function _updatesStatusText(s) {
    if (!s || !s.ok) return (s && s.error) || 'Could not read the update state.';
    if (s.checking) return 'Checking now…';
    if (!s.lastCheck) return (s.lastOutcome ? s.lastOutcome + ' ' : '') + 'Not checked yet: the first check runs two minutes after Vex starts, then every six hours.';
    return `Last checked ${_ago(s.lastCheck)}. ${s.lastOutcome || ''}`;
  }

  async function render(container) {
    if (!container) container = document.getElementById('extensions-panel-content');
    if (!container) return;
    _injectStyles();

    let extensions = [];
    let listError = null;
    try { extensions = await window.vex.extensionsList(); }
    catch (err) { listError = (err && err.message) || String(err); }
    let updates = null;
    try { updates = await window.vex.extensionsUpdateStatus(); }
    catch (err) { updates = { ok: false, error: (err && err.message) || String(err) }; }

    // The ones that can read everything come first: this list is read to
    // check, and what you are checking for should not be at the bottom.
    extensions = extensions.slice().sort((a, b) => ((b.audit && b.audit.weight) || 0) - ((a.audit && a.audit.weight) || 0));

    // Reported by main when the enabled/disabled file can't be read — without
    // this the user would silently get every extension back on after a restart.
    const stateError = extensions.length ? extensions[0].stateError : null;

    // Every Install / toggle re-renders; the catalogue folded shut after each
    // one, so installing three from it meant reopening it three times. It
    // keeps whatever state the user left it in (found 2026-09-29).
    const catalogWasOpen = !!container.querySelector('details[data-ext-catalog]')?.open;

    container.innerHTML = `
      <div class="extensions-panel">
        <p class="setting-info muted" style="margin-bottom:12px">Vex supports Chrome extensions from the Chrome Web Store, or loaded from a folder, <code>.zip</code>, or <code>.crx</code>. Extensions load into regular and container tabs, and into a sidebar panel (Discord, Spotify…) only when they name that site &mdash; or when set to run everywhere below. Private, Off-the-Record and Tor tabs never load extensions &mdash; Electron can't put them in a temporary session.</p>

        ${listError ? `<div class="ext-state-error">Couldn't read the installed extensions: ${_esc(listError)}</div>` : ''}
        ${stateError ? `<div class="ext-state-error">${_esc(stateError)}</div>` : ''}

        <div class="extensions-actions">
          <button class="btn-primary" id="btn-install-zip">${VexIcons.svg('box', { size: 14 })} Install from .zip / .crx</button>
          <button class="btn-secondary" id="btn-install-folder">${VexIcons.svg('folder', { size: 14 })} Install from folder</button>
          <button class="btn-link" id="btn-open-ext-folder">Open extensions folder</button>
        </div>

        <div class="ext-updates">
          <label class="ext-toggle" style="font-size:12px;color:var(--text,#e9e9ee)"><input type="checkbox" id="ext-auto-update"${updates && updates.ok && updates.auto ? ' checked' : ''}${updates && updates.ok ? '' : ' disabled'}> Update extensions automatically</label>
          <button class="ext-open-btn" id="btn-ext-check-updates"${updates && updates.checking ? ' disabled' : ''}>${VexIcons.svg('refresh', { size: 12 })} Check now</button>
          <div class="ext-updates-status" id="ext-updates-status">${_esc(_updatesStatusText(updates))} Extensions from the Chrome Web Store or the list below are checked; a new version that asks for more waits for your approval. Not on a metered connection, and never from a private window.</div>
        </div>

        <div class="ext-webstore">
          <label class="ext-webstore-label" for="ext-webstore-input">${VexIcons.svg('puzzle', { size: 14 })} Paste a Chrome Web Store link</label>
          <div class="ext-webstore-row">
            <input id="ext-webstore-input" type="text" spellcheck="false" autocomplete="off" placeholder="https://chromewebstore.google.com/detail/&hellip; or an extension id">
            <button class="btn-primary" id="btn-install-webstore">Install</button>
          </div>
          <div class="ext-webstore-note">Vex downloads it from Google&rsquo;s own update server and installs it only if its signatures check out. You see what it can do before anything is installed.</div>
        </div>

        <div class="extensions-help">
          <details>
            <summary>How do I get Chrome extensions?</summary>
            <div class="help-content">
              <p><strong>Option 1 &mdash; the Chrome Web Store</strong></p>
              <ol>
                <li>Open the extension&rsquo;s page at <a href="#" data-open="https://chromewebstore.google.com/">chromewebstore.google.com</a> in a Vex tab</li>
                <li>Click <strong>Add to Vex</strong> in the address bar (or Ctrl+K &rarr; &quot;Install this extension from the Web Store&quot;), or copy the page&rsquo;s address and paste it in the field above</li>
                <li>Read what it can do and what will not work here, then click <strong>Add to Vex</strong></li>
                <li>Later, <strong>Update from Web Store</strong> on its card fetches the newest version; its settings stay</li>
              </ol>
              <p><strong>Option 2 &mdash; GitHub (for open-source extensions)</strong></p>
              <ol>
                <li>Download the extension's source as a .zip</li>
                <li>Extract it, locate the folder containing <code>manifest.json</code></li>
                <li>Click &quot;Install from folder&quot; &rarr; pick that folder</li>
              </ol>
              <p><strong>What works here:</strong> content scripts (page tweaks, themes, readers), <code>chrome.storage</code> (<code>storage.sync</code> is kept on this machine, not synced), <code>chrome.tabs</code> (including opening and closing tabs), <code>chrome.scripting</code>, <code>chrome.alarms</code>, <code>chrome.i18n</code>, <code>chrome.permissions</code>, options pages and toolbar popups.</p>
              <p><strong>What Electron can't do:</strong></p>
              <ul class="ext-unsupported">${VexExtensionCatalog.UNSUPPORTED.map(u => `<li>${_esc(u)}</li>`).join('')}</ul>
            </div>
          </details>
        </div>

        <div class="extensions-help">
          <details data-ext-catalog${extensions.length === 0 || catalogWasOpen ? ' open' : ''}>
            <summary>Extensions worth installing</summary>
            <div class="help-content">
              <p class="setting-info muted" style="margin:0 0 8px">Each of these was checked against what Electron actually supports. <strong>Install</strong> fetches the latest release from the publisher's own GitHub and installs it; Vex then keeps it up to date from there (or press it again to update now).</p>
              ${VexExtensionCatalog.ENTRIES.map(x => {
                const have = extensions.find(e => String(e.name || '').toLowerCase() === x.name.toLowerCase());
                return `
                <div class="ext-suggest">
                  <div class="ext-suggest-name">${_esc(x.name)}${have ? ` <span class="ext-version">v${_esc(have.version)} installed</span>` : ''}
                    <a href="#" class="ext-source-link" data-open="${_esc(x.source)}" style="margin-left:auto">Source</a>
                    <button class="ext-open-btn" data-install-catalog="${_esc(x.id)}">${have ? 'Update' : 'Install'}</button>
                  </div>
                  <div class="ext-suggest-what">${_esc(x.what)}</div>
                  <div class="ext-suggest-works${x.limited ? ' ext-suggest-limited' : ''}"><strong>In Vex:</strong> ${_esc(x.works)}</div>
                  ${x.caveat ? `<div class="ext-suggest-caveat">${_esc(x.caveat)}</div>` : ''}
                </div>`; }).join('')}
            </div>
          </details>
        </div>

        ${extensions.length === 0 ? `
          <div class="empty-state" style="padding:30px 10px">
            <div class="empty-icon">${VexIcons.svg('puzzle', { size: 32 })}</div>
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
                  : `<div class="ext-icon-fallback">${VexIcons.svg('puzzle', { size: 22 })}</div>`}
                <div class="ext-info">
                  <div class="ext-name">${_esc(e.name)} <span class="ext-version">v${_esc(e.version)}</span><span class="ext-badge ${status.tone}">${_esc(status.label)}</span></div>
                  <div class="ext-desc">${_esc(e.description || 'No description')}</div>
                  <div class="ext-folder"><code>${_esc(e.folder)}</code></div>
                  ${Array.isArray(e.where) ? `<div class="ext-where">${_esc(_whereText(e))}
                    <select class="ext-scope" data-scope="${_esc(e.folder)}" title="Where this extension runs">
                      <option value="auto"${e.scope !== 'everywhere' ? ' selected' : ''}>where it applies</option>
                      <option value="everywhere"${e.scope === 'everywhere' ? ' selected' : ''}>everywhere — every app panel too</option>
                    </select></div>` : ''}
                  ${_sourceHtml(e)}
                  ${_updateHtml(e)}
                  ${_auditHtml(e)}
                  ${_fileAccessHtml(e)}
                  ${e.blocker && e.generic ? `<div class="ext-note">Vex blocks ad and tracker requests itself (Settings › Privacy). Electron gives extensions no request blocking, so here this one can only hide page elements — and its background page costs about 85 MB for that.</div>` : ''}
                  ${e.error ? `<div class="ext-error">${_esc(e.error)}</div>` : ''}
                </div>
                <div class="ext-card-actions">
                  ${e.hasPopup && e.loaded ? `<button class="ext-open-btn" data-popup="${_esc(e.folder)}">Popup</button>` : ''}
                  ${e.optionsUrl ? `<button class="ext-open-btn" data-options="${_esc(e.optionsUrl)}">Options</button>` : ''}
                  ${e.webstore ? `<button class="ext-open-btn" data-webstore-update="${_esc(e.webstore)}" title="Download the newest version from the Chrome Web Store">Update from Web Store</button>` : ''}
                  <label class="ext-toggle"><input type="checkbox" data-toggle="${_esc(e.folder)}" ${e.enabled ? 'checked' : ''}> On</label>
                  <button class="btn-danger-sm" data-folder="${_esc(e.folder)}" data-name="${_esc(e.name || e.folder)}">Uninstall</button>
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
    // One click: the latest release from the publisher's GitHub, installed by
    // main (main/extension-sources.js decides where it comes from).
    container.querySelectorAll('[data-install-catalog]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!window.vex || typeof window.vex.extensionsInstallCatalog !== 'function') { _toast('Installing is not available in this window', 'error'); return; }
        const label = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Installing…';
        try {
          const r = await window.vex.extensionsInstallCatalog(btn.dataset.installCatalog);
          if (r && r.ok) { _toast(_installedText(r), 'success'); render(container); return; }
          _toast('Install failed: ' + ((r && r.error) || 'unknown'), 'error');
        } catch (err) {
          _toast('Install failed: ' + ((err && err.message) || 'unknown'), 'error');
        }
        btn.disabled = false;
        btn.textContent = label;
      });
    });
    // The Chrome Web Store (js/web-store.js): main downloads and checks it, the
    // dialog says what it can do, and only then is it installed.
    const webStoreInstall = async (input, btn) => {
      if (typeof VexWebStore === 'undefined') { _toast('Installing from the Web Store is not available in this window', 'error'); return; }
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Checking…';
      try {
        const r = await VexWebStore.install(input);
        if (r && r.ok) { render(container); return; }
      } finally {
        if (btn.isConnected) { btn.disabled = false; btn.textContent = label; }
      }
    };
    const wsInput = container.querySelector('#ext-webstore-input');
    const wsButton = container.querySelector('#btn-install-webstore');
    if (wsInput && wsButton) {
      wsButton.addEventListener('click', () => {
        if (!wsInput.value.trim()) { _toast('Paste a Chrome Web Store link or an extension id first', 'info'); wsInput.focus(); return; }
        webStoreInstall(wsInput.value, wsButton);
      });
      wsInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); wsButton.click(); } });
    }
    container.querySelectorAll('[data-webstore-update]').forEach(btn => {
      btn.addEventListener('click', () => webStoreInstall(btn.dataset.webstoreUpdate, btn));
    });
    // A .zip, .crx or folder: main checks it and says what it asks for (a
    // .crx through the same signature checks as a Web Store install); the
    // same dialog as a Web Store install; then main installs that one.
    const pickAndInstall = async (pick) => {
      const p = await pick();
      if (!p || p.cancelled) return;
      if (!p.ok) { _toast('Could not install: ' + (p.error || 'unknown'), 'error'); return; }
      if (p.refuse) { await vexAlert({ title: `Vex cannot install ${p.name}`, message: p.refuse }); return; }
      if (typeof VexWebStore === 'undefined') { _toast('The install dialog is not available in this window', 'error'); return; }
      const yes = await vexConfirm({
        title: `${p.installed ? 'Update' : 'Add'} "${p.name}"?`,
        html: VexWebStore.dialogHtml(p),
        okLabel: p.installed ? 'Update' : 'Add to Vex',
      });
      if (!yes) return;
      const r = await window.vex.extensionsInstallPicked(p.token);
      if (r && r.ok) { _toast(_installedText(r), 'success'); render(container); }
      else _toast('Install failed: ' + ((r && r.error) || 'unknown'), 'error');
    };
    document.getElementById('btn-install-zip')?.addEventListener('click', () => pickAndInstall(() => window.vex.extensionsInstallZip()));
    document.getElementById('btn-install-folder')?.addEventListener('click', () => pickAndInstall(() => window.vex.extensionsInstallFolder()));
    container.querySelector('#ext-auto-update')?.addEventListener('change', async (ev) => {
      const box = ev.currentTarget;
      const r = await window.vex.extensionsSetAutoUpdate(box.checked);
      if (!r || !r.ok) { box.checked = !box.checked; _toast('Could not change it: ' + ((r && r.error) || 'unknown'), 'error'); return; }
      _toast(r.auto ? 'Extensions are updated automatically' : 'Extensions are no longer updated automatically', 'success');
    });
    container.querySelector('#btn-ext-check-updates')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      const status = container.querySelector('#ext-updates-status');
      if (status) status.textContent = 'Checking now…';
      const r = await window.vex.extensionsUpdateCheck();
      if (!r || !r.ok) _toast('Could not check for updates: ' + ((r && r.error) || 'unknown'), 'error');
      else _toast(r.lastOutcome || 'Checked', (r.failed && r.failed.length) ? 'error' : 'success');
      render(container);
    });
    container.querySelectorAll('[data-update-approve]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!await vexConfirm({ title: `Update "${btn.dataset.name}"?`, message: `Version ${btn.dataset.version} gets the extra permissions listed on its card.`, okLabel: 'Update' })) return;
        btn.disabled = true;
        const r = await window.vex.extensionsUpdateApprove(btn.dataset.updateApprove);
        if (r && r.ok) _toast(r.current ? `${btn.dataset.name} is already up to date` : `Updated ${r.name || btn.dataset.name} to v${r.version}`, 'success');
        else _toast('Update failed: ' + ((r && r.error) || 'unknown'), 'error');
        render(container);
      });
    });
    container.querySelectorAll('[data-file-access]').forEach(box => {
      box.addEventListener('change', async () => {
        const wanted = box.checked;
        const r = await window.vex.extensionsSetFileAccess(box.dataset.fileAccess, wanted);
        if (!r || !r.ok) { _toast('Could not change file access: ' + ((r && r.error) || 'unknown'), 'error'); }
        else _toast(wanted ? 'It can now open files on this computer (file:// pages)' : 'It can no longer open files on this computer', 'success');
        render(container);
      });
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
        } else if (r.afterRestart) {
          // Safe mode loads no extensions, so switching one on only saves it.
          _toast('Saved — it loads when Vex restarts normally', 'info');
        } else {
          _toast(wanted ? 'Extension enabled' : 'Extension disabled', 'success');
        }
        render(container);
      });
    });
    // Where it runs: 'auto' loads it into browsing sessions plus the app
    // panels it names; 'everywhere' into every panel. Applied live by main.
    container.querySelectorAll('[data-scope]').forEach(sel => {
      sel.addEventListener('change', async () => {
        const r = await window.vex.extensionsSetScope(sel.dataset.scope, sel.value);
        if (!r.ok) _toast('Could not change where it runs: ' + (r.error || 'unknown'), 'error');
        else _toast(sel.value === 'everywhere' ? 'Now runs in every panel' : 'Now runs only where it applies', 'success');
        render(container);
      });
    });
    container.querySelectorAll('[data-popup]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const rect = btn.getBoundingClientRect();
        // The tab you are on, as the toolbar menu sends it (extensions-menu.js
        // _runExtension) — without it the popup took itself for the page and
        // said "This page is protected by browser" (found 2026-09-29).
        const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.getActiveWebview() : null;
        let tab = null;
        if (wv && typeof wv.getWebContentsId === 'function') { try { tab = wv.getWebContentsId(); } catch { /* not attached yet */ } }
        const r = await window.vex.extensionsOpenPopup({
          folder: btn.dataset.popup,
          x: Math.max(0, Math.round(window.screenX + rect.left)),
          y: Math.max(0, Math.round(window.screenY + rect.bottom)),
          tab: Number.isInteger(tab) && tab > 0 ? tab : null
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
        // The extension's name, not its install folder ("devforum-plus-1790659315165")
        // (found 2026-09-29).
        if (!await vexConfirm({ title: 'Uninstall extension', message: `Uninstall "${btn.dataset.name || folder}"? Restart Vex to fully unload from running tabs.`, okLabel: 'Uninstall', danger: true })) return;
        const r = await window.vex.extensionsUninstall(folder);
        if (r.ok) { _toast('Uninstalled — restart Vex to fully remove', 'success'); render(container); }
        else _toast('Uninstall failed: ' + (r.error || 'unknown'), 'error');
      });
    });
  }

  return { render, _fileUrl, _statusOf };
})();

window.ExtensionsSettings = ExtensionsSettings;
// Installed from somewhere else (the address bar's "Add to Vex", the command
// bar) while this list is open: show it.
window.addEventListener('vex-extensions-changed', () => {
  const c = document.getElementById('extensions-panel-content');
  if (c && c.querySelector('.extensions-panel')) ExtensionsSettings.render(c);
});
if (typeof module !== 'undefined' && module.exports) module.exports = { ExtensionsSettings };
