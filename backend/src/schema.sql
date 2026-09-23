-- Schema Cals (GDD v2, section 3) + extensions phases 3 et 4.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profile (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  username         TEXT NOT NULL,
  sex              TEXT NOT NULL CHECK (sex IN ('M','F')),
  birth_date       TEXT,
  height_cm        REAL NOT NULL,
  weight_kg        REAL NOT NULL,
  activity_level   TEXT NOT NULL,
  goal             TEXT NOT NULL,
  goal_intensity   TEXT,
  target_kcal      INTEGER,
  target_protein_g INTEGER,
  target_carbs_g   INTEGER,
  target_fat_g     INTEGER,
  manual_targets   INTEGER NOT NULL DEFAULT 0,  -- 1 : cibles forcees (section 4.6)
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS weight_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  weight_kg  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS food (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  kcal        REAL NOT NULL,
  protein_g   REAL NOT NULL DEFAULT 0,
  carbs_g     REAL,
  fat_g       REAL,
  ref_unit    TEXT NOT NULL CHECK (ref_unit IN ('100g','unit')),
  source      TEXT,
  is_estimate INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS journal_entry (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT NOT NULL,
  food_id      INTEGER,
  display_name TEXT NOT NULL,
  quantity     REAL NOT NULL,
  unit         TEXT NOT NULL,
  kcal         REAL NOT NULL,
  protein_g    REAL NOT NULL DEFAULT 0,
  carbs_g      REAL,
  fat_g        REAL,
  origin       TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (food_id) REFERENCES food(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS recipe (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  servings     INTEGER NOT NULL DEFAULT 1,
  steps        TEXT,
  tags         TEXT
);

CREATE TABLE IF NOT EXISTS recipe_ingredient (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id  INTEGER NOT NULL,
  food_id    INTEGER NOT NULL,
  quantity   REAL NOT NULL,
  unit       TEXT NOT NULL,
  FOREIGN KEY (recipe_id) REFERENCES recipe(id) ON DELETE CASCADE,
  FOREIGN KEY (food_id)   REFERENCES food(id)   ON DELETE RESTRICT
);

-- Routines reutilisables (phase 3) : valeurs figees, copiees depuis le journal.
CREATE TABLE IF NOT EXISTS routine (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS routine_item (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id   INTEGER NOT NULL,
  food_id      INTEGER,
  display_name TEXT NOT NULL,
  quantity     REAL NOT NULL,
  unit         TEXT NOT NULL,
  kcal         REAL NOT NULL,
  protein_g    REAL NOT NULL DEFAULT 0,
  carbs_g      REAL,
  fat_g        REAL,
  FOREIGN KEY (routine_id) REFERENCES routine(id) ON DELETE CASCADE,
  FOREIGN KEY (food_id)    REFERENCES food(id)    ON DELETE SET NULL
);

-- Journal de charges (phase 4).
CREATE TABLE IF NOT EXISTS workout_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  day_code   TEXT NOT NULL,
  exercise   TEXT NOT NULL,
  load_kg    REAL,
  reps       TEXT,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entry(date);
CREATE INDEX IF NOT EXISTS idx_weight_date  ON weight_log(date);
CREATE INDEX IF NOT EXISTS idx_workout_date ON workout_log(date);
