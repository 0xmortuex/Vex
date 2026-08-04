import { describe, it, expect } from 'vitest';
import { toAnthropicTools, shapeResponse } from '../../src/anthropic-client.js';

describe('toAnthropicTools', () => {
  it('maps a plain string param to a required string property', () => {
    const [t] = toAnthropicTools([
      { name: 'navigate', description: 'Go somewhere', parameters: { url: 'string' } },
    ]);
    expect(t.name).toBe('navigate');
    expect(t.description).toBe('Go somewhere');
    expect(t.input_schema.type).toBe('object');
    expect(t.input_schema.properties.url.type).toBe('string');
    expect(t.input_schema.required).toContain('url');
  });

  it('maps boolean and number params to their JSON Schema types', () => {
    const [t] = toAnthropicTools([
      { name: 'type_text', parameters: { text: 'string', clearFirst: 'boolean', delay: 'number' } },
    ]);
    expect(t.input_schema.properties.clearFirst.type).toBe('boolean');
    expect(t.input_schema.properties.delay.type).toBe('number');
  });

  it('turns a pipe list into an enum', () => {
    const [t] = toAnthropicTools([
      { name: 'scroll', parameters: { direction: 'up|down|top|bottom' } },
    ]);
    expect(t.input_schema.properties.direction.enum).toEqual(['up', 'down', 'top', 'bottom']);
  });

  it('treats "(optional)" params as not required', () => {
    const [t] = toAnthropicTools([
      { name: 'extract_text', parameters: { selector: 'string (optional)' } },
    ]);
    expect(t.input_schema.properties.selector).toBeDefined();
    expect(t.input_schema.required).not.toContain('selector');
  });

  it('strips "(optional)" out of an enum list rather than making it a value', () => {
    const [t] = toAnthropicTools([
      { name: 'scroll', parameters: { direction: 'up|down (optional)' } },
    ]);
    expect(t.input_schema.properties.direction.enum).toEqual(['up', 'down']);
  });

  it('adds an optional intent flag to every tool', () => {
    const [t] = toAnthropicTools([{ name: 'click', parameters: { selector: 'string' } }]);
    expect(t.input_schema.properties.intent.enum).toEqual(['action', 'risky']);
    expect(t.input_schema.required).not.toContain('intent');
  });

  it('handles a tool with no parameters', () => {
    const [t] = toAnthropicTools([{ name: 'go_back', parameters: {} }]);
    expect(t.input_schema.required).toEqual([]);
    // intent is still offered, just never required
    expect(Object.keys(t.input_schema.properties)).toEqual(['intent']);
  });

  it('returns [] for non-array input', () => {
    expect(toAnthropicTools(null)).toEqual([]);
    expect(toAnthropicTools(undefined)).toEqual([]);
  });
});

describe('shapeResponse', () => {
  it('splits text, thinking and tool_use blocks', () => {
    const out = shapeResponse({
      stop_reason: 'tool_use',
      model: 'claude-opus-5',
      content: [
        { type: 'thinking', thinking: 'I should click it' },
        { type: 'text', text: 'Clicking the button.' },
        { type: 'tool_use', id: 'toolu_1', name: 'click', input: { selector: '#go' } },
      ],
      usage: { input_tokens: 10 },
    });
    expect(out.ok).toBe(true);
    expect(out.text).toBe('Clicking the button.');
    expect(out.thinking).toBe('I should click it');
    expect(out.toolUses).toEqual([{ id: 'toolu_1', name: 'click', input: { selector: '#go' } }]);
  });

  it('passes the raw blocks through so they can be replayed verbatim', () => {
    const content = [{ type: 'thinking', thinking: 'x', signature: 'sig' }];
    const out = shapeResponse({ stop_reason: 'end_turn', content });
    // Same reference/shape — thinking blocks must go back unmodified.
    expect(out.content).toBe(content);
  });

  it('reports a refusal instead of reading content', () => {
    const out = shapeResponse({
      stop_reason: 'refusal',
      content: [],
      stop_details: { type: 'refusal', category: 'cyber', explanation: 'nope' },
    });
    expect(out.ok).toBe(false);
    expect(out.refusal).toEqual({ category: 'cyber', explanation: 'nope' });
  });

  it('survives a refusal with no stop_details', () => {
    const out = shapeResponse({ stop_reason: 'refusal', content: [] });
    expect(out.ok).toBe(false);
    expect(out.refusal.category).toBeNull();
  });

  it('does not throw on a missing content array', () => {
    const out = shapeResponse({ stop_reason: 'end_turn' });
    expect(out.ok).toBe(true);
    expect(out.text).toBe('');
    expect(out.toolUses).toEqual([]);
  });
});
