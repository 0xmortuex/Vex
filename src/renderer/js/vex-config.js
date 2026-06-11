// === Vex runtime configuration: self-hosted backends ===
//
// The AI assistant and Sync features talk to Cloudflare Workers that each user
// deploys themselves — see SELF_HOSTING.md. Their URLs live in localStorage so
// they can be set in Settings without rebuilding the app.
//
// Empty string = "not configured":
//   - AI: auto routing prefers local Ollama; an explicit cloud request shows a
//     clear "add your AI Worker URL" error (see ai-router.js).
//   - Sync: stays off entirely until a URL is set (see sync-engine.js).
//
// Nothing here ships pointing at anyone else's backend, so a fresh install
// never spends someone else's API credits or stores data on their server.

const VexConfig = {
  aiWorkerUrl() {
    try { return (localStorage.getItem('vex.aiWorkerUrl') || '').trim(); } catch { return ''; }
  },
  syncWorkerUrl() {
    try { return (localStorage.getItem('vex.syncWorkerUrl') || '').trim(); } catch { return ''; }
  },
  setAiWorkerUrl(url) {
    try { localStorage.setItem('vex.aiWorkerUrl', String(url || '').trim()); } catch {}
  },
  setSyncWorkerUrl(url) {
    try { localStorage.setItem('vex.syncWorkerUrl', String(url || '').trim()); } catch {}
  },
};

if (typeof window !== 'undefined') window.VexConfig = VexConfig;
// Renderer loads this via <script>; the guard keeps it importable in tests.
if (typeof module !== 'undefined' && module.exports) module.exports = { VexConfig };
