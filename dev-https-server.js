/* ============================================================
   HTTPS Dev Server
   — Serves the project over HTTPS with a self-signed cert
   — Enables getUserMedia (camera access) from ANY device on the
     local network via https://YOUR_IP:8443
   — Usage:  npm start
   — Then open: https://<your-ip>:8443  on any device on the network
   Note:  Browsers will show a "Your connection is not private"
          warning for self-signed certs. Click "Advanced" →
          "Proceed to <ip>" to continue.
============================================================ */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseEnv } = require('util');

const selfsigned = require('selfsigned');

const DIST_DIR = __dirname;

// ---- Environment ----
// Load .env so the Supabase credentials live in one place. Variables that are
// already set in the shell win, which keeps CI/overrides working.
function loadEnvFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return; // no .env: rely on the process environment
  }
  let parsed;
  try {
    parsed = parseEnv(raw);
  } catch (err) {
    console.warn('.env could not be parsed:', err.message);
    return;
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(DIST_DIR, '.env'));

// PORT can be overridden (e.g. to run a second instance while another is up).
const PORT = Number(process.env.PORT) || 8443;

// Map file extensions to MIME types
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

// ---- Photo storage (Supabase Storage, REST API) ----
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET
// The bucket should be PRIVATE. The service role key stays on the server only.
// Each photo is stored as one object: photos/<timestamp>-<random>.jpg
const PHOTO_PREFIX = 'photos/';

function getSupabaseRestConfig() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
  }
  return {
    baseUrl: SUPABASE_URL.replace(/\/+$/, ''),
    key: SUPABASE_SERVICE_ROLE_KEY
  };
}

function getSupabaseConfig() {
  const { SUPABASE_BUCKET } = process.env;
  if (!SUPABASE_BUCKET) {
    throw new Error('SUPABASE_BUCKET is not set');
  }
  return { ...getSupabaseRestConfig(), bucket: SUPABASE_BUCKET };
}

// Calls the Supabase Storage API and throws on a non-2xx response.
async function supabaseFetch(cfg, url, options = {}) {
  const res = await fetch(`${cfg.baseUrl}/storage/v1${url}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      apikey: cfg.key,
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase Storage ${res.status}: ${text}`);
  }
  return res;
}

// ---- Daily streaks (Supabase Postgres, REST API) ----
// The streak belongs to the photobox as a whole: every device reads and writes
// the single global row id = 1 in the profiles table.
const PROFILE_TABLE = 'profiles';
const GLOBAL_PROFILE_ID = '1';
const STREAK_FIELDS = 'current_streak,highest_streak,last_photo_timestamp';
const HOUR_MS = 60 * 60 * 1000;

// Calls the Supabase PostgREST API and throws on a non-2xx response.
async function restFetch(url, options = {}) {
  const cfg = getSupabaseRestConfig();
  const res = await fetch(`${cfg.baseUrl}/rest/v1${url}`, {
    ...options,
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase REST ${res.status}: ${text}`);
  }
  return res;
}

async function fetchProfile() {
  const res = await restFetch(
    `/${PROFILE_TABLE}?id=eq.${GLOBAL_PROFILE_ID}&select=${STREAK_FIELDS}`,
    { method: 'GET' }
  );
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function saveProfile(streak) {
  const res = await restFetch(`/${PROFILE_TABLE}?on_conflict=id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([{ id: GLOBAL_PROFILE_ID, ...streak }])
  });
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] || null : null;
}

// Streak rules, evaluated when a photo is saved:
//   no previous photo          -> streak starts at 1
//   24h <= elapsed <= 48h      -> streak + 1
//   elapsed < 24h              -> streak unchanged
//   elapsed > 48h              -> streak resets to 1
function computeStreak(previous, now = new Date()) {
  const current = Number(previous && previous.current_streak) || 0;
  const highest = Number(previous && previous.highest_streak) || 0;
  const last = previous && previous.last_photo_timestamp
    ? new Date(previous.last_photo_timestamp)
    : null;
  const timestamp = now.toISOString();

  if (!last || Number.isNaN(last.getTime())) {
    return { current_streak: 1, highest_streak: Math.max(1, highest), last_photo_timestamp: timestamp };
  }

  const elapsed = now.getTime() - last.getTime();

  if (elapsed > 48 * HOUR_MS) {
    return { current_streak: 1, highest_streak: Math.max(1, highest), last_photo_timestamp: timestamp };
  }

  if (elapsed >= 24 * HOUR_MS) {
    const next = current + 1;
    return {
      current_streak: next,
      highest_streak: Math.max(next, highest),
      last_photo_timestamp: timestamp
    };
  }

  // Same day: reposting a photo keeps the streak where it is.
  return {
    current_streak: current,
    highest_streak: Math.max(current, highest),
    last_photo_timestamp: timestamp
  };
}

