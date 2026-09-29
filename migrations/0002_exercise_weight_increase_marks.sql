PRAGMA foreign_keys = ON;

CREATE TABLE exercise_weight_increase_marks (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, exercise_id)
);

CREATE INDEX exercise_weight_increase_marks_exercise_idx
  ON exercise_weight_increase_marks(exercise_id);
