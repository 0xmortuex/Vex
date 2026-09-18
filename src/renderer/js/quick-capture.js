// === Carrying out what the capture box took =================================
//
// The little window (renderer/capture.html) takes one line from anywhere in
// Windows and hands it here. Everything it can do already exists in Vex —
// notes, reminders, timers, the command bar, the AI — so this only decides
// which one and passes the text along. Nothing is reimplemented.
const QuickCapture = {
  init() {
    if (!window.vex || typeof window.vex.onCaptureTake !== 'function') return false;
    window.vex.onCaptureTake(async (job) => {
      let out;
      try { out = { ok: true, said: await this.run(job) }; }
      catch (err) {
        out = { ok: false, error: (err && err.message) || 'That did not work' };
        VexProblems?.note('Quick capture', 'Could not carry out "' + String(job && job.text).slice(0, 60) + '"', err);
      }
      try { window.vex.captureDone({ id: job.id, ...out }); } catch {}
    });
    return true;
  },

  // → a short line saying what happened, which the box shows before it closes.
  async run(job) {
    const text = String((job && job.text) || '').trim();
    if (!text) throw new Error('There is nothing to save');
    const kind = String((job && job.kind) || 'note');

    if (kind === 'command') {
      // "remind me…", "timer 20 min", "alarm 7am" and every Ctrl+K command
      // already work — this is the same path, from outside the window.
      if (typeof AgentTools === 'undefined') throw new Error('Commands are not available');
      const ran = await AgentTools.vexCommand(text);
      return ran.ran || 'Done';
    }

    if (kind === 'ask') {
      // A question needs the panel: an answer in a box that closes in a second
      // would be worse than useless.
      if (typeof AIPanel === 'undefined') throw new Error('The AI panel is not available');
      window.vex.focusWindow?.();
      if (!AIPanel.isOpen()) AIPanel.toggle();
      const input = document.getElementById('ai-input');
      if (input) { input.value = text; AIPanel._sendChat(); }
      return 'Asked Vex — the answer is in the panel';
    }

    if (typeof AgentTools === 'undefined') throw new Error('Notes are not available');
    // A captured line is a thought, not a document: the first few words are the
    // title and the whole line is the body, so nothing is lost either way.
    const title = text.split(/\s+/).slice(0, 7).join(' ').slice(0, 60) + (text.split(/\s+/).length > 7 ? '…' : '');
    AgentTools.saveNote(title, text);
    return 'Saved to Notes';
  },
};

if (typeof window !== 'undefined') window.QuickCapture = QuickCapture;
if (typeof module !== 'undefined' && module.exports) module.exports = { QuickCapture };
