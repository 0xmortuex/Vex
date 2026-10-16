// === Study helpers (Wave 3): the one Settings section, the commands, the right-click rows ==
//
// Nine small tools, each its own file and each switchable on its own:
//   js/study-glossary.js    glossary harvest and hover cards              (T3-027)
//   js/study-ledger.js      study time by subject                         (T3-029)
//   js/cheat-sheet.js       cheat sheet from tagged highlights            (T3-044)
//   js/draft-check.js       claims in a draft against your own sources    (T3-104)
//   js/syllabus-check.js    syllabus topics against your notes            (T3-106)
//   js/source-badge.js      rough source-quality flags for a page         (T3-115)
//   js/mun-toolkit.js       procedure card, templates, clause diff        (T3-028)
//   js/speech-timer.js      speech timer and speakers list                (T3-076)
//   js/turkish-helpers.js   Turkish dictionary and typing helpers         (T3-049)
// (Learner reading aids, T3-034, are in js/accessibility.js beside the font and ruler.)
//
// This file draws their one Settings section "Study helpers", registers their Ctrl+K commands
// and hands js/webview.js their right-click rows. Every tool registers with VexUsage
// (js/vex-usage-registry.js) so Minimal Vex can switch it off and put it back.
//
// Load order: after js/vex-settings-groups.js, js/vex-extras.js and the nine files above,
// before js/vex-usage-registry.js.
const VexStudyExtras = {
  TOOLS() {
    const pick = (x) => (typeof x !== 'undefined' ? x : null);
    return [
      { id: 'study-glossary', title: 'Glossary', mod: pick(typeof VexStudyGlossary !== 'undefined' ? VexStudyGlossary : null) },
      { id: 'study-ledger', title: 'Study time', mod: pick(typeof VexStudyLedger !== 'undefined' ? VexStudyLedger : null) },
      { id: 'cheat-sheet', title: 'Cheat sheet', mod: pick(typeof VexCheatSheet !== 'undefined' ? VexCheatSheet : null) },
      { id: 'draft-check', title: 'Draft check', mod: pick(typeof VexDraftCheck !== 'undefined' ? VexDraftCheck : null) },
      { id: 'syllabus-check', title: 'Syllabus coverage', mod: pick(typeof VexSyllabusCheck !== 'undefined' ? VexSyllabusCheck : null) },
      { id: 'source-badge', title: 'Source check', mod: pick(typeof VexSourceBadge !== 'undefined' ? VexSourceBadge : null) },
      { id: 'mun-toolkit', title: 'MUN toolkit', mod: pick(typeof VexMunToolkit !== 'undefined' ? VexMunToolkit : null) },
      { id: 'speech-timer', title: 'Speech timer', mod: pick(typeof VexSpeechTimer !== 'undefined' ? VexSpeechTimer : null) },
      { id: 'turkish-helpers', title: 'Turkish helpers', mod: pick(typeof VexTurkishHelpers !== 'undefined' ? VexTurkishHelpers : null) },
    ].filter(t => t.mod);
  },

  renderSettings(body) {
    const note = document.createElement('p');
    note.className = 'setting-info muted';
    note.textContent = 'Small tools for studying. Each can be switched off here. They work on this computer; nothing is sent anywhere unless a tool says it opens a web page when you click.';
    body.appendChild(note);
    for (const t of this.TOOLS()) {
      const box = document.createElement('div');
      box.style.cssText = 'border-top:1px solid var(--border);padding-top:8px;margin-top:8px';
      const head = document.createElement('label');
      head.style.cssText = 'display:flex;gap:8px;align-items:center;font-weight:600';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!t.mod.enabled();
      cb.setAttribute('aria-label', t.title + ' on or off');
      cb.addEventListener('change', () => { try { t.mod.setEnabled(cb.checked); } catch (err) { console.error('[StudyExtras] switch failed:', err); cb.checked = !cb.checked; window.showToast?.(err.message, 'error'); } });
      head.append(cb, document.createTextNode(t.title));
      box.appendChild(head);
      try { t.mod.group(box); }
      catch (err) {
        console.error('[StudyExtras] a tool could not draw its settings:', err);
        box.appendChild(document.createTextNode('This tool could not be shown: ' + ((err && err.message) || err)));
      }
      body.appendChild(box);
    }
  },

  // Rows for selected text (js/webview.js asks for them next to the developer helpers').
  textItems(selection, webview, opts) {
    const items = [];
    const sel = String(selection == null ? '' : selection).trim();
    if (!sel) return items;
    const safe = (fn) => () => { Promise.resolve().then(fn).catch((e) => window.showToast?.((e && e.message) || 'That did not work', 'error')); };
    if (typeof VexStudyGlossary !== 'undefined' && VexStudyGlossary.enabled() && !(opts && opts.editable) && sel.length <= 80 && sel.split(/\s+/).length <= 6) {
      items.push({ label: 'Add to glossary...', action: safe(() => VexStudyGlossary.addSelection(webview, sel)) });
    }
    if (typeof VexTurkishHelpers !== 'undefined') items.push(...VexTurkishHelpers.textItems(sel, webview, opts || {}));
    return items;
  },
  // Rows for the Page submenu.
  pageItems(webview) {
    const items = [];
    const safe = (fn) => () => { Promise.resolve().then(fn).catch((e) => window.showToast?.((e && e.message) || 'That did not work', 'error')); };
    if (typeof VexStudyGlossary !== 'undefined' && VexStudyGlossary.enabled()) items.push({ label: 'Find terms on this page', action: safe(() => VexStudyGlossary.harvestFromPage(webview)) });
    if (typeof VexSourceBadge !== 'undefined' && VexSourceBadge.enabled()) items.push({ label: 'Source check (rough)', action: safe(() => VexSourceBadge.open(webview)) });
    return items;
  },

  commands() {
    const fail = (e) => window.showToast?.((e && e.message) || 'That did not work', 'error');
    const go = (fn) => () => { Promise.resolve().then(fn).catch(fail); };
    const on = (m) => !m || m.enabled();
    const wv = () => (typeof WebviewManager !== 'undefined' ? WebviewManager.getActiveWebview() : null);
    return [
      { id: 'study-glossary', label: 'Glossary', hint: 'Terms you confirmed, per subject, with hover cards on pages', icon: 'book', action: go(() => { if (!on(typeof VexStudyGlossary !== 'undefined' && VexStudyGlossary)) throw new Error('The glossary is switched off in Settings'); VexStudyGlossary.openScreen(); }) },
      { id: 'study-glossary-harvest', label: 'Find terms on this page', hint: 'Definitions on the page or in your selection, for your glossary', icon: 'book', action: go(() => { if (typeof VexStudyGlossary === 'undefined' || !VexStudyGlossary.enabled()) throw new Error('The glossary is switched off in Settings'); return VexStudyGlossary.harvestFromPage(wv()); }) },
      { id: 'study-ledger', label: 'Study time', hint: 'A timer and this week\'s minutes per subject', icon: 'timer', action: go(() => { if (typeof VexStudyLedger === 'undefined' || !VexStudyLedger.enabled()) throw new Error('Study time is switched off in Settings'); VexStudyLedger.openScreen(); }) },
      { id: 'cheat-sheet', label: 'Cheat sheet from highlights', hint: 'Gather highlights tagged #formula (or any tag) into one note', icon: 'list', action: go(() => { if (typeof VexCheatSheet === 'undefined' || !VexCheatSheet.enabled()) throw new Error('The cheat sheet is switched off in Settings'); VexCheatSheet.open(); }) },
      { id: 'draft-check', label: 'Check a draft', hint: 'Which claims in a note your saved sources support. Never rewrites', icon: 'check', action: go(() => { if (typeof VexDraftCheck === 'undefined' || !VexDraftCheck.enabled()) throw new Error('The draft check is switched off in Settings'); return VexDraftCheck.open(); }) },
      { id: 'syllabus-check', label: 'Syllabus coverage', hint: 'Paste a topic list; see covered, thin and missing', icon: 'list', action: go(() => { if (typeof VexSyllabusCheck === 'undefined' || !VexSyllabusCheck.enabled()) throw new Error('The syllabus check is switched off in Settings'); VexSyllabusCheck.open(); }) },
      { id: 'source-badge', label: 'Source check (rough)', hint: 'Plain flags about this page: address kind, age, author, https, outside links', icon: 'shield', action: go(() => { if (typeof VexSourceBadge === 'undefined' || !VexSourceBadge.enabled()) throw new Error('The source check is switched off in Settings'); return VexSourceBadge.open(wv()); }) },
      { id: 'mun-toolkit', label: 'MUN toolkit', hint: 'Procedure card, motions, templates, clause diff, checklists', icon: 'flag', action: go(() => { if (typeof VexMunToolkit === 'undefined' || !VexMunToolkit.enabled()) throw new Error('The MUN toolkit is switched off in Settings'); VexMunToolkit.open(); }) },
      { id: 'mun-motion', label: 'Motion wording', hint: 'The usual wording of a motion, to copy', icon: 'flag', action: go(() => { if (typeof VexMunToolkit === 'undefined' || !VexMunToolkit.enabled()) throw new Error('The MUN toolkit is switched off in Settings'); VexMunToolkit.open('motions'); }) },
      { id: 'speech-timer', label: 'Speech timer', hint: 'A small timer with 30/60/90/120 s presets and a speakers list', icon: 'clock', action: go(() => VexSpeechTimer.open()) },
      { id: 'turkish-helpers', label: 'Turkish helpers', hint: 'Put Turkish letters back, a small dictionary, formal letters', icon: 'type', action: go(() => { if (typeof VexTurkishHelpers === 'undefined' || !VexTurkishHelpers.enabled()) throw new Error('The Turkish helpers are switched off in Settings'); VexTurkishHelpers.open(); }) },
    ];
  },
};

if (typeof window !== 'undefined') {
  window.VexStudyExtras = VexStudyExtras;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'study-helpers',
      title: 'Study helpers',
      keywords: 'study glossary term hover card ledger subject time cheat sheet highlight draft essay claim evidence syllabus coverage source quality mun model un procedure speech timer speakers turkish dictionary tdk deasciify letters dilekce',
      before: 'about',
      render: (body) => VexStudyExtras.renderSettings(body),
    });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    for (const c of VexStudyExtras.commands()) VexExtras.registerCommand(c);
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexStudyExtras };
