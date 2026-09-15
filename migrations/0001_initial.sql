PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'strength' CHECK (kind IN ('strength', 'cardio')),
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE workout_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  workout_date TEXT NOT NULL,
  weight_kg REAL,
  reps INTEGER,
  sets INTEGER,
  distance_km REAL,
  duration_minutes INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, exercise_id, workout_date)
);

CREATE TABLE body_weights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  measured_date TEXT NOT NULL,
  weight_kg REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, measured_date)
);

CREATE INDEX workout_records_user_date_idx ON workout_records(user_id, workout_date);
CREATE INDEX workout_records_exercise_date_idx ON workout_records(exercise_id, workout_date);
CREATE INDEX body_weights_user_date_idx ON body_weights(user_id, measured_date);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

INSERT INTO exercises (name, kind, sort_order) VALUES
  ('レッグプレス', 'strength', 1),
  ('チェストプレス', 'strength', 2),
  ('ラットプルダウン', 'strength', 3),
  ('チンニング', 'strength', 4),
  ('シーテッドロー', 'strength', 5),
  ('ロングプル', 'strength', 6),
  ('ショルダープレス', 'strength', 7),
  ('ラインレッグカール', 'strength', 8),
  ('レッグエクステンション', 'strength', 9),
  ('ヒップアブダクター', 'strength', 10),
  ('ヒップアダクター', 'strength', 11),
  ('カーフレイズ', 'strength', 12),
  ('バックエクステンション', 'strength', 13),
  ('アブドミナルクランチ', 'strength', 14),
  ('ロータリートルソー', 'strength', 15),
  ('ランニング', 'cardio', 16),
  ('水泳', 'cardio', 17);
