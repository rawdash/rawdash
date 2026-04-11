/**
 * A registry mapping connector IDs to their widget data shapes.
 *
 * Callers declare their registry when constructing a `Rawdash` instance so
 * that widget data is typed end-to-end:
 *
 * ```ts
 * type MyRegistry = {
 *   github: { pull_requests: PullRequestData; issues: IssueData };
 *   stripe: { mrr: MrrData };
 * };
 * const rawdash = createRawdash<MyRegistry>({ ... });
 * ```
 */
export type ConnectorRegistry = Record<string, Record<string, unknown>>;

export type {
  ConnectorDef,
  StorageHandle,
  SyncContext,
  WidgetDef,
} from './connector';

/**
 * Phantom-typed Rawdash instance.  The generic `TRegistry` flows into adapter
 * return types so callers get typed widget data without extra casts.
 *
 * Constructed via `createRawdash` (defined in a future ticket).
 */
export interface Rawdash<
  TRegistry extends ConnectorRegistry = ConnectorRegistry,
> {
  /** @internal — phantom field; never present at runtime */
  readonly _registry: TRegistry;
}
