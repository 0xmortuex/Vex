// === Vex Multi-Tab Context Extraction ===

const MultiTabContext = {
  async extractContextFromTabs(tabs, opts = {}) {
    const maxPerTab = opts.maxCharsPerTab || 8000;
    const totalBudget = 60000;
    const perTabBudget = Math.min(maxPerTab, Math.floor(totalBudget / Math.max(tabs.length, 1)));

    return Promise.all(tabs.map(async (tab) => {
      try {
        if (tab.sleeping || tab._lazy) {
          return { tabId: tab.id, title: tab.title, url: tab.url, text: '(Tab sleeping — not loaded)', sleeping: true };
        }
        const wv = WebviewManager.webviews.get(tab.id);
        if (!wv) {
          return { tabId: tab.id, title: tab.title, url: tab.url, text: '(Tab not loaded)', unloaded: true };
        }
        const ctx = await PageContext.extractPageContext(wv);
        return {
          tabId: tab.id,
          title: ctx?.title || tab.title,
          url: ctx?.url || tab.url,
          text: (ctx?.text || '').substring(0, perTabBudget),
          headings: ctx?.headings || []
        };
      } catch (err) {
        return { tabId: tab.id, title: tab.title, url: tab.url, text: '(Error: ' + err.message + ')', error: true };
      }
    }));
  },

  formatForAI(contexts) {
    return contexts.map((c, i) =>
      `--- TAB ${i + 1}: ${c.title} ---\nURL: ${c.url}\n\n${c.text}\n`
    ).join('\n\n');
  }
};
