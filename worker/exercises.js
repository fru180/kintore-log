import { requireAdmin, requireUser } from "./auth.js";
import { ApiError, json, readJson } from "./http.js";

export async function handleExercises(request, env, path, method) {
  if (path === "/api/exercises" && method === "GET") {
    const user = await requireUser(request, env);
    const { results } = await env.DB.prepare(
      `SELECT e.id, e.name, e.kind, e.sort_order AS sortOrder,
          CASE WHEN e.kind = 'strength' AND m.user_id IS NOT NULL THEN 1 ELSE 0 END AS readyForWeightIncrease
         FROM exercises e
         LEFT JOIN exercise_weight_increase_marks m
           ON m.exercise_id = e.id AND m.user_id = ?
         ORDER BY e.sort_order, e.id`,
    )
      .bind(user.id)
      .all();
    const exercises = results.map((exercise) => ({
      ...exercise,
      readyForWeightIncrease: Boolean(exercise.readyForWeightIncrease),
    }));
    return json({ exercises });
  }

  if (path === "/api/exercises" && method === "POST") {
    await requireAdmin(request, env);
    const body = await readJson(request);
    const name = String(body.name || "").trim();
    const kind = body.kind === "cardio" ? "cardio" : "strength";
    if (!name || name.length > 50) throw new ApiError("種目名は1〜50文字で入力してください");
    const max = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) AS value FROM exercises").first();
    await env.DB.prepare("INSERT INTO exercises (name, kind, sort_order) VALUES (?, ?, ?)")
      .bind(name, kind, Number(max.value) + 1)
      .run();
    return json({ ok: true }, 201);
  }

  const weightIncreaseMatch = path.match(/^\/api\/exercises\/(\d+)\/weight-increase-ready$/);
  if (weightIncreaseMatch && method === "PATCH") {
    const user = await requireUser(request, env);
    const body = await readJson(request);
    if (typeof body.ready !== "boolean") throw new ApiError("入力内容を確認してください");
    const exerciseId = Number(weightIncreaseMatch[1]);
    const exercise = await env.DB.prepare("SELECT kind FROM exercises WHERE id = ?").bind(exerciseId).first();
    if (!exercise) throw new ApiError("種目が見つかりません", 404);
    if (exercise.kind !== "strength") throw new ApiError("筋力種目のみ設定できます");

    if (body.ready) {
      await env.DB.prepare(
        `INSERT INTO exercise_weight_increase_marks (user_id, exercise_id)
           VALUES (?, ?)
           ON CONFLICT(user_id, exercise_id) DO NOTHING`,
      )
        .bind(user.id, exerciseId)
        .run();
    } else {
      await env.DB.prepare("DELETE FROM exercise_weight_increase_marks WHERE user_id = ? AND exercise_id = ?")
        .bind(user.id, exerciseId)
        .run();
    }
    return json({ exerciseId, readyForWeightIncrease: body.ready });
  }

  const exerciseMatch = path.match(/^\/api\/exercises\/(\d+)$/);
  if (exerciseMatch && method === "PATCH") {
    await requireAdmin(request, env);
    const body = await readJson(request);
    const name = String(body.name || "").trim();
    const kind = body.kind === "cardio" ? "cardio" : "strength";
    const sortOrder = Number(body.sortOrder);
    if (!name || name.length > 50 || !Number.isInteger(sortOrder))
      throw new ApiError("入力内容を確認してください");
    const statements = [
      env.DB.prepare("UPDATE exercises SET name = ?, kind = ?, sort_order = ? WHERE id = ?").bind(
        name,
        kind,
        sortOrder,
        exerciseMatch[1],
      ),
    ];
    if (kind === "cardio") {
      statements.push(
        env.DB.prepare("DELETE FROM exercise_weight_increase_marks WHERE exercise_id = ?").bind(
          exerciseMatch[1],
        ),
      );
    }
    await env.DB.batch(statements);
    return json({ ok: true });
  }
  if (exerciseMatch && method === "DELETE") {
    await requireAdmin(request, env);
    try {
      const result = await env.DB.prepare("DELETE FROM exercises WHERE id = ?").bind(exerciseMatch[1]).run();
      if (!result.meta.changes) throw new ApiError("種目が見つかりません", 404);
      return json({ ok: true });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("記録がある種目は削除できません", 409);
    }
  }

  return null;
}
