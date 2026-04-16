// === Vex Agent Action Executor ===

const AgentExecutor = {
  async executeTool(toolName, params) {
    const wv = WebviewManager.getActiveWebview();
    const needsWebview = !['new_tab', 'list_tabs', 'switch_tab', 'finish', 'ask_user'].includes(toolName);
    if (needsWebview && !wv) return { ok: false, error: 'No active webview' };

    try {
      switch (toolName) {
        case 'navigate':
          if (typeof wv.loadURL === 'function') wv.loadURL(params.url);
          else wv.src = params.url;
          await this._waitForLoad(wv);
          return { ok: true, result: 'Navigated to ' + params.url };

        case 'new_tab':
          TabManager.createTab(params.url, true);
          return { ok: true, result: 'Opened new tab: ' + params.url };

        case 'close_tab':
          TabManager.closeTab(params.tabId || TabManager.activeTabId);
          return { ok: true, result: 'Closed tab' };

        case 'go_back':
          if (wv.canGoBack()) wv.goBack();
          return { ok: true, result: 'Went back' };

        case 'go_forward':
          if (wv.canGoForward()) wv.goForward();
          return { ok: true, result: 'Went forward' };

        case 'reload':
          wv.reload();
          return { ok: true, result: 'Reloaded' };

        case 'click':
          const clickRes = await wv.executeJavaScript(`
            (() => {
              const el = document.querySelector(${JSON.stringify(params.selector)});
              if (!el) return { ok: false, error: 'Element not found: ${params.selector}' };
              el.scrollIntoView({ behavior: 'instant', block: 'center' });
              el.click();
              return { ok: true };
            })()
          `);
          await new Promise(r => setTimeout(r, 500));
          return clickRes.ok ? { ok: true, result: 'Clicked element' } : clickRes;

        case 'type_text':
          await wv.executeJavaScript(`
            (() => {
              const el = document.querySelector(${JSON.stringify(params.selector)});
              if (!el) return;
              el.focus();
              if (${params.clearFirst ? 'true' : 'false'}) el.value = '';
              el.value = (el.value || '') + ${JSON.stringify(params.text || '')};
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            })()
          `);
          return { ok: true, result: 'Typed text' };

        case 'select_option':
          await wv.executeJavaScript(`
            (() => {
              const el = document.querySelector(${JSON.stringify(params.selector)});
              if (!el) return;
              el.value = ${JSON.stringify(params.value || '')};
              el.dispatchEvent(new Event('change', { bubbles: true }));
            })()
          `);
          return { ok: true, result: 'Selected option' };

        case 'scroll':
          const dir = params.direction || 'down';
          const amt = params.amount || 500;
          await wv.executeJavaScript(
            dir === 'top' ? 'window.scrollTo({top:0})' :
            dir === 'bottom' ? 'window.scrollTo({top:document.body.scrollHeight})' :
            dir === 'up' ? `window.scrollBy({top:-${amt}})` :
            `window.scrollBy({top:${amt}})`
          );
          return { ok: true, result: 'Scrolled ' + dir };

        case 'extract_elements':
          const data = await DOMExtractor.extractInteractiveElements(wv);
          return { ok: true, result: data };

        case 'extract_text':
          const sel = params.selector || 'article, main, [role="main"], body';
          const text = await wv.executeJavaScript(`
            (() => { const el = document.querySelector(${JSON.stringify(sel)}) || document.body; return el.innerText.substring(0, 15000); })()
          `);
          return { ok: true, result: text };

        case 'screenshot':
          try {
            const img = await wv.capturePage();
            return { ok: true, result: { hasScreenshot: true, note: 'Screenshot captured' } };
          } catch { return { ok: true, result: { hasScreenshot: false, note: 'Screenshot failed' } }; }

        case 'list_tabs':
          const tabs = TabManager.tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.id === TabManager.activeTabId }));
          return { ok: true, result: tabs };

        case 'switch_tab':
          TabManager.switchTab(params.tabId);
          return { ok: true, result: 'Switched tab' };

        case 'wait':
          if (params.selector) {
            await wv.executeJavaScript(`
              new Promise(r => { const c = () => document.querySelector(${JSON.stringify(params.selector)}) ? r(true) : setTimeout(c, 200); c(); setTimeout(() => r(false), 8000); })
            `);
          } else {
            await new Promise(r => setTimeout(r, Math.min(params.ms || 1000, 10000)));
          }
          return { ok: true, result: 'Waited' };

        case 'search_in_page':
          const found = await wv.executeJavaScript(`
            (() => { const t = document.body.innerText; const i = t.toLowerCase().indexOf(${JSON.stringify((params.query || '').toLowerCase())}); return i >= 0 ? { found: true, excerpt: t.substring(Math.max(0,i-100), i+200) } : { found: false }; })()
          `);
          return { ok: true, result: found };

        case 'finish':
          return { ok: true, result: { finished: true, summary: params.summary } };

        case 'ask_user':
          return { ok: true, result: { askingUser: true, question: params.question } };

        default:
          return { ok: false, error: 'Unknown tool: ' + toolName };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  _waitForLoad(wv, timeout = 10000) {
    return new Promise(resolve => {
      const onLoad = () => { wv.removeEventListener('did-finish-load', onLoad); clearTimeout(t); resolve(); };
      wv.addEventListener('did-finish-load', onLoad);
      const t = setTimeout(() => { wv.removeEventListener('did-finish-load', onLoad); resolve(); }, timeout);
    });
  }
};
