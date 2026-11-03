import { currentUser } from "./auth.js";
import { ApiError } from "./http.js";
import {
  assertSingleParams,
  audit,
  csrfToken,
  ensureEnabled,
  equalSecret,
  issuer,
  nowSeconds,
  pkceChallenge,
  privateJson,
  randomToken,
  rateLimit,
  readForm,
  requireBrowserMutation,
  sessionHash,
  sha256,
} from "./oauth-security.js";

const ACCESS_SECONDS = 3600;
const REFRESH_SECONDS = 30 * 86400;
const GRANT_SECONDS = 90 * 86400;
const SCOPE = "workouts:read";
const htmlEscape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

class OAuthError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function redirect(url) {
  return new Response(null, {
    status: 303,
    headers: { location: url, "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}

function callback(uri, state, values) {
  const url = new URL(uri);
  for (const [key, value] of Object.entries({ ...values, state })) url.searchParams.set(key, value);
  return redirect(url.href);
}

export function authorizationMetadata(env) {
  const base = issuer(env);
  return privateJson({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    revocation_endpoint: `${base}/oauth/revoke`,
    scopes_supported: [SCOPE],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
  });
}

async function clientForAuthorization(env, id, uri) {
  const client = await env.DB.prepare(
    "SELECT * FROM oauth_clients WHERE client_id = ? AND disabled_at IS NULL",
  )
    .bind(id)
    .first();
  if (!client || !JSON.parse(client.redirect_uris).includes(uri)) throw new OAuthError("invalid_request");
  return client;
}

async function authenticateClient(request, env, form) {
  const authorization = request.headers.get("authorization");
  let id = form.get("client_id");
  let secret = null;
  if (authorization) {
    if (!/^Basic /i.test(authorization) || form.has("client_secret"))
      throw new OAuthError("invalid_client", 401);
    try {
      const credentials = atob(authorization.slice(6));
      const split = credentials.indexOf(":");
      if (split < 0) throw new Error();
      const basicId = decodeURIComponent(credentials.slice(0, split).replace(/\+/g, " "));
      secret = decodeURIComponent(credentials.slice(split + 1).replace(/\+/g, " "));
      if (id && id !== basicId) throw new Error();
      id = basicId;
    } catch {
      throw new OAuthError("invalid_client", 401);
    }
  }
  if (!id || id.length > 128) throw new OAuthError("invalid_client", 401);
  await rateLimit(request, env, `oauth.client:${id}`, 60);
  const client = await env.DB.prepare(
    "SELECT * FROM oauth_clients WHERE client_id = ? AND disabled_at IS NULL",
  )
    .bind(id)
    .first();
  if (!client || form.has("client_secret")) throw new OAuthError("invalid_client", 401);
  if (client.client_secret_hash === null) {
    if (authorization) throw new OAuthError("invalid_client", 401);
  } else if (!secret || !equalSecret(await sha256(secret), client.client_secret_hash))
    throw new OAuthError("invalid_client", 401);
  return client;
}

async function consentPage(request, env, rawRequest) {
  const hash = await sha256(rawRequest);
  const row = await env.DB.prepare(
    `SELECT r.*, c.name FROM oauth_authorization_requests r JOIN oauth_clients c ON c.client_id = r.client_id
     WHERE r.request_hash = ? AND r.expires_at > ? AND r.consumed_by IS NULL AND c.disabled_at IS NULL`,
  )
    .bind(hash, nowSeconds())
    .first();
  if (!row) throw new OAuthError("invalid_request");
  const user = await currentUser(request, env);
  if (!user) return redirect(`${issuer(env)}/?oauth_request=${encodeURIComponent(rawRequest)}`);
  const session = await sessionHash(request);
  const bound = await env.DB.prepare(
    `UPDATE oauth_authorization_requests SET user_id = ?, session_hash = ? WHERE request_hash = ?
     AND (session_hash IS NULL OR (session_hash = ? AND user_id = ?)) AND consumed_by IS NULL AND expires_at > ? RETURNING request_hash`,
  )
    .bind(user.id, session, hash, session, user.id, nowSeconds())
    .first();
  if (!bound) throw new OAuthError("invalid_request");
  const csrf = await csrfToken(request);
  // Resolve Vite's hashed stylesheets from the same entry HTML served to the app.
  const entry = await env.ASSETS.fetch(new Request(new URL("/", request.url)));
  if (!entry.ok) throw new Error("App stylesheet entry unavailable");
  const entryHtml = await entry.text();
  const stylesheets = [...entryHtml.matchAll(/<link\b[^>]*>/gi)]
    .map(([tag]) => {
      if (!/\brel="stylesheet"/i.test(tag)) return null;
      return tag.match(/\bhref="([^"]+)"/i)?.[1];
    })
    .filter((href) => href?.startsWith("/kintore-log/assets/") && href.endsWith(".css"));
  if (!stylesheets.length) throw new Error("App stylesheet missing");
  const styleLinks = stylesheets.map((href) => `<link rel="stylesheet" href="${htmlEscape(href)}">`).join("");
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>外部連携の許可 | 筋トレログ</title>${styleLinks}</head><body class="oauth-consent-page">
    <main><h1>外部連携の許可</h1><p><strong>${htmlEscape(user.accountName)}</strong> としてログイン中です。</p>
    <p><strong>${htmlEscape(row.name)}</strong> に、あなたの次の情報の読み取りを許可しますか？</p>
    <ul><li>筋トレ・有酸素運動の日別記録</li><li>体重の記録</li><li>種目一覧と重量アップ候補設定</li></ul>
    <form method="post" action="${htmlEscape(issuer(env))}/oauth/authorize">
    <input type="hidden" name="request" value="${htmlEscape(rawRequest)}"><input type="hidden" name="csrf" value="${htmlEscape(csrf)}">
    <button class="primary" name="decision" value="allow">許可する</button><button class="secondary" name="decision" value="deny">拒否する</button></form>
    </main></body></html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      // Keep Origin on same-origin HTML form posts; cross-origin requests still send no Referer.
      "referrer-policy": "same-origin",
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "content-security-policy":
        // Chromium checks form-action against the callback redirect as well as the POST target.
        `default-src 'none'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; form-action 'self' ${new URL(row.redirect_uri).origin}; frame-ancestors 'none'; base-uri 'none'`,
    },
  });
}

