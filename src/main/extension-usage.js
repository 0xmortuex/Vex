// === When was an extension last used, and is it just sitting there ==========
//
// The extension audit (extension-audit.js) says what an extension CAN do. This
// adds the other half of "should I keep it": when it last changed and when you
// last used it.
//
// "Used" is only what Vex can see you do: opening its popup or pressing its
// toolbar button. An extension that works silently on every page (a content
// blocker, a dark-mode switch) is never "used" in that sense, so it is marked
// `passive` and is never called unused — saying "unused for 30 days" about the
// thing blocking your ads would be wrong, and a button that disables it on
// that say-so would be worse.
//
// State is one small JsonStore key with a timestamp per extension folder.
// Nothing leaves the machine.
'use strict';

const STORE_KEY = 'extension-usage';
const UNUSED_DAYS = 30;
const DAY_MS = 24 * 3600 * 1000;
const FOLDER = /^[\w.@ -]{1,160}$/;
const MAX_ENTRIES = 500;

function isPassive(manifest) {
  const m = manifest || {};
  if (Array.isArray(m.content_scripts) && m.content_scripts.length) return true;
  if (m.declarative_net_request) return true;
  const perms = [...(Array.isArray(m.permissions) ? m.permissions : []), ...(Array.isArray(m.optional_permissions) ? m.optional_permissions : [])];
  return perms.some(p => /^(webRequest|declarativeNetRequest)/.test(String(p)));
}

function hasUi(manifest) {
  const m = manifest || {};
  return !!(m.action || m.browser_action || m.page_action);
}

function createExtensionUsage({ store, now = () => Date.now(), log }) {
  const note = typeof log === 'function' ? log : () => {};
  let data = null;
  let loading = null;

  function load() {
    if (data) return Promise.resolve(data);
    if (!loading) {
      loading = store.read(STORE_KEY).then((v) => {
        data = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
        return data;
      });
    }
    return loading;
  }

  // At most one write per extension per hour: a popup opened ten times in a
  // minute is one fact, not ten file rewrites.
  async function record(folder) {
    if (typeof folder !== 'string' || !FOLDER.test(folder)) return false;
    const d = await load();
    const t = now();
    if (d[folder] && t - d[folder] < 3600 * 1000) return false;
    if (!(folder in d) && Object.keys(d).length >= MAX_ENTRIES) return false;
    d[folder] = t;
    await store.write(STORE_KEY, d);
    return true;
  }

  // entries: [{ folder, path, manifest }] as the manager reads them from disk;
  // statMtime(path) -> epoch ms or null; updates: folder -> last update time
  // Vex itself installed (extension-updates history), if any.
  async function audit(entries, { statMtime = () => null, updates = {} } = {}) {
    const d = await load();
    const t = now();
    return entries.map((e) => {
      const manifest = e.manifest || {};
      const lastUsed = Number.isFinite(d[e.folder]) ? d[e.folder] : null;
      const updatedByVex = Number.isFinite(updates[e.folder]) ? updates[e.folder] : null;
      let filesChanged = null;
      try { const m = statMtime(e.path); if (Number.isFinite(m)) filesChanged = m; } catch (err) { note('[ExtensionUsage] could not read ' + e.folder + "'s date: " + err.message); }
      const lastUpdated = Math.max(updatedByVex || 0, filesChanged || 0) || null;
      const passive = isPassive(manifest);
      const ui = hasUi(manifest);
      // Unused needs a way to be used that Vex can see.
      let unused = null;
      if (ui && !passive) {
        const since = lastUsed || lastUpdated;
        unused = since ? t - since > UNUSED_DAYS * DAY_MS : null;
      }
      return {
        folder: e.folder,
        lastUsed,
        lastUpdated,
        passive,
        usageKnown: ui && !passive,
        unused,
      };
    });
  }

  return { record, audit, snapshot: async () => ({ ...(await load()) }) };
}

module.exports = { createExtensionUsage, isPassive, hasUi, UNUSED_DAYS };
