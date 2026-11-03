// Every personal-data query requires the verified owner ID; no administrator bypass.
export const recordColumns = `r.id, r.exercise_id AS exerciseId, r.workout_date AS date,
  r.weight_kg AS weightKg, r.reps, r.sets, r.distance_km AS distanceKm,
  r.duration_minutes AS durationMinutes, e.name, e.kind`;

export async function readExercises(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.name, e.kind, e.sort_order AS sortOrder,
      CASE WHEN e.kind = 'strength' AND m.user_id IS NOT NULL THEN 1 ELSE 0 END AS readyForWeightIncrease
     FROM exercises e LEFT JOIN exercise_weight_increase_marks m ON m.exercise_id = e.id AND m.user_id = ?
     ORDER BY e.sort_order, e.id`,
  )
    .bind(userId)
    .all();
  return results.map((row) => ({ ...row, readyForWeightIncrease: Boolean(row.readyForWeightIncrease) }));
}

export async function readRecordDay(env, userId, date) {
  const { results } = await env.DB.prepare(
    `SELECT ${recordColumns} FROM workout_records r JOIN exercises e ON e.id = r.exercise_id
     WHERE r.user_id = ? AND r.workout_date = ? ORDER BY e.sort_order`,
  )
    .bind(userId, date)
    .all();
  return results;
}

export async function readChartData(env, userId, exerciseId, from, to) {
  let exercise = [];
  if (Number.isInteger(exerciseId) && exerciseId > 0) {
    const { results } = await env.DB.prepare(
      `SELECT workout_date AS date, weight_kg AS weightKg, reps, sets,
         distance_km AS distanceKm, duration_minutes AS durationMinutes
       FROM workout_records
       WHERE user_id = ? AND exercise_id = ? AND workout_date BETWEEN ? AND ?
       ORDER BY workout_date`,
    )
      .bind(userId, exerciseId, from, to)
      .all();
    exercise = results;
  }
  return { exercise, bodyWeights: await readBodyWeights(env, userId, from, to) };
}

export async function readExternalRecordDay(env, userId, date) {
  return (await readExternalRecordDays(env, userId, date, date))[0].records;
}

export async function readExternalRecordDays(env, userId, from, to) {
  const { results } = await env.DB.prepare(
    `WITH RECURSIVE days(date) AS (
       SELECT ? UNION ALL SELECT date(date, '+1 day') FROM days WHERE date < ?
     )
     SELECT r.id, e.id AS exerciseId, days.date, e.name, e.kind,
      r.weight_kg AS weightKg, r.reps, r.sets, r.distance_km AS distanceKm,
      r.duration_minutes AS durationMinutes, r.id IS NOT NULL AS recorded
     FROM days LEFT JOIN exercises e ON 1 = 1 LEFT JOIN workout_records r
       ON r.exercise_id = e.id AND r.user_id = ? AND r.workout_date = days.date
     ORDER BY days.date, e.sort_order, e.id`,
  )
    .bind(from, to, userId)
    .all();
  const days = new Map();
  for (const row of results) {
    if (!days.has(row.date)) days.set(row.date, { date: row.date, records: [] });
    if (row.exerciseId !== null) days.get(row.date).records.push({ ...row, recorded: Boolean(row.recorded) });
  }
  return [...days.values()];
}

export async function readBodyWeights(env, userId, from, to) {
  const { results } = await env.DB.prepare(
    `SELECT measured_date AS date, weight_kg AS weightKg FROM body_weights
     WHERE user_id = ? AND measured_date BETWEEN ? AND ? ORDER BY measured_date`,
  )
    .bind(userId, from, to)
    .all();
  return results;
}