async function authorize(request, env) {
  await rateLimit(request, env, "oauth.authorize", 60);
  if (request.method === "GET") {
    const params = new URL(request.url).searchParams;
    assertSingleParams(params);
    if (params.has("request")) return consentPage(request, env, params.get("request"));
    const id = params.get("client_id");
    const uri = params.get("redirect_uri");
    await clientForAuthorization(env, id, uri);
    if (params.get("response_type") !== "code")
      return callback(uri, params.get("state") || "", { error: "unsupported_response_type" });
    if (params.get("scope") !== SCOPE)
      return callback(uri, params.get("state") || "", { error: "invalid_scope" });
    if (
      !params.get("state") ||
      params.get("state").length > 1024 ||
      params.get("code_challenge_method") !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(params.get("code_challenge") || "")
    )
      return callback(uri, params.get("state")?.slice(0, 1024) || "", { error: "invalid_request" });
    const rawRequest = randomToken();
    await env.DB.prepare(
      "INSERT INTO oauth_authorization_requests (request_hash, client_id, redirect_uri, challenge, state, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(
        await sha256(rawRequest),
        id,
        uri,
        params.get("code_challenge"),
        params.get("state"),
        nowSeconds() + 600,
      )
      .run();
    return consentPage(request, env, rawRequest);
  }
  if (request.method !== "POST") throw new OAuthError("invalid_request", 405);
  const form = await readForm(request);
  const user = await requireBrowserMutation(request, env, form.get("csrf"));
  if (!["allow", "deny"].includes(form.get("decision"))) throw new OAuthError("invalid_request");
  const hash = await sha256(form.get("request") || "");
  const session = await sessionHash(request);
  const marker = randomToken();
  const now = nowSeconds();
  const grantId = randomToken();
  const code = randomToken("ac_");
  const statements = [
    env.DB.prepare(
      `UPDATE oauth_authorization_requests SET consumed_by = ? WHERE request_hash = ? AND user_id = ? AND session_hash = ?
     AND consumed_by IS NULL AND expires_at > ? AND EXISTS
     (SELECT 1 FROM oauth_clients c WHERE c.client_id = oauth_authorization_requests.client_id AND c.disabled_at IS NULL)
     RETURNING client_id, redirect_uri, state`,
    ).bind(marker, hash, user.id, session, now),
  ];
  if (form.get("decision") === "allow") {
    statements.push(
      env.DB.prepare(
        `INSERT INTO oauth_grants (id, user_id, client_id, scope, audience, created_at, expires_at)
       SELECT ?, user_id, client_id, ?, ?, ?, ? FROM oauth_authorization_requests WHERE request_hash = ? AND consumed_by = ?`,
      ).bind(grantId, SCOPE, `${issuer(env)}/api/v1`, now, now + GRANT_SECONDS, hash, marker),
    );
    statements.push(
      env.DB.prepare(
        `INSERT INTO oauth_authorization_codes (code_hash, grant_id, redirect_uri, challenge, expires_at)
       SELECT ?, ?, redirect_uri, challenge, ? FROM oauth_authorization_requests WHERE request_hash = ? AND consumed_by = ?`,
      ).bind(await sha256(code), grantId, now + 300, hash, marker),
    );
  }
  const [result] = await env.DB.batch(statements);
  const row = result.results[0];
  if (!row) throw new OAuthError("invalid_request");
  const allowed = form.get("decision") === "allow";
  audit(allowed ? "oauth.consent.allowed" : "oauth.consent.denied", user.id, row.client_id);
  return callback(
    row.redirect_uri,
    row.state,
    allowed ? { code, iss: issuer(env) } : { error: "access_denied" },
  );
}

