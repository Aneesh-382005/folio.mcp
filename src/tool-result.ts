// Single source of truth for tool results. MCP clients disagree on whether they
// feed `content` or `structuredContent` to the model, so both are built from the
// same object here and cannot drift apart. The spec asks for exactly this:
// "a tool that returns structured content SHOULD also return the serialized JSON
// in a TextContent block" (MCP 2025-11-25, server/tools).

// Null/undefined object properties carry no information; dropping them keeps the
// payload (sent twice by clients that read both fields) small. Array items are kept.
export function dropNulls<T>(value: T): T {
  if (Array.isArray(value)) return value.map(dropNulls) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => [k, dropNulls(v)])
    ) as T;
  }
  return value;
}

export function toolResult<T extends Record<string, unknown>>(data: T) {
  const structuredContent = dropNulls(data);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }],
    structuredContent
  };
}
