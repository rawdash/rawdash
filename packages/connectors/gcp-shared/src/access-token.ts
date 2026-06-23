import { AuthError } from '@rawdash/connector-shared';

import {
  type RefreshTokenCredentials,
  type ServiceAccountInput,
  buildRefreshTokenGrant,
  buildServiceAccountJwt,
} from './auth';

interface GcpTokenResponse {
  access_token: string;
  expires_in?: number;
}

export type GcpTokenPoster = (
  url: string,
  opts: {
    resource: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{ body: GcpTokenResponse }>;

export class GcpAccessTokenProvider {
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly opts: {
      connectorId: string;
      scope: string;
      getServiceAccountJson: () => ServiceAccountInput | undefined;
      getRefreshTokenCredentials?: () => RefreshTokenCredentials | undefined;
      post: GcpTokenPoster;
    },
  ) {}

  private async resolveGrant(): Promise<{ url: string; body: string }> {
    const serviceAccountJson = this.opts.getServiceAccountJson();
    if (serviceAccountJson) {
      return buildServiceAccountJwt(serviceAccountJson, this.opts.scope);
    }
    const refreshTokenCredentials = this.opts.getRefreshTokenCredentials?.();
    if (refreshTokenCredentials) {
      return buildRefreshTokenGrant(refreshTokenCredentials);
    }
    throw new AuthError(
      `${this.opts.connectorId}: missing serviceAccountJson or refresh-token credentials`,
    );
  }

  async getToken(signal?: AbortSignal): Promise<string> {
    if (this.cached && Date.now() < this.cached.expiresAt) {
      return this.cached.token;
    }
    const { url, body } = await this.resolveGrant();
    const res = await this.opts.post(url, {
      resource: 'oauth_token',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal,
    });
    const expiresIn = res.body.expires_in ?? 3600;
    this.cached = {
      token: res.body.access_token,
      expiresAt: Date.now() + (expiresIn - 60) * 1000,
    };
    return this.cached.token;
  }
}
