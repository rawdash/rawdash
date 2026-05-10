export function text(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

export function err(code: string, message: string) {
  return text({ error: { code, message } });
}
