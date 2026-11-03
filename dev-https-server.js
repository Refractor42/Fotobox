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
const crypto = require('crypto');

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

// ---- Admin-PIN / Session ----
// Der PIN wird NUR serverseitig geprüft. In der .env lässt er sich über
// ADMIN_PIN ändern (4–8 Ziffern). Ohne eigenen PIN ist der Standard-PIN
// 1234 aktiv; die Login-Seite und die Admin-Seite weisen darauf hin.
const DEFAULT_ADMIN_PIN = '1234';
const rawAdminPin = String(process.env.ADMIN_PIN || '').trim();
const ADMIN_PIN = /^\d{4,8}$/.test(rawAdminPin) ? rawAdminPin : DEFAULT_ADMIN_PIN;
const ADMIN_COOKIE = 'snapbox_admin';
const ADMIN_SESSION_MS = 15 * 60 * 1000; // 15 Minuten
const ADMIN_SESSION_SECRET = crypto.randomBytes(32);
if (!/^\d{4,8}$/.test(rawAdminPin)) {
  console.warn('');
  console.warn(`  ⚠ ADMIN_PIN ${rawAdminPin ? 'ist ungültig (4–8 Ziffern)' : 'ist nicht gesetzt'} — Standard-PIN 1234 aktiv.`);
  console.warn('    Bitte ADMIN_PIN in .env setzen.');
  console.warn('');
}

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

// ---- Admin-Authentifizierung (PIN + signierte HttpOnly-Session) ----
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch (e) {
      out[key] = part.slice(idx + 1).trim();
    }
  }
  return out;
}

function signAdminSession(exp) {
  return crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(String(exp)).digest('base64url');
}

function createAdminSession() {
  const exp = Date.now() + ADMIN_SESSION_MS;
  return `${exp}.${signAdminSession(exp)}`;
}

function verifyAdminSession(token) {
  if (typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const expRaw = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = signAdminSession(expRaw);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isAdmin(req) {
  return verifyAdminSession(parseCookies(req)[ADMIN_COOKIE]);
}

// ---- Gäste-Sitzung ----
// Löschen ist nur während einer laufenden Gäste-Sitzung erlaubt, und nur für
// Fotos, die in genau dieser Sitzung hochgeladen wurden. Die Sitzung beginnt
// mit dem Startbildschirm-Start und endet beim Zurückspringen dorthin. Gäste
// löschen endgültig und haben keinen Papierkorb; der Papierkorb gehört
// ausschließlich zum Admin-Panel.
const PHOTO_SESSION_HEADER = 'x-photo-session';
const PHOTO_SESSION_MS = 4 * 60 * 60 * 1000;
const photoSessions = new Map();

function getPhotoSession(req) {
  const token = String(req.headers[PHOTO_SESSION_HEADER] || '').trim();
  if (!/^[a-f0-9]{32,64}$/.test(token)) return null;
  const session = photoSessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    photoSessions.delete(token);
    return null;
  }
  return session;
}

function endPhotoSession(req) {
  const token = String(req.headers[PHOTO_SESSION_HEADER] || '').trim();
  if (token) photoSessions.delete(token);
}

async function handlePhotoSessionApi(req, res) {
  if (req.method === 'POST') {
    const token = crypto.randomBytes(24).toString('hex');
    photoSessions.set(token, {
      expiresAt: Date.now() + PHOTO_SESSION_MS,
      photoIds: new Set()
    });
    return sendJson(res, 201, { token });
  }
  if (req.method === 'DELETE') {
    endPhotoSession(req);
    return sendJson(res, 200, { ok: true });
  }
  return sendJson(res, 405, { error: 'Method not allowed' });
}

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of photoSessions) {
    if (session.expiresAt < now) photoSessions.delete(token);
  }
}, 15 * 60 * 1000).unref();

