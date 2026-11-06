// === Safe Download Assistant: what the person sees ==========================
//
// When a download finishes, the main process (src/main/safe-download.js) has already looked at the file on this computer and
// sent a verdict with it: green (no warning signs), amber (be careful), red (do not open) or gray (could not be checked), with
// the concrete reasons in English and Turkish. This file draws that verdict and does what is asked of it:
//
//   - a mark on the download row and in the finished-download card, with a "Why?" fold that lists the reasons
//   - for amber and red, "Open" becomes "Open anyway..." and a confirm repeats the top reason before anything opens
//   - Quarantine for red: the file moves to Vex's own quarantine folder under a harmless name; nothing is deleted
//   - Settings: on or off, how strict, and which checks run
//
// The verdict is never a promise that a file is safe. Green means no warning sign was found; the wording says so.
// No file leaves the computer for any of this. Loaded late (lazy-boot.js); the panel guards its global.
const VexSafeDownload = {
  T(s) { return typeof window !== 'undefined' && typeof window.vexTr === 'function' ? window.vexTr(s) : s; },
  lang() { return typeof VexI18nUI !== 'undefined' && typeof VexI18nUI.locale === 'function' ? VexI18nUI.locale() : 'en'; },
  pick(o) { return o && this.lang() === 'tr' && o.tr ? o.tr : (o && o.en) || ''; },
  esc(s) { return window.escapeHtml ? window.escapeHtml(s) : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },

  // (The panel keeps the verdict bounded and as plain text: downloads-panel.js _cleanSafe. It is always shown escaped.)
  // Whether Open needs the extra confirm.
  warns(dl) { return !!(dl && dl.safe && (dl.safe.level === 'amber' || dl.safe.level === 'red') && !dl.quarantined); },
  openLabel(dl) { return this.warns(dl) ? this.T('Open anyway...') : this.T('Open'); },

  ICON: { green: 'shield', amber: 'warning', red: 'warning', gray: 'info' },
  _icon(level) {
    if (typeof VexIcons === 'undefined') return '';
    return VexIcons.svg(this.ICON[level] || 'shield', { size: 14 });
  },

  // The fold: every reason, worst first, each with a word as well as a colour (colour is never the only signal).
  _reasonsHtml(safe) {
    const word = { red: this.T('Warning'), amber: this.T('Careful'), info: this.T('Note'), ok: this.T('Good') };
    const items = safe.reasons.map(r => `<li class="vex-sd-r vex-sd-r-${r.level}"><b>${this.esc(word[r.level])}:</b> ${this.esc(this.pick(r))}</li>`);
    if (!items.length) items.push(`<li class="vex-sd-r vex-sd-r-ok">${this.esc(this.T('Vex found nothing unusual about this file. That is not a promise that it is safe.'))}</li>`);
    return `<details class="vex-sd-why"><summary>${this.esc(this.T('Why?'))}</summary><ul class="vex-sd-list">${items.join('')}</ul></details>`;
  },
  // The block drawn on a download row and in the finished card.
  blockHtml(dl) {
    const safe = dl && dl.safe;
    if (!safe) return '';
    const head = dl.quarantined ? this.T('In quarantine: Vex will not open it') : this.pick(safe.headline);
    const level = dl.quarantined ? 'gray' : safe.level;
    return `<div class="vex-sd vex-sd-${level}" role="group" aria-label="${this.esc(this.T('Safety check') + ': ' + head)}">`
      + `<span class="vex-sd-head"><span class="vex-sd-ic" aria-hidden="true">${this._icon(level)}</span><span class="vex-sd-word">${this.esc(head)}</span></span>`
      + this._reasonsHtml(safe) + `</div>`;
  },

  // ---- Open anyway... ------------------------------------------------------------------------------------------------------
  // -> Promise<boolean>: whether to go on and open it. Quarantine (red only) is the third button; it closes this as "no".
  async gate(dl) {
    const reason = dl.safe.top ? this.pick(dl.safe.top) : this.pick(dl.safe.headline);
    const red = dl.safe.level === 'red';
    if (typeof window.vexConfirm !== 'function') throw new Error('The confirm box is not available');
    return window.vexConfirm({
      title: this.T(red ? 'Open this file anyway?' : 'Open this file?'),
      message: dl.filename + '\n\n' + reason + '\n\n' + this.T('Vex found a warning sign, not a virus. Open it only if you meant to download it and you trust where it came from.'),
      okLabel: this.T('Open anyway'),
      cancelLabel: this.T('Do not open'),
      danger: red,
      ...(red && dl.safe.canQuarantine && !dl.quarantined && window.DownloadsPanel ? { extra: { label: this.T('Quarantine'), run: () => window.DownloadsPanel._quarantine(dl.id, { confirm: false }) } } : {}),
    });
  },

  // ---- Settings ------------------------------------------------------------------------------------------------------------
  _api() {
    const v = window.vex && window.vex.safeDownload;
    if (!v) throw new Error('The Safe Download Assistant is not available in this window');
    return v;
  },
  _msg(err) { return String((err && err.message) || err).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''); },
  openSettings() {
    if (typeof SettingsUI === 'undefined' || typeof SettingsUI.openSection !== 'function') throw new Error('Settings is not ready yet');
    SettingsUI.openSection('setting-safe-download');
  },
  CHECKS: [
    { key: 'content', text: 'Check the file type against what is really inside', hint: 'A program wearing a .pdf or .jpg name, double endings like invoice.pdf.exe, hidden direction characters, very long names' },
    { key: 'archives', text: 'Look inside zip, rar and 7z files', hint: 'Only the list of names is read, never unpacked: programs inside, password locks, zip bombs, paths that climb out of the folder' },
    { key: 'signature', text: 'Check who signed a program', hint: 'Windows reads the signature of an .exe or .msi without running it' },
    { key: 'source', text: 'Check where the file came from', hint: 'The dangerous-site list, look-alike names, plain http, long redirect chains, downloads you did not click' },
  ],
  render(body) {
    const PS = window.ProtectSettings;
    if (!PS) throw new Error('Settings helpers are not loaded');
    const api = this._api();
    body.textContent = '';
    const T = (s) => this.T(s);
    const fail = (err) => { status.textContent = this._msg(err); window.showToast?.(this._msg(err), 'error'); };
    const note = (text) => { const d = document.createElement('div'); d.style.cssText = 'font-size:12px;color:var(--text-muted);margin:2px 0 8px'; d.textContent = T(text); return d; };
    const status = document.createElement('div'); status.setAttribute('role', 'status'); status.style.cssText = 'font-size:12px;margin:6px 0';
    const boxes = {};
    let onBox, select;
    const draw = (s) => {
      onBox.checked = s.on;
      select.value = s.strictness;
      for (const c of this.CHECKS) { boxes[c.key].checked = s.checks[c.key]; boxes[c.key].disabled = !s.on; }
      select.disabled = !s.on;
      status.textContent = s.on ? T('On. Every finished download gets a green, amber or red mark. Nothing is sent anywhere.') : T('Off. Downloads finish without a safety mark.');
    };
    const save = async (patch) => { try { draw(await api.set(patch)); } catch (err) { fail(err); try { draw(await api.get()); } catch (e2) { console.error('[SafeDownload] settings after a failed save:', e2); } } };

    const on = PS.toggle({ text: T('Check each download when it finishes'), hint: T('Before you open it, in plain words. Everything is checked on this computer; no file or name is sent anywhere.'), checked: true, onChange: (v) => save({ on: v }) });
    onBox = on.querySelector('input');
    const label = document.createElement('label'); label.style.cssText = 'display:flex;gap:8px;align-items:center;font-size:12.5px;margin:8px 0';
    const lt = document.createElement('span'); lt.textContent = T('How strict');
    select = document.createElement('select'); select.setAttribute('aria-label', T('How strict'));
    for (const [v, t] of [['relaxed', 'Relaxed: only clear problems'], ['normal', 'Normal'], ['strict', 'Strict: also warn about mods, programs in archives and unreadable signatures']]) { const o = document.createElement('option'); o.value = v; o.textContent = T(t); select.append(o); }
    select.addEventListener('change', () => save({ strictness: select.value }));
    label.append(lt, select);
    body.append(note('Vex looks at a finished download on this computer and tells you in plain words whether to worry. Green means no warning signs were found, not that the file is safe.'), on, label);
    for (const c of this.CHECKS) {
      const t = PS.toggle({ text: T(c.text), hint: T(c.hint), checked: true, onChange: (v) => save({ checks: { [c.key]: v } }) });
      boxes[c.key] = t.querySelector('input');
      body.append(t);
    }
    body.append(status);
    api.get().then(draw, fail);
    return body;
  },
  _commands() {
    return [{ id: 'safedl:settings', label: 'Safe Download Settings', hint: 'The switch, how strict it is and which checks run for each finished download', icon: 'shield', action: () => { Promise.resolve().then(() => this.openSettings()).catch(err => window.showToast?.(this._msg(err), 'error')); } }];
  },

  _css() {
    if (document.getElementById('vex-sd-css')) return;
    const st = document.createElement('style');
    st.id = 'vex-sd-css';
    st.textContent = `
.vex-sd { margin-top: 4px; font-size: 11.5px; line-height: 1.4; border-left: 3px solid var(--vex-sd-c, var(--text-muted)); padding: 2px 0 2px 8px; color: var(--text); }
.vex-sd-green { --vex-sd-c: var(--success, #16a34a); }
.vex-sd-amber { --vex-sd-c: var(--warning, #d97706); }
.vex-sd-red { --vex-sd-c: var(--danger, #dc2626); }
.vex-sd-gray { --vex-sd-c: var(--text-muted, #6b7280); }
.vex-sd-head { display: inline-flex; align-items: center; gap: 5px; font-weight: 600; }
.vex-sd-ic { display: inline-flex; color: var(--vex-sd-c); }
.vex-sd-why { display: inline-block; margin-left: 8px; }
.vex-sd-why summary { cursor: pointer; color: var(--text-muted); text-decoration: underline; display: inline; }
.vex-sd-why[open] { display: block; margin: 4px 0 0; }
.vex-sd-list { margin: 4px 0 0; padding-left: 16px; }
.vex-sd-r { margin: 2px 0; }
.vex-sd-r-red b { color: var(--danger, #dc2626); }
.vex-sd-why summary:focus-visible { outline: 2px solid var(--vex-accent, currentColor); outline-offset: 2px; }
.download-toast .vex-sd { margin-top: 6px; max-width: 320px; }
@media (prefers-reduced-motion: no-preference) { .vex-sd-why summary { transition: color .15s; } }`;
    // a11y.css stays last in the cascade
    const a11y = document.querySelector('link[href*="a11y.css"]');
    if (a11y && a11y.parentNode) a11y.parentNode.insertBefore(st, a11y); else document.head.appendChild(st);
  },

  init() {
    if (this._started) return false;
    this._started = true;
    this._css();
    if (!window.VexSettingsGroups) throw new Error('VexSettingsGroups is not loaded');
    VexSettingsGroups.register({
      id: 'safe-download', title: 'Safe downloads', before: 'about',
      keywords: 'safe download assistant malware warning exe disguised double extension zip bomb signature signed quarantine open anyway green amber red virus cheat mod',
      render: (body) => this.render(body),
    });
    if (window.VexModuleCommands) VexModuleCommands.set('safedl:', this._commands());
    // Rows drawn before this file arrived get their mark now.
    if (window.DownloadsPanel && typeof window.DownloadsPanel.renderList === 'function' && window.DownloadsPanel.downloads && window.DownloadsPanel.downloads.some(d => d.safe)) {
      try { window.DownloadsPanel.renderList(); } catch (err) { window.VexProblems?.note('Downloads', 'Could not redraw the list with safety marks', err); }
    }
    return true;
  },
};

if (typeof window !== 'undefined') { window.VexSafeDownload = VexSafeDownload; VexSafeDownload.init(); }
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSafeDownload };
