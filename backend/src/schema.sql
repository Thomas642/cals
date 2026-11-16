-- Bibliotheque d'animes : series, episodes (video), pistes de sous-titres.
CREATE TABLE IF NOT EXISTS series (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  cover_file  TEXT,                         -- affiche importee (image), relative a MEDIA_DIR
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS episode (
  id            INTEGER PRIMARY KEY,
  series_id     INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  number        REAL,
  title         TEXT,
  original_name TEXT,                       -- nom du fichier importe
  video_file    TEXT,                       -- chemin relatif dans MEDIA_DIR
  video_mime    TEXT,
  video_size    INTEGER NOT NULL DEFAULT 0, -- taille annoncee a la creation
  status        TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'ready')),
  thumb_file    TEXT,                       -- miniature JPEG capturee par le navigateur
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subtitle (
  id            INTEGER PRIMARY KEY,
  episode_id    INTEGER NOT NULL REFERENCES episode(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  lang          TEXT NOT NULL DEFAULT 'fr',
  original_name TEXT,
  file          TEXT NOT NULL,              -- fichier WebVTT converti, relatif a MEDIA_DIR
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_episode_series ON episode(series_id);
CREATE INDEX IF NOT EXISTS idx_subtitle_episode ON subtitle(episode_id);

-- Authentification (identifiant unique, sessions par cookie).
CREATE TABLE IF NOT EXISTS auth_user (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auth_session (
  token_hash  TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  persistent  INTEGER NOT NULL DEFAULT 1
);
