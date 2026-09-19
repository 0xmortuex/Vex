// === Vex Agent Action Executor ===
//
// Runs one tool call for the agent loop and ALWAYS answers { ok, result|error }.
// Page tools act on a <webview> through vexGuestEval (a guest call with a
// deadline); research and Vex-feature tools live in js/agent-tools.js and need
// no page at all.

// Tools that act on the page in front. Everything else works with no page.
const PAGE_TOOLS = ['navigate', 'go_back', 'go_forward', 'reload', 'click', 'click_text', 'type_text', 'press_key', 'select_option', 'scroll', 'extract_elements', 'extract_text', 'screenshot', 'wait', 'search_in_page'];

// The click a page actually listens for. el.click() fires `click` alone, so a
// menu opened on pointerdown/mousedown, or a widget that waits for mouseup,
// never reacted. This is the whole sequence at the element's centre.
const GUEST_CLICK = `
  const __click = (el) => {
    el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const at = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0 };
    for (const type of ['pointerover', 'mouseover', 'pointerdown', 'mousedown']) el.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, { ...at, buttons: 1, pointerId: 1, isPrimary: true }));
    if (typeof el.focus === 'function') { try { el.focus({ preventScroll: true }); } catch {} }
    for (const type of ['pointerup', 'mouseup']) el.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, { ...at, buttons: 0, pointerId: 1, isPrimary: true }));
    el.click();
  };`;

// What a scheduled (unattended) run may do: its own tab, plus research and
// keeping what it found. Nothing that clicks, types, or touches other tabs.
const SCHEDULED_TOOLS = ['navigate', 'go_back', 'go_forward', 'reload', 'scroll', 'extract_elements', 'extract_text', 'screenshot', 'wait', 'search_in_page', 'web_search', 'read_url', 'save_note', 'finish'];

