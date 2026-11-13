CREATE TABLE body_composition_records (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  measured_date TEXT NOT NULL,
  metric TEXT NOT NULL CHECK (metric IN ('heightCm', 'bodyFatPercent', 'muscleMassKg', 'visceralFatLevel', 'basalMetabolismKcal')),
  value REAL NOT NULL CHECK (value >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, measured_date, metric)
);

CREATE INDEX body_composition_user_metric_date_idx
  ON body_composition_records(user_id, metric, measured_date);
