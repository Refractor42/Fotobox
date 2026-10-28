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
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const selfsigned = require('selfsigned');

const DIST_DIR = __dirname;

// Lädt .env neben dem Skript (ohne bereits gesetzte Variablen zu überschreiben),
// damit `npm start` ohne Zusatzflags funktioniert.
(function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

const PORT = process.env.PORT || 8443;

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

// ---- Daily streaks (Supabase Postgres, REST API) ----
// The streak belongs to the photobox as a whole: every device reads and writes
// the single global row id = 1 in the profiles table.
const PROFILE_TABLE = 'profiles';
const GLOBAL_PROFILE_ID = '1';
const STREAK_FIELDS = 'current_streak,highest_streak,last_photo_timestamp';
const DAY_MS = 24 * 60 * 60 * 1000;

// Calls the Supabase PostgREST API and throws on a non-2xx response.
async function restFetch(url, options = {}) {
  const cfg = getSupabaseConfig();
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

// Kalendertag in lokaler Serverzeit als fortlaufende Zahl. Der Streak zählt
// Tage, keine rollenden 24h-Fenster: sonst bringt ein Foto am Abend und eines
// am nächsten Nachmittag (unter 24h Abstand) keinen Fortschritt, obwohl an
// jedem Tag geknipst wurde.
function localDayIndex(date) {
  return Math.floor((date.getTime() - date.getTimezoneOffset() * 60000) / DAY_MS);
}

// Streak rules, evaluated when a photo is saved:
//   no previous photo        -> streak starts at 1
//   a photo was already taken today -> unchanged
//   yesterday was the last photo    -> streak + 1
//   a day was skipped               -> streak restarts at 1
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

  const days = localDayIndex(now) - localDayIndex(last);

  // Same day (or a clock skew/reposted photo): keep the streak where it is.
  if (days <= 0) {
    return {
      current_streak: current,
      highest_streak: Math.max(current, highest),
      last_photo_timestamp: timestamp
    };
  }

  if (days === 1) {
    const next = current + 1;
    return {
      current_streak: next,
      highest_streak: Math.max(next, highest),
      last_photo_timestamp: timestamp
    };
  }

  // A whole day went by without a photo — the old streak is gone.
  return { current_streak: 1, highest_streak: Math.max(1, highest), last_photo_timestamp: timestamp };
}

function pickStreak(row) {
  return {
    current_streak: Number(row && row.current_streak) || 0,
    highest_streak: Number(row && row.highest_streak) || 0,
    last_photo_timestamp: (row && row.last_photo_timestamp) || null
  };
}

// Ein Streak lebt nur, solange das letzte Foto von heute oder gestern ist. Ist
// ein ganzer Tag ohne Foto vergangen, gilt er als 0 — auch wenn in der
// Datenbank noch der alte Wert steht (der wird beim nächsten Foto neu gesetzt).
function pickCurrentStreak(row, now = new Date()) {
  const streak = pickStreak(row);
  const last = streak.last_photo_timestamp ? new Date(streak.last_photo_timestamp) : null;
  if (last && !Number.isNaN(last.getTime()) && localDayIndex(now) - localDayIndex(last) > 1) {
    streak.current_streak = 0;
  }
  return streak;
}

async function updateStreak() {
  const previous = await fetchProfile();
  const next = computeStreak(previous);
  const saved = await saveProfile(next);
  return pickStreak(saved || next);
}

async function handleStreakApi(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  try {
    const profile = await fetchProfile();
    return sendJson(res, 200, pickCurrentStreak(profile));
  } catch (err) {
    console.error('Streak API error:', err.message);
    return sendJson(res, 500, { error: 'Server error' });
  }
}

// ---- Trash (Papierkorb) ----
// Trashed objects live in the same private bucket under trash/. The expiry
// timestamp is encoded in the object name (trash/<expiresAtSec>-<name>.jpg),
// so the periodic purge needs no extra metadata store.
const TRASH_PREFIX = 'trash/';
const PHOTO_NAME = '[A-Za-z0-9-]+\\.jpg';
const TRASH_NAME_RE = new RegExp(`^(\\d{10,})-(${PHOTO_NAME})$`);
const PURGE_INTERVAL_MS = 60 * 60 * 1000; // purge expired trash hourly
const QR_URL_TTL_SECONDS = 24 * 60 * 60; // QR-Download-Links: 24h gültig

function getTrashRetentionDays(req) {
  const days = Number(new URL(req.url, 'http://localhost').searchParams.get('days'));
  if (!Number.isFinite(days)) return 7;
  return Math.min(90, Math.max(1, Math.round(days)));
}

function getSupabaseConfig() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_BUCKET) {
    throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or SUPABASE_BUCKET is not set');
  }
  return {
    baseUrl: SUPABASE_URL.replace(/\/+$/, ''),
    key: SUPABASE_SERVICE_ROLE_KEY,
    bucket: SUPABASE_BUCKET
  };
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

