// === Download completion toast ===
// Pops a glassmorphic card in the bottom-right when a download finishes,
// with Open / Show-in-folder / dismiss actions. Multiple toasts stack
// vertically (newest on top via flex-direction: column-reverse on the
// container).
//
// It does NOT go away on its own. A download you have to do something with —
// open it, find it, ignore it — was being taken off the screen after a few
// seconds, which meant looking the other way cost you the file (reported
// 2026-09-20). It stays until you act on it or close it; only the stack is
// capped, so a batch of downloads cannot bury the window.

const DownloadToast = {
  MAX_ON_SCREEN: 5,

  _container() {
    let c = document.getElementById('download-toast-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'download-toast-container';
      document.body.appendChild(c);
    }
    return c;
  },

  // Inline SVG, drawn in currentColor so it follows the theme.
  FILE_ICON: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',

  show({ filename, path, size, from }) {
    const container = this._container();
    const toast = document.createElement('div');
    toast.className = 'download-toast';
    // Open / Show need a real path. Rendering them for a download whose path
    // never arrived gave two buttons that silently did nothing.
    const fileActions = path
      ? '<button data-action="open" type="button">Open</button><button data-action="folder" type="button">Show</button>'
      : '';
    toast.innerHTML = `
      <div class="download-toast-icon">${this.FILE_ICON}</div>
      <div class="download-toast-info">
        <div class="download-toast-filename"></div>
        <div class="download-toast-size"></div>
      </div>
      <div class="download-toast-actions">
        ${fileActions}
        <button class="download-toast-close" data-action="dismiss" type="button" aria-label="Dismiss">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `;
    toast.querySelector('.download-toast-filename').textContent = filename || 'Download';
    toast.querySelector('.download-toast-size').textContent = this._formatBytes(size);

    const dismiss = () => {
      if (toast.classList.contains('leaving')) return;
      toast.classList.add('leaving');
      setTimeout(() => toast.remove(), 250);
    };

    toast.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'open') {
        // This is where an installer is actually opened from — the moment it
        // lands, not later from the panel. It gets the same check: who signed
        // it, where it came from. The panel owns that check; asking it here
        // keeps the two Open buttons from disagreeing.
        const okToOpen = window.DownloadsPanel?._okToOpen
          ? window.DownloadsPanel._okToOpen(path, from || '')
          : Promise.resolve(true);
        Promise.resolve(okToOpen)
          .catch(() => true)                       // a check that fails never blocks the open
          .then((ok) => {
            if (!ok) return;
            return Promise.resolve(window.vex?.downloadsOpenFile?.(path)).then((result) => {
              if (result && !result.ok) window.showToast?.(result.error || 'Could not open that file', 'error');
            });
          });
        dismiss();
      } else if (action === 'folder') {
        window.vex?.downloadsShowInFolder?.(path);
      } else if (action === 'dismiss') {
        dismiss();
      }
    });

    container.appendChild(toast);
    // Only the oldest go, and only once there are more than a windowful.
    const live = [...container.querySelectorAll('.download-toast:not(.leaving)')];
    for (const old of live.slice(0, Math.max(0, live.length - this.MAX_ON_SCREEN))) old.remove();
    return toast;
  },

  _formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
};

if (typeof window !== 'undefined') window.DownloadToast = DownloadToast;
if (typeof module !== 'undefined' && module.exports) module.exports = { DownloadToast };
