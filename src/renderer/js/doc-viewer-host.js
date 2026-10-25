// === Vex's own viewer for text-like documents: the switch and its Settings section ===============
//
// A JSON, XML, CSV, Markdown, log or source document a tab meets, and a view-source: page, is shown by a page of Vex's own
// (src/renderer/doc-viewer, served by src/main/text-viewer.js) instead of as one block of plain text: JSON and XML as a collapsible tree
// with search, CSV as a sortable and filterable table, Markdown rendered with a table of contents, and anything else as numbered,
// searchable, coloured lines. It reads the document through the tab's own session, and nothing leaves the computer.
//
// This file is only what the window itself owns: the on/off switch (told to main, which is what catches a web document), the Settings
// section, and the Ctrl+K command. The window's own part of the work, keeping the document's address in the address bar and sending the
// viewer the theme, is in js/webview.js.
//
//   vex.docViewer.prefs = { enabled }       on unless it was switched off
const VexDocViewer = {
  PREF: 'vex.docViewer.prefs',
  FEATURE: 'doc-viewer',

  enabled() {
    try { const raw = JSON.parse(localStorage.getItem(this.PREF) || 'null'); return !raw || raw.enabled !== false; }
    catch (err) { console.error('[DocViewer]', err.message); return true; }
  },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, JSON.stringify({ enabled: !!on })); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message, { cause: err }); }
    this.apply();
    return !!on;
  },

  // Main is what catches a web document, and the window is what sends a file or a view-source: address to the viewer: both are told.
  apply() {
    const on = this.enabled();
    window.VexDocViewerOff = !on;
    if (window.vex && typeof window.vex.docviewSetEnabled === 'function') {
      window.vex.docviewSetEnabled(on).catch((err) => console.error('[DocViewer] main could not be told:', err && err.message));
    }
  },

  group(el) {
    const G = VexSettingsGroups;
    el.appendChild(G.note('JSON, XML, CSV, Markdown, log and source files open in Vex\'s own viewer: a tree you can search and fold, a table you can sort and filter, a rendered page with its contents, or numbered lines with colours, wrapping and a search. It reads the document through the tab it is in, so a document behind a sign-in works and a private tab\'s document stays in that tab. Nothing is sent anywhere. Pages that are not documents, and what a page loads for itself, are never touched.'));
    const row = document.createElement('label');
    row.className = 'vexsr-rule';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.enabled();
    box.addEventListener('change', () => {
      try { this.setEnabled(box.checked); window.showToast?.(box.checked ? 'Text documents open in Vex\'s own viewer' : 'Text documents open in the browser\'s own view again', 'info'); }
      catch (err) { box.checked = !box.checked; window.showToast?.(err.message, 'error'); }
    });
    row.append(box, document.createTextNode(' Show text documents in Vex\'s own viewer'));
    el.appendChild(row);
    el.appendChild(G.note('Switched off, they open as plain text as before. The viewer\'s "Open raw" button shows a single document the browser\'s own way.'));
    el.appendChild(G.button('Forget the view settings', async () => {
      try {
        if (!window.vex || typeof window.vex.docviewForgetSettings !== 'function') throw new Error('This window cannot do that');
        const r = await window.vex.docviewForgetSettings();
        if (!r || !r.ok) throw new Error((r && r.error) || 'It did not work');
        window.showToast?.('Vex forgot the viewer\'s view settings', 'success');
      } catch (err) { window.showToast?.(err.message, 'error'); }
    }));
    el.appendChild(G.note('Vex remembers, per kind of document, whether you wrapped the lines, showed line numbers, kept the first column in view, and similar choices. They stay on this computer, are not synced, and are never kept for a private or Tor tab.'));
  },
};

if (typeof window !== 'undefined') {
  window.VexDocViewer = VexDocViewer;
  VexDocViewer.apply();
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'doc-viewer', title: 'Document viewer', keywords: 'document viewer json xml csv tsv markdown log source view-source tree table text lines wrap', before: 'about', build: (el) => VexDocViewer.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({
      id: 'doc-viewer-settings', label: 'Document viewer', hint: 'Settings for the viewer that opens your text documents', icon: 'file',
      action: () => { if (typeof SettingsUI !== 'undefined' && typeof SettingsUI.openSection === 'function') SettingsUI.openSection('vex-sg-doc-viewer'); },
    });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDocViewer };
