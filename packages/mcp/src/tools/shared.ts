function safeStringify(data: unknown): string {
  try {
    return JSON.stringify(
      data,
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
      2,
    );
  } catch {
    return JSON.stringify(
      {
        error: {
          code: 'SERIALIZATION_ERROR',
          message: 'Failed to serialize tool response',
        },
      },
      null,
      2,
    );
  }
}

export function text(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: safeStringify(data) }],
  };
}

export function err(code: string, message: string) {
  return text({ error: { code, message } });
}
