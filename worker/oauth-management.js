import { requireAdmin, requireUser } from "./auth.js";
import { ApiError, readJson } from "./http.js";
import {
  audit,
  csrfToken,
  nowSeconds,
  privateJson,
  randomToken,
  requireBrowserMutation,
  sha256,
} from "./oauth-security.js";

export async function handleOAuthManagement(request, env, path, method) {
  if (path === "/api/oauth/csrf" && method === "GET") {
    await requireUser(request, env);
    return privateJson({ csrfToken: await csrfToken(request) });
  }
  if (path === "/api/oauth/connections" && method === "GET") {
    const user = await requireUser(request, env);
    const { results } = await env.DB.prepare(
      `SELECT c.client_id AS id, c.name, g.scope, MIN(g.created_at) AS createdAt, MAX(g.expires_at) AS expiresAt
       FROM oauth_grants g JOIN oauth_clients c ON c.client_id = g.client_id
       WHERE g.user_id = ? AND g.revoked_at IS NULL AND g.expires_at > ? AND c.disabled_at IS NULL
       GROUP BY c.client_id, c.name, g.scope ORDER BY createdAt DESC, c.client_id`,
    )
      .bind(user.id, nowSeconds())
      .all();
    return privateJson({ connections: results });
  }
  const connection = path.match(/^\/api\/oauth\/connections\/(cl_[a-f0-9]{64})$/);
  if (connection && method === "DELETE") {
    const user = await requireBrowserMutation(request, env);
    const grant = await env.DB.prepare(
      "UPDATE oauth_grants SET revoked_at = COALESCE(revoked_at, ?) WHERE client_id = ? AND user_id = ? RETURNING client_id",
    )
      .bind(nowSeconds(), connection[1], user.id)
      .first();
    if (!grant) throw new ApiError("連携が見つかりません", 404);
    audit("oauth.connection.revoked", user.id, grant.client_id);
    return privateJson({ ok: true });
  }

  if (path === "/api/admin/oauth/clients") {
    const user = await requireAdmin(request, env);
    if (method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT client_id AS clientId, name,
         CASE WHEN client_secret_hash IS NULL THEN 'none' ELSE 'client_secret_basic' END AS authMethod,
         redirect_uris AS redirectUris,
         created_at AS createdAt, disabled_at AS disabledAt FROM oauth_clients ORDER BY created_at DESC, client_id`,
      ).all();
      return privateJson({
        clients: results.map((row) => ({ ...row, redirectUris: JSON.parse(row.redirectUris) })),
      });
    }
    if (method === "POST") {
      await requireBrowserMutation(request, env);
      const body = await readJson(request);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError("入力内容が不正です");
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const authMethod = body.authMethod;
      const uris = body.redirectUris;
      if (!name || name.length > 80 || !["none", "client_secret_basic"].includes(authMethod))
        throw new ApiError("表示名と認証方式を確認してください");
      if (!Array.isArray(uris) || uris.length < 1 || uris.length > 10 || new Set(uris).size !== uris.length)
        throw new ApiError("リダイレクトURIは重複のない1〜10件を登録してください");
      for (const uri of uris) {
        let url;
        try {
          url = new URL(uri);
        } catch {
          throw new ApiError("リダイレクトURIが不正です");
        }
        if (
          typeof uri !== "string" ||
          uri.length > 2048 ||
          uri.trim() !== uri ||
          url.protocol !== "https:" ||
          uri.includes("#") ||
          uri.includes("*") ||
          url.username ||
          url.password
        )
          throw new ApiError(
            "リダイレクトURIはフラグメントやワイルドカードを含まないHTTPS URLにしてください",
          );
      }
      const clientId = randomToken("cl_");
      const clientSecret = authMethod === "none" ? null : randomToken("cs_");
      await env.DB.prepare(
        "INSERT INTO oauth_clients (client_id, name, client_secret_hash, redirect_uris, created_at) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(
          clientId,
          name,
          clientSecret ? await sha256(clientSecret) : null,
          JSON.stringify(uris),
          nowSeconds(),
        )
        .run();
      audit("oauth.client.created", user.id, clientId);
      return privateJson({ clientId, clientSecret }, 201);
    }
    throw new ApiError("許可されていないメソッドです", 405);
  }
  const client = path.match(/^\/api\/admin\/oauth\/clients\/(cl_[a-f0-9]{64})\/disable$/);
  if (client && method === "POST") {
    const user = await requireAdmin(request, env);
    await requireBrowserMutation(request, env);
    const row = await env.DB.prepare(
      "UPDATE oauth_clients SET disabled_at = COALESCE(disabled_at, ?) WHERE client_id = ? RETURNING client_id",
    )
      .bind(nowSeconds(), client[1])
      .first();
    if (!row) throw new ApiError("クライアントが見つかりません", 404);
    audit("oauth.client.disabled", user.id, client[1]);
    return privateJson({ ok: true });
  }
  return null;
}
