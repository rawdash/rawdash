import { BaseConnector, type CredentialsSchema } from '@rawdash/core';

import {
  type TokenCacheEntry,
  fetchArmAccessToken,
  isTokenFresh,
} from './auth';

// Settings shared by every Azure connector: the Entra ID service-principal
// coordinates plus the subscription the connector is scoped to.
export interface BaseAzureSettings {
  tenantId: string;
  clientId: string;
  subscriptionId: string;
}

export const azureCredentials = {
  clientSecret: {
    description: 'Azure AD app-registration client secret',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

export type AzureCredentials = typeof azureCredentials;

// Base class for Azure connectors. Owns the Entra ID client-credentials token
// cache so each connector only implements its own resource fetching.
export abstract class BaseAzureConnector<
  TSettings extends BaseAzureSettings,
> extends BaseConnector<TSettings, AzureCredentials> {
  override readonly credentials = azureCredentials;

  private tokenCache: TokenCacheEntry | null = null;

  protected async getAccessToken(signal?: AbortSignal): Promise<string> {
    if (isTokenFresh(this.tokenCache)) {
      return this.tokenCache!.token;
    }
    this.tokenCache = await fetchArmAccessToken(
      {
        tenantId: this.settings.tenantId,
        clientId: this.settings.clientId,
        clientSecret: this.creds.clientSecret,
        connectorId: this.id,
      },
      signal,
    );
    return this.tokenCache.token;
  }
}
