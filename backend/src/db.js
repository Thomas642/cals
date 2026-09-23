import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_FOODS } from './seed-data.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function openDatabase(dbPath = process.env.DB_PATH || path.join(here, '..', 'data', 'cals.db')) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  return db;
}

/** Insere les aliments de l'annexe A si la table food est vide. Retourne le nombre insere. */
export function seedFoods(db) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM food').get();
  if (n > 0) return 0;
  const insert = db.prepare(`INSERT INTO food (name, kcal, protein_g, carbs_g, fat_g, ref_unit, source, is_estimate)
    VALUES (@name, @kcal, @protein_g, @carbs_g, @fat_g, @ref_unit, @source, @is_estimate)`);
  db.transaction(() => SEED_FOODS.forEach((f) => insert.run(f)))();
  return SEED_FOODS.length;
}
