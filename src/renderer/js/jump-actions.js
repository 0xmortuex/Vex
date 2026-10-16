// === Taskbar actions (T3-085, the window's half) ================================
//
// Right-click Vex on the Windows taskbar for New note, New workspace, Reopen last
// closed tab and Quick capture (src/main/jump-list.js writes the list with
// app.setUserTasks; nothing else on the system is touched). Quick capture is a
// window of main's own; the other three arrive here: main keeps the action until
// this window asks for it ('jump:take'), at start and whenever it says one is
// waiting. Each runs as the matching thing in Vex would.
//
// The switch is the record vex.jumpList = { on }, which main reads when it writes
// the list; changing it rewrites the list at once. Off leaves only "Start in safe
// mode" there, as before.
const VexJumpActions = {
  KEY: 'vex.jumpList',
  DEFAULTS: { on: true },

  enabled() {
    const raw = localStorage.getItem(this.KEY);
    if (raw === null) return this.DEFAULTS.on;
    let v;
    try { v = JSON.parse(raw); }
    catch (err) { console.error('[JumpList] the saved choice is damaged and starts again:', err); return this.DEFAULTS.on; }
    return !!(v && typeof v === 'object' && typeof v.on === 'boolean' ? v.on : this.DEFAULTS.on);
  },
  setEnabled(on) {
    localStorage.setItem(this.KEY, JSON.stringify({ on: !!on }));
    if (window.vex && typeof window.vex.jumpListApply === 'function') {
      window.vex.jumpListApply().catch(err => {
        if (typeof VexProblems !== 'undefined') VexProblems.note('Taskbar', 'The taskbar list could not be rewritten', err);
        window.showToast?.('The taskbar list could not be changed: ' + ((err && err.message) || err), 'error');
      });
    }
  },

  // What each action does. A table, so an action not named here cannot run.
  RUN: {
    'new-note': () => { SidebarManager.openPanel('notes'); requestAnimationFrame(() => NotesPanel.createNote()); },
    'new-workspace': () => { WorkspaceManager.showModal(); },
    'reopen-last': () => { TabManager.reopenLastClosed(); },
  },

  async take() {
    if (!window.vex || typeof window.vex.jumpTake !== 'function') return null;
    const action = await window.vex.jumpTake();
    if (!action) return null;
    // A taskbar entry is the person's own request, so it runs even when the interface's switch for the list is off
    // (an old entry can outlive the switch until Windows has the list rewritten).
    const run = Object.prototype.hasOwnProperty.call(this.RUN, action) ? this.RUN[action] : null;
    if (!run) throw new Error('Not a taskbar action Vex knows: ' + String(action).slice(0, 40));
    run();
    return action;
  },

  init() {
    // Taskbar actions belong to the main window; a private window has none.
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return null;
    const fail = (err) => {
      if (typeof VexProblems !== 'undefined') VexProblems.note('Taskbar', 'A taskbar action did not work', err);
      window.showToast?.('The taskbar action did not work: ' + ((err && err.message) || err), 'error');
    };
    if (window.vex && typeof window.vex.onJumpWaiting === 'function') window.vex.onJumpWaiting(() => this.take().catch(fail));
    return this.take().catch(fail);
  },
};

if (typeof window !== 'undefined') window.VexJumpActions = VexJumpActions;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexJumpActions };
