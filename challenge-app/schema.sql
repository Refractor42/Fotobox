-- SnapBox Challenge — D1-Schema
-- Der Worker legt diese Tabellen beim ersten API-Aufruf automatisch an.
-- Die Datei dient als Dokumentation und für eine manuelle Einrichtung.

CREATE TABLE IF NOT EXISTS challenge_entries (
  id         TEXT PRIMARY KEY,
  photo_id   TEXT NOT NULL UNIQUE,
  location   TEXT NOT NULL,
  month      TEXT NOT NULL,
  image_key  TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_challenge_entries_month
  ON challenge_entries(month);
CREATE INDEX IF NOT EXISTS idx_challenge_entries_location_month
  ON challenge_entries(location, month);

CREATE TABLE IF NOT EXISTS challenge_votes (
  entry_id   TEXT NOT NULL,
  voter_id   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (entry_id, voter_id)
);

CREATE INDEX IF NOT EXISTS idx_challenge_votes_entry
  ON challenge_votes(entry_id);

CREATE TABLE IF NOT EXISTS challenge_trophies (
  month      TEXT PRIMARY KEY,
  location   TEXT NOT NULL,
  votes      INTEGER NOT NULL,
  entries    INTEGER NOT NULL,
  awarded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS challenge_credentials (
  credential_id TEXT PRIMARY KEY,
  voter_id      TEXT NOT NULL,
  public_key    TEXT NOT NULL,
  algorithm     INTEGER NOT NULL,
  sign_count    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_challenge_credentials_voter
  ON challenge_credentials(voter_id);

CREATE TABLE IF NOT EXISTS challenge_webauthn_challenges (
  id         TEXT PRIMARY KEY,
  challenge  TEXT NOT NULL,
  kind       TEXT NOT NULL,
  voter_id   TEXT NOT NULL,
  entry_id   TEXT,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_challenge_webauthn_challenges_expires
  ON challenge_webauthn_challenges(expires_at);
