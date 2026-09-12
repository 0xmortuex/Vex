// === Download completion toast ===
// Pops a glassmorphic card in the bottom-right when a download finishes,
// with Open / Show-in-folder / dismiss actions. Multiple toasts stack
// vertically (newest on top via flex-direction: column-reverse on the
// container). Auto-dismisses after 8s; pauses while hovered.

const DownloadToast = {
  AUTO_DISMISS_MS: 8000,
  POST_HOVER_MS: 3000,

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

  show({ filename, path, size }) {
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

    let dismissTimer = null;
    const dismiss = () => {
      if (toast.classList.contains('leaving')) return;
      toast.classList.add('leaving');
      clearTimeout(dismissTimer);
      setTimeout(() => toast.remove(), 250);
    };
    const armDismiss = (ms) => {
      clearTimeout(dismissTimer);
      dismissTimer = setTimeout(dismiss, ms);
    };

    toast.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'open') {
        Promise.resolve(window.vex?.downloadsOpenFile?.(path)).then((result) => {
          if (result && !result.ok) window.showToast?.(result.error || 'Could not open that file', 'error');
        });
        dismiss();
      } else if (action === 'folder') {
        window.vex?.downloadsShowInFolder?.(path);
      } else if (action === 'dismiss') {
        dismiss();
      }
    });

    toast.addEventListener('mouseenter', () => clearTimeout(dismissTimer));
    toast.addEventListener('mouseleave', () => armDismiss(this.POST_HOVER_MS));

    container.appendChild(toast);
    armDismiss(this.AUTO_DISMISS_MS);
  },

  _formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
};

window.DownloadToast = DownloadToast;
