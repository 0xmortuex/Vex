// === Plain-language and terms-of-service highlighter (T3-086) =================
//
// Terms of service and privacy policies are long on purpose. This reads the page you are on, marks
// the sentences that most often cost people something they did not expect, and says in one line why
// each one is marked:
//
//   auto-renew        it renews by itself and charges again
//   data sharing      your data goes to partners, advertisers or is sold
//   arbitration       you give up the right to sue, or to join a class action
//   one-sided change  they may change the terms without asking again
//   content licence   they get a broad, lasting licence to what you post
//   tracking          tracking across other sites, profiling, fingerprinting
//   liability         they are not responsible, or a low cap on what they owe
//   termination       they may close your account or remove content at will
//   retention         your data is kept after you leave, or for an unlimited time
//
// The marking is done by patterns in this window; nothing is sent anywhere. "Explain in plain words"
// asks YOUR LOCAL MODEL (Ollama) about one marked sentence, and only that sentence goes to it; with
// no local model running the button says so. It is never sent to the cloud.
// This is a reading aid, NOT legal advice: a clause that is not marked is not a clause that is safe.

const VexTos = {
  NOT_ADVICE: 'A reading aid, not legal advice. A sentence that is not marked is not a sentence that is safe.',
  MAX_TEXT: 400000,
  MAX_FINDINGS: 60,
  EXCERPT: 220,

  // The patterns. Each is a test on ONE sentence; the label is what the person reads.
  RULES: [
    { id: 'auto-renew', label: 'Renews by itself', why: 'It can renew and charge you again unless you cancel in time.',
      re: /\b(auto(?:matically|-)?\s*renew\w*|renew(?:s|ed)?\s+automatically|recurring\s+(?:billing|charge|payment|subscription)|will\s+be\s+charged\s+(?:again|each|every|automatically)|until\s+you\s+cancel|otomatik\s+yenile\w*)/i },
    { id: 'data-sharing', label: 'Shares or sells your data', why: 'Your data may go to other companies, partners or advertisers.',
      re: /\b(sell(?:ing)?\s+(?:your\s+)?(?:personal\s+)?(?:data|information)|share[sd]?\s+(?:your\s+)?(?:personal\s+)?(?:data|information)\s+with|third[- ]part(?:y|ies)\s+(?:partners|advertisers|vendors)|(?:advertising|marketing)\s+partners|affiliates?\s+and\s+(?:partners|subsidiaries)|üçüncü\s+taraf\w*\s+ile\s+paylaş\w*)/i },
    { id: 'arbitration', label: 'Gives up your right to sue', why: 'Disputes go to private arbitration, or you give up joining a class action.',
      re: /\b(binding\s+arbitration|class[- ]action\s+waiver|waive\s+(?:your\s+)?(?:right|rights)\s+to\s+(?:a\s+)?(?:jury|class|sue)|waiver\s+of\s+(?:class|jury)|(?:may\s+not|cannot|will\s+not)\s+(?:bring|join)\s+(?:a\s+)?class\s+action|tahkim)/i },
    { id: 'one-sided-change', label: 'They can change the terms', why: 'The terms can change without asking you again; using the service counts as agreeing.',
      re: /\b((?:we|company)\s+(?:may|can|reserve\s+the\s+right\s+to)\s+(?:modify|change|update|amend|revise)\b[^.]{0,80}\b(?:terms|agreement|policy)[^.]{0,80}\b(?:at\s+any\s+time|without\s+(?:prior\s+)?notice|sole\s+discretion)|continued\s+use\b[^.]{0,60}\b(?:constitutes|means|will\s+be\s+deemed)\s+(?:your\s+)?(?:acceptance|agreement))/i },
    { id: 'content-licence', label: 'Broad licence to what you post', why: 'They get a wide, long-lasting licence to your content.',
      re: /\b((?:perpetual|irrevocable)[^.]{0,80}\b(?:licen[sc]e|right)|(?:worldwide|royalty[- ]free|sublicensable|transferable)[^.]{0,60}\b(?:licen[sc]e)[^.]{0,80}\b(?:content|submissions?|materials?)|licen[sc]e\s+to\s+(?:use|reproduce|modify|distribute)[^.]{0,80}\byour\s+(?:content|submissions?))/i },
    { id: 'tracking', label: 'Tracks you across sites', why: 'Cookies, fingerprints or profiles can follow you beyond this service.',
      re: /\b(track(?:ing)?\s+(?:you|your\s+(?:activity|browsing|behaviou?r))\s+(?:across|on\s+other)|across\s+(?:other\s+)?(?:websites|sites|services|devices)|fingerprint(?:ing)?|cross[- ]device|profil(?:e|ing)\s+(?:of\s+you|based\s+on)|web\s+beacons?|çerez\w*\s+ile\s+takip)/i },
    { id: 'liability', label: 'They are not responsible', why: 'They disclaim responsibility, or cap what they would owe you.',
      re: /\b(as[- ]is|without\s+warrant(?:y|ies)|disclaim\w*\s+(?:all\s+)?warrant\w*|(?:shall|will)\s+not\s+be\s+liable|in\s+no\s+event\s+shall|limitation\s+of\s+liability|total\s+liability\b[^.]{0,80}\b(?:exceed|limited\s+to)|sorumlu\s+değil)/i },
    { id: 'termination', label: 'They can close your account', why: 'They may suspend your account or remove content at their discretion.',
      re: /\b((?:suspend|terminate|disable|deactivate)\s+(?:or\s+(?:suspend|terminate|disable)\s+)?your\s+(?:account|access)[^.]{0,80}\b(?:at\s+any\s+time|without\s+(?:prior\s+)?notice|sole\s+discretion|for\s+any\s+reason)|sole\s+discretion[^.]{0,80}\b(?:terminate|suspend|remove))/i },
    { id: 'retention', label: 'Keeps your data', why: 'Your data may be kept after you leave, or with no stated end.',
      re: /\b(retain\w*\s+(?:your\s+)?(?:data|information)\s+(?:for\s+as\s+long\s+as|after|indefinitely)|indefinite(?:ly)?\s+(?:retain|store|keep)|(?:keep|store)\s+(?:your\s+)?(?:data|information)\s+(?:after|even\s+after)\b[^.]{0,40}\b(?:delete|close|cancel)|data\s+may\s+remain\s+in\s+(?:our\s+)?backups?)/i },
  ],

  // Addresses and titles of the pages this is meant for. A command on any other page still works; this
  // only decides what the command says when the page does not look like terms at all.
  LOOKS_LIKE: /\b(terms(?:[-_ ]of[-_ ](?:service|use|sale))?|tos|privacy(?:[-_ ]policy)?|conditions|user[-_ ]agreement|eula|legal|cookie[-_ ]policy|kullanim|gizlilik|sozlesme|koşullar)\b/i,
  looksLikeTerms(url, title) {
    let path = '';
    try { path = new URL(String(url)).pathname; } catch { path = ''; }
    return this.LOOKS_LIKE.test(path) || this.LOOKS_LIKE.test(String(title || ''));
  },

  // Sentences, in order, with where each begins in the text. Pure.
  sentences(text) {
    const t = String(text == null ? '' : text).slice(0, this.MAX_TEXT);
    const out = [];
    const re = /[^.!?\n]+(?:[.!?]+(?=\s|$)|\n|$)/g;
    let m;
    while ((m = re.exec(t))) {
      const s = m[0].replace(/\s+/g, ' ').trim();
      if (s.length >= 25) out.push({ text: s, index: m.index });
      if (m[0].length === 0) re.lastIndex++;
    }
    return out;
  },

  // -> { findings: [{ id, label, why, excerpt, index }], counts: { id: n }, scanned }
  analyze(text) {
    const findings = [];
    const counts = {};
    const seen = new Set();
    const sents = this.sentences(text);
    for (const s of sents) {
      for (const rule of this.RULES) {
        if (!rule.re.test(s.text)) continue;
        const excerpt = s.text.length > this.EXCERPT ? s.text.slice(0, this.EXCERPT - 1).replace(/\s+\S*$/, '') + '…' : s.text;
        const k = rule.id + '::' + excerpt;
        if (seen.has(k)) continue;
        seen.add(k);
        counts[rule.id] = (counts[rule.id] || 0) + 1;
        if (findings.length < this.MAX_FINDINGS) findings.push({ id: rule.id, label: rule.label, why: rule.why, excerpt, index: s.index });
      }
    }
    return { findings, counts, scanned: sents.length };
  },

  // The script that marks the findings in the page. The sentences are passed as JSON data and only
  // ever searched for in text nodes; the page can read what is marked but nothing here runs its text.
  markScript(findings) {
    const items = findings.map(f => ({ id: f.id, label: f.label, why: f.why, probe: f.excerpt.replace(/…$/, '').slice(0, 80) }));
    return '(' + function (list) {
      const done = [];
      for (const old of document.querySelectorAll('mark[data-vex-tos]')) { const p = old.parentNode; p.replaceChild(document.createTextNode(old.textContent), old); p.normalize(); }
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement && !/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(n.parentElement.tagName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const item of list) {
        const probe = item.probe.replace(/\s+/g, ' ');
        for (const node of nodes) {
          if (!node.parentNode) continue;
          const at = node.nodeValue.replace(/\s+/g, ' ').indexOf(probe);
          if (at < 0 || node.nodeValue !== node.nodeValue.replace(/\s+/g, ' ')) continue;
          const range = document.createRange();
          range.setStart(node, at); range.setEnd(node, Math.min(node.nodeValue.length, at + probe.length));
          const mark = document.createElement('mark');
          mark.setAttribute('data-vex-tos', item.id);
          mark.title = item.label + ': ' + item.why;
          mark.style.cssText = 'background:#ffd54a;color:#1a1a1a;outline:1px solid #b38600;border-radius:2px';
          range.surroundContents(mark);
          done.push(item.id);
          break;
        }
      }
      return done.length;
    }.toString() + ')(' + JSON.stringify(items) + ')';
  },

  async _pageText() {
    if (typeof WebviewManager === 'undefined' || typeof TabManager === 'undefined') throw new Error('Tabs are not loaded');
    const wv = WebviewManager.getActiveWebview?.();
    if (!wv || typeof wv.executeJavaScript !== 'function') throw new Error('There is no page in front to read');
    const tab = TabManager.getActiveTab?.();
    if (window.VexTabPolicy && tab && !window.VexTabPolicy.canRestore(tab)) throw new Error('This is a private tab: it is not read here');
    const text = await Promise.race([
      wv.executeJavaScript('document.body ? document.body.innerText : ""'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('The page did not answer in time')), 4000)),
    ]);
    return { text: String(text || ''), url: tab ? tab.url : '', title: tab ? tab.title : '', wv };
  },

  // Local model only. -> the explanation text.
  async explainLocal(finding, page) {
    if (typeof AIRouter === 'undefined' || typeof AIRouter.callOn !== 'function') throw new Error('The AI router is not loaded');
    if (!AIRouter.getOllamaStatus().available) throw new Error('No local model is running. Start Ollama to have a sentence explained; nothing is sent to the cloud.');
    const out = await AIRouter.callOn('local', 'explain', { selectedText: finding.excerpt, message: 'Explain this sentence from terms of service in plain words in two sentences. Say what it means for the person. Do not give legal advice.', pageContext: { url: page.url || '', title: page.title || '', text: '' } });
    if (!out || out.backend !== 'local') throw new Error('The explanation did not come from the local model, so it was not used');
    let text = String(out.result || '');
    try { const j = JSON.parse(text); text = String(j.explanation || j.reply || text); } catch { /* vex-allow-empty-catch: the model may answer in plain text rather than JSON, and that is used as it is */ }
    if (!text.trim()) throw new Error('The local model returned nothing');
    return text.trim();
  },

  async run() {
    if (!this.enabled()) { window.showToast?.('The terms highlighter is switched off in Settings', 'info'); return null; }
    const page = await this._pageText();
    const result = this.analyze(page.text);
    const marked = await page.wv.executeJavaScript(this.markScript(result.findings));
    this.show(result, page, marked);
    if (typeof VexUsage !== 'undefined') VexUsage.touch('tos-highlighter');
    return result;
  },

  show(result, page, marked) {
    const { body } = VexSettingsGroups.dialog({ id: 'vex-tos', title: 'Unusual terms', sub: this.NOT_ADVICE });
    const looks = this.looksLikeTerms(page.url, page.title);
    if (!result.findings.length) {
      body.appendChild(VexSettingsGroups.note(looks ? 'Nothing here matched the usual patterns (' + result.scanned + ' sentences read). That does not mean it is safe: read it.' : 'This page does not look like terms, and nothing in it matched the patterns (' + result.scanned + ' sentences read).'));
      return;
    }
    body.appendChild(VexSettingsGroups.note(result.findings.length + ' sentence' + (result.findings.length === 1 ? '' : 's') + ' marked in yellow on the page' + (typeof marked === 'number' ? ' (' + marked + ' found on screen)' : '') + '. Hover a mark for why.'));
    for (const f of result.findings) {
      const row = document.createElement('div');
      row.className = 'vexsr-rule';
      const text = document.createElement('span');
      text.className = 'vexsr-host';
      text.style.wordBreak = 'normal';
      const b = document.createElement('strong');
      b.textContent = f.label + ': ';
      text.append(b, document.createTextNode(f.why + ' "' + f.excerpt + '"'));
      const out = document.createElement('div');
      out.className = 'vex-platform-note';
      const ask = VexSettingsGroups.button('Explain in plain words', async () => {
        ask.disabled = true;
        try { out.textContent = await this.explainLocal(f, page); }
        catch (err) { out.textContent = err.message; }
        ask.disabled = false;
      }, { label: 'Explain this sentence in plain words, using your local model' });
      row.append(text, ask);
      body.append(row, out);
    }
  },

  // ---- switch ----------------------------------------------------------------
  KEY: 'vex.tosHighlighter',
  enabled() { try { return localStorage.getItem(this.KEY) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.KEY, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    return !!on;
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Marks the sentences in terms of service and privacy policies that most often cost people something: automatic renewal, data sharing, giving up the right to sue, terms that can change, broad licences, tracking. Press Ctrl+K and choose "Highlight unusual terms" on the page you are reading. ' + this.NOT_ADVICE));
    el.appendChild(VexSettingsGroups.button('Highlight this page', () => { this.run().catch(err => window.showToast?.(err.message, 'error')); }, { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexTos = VexTos;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'tos-highlighter', title: 'Terms of service highlighter', keywords: 'terms of service privacy policy legal highlight auto renew arbitration plain language', before: 'about', build: (el) => VexTos.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'tos-highlight', label: 'Highlight unusual terms', hint: 'Mark auto-renew, data-sharing and other unusual clauses on a terms page. Not legal advice.', icon: 'eye', action: () => { VexTos.run().catch(err => window.showToast?.(err.message, 'error')); } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTos };
