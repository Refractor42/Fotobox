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
const { execFile } = require('child_process');

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

// Lists every .jpg object name under a prefix, beyond Supabase's 1000-object
// page limit. Only the usage statistics need the complete list; gallery and
// trash keep their single-page behaviour for fast first paints.
async function listAllJpgNames(cfg, prefix) {
  const names = [];
  const seen = new Set();
  for (let offset = 0; offset < 20000; offset += 1000) {
    const listRes = await supabaseFetch(cfg, `/object/list/${encodeURIComponent(cfg.bucket)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prefix,
        limit: 1000,
        offset,
        sortBy: { column: 'name', order: 'asc' }
      })
    });
    const files = await listRes.json();
    if (!Array.isArray(files) || files.length === 0) break;
    for (const file of files) {
      if (!file.name || !file.name.endsWith('.jpg')) continue;
      const name = file.name.replace(new RegExp('^' + prefix), '');
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
    if (files.length < 1000) break;
  }
  return names;
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

// ---- Nutzungsstatistik ----
// Leichtgewichtige Tagesaggregate liegen lokal in usage-stats.json. Fotos
// werden zusätzlich aus den Zeitstempeln der gespeicherten Objektnamen
// rekonstruiert (photos/<ms>-....jpg bzw. trash/<expiry>-<ms>-....jpg),
// dadurch zeigen die Diagramme sofort auch den vorhandenen Bestand.
// Endaktionen werden ab dem ersten Start nach diesem Update gezählt; ältere
// Aktionen lassen sich nicht nachträglich ermitteln.
const USAGE_STATS_FILE = path.join(DIST_DIR, 'usage-stats.json');
const USAGE_ACTIONS = ['qr', 'print', 'share', 'download'];
const USAGE_MAX_DAYS = 400;
const OBJECT_TS_RE = /^(\d{10,13})-/;

function localDateKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function emptyUsageDay() {
  return { photos: 0, actions: { qr: 0, print: 0, share: 0, download: 0 } };
}

function sanitizeUsageStats(raw) {
  const stats = { version: 1, startedAt: null, days: {} };
  if (!raw || typeof raw !== 'object') return stats;
  if (typeof raw.startedAt === 'string') stats.startedAt = raw.startedAt;
  const cutoff = localDateKey(new Date(Date.now() - USAGE_MAX_DAYS * 86400000));
  const days = raw.days && typeof raw.days === 'object' ? raw.days : {};
  for (const [key, value] of Object.entries(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key < cutoff) continue;
    const day = emptyUsageDay();
    day.photos = Math.max(0, Math.floor(Number(value && value.photos) || 0));
    for (const action of USAGE_ACTIONS) {
      day.actions[action] = Math.max(0, Math.floor(Number(value && value.actions && value.actions[action]) || 0));
    }
    stats.days[key] = day;
  }
  return stats;
}

function loadUsageStats() {
  try {
    if (fs.existsSync(USAGE_STATS_FILE)) {
      return sanitizeUsageStats(JSON.parse(fs.readFileSync(USAGE_STATS_FILE, 'utf8')));
    }
  } catch (err) {
    console.warn('Could not read usage-stats.json:', err.message);
  }
  return sanitizeUsageStats(null);
}

function saveUsageStats(stats) {
  // Kleine Datei, synchrones Schreiben: Node bedient die Anfragen seriell,
  // dadurch können parallele Zähler nicht verloren gehen.
  fs.writeFileSync(USAGE_STATS_FILE, JSON.stringify(stats, null, 2), 'utf8');
}

function recordUsage({ photos = 0, action = '' } = {}) {
  try {
    const stats = loadUsageStats();
    if (!stats.startedAt) stats.startedAt = new Date().toISOString();
    const key = localDateKey();
    const day = stats.days[key] || (stats.days[key] = emptyUsageDay());
    if (photos > 0) day.photos += Math.floor(photos);
    if (action && USAGE_ACTIONS.includes(action)) day.actions[action] += 1;
    const cutoff = localDateKey(new Date(Date.now() - USAGE_MAX_DAYS * 86400000));
    stats.days = Object.fromEntries(
      Object.entries(stats.days)
        .filter(([dateKey]) => dateKey >= cutoff)
        .sort(([a], [b]) => a.localeCompare(b))
    );
    saveUsageStats(stats);
  } catch (err) {
    console.warn('Usage statistics could not be recorded:', err.message);
  }
}

// Reads the capture timestamp encoded in an object name. Trash names keep the
// original photo name after the expiry prefix, so deleted photos still count.
function capturedAtMs(name, fromTrash = false) {
  let candidate = name;
  if (fromTrash) {
    const m = name.match(TRASH_NAME_RE);
    if (!m) return null;
    candidate = m[2];
  }
  const m = candidate.match(OBJECT_TS_RE);
  if (!m) return null;
  let ms = Number(m[1]);
  if (m[1].length === 10) ms *= 1000;
  const earliest = Date.UTC(2000, 0, 1);
  if (!Number.isFinite(ms) || ms < earliest || ms > Date.now() + 86400000) return null;
  return ms;
}

async function handleUsageStatsApi(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  // Nutzungsdaten sind interne Betriebsdaten und nur im Admin-Panel sichtbar.
  if (!isAdmin(req)) {
    return sendJson(res, 403, { error: 'Admin PIN required' });
  }

  const url = new URL(req.url, 'http://localhost');
  const requestedDays = Number.parseInt(url.searchParams.get('days'), 10);
  const rangeDays = [7, 14, 30].includes(requestedDays) ? requestedDays : 14;
  const stats = loadUsageStats();
  const today = new Date();
  const todayKey = localDateKey(today);
  const daily = [];
  const dailyByKey = new Map();
  for (let i = rangeDays - 1; i >= 0; i -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i, 12);
    const entry = { date: localDateKey(date), photos: 0 };
    daily.push(entry);
    dailyByKey.set(entry.date, entry);
  }

  let photoNames = [];
  let trashNames = [];
  let storageError = false;
  try {
    const cfg = getSupabaseConfig();
    [photoNames, trashNames] = await Promise.all([
      listAllJpgNames(cfg, PHOTO_PREFIX),
      listAllJpgNames(cfg, TRASH_PREFIX)
    ]);
  } catch (err) {
    storageError = true;
    console.warn('Usage stats could not read storage:', err.message);
  }

  const hours = Array(24).fill(0);
  let capturesInRange = 0;
  let photosToday = 0;
  for (const [names, fromTrash] of [[photoNames, false], [trashNames, true]]) {
    for (const name of names) {
      const ms = capturedAtMs(name, fromTrash);
      if (ms == null) continue;
      const date = new Date(ms);
      const key = localDateKey(date);
      if (key === todayKey) photosToday += 1;
      const row = dailyByKey.get(key);
      if (!row) continue;
      row.photos += 1;
      capturesInRange += 1;
      hours[date.getHours()] += 1;
    }
  }

  const actions = { qr: 0, print: 0, share: 0, download: 0 };
  for (const entry of daily) {
    const day = stats.days[entry.date];
    if (!day) continue;
    for (const action of USAGE_ACTIONS) actions[action] += day.actions[action];
  }

  let busiestDay = null;
  for (const entry of daily) {
    if (entry.photos > 0 && (!busiestDay || entry.photos > busiestDay.photos)) {
      busiestDay = { date: entry.date, photos: entry.photos };
    }
  }
  const peakHourValue = Math.max(...hours);
  const busiestHour = peakHourValue > 0 ? hours.indexOf(peakHourValue) : null;

  return sendJson(res, 200, {
    rangeDays,
    generatedAt: new Date().toISOString(),
    storageError,
    trackingSince: stats.startedAt,
    kpis: {
      totalPhotos: storageError ? null : photoNames.length,
      trashCount: storageError ? null : trashNames.length,
      capturesInRange: storageError ? null : capturesInRange,
      photosToday: storageError ? null : photosToday
    },
    daily,
    hours,
    actions,
    busiestDay,
    busiestHour
  });
}

async function handleUsageEventApi(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  try {
    const body = JSON.parse(await readBody(req, 4096));
    if (!body || !USAGE_ACTIONS.includes(body.event)) {
      return sendJson(res, 400, { error: 'Invalid event' });
    }
    recordUsage({ action: body.event });
    return sendJson(res, 200, { ok: true });
  } catch (err) {
    return sendJson(res, 400, { error: 'Invalid JSON' });
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
      recordUsage({ action: 'qr' });
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
      // Nur neue Aufnahmen zählen; Sticker-/Filter-Bearbeitungen überschreiben
      // ein vorhandenes Foto und sind keine zusätzliche Nutzung.
      if (!id) recordUsage({ photos: 1 });
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
        syncChallengeRemoval(id);
        return sendJson(res, 200, { ok: true, purged: true });
      }
      const name = id.slice(PHOTO_PREFIX.length);
      // Die Aufbewahrungsdauer ist eine Admin-Einstellung und wird nicht mehr
      // vom Client (Query-Parameter) bestimmt.
      const expiresAt = Math.floor(Date.now() / 1000) + readSettings().trashRetentionDays * 86400;
      const trashId = `${TRASH_PREFIX}${expiresAt}-${name}`;
      await moveObject(cfg, id, trashId);
      // Im Papierkorb ist das Foto öffentlich nicht mehr sichtbar. Beim
      // Wiederherstellen wird es bewusst nicht erneut eingereicht: Nicht jedes
      // wiederhergestellte Foto war zuvor Teil der Challenge.
      syncChallengeRemoval(id);
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
      syncChallengeRemoval(PHOTO_PREFIX + m[2]);
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
// Der API-Schlüssel der öffentlichen Challenge-App liegt bewusst NEBEN den
// Einstellungen in einer ignorierten Datei: settings.json ist versioniert und
// wird über /api/settings an alle Boxen verteilt — ein Schlüssel darin wäre
// für jeden Browser lesbar.
const CHALLENGE_SECRET_FILE = path.join(DIST_DIR, 'challenge-secret.json');
const CHALLENGE_LOCATIONS = ['lcc', 'coburg'];
const CHALLENGE_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const CHALLENGE_KEY_RE = /^[A-Za-z0-9_-]{20,128}$/;
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
  orientation: 'landscape',
  defaultLanguage: 'de',
  trashRetentionDays: 7,
  idleEndSeconds: 40,
  idleProcessSeconds: 75,
  idleWarnSeconds: 15,
  a11yResetSeconds: 12,
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
  buttonColor: '#12161e',
  buttonTransparency: 15,
  brandName: 'SnapBox',
  qrTtlHours: 24,
  challengeEnabled: false,
  challengeLocation: 'lcc',
  challengeAppUrl: '',
  updatedAt: null
});

function numberInRange(value, fallback, min, max) {
  const n = Number(value);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

// Nur eine Basis-URL ohne Zugangsdaten, Query oder Fragment. Der Kiosk baut
// daraus die API-Pfade und den QR-Code; alles andere wäre fehleranfällig.
function sanitizeChallengeAppUrl(value) {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw || raw.length > 300) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (url.username || url.password || url.search || url.hash) return '';
    return (url.origin + url.pathname).replace(/\/+$/, '');
  } catch (err) {
    return '';
  }
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
    // Hochformat wird nicht mehr unterstützt; alte Einstellungen werden
    // beim Lesen automatisch auf Querformat normalisiert.
    orientation: 'landscape',
    defaultLanguage: raw.defaultLanguage === 'en' ? 'en' : 'de',
    trashRetentionDays: [7, 14, 30].includes(retention) ? retention : DEFAULT_SETTINGS.trashRetentionDays,
    idleEndSeconds: numberInRange(raw.idleEndSeconds, DEFAULT_SETTINGS.idleEndSeconds, 15, 180),
    idleProcessSeconds: numberInRange(raw.idleProcessSeconds, DEFAULT_SETTINGS.idleProcessSeconds, 20, 300),
    idleWarnSeconds: numberInRange(raw.idleWarnSeconds, DEFAULT_SETTINGS.idleWarnSeconds, 5, 60),
    a11yResetSeconds: numberInRange(raw.a11yResetSeconds, DEFAULT_SETTINGS.a11yResetSeconds, 5, 60),
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
    buttonColor: typeof raw.buttonColor === 'string' && COLOR_RE.test(raw.buttonColor)
      ? raw.buttonColor.toLowerCase() : DEFAULT_SETTINGS.buttonColor,
    buttonTransparency: numberInRange(raw.buttonTransparency, DEFAULT_SETTINGS.buttonTransparency, 0, 100),
    brandName: brand || DEFAULT_SETTINGS.brandName,
    qrTtlHours: numberInRange(raw.qrTtlHours, DEFAULT_SETTINGS.qrTtlHours, 1, 168),
    challengeEnabled: raw.challengeEnabled === true,
    challengeLocation: raw.challengeLocation === 'coburg' ? 'coburg' : 'lcc',
    challengeAppUrl: sanitizeChallengeAppUrl(raw.challengeAppUrl),
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

function readChallengeKey() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CHALLENGE_SECRET_FILE, 'utf8'));
    const key = parsed && typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '';
    return CHALLENGE_KEY_RE.test(key) ? key : '';
  } catch (err) {
    return '';
  }
}

function writeChallengeKey(key) {
  fs.writeFileSync(
    CHALLENGE_SECRET_FILE,
    JSON.stringify({ apiKey: key }, null, 2) + '\n',
    { encoding: 'utf8', mode: 0o600 }
  );
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
    if (patch.orientation !== 'landscape') {
      throw new Error('Hochformat wird nicht mehr unterstützt.');
    }
    next.orientation = 'landscape';
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
  if (has('a11yResetSeconds')) next.a11yResetSeconds = assertInteger(patch.a11yResetSeconds, 'Barrierefreiheits-Reset', 5, 60);
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
  ['accentColor', 'secondaryColor', 'backgroundColor', 'buttonColor'].forEach((key) => {
    if (!has(key)) return;
    if (typeof patch[key] !== 'string' || !COLOR_RE.test(patch[key])) {
      throw new Error('Farben müssen als Hex-Wert (#rrggbb) angegeben werden.');
    }
    next[key] = patch[key].toLowerCase();
  });
  if (has('backgroundColor') && hexLuminance(next.backgroundColor) > MAX_BACKGROUND_LUMINANCE) {
    throw new Error('Der Hintergrund muss dunkel bleiben, damit die weiße Schrift lesbar ist.');
  }
  if (has('buttonTransparency')) {
    next.buttonTransparency = assertInteger(patch.buttonTransparency, 'Button-Transparenz', 0, 100);
  }
  if (has('brandName')) {
    const brand = typeof patch.brandName === 'string' ? patch.brandName.trim() : '';
    if (!brand || brand.length > BRAND_MAX_LENGTH || /[<>]/.test(brand)) {
      throw new Error(`Der Fotobox-Name muss 1–${BRAND_MAX_LENGTH} Zeichen lang sein.`);
    }
    next.brandName = brand;
  }
  if (has('qrTtlHours')) next.qrTtlHours = assertInteger(patch.qrTtlHours, 'QR-Gültigkeit', 1, 168);
  if (has('challengeEnabled')) {
    if (typeof patch.challengeEnabled !== 'boolean') throw new Error('Ungültiger Challenge-Schalter.');
    next.challengeEnabled = patch.challengeEnabled;
  }
  if (has('challengeLocation')) {
    if (!CHALLENGE_LOCATIONS.includes(patch.challengeLocation)) {
      throw new Error('Bitte LCC oder Coburg als Standort wählen.');
    }
    next.challengeLocation = patch.challengeLocation;
  }
  if (has('challengeAppUrl')) {
    const rawUrl = typeof patch.challengeAppUrl === 'string' ? patch.challengeAppUrl.trim() : '';
    const url = sanitizeChallengeAppUrl(rawUrl);
    if (rawUrl && !url) {
      throw new Error('Die Web-App-URL muss mit http:// oder https:// beginnen und ohne Query/Fragment auskommen.');
    }
    next.challengeAppUrl = url;
  }
  if (has('challengeApiKey')) {
    const key = typeof patch.challengeApiKey === 'string' ? patch.challengeApiKey.trim() : '';
    // Leer lassen heißt „bestehenden Schlüssel behalten“ — das Passwortfeld
    // zeigt den gespeicherten Wert nie an.
    if (key && !CHALLENGE_KEY_RE.test(key)) {
      throw new Error('Der API-Schlüssel muss 20–128 Zeichen aus A–Z, a–z, 0–9, _ oder - haben.');
    }
  }

  next.updatedAt = new Date().toISOString();
  return next;
}

function saveSettings(patch) {
  const next = validateSettingsPatch(patch);
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8');
  const key = typeof patch.challengeApiKey === 'string' ? patch.challengeApiKey.trim() : '';
  if (key) writeChallengeKey(key);
  return next;
}

async function handleSettingsApi(req, res) {
  if (req.method === 'GET') {
    const settings = readSettings();
    const localIP = getLocalIP();
    return sendJson(res, 200, {
      ...settings,
      // Nur ob ein Schlüssel existiert, nie der Schlüssel selbst.
      challengeApiKeySet: !!readChallengeKey(),
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
      return sendJson(res, 200, {
        ok: true,
        settings: saved,
        challengeApiKeySet: !!readChallengeKey()
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || 'Invalid JSON or settings' });
    }
  }
  return sendJson(res, 405, { error: 'Method not allowed' });
}

// ---- Challenge-App (öffentliche Web-App) ----
// Der Server ist die einzige Stelle, die den API-Schlüssel kennt. Der Kiosk
// fragt hier nach dem Monatsstand und reicht Fotos ein; der Browser bekommt
// weder Schlüssel noch direkten Zugriff auf die Challenge-API.
function currentChallengeMonth() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit'
  }).format(new Date());
}

function readChallengeConfig() {
  const settings = readSettings();
  const apiKey = readChallengeKey();
  return {
    enabled: settings.challengeEnabled === true,
    appUrl: settings.challengeAppUrl,
    location: settings.challengeLocation,
    apiKey,
    // Für Einreichungen muss die Challenge aktiv sein; für das Entfernen
    // gelöschter Fotos reicht eine vollständige Verbindung.
    configured: !!(settings.challengeAppUrl && apiKey)
  };
}

async function challengeFetch(urlPath, options = {}, timeoutMs = 15000) {
  const cfg = readChallengeConfig();
  if (!cfg.appUrl || !cfg.apiKey) {
    throw Object.assign(new Error('Die Challenge-App ist noch nicht vollständig eingerichtet.'), { status: 503 });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(cfg.appUrl + urlPath, {
      ...options,
      headers: {
        ...(options.headers || {}),
        'x-challenge-key': cfg.apiKey
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function handleChallengeSummaryApi(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  const cfg = readChallengeConfig();
  const url = new URL(req.url, 'http://localhost');
  const requested = url.searchParams.get('month') || '';
  const month = CHALLENGE_MONTH_RE.test(requested) ? requested : currentChallengeMonth();
  const base = {
    ok: true,
    enabled: cfg.enabled,
    configured: cfg.enabled && cfg.configured,
    online: false,
    location: cfg.location,
    month,
    appUrl: cfg.appUrl,
    entries: 0,
    votes: 0,
    score: 0
  };

  if (!cfg.enabled || !cfg.configured) {
    return sendJson(res, 200, base);
  }

  try {
    const query = new URLSearchParams({ location: cfg.location, month });
    const remote = await challengeFetch('/api/summary?' + query.toString());
    const data = await remote.json().catch(() => ({}));
    if (!remote.ok) throw new Error(data.error || ('HTTP ' + remote.status));
    return sendJson(res, 200, {
      ...base,
      online: true,
      entries: Number(data.entries) || 0,
      votes: Number(data.votes) || 0,
      score: Number(data.score) || 0,
      theme: typeof data.theme === 'string' ? data.theme : ''
    });
  } catch (err) {
    console.warn('Challenge summary failed:', err.message);
    return sendJson(res, 200, {
      ...base,
      error: 'Die Challenge-App ist gerade nicht erreichbar.'
    });
  }
}

async function handleChallengeEntryApi(req, res) {
  const cfg = readChallengeConfig();
  if (!cfg.enabled || !cfg.configured) {
    return sendJson(res, 503, { error: 'Die Challenge ist nicht eingerichtet oder ausgeschaltet.' });
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = JSON.parse(await readBody(req, 16 * 1024));
    } catch (err) {
      return sendJson(res, 400, { error: 'Invalid JSON' });
    }
    const photoId = body && typeof body.photoId === 'string' ? body.photoId : '';
    if (!new RegExp(`^${PHOTO_PREFIX}(${PHOTO_NAME})$`).test(photoId)) {
      return sendJson(res, 400, { error: 'Invalid photo id' });
    }
    // Nur das gerade aufgenommene Foto der laufenden Gäste-Sitzung darf
    // eingereicht werden — die Auswahl auf dem Endscreen bleibt verbindlich.
    const session = getPhotoSession(req);
    if (!session || !session.photoIds.has(photoId)) {
      return sendJson(res, 403, { error: 'Photo does not belong to this session' });
    }

    try {
      const supabase = getSupabaseConfig();
      const image = await objectToDataUrl(supabase, photoId);
      const month = currentChallengeMonth();
      const remote = await challengeFetch('/api/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photoId,
          location: cfg.location,
          month,
          image
        })
      }, 30000);
      const data = await remote.json().catch(() => ({}));
      if (!remote.ok) {
        return sendJson(res, remote.status, { error: data.error || 'Die Challenge hat das Foto nicht angenommen.' });
      }
      return sendJson(res, 200, {
        ok: true,
        id: data.id || null,
        duplicate: data.duplicate === true,
        month,
        location: cfg.location
      });
    } catch (err) {
      console.error('Challenge submit failed:', err.message);
      return sendJson(res, 502, { error: 'Die Challenge-App ist gerade nicht erreichbar.' });
    }
  }

  if (req.method === 'DELETE') {
    const url = new URL(req.url, 'http://localhost');
    const photoId = url.searchParams.get('photoId') || '';
    if (!new RegExp(`^${PHOTO_PREFIX}(${PHOTO_NAME})$`).test(photoId)) {
      return sendJson(res, 400, { error: 'Invalid photo id' });
    }
    const session = getPhotoSession(req);
    if (!isAdmin(req) && (!session || !session.photoIds.has(photoId))) {
      return sendJson(res, 403, { error: 'Photo does not belong to this session' });
    }
    try {
      const remote = await challengeFetch(
        '/api/entries?photoId=' + encodeURIComponent(photoId),
        { method: 'DELETE' },
        8000
      );
      const data = await remote.json().catch(() => ({}));
      if (!remote.ok) throw new Error(data.error || ('HTTP ' + remote.status));
      return sendJson(res, 200, { ok: true, removed: data.removed === true });
    } catch (err) {
      console.warn('Challenge delete failed:', err.message);
      return sendJson(res, 502, { error: 'Die Challenge-App ist gerade nicht erreichbar.' });
    }
  }

  return sendJson(res, 405, { error: 'Method not allowed' });
}

// Löscht den öffentlichen Challenge-Eintrag im Hintergrund. Fehler dürfen das
// Löschen in der Fotobox nie blockieren: Das Foto selbst ist bereits weg.
function syncChallengeRemoval(photoId) {
  const cfg = readChallengeConfig();
  if (!cfg.appUrl || !cfg.apiKey) return;
  challengeFetch('/api/entries?photoId=' + encodeURIComponent(photoId), { method: 'DELETE' }, 8000)
    .then(async (remote) => {
      if (!remote.ok) {
        const text = await remote.text().catch(() => '');
        console.warn('Challenge cleanup failed:', remote.status, text.slice(0, 160));
      }
    })
    .catch((err) => console.warn('Challenge cleanup failed:', err.message));
}

// ---- Druckerstatus ----
// Der Kiosk druckt ohne Dialog direkt auf den Standarddrucker. Ist dieser
// ein virtueller PDF-/XPS-Drucker, würde Windows einen Speichern-Dialog
// öffnen. Das muss die Fotobox vorher erkennen und den Druck abbrechen.
const VIRTUAL_PRINTER_RE = /(print to pdf|xps document writer|onenote|fax|pdf24|adobe pdf|cutepdf|bullzip|dopdf)/i;
const PRINTER_CACHE_MS = 30000;
let printerCache = null;

function queryDefaultPrinter() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      return resolve({ supported: false, printer: null, virtual: false, offline: false });
    }
    const script = 'Get-CimInstance Win32_Printer -Filter "Default=True" | '
      + 'Select-Object -First 1 Name,WorkOffline,PrinterStatus,PortName | ConvertTo-Json -Compress';
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 5000, windowsHide: true },
      (err, stdout) => {
        if (err) {
          return resolve({ supported: true, printer: null, virtual: false, offline: false, error: true });
        }
        let raw = null;
        try {
          raw = JSON.parse(String(stdout).trim() || 'null');
        } catch (e) {
          raw = null;
        }
        if (!raw || !raw.Name) {
          return resolve({ supported: true, printer: null, virtual: false, offline: false });
        }
        const name = String(raw.Name);
        const port = String(raw.PortName || '').toUpperCase();
        const virtual = VIRTUAL_PRINTER_RE.test(name)
          || port === 'PORTPROMPT:'
          || port === 'FILE:'
          || port === 'NUL:';
        resolve({
          supported: true,
          printer: name,
          virtual,
          offline: !!raw.WorkOffline,
          status: Number(raw.PrinterStatus) || 0
        });
      }
    );
  });
}

async function getPrinterInfo() {
  if (printerCache && Date.now() - printerCache.at < PRINTER_CACHE_MS) {
    return printerCache.data;
  }
  const data = await queryDefaultPrinter();
  printerCache = { at: Date.now(), data };
  return data;
}

async function handlePrinterApi(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  const info = await getPrinterInfo();
  return sendJson(res, 200, info);
}

// Nur Dateien ausliefern, die die Fotobox wirklich braucht. Insbesondere
// dürfen .env, settings.json und der Servercode nicht über HTTP abrufbar sein.
const BLOCKED_STATIC_FILES = new Set([
  '/.env',
  '/.env.example',
  '/.env.local',
  '/dev-https-server.js',
  '/settings.json',
  '/usage-stats.json',
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
  if (route === '/api/stats/event') {
    return handleUsageEventApi(req, res);
  }
  if (route === '/api/stats') {
    return handleUsageStatsApi(req, res);
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
  if (route === '/api/challenge/summary') {
    return handleChallengeSummaryApi(req, res);
  }
  if (route === '/api/challenge/entries') {
    return handleChallengeEntryApi(req, res);
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
  if (route === '/api/printer') {
    return handlePrinterApi(req, res);
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
