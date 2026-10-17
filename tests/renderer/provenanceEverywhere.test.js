// @vitest-environment jsdom
//
// T3-107: every place that shows text a model wrote carries the provenance chip. A new file that calls
// the AI router and is not on the list below, and does not use the chip, fails here: so a missing label
// is seen by the person who added the call, not by a user.
import { describe, it, expect, beforeEach } from 'vitest';
const fs = require('fs');
const path = require('path');

const JS = path.resolve(__dirname, '../../src/renderer/js');
const read = (f) => fs.readFileSync(path.join(JS, f), 'utf8');

// Files that call the router and show nothing a model wrote, or hand it to a file that carries the chip.
const NOT_A_SURFACE = {
  'agent-loop.js': 'its final answer is stored on the chat message and the AI panel draws the chip (ai-panel.js _agentBackend)',
  'agent-model-test.js': 'a settings self-test that prints pass or fail, not model prose',
  'ai-restyle.js': 'the model writes CSS that is applied as a Boost, which is listed and editable; no prose is shown',
  'history-indexer.js': 'stores summaryBy on the history entry; history-panel.js draws the chip',
  'longdoc-engine.js': 'an engine; thread-digest.js shows its output with the chip',
  'project-compiler.js': 'the document it saves carries its own "written by <model>" footer (assemble)',
  'tab-ai-media.js': 'turns a sentence into tab commands that are shown as actions, not as prose',
  'tab-grouper.js': 'proposes group names that the person confirms in the grouper dialog',
  'vencord-bridge.js': 'returns text to comms-tools-ui.js, which shows it with the chip',
};

describe('every AI output surface carries the chip', () => {
  const callers = fs.readdirSync(JS).filter(f => f.endsWith('.js') && /AIRouter\.(callAI|callOn|localAgent)\(/.test(read(f)));

  it('finds the callers at all', () => { expect(callers.length).toBeGreaterThan(20); });

  it.each(callers)('%s uses VexProvenance or says why it is not a surface', (f) => {
    if (NOT_A_SURFACE[f]) { expect(NOT_A_SURFACE[f].length).toBeGreaterThan(20); return; }
    expect(read(f), f + ' calls the AI router and shows text without a provenance chip').toMatch(/VexProvenance/);
  });

  it('the files named as the place the chip is drawn really use it', () => {
    for (const f of ['ai-panel.js', 'history-panel.js', 'thread-digest.js', 'comms-tools-ui.js']) expect(read(f), f).toMatch(/VexProvenance/);
  });

  it('the list does not keep a file that no longer calls the router', () => {
    for (const f of Object.keys(NOT_A_SURFACE)) expect(callers, f).toContain(f);
  });
});

describe('the surfaces draw it', () => {
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

  it('a Two models column shows what wrote each side', () => {
    globalThis.VexProvenance = require('../../src/renderer/js/provenance-chip.js').VexProvenance;
    window.escapeHtml = (s) => String(s);
    const { TwoModels } = require('../../src/renderer/js/two-models.js');
    const html = TwoModels._column({ name: 'Cloud', backend: 'cloud', ok: true, text: 'hi', model: 'm1', ms: 1200 }, (s) => s);
    expect(html).toContain('Vex AI');
    const local = TwoModels._column({ name: 'Local', backend: 'local', ok: true, text: 'hi', model: 'llama3.2:3b', ms: 900 }, (s) => s);
    expect(local).toContain('Local AI');
    expect(TwoModels._column({ name: 'Cloud', backend: 'cloud', ok: false, error: 'down', ms: 1 }, (s) => s)).not.toContain('vex-prov-chip');
  });

  it('the morning brief keeps who wrote it', () => {
    globalThis.VexProvenance = require('../../src/renderer/js/provenance-chip.js').VexProvenance;
    const { VexToday } = require('../../src/renderer/js/today.js');
    const now = Date.now();
    localStorage.setItem(VexToday.BRIEF_KEY, JSON.stringify({ day: VexToday._day(now), text: 'Busy day.', at: now, by: 'Local AI · llama3.2:3b' }));
    expect(VexToday.brief(now)).toMatchObject({ text: 'Busy day.', by: 'Local AI · llama3.2:3b' });
    localStorage.setItem(VexToday.BRIEF_KEY, JSON.stringify({ day: VexToday._day(now), text: 'Old brief', at: now }));
    expect(VexToday.brief(now).by).toBe('');
  });
});
