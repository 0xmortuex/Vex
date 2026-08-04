// === Vex Agent Action Executor ===
//
// Runs one agent tool call. Interaction tools (click, type, select, scroll,
// press_key) go through AgentCDP so the page receives trusted events; if the
// CDP bridge can't attach — DevTools is open on the tab, or the guest hasn't
// finished attaching — each one falls back to the old scripted path so the
// agent degrades instead of dying. The fallbacks use the native-setter trick
// rather than a bare `el.value = x`, because React and Vue overwrite a
// directly-assigned value from their own state on the next render.

// Setting .value directly on a React-controlled input is silently reverted:
// React caches the previous value on the DOM node and its onChange never
// fires. Calling the prototype's native setter updates the node the way the
// browser would, so React's change tracker sees a real edit.
const NATIVE_SET = `
  (el, val) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
                : el instanceof HTMLSelectElement   ? HTMLSelectElement.prototype
                : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) setter.set.call(el, val); else el.value = val;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
`;

const AgentExecutor = {
  // Set false by AgentLoop when CDP attach fails, so we stop retrying it on
  // every single action of a run.
  _cdpOk: true,

  _canCdp() {
    return this._cdpOk && typeof AgentCDP !== 'undefined' && AgentCDP.available();
  },

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

        case 'click': {
          if (this._canCdp()) {
            const r = await AgentCDP.click(wv, params.selector);
            if (r.ok) {
              await new Promise(res => setTimeout(res, 400));
              return { ok: true, result: 'Clicked element (trusted)' };
            }
            // "Element not found" is the page's answer, not a CDP failure —
            // report it rather than retrying with a weaker method.
            if (/not found|zero size|not interactable/i.test(r.error || '')) return { ok: false, error: r.error };
          }
          const clickRes = await wv.executeJavaScript(`
            (() => {
              const el = document.querySelector(${JSON.stringify(params.selector)});
              if (!el) return { ok: false, error: 'Element not found' };
              el.scrollIntoView({ behavior: 'instant', block: 'center' });
              el.click();
              return { ok: true };
            })()
          `);
          await new Promise(r => setTimeout(r, 400));
          return clickRes.ok ? { ok: true, result: 'Clicked element (scripted fallback)' } : clickRes;
        }

        case 'type_text': {
          if (this._canCdp()) {
            const r = await AgentCDP.typeText(wv, params.selector, params.text, !!params.clearFirst);
            if (r.ok) return { ok: true, result: 'Typed text (trusted)' };
            if (/not found|zero size|not interactable/i.test(r.error || '')) return { ok: false, error: r.error };
          }
          const res = await wv.executeJavaScript(`
            (() => {
              const nativeSet = ${NATIVE_SET};
              const el = document.querySelector(${JSON.stringify(params.selector)});
              if (!el) return { ok: false, error: 'Element not found' };
              el.scrollIntoView({ behavior: 'instant', block: 'center' });
              el.focus();
              const next = ${params.clearFirst ? '""' : '(el.value || "")'} + ${JSON.stringify(params.text || '')};
              nativeSet(el, next);
              return { ok: true };
            })()
          `);
          return res.ok ? { ok: true, result: 'Typed text (scripted fallback)' } : res;
        }

        case 'press_key': {
          const key = params.key || 'Enter';
          if (this._canCdp()) {
            const r = await AgentCDP.pressKey(wv, key);
            if (r.ok) {
              await new Promise(res => setTimeout(res, 400));
              return { ok: true, result: 'Pressed ' + key };
            }
            if (/Unsupported key/i.test(r.error || '')) return { ok: false, error: r.error };
          }
          // Without CDP a keypress can only be simulated, and synthetic
          // keydown does not trigger form submission or native shortcuts.
          const res = await wv.executeJavaScript(`
            (() => {
              const el = document.activeElement || document.body;
              const ev = { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true };
              el.dispatchEvent(new KeyboardEvent('keydown', ev));
              el.dispatchEvent(new KeyboardEvent('keyup', ev));
              if (${JSON.stringify(key)} === 'Enter' && el.form) { el.form.requestSubmit?.(); }
              return { ok: true };
            })()
          `);
          await new Promise(r => setTimeout(r, 400));
          return res.ok
            ? { ok: true, result: 'Pressed ' + key + ' (scripted fallback — may not trigger native handlers)' }
            : res;
        }

        case 'select_option': {
          // Native <select> popups are OS-drawn, so there is nothing on the
          // page for CDP to click. The native setter plus input+change is the
          // approach that works across React, Vue, and plain DOM.
          const res = await wv.executeJavaScript(`
            (() => {
              const nativeSet = ${NATIVE_SET};
              const el = document.querySelector(${JSON.stringify(params.selector)});
              if (!el) return { ok: false, error: 'Element not found' };
              const want = ${JSON.stringify(params.value || '')};
              if (el.tagName === 'SELECT') {
                const opts = Array.from(el.options);
                const match = opts.find(o => o.value === want) || opts.find(o => (o.textContent || '').trim() === want);
                if (!match) return { ok: false, error: 'No option matching "' + want + '". Available: ' + opts.map(o => o.value).slice(0, 20).join(', ') };
                nativeSet(el, match.value);
                return { ok: true, selected: match.value };
              }
              nativeSet(el, want);
              return { ok: true, selected: want };
            })()
          `);
          return res.ok ? { ok: true, result: 'Selected: ' + (res.selected || params.value) } : res;
        }

        case 'scroll': {
          const dir = params.direction || 'down';
          if (this._canCdp()) {
            const r = await AgentCDP.scroll(wv, dir, params.amount);
            if (r.ok) return { ok: true, result: 'Scrolled ' + dir };
          }
          const amt = params.amount || 500;
          await wv.executeJavaScript(
            dir === 'top' ? 'window.scrollTo({top:0})' :
            dir === 'bottom' ? 'window.scrollTo({top:document.body.scrollHeight})' :
            dir === 'up' ? `window.scrollBy({top:-${amt}})` :
            `window.scrollBy({top:${amt}})`
          );
          return { ok: true, result: 'Scrolled ' + dir };
        }

        case 'extract_elements': {
          const data = await DOMExtractor.extractInteractiveElements(wv);
          return { ok: true, result: data };
        }

        case 'accessibility_tree': {
          if (typeof AXSnapshot === 'undefined') return { ok: false, error: 'AX snapshot unavailable' };
          const snap = await AXSnapshot.capture(wv);
          if (!snap.ok) return snap;
          return { ok: true, result: snap.text + (snap.truncated ? '\n… (tree truncated)' : '') };
        }

        case 'extract_text': {
          const sel = params.selector || 'article, main, [role="main"], body';
          const text = await wv.executeJavaScript(`
            (() => { const el = document.querySelector(${JSON.stringify(sel)}) || document.body; return el.innerText.substring(0, 15000); })()
          `);
          return { ok: true, result: text };
        }

        case 'screenshot': {
          // Previously this captured a screenshot and then discarded it,
          // returning only { hasScreenshot: true } — the model never saw a
          // single pixel. Now the image rides back with the result so the
          // agent loop can attach it to the next request.
          if (this._canCdp()) {
            const shot = await AgentCDP.screenshot(wv);
            if (shot.ok && shot.data) {
              return {
                ok: true,
                result: 'Screenshot captured — see the attached image.',
                image: { data: shot.data, mediaType: shot.mediaType },
              };
            }
          }
          try {
            const img = await wv.capturePage();
            const dataUrl = img.toJPEG(70).toString('base64');
            return {
              ok: true,
              result: 'Screenshot captured — see the attached image.',
              image: { data: dataUrl, mediaType: 'image/jpeg' },
            };
          } catch (err) {
            return { ok: false, error: 'Screenshot failed: ' + err.message };
          }
        }

        case 'list_tabs': {
          const tabs = TabManager.tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.id === TabManager.activeTabId }));
          return { ok: true, result: tabs };
        }

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

        case 'search_in_page': {
          const found = await wv.executeJavaScript(`
            (() => { const t = document.body.innerText; const i = t.toLowerCase().indexOf(${JSON.stringify((params.query || '').toLowerCase())}); return i >= 0 ? { found: true, excerpt: t.substring(Math.max(0,i-100), i+200) } : { found: false }; })()
          `);
          return { ok: true, result: found };
        }

        case 'finish':
          return { ok: true, result: { finished: true, summary: params.summary } };

        case 'ask_user':
          return { ok: true, result: { askingUser: true, question: params.question } };

        default:
          // MCP tools surface as "mcp__<serverId>__<toolName>" — route them to
          // the connected MCP server. Kept out of the switch so the built-in
          // tool set is untouched.
          if (typeof toolName === 'string' && toolName.startsWith('mcp__') && typeof McpClient !== 'undefined') {
            const out = await McpClient.agentCall(toolName, params);
            return { ok: true, result: out };
          }
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
