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
}
