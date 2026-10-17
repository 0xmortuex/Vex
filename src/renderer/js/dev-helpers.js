// === Developer helpers: the right-click rows and the one Settings section =====
//
// Seven small helpers for working on code, each its own file and each switchable:
//   js/repo-registry.js        your repositories and their tab groups
//   js/search-bangs.js         !npm zod, !mdn fetch, !steam game ... in the address bar and Ctrl+K
//   js/copy-as-request.js      copy a link as cURL / fetch / PowerShell, or open it in the API playground
//   js/github-helpers.js       permalink, branch name, commit message on github.com
//   js/snippet-translator.js   npm <-> pnpm, pip <-> uv, bash <-> PowerShell (text only, with a danger lint)
//   js/selection-decoder.js    base64, JWT, hex, Unix time, escapes, errno, NTSTATUS, EFI_STATUS, HTTP, signals and cron decoded locally
//   js/reference-sets.js       doc pages and snippets pinned to a project
//
// This file only gathers their right-click rows for the page menu (js/webview.js asks it
// three times: for a selection, a link and a github.com page) and draws their one
// Settings section, "Developer helpers". Every helper registers with VexUsage
// (js/vex-usage-registry.js) so Minimal Vex can switch it off and put it back.
//
// Load order: after the seven files above, before js/vex-usage-registry.js.
const VexDevHelpers = {
  // Rows for selected text.
  textItems(selection, webview, { editable = false } = {}) {
    const items = [];
    const sel = String(selection == null ? '' : selection);
    if (!sel.trim()) return items;
    const safe = (fn) => () => { Promise.resolve().then(fn).catch((e) => window.showToast?.((e && e.message) || 'That did not work', 'error')); };
    if (typeof VexDecode !== 'undefined' && VexDecode.looksDecodable(sel)) {
      items.push({ label: 'Decode selection', action: safe(() => VexDecode.open(sel)) });
    }
    if (typeof VexShellTranslate !== 'undefined' && VexShellTranslate.enabled() && VexShellTranslate.looksLikeCommand(sel)) {
      items.push({ label: 'Translate command...', action: safe(() => VexShellTranslate.open(sel)) });
    }
    if (!editable && typeof VexGithubHelpers !== 'undefined') items.push(...VexGithubHelpers.issueItem(sel, webview));
    return items;
  },

  // Rows for a link.
  linkItems(url) {
    const items = [];
    if (typeof VexCopyAs === 'undefined' || !VexCopyAs.enabled() || !/^https?:\/\//i.test(String(url || ''))) return items;
    const safe = (fn) => () => { Promise.resolve().then(fn).catch((e) => window.showToast?.((e && e.message) || 'That did not work', 'error')); };
    items.push({ label: 'Copy Link as cURL, fetch or PowerShell...', action: safe(() => VexCopyAs.open({ url })) });
    if (typeof ApiPlayground !== 'undefined') items.push({ label: 'Open Link in API Playground', action: safe(() => VexCopyAs.toPlayground({ method: 'GET', url })) });
    return items;
  },

  // Rows for a github.com page (the Page submenu).
  pageItems(webview) {
    return typeof VexGithubHelpers !== 'undefined' ? VexGithubHelpers.pageItems(webview) : [];
  },

  // The helpers and what each is called in Settings, in order.
  HELPERS() {
    return [
      typeof VexRepos !== 'undefined' ? VexRepos : null,
      typeof VexBangs !== 'undefined' ? VexBangs : null,
      typeof VexCopyAs !== 'undefined' ? VexCopyAs : null,
      typeof VexGithubHelpers !== 'undefined' ? VexGithubHelpers : null,
      typeof VexShellTranslate !== 'undefined' ? VexShellTranslate : null,
      typeof VexDecode !== 'undefined' ? VexDecode : null,
      typeof VexReferenceSets !== 'undefined' ? VexReferenceSets : null,
    ].filter(Boolean);
  },
  renderSettings(body) {
    const note = document.createElement('p');
    note.className = 'setting-info muted';
    note.textContent = 'Small helpers for working on code. Each can be switched off here. None sends anything anywhere, and none runs a command.';
    body.appendChild(note);
    for (const h of this.HELPERS()) {
      const box = document.createElement('div');
      box.style.cssText = 'border-top:1px solid var(--border);padding-top:8px;margin-top:8px';
      try { h.settingsRows(box); }
      catch (err) {
        console.error('[DevHelpers] a helper could not draw its settings:', err);
        box.textContent = 'This helper could not be shown: ' + ((err && err.message) || err);
      }
      body.appendChild(box);
    }
  },
};

if (typeof window !== 'undefined') {
  window.VexDevHelpers = VexDevHelpers;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'dev-helpers',
      title: 'Developer helpers',
      keywords: 'developer repo repository github bang search npm mdn curl fetch powershell playground permalink branch commit translate pnpm uv decode base64 jwt hex reference doc set',
      before: 'about',
      render: (body) => VexDevHelpers.renderSettings(body),
    });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDevHelpers };
