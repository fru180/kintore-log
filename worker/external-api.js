import { ApiError } from "./http.js";
import {
  base64url,
  ensureEnabled,
  equalSecret,
  hmac,
  issuer,
  nowSeconds,
  privateJson,
  rateLimit,
  sha256,
  assertSingleParams,
} from "./oauth-security.js";
import {
  readBodyWeightPage,
  readExercises,
  readExternalRecordDay,
  readExternalRecordDays,
} from "./read-data.js";

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

async function pageOptions(env, url, user) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const rawLimit = url.searchParams.get("limit") ?? "50";
  const limit = Number(rawLimit);
  if (
    !realDate(from) ||
    !realDate(to) ||
    from > to ||
    (Date.parse(to) - Date.parse(from)) / 86400000 >= 366 ||
    !/^\d+$/.test(rawLimit) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 200
  )
    throw new ApiError("from/toは366日以内の実在する日付、limitは1〜200を指定してください");
  if (!env.OAUTH_CURSOR_SECRET || env.OAUTH_CURSOR_SECRET.length < 32)
    throw new ApiError("カーソル署名キーが未設定です", 503);
  const context = { userId: user.userId, grantId: user.grantId, path: url.pathname, from, to, limit };
  let lastDate = "";
  let lastId = 0;
  const raw = url.searchParams.get("cursor");
  if (raw !== null) {
    try {
      if (raw.length > 4096) throw new Error();
      const parts = raw.split(".");
      if (parts.length !== 2 || !equalSecret(parts[1], await hmac(env.OAUTH_CURSOR_SECRET, parts[0])))
        throw new Error();
      const bytes = Uint8Array.from(atob(parts[0].replace(/-/g, "+").replace(/_/g, "/")), (c) =>
        c.charCodeAt(0),
      );
      const cursor = JSON.parse(new TextDecoder().decode(bytes));
      if (
        cursor.version !== 1 ||
        cursor.expiresAt <= nowSeconds() ||
        Object.entries(context).some(([key, value]) => cursor[key] !== value) ||
        !realDate(cursor.lastDate) ||
        cursor.lastDate < from ||
        cursor.lastDate > to ||
        !Number.isSafeInteger(cursor.lastId) ||
        cursor.lastId < 1
      )
        throw new Error();
      lastDate = cursor.lastDate;
      lastId = cursor.lastId;
    } catch {
      throw new ApiError("カーソルが不正または期限切れです");
    }
  }
  return { from, to, limit, lastDate, lastId, context };
}

async function makeCursor(env, context, last) {
  const payload = base64url(
    new TextEncoder().encode(
      JSON.stringify({
        ...context,
        version: 1,
        lastDate: last.date,
        lastId: last.id,
        expiresAt: nowSeconds() + 3600,
      }),
    ),
  );
  return `${payload}.${await hmac(env.OAUTH_CURSOR_SECRET, payload)}`;
}

export async function handleExternalApi(request, env, url, path) {
  try {
    ensureEnabled(env);
    await rateLimit(request, env, "external.ip", 300);
    const user = await requireExternalReadAccess(request, env);
    await rateLimit(request, env, `external.owner:${user.clientId}:${user.userId}`, 120, false);
    if (request.method !== "GET") throw new ExternalError("method_not_allowed", "Only GET is supported", 405);
    assertSingleParams(url.searchParams);
    const allowed = ["/api/v1/me", "/api/v1/records", "/api/v1/body-weights", "/api/v1/exercises"];
    if (!allowed.includes(path)) throw new ExternalError("not_found", "API not found", 404);
    const queryKeys =
      path === "/api/v1/records"
        ? ["date", "from", "to"]
        : path === "/api/v1/body-weights"
          ? ["from", "to", "limit", "cursor"]
          : [];
    if ([...url.searchParams.keys()].some((key) => !queryKeys.includes(key)))
      throw new ApiError("未対応のクエリパラメーターです");
    if (path === "/api/v1/me")
      return privateJson({ user: { id: user.userId, accountName: user.accountName } });
    if (path === "/api/v1/exercises")
      return privateJson({ exercises: await readExercises(env, user.userId) });
    if (path === "/api/v1/records") {
      const date = url.searchParams.get("date");
      if (url.searchParams.has("date")) {
        if (url.searchParams.has("from") || url.searchParams.has("to"))
          throw new ApiError("dateとfrom/toは同時に指定できません");
        if (!realDate(date)) throw new ApiError("dateはYYYY-MM-DD形式の実在する日付を指定してください");
        return privateJson({ date, records: await readExternalRecordDay(env, user.userId, date) });
      }
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (
        !realDate(from) ||
        !realDate(to) ||
        from > to ||
        (Date.parse(to) - Date.parse(from)) / 86400000 >= 366
      )
        throw new ApiError(
          "dateまたはfrom/toを指定してください。from/toは両端を含む366日以内の実在する日付にしてください",
        );
      return privateJson({ from, to, days: await readExternalRecordDays(env, user.userId, from, to) });
    }
    const options = await pageOptions(env, url, user);
    const rows = await readBodyWeightPage(env, user.userId, options);
    const page = rows.slice(0, options.limit);
    const nextCursor =
      rows.length > options.limit ? await makeCursor(env, options.context, page.at(-1)) : null;
    return privateJson({
      bodyWeights: page.map(({ date, weightKg }) => ({ date, weightKg })),
      nextCursor,
    });
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
