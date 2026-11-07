// === "What changed since the last launch": the rows in the Attention Inbox =====
//
// The main process (src/main/integrity-report.js) compares hashes of Vex's own
// program files, its Start menu and Desktop shortcuts and four of its
// configuration files with the ones it recorded last time. It only says WHICH
// KIND of change it saw; the words are here. Nothing is shown when nothing
// changed, nothing is repaired, and the rows follow the Inbox's usual verbs
// (Dismiss, Show less, Never for this).
//
// Be plain about the limit: a program running as you can recompute the record,
// so this catches accidents and clumsy changes, not a careful attacker. Every
// row says so in its last sentence.
const VexIntegrityNotes = {
  FEATURE: 'integrity-report',
  LABEL: 'What changed since the last launch',

  // The row for one note from main. Returns null for a kind this window does not know.
  // Every sentence is written out in full so that each one has its own Turkish line (js/i18n-ui.js).
  rowFor(note) {
    switch (note && note.id) {
      case 'exe':
        return { id: 'exe', title: 'Vex.exe changed since the last update', body: 'The program file is not the one Vex recorded after the last update. If you did not expect this, install Vex again from its official page. This check only catches accidents and clumsy changes: a program running as you could also edit the record.' };
      case 'asar':
        return { id: 'asar', title: 'Vex’s app code changed since the last update', body: 'The packed app file (app.asar) differs from the one Vex recorded after the last update. If you did not expect this, install Vex again from its official page. This check only catches accidents and clumsy changes: a program running as you could also edit the record.' };
      case 'dll':
        return { id: 'dll', title: 'A library next to Vex.exe changed since the last update', body: 'One or more .dll files in Vex’s program folder differ from the ones recorded after the last update. This check only catches accidents and clumsy changes: a program running as you could also edit the record.' };
      case 'shortcut':
        return note.where === 'desktop'
          ? { id: 'shortcut:desktop', title: 'The Vex desktop shortcut opens something different', body: 'The shortcut’s target or arguments are not the ones Vex recorded. Check what it opens before you use it. This check only catches accidents and clumsy changes: a program running as you could also edit the record.' }
          : { id: 'shortcut:start-menu', title: 'The Vex Start menu shortcut opens something different', body: 'The shortcut’s target or arguments are not the ones Vex recorded. Check what it opens before you use it. This check only catches accidents and clumsy changes: a program running as you could also edit the record.' };
      case 'config': {
        const title = {
          'site-rules': 'Site rules changed outside Vex',
          'permissions': 'Site permissions changed outside Vex',
          'session-routing': 'Site containers changed outside Vex',
          'extensions': 'The extension list changed outside Vex',
        }[note.name];
        if (!title) return null;
        return { id: 'config:' + note.name, title, body: 'The file changed while Vex was closed. If you did not do this, review it in Settings. This check only catches accidents and clumsy changes: a program running as you could also edit the record.' };
      }
      case 'feed-unsigned':
        return { id: 'feed-unsigned', title: 'Updates are not signature-checked yet', body: 'Vex checks an update’s checksum, which comes from the same place as the update. The maker can add an independent signature (see RELEASING.md); until then a stolen release account could swap an update.' };
      default:
        return null;
    }
  },

  async run() {
    const api = window.vex && window.vex.integrity;
    if (!api || typeof api.report !== 'function') return 0;
    const r = await api.report();
    if (!r || !r.ok) throw new Error((r && r.error) || 'The integrity report did not answer');
    let n = 0;
    for (const note of r.notes || []) {
      const row = this.rowFor(note);
      if (!row) continue;
      if (VexAttention.suggest({ feature: this.FEATURE, label: this.LABEL, ...row })) n++;
    }
    return n;
  },
};

if (typeof window !== 'undefined') {
  window.VexIntegrityNotes = VexIntegrityNotes;
  VexIntegrityNotes.run().catch((err) => window.VexProblems?.note('Integrity report', 'Could not read what changed since the last launch', err));
}
if (typeof module !== 'undefined') module.exports = VexIntegrityNotes;
