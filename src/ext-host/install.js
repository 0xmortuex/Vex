// === Vex extension host — install & patch ===
//
// Chrome extensions expect chrome.* to exist before their own code runs.
// Electron can't inject into an extension's script scope, so Vex copies the
// extension into its own directory and adds one line to two kinds of entry
// point: the background service worker, and every extension HTML page.
//
// Two properties make this safe and reversible:
//   - The original install is never touched; everything happens on a copy.
//   - The patch is additive. One import in the worker loader and one <script>
//     tag per page — the extension's own files are otherwise byte-identical.

const fs = require('fs');
const path = require('path');

const SHIM_FILE = 'vex-chrome-shim.js';
const BRIDGE_PRELOAD = path.join(__dirname, 'preload-bridge.js');
const SHIM_SOURCE = path.join(__dirname, 'chrome-shim.js');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

// Copy the extension and inject the shim. Returns { ok, manifest, patched }.
function prepare(srcDir, destDir) {
  const manifestPath = path.join(srcDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return { ok: false, error: 'No manifest.json in ' + srcDir };

  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch (err) { return { ok: false, error: 'Unreadable manifest.json: ' + err.message }; }

  fs.rmSync(destDir, { recursive: true, force: true });
  copyDir(srcDir, destDir);

  fs.copyFileSync(SHIM_SOURCE, path.join(destDir, SHIM_FILE));

  const patched = [];

  // --- OAuth callback landing page ---
  // Login ends with claude.ai redirecting to
  // chrome-extension://<id>/oauth_callback.html?code=…, which the extension
  // watches for via webNavigation. Two things stop that working out of the box:
  // the file isn't in the package, and Chromium refuses a web-origin redirect
  // into an extension unless the target is web-accessible. Creating the page
  // and declaring it fixes both, so the navigation actually happens and the
  // extension's own listener sees the authorization code.
  //
  // The page itself is deliberately inert — the extension does the token
  // exchange. This only has to exist so the redirect resolves.
  const CALLBACK = 'oauth_callback.html';
  if (!fs.existsSync(path.join(destDir, CALLBACK))) {
    fs.writeFileSync(path.join(destDir, CALLBACK), `<!doctype html>
<html><head><meta charset="utf-8"><title>Signing in…</title></head>
<body style="margin:0;display:grid;place-items:center;height:100vh;background:#F4F1EA;color:#3d3929;font:15px/1.5 system-ui,sans-serif">
  <div style="text-align:center">
    <div style="font-size:17px;margin-bottom:6px">Signed in to Claude</div>
    <div style="opacity:.65;font-size:13px">You can close this tab and return to the Claude panel.</div>
  </div>
</body></html>
`, 'utf8');
    patched.push(CALLBACK);
  }

  // Declare the callback web-accessible from claude.ai, or the redirect is
  // blocked before any navigation event fires.
  {
    const war = Array.isArray(manifest.web_accessible_resources) ? manifest.web_accessible_resources : [];
    const already = war.some(entry => Array.isArray(entry && entry.resources) && entry.resources.includes(CALLBACK));
    if (!already) {
      war.push({ resources: [CALLBACK], matches: ['https://claude.ai/*', 'https://*.claude.ai/*'], use_dynamic_url: false });
      manifest.web_accessible_resources = war;
      fs.writeFileSync(path.join(destDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
      patched.push('manifest.json');
    }
  }

  // --- background service worker ---
  const swRel = manifest.background && manifest.background.service_worker;
  if (swRel) {
    const swPath = path.join(destDir, swRel);
    if (fs.existsSync(swPath)) {
      const original = fs.readFileSync(swPath, 'utf8');
      if (!original.includes(SHIM_FILE)) {
        const isModule = (manifest.background.type === 'module');
        // A module worker must import the shim (import statements are hoisted
        // and evaluated in order, so the shim lands before the bundle). A
        // classic worker uses importScripts, which is synchronous.
        const prefix = isModule
          ? `import './${SHIM_FILE}';\n`
          : `try { importScripts('/${SHIM_FILE}'); } catch (e) { console.error('[vex-ext] shim load failed', e); }\n`;
        fs.writeFileSync(swPath, prefix + original, 'utf8');
        patched.push(swRel);
      }
    }
  }

  // --- extension pages ---
  // A classic <script> in <head> runs before deferred module scripts, so the
  // shim is in place by the time the page's bundle evaluates.
  const tag = `<script src="/${SHIM_FILE}"></script>`;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!/\.html?$/i.test(entry.name)) continue;
      let html = fs.readFileSync(p, 'utf8');
      if (html.includes(SHIM_FILE)) continue;
      if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, (mm) => mm + '\n    ' + tag);
      else if (/<html[^>]*>/i.test(html)) html = html.replace(/<html[^>]*>/i, (mm) => mm + '\n' + tag);
      else html = tag + '\n' + html;
      fs.writeFileSync(p, html, 'utf8');
      patched.push(path.relative(destDir, p));
    }
  };
  walk(destDir);

  return { ok: true, manifest, patched };
}

// The bridge preload must be registered on every session the extension can run
// in, for both worker and frame contexts, before the extension is loaded.
function registerPreloads(sessions) {
  for (const ses of sessions) {
    if (!ses || typeof ses.registerPreloadScript !== 'function') continue;
    for (const type of ['service-worker', 'frame']) {
      try {
        ses.registerPreloadScript({ type, filePath: BRIDGE_PRELOAD, id: 'vex-ext-bridge-' + type });
      } catch (err) {
        // Registering the same id twice throws, and that is the normal path:
        // init() registers on boot and installFrom() registers again to cover
        // sessions created since. Already-registered is success, not failure.
        if (!/existing ID|already/i.test(String(err.message))) {
          console.error('[vex-ext] preload registration failed', type, err.message);
        }
      }
    }
  }
}

module.exports = { prepare, registerPreloads, SHIM_FILE, BRIDGE_PRELOAD };
