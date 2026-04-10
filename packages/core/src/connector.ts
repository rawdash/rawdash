/**
 * A typed handle for writing widget data to storage during a sync.
 *
 * The generic `TWidgets` constrains both the widget ID and the value shape so
 * that a connector cannot write data of the wrong type for a given widget.
 *
 * ```ts
 * await ctx.storage.setWidget('pull_requests', pullRequestsData);
 * ```
 */
export type StorageHandle<TWidgets extends Record<string, unknown>> = {
  setWidget<TWidgetId extends keyof TWidgets>(
    widgetId: TWidgetId,
    data: TWidgets[TWidgetId],
  ): Promise<void>;
};

/**
 * Context passed to a connector's `sync` function on every sync run.
 *
 * - `config` — the resolved connector configuration (credentials, options, etc.)
 * - `storage` — typed handle for persisting widget data
 *
 * Connectors should signal failures by throwing; the engine is responsible for
 * catching, recording error state, and scheduling retries.
 */
export type SyncContext<
  TConfig = unknown,
  TWidgets extends Record<string, unknown> = Record<string, unknown>,
> = {
  readonly config: TConfig;
  readonly storage: StorageHandle<TWidgets>;
};

/**
 * Metadata and data-shape marker for a single widget produced by a connector.
 *
 * `TData` is a phantom generic — it is never present at runtime, but it lets
 * `ConnectorDef` carry full widget shapes through to the `ConnectorRegistry`.
 *
 * ```ts
 * const pullRequestsWidget: WidgetDef<PullRequestData[]> = {
 *   description: 'Open pull requests for the configured repository',
 * };
 * ```
 */
export type WidgetDef<TData = unknown> = {
  /** @internal — phantom field; never present at runtime */
  readonly _data?: TData;
  readonly description?: string;
};

/**
 * The full definition of a connector: its identity, widget catalogue, and sync
 * logic.
 *
 * `TConfig` is the shape of the connector's configuration object (credentials,
 * repo names, etc.).  `TWidgets` maps widget IDs to their data shapes and must
 * match the entries in `widgets`.
 *
 * ```ts
 * const githubConnector: ConnectorDef<GithubConfig, GithubWidgets> = {
 *   id: 'github',
 *   widgets: {
 *     pull_requests: { description: 'Open pull requests' },
 *     issues:        { description: 'Open issues' },
 *   },
 *   async sync({ config, storage }) {
 *     const prs = await fetchPullRequests(config);
 *     await storage.setWidget('pull_requests', prs);
 *   },
 * };
 * ```
 */
export type ConnectorDef<
  TConfig = unknown,
  TWidgets extends Record<string, unknown> = Record<string, unknown>,
> = {
  readonly id: string;
  readonly widgets: { readonly [K in keyof TWidgets]: WidgetDef<TWidgets[K]> };
  sync(ctx: SyncContext<TConfig, TWidgets>): Promise<void>;
};
