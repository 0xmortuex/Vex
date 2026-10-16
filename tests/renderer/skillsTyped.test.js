// @vitest-environment jsdom
//
// T2-012: js/skills.js variables, typed outputs, site binding, versions, import, and
// the per-site standing instruction.
import { describe, it, expect, beforeEach, vi } from 'vitest';

globalThis.vexId = (p) => p + Math.random().toString(36).slice(2, 8);
const { VexSkills: S } = require('../../src/renderer/js/skills.js');

beforeEach(() => {
  localStorage.clear();
  S.skills = [];
  delete globalThis.vexConfirm;
});

describe('variables', () => {
  it('finds them, fills them, and refuses an unknown or empty one', () => {
    const v = S.findVariables('Reply to {{selection}} on {{host}} about {{ask:Which topic?}}');
    expect(v.map(x => x.name)).toEqual(['selection', 'host', 'ask']);
    expect(S.fill('Hi {{selection}} at {{ask:Which topic?}}', { selection: 'S', ask: { 'Which topic?': 'cats' } })).toBe('Hi S at cats');
    expect(() => S.findVariables('{{nope}}')).toThrow(/Unknown variable/);
    expect(() => S.findVariables('{{ask:}}')).toThrow(/needs a question/);
    expect(() => S.findVariables('{{url:x}}')).toThrow(/no argument/);
  });
});

describe('typed answers', () => {
  it('parses a checklist, a table, a note and a reminder; raises on the wrong shape', () => {
    expect(S.parseChecklist('- [ ] one\n- [x] two\n3. three')).toEqual([{ text: 'one', done: false }, { text: 'two', done: true }, { text: 'three', done: false }]);
    expect(() => S.parseChecklist('just words')).toThrow(/not a checklist/);
    const t = S.parseTable('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(t).toEqual({ head: ['a', 'b'], rows: [['1', '2']] });
    expect(S.tableMarkdown(t)).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(() => S.parseTable('nothing')).toThrow(/not a table/);
    expect(S.parseNote('# Title here\n\nBody line')).toEqual({ title: 'Title here', content: 'Body line' });
    expect(S.parseReminder('ok {"message":"Call Ana","when":"tomorrow 9am"}')).toEqual({ message: 'Call Ana', when: 'tomorrow 9am' });
    expect(() => S.parseReminder('no')).toThrow(/not a reminder/);
  });
  it('each output has its own instruction, text has none', () => {
    expect(S.formatSuffix('text')).toBe('');
    expect(S.formatSuffix('checklist')).toMatch(/- \[ \]/);
    expect(S.formatSuffix('reminder')).toMatch(/"when"/);
  });
});

describe('sites, versions, import', () => {
  it('offers a skill on the bound site and its subdomains only', () => {
    S.skills = [{ id: 'a', name: 'A', prompt: 'p', sites: ['github.com'] }, { id: 'b', name: 'B', prompt: 'p' }];
    expect(S.skillsForSite('https://gist.github.com/x').map(s => s.id)).toEqual(['a']);
    expect(S.skillsForSite('https://example.com/').length).toBe(0);
  });
  it('keeps the last ten wordings', () => {
    const sk = { prompt: 'v0' };
    for (let i = 1; i <= 12; i++) S.pushVersion(sk, 'v' + i), (sk.prompt = 'v' + i);
    expect(sk.versions).toHaveLength(10);
    expect(sk.versions[0].prompt).toBe('v11');
    expect(S.pushVersion(sk, sk.prompt)).toBe(false);
  });
  it('export then import round-trips; import checks every prompt and shows it first', async () => {
    S.skills = [{ id: 'a', name: 'Triage', icon: 'check', prompt: 'List tasks in {{selection}}', output: 'checklist', sites: ['github.com'] }];
    const text = S.exportText();
    S.skills = [];
    globalThis.vexConfirm = vi.fn(async () => true);
    S.save = () => true;
    expect(await S.importFrom(text)).toBe(1);
    expect(S.skills[0]).toMatchObject({ name: 'Triage', output: 'checklist', sites: ['github.com'], imported: true });
    expect(globalThis.vexConfirm.mock.calls[0][0].html).toContain('List tasks in');
  });
  it('imports nothing on a no, and refuses a bad file', async () => {
    const text = JSON.stringify({ vexSkills: 1, skills: [{ name: 'X', prompt: 'p' }] });
    globalThis.vexConfirm = vi.fn(async () => false);
    S.save = () => true;
    expect(await S.importFrom(text)).toBe(0);
    expect(S.skills).toHaveLength(0);
    expect(() => S.parseImport('{"vexSkills":1,"skills":[{"name":"X","prompt":"{{bad}}"}]}')).toThrow(/Unknown variable/);
    expect(() => S.parseImport('nope')).toThrow(/not an exported/);
  });
});

describe('site instructions', () => {
  it('apply on the host and its subdomains, with history and an off switch', () => {
    S.setSiteInstruction('github.com', 'Answer as a code reviewer');
    S.setSiteInstruction('github.com', 'Answer as a strict code reviewer');
    const hit = S.siteInstructionFor('https://gist.github.com/a');
    expect(hit.host).toBe('github.com');
    expect(hit.versions.map(v => v.text)).toEqual(['Answer as a code reviewer']);
    const m = S.siteInstructionMessage('https://github.com/x/y');
    expect(m.content).toMatch(/strict code reviewer/);
    expect(m.vexMemory).toBe(true);
    expect(S.siteInstructionMessage('https://example.com/')).toBeNull();
    S.setSiteInstructionOn('github.com', false);
    expect(S.siteInstructionMessage('https://github.com/x')).toBeNull();
    S.setSiteInstructionOn('github.com', true);
    S.setSiteEnabled(false);
    expect(S.siteInstructionMessage('https://github.com/x')).toBeNull();
  });
  it('the most specific host wins; limits and bad input raise', () => {
    S.setSiteInstruction('example.com', 'general');
    S.setSiteInstruction('docs.example.com', 'docs only');
    expect(S.siteInstructionFor('https://docs.example.com/a').host).toBe('docs.example.com');
    expect(() => S.setSiteInstruction('not a site', 'x')).toThrow(/does not look like a site/);
    expect(() => S.setSiteInstruction('a.com', '  ')).toThrow(/Write the instruction/);
    expect(() => S.setSiteInstruction('a.com', 'x'.repeat(1001))).toThrow(/at most/);
  });
  it('a damaged record raises', () => {
    localStorage.setItem('vex.siteInstructions', 'oops');
    expect(() => S.siteInstructionFor('https://a.com')).toThrow(/damaged/);
  });
});
