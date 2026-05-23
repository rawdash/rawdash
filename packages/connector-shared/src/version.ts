export const HTTP_CLIENT_VERSION = '0.0.0';

export const DEFAULT_USER_AGENT = `rawdash-connector/${HTTP_CLIENT_VERSION} (+https://rawdash.dev)`;

export function connectorUserAgent(connectorId: string): string {
  return `rawdash-connector-${connectorId}/${HTTP_CLIENT_VERSION} (+https://rawdash.dev)`;
}
