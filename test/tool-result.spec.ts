import { describe, expect, it } from 'vitest';
import { dropNulls, toolResult } from '../src/tool-result';

describe('toolResult', () => {
  it('returns content that is exactly the JSON of structuredContent', () => {
    const result = toolResult({ a: 1, nested: { b: [1, 2, { c: 'x' }] }, empty: [] });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
    expect(result.content[0].text).toBe(JSON.stringify(result.structuredContent));
  });

  it('drops null/undefined object properties in both fields but keeps array items and empty collections', () => {
    const result = toolResult({ keep: 0, gone: null, missing: undefined, list: [null, 1], inner: { gone: null, empty: {} } });

    expect(result.structuredContent).toEqual({ keep: 0, list: [null, 1], inner: { empty: {} } });
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
  });

  it('dropNulls leaves primitives alone', () => {
    expect(dropNulls('s')).toBe('s');
    expect(dropNulls(0)).toBe(0);
  });
});
