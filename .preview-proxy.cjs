const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 8140;
const ROOT = path.join(__dirname, 'challenge-app', 'public');
const site = JSON.parse(fs.readFileSync(path.join(__dirname, 'challenge-app', 'site.json'), 'utf8'));
const REMOTE = new URL(site.previewUrl);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp'
};

function proxy(req, res, url) {
  const headers = {
    accept: req.headers.accept || '*/*',
    'user-agent': 'SnapBox-Preview/1.0'
  };
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  if (req.headers.cookie) headers.cookie = req.headers.cookie;

  const upstream = https.request({
    hostname: REMOTE.hostname,
    port: 443,
    path: url.pathname + url.search,
    method: req.method,
    headers
  }, (remote) => {
    const out = { 'Content-Type': remote.headers['content-type'] || 'application/octet-stream' };
    if (remote.headers['cache-control']) out['Cache-Control'] = remote.headers['cache-control'];
    if (remote.headers['set-cookie']) out['Set-Cookie'] = remote.headers['set-cookie'];
    res.writeHead(remote.statusCode || 502, out);
    remote.pipe(res);
  });

  upstream.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Upstream nicht erreichbar: ' + err.message);
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:' + PORT);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/img/')) {
    proxy(req, res, url);
    return;
  }
  if (url.pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }
  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\//, '');
  const file = path.resolve(ROOT, relative);
  if (!file.startsWith(path.resolve(ROOT))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Nicht gefunden');
      return;
    }
    res.writeHead(200, {
      'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
});

server.on('error', (err) => {
  console.error('SERVER ERROR:', err.message);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('READY http://127.0.0.1:' + PORT + ' PID ' + process.pid + ' API ' + REMOTE.origin);
});
