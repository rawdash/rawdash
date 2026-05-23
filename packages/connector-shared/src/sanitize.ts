export interface SanitizeAllowedUrlOptions {
  url: string | null;
  host: string;
  pathname: string;
  protocol?: 'https:' | 'http:';
}

export function sanitizeAllowedUrl(
  options: SanitizeAllowedUrlOptions,
): string | null {
  const { url, host, pathname, protocol = 'https:' } = options;
  if (url === null) {
    return null;
  }
  try {
    const u = new URL(url);
    if (u.protocol !== protocol || u.host !== host || u.pathname !== pathname) {
      return null;
    }
    return u.toString();
  } catch {
    return null;
  }
}
