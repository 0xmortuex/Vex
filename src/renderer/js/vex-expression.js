// === Expression and fun: the hub ===========================================
//
// Small optional things that make Vex a little more yours: a jingle, a line
// for the day, a pick from the reading queue, a stopwatch, a key trainer, and
// the frames and titles on the profile page. They are all OFF until turned on,
// silent while a game is running, and never count, nag or penalise.
//
// This file is the shared bit and has no feature of its own:
//   VexExpression.register({ id, title, icon, renderSettings(container),
//                            commands: [{ id, label, hint, icon, action }],
//                            brief: { id, title, build(), isEnabled() } })
//   VexExpression.gaming()           true while Game mode / a game session runs
//   VexExpression.signal(medalId)    the no-import medal contract
//   VexExpression.briefModules()     the modules to hand the Morning Brief
//   VexExpression.mountSettings()    one Settings group, built at runtime so
//                                    index.html only needs the script tags
//
// Mount hooks for the pages that are not edited from here (today.js, the
// profile page): `VexExpression.briefModules()` answers
// [{ id, title, build(), isEnabled() }] in the brief-extras shape, and
// `VexCosmetics` / `VexTitles` are the profile page's API.
const VexExpression = {
  modules: [],
  SETTINGS_ID: 'settings-expression',

  gaming() {
    try { if (typeof GameSession !== 'undefined' && GameSession && GameSession.active) return true; } catch { /* not loaded */ }
    try { if (typeof GameMode !== 'undefined' && GameMode && GameMode.gaming) return true; } catch { /* not loaded */ }
    // The ONE global quiet switch (Settings > Play) silences these too.
    try { if (localStorage.getItem('vex.fun.quiet') === '1') return true; } catch { /* storage blocked */ }
    return false;
  },

  reducedMotion() {
    try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch { return false; }
  },

  // Medal ids that are not defined are ignored by VexMedals, so a signal is
  // always safe to send.
  signal(id) {
    try { document.dispatchEvent(new CustomEvent('vex:medal-signal', { detail: { id } })); }
    catch { /* no document */ }
  },

  // Everything stored by these modules is a small JSON value under one key.
  read(key, fallback) {
    let raw;
    try { raw = localStorage.getItem(key); }
    catch (err) { throw new Error('Could not read ' + key + ': ' + err.message, { cause: err }); }
    if (raw == null) return fallback;
    try { return JSON.parse(raw); }
    catch (err) { throw new Error('The saved value ' + key + ' is not valid: ' + err.message, { cause: err }); }
  },
  write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (err) { throw new Error('Could not save ' + key + ': ' + err.message, { cause: err }); }
  },

  esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },

  icon(name, size) {
    if (typeof VexIcons === 'undefined' || !VexIcons.has || !VexIcons.has(name)) return '';
    return VexIcons.svg(name, { size: size || 14 });
  },

  toast(text, kind) {
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') window.showToast(text, kind);
  },

  // A switch row for a module's settings.
  toggleRow(label, hint, checked, onChange) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="setting-toggle-row"><span>${this.esc(label)}</span><label class="toggle"><input type="checkbox" aria-label="${this.esc(label)}"${checked ? ' checked' : ''}><span class="toggle-slider"></span></label></div>`
      + (hint ? `<p class="setting-info muted" style="margin:2px 0 10px">${this.esc(hint)}</p>` : '');
    const input = wrap.querySelector('input');
    input.addEventListener('change', () => {
      try { onChange(input.checked); }
      catch (err) { input.checked = !input.checked; this.toast(err.message, 'error'); }
    });
    return wrap;
  },

  register(mod) {
    if (!mod || typeof mod.id !== 'string') throw new Error('An expression module needs an id');
    if (this.modules.some(m => m.id === mod.id)) return false;
    this.modules.push(mod);
    if (Array.isArray(mod.commands) && typeof CommandBar !== 'undefined' && Array.isArray(CommandBar.commands)) {
      for (const c of mod.commands) {
        if (!CommandBar.commands.some(x => x.id === c.id)) CommandBar.commands.push(c);
      }
    }
    return true;
  },

  briefModules() {
    return this.modules.filter(m => m.brief && typeof m.brief.build === 'function').map(m => m.brief);
  },

  // One group for all of them, appended to the Settings page. Safe to call
  // twice. If the Settings layout (category chips) was already built, it is
  // built again so the new group is in the menu.
  mountSettings() {
    if (typeof document === 'undefined') return null;
    const root = document.querySelector('#panel-settings .settings-content');
    if (!root) return null;
    let group = document.getElementById(this.SETTINGS_ID);
    if (!group) {
      group = document.createElement('div');
      group.className = 'setting-group';
      group.id = this.SETTINGS_ID;
      group.innerHTML = '<label class="setting-label">Fun and expression</label>'
        + '<p class="setting-info muted" style="margin:0 0 10px">Small extras. Every one is off until you turn it on, and none of them counts, scores or nags.</p>';
      root.appendChild(group);
      for (const m of this.modules) {
        if (typeof m.renderSettings !== 'function') continue;
        const sec = document.createElement('div');
        sec.className = 'vex-expr-section';
        sec.dataset.exprModule = m.id;
        sec.style.cssText = 'border-top:1px solid var(--border);padding-top:10px;margin-top:10px';
        sec.innerHTML = `<div style="font-weight:650;margin-bottom:6px">${this.icon(m.icon, 14)} ${this.esc(m.title || m.id)}</div>`;
        const body = document.createElement('div');
        sec.appendChild(body);
        group.appendChild(sec);
        try { m.renderSettings(body); }
        catch (err) {
          body.textContent = 'This section could not be drawn: ' + ((err && err.message) || err);
          console.error('[VexExpression] settings for', m.id, err);
        }
      }
      if (document.querySelector('#panel-settings .set-toolbar') && typeof SettingsUI !== 'undefined' && SettingsUI.enhance) {
        try { SettingsUI.enhance(); } catch (err) { console.error('[VexExpression] Settings layout', err); }
      }
    }
    return group;
  },

  // A small centred dialog the modules share (their own overlay, closed with
  // Escape or the button). Returns { el, body, close }.
  dialog(title, opts) {
    const o = opts || {};
    const back = document.createElement('div');
    back.className = 'vex-expr-backdrop';
    back.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)';
    back.innerHTML = `<div class="vex-expr-dialog" role="dialog" aria-modal="true" aria-label="${this.esc(title)}" style="background:var(--bg-elevated, var(--bg));color:var(--text);border:1px solid var(--border);border-radius:12px;padding:18px 20px;width:min(460px,92vw);box-shadow:0 18px 50px var(--vex-shadow-color, rgba(0,0,0,.5))"><div style="font-size:15px;font-weight:650;margin-bottom:10px">${this.esc(title)}</div><div class="vex-expr-body"></div></div>`;
    document.body.appendChild(back);
    const body = back.querySelector('.vex-expr-body');
    const prev = document.activeElement;
    const close = () => {
      document.removeEventListener('keydown', onKey, true);
      back.remove();
      if (o.onClose) o.onClose();
      try { if (prev && prev.focus) prev.focus(); } catch { /* gone */ }
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && !o.noEscape) { e.preventDefault(); e.stopPropagation(); close(); }
    };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('mousedown', (e) => { if (e.target === back && !o.noBackdropClose) close(); });
    return { el: back, body, close };
  },
};

if (typeof window !== 'undefined') window.VexExpression = VexExpression;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexExpression };
