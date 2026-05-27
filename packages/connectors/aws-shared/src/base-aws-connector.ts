import {
  AuthError,
  type HttpClientError,
  type HttpResponse,
  RateLimitError,
  TransientError,
  connectorUserAgent,
  parseEpoch,
} from '@rawdash/connector-shared';
import { BaseConnector, type CredentialsSchema } from '@rawdash/core';

import { createAuthorizationHeader, formatAmzDate, sha256Hex } from './sigv4';
import { type StsCredentials, parseAssumeRole, parseErrorCode } from './xml';

export interface BaseAWSSettings {
  region: string;
  roleArn?: string;
  externalId?: string;
}

export const awsCredentialsSchema = {
  accessKeyId: {
    description: 'AWS access key ID',
    auth: 'optional' as const,
  },
  secretAccessKey: {
    description: 'AWS secret access key',
    auth: 'optional' as const,
  },
} satisfies CredentialsSchema;

export type AwsCredentials = typeof awsCredentialsSchema;

export interface SigningCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

const STS_SERVICE = 'sts';
const STS_API_VERSION = '2011-06-15';
const ASSUMED_ROLE_TTL_BUFFER_MS = 60_000;
const ASSUME_ROLE_DURATION_SECONDS = 3600;
const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded; charset=utf-8';

function readEnv(name: string): string | undefined {
  const env = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env;
  return env?.[name];
}

export abstract class BaseAWSConnector<
  TSettings extends BaseAWSSettings,
> extends BaseConnector<TSettings, AwsCredentials> {
  override readonly credentials = awsCredentialsSchema;

  private assumedCreds: {
    value: SigningCredentials;
    expiresAt: number;
  } | null = null;

  protected baseCredentials(): SigningCredentials {
    const { accessKeyId, secretAccessKey } = this.creds;
    if (accessKeyId && secretAccessKey) {
      return { accessKeyId, secretAccessKey };
    }
    const envAccessKeyId = readEnv('AWS_ACCESS_KEY_ID');
    const envSecretAccessKey = readEnv('AWS_SECRET_ACCESS_KEY');
    if (envAccessKeyId && envSecretAccessKey) {
      return {
        accessKeyId: envAccessKeyId,
        secretAccessKey: envSecretAccessKey,
        sessionToken: readEnv('AWS_SESSION_TOKEN') || undefined,
      };
    }
    throw new AuthError(
      `${this.id}: no AWS credentials available — provide accessKeyId + secretAccessKey, or set them in the environment for role assumption`,
    );
  }

  protected async resolveSigningCredentials(
    signal?: AbortSignal,
  ): Promise<SigningCredentials> {
    if (this.settings.roleArn === undefined) {
      const { accessKeyId, secretAccessKey } = this.creds;
      if (!accessKeyId || !secretAccessKey) {
        throw new AuthError(
          `${this.id}: static-credential auth requires both accessKeyId and secretAccessKey`,
        );
      }
      return { accessKeyId, secretAccessKey };
    }

    if (this.assumedCreds && Date.now() < this.assumedCreds.expiresAt) {
      return this.assumedCreds.value;
    }
    return this.assumeRole(this.settings.roleArn, signal);
  }

  private async assumeRole(
    roleArn: string,
    signal?: AbortSignal,
  ): Promise<SigningCredentials> {
    const params = new URLSearchParams();
    params.set('Action', 'AssumeRole');
    params.set('Version', STS_API_VERSION);
    params.set('RoleArn', roleArn);
    params.set('RoleSessionName', `rawdash-${this.id}`);
    params.set('DurationSeconds', String(ASSUME_ROLE_DURATION_SECONDS));
    if (this.settings.externalId !== undefined) {
      params.set('ExternalId', this.settings.externalId);
    }

    const host = `sts.${this.settings.region}.amazonaws.com`;
    const xml = await this.signedPost({
      host,
      service: STS_SERVICE,
      body: params.toString(),
      signingCredentials: this.baseCredentials(),
      resource: 'assume_role',
      signal,
    });

    const parsed = parseAssumeRole(xml);
    if (parsed === null) {
      throw new AuthError(
        `${this.id}: STS AssumeRole returned no usable credentials`,
      );
    }
    this.cacheAssumedCredentials(parsed);
    return {
      accessKeyId: parsed.accessKeyId,
      secretAccessKey: parsed.secretAccessKey,
      sessionToken: parsed.sessionToken || undefined,
    };
  }

  private cacheAssumedCredentials(parsed: StsCredentials): void {
    const expirationMs = parseEpoch(parsed.expiration, 'iso');
    const expiresAt =
      expirationMs !== null
        ? expirationMs - ASSUMED_ROLE_TTL_BUFFER_MS
        : Date.now() + (ASSUME_ROLE_DURATION_SECONDS - 60) * 1000;
    this.assumedCreds = {
      value: {
        accessKeyId: parsed.accessKeyId,
        secretAccessKey: parsed.secretAccessKey,
        sessionToken: parsed.sessionToken || undefined,
      },
      expiresAt,
    };
  }

  protected async signedPost(args: {
    host: string;
    service: string;
    body: string;
    signingCredentials: SigningCredentials;
    resource: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const { amzDate, dateStamp } = formatAmzDate(new Date());
    const payloadHash = await sha256Hex(args.body);

    const signedHeaders: Record<string, string> = {
      host: args.host,
      'content-type': FORM_CONTENT_TYPE,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (args.signingCredentials.sessionToken !== undefined) {
      signedHeaders['x-amz-security-token'] =
        args.signingCredentials.sessionToken;
    }

    const authorization = await createAuthorizationHeader({
      method: 'POST',
      host: args.host,
      path: '/',
      query: '',
      headers: signedHeaders,
      payloadHash,
      accessKeyId: args.signingCredentials.accessKeyId,
      secretAccessKey: args.signingCredentials.secretAccessKey,
      region: this.settings.region,
      service: args.service,
      amzDate,
      dateStamp,
    });

    const sendHeaders: Record<string, string> = {
      'content-type': FORM_CONTENT_TYPE,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      'user-agent': connectorUserAgent(this.id),
      Authorization: authorization,
    };
    if (args.signingCredentials.sessionToken !== undefined) {
      sendHeaders['x-amz-security-token'] =
        args.signingCredentials.sessionToken;
    }

    try {
      const res: HttpResponse<string> = await this.request<string>(
        {
          url: `https://${args.host}/`,
          method: 'POST',
          headers: sendHeaders,
          body: args.body,
          parseJson: false,
          signal: args.signal,
        },
        { resource: args.resource },
      );
      return res.body;
    } catch (err) {
      throw this.classifyAwsError(err);
    }
  }

  protected classifyAwsError(err: unknown): unknown {
    if (!(err instanceof Error) || !('kind' in err)) {
      return err;
    }
    const httpErr = err as HttpClientError;
    const body =
      typeof httpErr.response?.body === 'string' ? httpErr.response.body : '';
    const code = parseErrorCode(body) ?? '';
    const status = httpErr.response?.status ?? 0;

    if (
      /throttl|RequestLimitExceeded|TooManyRequests|LimitExceeded/i.test(code)
    ) {
      return new RateLimitError(httpErr.message, httpErr.response);
    }
    if (
      /AccessDenied|UnrecognizedClient|InvalidClientTokenId|SignatureDoesNotMatch|AuthFailure|InvalidAccessKeyId|Forbidden/i.test(
        code,
      )
    ) {
      return new AuthError(httpErr.message, httpErr.response);
    }
    if (status >= 500) {
      return new TransientError(httpErr.message, httpErr.response);
    }
    return err;
  }
}