const AgentExecutor = {
  async executeTool(toolName, params, context = {}) {
    params = params || {};
    const wv = context.webview || WebviewManager.getActiveWebview();
    if (context.scheduled && !SCHEDULED_TOOLS.includes(toolName)) {
      return { ok: false, error: 'This tool requires an interactive run: ' + toolName };
    }
    if (context.scheduled && (!context.webview || context.webview.isConnected === false)) return { ok: false, error: 'Scheduled tab was closed' };
    if (wv && window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(wv)) return { ok: false, error: 'Private tabs are excluded from agent access' };
    if (PAGE_TOOLS.includes(toolName) && !wv) return { ok: false, error: 'No page is open — use new_tab first, or a tool that needs no page (web_search, read_url)' };

    try {
      switch (toolName) {
        case 'navigate':
          if (!/^https?:$/.test(new URL(params.url).protocol)) return { ok: false, error: 'Only web URLs are allowed' };
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
          const res = await window.vexGuestEval(wv, `
            (() => { ${GUEST_CLICK}
              const el = document.querySelector(${JSON.stringify(params.selector || '')});
              if (!el) return { ok: false, error: 'Element not found: ' + ${JSON.stringify(params.selector || '')} + ' — call extract_elements for current selectors, or use click_text' };
              __click(el);
              return { ok: true, label: (el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 60) };
            })()
          `);
          await new Promise(r => setTimeout(r, 500));
          return (res && res.ok) ? { ok: true, result: 'Clicked' + (res.label ? ' "' + res.label + '"' : ' element') } : { ok: false, error: (res && res.error) || 'Element not found' };
        }

        // Click by what the button or link SAYS — no selector needed. The
        // closest match wins: exact text, then starts-with, then contains.
        case 'click_text': {
          const res = await window.vexGuestEval(wv, `
            (() => { ${GUEST_CLICK}
              const want = ${JSON.stringify(String(params.text || '').trim().toLowerCase())};
              if (!want) return { ok: false, error: 'click_text needs the text to look for' };
              const nodes = [...document.querySelectorAll('a[href], button, [role="button"], [role="link"], [role="menuitem"], [role="tab"], input[type="submit"], input[type="button"], summary, label, [onclick]')];
              const seen = (el) => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; };
              const label = (el) => (el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().replace(/\\s+/g, ' ').toLowerCase();
              let best = null, score = 0;
              for (const el of nodes) {
                if (!seen(el)) continue;
                const t = label(el); if (!t) continue;
                const s = t === want ? 3 : t.startsWith(want) ? 2 : t.includes(want) ? 1 : 0;
                if (s > score || (s === score && s > 0 && best && t.length < label(best).length)) { best = el; score = s; }
              }
              if (!best) return { ok: false, error: 'Nothing clickable says "' + want + '" — call extract_elements to see what is there' };
              __click(best);
              return { ok: true, label: label(best).slice(0, 60) };
            })()
          `);
          await new Promise(r => setTimeout(r, 500));
          return (res && res.ok) ? { ok: true, result: 'Clicked "' + res.label + '"' } : { ok: false, error: (res && res.error) || 'Nothing matched' };
        }

        // Writing el.value directly never reached React/Vue inputs (they watch
        // the native setter), and "\\n" pressed nothing — so a search box took
        // the text and then nothing happened. Native setter + real input
        // events; submit:true (or a trailing newline) presses Enter.
        case 'type_text': {
          const raw = String(params.text == null ? '' : params.text);
          const submit = params.submit === true || /\n$/.test(raw);
          const text = raw.replace(/\n+$/, '');
          const res = await window.vexGuestEval(wv, `
            (() => {
              const el = document.querySelector(${JSON.stringify(params.selector || '')});
              if (!el) return { ok: false, error: 'Element not found: ' + ${JSON.stringify(params.selector || '')} };
              el.scrollIntoView({ behavior: 'instant', block: 'center' });
              el.focus();
              const text = ${JSON.stringify(text)}, clear = ${params.clearFirst === false ? 'false' : 'true'};
              if (el.isContentEditable) {
                if (clear) { const sel = window.getSelection(); sel.selectAllChildren(el); }
                document.execCommand('insertText', false, text);
              } else {
                const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(proto, 'value');
                const next = (clear ? '' : (el.value || '')) + text;
                if (setter && setter.set) setter.set.call(el, next); else el.value = next;
                el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }
              let submitted = false;
              if (${submit ? 'true' : 'false'}) {
                const key = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
                const went = el.dispatchEvent(new KeyboardEvent('keydown', key));
                el.dispatchEvent(new KeyboardEvent('keypress', key));
                el.dispatchEvent(new KeyboardEvent('keyup', key));
                if (went && el.form) { try { el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit(); submitted = true; } catch {} }
              }
              return { ok: true, inForm: !!el.form, submitted };
            })()
          `);
          if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'Element not found' };
          // No form to submit: a real Enter key is what the page is waiting for.
          if (submit && !res.submitted) this._pressKey(wv, 'Enter');
          if (submit) await new Promise(r => setTimeout(r, 800));
          return { ok: true, result: submit ? 'Typed text and pressed Enter' : 'Typed text' };
        }

        case 'press_key': {
          const key = String(params.key || '').trim();
          if (!this.KEYS[key.toLowerCase()]) return { ok: false, error: 'press_key takes one of: ' + Object.values(this.KEYS).join(', ') };
          this._pressKey(wv, this.KEYS[key.toLowerCase()]);
          await new Promise(r => setTimeout(r, 400));
          return { ok: true, result: 'Pressed ' + this.KEYS[key.toLowerCase()] };
        }

        case 'select_option': {
          const selRes = await window.vexGuestEval(wv, `
            (() => {
              const el = document.querySelector(${JSON.stringify(params.selector || '')});
              if (!el) return { ok: false, error: 'Element not found' };
              const want = ${JSON.stringify(String(params.value == null ? '' : params.value))};
              // By value, or by the text the user sees.
              const opt = [...(el.options || [])].find(o => o.value === want) || [...(el.options || [])].find(o => o.textContent.trim().toLowerCase() === want.toLowerCase());
              if (el.options && !opt) return { ok: false, error: 'No option "' + want + '". Options: ' + [...el.options].map(o => o.textContent.trim()).slice(0, 20).join(' | ') };
              const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
              const v = opt ? opt.value : want;
              if (setter && setter.set && el instanceof HTMLSelectElement) setter.set.call(el, v); else el.value = v;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { ok: true };
            })()
          `);
          return (selRes && selRes.ok) ? { ok: true, result: 'Selected option' } : { ok: false, error: (selRes && selRes.error) || 'Element not found' };
        }

        case 'scroll': {
          const dir = params.direction || 'down';
          const amt = Number.isFinite(Number(params.amount)) ? Math.max(0, Math.min(Number(params.amount), 10000)) : 500;
          await window.vexGuestEval(wv,
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

        case 'extract_text': {
          const sel = params.selector || 'article, main, [role="main"], body';
          const text = await window.vexGuestEval(wv, `
            (() => { const el = document.querySelector(${JSON.stringify(sel)}) || document.body; return (el.innerText || el.textContent || '').substring(0, 15000); })()
          `);
          return { ok: true, result: text };
        }

        // The image rides beside the result, not in it: the loop hands it to
        // the model once, as an image, and never as 200 KB of base64 text.
        case 'screenshot': {
          const shot = await AgentTools.pageImage(wv);
          return { ok: true, result: { hasScreenshot: true, width: shot.width, height: shot.height, note: 'If an image is attached to your next message, it is this screenshot. If none is, this AI backend cannot see images — use extract_text and extract_elements.' }, image: shot.image };
        }

        case 'list_tabs': {
          const tabs = TabManager.tabs.filter(t => !window.VexTabPolicy || window.VexTabPolicy.canPersist(t)).map(t => ({ id: t.id, title: t.title, url: t.url, active: t.id === TabManager.activeTabId, group: t.groupId || null, asleep: !!(t.sleeping || t._lazy) }));
          return { ok: true, result: tabs };
        }

        // Another open tab's text, without switching to it.
        case 'read_tab': {
          const tab = TabManager.tabs.find(t => t.id === params.tabId);
          if (!tab) return { ok: false, error: 'No tab with that id — list_tabs gives the ids' };
          if (window.VexTabPolicy && !window.VexTabPolicy.canPersist(tab)) return { ok: false, error: 'Private tabs are excluded from agent access' };
          const other = WebviewManager.webviews.get(tab.id);
          if (!other || tab.sleeping || tab._lazy) return { ok: false, error: 'That tab is asleep — switch_tab to it first, or read_url its address: ' + tab.url };
          if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(other)) return { ok: false, error: 'Private tabs are excluded from agent access' };
          const text = await window.vexGuestEval(other, `(() => { const el = document.querySelector('article, main, [role="main"]') || document.body; return (el.innerText || el.textContent || '').substring(0, 12000); })()`);
          return { ok: true, result: { title: tab.title, url: tab.url, text } };
        }

        case 'list_tab_groups':
          return { ok: true, result: (TabManager.groups || []).map(g => ({ id: g.id, name: g.name, color: g.color, tabs: TabManager.tabs.filter(t => t.groupId === g.id).length })) };

        case 'rename_tab_group': {
          const renamed = TabManager.renameGroup(params.groupId, params.name);
          return { ok: true, result: 'Renamed group to "' + renamed.name + '"' };
        }

        case 'group_tabs': {
          const made = AgentTools.groupTabs(params.name, params.tabIds, params.color);
          const real = (TabManager.groups || []).find(g => g.id === made.id);
          const count = TabManager.tabs.filter(t => t.groupId === made.id).length;
          if (!real || !count) return { ok: false, error: 'The group was not created' };
          return { ok: true, result: 'Created and verified group "' + real.name + '" with ' + count + ' tab' + (count === 1 ? '' : 's'), undo: { kind: 'group', id: made.id, label: 'the tab group "' + real.name + '"' } };
        }

        case 'switch_tab':
          TabManager.switchTab(params.tabId);
          return { ok: true, result: 'Switched tab' };

        // ---- research: no page needed -----------------------------------
        case 'web_search':
          return { ok: true, result: await AgentTools.webSearch(params.query, params.count) };

        case 'read_url':
          return { ok: true, result: await AgentTools.readUrl(params.url) };

        // ---- Vex's own features ------------------------------------------
        // Everything below CHANGES something, and the model has claimed success
        // for a call that failed. So each one reads the result back before
        // saying it is done.
        case 'save_note': {
          const note = AgentTools.saveNote(params.title, params.content, params.sourceUrl);
          const back = AgentTools.searchNotes(note.title).some(n => n.id === note.id);
          if (!back) return { ok: false, error: 'The note did not save — check Memory panel › Health for the reason' };
          return { ok: true, result: 'Saved and verified the note "' + (note.title || 'Untitled') + '" (Notes panel)', undo: { kind: 'note', id: note.id, label: 'the note "' + (note.title || 'Untitled') + '"' } };
        }

        case 'watch_page': {
          const made = window.PageWatch.watchCurrent(params.when);
          return { ok: true, result: 'Watching: ' + made.said, undo: { kind: 'watch', id: made.watch.id, label: 'the watch on ' + (made.watch.title || made.watch.url) } };
        }

        case 'create_reminder': {
          const made = await AgentTools.createReminder(params.message, params.when);
          return { ok: true, result: 'Reminder set: "' + made.message + '" — ' + made.when, ...(made.id ? { undo: { kind: 'reminder', id: made.id, label: 'the reminder "' + made.message + '"' } } : {}) };
        }

        case 'add_bookmark': {
          const tab = TabManager.tabs.find(t => t.id === TabManager.activeTabId);
          const made = AgentTools.addBookmark(params.url || (tab && tab.url), params.title || (tab && tab.title));
          if (typeof Bookmarks !== 'undefined' && !Bookmarks.has(made.url)) return { ok: false, error: 'The bookmark did not save' };
          return { ok: true, result: made.already ? 'Already bookmarked: ' + made.url : 'Bookmarked and verified ' + made.url, ...(made.already ? {} : { undo: { kind: 'bookmark', id: made.url, label: 'the bookmark for ' + made.url } }) };
        }

        case 'search_notes':
          return { ok: true, result: AgentTools.searchNotes(params.query, params.limit) };

        case 'read_note':
          return { ok: true, result: AgentTools.readNote(params.id) };

        case 'append_note': {
          const added = AgentTools.appendNote(params.id, params.text);
          return { ok: true, result: 'Added ' + added.added + ' characters to "' + added.title + '"' };
        }

        case 'search_bookmarks':
          return { ok: true, result: AgentTools.searchBookmarks(params.query, params.limit) };

        case 'list_reminders':
          return { ok: true, result: await AgentTools.listReminders() };

        case 'search_history':
          return { ok: true, result: AgentTools.searchHistory(params.query, params.limit) };

        case 'start_timer': {
          const t = await AgentTools.startTimer(params.duration, params.label);
          const live = AgentTools.listTimers().find(x => x.id === t.id);
          if (!live) return { ok: false, error: 'The timer did not start' };
          return { ok: true, result: 'Started a ' + t.length + ' timer "' + t.label + '" in Vex — it rings at ' + t.endsAt + ', ' + live.left + ' left (id ' + t.id + ')', undo: { kind: 'timer', id: t.id, label: 'the timer "' + t.label + '"' } };
        }

        case 'list_timers':
          return { ok: true, result: AgentTools.listTimers() };

        case 'cancel_timer': {
          const t = await AgentTools.cancelTimer(params.id);
          return { ok: true, result: 'Cancelled the timer "' + t.label + '"' };
        }

        case 'vex_features':
          return { ok: true, result: AgentTools.vexFeatures(params.query) };

        case 'vex_command': {
          const ran = await AgentTools.vexCommand(params.command);
          return { ok: true, result: 'Ran in Vex: ' + ran.ran + (ran.detail ? ' — ' + ran.detail : '') };
        }

        case 'wait':
          if (params.selector) {
            await window.vexGuestEval(wv, `
              new Promise(r => {
                let poll;
                const finish = value => { clearTimeout(poll); clearTimeout(deadline); r(value); };
                const deadline = setTimeout(() => finish(false), 8000);
                const check = () => {
                  try { if (document.querySelector(${JSON.stringify(params.selector)})) return finish(true); }
                  catch { return finish(false); }
                  poll = setTimeout(check, 200);
                };
                check();
              })
            `, false, 10000);
          } else {
            await new Promise(r => setTimeout(r, Math.min(params.ms || 1000, 10000)));
          }
          return { ok: true, result: 'Waited' };

        case 'search_in_page': {
          const found = await window.vexGuestEval(wv, `
            (() => { const t = document.body.innerText || document.body.textContent || ''; const i = t.toLowerCase().indexOf(${JSON.stringify((params.query || '').toLowerCase())}); return i >= 0 ? { found: true, excerpt: t.substring(Math.max(0,i-100), i+200) } : { found: false }; })()
          `);
          return { ok: true, result: found };
        }

        case 'finish':
          return { ok: true, result: { finished: true, summary: params.summary } };

        case 'hand_over':
          return { ok: true, result: { handOver: true, why: String(params.why || 'This needs you.') } };

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

  // The keys press_key accepts, as Electron names them.
  KEYS: { enter: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape', backspace: 'Backspace', delete: 'Delete', space: 'Space', arrowup: 'Up', up: 'Up', arrowdown: 'Down', down: 'Down', arrowleft: 'Left', left: 'Left', arrowright: 'Right', right: 'Right', pageup: 'PageUp', pagedown: 'PageDown', home: 'Home', end: 'End' },

  // A real key press into the page (a trusted event, unlike a dispatched one).
  _pressKey(wv, keyCode) {
    if (!wv || typeof wv.sendInputEvent !== 'function') return false;
    try {
      wv.sendInputEvent({ type: 'keyDown', keyCode });
      if (keyCode === 'Enter') wv.sendInputEvent({ type: 'char', keyCode: '\r' });
      wv.sendInputEvent({ type: 'keyUp', keyCode });
      return true;
    } catch { return false; }
  },

  _waitForLoad(wv, timeout = 10000) {
    return new Promise(resolve => {
      const onLoad = () => { wv.removeEventListener('did-finish-load', onLoad); clearTimeout(t); resolve(); };
      wv.addEventListener('did-finish-load', onLoad);
      const t = setTimeout(() => { wv.removeEventListener('did-finish-load', onLoad); resolve(); }, timeout);
    });
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = { AgentExecutor, PAGE_TOOLS, SCHEDULED_TOOLS };
