// @vitest-environment jsdom
//
// Ordinary questions got a canned feature card because one common word ("for",
// "theme", "font", "sync") was enough to match a template (found 2026-09-29).
// A question to the AI must reach the AI; a question about Vex still gets its
// card.
import { describe, it, expect, beforeEach } from 'vitest';
const { GuideTemplates } = require('../../src/renderer/js/guide-templates.js');
const { VexFeatures } = require('../../src/renderer/js/feature-catalog.js');
const { VexGuide } = require('../../src/renderer/js/vex-guide.js');

beforeEach(() => {
  globalThis.VexFeatures = VexFeatures;
  globalThis.GuideTemplates = GuideTemplates;
});

const ORDINARY = [
  'Give me three ideas for dinner',
  'What is this page for?',
  'Explain the theme of this paragraph',
  'What font is this page using?',
  'Summarize this article',
  'Translate this page to French',
  'What does the author think about local elections?',
  'Can you sync these two lists for me?',
  'How should I connect these two ideas in my essay',
  'What is the backend of this website built with?',
  'Is Netflix worth it this year?',
  'Write a poem for my mom',
  'What is the capital of France',
  'Tell me a joke',
  'Explain quantum computing simply',
  'What are the main points here?',
  'Who wrote this?',
  'Is this recipe vegetarian?',
  'Compare the two products on this page',
  'What do the reviews say about the battery?',
  'Rewrite this email to sound friendlier',
  'What does this error message mean?',
  'Find the price of the cheapest plan',
  'List the key dates in this article',
  'What theme does this song explore?',
  'Suggest a font pairing for a wedding invite',
  'Plan a trip for me to Rome',
  'Recommend a good book for me',
  'What should I cook for dinner tonight?',
  'Help me write a cover letter for this job',
  'Check this code for bugs',
  'What is the agent of change in this story?',
  'Explain dark matter',
  "What's the local weather tomorrow?",
  'Why is the sky blue?',
  'Can you make this paragraph shorter',
  'Sort these names for me alphabetically',
  'What can you do about this error?',
];

const ABOUT_VEX = [
  ['what can you do?', 'what-can-vex-do'],
  ['What can Vex do', 'what-can-vex-do'],
  ["it's using all my RAM", 'memory'],
  ['Vex is slow', 'memory'],
  ['free up memory', 'memory'],
  ['I want two accounts on one site', 'two-accounts'],
  ['stop autoplay', 'autoplay'],
  ['block ads', 'ads'],
  ['I keep losing tabs', 'find-a-tab'],
  ['save for later', 'save-for-later'],
  ['how do I set up the AI', 'ai-setup'],
  ['use ollama', 'ai-setup'],
  ['can you do it for me', 'agent'],
  ['how does the agent work', 'agent'],
  ['am I being tracked', 'privacy'],
  ['where are my passwords', 'passwords'],
  ['keyboard shortcut not working', 'shortcut-not-working'],
  ['move to another computer', 'backup'],
  ['sync', 'backup'],
  ['dark mode', 'looks'],
  ['change the theme', 'looks'],
  ['picture in picture', 'video'],
  ['netflix', 'video'],
];

describe('an ordinary question is never a feature card', () => {
  for (const q of ORDINARY) {
    it(q, () => {
      expect(GuideTemplates.match(q)).toBe(null);
      // The panel only shows a card when isAbout says yes and the answer is
      // found; for these the templates must not be what says yes.
      if (VexGuide.isAbout(q)) expect(VexGuide.answer(q).template).toBeUndefined();
    });
  }
});

describe('a question about Vex still gets its card', () => {
  for (const [q, id] of ABOUT_VEX) {
    it(q + ' -> ' + id, () => {
      expect(VexGuide.isAbout(q)).toBe(true);
      const a = VexGuide.answer(q);
      expect(a.found).toBe(true);
      expect(a.template).toBe(id);
    });
  }
});
