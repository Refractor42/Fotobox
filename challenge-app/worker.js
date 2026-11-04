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
const VOTER_COOKIE = 'snapbox_voter';
const VOTER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const WEBAUTHN_COOKIE = 'snapbox_wa';
const WEBAUTHN_COOKIE_MAX_AGE = 5 * 60;
const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const CREDENTIAL_RE = /^[A-Za-z0-9_-]{16,2048}$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const CREDENTIAL_ALGORITHMS = new Set([-7, -257]);

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
  )`,
  `CREATE TABLE IF NOT EXISTS challenge_credentials (
    credential_id TEXT PRIMARY KEY,
    voter_id TEXT NOT NULL,
    public_key TEXT NOT NULL,
    algorithm INTEGER NOT NULL,
    sign_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_used_at TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS idx_challenge_credentials_voter ON challenge_credentials(voter_id)',
  `CREATE TABLE IF NOT EXISTS challenge_webauthn_challenges (
    id TEXT PRIMARY KEY,
    challenge TEXT NOT NULL,
    kind TEXT NOT NULL,
    voter_id TEXT NOT NULL,
    entry_id TEXT,
    expires_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_challenge_webauthn_challenges_expires ON challenge_webauthn_challenges(expires_at)'
];

let schemaReady = false;
let lastFinalize = 0;

function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  for (const [name, value] of Object.entries(extraHeaders)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  return new Response(JSON.stringify(data), { status, headers });
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

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try { return decodeURIComponent(raw); } catch (e) { return raw; }
  }
  return '';
}

function voterCookieHeader(voterId, request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${VOTER_COOKIE}=${voterId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${VOTER_COOKIE_MAX_AGE}${secure}`;
}

// Die Geräte-ID kommt aus einem serverseitigen Cookie. Der Client kann sie
// damit nicht pro Klick neu erfinden; sie überlebt auch das Leeren von
// localStorage. Ein anderes Gerät oder ein neuer Browser bleibt eine neue Stimme.
function resolveVoter(request, requestedVoterId = '') {
  const existing = readCookie(request, VOTER_COOKIE);
  // Einmalige Migration: Die frühere localStorage-ID darf den Cookie setzen,
  // damit bereits abgegebene Likes nicht verloren gehen.
  const candidate = VOTER_RE.test(existing)
    ? existing
    : (VOTER_RE.test(requestedVoterId) ? requestedVoterId : '');
  if (candidate) {
    return {
      voterId: candidate,
      setCookie: candidate === existing ? '' : voterCookieHeader(candidate, request)
    };
  }
  const voterId = crypto.randomUUID();
  return { voterId, setCookie: voterCookieHeader(voterId, request) };
}

function cookieList(...cookies) {
  return cookies.filter(Boolean);
}

