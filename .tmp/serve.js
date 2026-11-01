const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.mp3':'audio/mpeg', '.json':'application/json' };

function proxy(req, res) {
  const upstream = https.request({
    hostname: 'localhost', port: 8443, path: req.url, method: req.method,
    headers: Object.assign({}, req.headers, { host: 'localhost:8443' }),
    rejectUnauthorized: false
  }, (up) => {
    // Der Upstream spricht HTTPS und setzt das Admin-Cookie deshalb mit
    // "Secure". Die Vorschau läuft aber auf http://127.0.0.1:8123 — ohne
    // diesen Kniff würde der Browser das Cookie verwerfen und der Login
    // käme nach dem Redirect sofort wieder auf die PIN-Seite zurück.
    const headers = Object.assign({}, up.headers);
    if (headers['set-cookie']) {
      headers['set-cookie'] = headers['set-cookie'].map((cookie) =>
        cookie.replace(/;\s*Secure/gi, '')
      );
    }
    res.writeHead(up.statusCode || 502, headers);
    up.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(502); res.end('proxy error'); });
  req.pipe(upstream);
}

http.createServer((req, res) => {
  const requestPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const adminRoute = ['/admin', '/admin/', '/admin.html', '/admin-login.html'].includes(requestPath);
  if ((req.url || '').startsWith('/api/') || adminRoute) { proxy(req, res); return; }
  let p = requestPath;
  if (p === '/') p = '/index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); res.end('no'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(8123, '127.0.0.1', () => console.log('static+proxy on 8123'));
