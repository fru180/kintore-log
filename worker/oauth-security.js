import { ApiError, json } from "./http.js";
import { cookieValue, requireUser } from "./auth.js";

const encoder = new TextEncoder();
export const nowSeconds = () => Math.floor(Date.now() / 1000);
export const randomToken = (prefix = "") =>
  prefix +
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
export const sha256 = async (value) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
export const base64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
export const pkceChallenge = async (verifier) =>
  base64url(await crypto.subtle.digest("SHA-256", encoder.encode(verifier)));

export function equalSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}

export async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64url(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export const privateJson = (data, status = 200, headers = {}) =>
  json(data, status, { "cache-control": "no-store", pragma: "no-cache", ...headers });

export function issuer(env) {
  const value = env.OAUTH_ISSUER;
  if (!value) throw new ApiError("OAuthの公開URLが未設定です", 503);
  const url = new URL(value);
  if (url.search || url.hash || url.username || url.password || value.endsWith("/"))
    throw new ApiError("OAuthの公開URLが不正です", 503);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
  )
    throw new ApiError("OAuthにはHTTPSが必要です", 503);
  return value;
}

export function ensureEnabled(env) {
  if (env.OAUTH_ENABLED !== "true") throw new ApiError("外部連携は停止中です", 503);
}

export const sessionHash = (request) => sha256(cookieValue(request, "kintore_session") || "");
export const csrfToken = (request) =>
  hmac(cookieValue(request, "kintore_session") || "", "kintore-oauth-csrf-v1");

export async function requireBrowserMutation(request, env, suppliedToken) {
  const user = await requireUser(request, env);
  // Wrangler rewrites both request.url and Origin to the local upstream URL.
  // The configured issuer also covers a separately proxied development frontend.
  // Do not trust arbitrary Forwarded/X-Forwarded-Host headers or loopback origins.
  const origins = new Set([new URL(request.url).origin]);
  if (env.OAUTH_ISSUER) origins.add(new URL(issuer(env)).origin);
  if (!origins.has(request.headers.get("origin")))
    throw new ApiError("アクセス元のURLが一致しません。アプリと同じURLから操作してください", 403);
  if (!equalSecret(suppliedToken ?? request.headers.get("x-csrf-token"), await csrfToken(request)))
    throw new ApiError("画面の認証情報が一致しません。画面を再読み込みしてください", 403);
  return user;
}

export async function rateLimit(request, env, bucket, limit = 60, perIp = true) {
  const window = Math.floor(nowSeconds() / 60);
  const key = await sha256(`${bucket}:${perIp ? request.headers.get("cf-connecting-ip") || "local" : "all"}`);
  const row = await env.DB.prepare(
    `INSERT INTO oauth_rate_limits (key_hash, window, count) VALUES (?, ?, 1)
     ON CONFLICT(key_hash, window) DO UPDATE SET count = count + 1 RETURNING count`,
  )
    .bind(key, window)
    .first();
  if (row.count > limit) throw new ApiError("リクエストが多すぎます。しばらくお待ちください", 429);
}

export async function readForm(request) {
  if (
    (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !==
    "application/x-www-form-urlencoded"
  )
    throw new ApiError("フォーム形式で送信してください", 415);
  if (Number(request.headers.get("content-length")) > 16384) throw new ApiError("入力が大きすぎます", 413);
  // Stream with a bound rather than allocating an unbounded request body.
  const reader = request.body?.getReader();
  const chunks = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        throw new ApiError("入力が大きすぎます", 413);
      }
      chunks.push(value);
    }
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const form = new URLSearchParams(new TextDecoder().decode(data));
  assertSingleParams(form);
  return form;
}

export function assertSingleParams(params) {
  for (const key of params.keys())
    if (params.getAll(key).length !== 1) throw new ApiError("パラメーターが重複しています", 400);
}

export function audit(action, userId, clientId) {
  console.info(
    JSON.stringify({ action, userId, clientId, at: nowSeconds(), requestId: crypto.randomUUID() }),
  );
}