function webauthnCookieHeader(challengeId, request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${WEBAUTHN_COOKIE}=${encodeURIComponent(challengeId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${WEBAUTHN_COOKIE_MAX_AGE}${secure}`;
}

function clearWebAuthnCookieHeader(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${WEBAUTHN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

// Ein vorhandener Passkey liefert die stabile Voter-ID auch dann zurück,
// wenn der Browser-Cookie inzwischen gelöscht wurde. Der Passkey selbst
// muss für einen Like trotzdem kryptografisch bestätigt werden.
async function resolveVoterForRequest(request, env, { credentialId = '', requestedVoterId = '' } = {}) {
  const cleanId = cleanCredentialId(credentialId);
  if (cleanId) {
    const row = await env.DB.prepare(
      'SELECT voter_id FROM challenge_credentials WHERE credential_id = ?'
    ).bind(cleanId).first();
    if (row && VOTER_RE.test(row.voter_id)) {
      const existing = readCookie(request, VOTER_COOKIE);
      return {
        voterId: row.voter_id,
        setCookie: existing === row.voter_id ? '' : voterCookieHeader(row.voter_id, request)
      };
    }
  }
  return resolveVoter(request, requestedVoterId);
}

function b64urlEncode(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecode(value) {
  if (typeof value !== 'string' || !value || value.length > 16384 || !B64URL_RE.test(value)) return null;
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch (e) {
    return null;
  }
}

function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

async function sha256Bytes(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

function cleanCredentialId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return CREDENTIAL_RE.test(id) ? id : null;
}

// WebAuthn liefert ECDSA-Signaturen ASN.1/DER-kodiert. Web Crypto erwartet
// für P-256 die rohe r||s-Form (64 Byte).
function derToRawEcdsaSignature(signature) {
  if (!signature || signature.length < 8 || signature[0] !== 0x30) return signature;
  let offset = 2;
  if (signature[1] & 0x80) {
    const lengthBytes = signature[1] & 0x7f;
    if (lengthBytes < 1 || lengthBytes > 2 || signature.length < 2 + lengthBytes) return signature;
    offset = 2 + lengthBytes;
  }
  if (signature[offset] !== 0x02) return signature;
  const rLength = signature[offset + 1];
  let r = signature.slice(offset + 2, offset + 2 + rLength);
  offset += 2 + rLength;
  if (signature[offset] !== 0x02) return signature;
  const sLength = signature[offset + 1];
  let s = signature.slice(offset + 2, offset + 2 + sLength);
  if (r.length > 32) r = r.slice(r.length - 32);
  if (s.length > 32) s = s.slice(s.length - 32);
  const raw = new Uint8Array(64);
  raw.set(r, 32 - r.length);
  raw.set(s, 64 - s.length);
  return raw;
}

async function importPublicKey(publicKey, algorithm) {
  const bytes = b64urlDecode(publicKey);
  if (!bytes || bytes.length < 32 || bytes.length > 4096) return null;
  const importAlgorithm = algorithm === -7
    ? { name: 'ECDSA', namedCurve: 'P-256' }
    : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  try {
    return await crypto.subtle.importKey('spki', bytes, importAlgorithm, false, ['verify']);
  } catch (e) {
    return null;
  }
}

async function createWebAuthnChallenge(env, kind, voterId, entryId) {
  await env.DB.prepare(
    'DELETE FROM challenge_webauthn_challenges WHERE expires_at < ?'
  ).bind(Date.now()).run();
  const id = crypto.randomUUID();
  const challenge = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare(
    'INSERT INTO challenge_webauthn_challenges (id, challenge, kind, voter_id, entry_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, challenge, kind, voterId, entryId || null, Date.now() + WEBAUTHN_CHALLENGE_TTL_MS).run();
  return { id, challenge };
}

async function readWebAuthnChallenge(request, env, kind) {
  const id = readCookie(request, WEBAUTHN_COOKIE);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = await env.DB.prepare(
    'SELECT id, challenge, kind, voter_id, entry_id, expires_at FROM challenge_webauthn_challenges WHERE id = ? AND kind = ?'
  ).bind(id, kind).first();
  if (!row || Number(row.expires_at) < Date.now()) return null;
  return row;
}

async function consumeWebAuthnChallenge(env, id) {
  await env.DB.prepare('DELETE FROM challenge_webauthn_challenges WHERE id = ?').bind(id).run();
}

async function verifyClientData(clientDataJSON, expectedType, expectedChallenge, request) {
  const bytes = b64urlDecode(clientDataJSON);
  if (!bytes) return null;
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    return null;
  }
  if (!data || data.type !== expectedType) return null;
  if (typeof data.challenge !== 'string' || data.challenge !== expectedChallenge) return null;
  const origin = new URL(request.url).origin;
  if (typeof data.origin !== 'string' || data.origin !== origin) return null;
  if (data.crossOrigin === true) return null;
  return data;
}

async function verifyAuthenticatorData(authDataJSON, rpId) {
  const bytes = b64urlDecode(authDataJSON);
  if (!bytes || bytes.length < 37) return null;
  const expectedRpIdHash = await sha256Bytes(rpId);
  if (!sameBytes(bytes.slice(0, 32), expectedRpIdHash)) return null;
  const flags = bytes[32];
  if ((flags & 0x01) === 0) return null;
  const signCount = new DataView(bytes.buffer, bytes.byteOffset + 33, 4).getUint32(0, false);
  return { bytes, flags, signCount, userVerified: (flags & 0x04) !== 0 };
}

async function verifyAssertionSignature(credential, authenticatorData, clientDataJSON, signatureB64) {
  const signature = b64urlDecode(signatureB64);
  const clientBytes = b64urlDecode(clientDataJSON);
  if (!signature || !clientBytes) return false;
  const algorithm = Number(credential.algorithm);
  const key = await importPublicKey(credential.public_key, algorithm);
  if (!key) return false;
  const clientHash = await sha256Bytes(clientBytes);
  const signed = concatBytes(authenticatorData, clientHash);
  const sig = algorithm === -7 ? derToRawEcdsaSignature(signature) : signature;
  const verifyAlgorithm = algorithm === -7
    ? { name: 'ECDSA', hash: 'SHA-256' }
    : { name: 'RSASSA-PKCS1-v1_5' };
  try {
    return await crypto.subtle.verify(verifyAlgorithm, key, sig, signed);
  } catch (e) {
    return false;
  }
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
  const requestedMonth = cleanMonth(url.searchParams.get('month'));
  if (requestedMonth && requestedMonth > currentMonth()) {
    return fail('Dieser Monat liegt in der Zukunft.', 400);
  }
  const month = requestedMonth || currentMonth();
  const requestedVoterId = url.searchParams.get('voterId') || '';
  const credentialId = cleanCredentialId(url.searchParams.get('credentialId'));
  const voter = await resolveVoterForRequest(request, env, { credentialId, requestedVoterId });
  const voterId = voter.voterId;

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
  const nowMonth = currentMonth();
  const months = [...new Set((monthRows.results || []).map((row) => row.month))]
    .filter((value) => value <= nowMonth);

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
  }, 200, voter.setCookie ? { 'Set-Cookie': voter.setCookie } : {});
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
  const voter = resolveVoter(request);
  const voterId = voter.voterId;
  const hasCredential = await env.DB.prepare(
    'SELECT 1 AS yes FROM challenge_credentials WHERE voter_id = ? LIMIT 1'
  ).bind(voterId).first();
  if (hasCredential) {
    return fail('Bitte bestätige den Like mit deinem Passkey.', 428);
  }
  if (!entryId) return fail('Ungültiger Eintrag.');

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

  // Ein Like ist endgültig: ein zweiter Klick oder eine doppelte Anfrage
  // erhöht den Zähler nicht und löscht die Stimme auch nicht wieder.
  if (existing) {
    return json(
      { ok: true, voted: true, votes: await countVotes(env, entryId) },
      200,
      voter.setCookie ? { 'Set-Cookie': voter.setCookie } : {}
    );
  }

  await env.DB.prepare(
    'INSERT OR IGNORE INTO challenge_votes (entry_id, voter_id, created_at) VALUES (?, ?, ?)'
  ).bind(entryId, voterId, new Date().toISOString()).run();
  return json(
    { ok: true, voted: true, votes: await countVotes(env, entryId) },
    200,
    voter.setCookie ? { 'Set-Cookie': voter.setCookie } : {}
  );
}

async function handleWebAuthnOptions(request, env) {
  if (request.method !== 'POST') return fail('Methode nicht erlaubt.', 405);
  const body = (await readJson(request, 16 * 1024)) || {};
  const entryId = typeof body.entryId === 'string' && ID_RE.test(body.entryId) ? body.entryId : null;
  if (!entryId) return fail('Ungültiger Eintrag.');
  const entry = await env.DB.prepare(
    'SELECT id, month FROM challenge_entries WHERE id = ?'
  ).bind(entryId).first();
  if (!entry) return fail('Eintrag nicht gefunden.', 404);
  if (entry.month !== currentMonth()) {
    return fail('Die Abstimmung für diesen Monat ist beendet.', 403);
  }

  const voter = await resolveVoterForRequest(request, env, { credentialId: body.credentialId });
  const rows = await env.DB.prepare(
    'SELECT credential_id FROM challenge_credentials WHERE voter_id = ? ORDER BY created_at ASC'
  ).bind(voter.voterId).all();
  const credentials = (rows.results || [])
    .map((row) => row.credential_id)
    .filter((id) => CREDENTIAL_RE.test(id));
  const mode = credentials.length ? 'get' : 'create';
  const challenge = await createWebAuthnChallenge(env, mode, voter.voterId, entryId);
  const rpId = new URL(request.url).hostname;
  const allowCredentials = credentials.map((id) => ({ type: 'public-key', id }));

  let publicKey;
  if (mode === 'get') {
    publicKey = {
      challenge: challenge.challenge,
      rpId,
      timeout: 60000,
      userVerification: 'preferred',
      allowCredentials
    };
  } else {
    const userBytes = await sha256Bytes('snapbox:' + voter.voterId);
    publicKey = {
      challenge: challenge.challenge,
      rp: { id: rpId, name: 'SnapBox Challenge' },
      user: {
        id: b64urlEncode(userBytes.slice(0, 16)),
        name: 'snapbox-' + voter.voterId.slice(0, 8),
        displayName: 'SnapBox Gast'
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 }
      ],
      timeout: 60000,
      attestation: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'preferred'
      },
      excludeCredentials: []
    };
  }

  return json(
    { ok: true, mode, credentialId: credentials[0] || '', publicKey },
    200,
    { 'Set-Cookie': cookieList(voter.setCookie, webauthnCookieHeader(challenge.id, request)) }
  );
}

async function handleWebAuthnRegister(request, env) {
  if (request.method !== 'POST') return fail('Methode nicht erlaubt.', 405);
  const body = (await readJson(request, 64 * 1024)) || {};
  const challenge = await readWebAuthnChallenge(request, env, 'create');
  if (!challenge) return fail('Passkey-Anfrage ist abgelaufen. Bitte erneut versuchen.', 400);

  const credentialId = cleanCredentialId(body.id);
  const publicKey = typeof body.publicKey === 'string' && body.publicKey.length <= 4096 && B64URL_RE.test(body.publicKey)
    ? body.publicKey
    : '';
  const algorithm = Number(body.algorithm);
  if (!credentialId) return fail('Ungültiger Passkey.');
  if (!publicKey || !CREDENTIAL_ALGORITHMS.has(algorithm)) return fail('Passkey wird nicht unterstützt.');
  if (!(await verifyClientData(body.clientDataJSON, 'webauthn.create', challenge.challenge, request))) {
    return fail('Passkey-Bestätigung ungültig.', 400);
  }
  if (!(await importPublicKey(publicKey, algorithm))) {
    return fail('Passkey-Schlüssel ungültig.', 400);
  }

  const entryId = challenge.entry_id;
  if (!entryId || !ID_RE.test(entryId)) return fail('Ungültiger Eintrag.');
  const entry = await env.DB.prepare(
    'SELECT id, month FROM challenge_entries WHERE id = ?'
  ).bind(entryId).first();
  if (!entry) return fail('Eintrag nicht gefunden.', 404);
  if (entry.month !== currentMonth()) {
    return fail('Die Abstimmung für diesen Monat ist beendet.', 403);
  }

  const existing = await env.DB.prepare(
    'SELECT voter_id FROM challenge_credentials WHERE credential_id = ?'
  ).bind(credentialId).first();
  if (existing && existing.voter_id !== challenge.voter_id) {
    return fail('Dieser Passkey ist bereits einem anderen Gerät zugeordnet.', 409);
  }
  if (!existing) {
    await env.DB.prepare(
      'INSERT INTO challenge_credentials (credential_id, voter_id, public_key, algorithm, sign_count, created_at) VALUES (?, ?, ?, ?, 0, ?)'
    ).bind(credentialId, challenge.voter_id, publicKey, algorithm, new Date().toISOString()).run();
  }

  const already = await env.DB.prepare(
    'SELECT 1 AS yes FROM challenge_votes WHERE entry_id = ? AND voter_id = ?'
  ).bind(entryId, challenge.voter_id).first();
  await env.DB.prepare(
    'INSERT OR IGNORE INTO challenge_votes (entry_id, voter_id, created_at) VALUES (?, ?, ?)'
  ).bind(entryId, challenge.voter_id, new Date().toISOString()).run();
  await consumeWebAuthnChallenge(env, challenge.id);

  return json(
    {
      ok: true,
      voted: true,
      votes: await countVotes(env, entryId),
      duplicate: !!already,
      credentialId,
      registered: !existing
    },
    200,
    { 'Set-Cookie': cookieList(voterCookieHeader(challenge.voter_id, request), clearWebAuthnCookieHeader(request)) }
  );
}

async function handleWebAuthnVote(request, env) {
  if (request.method !== 'POST') return fail('Methode nicht erlaubt.', 405);
  const body = (await readJson(request, 64 * 1024)) || {};
  const entryId = typeof body.entryId === 'string' && ID_RE.test(body.entryId) ? body.entryId : null;
  if (!entryId) return fail('Ungültiger Eintrag.');

  const challenge = await readWebAuthnChallenge(request, env, 'get');
  if (!challenge) return fail('Passkey-Anfrage ist abgelaufen. Bitte erneut versuchen.', 400);
  if (challenge.entry_id !== entryId) return fail('Passkey-Anfrage passt nicht zu diesem Foto.', 400);

  const credentialId = cleanCredentialId(body.credentialId);
  if (!credentialId) return fail('Ungültiger Passkey.');
  const credential = await env.DB.prepare(
    'SELECT credential_id, voter_id, public_key, algorithm, sign_count FROM challenge_credentials WHERE credential_id = ?'
  ).bind(credentialId).first();
  if (!credential || credential.voter_id !== challenge.voter_id) {
    return fail('Passkey nicht gefunden.', 401);
  }

  if (!(await verifyClientData(body.clientDataJSON, 'webauthn.get', challenge.challenge, request))) {
    return fail('Passkey-Bestätigung ungültig.', 400);
  }
  const auth = await verifyAuthenticatorData(body.authenticatorData, new URL(request.url).hostname);
  if (!auth) return fail('Passkey-Bestätigung ungültig.', 401);
  if (Number(credential.sign_count) > 0 && auth.signCount > 0 && auth.signCount <= Number(credential.sign_count)) {
    return fail('Passkey-Bestätigung ungültig.', 401);
  }
  if (!(await verifyAssertionSignature(credential, auth.bytes, body.clientDataJSON, body.signature))) {
    return fail('Passkey-Signatur ungültig.', 401);
  }

  const entry = await env.DB.prepare(
    'SELECT id, month FROM challenge_entries WHERE id = ?'
  ).bind(entryId).first();
  if (!entry) return fail('Eintrag nicht gefunden.', 404);
  if (entry.month !== currentMonth()) {
    return fail('Die Abstimmung für diesen Monat ist beendet.', 403);
  }

  const already = await env.DB.prepare(
    'SELECT 1 AS yes FROM challenge_votes WHERE entry_id = ? AND voter_id = ?'
  ).bind(entryId, challenge.voter_id).first();
  await env.DB.prepare(
    'INSERT OR IGNORE INTO challenge_votes (entry_id, voter_id, created_at) VALUES (?, ?, ?)'
  ).bind(entryId, challenge.voter_id, new Date().toISOString()).run();
  await env.DB.prepare(
    'UPDATE challenge_credentials SET sign_count = ?, last_used_at = ? WHERE credential_id = ?'
  ).bind(auth.signCount, new Date().toISOString(), credentialId).run();
  await consumeWebAuthnChallenge(env, challenge.id);

  return json(
    {
      ok: true,
      voted: true,
      votes: await countVotes(env, entryId),
      duplicate: !!already,
      credentialId
    },
    200,
    { 'Set-Cookie': cookieList(voterCookieHeader(challenge.voter_id, request), clearWebAuthnCookieHeader(request)) }
  );
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
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self), publickey-credentials-create=(self)');
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
        if (path === '/api/webauthn/options') return handleWebAuthnOptions(request, env);
        if (path === '/api/webauthn/register') return handleWebAuthnRegister(request, env);
        if (path === '/api/webauthn/vote') return handleWebAuthnVote(request, env);
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
