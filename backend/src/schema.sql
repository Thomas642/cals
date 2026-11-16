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
  thumb_file    TEXT,                       -- miniature JPEG (ffmpeg ou navigateur)
  processing    TEXT,                       -- traitement ffmpeg : queued | running | done | failed
  processing_progress REAL,
  processing_error    TEXT,
  media_info    TEXT,                       -- resume JSON de l'analyse (codecs, action, duree)
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

-- Ma liste : series qu'une personne veut regarder.
CREATE TABLE IF NOT EXISTS watchlist (
  user_id   INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  added_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, series_id)
);

-- Comptes : administrateur (gestion complete) ou spectateur (regarder seulement).
CREATE TABLE IF NOT EXISTS app_user (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Progression de lecture par compte (suit la personne d'un appareil a l'autre).
CREATE TABLE IF NOT EXISTS watch_progress (
  user_id    INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  episode_id INTEGER NOT NULL REFERENCES episode(id) ON DELETE CASCADE,
  pos        REAL NOT NULL DEFAULT 0,
  dur        REAL NOT NULL DEFAULT 0,
  watched    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, episode_id)
);

-- Ancienne authentification a identifiant unique : conservee pour la migration vers app_user.
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
