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
  return db;
}
