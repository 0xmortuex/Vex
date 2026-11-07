// === Keep Vex's cache under a size: the Settings section and its Ctrl+K command ==========================
//
// The work is in the main process (src/main/cache-budget.js). Off by default. It clears only each site's
// HTTP cache and Code Cache (compiled scripts), largest first, never logins, cookies, saved data or offline
// storage. This file shows the size of each site, what would be cleared, and the button.
//
// Loaded late (lazy-boot.js LATE_MODULES); it starts itself when it loads.
const VexCacheBudgetUI = {
  ID: 'cache-budget',
  TITLE: 'Storage: Vex cache size',
  LIMITS: [1, 2, 3, 5, 10, 20],

  _api() {
    const v = window.vex && window.vex.cacheBudget;
    if (!v) throw new Error('The cache size setting is not available in this window');
    return v;
  },
  _msg(err) { return String((err && err.message) || err).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''); },

  // Bytes as a short figure. The unit is joined on, not written as a sentence, so it needs no translation.
  sizeText(bytes) {
    const n = Number(bytes) || 0;
    if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
    if (n >= 1048576) return Math.round(n / 1048576) + ' MB';
    return Math.max(n ? 1 : 0, Math.round(n / 1024)) + ' KB';
  },

  // The rows of the per-site list: biggest disposable cache first, sites with nothing to clear last.
  rowsFor(status) {
    const parts = Array.isArray(status && status.parts) ? status.parts : [];
    return parts
      .map(p => ({ label: p.label, clearable: (p.cache || 0) + (p.code || 0), offline: p.cacheStorage || 0, partial: !!p.partial }))
      .sort((a, b) => b.clearable - a.clearable || (a.label < b.label ? -1 : 1));
  },

  openSettings() {
    if (typeof SettingsUI === 'undefined' || typeof SettingsUI.openSection !== 'function') throw new Error('Settings is not ready yet');
    SettingsUI.openSection('setting-cache-budget');
  },

  render(body) {
    const PS = window.ProtectSettings;
    if (!PS) throw new Error('Settings helpers are not loaded');
    const api = this._api();
    body.textContent = '';
    const note = (text) => {
      const d = document.createElement('div');
      d.style.cssText = 'font-size:12px;color:var(--text-muted);margin:2px 0 8px';
      d.textContent = text;
      return d;
    };
    const intro = note('Vex can keep the part of its cache that is safe to throw away under a size you choose. It clears only each site’s saved copies of pictures and scripts (the HTTP cache and the compiled-script cache). It never touches logins, cookies, saved data or offline storage.');
    const honest = note('Caches build up again by themselves, so the first load of a site after a clean-up is slower. Offline storage of sites (CacheStorage) is shown but never cleared: Vex cannot show that clearing it is safe for your sign-ins.');
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    status.style.cssText = 'font-size:12px;margin:6px 0';
    const list = document.createElement('div');
    const preview = document.createElement('div');
    const fail = (err) => { status.textContent = this._msg(err); window.showToast?.(this._msg(err), 'error'); };

    const limitRow = document.createElement('label');
    limitRow.style.cssText = 'display:flex;gap:8px;align-items:center;font-size:12.5px;margin:6px 0';
    const limitText = document.createElement('span');
    limitText.textContent = 'Keep the cache under';
    const select = document.createElement('select');
    select.className = 'set-input';
    for (const n of this.LIMITS) { const o = document.createElement('option'); o.value = String(n); o.textContent = String(n) + ' GB'; select.append(o); }
    limitRow.append(limitText, select);

    let box;
    const draw = (s) => {
      box.checked = !!s.enabled;
      if (![...select.options].some(o => Number(o.value) === s.limitGB)) { const o = document.createElement('option'); o.value = String(s.limitGB); o.textContent = String(s.limitGB) + ' GB'; select.append(o); }
      select.value = String(s.limitGB);
      list.textContent = '';
      const head = document.createElement('div');
      head.style.cssText = 'font-weight:600;font-size:12.5px;margin:10px 0 4px';
      head.textContent = 'Where the space goes';
      list.append(head);
      for (const r of this.rowsFor(s)) {
        const line = document.createElement('div');
        line.style.cssText = 'display:flex;gap:8px;font-size:12.5px;margin:3px 0;flex-wrap:wrap';
        const name = document.createElement('span'); name.style.cssText = 'min-width:140px'; name.textContent = r.label;
        const size = document.createElement('span'); size.textContent = this.sizeText(r.clearable) + (r.partial ? '+' : '');
        line.append(name, size);
        if (r.offline) {
          const off = document.createElement('span'); off.style.color = 'var(--text-muted)';
          const offLabel = document.createElement('span'); offLabel.textContent = 'Offline storage (not cleared)';
          const offSize = document.createElement('span'); offSize.textContent = ': ' + this.sizeText(r.offline);
          off.append(offLabel, offSize);
          line.append(off);
        }
        list.append(line);
      }
      if (s.partial) list.append(note('Measuring stopped early to stay quick, so some figures are at least this much.'));
      preview.textContent = '';
      const ph = document.createElement('div'); ph.style.cssText = 'font-weight:600;font-size:12.5px;margin:10px 0 4px'; ph.textContent = 'What would be cleared now';
      preview.append(ph);
      if (!s.items || !s.items.length) preview.append(note('Nothing: the cache is under the size you chose.'));
      for (const i of s.items || []) {
        const line = document.createElement('div'); line.style.cssText = 'font-size:12.5px;margin:3px 0';
        line.textContent = i.label + ': ' + this.sizeText(i.bytes);
        preview.append(line);
      }
      for (const k of s.skipped || []) {
        const line = document.createElement('div'); line.style.cssText = 'font-size:12.5px;margin:3px 0;color:var(--text-muted)';
        const who = document.createElement('span'); who.textContent = k.label + ': ';
        const why = document.createElement('span'); why.textContent = k.reason;
        line.append(who, why);
        preview.append(line);
      }
      const last = s.last;
      status.textContent = '';
      if (last) {
        const a = document.createElement('span'); a.textContent = 'Last clean-up:';
        const b = document.createElement('span'); b.textContent = ' ' + new Date(last.at).toLocaleString() + '. ';
        const c = document.createElement('span'); c.textContent = 'Space freed:';
        const d = document.createElement('span'); d.textContent = ' ' + this.sizeText(last.freed);
        status.append(a, b, c, d);
        for (const e of last.errors || []) status.append(document.createElement('br'), document.createTextNode(e.id + ': ' + e.message));
      } else status.textContent = s.enabled ? 'On. The first clean-up happens when the computer is idle.' : 'Off. Nothing is cleared.';
    };
    const refresh = async () => { try { draw(await api.status()); } catch (err) { fail(err); } };

    const toggle = PS.toggle({
      text: 'Keep Vex’s cache under this size', hint: 'Checked about once a day, only when the computer has been idle for 10 minutes, no game is running and it is not quiet hours. A site with a tab open is skipped.', checked: false,
      onChange: async (on) => { try { await api.set({ enabled: on }); await refresh(); } catch (err) { fail(err); await refresh(); } },
    });
    box = toggle.querySelector('input');
    select.addEventListener('change', async () => { try { await api.set({ limitGB: Number(select.value) }); await refresh(); } catch (err) { fail(err); await refresh(); } });
    const again = PS.button('Measure again', refresh, { icon: 'refresh' });
    const clearNow = PS.button('Clear now', async () => {
      status.textContent = 'Clearing…';
      try {
        const r = await api.run();
        await refresh();
        window.showToast?.(r.freed > 0 ? 'Cache cleared' : 'Nothing needed clearing');
      } catch (err) { fail(err); }
    }, { icon: 'trash' });

    body.append(intro, honest, toggle, limitRow, again, clearNow, status, preview, list);
    status.textContent = 'Measuring…';
    refresh();
    return body;
  },

  _commands() {
    const fail = (err) => window.showToast?.(this._msg(err), 'error');
    return [
      { id: 'cachebudget:settings', label: 'Keep Vex’s Cache Under a Size', hint: 'Shows how much space each site’s cache uses and what would be cleared', icon: 'trash', action: () => { try { this.openSettings(); } catch (err) { fail(err); } } },
    ];
  },

  init() {
    if (this._started) return false;
    this._started = true;
    if (!window.VexSettingsGroups) throw new Error('VexSettingsGroups is not loaded');
    VexSettingsGroups.register({
      id: this.ID, title: this.TITLE, before: 'about',
      keywords: 'cache size storage disk space clear code cache http cache discord whatsapp keep under gb housekeeping',
      render: (body) => this.render(body),
    });
    if (window.VexModuleCommands) VexModuleCommands.set('cachebudget:', this._commands());
    return true;
  },
};

if (typeof window !== 'undefined') { window.VexCacheBudgetUI = VexCacheBudgetUI; VexCacheBudgetUI.init(); }
if (typeof module !== 'undefined' && module.exports) module.exports = { VexCacheBudgetUI };
