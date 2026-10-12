// The address each of Vex's own pages in a tab stands for: HTTPS-Only's "no
// secure connection" page (the http address with no secure version) and the
// certificate pages (the https address). They are data: pages (main.js,
// _showVexPage), which the tab leaves out of its address by design (reading
// mode's snapshot is one too), so the address bar kept showing the page the
// person came from. The tab asks here (tabs:vex-page-address) and shows the
// answer, as Chrome shows the address of its error pages.
//
// Each tab keeps every page it was shown (Back can return to an older one),
// the most recent MAX_PER_TAB of them.
const MAX_PER_TAB = 50;

function createVexPageAddresses() {
  const pages = new Map();   // webContents id -> Map<data: URL, address>
  return {
    set(contents, dataUrl, url) {
      if (!/^https?:\/\//i.test(String(url))) throw new Error('A Vex page stands for a web address, not ' + String(url).slice(0, 60));
      const id = contents.id;
      let tab = pages.get(id);
      if (!tab) {
        tab = new Map();
        pages.set(id, tab);
        contents.once('destroyed', () => { pages.delete(id); });
      }
      tab.delete(dataUrl);   // most recent last
      tab.set(dataUrl, url);
      if (tab.size > MAX_PER_TAB) tab.delete(tab.keys().next().value);
    },
    // The address of the page the tab shows now, if it is one of Vex's.
    addressOf(contents) {
      const tab = pages.get(contents.id);
      return (tab && tab.get(contents.getURL())) || null;
    },
  };
}

module.exports = { createVexPageAddresses, MAX_PER_TAB };
