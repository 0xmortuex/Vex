// === Vex Mobile — what a site may ask for ===
//
// Camera, microphone, location and notifications, remembered per site the way
// the desktop's site settings are. Two layers have to agree before a page gets
// anything: Android has to have granted Vex the permission, and you have to
// have allowed that site — so a "yes" here can still end in Android's own
// prompt, and a "no" here is final without one.

const VexPermissions = (() => {
  const KINDS = {
    camera: { label: 'Camera', icon: 'camera' },
    microphone: { label: 'Microphone', icon: 'mic' },
    location: { label: 'Location', icon: 'globe' },
    notifications: { label: 'Notifications', icon: 'shield' }
  };

  function all() {
    const stored = VexStore.get('vex.sitePermissions', {});
    return stored && typeof stored === 'object' ? stored : {};
  }

  return {
    KINDS,

    get(host, kind) {
      const entry = all()[host];
      return (entry && entry[kind]) || 'ask';
    },

    async set(host, kind, state) {
      const permissions = all();
      const entry = Object.assign({}, permissions[host]);
      if (state === 'ask') delete entry[kind];
      else entry[kind] = state;
      if (Object.keys(entry).length) permissions[host] = entry;
      else delete permissions[host];
      await VexStore.set('vex.sitePermissions', permissions);
      return this.get(host, kind);
    },

    sites() { return Object.keys(all()).sort(); },

    describe(host) {
      const entry = all()[host];
      if (!entry) return 'Nothing asked for yet';
      // A kind this version does not know about — a renamed one, or one from a
      // newer build whose preferences synced down — must not take the site sheet
      // with it, so the stored key stands in for the label.
      const name = kind => ((KINDS[kind] || { label: kind }).label || kind).toLowerCase();
      const allowed = Object.entries(entry).filter(([, state]) => state === 'allow').map(([kind]) => name(kind));
      const blocked = Object.entries(entry).filter(([, state]) => state === 'block').map(([kind]) => name(kind));
      const parts = [];
      if (allowed.length) parts.push(allowed.join(', ') + ' allowed');
      if (blocked.length) parts.push(blocked.join(', ') + ' blocked');
      return parts.join(' · ') || 'Nothing asked for yet';
    },

    // Called when a page asks. Returns true if it may have it — which still
    // needs Android to agree, so the caller asks for the runtime permission.
    async decide(host, kind) {
      const stored = this.get(host, kind);
      if (stored === 'block') return false;
      if (stored === 'allow') return VexBridge.requestPermission(kind);
      return null;      // no answer yet: the chrome asks the person
    },

    async clearSite(host) {
      const permissions = all();
      delete permissions[host];
      await VexStore.set('vex.sitePermissions', permissions);
    }
  };
})();

if (typeof window !== 'undefined') window.VexPermissions = VexPermissions;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPermissions };
