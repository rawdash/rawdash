export type FieldType = 'string' | 'number' | 'boolean' | 'timestamp';

export interface Field {
  type: FieldType;
  auth?: 'none' | 'optional' | 'required';
}

export interface Resource {
  fields: Record<string, Field>;
  auth?: 'none' | 'optional' | 'required';
}

export type ConnectorResources = Record<string, Resource>;

export interface CredentialEntry {
  description: string;
  auth?: 'none' | 'optional' | 'required';
}

export type CredentialSchema = Record<string, CredentialEntry>;

export type InferCredentials<TCreds extends CredentialSchema> = {
  [K in keyof TCreds]: TCreds[K] extends { auth: 'required' }
    ? string
    : string | undefined;
};

export type InferFieldValue<TField extends Field> = TField extends {
  type: 'string';
}
  ? string
  : TField extends { type: 'number' }
    ? number
    : TField extends { type: 'boolean' }
      ? boolean
      : TField extends { type: 'timestamp' }
        ? string
        : never;

export type InferRecord<TResource extends Resource> = {
  [K in keyof TResource['fields']]: InferFieldValue<TResource['fields'][K]>;
};

export interface SyncRequest {
  resource: string;
  mode: 'full' | 'latest';
  since?: string;
}

export interface StorageHandle {
  upsert(resource: string, records: Record<string, unknown>[]): Promise<void>;
}

export interface Connector {
  readonly id: string;
  readonly resources: ConnectorResources;
  readonly credentials?: CredentialSchema;
  sync(request: SyncRequest, storage: StorageHandle): Promise<void>;
}

export abstract class BaseConnector<
  TSettings = unknown,
  TCreds extends CredentialSchema = CredentialSchema,
> implements Connector {
  abstract readonly id: string;
  abstract readonly resources: ConnectorResources;
  readonly credentials?: TCreds;

  protected settings: TSettings;
  protected creds: InferCredentials<TCreds>;

  constructor(settings: TSettings, creds?: InferCredentials<TCreds>) {
    this.settings = settings;
    this.creds = creds ?? ({} as InferCredentials<TCreds>);
  }

  abstract sync(request: SyncRequest, storage: StorageHandle): Promise<void>;
}

export function defineConnector<TSettings>() {
  return function <
    TResources extends ConnectorResources,
    TCreds extends CredentialSchema = Record<string, never>,
  >(def: {
    id: string;
    resources: TResources;
    credentials?: TCreds;
    sync: (
      this: { settings: TSettings; creds: InferCredentials<TCreds> },
      request: SyncRequest,
      storage: StorageHandle,
    ) => Promise<void>;
  }): {
    new (
      settings: TSettings,
      creds?: InferCredentials<TCreds>,
    ): Connector & { readonly resources: TResources };
    readonly id: string;
    readonly resources: TResources;
    readonly credentials: TCreds | undefined;
  } {
    class DynamicConnector extends BaseConnector<TSettings, TCreds> {
      static readonly id = def.id;
      static readonly resources = def.resources;
      static readonly credentials = def.credentials;

      readonly id = def.id;
      readonly resources = def.resources;
      override readonly credentials = def.credentials;

      async sync(request: SyncRequest, storage: StorageHandle): Promise<void> {
        return def.sync.call(
          { settings: this.settings, creds: this.creds },
          request,
          storage,
        );
      }
    }

    return DynamicConnector as unknown as {
      new (
        settings: TSettings,
        creds?: InferCredentials<TCreds>,
      ): Connector & { readonly resources: TResources };
      readonly id: string;
      readonly resources: TResources;
      readonly credentials: TCreds | undefined;
    };
  };
}
