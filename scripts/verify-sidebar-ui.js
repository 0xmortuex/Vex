// Real-Chromium screenshot of the left-sidebar customization UI:
//   • the Settings → Sidebar manager list (rendered by SidebarManager)
//   • a right-click context menu on a BUILT-IN button (Notes) — reduced menu
// Loads the real theme-tokens.css + app.css + sidebar.js so the screenshot
// reflects production styling. Writes dist/sidebar-ui.png.

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const R = path.join(__dirname, '..', 'src', 'renderer');
const css = (f) => fs.readFileSync(path.join(R, 'css', f), 'utf8');
const sidebarJs = fs.readFileSync(path.join(R, 'js', 'sidebar.js'), 'utf8');

// A representative slice of the real #icon-sidebar (real classes/data-panels).
const sidebarHtml = `
  <div id="icon-sidebar">
    <button class="sidebar-icon active" data-panel="start" title="Start Page"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 7.5L10 2.5L17 7.5V16C17 16.55 16.55 17 16 17H4C3.45 17 3 16.55 3 16V7.5Z" stroke="currentColor" stroke-width="1.5"/></svg></button>
    <button class="sidebar-icon" data-panel="claude" title="Claude AI"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 2L3 6V14L10 18L17 14V6L10 2Z" stroke="currentColor" stroke-width="1.5"/></svg></button>
    <button class="sidebar-icon" data-panel="notes" title="Notes"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg></button>
    <button class="sidebar-icon" data-panel="downloads" title="Downloads"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
    <button class="sidebar-icon" data-panel="bookmarks" title="Bookmarks"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></button>
    <div class="sidebar-spacer" style="flex:1"></div>
    <button class="sidebar-icon" data-panel="settings" title="Settings"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="2" stroke="currentColor" stroke-width="1.5"/></svg></button>
  </div>`;

const html = `<!doctype html><html data-theme="default"><head><meta charset="utf-8">
<style>${css('theme-tokens.css')}</style><style>${css('app.css')}</style>
<style>body{margin:0;display:flex;gap:0;height:100vh;background:var(--bg);color:var(--text);font-family:'Outfit',sans-serif}
  #icon-sidebar{display:flex;flex-direction:column;gap:6px;padding:8px;background:var(--sidebar);height:100vh;box-sizing:border-box}
  .panel-fake{flex:1;padding:24px;overflow:auto}</style></head>
<body>
  ${sidebarHtml}
  <div class="panel-fake">
    <div class="settings-content">
      <div class="setting-group">
        <label class="setting-label">Sidebar Buttons</label>
        <p class="setting-info muted" style="margin-bottom:8px">Rename, change the icon, hide/show, reorder, or (for web buttons) change the link. You can also right-click any button in the sidebar directly.</p>
        <div id="sidebar-manager-list" style="border:1px solid var(--border);border-radius:8px;padding:4px 10px;max-height:340px;overflow:auto"></div>
      </div>
    </div>
  </div>
  <script>${sidebarJs}</script>
  <script>
    SidebarManager.renderSidebarManager();
    // Pop the reduced context menu on the built-in Notes button.
    const r = document.querySelector('.sidebar-icon[data-panel="notes"]').getBoundingClientRect();
    SidebarManager.showContextMenu({ clientX: r.right + 6, clientY: r.top }, 'notes');
  </script>
</body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 760, height: 560, webPreferences: {} });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise(r => setTimeout(r, 400));
  const img = await win.webContents.capturePage();
  const out = path.join(__dirname, '..', 'dist', 'sidebar-ui.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.toPNG());

  // Sanity assertions on the rendered DOM.
  const checks = await win.webContents.executeJavaScript(`(() => ({
    rows: document.querySelectorAll('#sidebar-manager-list > div').length,
    menu: !!document.querySelector('.tab-context-menu'),
    menuItems: [...document.querySelectorAll('.tab-context-menu .tab-context-item')].map(e=>e.textContent),
  }))()`);
  console.log('manager rows:', checks.rows);
  console.log('context menu shown:', checks.menu);
  console.log('menu items:', JSON.stringify(checks.menuItems));
  console.log('screenshot:', out);
  const ok = checks.rows === 5 && checks.menu && !checks.menuItems.includes('Change link…');
  console.log('RESULT:', ok ? 'PASS' : 'FAIL');
  app.exit(ok ? 0 : 1);
});
