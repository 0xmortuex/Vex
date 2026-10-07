// === Install from the Chrome Web Store =====================================
// One flow for every way in: the "Add to Vex" button in the address bar on a
// store extension page, the field in Settings › Extensions, "Update from Web
// Store" on an installed extension, and the command bar.
//
//   1. main downloads the package from Google's update server and checks its
//      signatures (src/main/webstore.js) — nothing is written yet;
//   2. the person sees what it can read and do, and what will not work here;
//   3. only then main installs that same verified package.
//
// Nothing is injected into Google's page: the button is Vex's own.
const VexWebStore = (() => {
  const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
  const icon = (name, size = 14) => (typeof VexIcons !== 'undefined' ? VexIcons.svg(name, { size }) : '');
  const toast = (m, k) => { if (typeof window.showToast === 'function') window.showToast(m, k); };
  let busy = false;

  function _activeTab() {
    if (typeof TabManager === 'undefined') return null;
    return TabManager.getActiveTab() || null;
  }
  function _urlOf(tab) {
    if (!tab) return '';
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(tab.id) : null;
    try { return (wv && typeof wv.getURL === 'function' && wv.getURL()) || tab.url || ''; }
    catch { return tab.url || ''; }
  }

  // Why installing is refused from here, or null. Extensions never load in a
  // private window or a temporary session (Tor, Off-the-Record, burner), and
  // the download would go out over Vex's normal connection, not that tab's.
  function refusedHere(tab) {
    if (window.VexTabPolicy?.isPrivateWindow) return 'Extensions cannot be installed from a private window: they never run there. Use a normal Vex window.';
    if (tab && tab.partition && !String(tab.partition).startsWith('persist:')) {
      return 'Extensions cannot be installed from a Tor, Off-the-Record or burner tab: the download would not go through that tab\'s protection, and extensions never run there. Use a normal tab.';
    }
    return null;
  }

  // { id, tab } when the tab in front is an extension's page on the store.
  function activeStorePage() {
    const tab = _activeTab();
    if (!tab || typeof window.VexWebStoreLink === 'undefined') return null;
    const id = window.VexWebStoreLink.idFromUrl(_urlOf(tab));
    return id ? { id, tab } : null;
  }

  function _list(items, max) {
    const shown = items.slice(0, max);
    const more = items.length - shown.length;
    return shown.map(esc).join(', ') + (more > 0 ? ` and ${more} more` : '');
  }

  // Where the package came from, first in the dialog. p.source is set by main
  // for a picked file or folder (main.js _previewPickedFile); a store link has none.
  function sourceLine(p) {
    const v = esc(p.version || '?');
    const file = p.file ? ` (${esc(p.file)})` : '';
    switch (p.source) {
      case 'webstore-file':
        return [false, `Version ${v}, a Chrome Web Store package from a file${file}. Its signatures, the developer's and the store's, check out.`];
      case 'developer':
        return [true, `Version ${v}: <strong>not from the Chrome Web Store</strong>. A package its developer signed themselves${file}, id ${esc(p.id || '?')}. The signature checks out, so it has not been changed since it was signed, but no store has looked at it.`];
      case 'zip':
        return [true, `Version ${v} from a .zip file${file}: <strong>not from the Chrome Web Store</strong>, and not signed, so Vex cannot tell who made it.`];
      case 'folder':
        return [true, `Version ${v} from a folder on this computer${file}: <strong>not from the Chrome Web Store</strong>, and not signed, so Vex cannot tell who made it.`];
      default:
        return [false, `Version ${v} from the Chrome Web Store. Its signatures, the developer's and the store's, check out.`];
    }
  }

  // The permissions dialog's body. Every piece of text is escaped here.
  function dialogHtml(p) {
    const lines = [];
    const [unchecked, says] = sourceLine(p);
    lines.push(`<div class="vex-ws-source${unchecked ? ' vex-ws-heavy' : ''}">${icon(unchecked ? 'warning' : 'shield', 14)}<span>${says}</span></div>`);
    if (p.installed) {
      lines.push(`<div class="vex-ws-line">${icon('refresh', 14)}<span>Installed now: version ${esc(p.installed.version || '?')}. It is updated in place, and keeps its settings.</span></div>`);
    }
    if (p.safeMode) lines.push(`<div class="vex-ws-line">${icon('info', 14)}<span>Vex is in safe mode: it loads when Vex next starts normally.</span></div>`);

    lines.push('<div class="vex-ws-head">What it can do</div>');
    const reachTone = p.reach && p.reach.level === 'all' ? ' vex-ws-heavy' : '';
    lines.push(`<div class="vex-ws-line${reachTone}">${icon(p.reach && p.reach.level === 'all' ? 'warning' : 'eye', 14)}<span>${esc(p.reach ? p.reach.says : 'Cannot read the pages you open')}</span></div>`);
    for (const power of (p.powers || [])) {
      lines.push(`<div class="vex-ws-line${power.heavy ? ' vex-ws-heavy' : ''}">${icon(power.heavy ? 'warning' : 'check', 14)}<span>${esc(power.says)}</span></div>`);
    }
    const perms = (p.permissions || []);
    const optional = (p.optionalPermissions || []).filter(x => !perms.includes(x));
    if (perms.length || optional.length) {
      lines.push(`<div class="vex-ws-perms">Permissions: ${perms.map(x => `<code>${esc(x)}</code>`).join(' ')}${optional.length ? ` <span class="vex-ws-dim">may ask later for</span> ${optional.map(x => `<code>${esc(x)}</code>`).join(' ')}` : ''}</div>`);
    }
    if ((p.hostPermissions || []).length) {
      lines.push(`<div class="vex-ws-perms">Sites: ${_list(p.hostPermissions, 6)}</div>`);
    }

    lines.push('<div class="vex-ws-head">What may not work in Vex</div>');
    for (const c of (p.cautions || [])) lines.push(`<div class="vex-ws-line vex-ws-caution">${icon('warning', 14)}<span>${esc(c)}</span></div>`);
    lines.push(`<div class="vex-ws-line vex-ws-dim">${icon('incognito', 14)}<span>It never runs in Private, Off-the-Record or Tor tabs.</span></div>`);
    return lines.join('');
  }

  function _doneText(r) {
    const what = r.updated ? (r.previousVersion && r.previousVersion !== r.version ? `Updated ${r.name} from v${r.previousVersion} to v${r.version}` : `Reinstalled ${r.name} v${r.version}`) : `Installed ${r.name} v${r.version}`;
    if (r.afterRestart) return what + ' — it loads when Vex restarts normally';
    return what + (r.disabled ? ' — still switched off' : '');
  }

  // input: a store link or an extension id. opts.tab: the tab it came from,
  // when it came from one. Resolves to main's answer ({ ok, … }), or
  // { ok: false, cancelled: true } when the person said no.
  async function install(input, opts = {}) {
    const why = refusedHere(opts.tab || null);
    if (why) { toast(why, 'error'); return { ok: false, error: why }; }
    if (!window.vex || typeof window.vex.extensionsWebStorePreview !== 'function') {
      toast('Installing extensions is not available in this window', 'error');
      return { ok: false, error: 'not available' };
    }
    if (busy) { toast('Vex is already installing an extension. One at a time.', 'info'); return { ok: false, error: 'busy' }; }
    busy = true;
    try {
      const fetching = 'Downloading from the Chrome Web Store and checking its signature…';
      toast(fetching, 'info');
      const p = await window.vex.extensionsWebStorePreview(String(input || ''));
      // Done downloading: that note stayed up beside "Installed …" (walkthrough
      // L8, 2026-10-07). showToast gives no handle, so it goes by its text.
      document.querySelectorAll('#toast-container .toast-item').forEach(t => { if (t.textContent === fetching) t.remove(); });
      if (!p || !p.ok) {
        toast('Could not install: ' + ((p && p.error) || 'no answer from Vex'), 'error');
        return p || { ok: false, error: 'no answer' };
      }
      if (p.refuse) {
        await vexAlert({ title: `Vex cannot install ${p.name}`, message: p.refuse });
        return { ok: false, error: p.refuse };
      }
      const yes = await vexConfirm({
        title: `${p.installed ? 'Update' : 'Add'} "${p.name}"?`,
        html: dialogHtml(p),
        okLabel: p.installed ? 'Update' : 'Add to Vex',
      });
      if (!yes) return { ok: false, cancelled: true };
      const r = await window.vex.extensionsInstallWebStore(p.id);
      if (r && r.ok) {
        toast(_doneText(r), 'success');
        window.dispatchEvent(new CustomEvent('vex-extensions-changed', { detail: { folder: r.folder, webstore: r.webstore } }));
        return r;
      }
      toast('Install failed: ' + ((r && r.error) || 'unknown'), 'error');
      return r || { ok: false, error: 'no answer' };
    } catch (err) {
      toast('Install failed: ' + ((err && err.message) || err), 'error');
      return { ok: false, error: (err && err.message) || String(err) };
    } finally {
      busy = false;
    }
  }

  function installActive() {
    const page = activeStorePage();
    if (!page) { toast('Open an extension\'s page on chromewebstore.google.com first', 'info'); return Promise.resolve({ ok: false, error: 'not a store page' }); }
    return install(page.id, { tab: page.tab });
  }

  // The "Add to Vex" button in the address bar: shown only on a store
  // extension page, in a tab where extensions can be installed.
  function _mark() {
    const btn = document.getElementById('btn-webstore-add');
    if (!btn) return;
    const page = activeStorePage();
    btn.hidden = !page || !!refusedHere(page.tab);
  }

  function init() {
    const btn = document.getElementById('btn-webstore-add');
    if (!btn) return;
    if (!btn.firstChild) btn.innerHTML = `${icon('puzzle', 13)}<span>Add to Vex</span>`;
    btn.addEventListener('click', () => { installActive(); });
    document.addEventListener('vex:tab-navigated', _mark);
    window.addEventListener('vex-tabs-changed', _mark);
    _mark();
  }

  return { install, installActive, activeStorePage, refusedHere, dialogHtml, init, _mark };
})();

window.VexWebStore = VexWebStore;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => VexWebStore.init());
else VexWebStore.init();
if (typeof module !== 'undefined' && module.exports) module.exports = { VexWebStore };
