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
];

const HEALTH = {
  status: 'idle',
  lastSyncAt: cachedAt,
  lastError: null,
};

const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url === '/dashboards/github/widgets') {
    res.end(JSON.stringify({ widgets: WIDGETS }));
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
