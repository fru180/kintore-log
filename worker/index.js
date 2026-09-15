const encoder = new TextEncoder();
const SESSION_DAYS = 30;
const APP_BASE_PATH = "/kintore-log";

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

const fail = (message, status = 400) => json({ error: message }, status);

const readJson = async (request) => {
  const type = request.headers.get("content-type") || "";
  if (!type.includes("application/json")) throw new ApiError("JSON形式で送信してください", 415);
  try {
    return await request.json();
  } catch {
    throw new ApiError("入力内容を読み取れませんでした", 400);
  }
};

class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const toHex = (bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
const randomHex = (length) => toHex(crypto.getRandomValues(new Uint8Array(length)));
const sha256 = async (value) => toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));

async function passwordHash(password, saltHex) {
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map((byte) => Number.parseInt(byte, 16)));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return toHex(
    await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 120_000 }, key, 256),
  );
}

function cookieValue(request, name) {
  const cookies = request.headers.get("cookie") || "";
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function sessionCookie(request, token, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `kintore_session=${encodeURIComponent(token)}; Path=${APP_BASE_PATH}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function withoutAppBasePath(pathname) {
  if (pathname === APP_BASE_PATH) return "/";
  if (pathname.startsWith(`${APP_BASE_PATH}/`)) return pathname.slice(APP_BASE_PATH.length);
  return pathname;
}

function requestWithoutAppBasePath(request) {
  const url = new URL(request.url);
  url.pathname = withoutAppBasePath(url.pathname);
  return new Request(url, request);
}

async function currentUser(request, env) {
  const token = cookieValue(request, "kintore_session");
  if (!token) return null;
  const tokenHash = await sha256(token);
  return env.DB.prepare(
    `SELECT users.id, users.account_name AS accountName, users.is_admin AS isAdmin
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > datetime('now')`,
  )
    .bind(tokenHash)
    .first();
}

async function requireUser(request, env) {
  const user = await currentUser(request, env);
  if (!user) throw new ApiError("ログインが必要です", 401);
  return user;
}

async function requireAdmin(request, env) {
  const user = await requireUser(request, env);
  if (!user.isAdmin) throw new ApiError("管理者権限が必要です", 403);
  return user;
}

const validDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const numberIn = (value, min, max) =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/health") return json({ ok: true });

  if (path === "/api/auth/me" && method === "GET") {
    return json({ user: await currentUser(request, env) });
  }

  if (path === "/api/auth/register" && method === "POST") {
    const body = await readJson(request);
    const accountName = String(body.accountName || "").trim();
    const password = String(body.password || "");
    if (!/^[\p{L}\p{N}_.-]{3,32}$/u.test(accountName)) {
      throw new ApiError("アカウント名は3〜32文字の英数字・日本語・._-で入力してください");
    }
    if (password.length < 8 || password.length > 128) {
      throw new ApiError("パスワードは8〜128文字で入力してください");
    }
    const existing = await env.DB.prepare("SELECT id FROM users WHERE account_name = ? COLLATE NOCASE")
      .bind(accountName)
      .first();
    if (existing) throw new ApiError("このアカウント名は使用されています", 409);
    const salt = randomHex(16);
    const hash = await passwordHash(password, salt);
    const result = await env.DB.prepare(
      "INSERT INTO users (account_name, password_hash, password_salt) VALUES (?, ?, ?)",
    )
      .bind(accountName, hash, salt)
      .run();
    return json({ id: result.meta.last_row_id, accountName }, 201);
  }

  if (path === "/api/auth/login" && method === "POST") {
    const body = await readJson(request);
    const accountName = String(body.accountName || "").trim();
    const password = String(body.password || "");
    const user = await env.DB.prepare(
      "SELECT id, account_name AS accountName, password_hash AS passwordHash, password_salt AS passwordSalt, is_admin AS isAdmin FROM users WHERE account_name = ? COLLATE NOCASE",
    )
      .bind(accountName)
      .first();
    if (!user || (await passwordHash(password, user.passwordSalt)) !== user.passwordHash) {
      throw new ApiError("アカウント名またはパスワードが違います", 401);
    }
    const token = randomHex(32);
    const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')"),
      env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(
        await sha256(token),
        user.id,
        expires,
      ),
    ]);
    return json({ user: { id: user.id, accountName: user.accountName, isAdmin: user.isAdmin } }, 200, {
      "set-cookie": sessionCookie(request, token, SESSION_DAYS * 86400),
    });
  }

  if (path === "/api/auth/logout" && method === "POST") {
    const token = cookieValue(request, "kintore_session");
    if (token)
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
        .bind(await sha256(token))
        .run();
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(request, "", 0) });
  }

  if (path === "/api/exercises" && method === "GET") {
    await requireUser(request, env);
    const { results } = await env.DB.prepare(
      "SELECT id, name, kind, sort_order AS sortOrder FROM exercises ORDER BY sort_order, id",
    ).all();
    return json({ exercises: results });
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

  const exerciseMatch = path.match(/^\/api\/exercises\/(\d+)$/);
  if (exerciseMatch && method === "PATCH") {
    await requireAdmin(request, env);
    const body = await readJson(request);
    const name = String(body.name || "").trim();
    const kind = body.kind === "cardio" ? "cardio" : "strength";
    const sortOrder = Number(body.sortOrder);
    if (!name || name.length > 50 || !Number.isInteger(sortOrder))
      throw new ApiError("入力内容を確認してください");
    await env.DB.prepare("UPDATE exercises SET name = ?, kind = ?, sort_order = ? WHERE id = ?")
      .bind(name, kind, sortOrder, exerciseMatch[1])
      .run();
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
    return json({ records: results, bodyWeight: bodyWeight?.weightKg ?? null });
  }

  if (path === "/api/records" && method === "POST") {
    const user = await requireUser(request, env);
    const body = await readJson(request);
    const exerciseId = Number(body.exerciseId);
    if (!Number.isInteger(exerciseId) || !validDate(body.date))
      throw new ApiError("種目または日付が正しくありません");
    const exercise = await env.DB.prepare("SELECT kind FROM exercises WHERE id = ?").bind(exerciseId).first();
    if (!exercise) throw new ApiError("種目が見つかりません", 404);
    let values;
    if (exercise.kind === "strength") {
      if (
        !numberIn(body.weightKg, 0, 1000) ||
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
    await env.DB.prepare(
      `INSERT INTO workout_records
       (user_id, exercise_id, workout_date, weight_kg, reps, sets, distance_km, duration_minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, exercise_id, workout_date) DO UPDATE SET
       weight_kg = excluded.weight_kg, reps = excluded.reps, sets = excluded.sets,
       distance_km = excluded.distance_km, duration_minutes = excluded.duration_minutes,
       updated_at = datetime('now')`,
    )
      .bind(user.id, exerciseId, body.date, ...values)
      .run();
    return json({ ok: true });
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

  throw new ApiError("APIが見つかりません", 404);
}

export default {
  async fetch(request, env) {
    const appRequest = requestWithoutAppBasePath(request);
    const url = new URL(appRequest.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(appRequest);
    try {
      return await route(appRequest, env);
    } catch (error) {
      if (error instanceof ApiError) return fail(error.message, error.status);
      console.error(error);
      return fail("サーバーでエラーが発生しました", 500);
    }
  },
};
