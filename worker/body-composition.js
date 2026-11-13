import { requireUser } from "./auth.js";
import { ApiError, json, readJson } from "./http.js";

const writableMetrics = [
  "weightKg",
  "heightCm",
  "bodyFatPercent",
  "muscleMassKg",
  "visceralFatLevel",
  "basalMetabolismKcal",
];

function realDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

export function validMeasurement(metric, value) {
  if (!writableMetrics.includes(metric) || typeof value !== "number" || !Number.isFinite(value)) return false;
  if (metric === "weightKg") return value >= 20 && value <= 500;
  if (metric === "bodyFatPercent") return value >= 0 && value <= 100;
  return value > 0;
}

// Read the requested interval plus one earlier value for each BMI input.
// Earlier values seed the calculation; they never produce points outside the interval.
export async function readBodyComposition(env, userId, from, to) {
  const [rows, weight, height] = await Promise.all([
    env.DB.prepare(
      `SELECT measured_date AS date, 'weightKg' AS metric, weight_kg AS value
      FROM body_weights WHERE user_id = ? AND measured_date BETWEEN ? AND ?
      UNION ALL SELECT measured_date AS date, metric, value FROM body_composition_records
      WHERE user_id = ? AND measured_date BETWEEN ? AND ? ORDER BY date, metric`,
    )
      .bind(userId, from, to, userId, from, to)
      .all(),
    env.DB.prepare(
      `SELECT weight_kg AS value FROM body_weights
      WHERE user_id = ? AND measured_date < ? ORDER BY measured_date DESC LIMIT 1`,
    )
      .bind(userId, from)
      .first(),
    env.DB.prepare(
      `SELECT value FROM body_composition_records
      WHERE user_id = ? AND metric = 'heightCm' AND measured_date < ? ORDER BY measured_date DESC LIMIT 1`,
    )
      .bind(userId, from)
      .first(),
  ]);
  let weightKg = weight?.value ?? null;
  let heightCm = height?.value ?? null;
  const days = new Map();
  for (const row of rows.results) {
    if (!days.has(row.date)) days.set(row.date, {});
    days.get(row.date)[row.metric] = row.value;
  }
  const bmi = [];
  for (const [date, values] of days) {
    weightKg = values.weightKg ?? weightKg;
    heightCm = values.heightCm ?? heightCm;
    if ((values.weightKg !== undefined || values.heightCm !== undefined) && weightKg > 0 && heightCm > 0) {
      const value = weightKg / (heightCm / 100) ** 2;
      if (Number.isFinite(value)) bmi.push({ date, value: Number(value.toFixed(1)) });
    }
  }
  return { records: rows.results, bmi };
}

function emptyBodyComposition() {
  return { ...Object.fromEntries(writableMetrics.map((metric) => [metric, null])), bmi: null };
}

// External consumers receive one complete set of fields per date, with no input defaults.
export async function readBodyCompositionPoints(env, userId, from, to) {
  const data = await readBodyComposition(env, userId, from, to);
  const points = new Map();
  for (const row of data.records) {
    if (!points.has(row.date)) points.set(row.date, { date: row.date, ...emptyBodyComposition() });
    points.get(row.date)[row.metric] = row.value;
  }
  for (const point of data.bmi) points.get(point.date).bmi = point.value;
  return [...points.values()];
}

export async function readExternalBodyCompositionDays(env, userId, from, to) {
  const points = new Map(
    (await readBodyCompositionPoints(env, userId, from, to)).map(({ date, ...values }) => [date, values]),
  );
  const days = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (
    const current = new Date(`${from}T00:00:00Z`);
    current.getTime() <= end;
    current.setUTCDate(current.getUTCDate() + 1)
  ) {
    const date = current.toISOString().slice(0, 10);
    days.push({ date, bodyComposition: points.get(date) ?? emptyBodyComposition() });
  }
  return days;
}

export async function handleBodyComposition(request, env, url, path, method) {
  if (path !== "/api/body-composition" && path !== "/api/body-composition/stats") return null;
  const user = await requireUser(request, env);
  if (path === "/api/body-composition/stats" && method === "GET") {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const metric = url.searchParams.get("metric");
    if (!realDate(from) || !realDate(to) || from > to) throw new ApiError("表示期間が正しくありません");
    if (![...writableMetrics, "bmi"].includes(metric)) throw new ApiError("項目が正しくありません");
    const data = await readBodyComposition(env, user.id, from, to);
    return json({
      points:
        metric === "bmi"
          ? data.bmi
          : data.records.filter((row) => row.metric === metric).map(({ date, value }) => ({ date, value })),
    });
  }
  if (path === "/api/body-composition" && method === "GET") {
    const date = url.searchParams.get("date");
    if (!realDate(date)) throw new ApiError("日付が正しくありません");
    const [data, latest] = await Promise.all([
      readBodyComposition(env, user.id, date, date),
      env.DB.prepare(
        `WITH metrics(metric) AS (VALUES ('heightCm'), ('bodyFatPercent'), ('muscleMassKg'),
          ('visceralFatLevel'), ('basalMetabolismKcal'))
        SELECT metric, (SELECT value FROM body_composition_records r
          WHERE r.user_id = ? AND r.metric = metrics.metric ORDER BY measured_date DESC LIMIT 1) AS value
        FROM metrics
        UNION ALL SELECT 'weightKg', (SELECT weight_kg FROM body_weights
          WHERE user_id = ? ORDER BY measured_date DESC LIMIT 1)`,
      )
        .bind(user.id, user.id)
        .all(),
    ]);
    return json({
      values: Object.fromEntries(data.records.map((row) => [row.metric, row.value])),
      latestValues: Object.fromEntries(
        latest.results.filter((row) => row.value !== null).map((row) => [row.metric, row.value]),
      ),
      bmi: data.bmi[0]?.value ?? null,
    });
  }
  if (path === "/api/body-composition" && (method === "POST" || method === "DELETE")) {
    const body = method === "POST" ? await readJson(request) : Object.fromEntries(url.searchParams);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new ApiError("入力内容を確認してください");
    const { date, metric, value } = body;
    if (!realDate(date)) throw new ApiError("日付が正しくありません");
    if (!writableMetrics.includes(metric)) throw new ApiError("項目が正しくありません");
    if (method === "POST" && !validMeasurement(metric, value)) throw new ApiError("入力値を確認してください");
    if (method === "DELETE") {
      const query =
        metric === "weightKg"
          ? env.DB.prepare("DELETE FROM body_weights WHERE user_id = ? AND measured_date = ?").bind(
              user.id,
              date,
            )
          : env.DB.prepare(
              "DELETE FROM body_composition_records WHERE user_id = ? AND measured_date = ? AND metric = ?",
            ).bind(user.id, date, metric);
      await query.run();
    } else if (metric === "weightKg") {
      await env.DB.prepare(
        `INSERT INTO body_weights (user_id, measured_date, weight_kg) VALUES (?, ?, ?)
        ON CONFLICT(user_id, measured_date) DO UPDATE SET weight_kg = excluded.weight_kg, updated_at = datetime('now')`,
      )
        .bind(user.id, date, value)
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO body_composition_records (user_id, measured_date, metric, value) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, measured_date, metric) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      )
        .bind(user.id, date, metric, value)
        .run();
    }
    return json({ ok: true });
  }
  throw new ApiError("APIが見つかりません", 404);
}
