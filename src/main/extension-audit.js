// === What an extension can actually do =====================================
//
// An extension is installed once, in a hurry, and then sits there for two
// years with permission to read every page you open — including your bank, your
// email and anything you type into a form. The manifest says so plainly, but
// nobody reads manifests.
//
// This turns a manifest into two answers:
//   reach   which pages it can read: all of them, a named few, or only the
//           page you are on when you click it
//   powers  the permissions that matter to a person, in words — your cookies,
//           your history, your downloads, reading your clipboard, talking to a
//           program on this machine
//
// It judges nothing: an extension that needs all pages to do its job is not
// suspicious, it is a content blocker. What it does is make the answer visible
// so the decision is yours.
const GENERIC = /^(\*|<all_urls>|https?:\/\/\*\/\*|\*:\/\/\*\/\*|https?:\/\/\*\/|file:\/\/\*)/i;

// Permission → what it means for the person, and whether it is worth a second
// look. Anything not here is left out of the list rather than shown as jargon.
const POWERS = {
  cookies: { says: 'Read and change your cookies, including the ones that keep you signed in', heavy: true },
  history: { says: 'Read your browsing history', heavy: true },
  tabs: { says: 'See the address and title of every tab you have open', heavy: true },
  bookmarks: { says: 'Read and change your bookmarks' },
  downloads: { says: 'See and start downloads', heavy: true },
  clipboardRead: { says: 'Read what you have copied', heavy: true },
  clipboardWrite: { says: 'Put things on your clipboard' },
  nativeMessaging: { says: 'Talk to a program installed on this machine', heavy: true },
  management: { says: 'See, disable and remove your other extensions', heavy: true },
  debugger: { says: 'Attach a debugger to pages — it can read and change anything on them', heavy: true },
  proxy: { says: 'Decide where your traffic goes', heavy: true },
  privacy: { says: 'Change your privacy settings' },
  webRequest: { says: 'Watch every request pages make' },
  webRequestBlocking: { says: 'Watch and stop requests pages make' },
  declarativeNetRequest: { says: 'Block or change requests by its own rules' },
  storage: { says: 'Keep settings of its own' },
  scripting: { says: 'Run its own code inside pages' },
  activeTab: { says: 'Read the page you are on, but only when you click it' },
  geolocation: { says: 'Ask where you are' },
  notifications: { says: 'Show desktop notifications' },
  identity: { says: 'Sign you in to its own account' },
};

const strings = (v) => (Array.isArray(v) ? v.filter(s => typeof s === 'string') : []);

// Every host pattern the extension asks for, from both places manifests put
// them: host_permissions (v3), permissions (v2), and content-script matches.
function patterns(manifest) {
  const m = manifest || {};
  const out = [...strings(m.host_permissions), ...strings(m.permissions).filter(p => /:\/\/|^<all_urls>$/.test(p))];
  for (const cs of Array.isArray(m.content_scripts) ? m.content_scripts : []) out.push(...strings(cs && cs.matches));
  return out;
}

function hostsOf(manifest) {
  const hosts = new Set();
  let all = false;
  for (const p of patterns(manifest)) {
    if (GENERIC.test(p)) { all = true; continue; }
    const mm = String(p).match(/^[a-z*]+:\/\/([^/]+)\/?/i);
    if (mm) hosts.add(mm[1].replace(/^\*\./, '').toLowerCase());
  }
  return { all, hosts: [...hosts].sort() };
}

// One sentence about what it can read, and a word for how far that goes.
function reach(manifest) {
  const { all, hosts } = hostsOf(manifest);
  const perms = strings((manifest || {}).permissions);
  if (all) return { level: 'all', hosts, says: 'Can read and change every page you open' };
  if (hosts.length) {
    return {
      level: 'some',
      hosts,
      says: 'Can read and change pages on ' + (hosts.length <= 3 ? hosts.join(', ') : hosts.slice(0, 3).join(', ') + ' and ' + (hosts.length - 3) + ' more'),
    };
  }
  if (perms.includes('activeTab')) return { level: 'click', hosts, says: 'Can read the page you are on, but only when you click it' };
  return { level: 'none', hosts, says: 'Cannot read the pages you open' };
}

function powers(manifest) {
  const asked = [...strings((manifest || {}).permissions), ...strings((manifest || {}).optional_permissions)];
  const seen = new Set();
  const out = [];
  for (const p of asked) {
    const key = String(p).split('.')[0];
    if (!POWERS[key] || seen.has(key)) continue;
    seen.add(key);
    out.push({ id: key, says: POWERS[key].says, heavy: !!POWERS[key].heavy });
  }
  return out.sort((a, b) => (b.heavy ? 1 : 0) - (a.heavy ? 1 : 0) || a.id.localeCompare(b.id));
}

// Sorting the list so the ones worth looking at are at the top. This is
// ordering, not a verdict — the words next to each extension are the verdict,
// and they are the manifest's own.
function weight(audit) {
  const level = { all: 100, some: 40, click: 10, none: 0 }[audit.reach.level] || 0;
  return level + audit.powers.filter(p => p.heavy).length * 12;
}

function auditOne(entry) {
  const manifest = (entry && entry.manifest) || {};
  const out = { reach: reach(manifest), powers: powers(manifest) };
  return { ...out, weight: weight(out) };
}

module.exports = { auditOne, reach, powers, hostsOf, patterns, weight, POWERS };
