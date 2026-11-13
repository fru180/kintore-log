import { ApiError } from "./http.js";
import {
  ensureEnabled,
  issuer,
  nowSeconds,
  privateJson,
  rateLimit,
  sha256,
  assertSingleParams,
} from "./oauth-security.js";
import {
  readExerciseStats,
  readExercises,
  readExternalRecordDay,
  readExternalRecordDays,
} from "./read-data.js";
import { readBodyCompositionPoints, readExternalBodyCompositionDays } from "./body-composition.js";

class ExternalError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function requireExternalReadAccess(request, env) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer (at_[a-f0-9]{64})$/i);
  if (!match) throw new ExternalError("unauthorized", "Invalid or expired access token", 401);
  const now = nowSeconds();
  const row = await env.DB.prepare(
    `SELECT g.user_id AS userId, g.client_id AS clientId, g.id AS grantId, g.scope, g.audience,
       u.account_name AS accountName
     FROM oauth_access_tokens t JOIN oauth_grants g ON g.id = t.grant_id
     JOIN oauth_clients c ON c.client_id = g.client_id JOIN users u ON u.id = g.user_id
     WHERE t.token_hash = ? AND t.expires_at > ? AND t.revoked_at IS NULL
       AND g.expires_at > ? AND g.revoked_at IS NULL AND c.disabled_at IS NULL`,
  )
    .bind(await sha256(match[1]), now, now)
    .first();
  if (!row || row.audience !== `${issuer(env)}/api/v1`)
    throw new ExternalError("unauthorized", "Invalid or expired access token", 401);
  if (!row.scope.split(" ").includes("workouts:read"))
    throw new ExternalError("insufficient_scope", "workouts:read is required", 403);
  return row;
}

function realDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

function requirePeriod(url) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!realDate(from) || !realDate(to) || from > to || (Date.parse(to) - Date.parse(from)) / 86400000 >= 366)
    throw new ApiError("from/toは両端を含む366日以内の実在する日付を指定してください");
  return { from, to };
}

export async function handleExternalApi(request, env, url, path) {
  try {
    ensureEnabled(env);
    await rateLimit(request, env, "external.ip", 300);
    const user = await requireExternalReadAccess(request, env);
    await rateLimit(request, env, `external.owner:${user.clientId}:${user.userId}`, 120, false);
    if (request.method !== "GET") throw new ExternalError("method_not_allowed", "Only GET is supported", 405);
    assertSingleParams(url.searchParams);
    const allowed = [
      "/api/v1/me",
      "/api/v1/records",
      "/api/v1/body-composition",
      "/api/v1/body-composition/stats",
      "/api/v1/exercises",
      "/api/v1/stats",
    ];
    if (!allowed.includes(path)) throw new ExternalError("not_found", "API not found", 404);
    const queryKeys =
      path === "/api/v1/records" || path === "/api/v1/body-composition"
        ? ["date", "from", "to"]
        : path === "/api/v1/stats"
          ? ["exerciseId", "from", "to"]
          : path === "/api/v1/body-composition/stats"
            ? ["from", "to"]
            : [];
    if ([...url.searchParams.keys()].some((key) => !queryKeys.includes(key)))
      throw new ApiError("未対応のクエリパラメーターです");
    if (path === "/api/v1/me")
      return privateJson({ user: { id: user.userId, accountName: user.accountName } });
    if (path === "/api/v1/exercises")
      return privateJson({ exercises: await readExercises(env, user.userId) });
    if (path === "/api/v1/stats") {
      const rawId = url.searchParams.get("exerciseId");
      const exerciseId = Number(rawId);
      const { from, to } = requirePeriod(url);
      if (!/^\d+$/.test(rawId ?? "") || !Number.isSafeInteger(exerciseId) || exerciseId < 1)
        throw new ApiError("exerciseIdは正の整数を指定してください");
      return privateJson({ exercise: await readExerciseStats(env, user.userId, exerciseId, from, to) });
    }
    if (path === "/api/v1/body-composition/stats") {
      const { from, to } = requirePeriod(url);
      return privateJson({ bodyComposition: await readBodyCompositionPoints(env, user.userId, from, to) });
    }
    if (path === "/api/v1/records" || path === "/api/v1/body-composition") {
      const composition = path === "/api/v1/body-composition";
      const date = url.searchParams.get("date");
      if (url.searchParams.has("date")) {
        if (url.searchParams.has("from") || url.searchParams.has("to"))
          throw new ApiError("dateとfrom/toは同時に指定できません");
        if (!realDate(date)) throw new ApiError("dateはYYYY-MM-DD形式の実在する日付を指定してください");
        return privateJson(
          composition
            ? (await readExternalBodyCompositionDays(env, user.userId, date, date))[0]
            : { date, records: await readExternalRecordDay(env, user.userId, date) },
        );
      }
      const { from, to } = requirePeriod(url);
      const days = await (composition ? readExternalBodyCompositionDays : readExternalRecordDays)(
        env,
        user.userId,
        from,
        to,
      );
      return privateJson({ from, to, days });
    }
  } catch (error) {
    const known = error instanceof ExternalError || error instanceof ApiError;
    const status = known ? error.status : 500;
    const code =
      error instanceof ExternalError
        ? error.code
        : status === 429
          ? "rate_limited"
          : status >= 500
            ? "server_error"
            : "invalid_request";
    const headers =
      status === 401
        ? { "www-authenticate": 'Bearer realm="kintore-log", error="invalid_token"' }
        : status === 403
          ? { "www-authenticate": 'Bearer error="insufficient_scope", scope="workouts:read"' }
          : status === 405
            ? { allow: "GET" }
            : status === 429
              ? { "retry-after": "60" }
              : {};
    return privateJson({ error: { code, message: known ? error.message : "Server error" } }, status, headers);
  }
}
