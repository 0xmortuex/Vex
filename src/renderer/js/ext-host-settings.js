// === Vex — Claude for Chrome install UI ===
//
// Lists Claude extensions already unpacked in the user's Chrome profile so
// installing is one click, with a folder picker as the fallback. Installing
// copies the extension into Vex and patches the copy; the Chrome original is
// left alone.

const ExtHostSettings = {
  _busy: false,

  async render() {
    const box = document.getElementById('ext-host-content');
    if (!box || !window.vex?.extHost) return;

    let status = null;
    try { status = await window.vex.extHost.status(); } catch {}

    if (status && status.installed) {
      box.innerHTML = `
        <div class="ai-status-card">
          <div class="status-row">
            <span class="status-label">${AIPanel._esc(status.name || 'Extension')} ${AIPanel._esc(status.version || '')}</span>
            <span class="status-badge ok">Installed</span>
          </div>
          <div class="status-row" style="font-size:11px;color:var(--text-muted);word-break:break-all">${AIPanel._esc(status.id || '')}</div>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <button id="ext-host-open" class="btn-primary" style="padding:7px 14px;border-radius:7px;cursor:pointer;font-family:inherit;font-size:12px">Open Claude panel</button>
          <button id="ext-host-folder" style="padding:7px 14px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-family:inherit;font-size:12px">Show files</button>
          <button id="ext-host-remove" style="padding:7px 14px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-family:inherit;font-size:12px">Remove</button>
        </div>
        <div id="ext-host-msg" style="margin-top:8px;font-size:11px;min-height:14px;color:var(--text-muted)"></div>
      `;
      document.getElementById('ext-host-open')?.addEventListener('click', () => ExtHostPanel.open());
      document.getElementById('ext-host-folder')?.addEventListener('click', () => window.vex.extHost.openFolder());
      document.getElementById('ext-host-remove')?.addEventListener('click', async () => {
        const yes = await vexConfirm({
          title: 'Remove Claude for Chrome?',
          message: 'Vex will unload the extension and delete its patched copy. Your Chrome install is not affected.',
          okLabel: 'Remove', danger: true,
        });
        if (!yes) return;
        await window.vex.extHost.uninstall();
        window.showToast?.('Claude for Chrome removed — restart Vex to fully unload it');
        this.render();
      });
      return;
    }

    // Not installed — offer whatever we can find in the Chrome profile.
    let found = [];
    try { found = await window.vex.extHost.findChromeCopies(); } catch {}
    const claudeFirst = found
      .filter(e => /claude/i.test(e.name) || e.id === 'fcoeoabgfenejglbffodgkkbkcdhcgfn')
      .sort((a, b) => String(b.version).localeCompare(String(a.version), undefined, { numeric: true }));

    box.innerHTML = `
      ${claudeFirst.length ? `
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">Found in your Chrome profile:</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${claudeFirst.map((e, i) => `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:8px">
              <div style="min-width:0">
                <div style="font-size:12px;font-weight:600">${AIPanel._esc(e.name)} <span style="color:var(--text-muted);font-weight:400">${AIPanel._esc(e.version)}</span></div>
                <div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${AIPanel._esc(e.dir)}</div>
              </div>
              <button class="ext-host-install btn-primary" data-dir="${AIPanel._esc(e.dir)}" data-i="${i}"
                style="padding:6px 12px;border-radius:7px;cursor:pointer;font-family:inherit;font-size:12px;white-space:nowrap">Install</button>
            </div>`).join('')}
        </div>` : `
        <div style="font-size:12px;color:var(--text-muted)">
          No Claude extension found in your Chrome profile. Install it in Chrome first, or pick an unpacked folder below.
        </div>`}
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button id="ext-host-pick" style="padding:7px 14px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-family:inherit;font-size:12px">Choose folder&hellip;</button>
      </div>
      <div id="ext-host-msg" style="margin-top:8px;font-size:11px;min-height:14px;color:var(--text-muted)"></div>
    `;

    box.querySelectorAll('.ext-host-install').forEach(btn => {
      btn.addEventListener('click', () => this._install(() => window.vex.extHost.installPath(btn.dataset.dir)));
    });
    document.getElementById('ext-host-pick')?.addEventListener('click', () => {
      this._install(() => window.vex.extHost.installFolder());
    });
  },

  async _install(fn) {
    if (this._busy) return;
    this._busy = true;
    this._msg('Copying and patching the extension…');
    try {
      const res = await fn();
      if (res?.cancelled) { this._msg(''); return; }
      if (res?.ok) {
        this._msg(`Installed ${res.name} ${res.version} (patched ${res.patched?.length ?? 0} files).`);
        window.showToast?.('Claude for Chrome installed');
        await this.render();
        ExtHostPanel.open();
      } else {
        this._msg(res?.error || 'Install failed.', true);
      }
    } catch (err) {
      this._msg(err.message || 'Install failed.', true);
    } finally {
      this._busy = false;
    }
  },

  _msg(text, isError) {
    const el = document.getElementById('ext-host-msg');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? 'var(--danger)' : 'var(--text-muted)';
  },
};
