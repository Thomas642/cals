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
}