async function exchange(request, env, form, client) {
  const now = nowSeconds();
  const kind = form.get("grant_type");
  if (!["authorization_code", "refresh_token"].includes(kind)) throw new OAuthError("unsupported_grant_type");
  if (form.has("scope") && form.get("scope") !== SCOPE) throw new OAuthError("invalid_scope");
  const isCode = kind === "authorization_code";
  const raw = form.get(isCode ? "code" : "refresh_token") || "";
  if (raw.length > 256) throw new OAuthError("invalid_grant");
  const hash = await sha256(raw);
  const table = isCode ? "oauth_authorization_codes" : "oauth_refresh_tokens";
  const row = await env.DB.prepare(
    `SELECT t.*, g.user_id, g.client_id, g.scope, g.audience, g.expires_at AS grant_expires_at, g.revoked_at AS grant_revoked_at
     FROM ${table} t JOIN oauth_grants g ON g.id = t.grant_id WHERE t.${isCode ? "code_hash" : "token_hash"} = ? AND g.client_id = ?`,
  )
    .bind(hash, client.client_id)
    .first();
  if (!row) throw new OAuthError("invalid_grant");
  if (
    isCode &&
    (form.get("redirect_uri") !== row.redirect_uri ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(form.get("code_verifier") || "") ||
      !equalSecret(await pkceChallenge(form.get("code_verifier")), row.challenge))
  )
    throw new OAuthError("invalid_grant");
  if (row.consumed_by) {
    await revokeReplay(env, row, isCode);
    throw new OAuthError("invalid_grant");
  }
  if (
    row.expires_at <= now ||
    row.grant_expires_at <= now ||
    row.grant_revoked_at ||
    row.revoked_at ||
    row.audience !== `${issuer(env)}/api/v1` ||
    row.scope !== SCOPE
  )
    throw new OAuthError("invalid_grant");
  const marker = randomToken();
  const family = isCode ? randomToken() : row.family_id;
  const accessToken = randomToken("at_");
  const refreshToken = randomToken("rt_");
  const keyColumn = isCode ? "code_hash" : "token_hash";
  const accessExpires = Math.min(now + ACCESS_SECONDS, row.grant_expires_at);
  const [consumed] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE ${table} SET consumed_by = ? WHERE ${keyColumn} = ? AND consumed_by IS NULL AND expires_at > ?
       ${isCode ? "" : "AND revoked_at IS NULL"} AND EXISTS
       (SELECT 1 FROM oauth_grants g JOIN oauth_clients c ON c.client_id = g.client_id
        WHERE g.id = ${table}.grant_id AND g.revoked_at IS NULL AND g.expires_at > ? AND c.disabled_at IS NULL)
       RETURNING grant_id`,
    ).bind(marker, hash, now, now),
    env.DB.prepare(
      `INSERT INTO oauth_refresh_tokens (token_hash, grant_id, family_id, parent_hash, created_at, expires_at)
       SELECT ?, grant_id, ?, ?, ?, ? FROM ${table} WHERE ${keyColumn} = ? AND consumed_by = ?`,
    ).bind(
      await sha256(refreshToken),
      family,
      isCode ? null : hash,
      now,
      Math.min(now + REFRESH_SECONDS, row.grant_expires_at),
      hash,
      marker,
    ),
    env.DB.prepare(
      `INSERT INTO oauth_access_tokens (token_hash, grant_id, family_id, expires_at)
       SELECT ?, grant_id, ?, ? FROM ${table} WHERE ${keyColumn} = ? AND consumed_by = ?`,
    ).bind(await sha256(accessToken), family, accessExpires, hash, marker),
  ]);
  if (!consumed.results.length) {
    // A competing request may have consumed the credential after the initial read.
    await revokeReplay(env, row, isCode);
    throw new OAuthError("invalid_grant");
  }
  audit(isCode ? "oauth.token.issued" : "oauth.token.refreshed", row.user_id, client.client_id);
  return privateJson({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: accessExpires - now,
    refresh_token: refreshToken,
    scope: SCOPE,
  });
}

async function revokeReplay(env, row, isCode) {
  if (isCode) {
    await env.DB.prepare("UPDATE oauth_grants SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?")
      .bind(nowSeconds(), row.grant_id)
      .run();
  } else {
    await env.DB.batch([
      env.DB.prepare("UPDATE oauth_refresh_tokens SET revoked_at = ? WHERE family_id = ?").bind(
        nowSeconds(),
        row.family_id,
      ),
      env.DB.prepare("UPDATE oauth_access_tokens SET revoked_at = ? WHERE family_id = ?").bind(
        nowSeconds(),
        row.family_id,
      ),
    ]);
  }
  audit("oauth.replay.rejected", row.user_id, row.client_id);
}

async function revoke(env, form, client) {
  const raw = form.get("token");
  if (!raw || raw.length > 256) throw new OAuthError("invalid_request");
  const hash = await sha256(raw);
  await env.DB.prepare(
    `UPDATE oauth_grants SET revoked_at = COALESCE(revoked_at, ?) WHERE client_id = ? AND id IN
     (SELECT grant_id FROM oauth_access_tokens WHERE token_hash = ? UNION SELECT grant_id FROM oauth_refresh_tokens WHERE token_hash = ?)`,
  )
    .bind(nowSeconds(), client.client_id, hash, hash)
    .run();
  return privateJson({});
}

export async function handleOAuth(request, env, path) {
  try {
    ensureEnabled(env);
    issuer(env);
    if (path.startsWith("/.well-known/")) {
      if (request.method !== "GET") throw new OAuthError("invalid_request", 405);
      return authorizationMetadata(env);
    }
    if (path === "/oauth/authorize") return await authorize(request, env);
    if (path !== "/oauth/token" && path !== "/oauth/revoke") throw new OAuthError("invalid_request", 404);
    if (request.method !== "POST") throw new OAuthError("invalid_request", 405);
    await rateLimit(request, env, "oauth.token.ip", 120);
    const form = await readForm(request);
    const client = await authenticateClient(request, env, form);
    return path === "/oauth/token"
      ? await exchange(request, env, form, client)
      : await revoke(env, form, client);
  } catch (error) {
    const status = error instanceof OAuthError || error instanceof ApiError ? error.status : 500;
    // Never log errors containing request bodies, credentials or SQL bindings.
    return privateJson(
      {
        error:
          error instanceof OAuthError
            ? error.code
            : status === 429
              ? "temporarily_unavailable"
              : status >= 500
                ? "server_error"
                : "invalid_request",
      },
      status,
      {
        ...(status === 401 ? { "www-authenticate": 'Basic realm="oauth"' } : {}),
        ...(status === 429 ? { "retry-after": "60" } : {}),
      },
    );
  }
}

export async function cleanupOAuth(env) {
  const now = nowSeconds();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_authorization_requests WHERE expires_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM oauth_access_tokens WHERE expires_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM oauth_authorization_codes WHERE expires_at <= ?").bind(now),
    // Refresh hashes are retained until the entire grant expires, for replay detection.
    env.DB.prepare("DELETE FROM oauth_grants WHERE expires_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM oauth_rate_limits WHERE window < ?").bind(Math.floor(now / 60) - 5),
  ]);
}
