/**
 * The set of primitive field types a connector resource can declare.
 *
 * - `string`    — arbitrary text (e.g. conclusion, status, name)
 * - `number`    — integer or float (e.g. run_attempt, duration_ms)
 * - `boolean`   — true/false flag
 * - `timestamp` — ISO 8601 date-time string; enables time-based windowing and groupBy
 */
export type FieldType = 'string' | 'number' | 'boolean' | 'timestamp';

/**
 * Schema for a single field within a resource.
 *
 * ```ts
 * const conclusionField: FieldDef = { type: 'string' };
 * const createdAtField: FieldDef = { type: 'timestamp' };
 * ```
 */
export type FieldDef = { type: FieldType };

/**
 * Schema for a single resource — a table of homogeneous records a connector
 * can sync.  Each key in `fields` names a column with its type.
 *
 * ```ts
 * const workflowRunResource: ResourceSchema = {
 *   fields: {
 *     id:         { type: 'number' },
 *     conclusion: { type: 'string' },
 *     created_at: { type: 'timestamp' },
 *   },
 * };
 * ```
 */
export type ResourceSchema = {
  fields: Record<string, FieldDef>;
};

/**
 * The complete set of resources a connector declares, keyed by resource name.
 */
export type ConnectorResources = Record<string, ResourceSchema>;

/**
 * Derives the TypeScript value type for a `FieldDef` at the record level.
 *
 * | FieldDef              | Inferred value type |
 * |-----------------------|---------------------|
 * | `{ type: 'string' }`  | `string`            |
 * | `{ type: 'number' }`  | `number`            |
 * | `{ type: 'boolean' }` | `boolean`           |
 * | `{ type: 'timestamp'}`| `string` (ISO 8601) |
 */
export type InferFieldValue<TField extends FieldDef> = TField extends {
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

/**
 * Derives the TypeScript type for a full record of the given resource —
 * i.e. the shape of objects passed to `storage.upsert()`.
 */
export type InferRecord<TResource extends ResourceSchema> = {
  [K in keyof TResource['fields']]: InferFieldValue<TResource['fields'][K]>;
};

/**
 * Typed handle for writing raw records into storage during a sync run.
 *
 * Connectors call `upsert` once per resource to persist all fetched records.
 * The engine is responsible for deduplication, windowing, and metric
 * computation at query time.
 *
 * ```ts
 * await ctx.storage.upsert('workflow_run', [
 *   { id: 1, conclusion: 'success', created_at: '2024-01-01T00:00:00Z' },
 * ]);
 * ```
 */
export type StorageHandle<TResources extends ConnectorResources> = {
  upsert<TResource extends keyof TResources & string>(
    resource: TResource,
    records: InferRecord<TResources[TResource]>[],
  ): Promise<void>;
};

/**
 * Context passed to a connector's `sync` function on every sync run.
 *
 * - `config`  — resolved connector configuration (credentials, options, etc.)
 * - `storage` — typed handle for upserting raw resource records
 *
 * Connectors should signal failures by throwing; the engine catches and
 * records error state.
 */
export type SyncContext<
  TConfig = unknown,
  TResources extends ConnectorResources = ConnectorResources,
> = {
  readonly config: TConfig;
  readonly storage: StorageHandle<TResources>;
};

/**
 * The full definition of a connector: its identity, resource schemas, and
 * sync logic.
 *
 * Connectors are pure resource syncers — they fetch raw records and upsert
 * them into storage.  All metric computation happens at the widget level in
 * `defineConfig`.
 *
 * ```ts
 * const githubConnector: ConnectorDef<GithubConfig, GithubResources> = {
 *   id: 'github-actions',
 *   resources: {
 *     workflow_run: {
 *       fields: {
 *         id:         { type: 'number' },
 *         conclusion: { type: 'string' },
 *         created_at: { type: 'timestamp' },
 *       },
 *     },
 *   },
 *   async sync({ config, storage }) {
 *     const runs = await fetchRuns(config);
 *     await storage.upsert('workflow_run', runs);
 *   },
 * };
 * ```
 */
export type ConnectorDef<
  TConfig = unknown,
  TResources extends ConnectorResources = ConnectorResources,
> = {
  readonly id: string;
  readonly resources: TResources;
  sync(ctx: SyncContext<TConfig, TResources>): Promise<void>;
};

/**
 * Factory that creates a fully-typed `ConnectorDef` while preserving literal
 * field types for downstream inference in `defineMetric`.
 *
 * ```ts
 * export const GitHubActionsConnector = defineConnector<GitHubActionsConfig>()({
 *   id: 'github-actions',
 *   resources: {
 *     workflow_run: {
 *       fields: {
 *         id:         { type: 'number' },
 *         conclusion: { type: 'string' },
 *         created_at: { type: 'timestamp' },
 *       },
 *     },
 *   },
 *   async sync({ config, storage }) { ... },
 * });
 * ```
 */
export function defineConnector<TConfig>() {
  return function <TResources extends ConnectorResources>(
    def: ConnectorDef<TConfig, TResources>,
  ): ConnectorDef<TConfig, TResources> {
    return def;
  };
}
