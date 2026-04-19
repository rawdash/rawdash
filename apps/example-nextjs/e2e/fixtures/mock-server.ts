import { createServer } from 'node:http';

const cachedAt = new Date().toISOString();

const WIDGETS = [
  {
    id: 'latest_run_conclusion',
    widgetId: 'latest_run_conclusion',
    connectorId: 'github-actions',
    data: 'success',
    cachedAt,
  },
  {
    id: 'run_count_7d',
    widgetId: 'run_count_7d',
    connectorId: 'github-actions',
    data: 7,
    cachedAt,
  },
  {
    id: 'successful_runs_7d',
    widgetId: 'successful_runs_7d',
    connectorId: 'github-actions',
    data: 5,
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
  if (req.method === 'GET' && req.url === '/widgets') {
    res.end(JSON.stringify(WIDGETS));
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