// Lists .jpg object names directly under a prefix (no folder recursion).
async function listJpgNames(cfg, prefix) {
  const listRes = await supabaseFetch(cfg, `/object/list/${encodeURIComponent(cfg.bucket)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prefix,
      limit: 1000,
      offset: 0,
      sortBy: { column: 'name', order: 'asc' }
    })
  });
  const files = await listRes.json();
  return files
    .filter((f) => f.name && f.name.endsWith('.jpg'))
    .map((f) => f.name.replace(new RegExp('^' + prefix), ''));
}

// Downloads one object and returns it as a JPEG data URL. The cache-buster
// query is required: Supabase's CDN caches authenticated GETs at the edge,
// which would otherwise serve the pre-overwrite bytes after sticker editing.
async function objectToDataUrl(cfg, key) {
  const objRes = await supabaseFetch(cfg, `/object/authenticated/${encodeURIComponent(cfg.bucket)}/${key}?t=${Date.now()}`);
  const buf = Buffer.from(await objRes.arrayBuffer());
  return 'data:image/jpeg;base64,' + buf.toString('base64');
}

// Moves an object inside the bucket; falls back to copy+delete if the
// storage instance does not expose the move endpoint.
async function moveObject(cfg, sourceKey, destinationKey) {
  try {
    await supabaseFetch(cfg, '/object/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucketId: cfg.bucket, sourceKey, destinationKey })
    });
  } catch (err) {
    if (!/Supabase Storage 40[45]/.test(err.message)) throw err;
    await supabaseFetch(cfg, '/object/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucketId: cfg.bucket, sourceKey, destinationKey })
    });
    await supabaseFetch(cfg, `/object/${encodeURIComponent(cfg.bucket)}/${sourceKey}`, { method: 'DELETE' });
  }
}

// Permanently deletes every trash object whose encoded expiry has passed.
async function purgeExpiredTrash() {
  try {
    const cfg = getSupabaseConfig();
    const names = await listJpgNames(cfg, TRASH_PREFIX);
    const now = Math.floor(Date.now() / 1000);
    const expired = names.filter((n) => {
      const m = n.match(TRASH_NAME_RE);
      return m && Number(m[1]) <= now;
    });
    if (!expired.length) return;
    await supabaseFetch(cfg, `/object/${encodeURIComponent(cfg.bucket)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: expired.map((n) => TRASH_PREFIX + n) })
    });
    console.log(`Papierkorb: ${expired.length} abgelaufene(s) Foto(s) endgültig gelöscht.`);
  } catch (err) {
    console.warn('Trash purge failed:', err.message);
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body));
}

