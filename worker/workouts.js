import { requireUser } from "./auth.js";
import { ApiError, json, numberIn, readJson, validDate } from "./http.js";

export async function handleWorkouts(request, env, url, path, method) {
  if (path === "/api/records" && method === "GET") {
    const user = await requireUser(request, env);
    const date = url.searchParams.get("date");
    if (!validDate(date)) throw new ApiError("日付が正しくありません");
    const { results } = await env.DB.prepare(
      `SELECT r.id, r.exercise_id AS exerciseId, r.workout_date AS date, r.weight_kg AS weightKg,
          r.reps, r.sets, r.distance_km AS distanceKm, r.duration_minutes AS durationMinutes,
          e.name, e.kind
         FROM workout_records r JOIN exercises e ON e.id = r.exercise_id
         WHERE r.user_id = ? AND r.workout_date = ? ORDER BY e.sort_order`,
    )
      .bind(user.id, date)
      .all();
    const bodyWeight = await env.DB.prepare(
      "SELECT weight_kg AS weightKg FROM body_weights WHERE user_id = ? AND measured_date = ?",
    )
      .bind(user.id, date)
      .first();
    const latestWeights = await env.DB.prepare(
      `SELECT e.id AS exerciseId,
          COALESCE((
            SELECT r.weight_kg
            FROM workout_records r
            WHERE r.user_id = ? AND r.exercise_id = e.id AND r.weight_kg IS NOT NULL
            ORDER BY r.workout_date DESC, r.id DESC
            LIMIT 1
          ), 0) AS weightKg
         FROM exercises e
         WHERE e.kind = 'strength'
         ORDER BY e.sort_order, e.id`,
    )
      .bind(user.id)
      .all();
    return json({
      records: results,
      bodyWeight: bodyWeight?.weightKg ?? null,
      latestWeights: latestWeights.results,
    });
  }

  if (path === "/api/records" && method === "POST") {
    const user = await requireUser(request, env);
    const body = await readJson(request);
    const exerciseId = Number(body.exerciseId);
    const kind = body.kind;
    if (!Number.isInteger(exerciseId) || !validDate(body.date) || !["strength", "cardio"].includes(kind))
      throw new ApiError("種目または日付が正しくありません");
    let values;
    if (kind === "strength") {
      if (
        !numberIn(body.weightKg, -1000, 1000) ||
        !Number.isInteger(body.reps) ||
        !numberIn(body.reps, 0, 1000) ||
        !Number.isInteger(body.sets) ||
        !numberIn(body.sets, 1, 100)
      ) {
        throw new ApiError("重量・回数・セット数を確認してください");
      }
      values = [body.weightKg, body.reps, body.sets, null, null];
    } else {
      if (
        !numberIn(body.distanceKm, 0, 1000) ||
        !Number.isInteger(body.durationMinutes) ||
        !numberIn(body.durationMinutes, 1, 10000)
      ) {
        throw new ApiError("距離・時間を確認してください");
      }
      values = [null, null, null, body.distanceKm, body.durationMinutes];
    }
    const record = await env.DB.prepare(
      `INSERT INTO workout_records
         (user_id, exercise_id, workout_date, weight_kg, reps, sets, distance_km, duration_minutes)
         SELECT ?, id, ?, ?, ?, ?, ?, ? FROM exercises WHERE id = ? AND kind = ?
         ON CONFLICT(user_id, exercise_id, workout_date) DO UPDATE SET
         weight_kg = excluded.weight_kg, reps = excluded.reps, sets = excluded.sets,
         distance_km = excluded.distance_km, duration_minutes = excluded.duration_minutes,
         updated_at = datetime('now')
         RETURNING id, exercise_id AS exerciseId, workout_date AS date,
           weight_kg AS weightKg, reps, sets, distance_km AS distanceKm,
           duration_minutes AS durationMinutes`,
    )
      .bind(user.id, body.date, ...values, exerciseId, kind)
      .first();
    if (!record) throw new ApiError("種目が見つかりません", 404);
    return json({ record });
  }

  const recordMatch = path.match(/^\/api\/records\/(\d+)$/);
  if (recordMatch && method === "DELETE") {
    const user = await requireUser(request, env);
    const result = await env.DB.prepare("DELETE FROM workout_records WHERE id = ? AND user_id = ?")
      .bind(recordMatch[1], user.id)
      .run();
    if (!result.meta.changes) throw new ApiError("記録が見つかりません", 404);
    return json({ ok: true });
  }

  if (path === "/api/body-weight" && method === "POST") {
    const user = await requireUser(request, env);
    const body = await readJson(request);
    if (!validDate(body.date) || !numberIn(body.weightKg, 20, 500))
      throw new ApiError("体重を確認してください");
    await env.DB.prepare(
      `INSERT INTO body_weights (user_id, measured_date, weight_kg) VALUES (?, ?, ?)
         ON CONFLICT(user_id, measured_date) DO UPDATE SET weight_kg = excluded.weight_kg, updated_at = datetime('now')`,
    )
      .bind(user.id, body.date, body.weightKg)
      .run();
    return json({ ok: true });
  }

  if (path === "/api/body-weight" && method === "DELETE") {
    const user = await requireUser(request, env);
    const date = url.searchParams.get("date");
    if (!validDate(date)) throw new ApiError("日付が正しくありません");
    await env.DB.prepare("DELETE FROM body_weights WHERE user_id = ? AND measured_date = ?")
      .bind(user.id, date)
      .run();
    return json({ ok: true });
  }

  if (path === "/api/calendar" && method === "GET") {
    const user = await requireUser(request, env);
    const month = url.searchParams.get("month");
    if (typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) throw new ApiError("月が正しくありません");
    const { results } = await env.DB.prepare(
      `SELECT workout_date AS date, COUNT(*) AS count
         FROM workout_records WHERE user_id = ? AND workout_date LIKE ?
         GROUP BY workout_date ORDER BY workout_date`,
    )
      .bind(user.id, `${month}-%`)
      .all();
    return json({ days: results });
  }

  if (path === "/api/stats" && method === "GET") {
    const user = await requireUser(request, env);
    const exerciseId = Number(url.searchParams.get("exerciseId"));
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!validDate(from) || !validDate(to) || from > to) {
      throw new ApiError("表示期間が正しくありません");
    }
    let exercise = [];
    if (Number.isInteger(exerciseId) && exerciseId > 0) {
      const result = await env.DB.prepare(
        `SELECT workout_date AS date, weight_kg AS weightKg, reps, sets,
            distance_km AS distanceKm, duration_minutes AS durationMinutes
           FROM workout_records
           WHERE user_id = ? AND exercise_id = ? AND workout_date BETWEEN ? AND ?
           ORDER BY workout_date`,
      )
        .bind(user.id, exerciseId, from, to)
        .all();
      exercise = result.results;
    }
    const weights = await env.DB.prepare(
      `SELECT measured_date AS date, weight_kg AS weightKg
         FROM body_weights
         WHERE user_id = ? AND measured_date BETWEEN ? AND ?
         ORDER BY measured_date`,
    )
      .bind(user.id, from, to)
      .all();
    return json({ exercise, bodyWeights: weights.results });
  }

  return null;
}
