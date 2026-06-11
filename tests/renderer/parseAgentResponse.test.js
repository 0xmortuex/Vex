import { describe, it, expect } from 'vitest';
import { parseAgentResponse } from '../../src/renderer/js/agent-loop.js';

describe('parseAgentResponse', () => {
  describe('plain JSON', () => {
    it('parses a normal tool-call object', () => {
      const out = parseAgentResponse(
        '{"tool":"navigate","parameters":{"url":"https://x.com"},"thought":"go"}'
      );
      expect(out).toEqual({
        tool: 'navigate',
        parameters: { url: 'https://x.com' },
        thought: 'go',
        intent: 'action',
      });
    });

    it('honours an explicit intent field', () => {
      const out = parseAgentResponse('{"tool":"click","parameters":{},"intent":"risky"}');
      expect(out.intent).toBe('risky');
    });

    it('defaults missing parameters to {}', () => {
      const out = parseAgentResponse('{"tool":"reload"}');
      expect(out.parameters).toEqual({});
    });
  });

  describe('fenced JSON', () => {
    it('strips ```json … ``` fences', () => {
      const raw = '```json\n{"tool":"navigate","parameters":{"url":"x"}}\n```';
      expect(parseAgentResponse(raw)).toMatchObject({ tool: 'navigate' });
    });

    it('strips bare ``` … ``` fences (no language)', () => {
      const raw = '```\n{"tool":"reload"}\n```';
      expect(parseAgentResponse(raw)).toMatchObject({ tool: 'reload' });
    });
  });

  describe('JSON embedded in prose', () => {
    it('extracts a JSON object after a prose preamble', () => {
      const raw =
        'Sure, here is the next action:\n\n{"tool":"click","parameters":{"selector":"#go"}}\n\nLet me know.';
      expect(parseAgentResponse(raw)).toMatchObject({
        tool: 'click',
        parameters: { selector: '#go' },
      });
    });

    it('returns null when the prose has no JSON object', () => {
      expect(parseAgentResponse('I would like to click the button.')).toBeNull();
    });
  });

  describe('field name aliases (model output drift)', () => {
    it('alias: toolName', () => {
      expect(parseAgentResponse('{"toolName":"navigate"}')).toMatchObject({ tool: 'navigate' });
    });
    it('alias: tool_name', () => {
      expect(parseAgentResponse('{"tool_name":"navigate"}')).toMatchObject({ tool: 'navigate' });
    });
    it('alias: action', () => {
      expect(parseAgentResponse('{"action":"navigate"}')).toMatchObject({ tool: 'navigate' });
    });
    it('alias: function_name', () => {
      expect(parseAgentResponse('{"function_name":"navigate"}')).toMatchObject({ tool: 'navigate' });
    });
    it('alias: name', () => {
      expect(parseAgentResponse('{"name":"navigate"}')).toMatchObject({ tool: 'navigate' });
    });

    it('alias precedence: tool wins over toolName', () => {
      const out = parseAgentResponse('{"tool":"a","toolName":"b"}');
      expect(out.tool).toBe('a');
    });

    it.each([
      ['params'],
      ['arguments'],
      ['args'],
    ])('parameters alias: %s', (key) => {
      const out = parseAgentResponse(`{"tool":"x","${key}":{"k":1}}`);
      expect(out.parameters).toEqual({ k: 1 });
    });

    it.each([
      ['reasoning'],
      ['reason'],
    ])('thought alias: %s', (key) => {
      const out = parseAgentResponse(`{"tool":"x","${key}":"because"}`);
      expect(out.thought).toBe('because');
    });
  });

  describe('rejects bad input', () => {
    it('null', () => expect(parseAgentResponse(null)).toBeNull());
    it('undefined', () => expect(parseAgentResponse(undefined)).toBeNull());
    it('empty string', () => expect(parseAgentResponse('')).toBeNull());
    it('whitespace-only', () => expect(parseAgentResponse('   \n  ')).toBeNull());
    it('malformed JSON', () => expect(parseAgentResponse('{not json')).toBeNull());
    it('JSON without a tool field', () => {
      expect(parseAgentResponse('{"foo":"bar"}')).toBeNull();
    });
    it('JSON array (not an object)', () => {
      expect(parseAgentResponse('["a","b"]')).toBeNull();
    });
    it('a JSON string literal', () => {
      // `JSON.parse('"hello"')` succeeds with the string "hello", which is not
      // an object — parser must reject it.
      expect(parseAgentResponse('"hello"')).toBeNull();
    });
  });
});
