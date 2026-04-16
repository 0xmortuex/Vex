// === Vex Keyboard Shortcuts Panel ===

const ShortcutsPanel = {
  shortcuts: {
    'Tabs': [
      { name: 'New Tab', keys: 'Ctrl+T' },
      { name: 'Close Tab', keys: 'Ctrl+W' },
      { name: 'Reopen Closed Tab', keys: 'Ctrl+Shift+T' },
      { name: 'Sleep Current Tab', keys: 'Ctrl+Shift+Z' }
    ],
    'Navigation': [
      { name: 'Back', keys: 'Alt+Left' },
      { name: 'Forward', keys: 'Alt+Right' },
      { name: 'Reload', keys: 'Ctrl+R' },
      { name: 'Focus URL Bar', keys: 'Ctrl+L' },
      { name: 'Find in Page', keys: 'Ctrl+F' }
    ],
    'Panels': [
      { name: 'History', keys: 'Ctrl+H' },
      { name: 'Notes', keys: 'Ctrl+Shift+N' },
      { name: 'Memory', keys: 'Ctrl+Shift+M' },
      { name: 'Sessions', keys: 'Ctrl+Shift+O' }
    ],
    'Tools': [
      { name: 'Command Bar', keys: 'Ctrl+K' },
      { name: 'Screenshot', keys: 'Ctrl+Alt+S' },
      { name: 'Reading Mode', keys: 'Ctrl+Shift+R' },
      { name: 'Split Screen', keys: 'Ctrl+Shift+S' },
      { name: 'Picture-in-Picture', keys: 'Ctrl+Shift+P' }
    ],
    'Zoom': [
      { name: 'Zoom In', keys: 'Ctrl+=' },
      { name: 'Zoom Out', keys: 'Ctrl+-' },
      { name: 'Reset Zoom', keys: 'Ctrl+0' }
    ],
    'Window': [
      { name: 'Minimize', keys: 'System' },
      { name: 'Maximize', keys: 'System' },
      { name: 'Close', keys: 'System' }
    ]
  },

  init() {
    const panel = document.getElementById('panel-shortcuts');
    if (!panel || panel.dataset.rendered) return;
    panel.dataset.rendered = 'true';

    let html = '<div class="shortcuts-container"><h2>Keyboard Shortcuts</h2>';
    for (const [category, items] of Object.entries(this.shortcuts)) {
      html += `<div class="shortcuts-category"><div class="shortcuts-category-title">${category}</div>`;
      for (const item of items) {
        html += `<div class="shortcut-row"><span class="shortcut-row-name">${item.name}</span><span class="shortcut-row-keys">${item.keys}</span></div>`;
      }
      html += '</div>';
    }
    html += '</div>';
    panel.innerHTML = html;
  }
};
