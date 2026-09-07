const assert = require('assert/strict');
async function run({ mainWindow, phase }) {
  const wc = mainWindow.webContents;
  if (phase === 'seed') {
    await wc.executeJavaScript(`(async () => {
      await PersistentStorage.init();
      const tab = TabManager.tabs[0];
      tab.pinned = true;
      localStorage.setItem('vex.restartTabId', tab.id);
      localStorage.setItem('vex.restartDeleted', 'stale Chromium copy');
      await TabManager.persistTabs();
      await PersistentStorage._flush();
      // Simulate deletion by another window while this Chromium copy is stale.
      await window.vex.persistDelete('vex.restartDeleted');
      await window.vex.flushStorage();
    })()`);
    wc.session.flushStorageData();
    return 'restart state saved';
  }
  assert.equal(phase, 'verify');
  const state = await wc.executeJavaScript(`(async () => {
    await PersistentStorage.init();
    const id = localStorage.getItem('vex.restartTabId');
    const tab = TabManager.tabs.find(t => t.id === id);
    return { id, pinned: tab?.pinned, deleted: localStorage.getItem('vex.restartDeleted'),
      diskDeleted: (await window.vex.persistGetAll())['vex.restartDeleted'] ?? null };
  })()`);
  assert(state.id, 'Preference survives second process');
  assert.equal(state.pinned, true, 'Stable tab identity and pinned metadata survive restart');
  assert.equal(state.deleted, null, 'Deleted preference is removed from stale Chromium storage');
  assert.equal(state.diskDeleted, null, 'Deleted preference is not resurrected on disk');
  return 'two-process restart: stable tab, pin and preference deletion passed';
}
module.exports = { run };
