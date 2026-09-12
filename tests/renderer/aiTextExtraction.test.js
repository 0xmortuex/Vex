// @vitest-environment jsdom
//
// Two features consume AIRouter.callAI's return value directly and both were
// reading the wrong field:
//
//   AIRestyle._cleanCss  never looked at `.result` (the only field callAI
//                        returns), so EVERY "AI Restyle this site" ended in
//                        "The AI did not return usable CSS" no matter what the
//                        model produced.
//   SelectionAIBar       wrote `.result` straight into the user's text field —
//                        and the local (Ollama) chat prompt asks for JSON, so a
//                        Rewrite/Fix/Shorten pasted {"reply":"..."} into the page.

import { describe, it, expect } from 'vitest';

const { AIRestyle } = require('../../src/renderer/js/ai-restyle.js');
const { SelectionAIBar } = require('../../src/renderer/js/selection-ai-bar.js');
require('../../src/renderer/js/ai-panel.js'); // SelectionAIBar reuses AIPanel._parseResponse
globalThis.AIPanel = require('../../src/renderer/js/ai-panel.js').AIPanel;

describe('AIRestyle._cleanCss', () => {
  it('reads the router result envelope (the bug that broke the whole feature)', () => {
    expect(AIRestyle._cleanCss({ result: 'body{color:red}', backend: 'cloud', model: 'x' }))
      .toBe('body{color:red}');
  });

  it('strips markdown fences', () => {
    expect(AIRestyle._cleanCss({ result: '```css\nbody{color:red}\n```' })).toBe('body{color:red}');
  });

  it('unwraps the local backend JSON envelope', () => {
    expect(AIRestyle._cleanCss({ result: '{"reply":"body{color:red}"}' })).toBe('body{color:red}');
  });

  it('unwraps a fenced stylesheet inside a JSON envelope', () => {
    expect(AIRestyle._cleanCss({ result: '{"reply":"```css\\nbody{color:red}\\n```"}' }))
      .toBe('body{color:red}');
  });

  it('accepts a plain string', () => {
    expect(AIRestyle._cleanCss('body{color:red}')).toBe('body{color:red}');
  });

  it('does not mangle a stylesheet that legitimately starts with a brace-ish rule', () => {
    const css = '{bad json but css-ish}\nbody{color:red}';
    expect(AIRestyle._cleanCss({ result: css })).toBe(css);
  });

  it('returns empty for nothing usable', () => {
    expect(AIRestyle._cleanCss(null)).toBe('');
    expect(AIRestyle._cleanCss({ backend: 'cloud' })).toBe('');
  });
});

describe('SelectionAIBar._extractText', () => {
  it('unwraps a JSON reply instead of typing JSON into the page', () => {
    expect(SelectionAIBar._extractText({ result: '{"reply":"The corrected sentence."}' }))
      .toBe('The corrected sentence.');
  });

  it('passes plain text through', () => {
    expect(SelectionAIBar._extractText({ result: 'The corrected sentence.' }))
      .toBe('The corrected sentence.');
  });

  it('strips fences and wrapping quotes', () => {
    expect(SelectionAIBar._extractText({ result: '```\n"Hello there"\n```' })).toBe('Hello there');
  });

  it('returns empty for an empty answer so the caller can say so', () => {
    expect(SelectionAIBar._extractText({ result: '' })).toBe('');
    expect(SelectionAIBar._extractText(null)).toBe('');
  });
});
