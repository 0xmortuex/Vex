// === More ways to open a link: split view, a container, a private window, the background ===================
//
// The link menu had "Open Link in New Tab" and little else. These rows reuse what Vex already has and add no
// storage of their own:
//   Open Link in Split View      a tab for the link beside the one in front (js/split.js)
//   Open Link in Container       a tab for the link in another container's cookie jar (js/container-memory.js)
//   Open Link in Private Window  a private window on the link (main's open-private-window; nothing is kept)
//   Open Link in Background      a tab that does not take the focus
// Only http and https links are offered: a javascript:, mailto: or file: link is not a page to open.
const VexLinkOpen = {
  MAX_PANES: 4,

  webLink(url) { return typeof url === 'string' && /^https?:\/\//i.test(url) && url.length <= 8192; },

  // What the split should do with a new tab. Pure: { action: 'start', panes } | { action: 'add', panes } | { action: 'full' }.
  planSplit({ active, panes, fromId, newId, max = this.MAX_PANES }) {
    if (!active || !Array.isArray(panes) || panes.length < 2) return { action: 'start', panes: [fromId, newId] };
    if (panes.length >= max) return { action: 'full' };
    return { action: 'add', panes: [...panes, newId] };
  },

  // The containers a link can go to from a tab in `currentPartition`: the others, by name. Pure.
  containerChoices(choices, currentPartition) {
    return (choices || []).filter(c => c && c.partition && c.partition !== currentPartition).map(c => ({ name: String(c.name || c.id || c.partition), partition: c.partition }));
  },

  // A link taken out of a Tor, proxy or disposable tab into another cookie jar or a private window loads from the direct
  // connection. A private window's own tabs stay private (their container is forced), so they need no question.
  leavesRoute(webview) {
    const policy = window.VexTabPolicy;
    return !!policy && !policy.isPrivateWindow && !!webview && !policy.canReadWebview(webview);
  },
  async confirmLeave(webview) {
    if (!this.leavesRoute(webview)) return true;
    return window.vexConfirm({
      title: 'Open this link outside the protected tab?',
      message: 'This tab goes through Tor or a proxy, or is disposable. The link would load from your direct connection in another container or a private window.',
      okLabel: 'Open it anyway',
    });
  },

  _from(webview, isTab) {
    return isTab && webview && webview.dataset ? TabManager.tabs.find(t => String(t.id) === String(webview.dataset.tabId)) || TabManager.getActiveTab() : TabManager.getActiveTab();
  },
  _open(url, from, activate, partition) {
    return TabManager.createTab(url, activate, (from && from.groupId) || null,
      { partition: partition || (from && from.partition) || undefined, openerTabId: from ? from.id : null, allowDuplicate: true });
  },

  openInBackground(url, from) {
    if (!this.webLink(url)) throw new Error('That link is not a web address');
    this._open(url, from, false);
    window.showToast?.('Opened in the background');
  },
  openInContainer(url, partition, from) {
    if (!this.webLink(url)) throw new Error('That link is not a web address');
    this._open(url, from, true, partition);
    window.showToast?.('Opened in that container');
  },
  openInSplit(url, from) {
    if (!this.webLink(url)) throw new Error('That link is not a web address');
    if (typeof SplitScreen === 'undefined') throw new Error('Split view is not available in this window');
    if (!from) throw new Error('There is no tab in front to put the link beside');
    // Refuse before opening anything when the split is already full.
    if (SplitScreen.active && SplitScreen.panes.length >= this.MAX_PANES) { window.showToast?.('Split view is full (4 panes); close one first', 'error'); return; }
    const tab = this._open(url, from, false);
    const plan = this.planSplit({ active: SplitScreen.active, panes: SplitScreen.panes, fromId: from.id, newId: tab.id });
    if (plan.action === 'start') {
      if (!SplitScreen.restore(plan.panes, 0.5)) throw new Error('The split could not be started');
    } else if (plan.action === 'add') SplitScreen.addPane(tab.id);
  },
  async openInPrivateWindow(url) {
    if (!this.webLink(url)) throw new Error('That link is not a web address');
    if (typeof VexIncognito === 'undefined') throw new Error('A private window is not available in this build');
    return VexIncognito.open(url);
  },

  // The rows for the link menu. `isTab`: the page is a tab (not a side panel).
  menuItems(url, webview, isTab) {
    if (!this.webLink(url)) return [];
    const from = this._from(webview, isTab);
    const fail = (what) => (err) => { window.VexProblems?.note('Open link', what, err); window.showToast?.((err && err.message) || ('Could not ' + what), 'error'); };
    const run = (what, fn, guarded) => () => { (async () => { if (guarded && !(await this.confirmLeave(webview))) return; await fn(); })().catch(fail(what)); };
    const rows = { top: [], more: [] };
    let choices = [];
    try {
      if (typeof VexContainerMemory !== 'undefined') choices = this.containerChoices(VexContainerMemory.choices(), (from && from.partition) || (webview && webview.getAttribute && webview.getAttribute('partition')) || 'persist:main');
    } catch (err) { window.VexProblems?.note('Open link', 'the container list could not be read', err); }
    if (choices.length) {
      rows.top.push({ label: 'Open Link in Container', icon: 'layers', sub: choices.map(c => ({ label: c.name, action: run('open the link in that container', () => this.openInContainer(url, c.partition, from), true) })) });
    }
    rows.more.push({ label: 'Open Link in Split View', action: run('open the link in split view', () => this.openInSplit(url, from)) });
    rows.more.push({ label: 'Open Link in Private Window', action: run('open the link in a private window', () => this.openInPrivateWindow(url), true) });
    rows.more.push({ label: 'Open Link in Background', action: run('open the link in the background', () => this.openInBackground(url, from)) });
    return [...rows.top, ...rows.more];
  },
};

if (typeof window !== 'undefined') window.VexLinkOpen = VexLinkOpen;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexLinkOpen };
