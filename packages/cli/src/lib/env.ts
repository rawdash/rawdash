export function getEnv(): { url: string; apiKey: string | undefined } {
  return {
    url: process.env['RAWDASH_URL'] ?? 'https://api.rawdash.dev',
    apiKey: process.env['RAWDASH_API_KEY'],
  };
}

export function requireApiKey(): string {
  const { apiKey } = getEnv();
  if (!apiKey) {
    console.error('RAWDASH_API_KEY is not set. Set it in your environment.');
    process.exit(3);
  }
  return apiKey;
}
