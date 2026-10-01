// === Vex Mobile — backup and restore ===
//
// One file with everything in it, encrypted with a passphrase you choose, so
// moving to a new phone is not an afternoon of re-adding bookmarks.
//
// What it carries: every setting, every bookmark and folder, the reading list,
// sessions, quick access, tab groups, site rules, site permissions, notes,
// reminders, the blocker's allowlist and counts, and — if you ask for it — your
// history.
//
// What it does NOT carry, on purpose:
//   • saved logins and their TOTP secrets. They are sealed by a key inside the
//     phone's Keystore, which cannot leave it. That is the point of the vault,
//     and a backup that quietly broke it would be worse than no backup.
//   • saved pages. They are whole documents, and a backup you cannot email is
//     not much of a backup.
//
// The encryption is PBKDF2-SHA256 (210,000 rounds) to an AES-GCM key. Not the
// sync key: sync's key is random and lives on your devices, while this one has
// to be reconstructible from something you remember, which is a different job
// with a different weakness — so it is written here rather than in the shared
// crypto the desktop and phone must agree on byte for byte.

const VexBackup = (() => {
  const FORMAT = 'vex.backup';
  const VERSION = 1;
  const ROUNDS = 210000;
  const HISTORY_CAP = 5000;

  // Keys never written to a backup, whatever is in the store.
  const NEVER = new Set([
    'vex.openTabs',          // tabs belong to a phone, not to a person
    'vex.activeTabUrl',
    'vex.closedTabs',
    'vex.sync',              // the sync key is bound to its own recovery code
    'vex.blockRules'         // gone in version 5; still named so an old one is never copied
  ]);

  function bytes(text) { return new TextEncoder().encode(text); }

  function toBase64(buffer) {
    const u8 = new Uint8Array(buffer);
    let out = '';
    for (let at = 0; at < u8.length; at += 0x8000) {
      out += String.fromCharCode.apply(null, u8.subarray(at, at + 0x8000));
    }
    return btoa(out);
  }

  function fromBase64(text) {
    const binary = atob(String(text || ''));
    const u8 = new Uint8Array(binary.length);
    for (let at = 0; at < binary.length; at++) u8[at] = binary.charCodeAt(at);
    return u8;
  }

  async function keyFrom(passphrase, salt) {
    const material = await crypto.subtle.importKey('raw', bytes(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: ROUNDS, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  return {
    FORMAT, VERSION, NEVER, HISTORY_CAP,

    /** Everything worth keeping, as a plain object. */
    async collect({ history = false } = {}) {
      const settings = {};
      for (const key of VexStore.keys()) {
        if (NEVER.has(key)) continue;
        const value = VexStore.get(key, null);
        if (value === null || value === undefined) continue;
        settings[key] = value;
      }
      const data = { settings };
      if (history) {
        const rows = await VexDB.scan('history', { index: 'at', direction: 'prev', limit: HISTORY_CAP })
          .catch(() => []);
        data.history = (rows || []).map(row => ({
          url: row.url, title: row.title, at: row.at, icon: row.icon || ''
        }));
      }
      const notes = await VexDB.scan('notes', { index: 'at', direction: 'prev', limit: 2000 }).catch(() => []);
      data.notes = notes || [];
      return data;
    },

    /** What a backup would contain, for telling someone before they make one. */
    async summary({ history = false } = {}) {
      const data = await this.collect({ history });
      return {
        settings: Object.keys(data.settings).length,
        bookmarks: (data.settings['vex.bookmarks'] || []).length,
        reading: (data.settings['vex.readingList'] || []).length,
        sessions: (data.settings['vex.sessions'] || []).length,
        rules: Object.keys(data.settings['vex.siteRules'] || {}).length,
        notes: (data.notes || []).length,
        history: (data.history || []).length
      };
    },

    async encrypt(data, passphrase) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const key = await keyFrom(passphrase, salt);
      const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
        bytes(JSON.stringify(data)));
      return {
        format: FORMAT,
        version: VERSION,
        at: Date.now(),
        rounds: ROUNDS,
        salt: toBase64(salt),
        iv: toBase64(iv),
        sealed: toBase64(sealed)
      };
    },

    async decrypt(envelope, passphrase) {
      if (!envelope || envelope.format !== FORMAT) throw new Error('That is not a Vex backup.');
      if (Number(envelope.version) > VERSION) {
        throw new Error('That backup was written by a newer Vex than this one.');
      }
      const key = await keyFrom(passphrase, fromBase64(envelope.salt));
      let plain;
      try {
        plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: fromBase64(envelope.iv) }, key, fromBase64(envelope.sealed));
      } catch {
        // AES-GCM fails the same way for a wrong passphrase and for a damaged
        // file, and there is no way to tell them apart — so say both.
        throw new Error('That passphrase does not open this file, or the file is damaged.');
      }
      try {
        return JSON.parse(new TextDecoder().decode(plain));
      } catch {
        throw new Error('The backup opened but its contents are not readable.');
      }
    },

    /** The file, as text, ready to be written to Downloads. */
    async write(passphrase, { history = false } = {}) {
      if (String(passphrase || '').length < 8) {
        throw new Error('Use a passphrase of at least eight characters — it is the only thing protecting this file.');
      }
      const data = await this.collect({ history });
      return JSON.stringify(await this.encrypt(data, passphrase), null, 1);
    },

    /**
     * Put a backup back. Settings are replaced rather than merged: a restore is
     * something you do to a phone you want to look like the old one, and a merge
     * would leave you with neither.
     */
    async restore(data) {
      const settings = (data && data.settings) || {};
      let applied = 0;
      for (const [key, value] of Object.entries(settings)) {
        if (NEVER.has(key) || !key.startsWith('vex.')) continue;
        await VexStore.set(key, value);
        applied++;
      }
      let notes = 0;
      for (const note of (data && data.notes) || []) {
        const { id, ...rest } = note;          // let the store assign its own
        await VexDB.add('notes', rest).catch(() => {});
        notes++;
      }
      let history = 0;
      for (const entry of (data && data.history) || []) {
        if (!entry || !entry.url) continue;
        await VexDB.add('history', {
          url: entry.url, title: entry.title || '', at: entry.at || Date.now(),
          icon: entry.icon || '',
          // The same host the rest of Vex writes. new URL().hostname keeps the
          // www., which left restored rows under a host nobody else looks for —
          // "forget this site" and the per-site grouping would both miss them.
          host: VexSearch.prettyHost(entry.url)
        }).catch(() => {});
        history++;
      }
      return { settings: applied, notes, history };
    }
  };
})();

if (typeof window !== 'undefined') window.VexBackup = VexBackup;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexBackup };
