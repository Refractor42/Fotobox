/* ============================================================
   SnapBox Challenge — öffentliche Web-App
   - nimmt Challenge-Fotos von den Fotoboxen entgegen (API-Key)
   - zeigt Leaderboard, Galerie, Likes und Pokale
   - D1 für Daten, R2 für die Challenge-Bilder
   ============================================================ */

const LOCATIONS = ['lcc', 'coburg'];
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID_RE = /^[0-9a-f-]{36}$/i;
const VOTER_RE = /^[A-Za-z0-9_-]{8,64}$/;

const THEMES = [
  'Neuer Start',
  'Liebe & Winter',
  'Frühlingswachen',
  'Bunt & Verrückt',
  'Blütenpracht',
  'Sommer-Vibes',
  'Strand & Sonne',
  'Heiße Nächte',
  'Goldener Herbst',
  'Halloween & Laub',
  'Gemütlichkeit',
  'Winterzauber'
];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS challenge_entries (
    id TEXT PRIMARY KEY,
    photo_id TEXT NOT NULL UNIQUE,
    location TEXT NOT NULL,
    month TEXT NOT NULL,
    image_key TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_challenge_entries_month ON challenge_entries(month)',
  'CREATE INDEX IF NOT EXISTS idx_challenge_entries_location_month ON challenge_entries(location, month)',
  `CREATE TABLE IF NOT EXISTS challenge_votes (
    entry_id TEXT NOT NULL,
    voter_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (entry_id, voter_id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_challenge_votes_entry ON challenge_votes(entry_id)',
  `CREATE TABLE IF NOT EXISTS challenge_trophies (
    month TEXT PRIMARY KEY,
    location TEXT NOT NULL,
    votes INTEGER NOT NULL,
    entries INTEGER NOT NULL,
    awarded_at TEXT NOT NULL
  )`
];

let schemaReady = false;
let lastFinalize = 0;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    }
  });
}

function fail(message, status = 400) {
  return json({ error: message }, status);
}

function currentMonth() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit'
  }).format(new Date());
}

function themeForMonth(month) {
  const n = Number(month.slice(5, 7));
  return THEMES[n - 1] || 'Monatsmotiv';
}

function cleanMonth(value) {
  return typeof value === 'string' && MONTH_RE.test(value) ? value : null;
}

function cleanVoterId(value) {
  return typeof value === 'string' && VOTER_RE.test(value) ? value : null;
}

function cleanPhotoId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  if (!id || id.length > 200 || /[\\\u0000-\u001f]/.test(id)) return null;
  return id;
}

function keyMatches(request, env) {
  const expected = env.CHALLENGE_API_KEY || '';
  if (!expected) return false;
  const provided = request.headers.get('x-challenge-key') || '';
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}

async function ensureSchema(env) {
  if (!env.DB) throw Object.assign(new Error('D1 ist nicht verbunden.'), { status: 503 });
  if (schemaReady) return;
  for (const sql of SCHEMA) {
    await env.DB.prepare(sql).run();
  }
  schemaReady = true;
}

async function readJson(request, maxBytes = 20 * 1024 * 1024) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > maxBytes) throw Object.assign(new Error('Anfrage ist zu groß.'), { status: 413 });
  const text = await request.text();
  if (text.length > maxBytes) throw Object.assign(new Error('Anfrage ist zu groß.'), { status: 413 });
  try {
    return JSON.parse(text);
  } catch (e) {
    throw Object.assign(new Error('Ungültiges JSON.'), { status: 400 });
  }
}

function decodeJpegDataUrl(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  let binary;
  try {
    binary = atob(match[1]);
  } catch (e) {
    return null;
  }
  if (binary.length < 4) return null;
  if (binary.charCodeAt(0) !== 0xff || binary.charCodeAt(1) !== 0xd8 || binary.charCodeAt(2) !== 0xff) {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function entryByPhotoId(env, photoId) {
  return env.DB.prepare(
    'SELECT id, photo_id, location, month, image_key, created_at FROM challenge_entries WHERE photo_id = ?'
  ).bind(photoId).first();
}

async function handleEntries(request, env) {
  if (!keyMatches(request, env)) {
    return fail('Nicht autorisiert.', env.CHALLENGE_API_KEY ? 401 : 503);
  }

  if (request.method === 'POST') {
    const body = await readJson(request);
    const photoId = cleanPhotoId(body.photoId);
    const location = LOCATIONS.includes(body.location) ? body.location : null;
    const month = cleanMonth(body.month);
    if (!photoId) return fail('Ungültige Foto-ID.');
    if (!location) return fail('Ungültiger Standort.');
    if (!month) return fail('Ungültiger Monat.');

    const existing = await entryByPhotoId(env, photoId);
    if (existing) {
      return json({ ok: true, id: existing.id, duplicate: true });
    }

    const bytes = decodeJpegDataUrl(body.image);
    if (!bytes) return fail('Ungültiges JPEG.');

    const id = crypto.randomUUID();
    const imageKey = `challenge/${month}/${id}.jpg`;
    await env.FILES.put(imageKey, bytes, {
      httpMetadata: {
        contentType: 'image/jpeg',
        cacheControl: 'public, max-age=31536000, immutable'
      }
    });

    try {
      await env.DB.prepare(
        'INSERT INTO challenge_entries (id, photo_id, location, month, image_key, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(id, photoId, location, month, imageKey, new Date().toISOString()).run();
    } catch (err) {
      await env.FILES.delete(imageKey).catch(() => {});
      const again = await entryByPhotoId(env, photoId);
      if (again) return json({ ok: true, id: again.id, duplicate: true });
      throw err;
    }

    return json({ ok: true, id, imageUrl: `/img/${id}` }, 201);
  }

  if (request.method === 'DELETE') {
    const url = new URL(request.url);
    const photoId = cleanPhotoId(url.searchParams.get('photoId'));
    if (!photoId) return fail('Ungültige Foto-ID.');
    const entry = await entryByPhotoId(env, photoId);
    if (!entry) return json({ ok: true, removed: false });
    await env.DB.prepare('DELETE FROM challenge_votes WHERE entry_id = ?').bind(entry.id).run();
    await env.DB.prepare('DELETE FROM challenge_entries WHERE id = ?').bind(entry.id).run();
    await env.FILES.delete(entry.image_key).catch(() => {});
    return json({ ok: true, removed: true });
  }

  return fail('Methode nicht erlaubt.', 405);
}

async function handleSummary(request, env) {
  if (!keyMatches(request, env)) {
    return fail('Nicht autorisiert.', env.CHALLENGE_API_KEY ? 401 : 503);
  }
  if (request.method !== 'GET') return fail('Methode nicht erlaubt.', 405);

  const url = new URL(request.url);
  const location = url.searchParams.get('location');
  const month = cleanMonth(url.searchParams.get('month'));
  if (!LOCATIONS.includes(location)) return fail('Ungültiger Standort.');
  if (!month) return fail('Ungültiger Monat.');

  const entriesRow = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM challenge_entries WHERE location = ? AND month = ?'
  ).bind(location, month).first();
  const votesRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM challenge_votes v
     JOIN challenge_entries e ON e.id = v.entry_id
     WHERE e.location = ? AND e.month = ?`
  ).bind(location, month).first();

  const entries = Number(entriesRow && entriesRow.n) || 0;
  const votes = Number(votesRow && votesRow.n) || 0;
  return json({
    ok: true,
    location,
    month,
    entries,
    votes,
    score: entries + votes,
    theme: themeForMonth(month)
  });
}

async function handleOverview(request, env) {
  if (request.method !== 'GET') return fail('Methode nicht erlaubt.', 405);
  const url = new URL(request.url);
  const month = cleanMonth(url.searchParams.get('month')) || currentMonth();
  const voterId = cleanVoterId(url.searchParams.get('voterId')) || '';

  await finalizeTrophies(env);

  const entriesQuery = await env.DB.prepare(
    'SELECT id, location, month, created_at FROM challenge_entries WHERE month = ? ORDER BY created_at DESC LIMIT 300'
  ).bind(month).all();
  const entries = entriesQuery.results || [];

  const voteRows = await env.DB.prepare(
    `SELECT v.entry_id, COUNT(*) AS n FROM challenge_votes v
     JOIN challenge_entries e ON e.id = v.entry_id
     WHERE e.month = ? GROUP BY v.entry_id`
  ).bind(month).all();
  const votesByEntry = new Map((voteRows.results || []).map((row) => [row.entry_id, Number(row.n) || 0]));

  let likedEntries = new Set();
  if (voterId && entries.length) {
    const likedRows = await env.DB.prepare(
      `SELECT v.entry_id FROM challenge_votes v
       JOIN challenge_entries e ON e.id = v.entry_id
       WHERE e.month = ? AND v.voter_id = ?`
    ).bind(month, voterId).all();
    likedEntries = new Set((likedRows.results || []).map((row) => row.entry_id));
  }

  // Punktestand aus Aggregaten, nicht aus der auf 300 begrenzten Galerie:
  // Sonst würde der Leaderboard-Wert bei mehr als 300 Fotos im Monat zu klein.
  const locations = {
    lcc: { entries: 0, votes: 0, score: 0 },
    coburg: { entries: 0, votes: 0, score: 0 }
  };
  const locationEntryRows = await env.DB.prepare(
    'SELECT location, COUNT(*) AS n FROM challenge_entries WHERE month = ? GROUP BY location'
  ).bind(month).all();
  for (const row of locationEntryRows.results || []) {
    if (locations[row.location]) locations[row.location].entries = Number(row.n) || 0;
  }
  const locationVoteRows = await env.DB.prepare(
    `SELECT e.location, COUNT(*) AS n FROM challenge_votes v
     JOIN challenge_entries e ON e.id = v.entry_id
     WHERE e.month = ? GROUP BY e.location`
  ).bind(month).all();
  for (const row of locationVoteRows.results || []) {
    if (locations[row.location]) locations[row.location].votes = Number(row.n) || 0;
  }
  for (const loc of Object.keys(locations)) {
    locations[loc].score = locations[loc].entries + locations[loc].votes;
  }

  const gallery = entries.map((entry) => ({
    id: entry.id,
    location: entry.location,
    createdAt: entry.created_at,
    votes: votesByEntry.get(entry.id) || 0,
    liked: likedEntries.has(entry.id),
    imageUrl: `/img/${entry.id}`
  }));

  const trophyRows = await env.DB.prepare(
    'SELECT month, location, votes, entries, awarded_at FROM challenge_trophies ORDER BY month DESC LIMIT 36'
  ).all();
  const trophies = (trophyRows.results || []).map((row) => ({
    month: row.month,
    location: row.location,
    votes: Number(row.votes) || 0,
    entries: Number(row.entries) || 0,
    score: (Number(row.entries) || 0) + (Number(row.votes) || 0),
    awardedAt: row.awarded_at
  }));

  const monthRows = await env.DB.prepare(
    'SELECT month FROM challenge_entries UNION SELECT month FROM challenge_trophies ORDER BY month DESC LIMIT 36'
  ).all();
  const months = [...new Set((monthRows.results || []).map((row) => row.month))];

  return json({
    ok: true,
    month,
    currentMonth: currentMonth(),
    theme: themeForMonth(month),
    votingOpen: month === currentMonth(),
    locations,
    entries: gallery,
    trophies,
    months,
    generatedAt: new Date().toISOString()
  });
}

async function countVotes(env, entryId) {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM challenge_votes WHERE entry_id = ?'
  ).bind(entryId).first();
  return Number(row && row.n) || 0;
}

async function handleVote(request, env) {
  if (request.method !== 'POST') return fail('Methode nicht erlaubt.', 405);
  const body = await readJson(request, 64 * 1024);
  const entryId = typeof body.entryId === 'string' && ID_RE.test(body.entryId) ? body.entryId : null;
  const voterId = cleanVoterId(body.voterId);
  if (!entryId) return fail('Ungültiger Eintrag.');
  if (!voterId) return fail('Ungültige Geräte-ID.');

  const entry = await env.DB.prepare(
    'SELECT id, month FROM challenge_entries WHERE id = ?'
  ).bind(entryId).first();
  if (!entry) return fail('Eintrag nicht gefunden.', 404);
  if (entry.month !== currentMonth()) {
    return fail('Die Abstimmung für diesen Monat ist beendet.', 403);
  }

  const existing = await env.DB.prepare(
    'SELECT 1 AS yes FROM challenge_votes WHERE entry_id = ? AND voter_id = ?'
  ).bind(entryId, voterId).first();

  if (existing) {
    await env.DB.prepare(
      'DELETE FROM challenge_votes WHERE entry_id = ? AND voter_id = ?'
    ).bind(entryId, voterId).run();
    return json({ ok: true, voted: false, votes: await countVotes(env, entryId) });
  }

  await env.DB.prepare(
    'INSERT OR IGNORE INTO challenge_votes (entry_id, voter_id, created_at) VALUES (?, ?, ?)'
  ).bind(entryId, voterId, new Date().toISOString()).run();
  return json({ ok: true, voted: true, votes: await countVotes(env, entryId) });
}

async function handleImage(request, env) {
  if (request.method !== 'GET') return fail('Methode nicht erlaubt.', 405);
  const url = new URL(request.url);
  const id = url.pathname.split('/').pop() || '';
  if (!ID_RE.test(id)) return new Response('Not Found', { status: 404 });

  const entry = await env.DB.prepare(
    'SELECT image_key FROM challenge_entries WHERE id = ?'
  ).bind(id).first();
  if (!entry || !entry.image_key) return new Response('Not Found', { status: 404 });

  const object = await env.FILES.get(entry.image_key);
  if (!object) return new Response('Not Found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(object.body, { headers });
}

async function finalizeTrophies(env) {
  if (Date.now() - lastFinalize < 5 * 60 * 1000) return;
  lastFinalize = Date.now();

  const openRows = await env.DB.prepare(
    `SELECT DISTINCT month FROM challenge_entries
     WHERE month < ? AND month NOT IN (SELECT month FROM challenge_trophies)
     ORDER BY month LIMIT 24`
  ).bind(currentMonth()).all();

  for (const row of openRows.results || []) {
    const month = row.month;
    const stats = {
      lcc: { entries: 0, votes: 0 },
      coburg: { entries: 0, votes: 0 }
    };

    const entryRows = await env.DB.prepare(
      'SELECT location, COUNT(*) AS n FROM challenge_entries WHERE month = ? GROUP BY location'
    ).bind(month).all();
    for (const entry of entryRows.results || []) {
      if (stats[entry.location]) stats[entry.location].entries = Number(entry.n) || 0;
    }

    const voteRows = await env.DB.prepare(
      `SELECT e.location, COUNT(*) AS n FROM challenge_votes v
       JOIN challenge_entries e ON e.id = v.entry_id
       WHERE e.month = ? GROUP BY e.location`
    ).bind(month).all();
    for (const vote of voteRows.results || []) {
      if (stats[vote.location]) stats[vote.location].votes = Number(vote.n) || 0;
    }

    const candidates = LOCATIONS
      .map((location) => ({
        location,
        entries: stats[location].entries,
        votes: stats[location].votes,
        score: stats[location].entries + stats[location].votes
      }))
      .filter((candidate) => candidate.score > 0);

    if (!candidates.length) continue;
    candidates.sort((a, b) =>
      b.score - a.score
      || b.votes - a.votes
      || b.entries - a.entries
      || a.location.localeCompare(b.location)
    );
    const winner = candidates[0];

    await env.DB.prepare(
      'INSERT OR IGNORE INTO challenge_trophies (month, location, votes, entries, awarded_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(month, winner.location, winner.votes, winner.entries, new Date().toISOString()).run();
  }
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; "
    + "connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/api/health') {
        return json({ ok: true, db: !!env.DB, files: !!env.FILES, key: !!env.CHALLENGE_API_KEY });
      }

      if (path.startsWith('/api/')) {
        await ensureSchema(env);
        if (path === '/api/overview') return handleOverview(request, env);
        if (path === '/api/vote') return handleVote(request, env);
        if (path === '/api/entries') return handleEntries(request, env);
        if (path === '/api/summary') return handleSummary(request, env);
        return fail('Nicht gefunden.', 404);
      }

      if (path.startsWith('/img/')) {
        await ensureSchema(env);
        return handleImage(request, env);
      }

      const asset = await env.ASSETS.fetch(request);
      if ((asset.headers.get('content-type') || '').includes('text/html')) {
        return withSecurityHeaders(asset);
      }
      return asset;
    } catch (err) {
      console.error('Challenge Worker error:', err && err.stack ? err.stack : err);
      return fail(err && err.message ? err.message : 'Serverfehler.', (err && err.status) || 500);
    }
  }
};