async function handlePhotosApi(req, res) {
  try {
    const cfg = getSupabaseConfig();

    if (req.method === 'GET' && new URL(req.url, 'http://localhost').searchParams.get('qr') === '1') {
      // Signierte URL für den QR-Download aufs Handy (privater Bucket, kein
      // Login, begrenzte Gültigkeit). Zeigt direkt auf Supabase (gültiges
      // TLS) statt auf den selbstsignierten Dev-Server.
      const id = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
      if (!new RegExp(`^${PHOTO_PREFIX}(${PHOTO_NAME})$`).test(id)) {
        return sendJson(res, 400, { error: 'Invalid id' });
      }
      const signRes = await supabaseFetch(cfg, `/object/sign/${encodeURIComponent(cfg.bucket)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: QR_URL_TTL_SECONDS, paths: [id] })
      });
      const body = await signRes.json();
      // Storage-API antwortet mit einem Array [{ error, path, signedURL }]
      const item = (Array.isArray(body) ? body[0] : (body.data && body.data[0])) || {};
      const rel = item.signedUrl || item.signedURL || '';
      if (!rel) throw new Error('no signed url in response');
      const url = rel.startsWith('http') ? rel : cfg.baseUrl + '/storage/v1' + rel;
      return sendJson(res, 200, { url, ttl: QR_URL_TTL_SECONDS });
    }

    if (req.method === 'GET') {
      const names = await listJpgNames(cfg, PHOTO_PREFIX);
      const items = await Promise.all(names.map(async (name) => ({
        id: PHOTO_PREFIX + name,
        image: await objectToDataUrl(cfg, PHOTO_PREFIX + name)
      })));
      return sendJson(res, 200, items);
    }

    if (req.method === 'POST') {
      const { image, id } = JSON.parse(await readBody(req, 15 * 1024 * 1024));
      const match = typeof image === 'string' && image.match(/^data:image\/jpeg;base64,(.+)$/);
      if (!match) {
        return sendJson(res, 400, { error: 'Invalid image' });
      }
      // Mit id: bestehendes Foto in Place überschreiben (Sticker/Filter-
      // Nachbearbeitung), sonst neuen Key erzeugen. Überschreiben erfolgt als
      // Löschen + Neu-Upload — der x-upsert-Upload aktualisiert den vom CDN
      // ausgelieferten Inhalt nicht zuverlässig.
      let key;
      if (id) {
        if (!new RegExp(`^${PHOTO_PREFIX}(${PHOTO_NAME})$`).test(id)) {
          return sendJson(res, 400, { error: 'Invalid id' });
        }
        key = id;
        await supabaseFetch(cfg, `/object/${encodeURIComponent(cfg.bucket)}/${key}`, { method: 'DELETE' })
          .catch(() => { /* weg oder bereits gelöscht — Upload folgt sowieso */ });
      } else {
        key = `${PHOTO_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      }
      // cacheControl als Query-Parameter (Header werden ignoriert) — sonst
      // cached die Supabase-CDN Uploads für 3600s
      await supabaseFetch(cfg, `/object/${encodeURIComponent(cfg.bucket)}/${key}?cacheControl=0`, {
        method: 'POST',
        headers: {
          'Content-Type': 'image/jpeg'
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

    if (req.method === 'DELETE') {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const id = params.get('id') || '';
      // Only photo objects inside the photos/ prefix may be trashed.
      if (!new RegExp(`^${PHOTO_PREFIX}(${PHOTO_NAME})$`).test(id)) {
        return sendJson(res, 400, { error: 'Invalid id' });
      }
      const name = id.slice(PHOTO_PREFIX.length);
      const expiresAt = Math.floor(Date.now() / 1000) + getTrashRetentionDays(req) * 86400;
      const trashId = `${TRASH_PREFIX}${expiresAt}-${name}`;
      await moveObject(cfg, id, trashId);
      return sendJson(res, 200, { ok: true, trashId });
    }

    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    // Quellobjekt fehlt (z. B. Race bei Doppelklicks) → idempotent 404,
    // damit der Client das als "bereits erledigt" behandeln kann
    if (/Supabase Storage 40[04]/.test(err.message)) {
      return sendJson(res, 404, { error: 'Object not found' });
    }
    console.error('Photo API error:', err.message);
    return sendJson(res, 500, { error: 'Server error' });
  }
}

// ---- /api/trash/count: Anzahl ohne die Bilder selbst herunterzuladen ----
async function handleTrashCountApi(req, res) {
  try {
    if (req.method !== 'GET') {
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    await purgeExpiredTrash();
    const cfg = getSupabaseConfig();
    const names = await listJpgNames(cfg, TRASH_PREFIX);
    return sendJson(res, 200, { count: names.length });
  } catch (err) {
    console.error('Trash count error:', err.message);
    return sendJson(res, 500, { error: 'Server error' });
  }
}

// ---- /api/trash: Papierkorb (auflisten / wiederherstellen / endgültig löschen) ----
async function handleTrashApi(req, res) {
  try {
    const cfg = getSupabaseConfig();
    const params = new URL(req.url, 'http://localhost').searchParams;
    const id = params.get('id') || '';
    const trashIdRe = new RegExp(`^${TRASH_PREFIX}(\\d{10,})-(${PHOTO_NAME})$`);

    if (req.method === 'GET') {
      await purgeExpiredTrash();
      const names = await listJpgNames(cfg, TRASH_PREFIX);
      const items = await Promise.all(names.map(async (name) => {
        const m = name.match(TRASH_NAME_RE);
        return {
          id: TRASH_PREFIX + name,
          image: await objectToDataUrl(cfg, TRASH_PREFIX + name),
          expiresAt: m ? Number(m[1]) : null,
          name: m ? m[2] : name
        };
      }));
      return sendJson(res, 200, items);
    }

    if (req.method === 'POST') { // restore: trash/<ts>-<name>.jpg -> photos/<name>.jpg
      const m = id.match(trashIdRe);
      if (!m) return sendJson(res, 400, { error: 'Invalid id' });
      await moveObject(cfg, id, PHOTO_PREFIX + m[2]);
      return sendJson(res, 200, { ok: true, id: PHOTO_PREFIX + m[2] });
    }

    if (req.method === 'DELETE') { // permanent delete
      const m = id.match(trashIdRe);
      if (!m) return sendJson(res, 400, { error: 'Invalid id' });
      await supabaseFetch(cfg, `/object/${encodeURIComponent(cfg.bucket)}/${id}`, { method: 'DELETE' });
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    // Quellobjekt fehlt (z. B. Race bei Doppelklicks) → idempotent 404,
    // damit der Client das als "bereits erledigt" behandeln kann
    if (/Supabase Storage 40[04]/.test(err.message)) {
      return sendJson(res, 404, { error: 'Object not found' });
    }
    console.error('Trash API error:', err.message);
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
  if (route === '/api/trash/count') {
    return handleTrashCountApi(req, res);
  }
  if (route === '/api/trash') {
    return handleTrashApi(req, res);
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
    // Dev server: never let the browser run a stale filters.js/asset after an
    // edit — browsers cache validator-less responses across reloads.
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
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

function startServer(server, protocol) {
  server.listen(PORT, '0.0.0.0', () => {
    const localIP = getLocalIP();
    console.log('─'.repeat(60));
    console.log(`  SnapBox ${protocol} Dev Server is running!`);
    console.log('─'.repeat(60));
    console.log('');
    console.log(`  Local:     ${protocol.toLowerCase()}://localhost:` + PORT);
    console.log(`  Network:   ${protocol.toLowerCase()}://${localIP}:` + PORT);
    console.log('');
    console.log('  On other devices (phones, tablets), open:');
    console.log(`  ${protocol.toLowerCase()}://${localIP}:` + PORT);
    console.log('');
    if (protocol === 'HTTPS') {
      console.log('  Accept the self-signed certificate warning');
      console.log('  (click "Advanced" -> "Proceed to <ip>")');
      console.log('');
    }
    console.log('  Press Ctrl+C to stop the server.');
    console.log('');
  });
}

// Purge expired trash on startup, then hourly.
purgeExpiredTrash();
setInterval(purgeExpiredTrash, PURGE_INTERVAL_MS);

// HTTP_ONLY=1 serves plain HTTP (for local automated testing only);
// the default remains HTTPS so getUserMedia works from other devices.
if (process.env.HTTP_ONLY === '1') {
  startServer(http.createServer(requestHandler), 'HTTP');
} else {
  // selfsigned v5: generate() is async, returns { cert, private }
  selfsigned.generate(
    [{ name: 'commonName', value: 'localhost' }],
    {
      keySize: 2048,
      algorithm: 'sha256',
      notAfterDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    }
  ).then((pems) => {
    startServer(https.createServer({ cert: pems.cert, key: pems.private }, requestHandler), 'HTTPS');
  }).catch((err) => {
    console.error('Failed to generate self-signed certificate:', err);
    process.exit(1);
  });
}