function setAdminCookie(req, res) {
  const secure = req.socket.encrypted ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_COOKIE}=${createAdminSession()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(ADMIN_SESSION_MS / 1000)}${secure}`
  );
}

function clearAdminCookie(req, res) {
  const secure = req.socket.encrypted ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}

function pinsEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

// Begrenzt PIN-Versuche pro Client: 5 Fehlversuche, danach 5 Minuten Sperre.
const loginFailures = new Map();
const LOGIN_WINDOW_MS = 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MS = 5 * 60 * 1000;

function loginRateState(ip) {
  const now = Date.now();
  let state = loginFailures.get(ip);
  if (!state) {
    state = { count: 0, windowStart: now, lockedUntil: 0 };
    loginFailures.set(ip, state);
  }
  if (state.lockedUntil && now < state.lockedUntil) {
    return { locked: true, retryAfter: Math.ceil((state.lockedUntil - now) / 1000) };
  }
  if (state.lockedUntil && now >= state.lockedUntil) {
    state.count = 0;
    state.windowStart = now;
    state.lockedUntil = 0;
  }
  if (now - state.windowStart > LOGIN_WINDOW_MS) {
    state.count = 0;
    state.windowStart = now;
  }
  return { locked: false };
}

function recordLoginFailure(ip) {
  const state = loginFailures.get(ip) || { count: 0, windowStart: Date.now(), lockedUntil: 0 };
  state.count += 1;
  if (state.count >= LOGIN_MAX_FAILURES) {
    state.lockedUntil = Date.now() + LOGIN_LOCK_MS;
  }
  loginFailures.set(ip, state);
}

function clearLoginFailures(ip) {
  loginFailures.delete(ip);
}

async function handleAdminLoginApi(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  const ip = req.socket.remoteAddress || 'unknown';
  const rate = loginRateState(ip);
  if (rate.locked) {
    return sendJson(res, 429, { error: 'Too many attempts', retryAfter: rate.retryAfter });
  }
  try {
    const body = JSON.parse(await readBody(req, 1024));
    const pin = body && typeof body.pin === 'string' ? body.pin.trim() : '';
    if (!/^\d{4,8}$/.test(pin) || !pinsEqual(pin, ADMIN_PIN)) {
      recordLoginFailure(ip);
      return sendJson(res, 401, { error: 'Invalid PIN' });
    }
    clearLoginFailures(ip);
    setAdminCookie(req, res);
    return sendJson(res, 200, { ok: true, expiresIn: Math.floor(ADMIN_SESSION_MS / 1000) });
  } catch (err) {
    return sendJson(res, 400, { error: 'Invalid request' });
  }
}

function handleAdminLogoutApi(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  clearAdminCookie(req, res);
  return sendJson(res, 200, { ok: true });
}

function getAdminSessionExpiresAt(req) {
  const token = parseCookies(req)[ADMIN_COOKIE];
  if (typeof token !== 'string') return 0;
  const dot = token.indexOf('.');
  if (dot < 1) return 0;
  const exp = Number(token.slice(0, dot));
  return Number.isFinite(exp) ? exp : 0;
}

function handleAdminSessionApi(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  const authenticated = isAdmin(req);
  const expiresIn = authenticated
    ? Math.max(0, Math.floor((getAdminSessionExpiresAt(req) - Date.now()) / 1000))
    : 0;
  return sendJson(res, 200, {
    authenticated,
    // Nur eingeloggte Admins erfahren, ob der Standard-PIN aktiv ist.
    pinIsDefault: authenticated && ADMIN_PIN === DEFAULT_ADMIN_PIN,
    expiresIn
  });
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
      const qrTtlSeconds = readSettings().qrTtlHours * 3600;
      const signRes = await supabaseFetch(cfg, `/object/sign/${encodeURIComponent(cfg.bucket)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: qrTtlSeconds, paths: [id] })
      });
      const body = await signRes.json();
      // Storage-API antwortet mit einem Array [{ error, path, signedURL }]
      const item = (Array.isArray(body) ? body[0] : (body.data && body.data[0])) || {};
      const rel = item.signedUrl || item.signedURL || '';
      if (!rel) throw new Error('no signed url in response');
      const url = rel.startsWith('http') ? rel : cfg.baseUrl + '/storage/v1' + rel;
      return sendJson(res, 200, { url, ttl: qrTtlSeconds });
    }

    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const names = await listJpgNames(cfg, PHOTO_PREFIX);

      // Ohne limit bleibt die alte Vollliste erhalten (Abwärtskompatibilität).
      if (!url.searchParams.has('limit')) {
        const items = await Promise.all(names.map(async (name) => ({
          id: PHOTO_PREFIX + name,
          image: await objectToDataUrl(cfg, PHOTO_PREFIX + name)
        })));
        return sendJson(res, 200, items);
      }

      const requestedLimit = Number.parseInt(url.searchParams.get('limit'), 10);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(50, Math.max(1, requestedLimit))
        : 12;
      const before = url.searchParams.get('before') || '';
      if (before && !new RegExp(`^${PHOTO_NAME}$`).test(before)) {
        return sendJson(res, 400, { error: 'Invalid cursor' });
      }

      // Neueste zuerst; der Cursor ist der letzte Name der vorherigen Seite.
      const sorted = names.slice().sort().reverse();
      const eligible = before ? sorted.filter((name) => name < before) : sorted;
      const pageNames = eligible.slice(0, limit);
      const items = await Promise.all(pageNames.map(async (name) => ({
        id: PHOTO_PREFIX + name,
        image: await objectToDataUrl(cfg, PHOTO_PREFIX + name)
      })));

      return sendJson(res, 200, {
        items,
        // Alle IDs ohne Bilddaten: Challenge-Zähler und Gesamtzahl bleiben
        // korrekt, auch wenn nur eine Seite mit Bildern geladen ist.
        allIds: sorted.map((name) => PHOTO_PREFIX + name),
        total: sorted.length,
        hasMore: eligible.length > pageNames.length,
        nextCursor: pageNames.length ? pageNames[pageNames.length - 1] : null
      });
    }

    if (req.method === 'POST') {
      const { image, id } = JSON.parse(await readBody(req, 15 * 1024 * 1024));
      const session = getPhotoSession(req);
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
      // Nur Fotos dieser Sitzung dürfen vom Gast später gelöscht werden.
      if (session) session.photoIds.add(key);
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
      const admin = isAdmin(req);
      const session = getPhotoSession(req);
      // Gäste dürfen nur während ihrer laufenden Sitzung löschen. Danach ist
      // die Aktion ausschließlich im Admin-Panel möglich.
      if (!admin && !session) {
        return sendJson(res, 403, { error: 'Deleting is only allowed during a guest session' });
      }
      // Only photo objects inside the photos/ prefix may be deleted.
      if (!new RegExp(`^${PHOTO_PREFIX}(${PHOTO_NAME})$`).test(id)) {
        return sendJson(res, 400, { error: 'Invalid id' });
      }
      // Gäste dürfen ausschließlich Fotos löschen, die in ihrer aktuellen
      // Sitzung aufgenommen wurden — nicht den Bestand früherer Gäste.
      if (!admin && !session.photoIds.has(id)) {
        return sendJson(res, 403, { error: 'Photo does not belong to this session' });
      }
      // Gäste löschen endgültig: Es gibt für sie keinen Papierkorb. Das
      // Admin-Panel verschiebt Fotos weiterhin in den Papierkorb.
      if (params.get('purge') === '1' || session) {
        await supabaseFetch(cfg, `/object/${encodeURIComponent(cfg.bucket)}/${id}`, { method: 'DELETE' });
        if (session) session.photoIds.delete(id);
        return sendJson(res, 200, { ok: true, purged: true });
      }
      const name = id.slice(PHOTO_PREFIX.length);
      // Die Aufbewahrungsdauer ist eine Admin-Einstellung und wird nicht mehr
      // vom Client (Query-Parameter) bestimmt.
      const expiresAt = Math.floor(Date.now() / 1000) + readSettings().trashRetentionDays * 86400;
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
    // Der Papierkorb ist ausschließlich im Admin-Panel sichtbar.
    if (!isAdmin(req)) {
      return sendJson(res, 403, { error: 'Admin PIN required' });
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
    // Der Papierkorb ist ausschließlich im Admin-Panel sichtbar.
    if (!isAdmin(req)) {
      return sendJson(res, 403, { error: 'Admin PIN required' });
    }

    if (req.method === 'GET') {
      await purgeExpiredTrash();
      const names = await listJpgNames(cfg, TRASH_PREFIX);

      // Ohne limit bleibt die alte Vollliste erhalten (Abwärtskompatibilität).
      // Die aktuelle App fordert immer genau eine Seite an.
      if (!params.has('limit')) {
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

      const requestedLimit = Number.parseInt(params.get('limit'), 10);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(50, Math.max(1, requestedLimit))
        : 12;
      const before = params.get('before') || '';
      if (before && !TRASH_NAME_RE.test(before)) {
        return sendJson(res, 400, { error: 'Invalid cursor' });
      }

      // Neueste Löschungen zuerst. Der Zeitstempel steht am Namensanfang,
      // deshalb funktioniert dieselbe Cursor-Logik wie bei den Fotos.
      const sorted = names.slice().sort().reverse();
      const eligible = before ? sorted.filter((name) => name < before) : sorted;
      const pageNames = eligible.slice(0, limit);
      const items = await Promise.all(pageNames.map(async (name) => {
        const m = name.match(TRASH_NAME_RE);
        return {
          id: TRASH_PREFIX + name,
          image: await objectToDataUrl(cfg, TRASH_PREFIX + name),
          expiresAt: m ? Number(m[1]) : null,
          name: m ? m[2] : name
        };
      }));

      return sendJson(res, 200, {
        items,
        total: sorted.length,
        hasMore: eligible.length > pageNames.length,
        nextCursor: pageNames.length ? pageNames[pageNames.length - 1] : null
      });
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


// ---- Settings API (/api/settings) ----
// Eine gemeinsame, flache Struktur für alle Stellschrauben der Fotobox. Der
// Server ist die einzige Quelle der Wahrheit; das Admin-Panel schickt immer
// nur die geänderten Felder. So bleiben mehrere Terminals synchron.
const SETTINGS_FILE = path.join(DIST_DIR, 'settings.json');
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const BRAND_MAX_LENGTH = 32;
// Die Fotobox ist gestalterisch ein Dark-Theme. Ein zu heller Hintergrund
// würde die weiße Schrift und die Glasflächen unlesbar machen.
const MAX_BACKGROUND_LUMINANCE = 0.18;

function hexLuminance(hex) {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  const linear = channels.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

const DEFAULT_SETTINGS = Object.freeze({
  orientation: 'portrait',
  defaultLanguage: 'de',
  trashRetentionDays: 7,
  idleEndSeconds: 40,
  idleProcessSeconds: 75,
  idleWarnSeconds: 15,
  defaultCountdownSeconds: 5,
  defaultCaptureMode: 'single',
  defaultSound: true,
  filtersEnabled: true,
  stickersEnabled: true,
  overlaysEnabled: true,
  cameraFacingMode: 'environment',
  galleryPageSize: 12,
  accentColor: '#ffd700',
  secondaryColor: '#00e0d6',
  backgroundColor: '#0d0d0d',
  brandName: 'SnapBox',
  qrTtlHours: 24,
  updatedAt: null
});

function numberInRange(value, fallback, min, max) {
  const n = Number(value);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function sanitizeSettings(data) {
  const raw = data && typeof data === 'object' ? data : {};
  const retention = Number(raw.trashRetentionDays);
  const pageSize = Number(raw.galleryPageSize);
  const countdown = Number(raw.defaultCountdownSeconds);
  const brand = typeof raw.brandName === 'string' ? raw.brandName.trim().slice(0, BRAND_MAX_LENGTH) : '';
  const background = typeof raw.backgroundColor === 'string' && COLOR_RE.test(raw.backgroundColor)
    ? raw.backgroundColor.toLowerCase() : DEFAULT_SETTINGS.backgroundColor;
  const safeBackground = hexLuminance(background) <= MAX_BACKGROUND_LUMINANCE
    ? background : DEFAULT_SETTINGS.backgroundColor;

  const settings = {
    orientation: raw.orientation === 'landscape' ? 'landscape' : 'portrait',
    defaultLanguage: raw.defaultLanguage === 'en' ? 'en' : 'de',
    trashRetentionDays: [7, 14, 30].includes(retention) ? retention : DEFAULT_SETTINGS.trashRetentionDays,
    idleEndSeconds: numberInRange(raw.idleEndSeconds, DEFAULT_SETTINGS.idleEndSeconds, 15, 180),
    idleProcessSeconds: numberInRange(raw.idleProcessSeconds, DEFAULT_SETTINGS.idleProcessSeconds, 20, 300),
    idleWarnSeconds: numberInRange(raw.idleWarnSeconds, DEFAULT_SETTINGS.idleWarnSeconds, 5, 60),
    defaultCountdownSeconds: [3, 5, 10].includes(countdown) ? countdown : DEFAULT_SETTINGS.defaultCountdownSeconds,
    defaultCaptureMode: raw.defaultCaptureMode === 'strip' ? 'strip' : 'single',
    defaultSound: raw.defaultSound !== false,
    filtersEnabled: raw.filtersEnabled !== false,
    stickersEnabled: raw.stickersEnabled !== false,
    overlaysEnabled: raw.overlaysEnabled !== false,
    cameraFacingMode: raw.cameraFacingMode === 'user' ? 'user' : 'environment',
    galleryPageSize: [6, 12, 24].includes(pageSize) ? pageSize : DEFAULT_SETTINGS.galleryPageSize,
    accentColor: typeof raw.accentColor === 'string' && COLOR_RE.test(raw.accentColor)
      ? raw.accentColor.toLowerCase() : DEFAULT_SETTINGS.accentColor,
    secondaryColor: typeof raw.secondaryColor === 'string' && COLOR_RE.test(raw.secondaryColor)
      ? raw.secondaryColor.toLowerCase() : DEFAULT_SETTINGS.secondaryColor,
    backgroundColor: safeBackground,
    brandName: brand || DEFAULT_SETTINGS.brandName,
    qrTtlHours: numberInRange(raw.qrTtlHours, DEFAULT_SETTINGS.qrTtlHours, 1, 168),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null
  };

  // Die Warnung muss kürzer sein als beide Inaktivitätsfristen, sonst würde
  // der Countdown den Reset überholen. Alte Dateien werden dabei repariert.
  settings.idleWarnSeconds = Math.max(5, Math.min(
    settings.idleWarnSeconds,
    settings.idleEndSeconds - 5,
    settings.idleProcessSeconds - 5
  ));
  return settings;
}

function readSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return sanitizeSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')));
    }
  } catch (err) {
    console.warn('Could not read settings.json:', err.message);
  }
  return { ...DEFAULT_SETTINGS };
}

function assertInteger(value, name, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} muss eine ganze Zahl zwischen ${min} und ${max} sein.`);
  }
  return n;
}

function validateSettingsPatch(patch) {
  const next = { ...readSettings() };
  const has = (key) => Object.prototype.hasOwnProperty.call(patch, key);

  if (has('orientation')) {
    if (patch.orientation !== 'portrait' && patch.orientation !== 'landscape') {
      throw new Error('Ungültige Ausrichtung.');
    }
    next.orientation = patch.orientation;
  }
  if (has('defaultLanguage')) {
    if (patch.defaultLanguage !== 'de' && patch.defaultLanguage !== 'en') {
      throw new Error('Ungültige Standardsprache.');
    }
    next.defaultLanguage = patch.defaultLanguage;
  }
  if (has('trashRetentionDays')) {
    const days = assertInteger(patch.trashRetentionDays, 'Aufbewahrung', 7, 30);
    if (![7, 14, 30].includes(days)) throw new Error('Ungültige Aufbewahrungsdauer.');
    next.trashRetentionDays = days;
  }
  if (has('idleEndSeconds')) next.idleEndSeconds = assertInteger(patch.idleEndSeconds, 'Endscreen-Zeit', 15, 180);
  if (has('idleProcessSeconds')) next.idleProcessSeconds = assertInteger(patch.idleProcessSeconds, 'Ablauf-Zeit', 20, 300);
  if (has('idleWarnSeconds')) next.idleWarnSeconds = assertInteger(patch.idleWarnSeconds, 'Warnzeit', 5, 60);
  if (next.idleWarnSeconds >= next.idleEndSeconds || next.idleWarnSeconds >= next.idleProcessSeconds) {
    throw new Error('Die Warnzeit muss kürzer als beide Inaktivitätszeiten sein.');
  }
  if (has('defaultCountdownSeconds')) {
    const seconds = Number(patch.defaultCountdownSeconds);
    if (![3, 5, 10].includes(seconds)) throw new Error('Ungültiger Countdown-Standard.');
    next.defaultCountdownSeconds = seconds;
  }
  if (has('defaultCaptureMode')) {
    if (patch.defaultCaptureMode !== 'single' && patch.defaultCaptureMode !== 'strip') {
      throw new Error('Ungültiger Aufnahmemodus.');
    }
    next.defaultCaptureMode = patch.defaultCaptureMode;
  }
  if (has('defaultSound')) {
    if (typeof patch.defaultSound !== 'boolean') throw new Error('Ungültiger Ton-Standard.');
    next.defaultSound = patch.defaultSound;
  }
  ['filtersEnabled', 'stickersEnabled', 'overlaysEnabled'].forEach((key) => {
    if (!has(key)) return;
    if (typeof patch[key] !== 'boolean') throw new Error('Ungültige Gäste-Funktion.');
    next[key] = patch[key];
  });
  if (has('cameraFacingMode')) {
    if (patch.cameraFacingMode !== 'environment' && patch.cameraFacingMode !== 'user') {
      throw new Error('Ungültige Kameraseite.');
    }
    next.cameraFacingMode = patch.cameraFacingMode;
  }
  if (has('galleryPageSize')) {
    const size = Number(patch.galleryPageSize);
    if (![6, 12, 24].includes(size)) throw new Error('Ungültige Galerie-Seitengröße.');
    next.galleryPageSize = size;
  }
  ['accentColor', 'secondaryColor', 'backgroundColor'].forEach((key) => {
    if (!has(key)) return;
    if (typeof patch[key] !== 'string' || !COLOR_RE.test(patch[key])) {
      throw new Error('Farben müssen als Hex-Wert (#rrggbb) angegeben werden.');
    }
    next[key] = patch[key].toLowerCase();
  });
  if (has('backgroundColor') && hexLuminance(next.backgroundColor) > MAX_BACKGROUND_LUMINANCE) {
    throw new Error('Der Hintergrund muss dunkel bleiben, damit die weiße Schrift lesbar ist.');
  }
  if (has('brandName')) {
    const brand = typeof patch.brandName === 'string' ? patch.brandName.trim() : '';
    if (!brand || brand.length > BRAND_MAX_LENGTH || /[<>]/.test(brand)) {
      throw new Error(`Der Fotobox-Name muss 1–${BRAND_MAX_LENGTH} Zeichen lang sein.`);
    }
    next.brandName = brand;
  }
  if (has('qrTtlHours')) next.qrTtlHours = assertInteger(patch.qrTtlHours, 'QR-Gültigkeit', 1, 168);

  next.updatedAt = new Date().toISOString();
  return next;
}

function saveSettings(patch) {
  const next = validateSettingsPatch(patch);
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

async function handleSettingsApi(req, res) {
  if (req.method === 'GET') {
    const settings = readSettings();
    const localIP = getLocalIP();
    return sendJson(res, 200, {
      ...settings,
      server: {
        port: PORT,
        localIP,
        localUrl: 'https://localhost:' + PORT,
        networkUrl: 'https://' + localIP + ':' + PORT
      }
    });
  }
  if (req.method === 'POST') {
    if (!isAdmin(req)) {
      return sendJson(res, 401, { error: 'Admin PIN required' });
    }
    try {
      const body = JSON.parse(await readBody(req, 64 * 1024));
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return sendJson(res, 400, { error: 'Invalid JSON or settings' });
      }
      const saved = saveSettings(body);
      return sendJson(res, 200, { ok: true, settings: saved });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || 'Invalid JSON or settings' });
    }
  }
  return sendJson(res, 405, { error: 'Method not allowed' });
}

// Nur Dateien ausliefern, die die Fotobox wirklich braucht. Insbesondere
// dürfen .env, settings.json und der Servercode nicht über HTTP abrufbar sein.
const BLOCKED_STATIC_FILES = new Set([
  '/.env',
  '/.env.example',
  '/.env.local',
  '/dev-https-server.js',
  '/settings.json',
  '/package.json',
  '/package-lock.json',
  '/Fotobox-Kiosk.cmd'
]);
const BLOCKED_STATIC_DIRS = ['/.git', '/.tmp', '/node_modules', '/supabase'];

function isBlockedStaticPath(urlPath) {
  // Backslashes sind unter Windows Pfadtrenner und könnten die Segmentprüfung
  // umgehen (z. B. /foo%5c..%5c.env). NUL-Bytes lehnen wir ebenfalls ab.
  if (urlPath.includes('\\') || urlPath.includes('\0')) return true;
  if (BLOCKED_STATIC_FILES.has(urlPath)) return true;
  if (BLOCKED_STATIC_DIRS.some((dir) => urlPath === dir || urlPath.startsWith(dir + '/'))) return true;
  // Keine versteckten Dateien/Ordner (z. B. .env, .git, .tmp).
  return urlPath.split('/').some((segment) => segment.startsWith('.'));
}

const requestHandler = (req, res) => {
  const route = req.url.split('?')[0];
  if (route === '/api/photos') {
    return handlePhotosApi(req, res);
  }
  if (route === '/api/photo-session') {
    return handlePhotoSessionApi(req, res);
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
  if (route === '/api/settings') {
    return handleSettingsApi(req, res);
  }
  if (route === '/api/admin/login') {
    return handleAdminLoginApi(req, res);
  }
  if (route === '/api/admin/logout') {
    return handleAdminLogoutApi(req, res);
  }
  if (route === '/api/admin/session') {
    return handleAdminSessionApi(req, res);
  }

  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  if (isBlockedStaticPath(urlPath)) {
    res.writeHead(404);
    return res.end('Not Found');
  }

  const admin = isAdmin(req);
  if (urlPath === '/admin' || urlPath === '/admin/' || urlPath === '/admin.html') {
    // Ohne gültige Session immer die PIN-Seite ausliefern. Der Hash
    // (#retention) bleibt dabei im Browser erhalten.
    urlPath = admin ? '/admin.html' : '/admin-login.html';
  } else if (urlPath === '/admin-login.html' && admin) {
    res.writeHead(302, { Location: '/admin' });
    return res.end();
  }

  const filePath = path.join(DIST_DIR, urlPath);
  const ext = path.extname(filePath).toLowerCase();

  // Prevent path traversal (auch auf Windows mit Laufwerks-/Backslash-Fällen)
  const relativePath = path.relative(DIST_DIR, filePath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
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