function pickStreak(row) {
  return {
    current_streak: Number(row && row.current_streak) || 0,
    highest_streak: Number(row && row.highest_streak) || 0,
    last_photo_timestamp: (row && row.last_photo_timestamp) || null
  };
}

async function updateStreak() {
  const previous = await fetchProfile();
  const next = computeStreak(previous);
  const saved = await saveProfile(next);
  return pickStreak(saved || next);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body));
}

async function handleStreakApi(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  try {
    const profile = await fetchProfile();
    return sendJson(res, 200, pickStreak(profile));
  } catch (err) {
    console.error('Streak API error:', err.message);
    return sendJson(res, 500, { error: 'Server error' });
  }
}

async function handlePhotosApi(req, res) {
  try {
    const cfg = getSupabaseConfig();

    if (req.method === 'GET') {
      const listRes = await supabaseFetch(cfg, `/object/list/${encodeURIComponent(cfg.bucket)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prefix: PHOTO_PREFIX,
          limit: 1000,
          offset: 0,
          sortBy: { column: 'name', order: 'asc' }
        })
      });
      const files = (await listRes.json()).filter((f) => f.name && f.name.endsWith('.jpg'));
      const items = await Promise.all(files.map(async (f) => {
        const key = PHOTO_PREFIX + f.name.replace(/^photos\//, '');
        const objRes = await supabaseFetch(cfg, `/object/authenticated/${encodeURIComponent(cfg.bucket)}/${key}`);
        const buf = Buffer.from(await objRes.arrayBuffer());
        return { id: key, image: 'data:image/jpeg;base64,' + buf.toString('base64') };
      }));
      return sendJson(res, 200, items);
    }

    if (req.method === 'POST') {
      const { image } = JSON.parse(await readBody(req, 15 * 1024 * 1024));
      const match = typeof image === 'string' && image.match(/^data:image\/jpeg;base64,(.+)$/);
      if (!match) {
        return sendJson(res, 400, { error: 'Invalid image' });
      }
      const key = `${PHOTO_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      await supabaseFetch(cfg, `/object/${encodeURIComponent(cfg.bucket)}/${key}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'no-store'
        },
        body: Buffer.from(match[1], 'base64')
      });

      // The photo is stored, so advance the global streak. A streak failure
      // must not report the upload as failed; the client skips the toast.
      let streak = null;
      try {
        streak = await updateStreak();
      } catch (err) {
        console.warn('Streak could not be updated:', err.message);
      }
      return sendJson(res, 201, { id: key, streak });
    }

    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('Photo API error:', err.message);
    return sendJson(res, 500, { error: 'Server error' });
  }
}

const requestHandler = (req, res) => {
  const route = req.url.split('?')[0];
  if (route === '/api/photos') {
    return handlePhotosApi(req, res);
  }
  if (route === '/api/streak') {
    return handleStreakApi(req, res);
  }

  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(DIST_DIR, urlPath);
  const ext = path.extname(filePath).toLowerCase();

  // Prevent path traversal
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
};

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// selfsigned v5: generate() is async, returns { cert, private }
selfsigned.generate(
  [{ name: 'commonName', value: 'localhost' }],
  {
    keySize: 2048,
    algorithm: 'sha256',
    notAfterDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  }
).then((pems) => {
  const server = https.createServer({ cert: pems.cert, key: pems.private }, requestHandler);

  server.listen(PORT, '0.0.0.0', () => {
    const localIP = getLocalIP();
    console.log('─'.repeat(60));
    console.log('  SnapBox HTTPS Dev Server is running!');
    console.log('─'.repeat(60));
    console.log('');
    console.log('  Local:     https://localhost:' + PORT);
    console.log('  Network:   https://' + localIP + ':' + PORT);
    console.log('');
    console.log('  On other devices (phones, tablets), open:');
    console.log('  https://' + localIP + ':' + PORT);
    console.log('');
    console.log('  Accept the self-signed certificate warning');
    console.log('  (click "Advanced" -> "Proceed to <ip>")');
    console.log('');
    console.log('  Press Ctrl+C to stop the server.');
    console.log('');
  });
}).catch((err) => {
  console.error('Failed to generate self-signed certificate:', err);
  process.exit(1);
});
