// === Vex Screenshot Tool ===

const ScreenshotTool = {
  async capture() {
    const wv = WebviewManager.getActiveWebview();
    if (!wv) { window.showToast?.('No active tab to capture'); return; }

    try {
      const image = await wv.capturePage();
      if (!image || image.isEmpty()) { window.showToast?.('Screenshot failed'); return; }
      const dataUrl = image.toDataURL();
      this.showPreview(dataUrl);
    } catch (e) {
      window.showToast?.('Screenshot error: ' + e.message);
    }
  },

  showPreview(dataUrl) {
    let overlay = document.getElementById('screenshot-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'screenshot-overlay';
      document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
      <div class="screenshot-preview">
        <img src="${dataUrl}" alt="Screenshot">
        <div class="screenshot-actions">
          <button class="ss-save">Save</button>
          <button class="ss-copy">Copy</button>
          <button class="ss-close">Close</button>
        </div>
      </div>
    `;
    overlay.classList.add('visible');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.hidePreview(); });

    overlay.querySelector('.ss-save')?.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `vex-screenshot-${new Date().toISOString().replace(/[:.]/g, '-').slice(0,19)}.png`;
      a.click();
      this.hidePreview();
      window.showToast?.('Screenshot saved');
    });

    overlay.querySelector('.ss-copy')?.addEventListener('click', async () => {
      try {
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        window.showToast?.('Copied to clipboard');
      } catch {
        window.showToast?.('Copy failed');
      }
      this.hidePreview();
    });

    overlay.querySelector('.ss-close')?.addEventListener('click', () => this.hidePreview());
  },

  hidePreview() {
    document.getElementById('screenshot-overlay')?.classList.remove('visible');
  }
};
