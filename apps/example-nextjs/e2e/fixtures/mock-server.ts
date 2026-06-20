import { createServer } from 'node:http';

const cachedAt = new Date().toISOString();

const WIDGETS = [
  {
    id: 'stars',
    widgetId: 'stars',
    connectorId: 'github-actions',
    data: 42,
    cachedAt,
  },
  {
    id: 'forks',
    widgetId: 'forks',
    connectorId: 'github-actions',
    data: 8,
    cachedAt,
  },
  {
    id: 'contributors',
    widgetId: 'contributors',
    connectorId: 'github-actions',
    data: 15,
    cachedAt,
  },
  {
    id: 'open_prs',
    widgetId: 'open_prs',
    connectorId: 'github-actions',
    data: 3,
    cachedAt,
  },
  {
    id: 'open_issues',
    widgetId: 'open_issues',
    connectorId: 'github-actions',
    data: 12,
    cachedAt,
  },
  {
    id: 'ci_status',
    widgetId: 'ci_status',
    connectorId: 'github-actions',
    data: 'success',
    cachedAt,
  },
  {
    id: 'prs_closed_per_week',
    widgetId: 'prs_closed_per_week',
    connectorId: 'github-actions',
    data: [
      { date: '2026-04-06', value: 9 },
      { date: '2026-04-13', value: 11 },
      { date: '2026-04-20', value: 14 },
      { date: '2026-04-27', value: 6 },
      { date: '2026-05-04', value: 10 },
    ],
    cachedAt,
  },
  {
    id: 'errors_per_hour',
    widgetId: 'errors_per_hour',
    connectorId: 'github-actions',
    data: 0,
    cachedAt,
    syncState: 'fresh',
    status: 'no_data',
  },
  {
    id: 'deploy_frequency',
    widgetId: 'deploy_frequency',
    connectorId: 'github-actions',
    data: null,
    cachedAt,
    syncState: 'failing',
    status: 'error',
    errorMessage: 'connector auth failed: token expired',
  },
];

const HEALTH = {
  status: 'idle',
  lastSyncAt: cachedAt,
  lastError: null,
};

const WIDGETS_BY_ID = new Map(WIDGETS.map((w) => [w.widgetId, w]));

const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const widgetMatch = req.url?.match(
    /^\/dashboards\/github\/widgets\/([^/?]+)(?:\?.*)?$/,
  );

  if (req.method === 'GET' && req.url === '/dashboards/github/widgets') {
    res.end(JSON.stringify({ widgets: WIDGETS }));
  } else if (req.method === 'GET' && widgetMatch) {
    let widgetId: string;
    try {
      widgetId = decodeURIComponent(widgetMatch[1]!);
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Invalid widget id' }));
      return;
    }
    const widget = WIDGETS_BY_ID.get(widgetId);
    if (widget) {
      res.end(JSON.stringify(widget));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  } else if (req.method === 'GET' && req.url === '/health') {
    res.end(JSON.stringify(HEALTH));
  } else if (req.method === 'POST' && req.url === '/sync') {
    res.end(JSON.stringify({ triggered: true }));
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

const PORT = 8080;
server.listen(PORT, () => {
  console.log(`Mock rawdash server listening on port ${PORT}`);
});
