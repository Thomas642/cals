import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Le nom du fichier (cals.db) est conserve : une installation existante garde ses identifiants
// de connexion. Les anciennes tables de l'application nutrition ne sont plus lues.
export function openDatabase(dbPath = process.env.DB_PATH || path.join(here, '..', 'data', 'cals.db')) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  migrate(db);
  return db;
}

// Colonnes ajoutees apres la premiere version (CREATE TABLE IF NOT EXISTS ne modifie pas une table existante).
function migrate(db) {
  const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  if (!has('series', 'cover_file')) db.exec('ALTER TABLE series ADD COLUMN cover_file TEXT');
  if (!has('episode', 'thumb_file')) db.exec('ALTER TABLE episode ADD COLUMN thumb_file TEXT');
  // Sessions rattachees a un compte ; l'ancien identifiant unique devient le premier administrateur.
  if (!has('auth_session', 'user_id')) db.exec('ALTER TABLE auth_session ADD COLUMN user_id INTEGER');
  const legacy = db.prepare('SELECT * FROM auth_user WHERE id = 1').get();
  if (legacy && !db.prepare('SELECT 1 FROM app_user LIMIT 1').get()) {
    const info = db.prepare("INSERT INTO app_user (username, password_hash, role) VALUES (?, ?, 'admin')").run(legacy.username, legacy.password_hash);
    db.prepare('UPDATE auth_session SET user_id = ? WHERE user_id IS NULL').run(info.lastInsertRowid);
  }
  db.prepare('DELETE FROM auth_session WHERE user_id IS NULL').run();
  for (const [col, type] of [['processing', 'TEXT'], ['processing_progress', 'REAL'], ['processing_error', 'TEXT'], ['media_info', 'TEXT']]) {
    if (!has('episode', col)) db.exec(`ALTER TABLE episode ADD COLUMN ${col} ${type}`);
  }
  // Lecteur, saisons, nouveautes, fiches, statistiques.
  const added = [
    ['series', 'intro_start', 'REAL'], ['series', 'intro_end', 'REAL'], ['series', 'accent', 'TEXT'],
    ['series', 'season_names', 'TEXT'], ['series', 'anilist_id', 'INTEGER'], ['series', 'genres', 'TEXT'], ['series', 'year', 'INTEGER'],
    ['episode', 'season', 'INTEGER NOT NULL DEFAULT 1'], ['episode', 'position', 'REAL'],
    ['episode', 'intro_start', 'REAL'], ['episode', 'intro_end', 'REAL'],
    ['episode', 'storyboard_file', 'TEXT'], ['episode', 'storyboard', 'TEXT'], ['episode', 'ready_at', 'TEXT'],
    ['app_user', 'settings', 'TEXT'], ['app_user', 'last_visit_at', 'TEXT'], ['app_user', 'prev_visit_at', 'TEXT'],
    ['watch_progress', 'seconds_watched', 'REAL NOT NULL DEFAULT 0'], ['watch_progress', 'completions', 'INTEGER NOT NULL DEFAULT 0'],
  ];
  for (const [table, col, type] of added) {
    if (!has(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }
  db.exec("UPDATE episode SET ready_at = created_at WHERE ready_at IS NULL AND status = 'ready'");
  db.exec('UPDATE watch_progress SET completions = 1 WHERE watched = 1 AND completions = 0');
}
