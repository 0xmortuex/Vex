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

  show({ filename, path, size }) {
    const container = this._container();
    const toast = document.createElement('div');
    toast.className = 'download-toast';
    toast.innerHTML = `
      <div class="download-toast-icon">📄</div>
      <div class="download-toast-info">
        <div class="download-toast-filename"></div>
        <div class="download-toast-size"></div>
      </div>
      <div class="download-toast-actions">
        <button data-action="open" type="button">Open</button>
        <button data-action="folder" type="button">Show</button>
        <button class="download-toast-close" data-action="dismiss" type="button" aria-label="Dismiss">×</button>
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
        if (path) window.vex?.downloadsOpenFile?.(path);
        dismiss();
      } else if (action === 'folder') {
        if (path) window.vex?.downloadsShowInFolder?.(path);
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
