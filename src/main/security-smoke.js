// Invoked only by the isolated smoke harness, never in normal browsing.
const assert = require('assert/strict');
const fs = require('fs/promises');
async function run({ mainWindow, security, userData }) {
  await mainWindow.webContents.executeJavaScript('window.vex.openPrivateWindow()');
  const host = [...security.hosts.values()].find(h => h.privatePartition);
  assert(host, 'Private window registered');
  const wc = host.win.webContents;
  const deadline = Date.now() + 15000;
  let id;
  while (Date.now() < deadline) {
    try {
      id = await wc.executeJavaScript(`(async()=>{
        if(typeof TabManager==='undefined'||!TabManager.tabs.length||!window.vex)return null;
        const wv=document.querySelector('webview');
        if(!wv)return null;
        try{return wv.getWebContentsId()}catch{return null}
      })()`);
      if (id > 0) break;
    } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  assert(id > 0, 'Private guest attached');
  const { webContents } = require('electron');
  assert.equal(security.partitionOf(webContents.fromId(id)), host.privatePartition, 'Guest uses ephemeral partition');
  assert.equal(wc.session, webContents.fromId(id).session, 'Host and guest share private session');
  const secret = 'vex-private-smoke-' + Date.now();
  assert.equal(await wc.executeJavaScript(`(async()=>{await window.vex.saveData('privacySmoke',${JSON.stringify(secret)});return await window.vex.loadData('privacySmoke')})()`), secret);
  assert.equal(await mainWindow.webContents.executeJavaScript("window.vex.loadData('privacySmoke')"), null, 'Normal window cannot read private storage');
  // A private host cannot act on a guest owned by another host.
  const normalId = await mainWindow.webContents.executeJavaScript("document.querySelector('webview').getWebContentsId()");
  assert.equal(security.ownsTarget({ sender: wc }, normalId), false);
  host.allowClose = true;
  host.win.close();
  async function inspect(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = require('path').join(dir, entry.name);
      if (entry.isDirectory()) await inspect(file);
      else if (entry.name.endsWith('.json')) {
        const bytes = await fs.readFile(file).catch(() => Buffer.alloc(0));
        assert(!bytes.includes(Buffer.from(secret)), 'Private value must not reach profile JSON');
      }
    }
  }
  await inspect(userData);
  return 'private-session/storage/ownership passed';
}
module.exports = { run };
